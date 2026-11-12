'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { newDb, DataType } = require('pg-mem');
const { createApp } = require('../src/app');

// Test-only fixture: mirrors the authoritative db/init.sql (three tables).
// Production never runs DDL here — ops mounts db/init.sql into the db container.
const DDL = `
  CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(32) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE bookmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bookmark_id UUID NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
    name VARCHAR(32) NOT NULL,
    UNIQUE (bookmark_id, name)
  );
`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let server, base, pool;

async function req(method, path, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
  const payload = raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined;
  const res = await fetch(base + path, { method, headers, body: payload });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: res.status, data, text };
}

function assertError(r, status, code) {
  assert.equal(r.status, status, `expected ${status}, got ${r.status}: ${r.text}`);
  assert.deepEqual(Object.keys(r.data), ['error'], `error body keys: ${r.text}`);
  assert.equal(r.data.error.code, code, `error code: ${r.text}`);
  assert.equal(typeof r.data.error.message, 'string');
  assert.ok(r.data.error.message.length > 0);
}

function assertBookmarkShape(b) {
  assert.match(b.id, UUID_RE, 'id is a UUID string');
  for (const k of ['url', 'title', 'description']) assert.equal(typeof b[k], 'string');
  assert.ok(Array.isArray(b.tags));
  assert.deepEqual(b.tags, b.tags.slice().sort(), 'tags sorted asc');
  for (const t of b.tags) assert.equal(typeof t, 'string');
  assert.match(b.created_at, /^\d{4}-\d{2}-\d{2}T.*Z$/, 'created_at ISO-8601 UTC');
  assert.match(b.updated_at, /^\d{4}-\d{2}-\d{2}T.*Z$/, 'updated_at ISO-8601 UTC');
}

before(async () => {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    implementation: () => crypto.randomUUID(),
    impure: true,
  });
  db.public.none(DDL);
  const adapter = db.adapters.createPg();
  pool = new adapter.Pool();

  const app = createApp(pool, { jwtSecret: 'test-secret', jwtExpiresIn: '7d' });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (pool && typeof pool.end === 'function') await pool.end();
});

test('authoritative-contract end-to-end', async (t) => {
  let aliceToken, aliceId, bobToken;
  let bmAlpha, bmBeta, bmBob;

  await t.test('health is public; protected routes need a Bearer token', async () => {
    const h = await req('GET', '/api/health');
    assert.equal(h.status, 200);
    assert.deepEqual(h.data, { status: 'ok' });

    assertError(await req('GET', '/api/bookmarks'), 401, 'UNAUTHORIZED');
    assertError(await req('GET', '/api/tags', { token: 'garbage' }), 401, 'UNAUTHORIZED');
    assertError(await req('GET', '/api/auth/me'), 401, 'UNAUTHORIZED');
  });

  await t.test('register validation: username/email/password rules', async () => {
    assertError(await req('POST', '/api/auth/register', { body: { username: 'ab', email: 'a@b.com', password: 'password1' } }), 400, 'VALIDATION_ERROR');
    assertError(await req('POST', '/api/auth/register', { body: { username: 'bad name', email: 'a@b.com', password: 'password1' } }), 400, 'VALIDATION_ERROR');
    assertError(await req('POST', '/api/auth/register', { body: { username: 'alice', email: 'not-an-email', password: 'password1' } }), 400, 'VALIDATION_ERROR');
    assertError(await req('POST', '/api/auth/register', { body: { username: 'alice', email: 'a@b.com', password: 'short' } }), 400, 'VALIDATION_ERROR'); // <8
  });

  await t.test('register returns 201 token + User (email, no password)', async () => {
    const r = await req('POST', '/api/auth/register', {
      body: { username: 'alice', email: 'Alice@Example.com', password: 'password123' },
    });
    assert.equal(r.status, 201, r.text);
    assert.equal(typeof r.data.token, 'string');
    assert.equal(typeof r.data.user.id, 'string');
    assert.match(r.data.user.id, UUID_RE);
    assert.equal(r.data.user.username, 'alice');
    assert.equal(r.data.user.email, 'alice@example.com'); // normalized lowercase
    assert.match(r.data.user.created_at, /Z$/);
    assert.equal(r.data.user.password_hash, undefined);
    aliceToken = r.data.token;
    aliceId = r.data.user.id;
  });

  await t.test('unique email / username -> 409 codes', async () => {
    assertError(await req('POST', '/api/auth/register', { body: { username: 'alice2', email: 'alice@example.com', password: 'password123' } }), 409, 'EMAIL_TAKEN');
    assertError(await req('POST', '/api/auth/register', { body: { username: 'alice', email: 'other@example.com', password: 'password123' } }), 409, 'USERNAME_TAKEN');
  });

  await t.test('login by email: wrong credentials 401, correct 200', async () => {
    assertError(await req('POST', '/api/auth/login', { body: { email: 'alice@example.com', password: 'wrongpass' } }), 401, 'INVALID_CREDENTIALS');
    assertError(await req('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: 'password123' } }), 401, 'INVALID_CREDENTIALS');
    const ok = await req('POST', '/api/auth/login', { body: { email: 'ALICE@example.com', password: 'password123' } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.data.user.id, aliceId);
    assert.equal(typeof ok.data.token, 'string');
  });

  await t.test('GET /api/auth/me returns the current user', async () => {
    const r = await req('GET', '/api/auth/me', { token: aliceToken });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.id, aliceId);
    assert.equal(r.data.user.email, 'alice@example.com');
  });

  await t.test('create bookmark: tags normalized (trim/lowercase/dedup), 201', async () => {
    const r = await req('POST', '/api/bookmarks', {
      token: aliceToken,
      body: {
        url: 'https://alpha.example.com/doc',
        title: 'Alpha Work Doc',
        description: 'primary reference',
        tags: ['  Work ', 'WORK', 'reading', '', '   ', 'work', 'Reading'],
      },
    });
    assert.equal(r.status, 201, r.text);
    assertBookmarkShape(r.data.bookmark);
    assert.deepEqual(r.data.bookmark.tags, ['reading', 'work']);
    assert.equal(r.data.bookmark.title, 'Alpha Work Doc');
    assert.equal(r.data.bookmark.description, 'primary reference');
    bmAlpha = r.data.bookmark;
  });

  await t.test('create validations: bad url / empty title / long title / too many tags / overlong tag', async () => {
    assertError(await req('POST', '/api/bookmarks', { token: aliceToken, body: { url: 'ftp://x', title: 'x' } }), 400, 'VALIDATION_ERROR');
    assertError(await req('POST', '/api/bookmarks', { token: aliceToken, body: { url: 'https://x.com', title: '   ' } }), 400, 'VALIDATION_ERROR');
    assertError(await req('POST', '/api/bookmarks', { token: aliceToken, body: { url: 'https://x.com', title: 'x'.repeat(256) } }), 400, 'VALIDATION_ERROR');
    assertError(await req('POST', '/api/bookmarks', { token: aliceToken, body: { url: 'https://x.com', title: 'x', tags: Array.from({ length: 21 }, (_, i) => `t${i}`) } }), 400, 'VALIDATION_ERROR');
    assertError(await req('POST', '/api/bookmarks', { token: aliceToken, body: { url: 'https://x.com', title: 'x', tags: ['x'.repeat(33)] } }), 400, 'VALIDATION_ERROR');
    assertError(await req('POST', '/api/bookmarks', { token: aliceToken, raw: '{bad json' }), 400, 'VALIDATION_ERROR');
  });

  await t.test('second bookmark; list returns both with their tags', async () => {
    const r = await req('POST', '/api/bookmarks', {
      token: aliceToken,
      body: { url: 'https://beta.example.net/notes', title: 'Beta Notes', description: 'alpha appears in description', tags: ['personal'] },
    });
    assert.equal(r.status, 201, r.text);
    bmBeta = r.data.bookmark;

    const list = await req('GET', '/api/bookmarks', { token: aliceToken });
    assert.equal(list.status, 200);
    assert.equal(list.data.bookmarks.length, 2);
    const ids = list.data.bookmarks.map((b) => b.id).sort();
    assert.deepEqual(ids, [bmAlpha.id, bmBeta.id].sort());
    for (const b of list.data.bookmarks) assertBookmarkShape(b);
  });

  await t.test('GET /:id: own 200; malformed/foreign/random id -> 404', async () => {
    const own = await req('GET', `/api/bookmarks/${bmAlpha.id}`, { token: aliceToken });
    assert.equal(own.status, 200);
    assert.equal(own.data.bookmark.id, bmAlpha.id);

    assertError(await req('GET', '/api/bookmarks/not-a-uuid', { token: aliceToken }), 404, 'NOT_FOUND');
    assertError(await req('GET', `/api/bookmarks/${crypto.randomUUID()}`, { token: aliceToken }), 404, 'NOT_FOUND');
  });

  await t.test('q + tag filtering, AND semantics, ILIKE over title/url/description', async () => {
    const qAlpha = await req('GET', '/api/bookmarks?q=alpha', { token: aliceToken });
    assert.deepEqual(qAlpha.data.bookmarks.map((b) => b.id).sort(), [bmAlpha.id, bmBeta.id].sort());

    const byUrl = await req('GET', '/api/bookmarks?q=beta.example.net', { token: aliceToken });
    assert.deepEqual(byUrl.data.bookmarks.map((b) => b.id), [bmBeta.id]);

    const tagWork = await req('GET', '/api/bookmarks?tag=WORK', { token: aliceToken }); // case-insensitive
    assert.deepEqual(tagWork.data.bookmarks.map((b) => b.id), [bmAlpha.id]);

    const and1 = await req('GET', '/api/bookmarks?q=alpha&tag=work', { token: aliceToken });
    assert.deepEqual(and1.data.bookmarks.map((b) => b.id), [bmAlpha.id]);

    const and2 = await req('GET', '/api/bookmarks?q=alpha&tag=personal', { token: aliceToken });
    assert.deepEqual(and2.data.bookmarks.map((b) => b.id), [bmBeta.id]);

    const andNone = await req('GET', '/api/bookmarks?q=zzz&tag=work', { token: aliceToken });
    assert.deepEqual(andNone.data.bookmarks, []);
  });

  await t.test('GET /api/tags -> { tags: deduped, ascending names }', async () => {
    const r = await req('GET', '/api/tags', { token: aliceToken });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { tags: ['personal', 'reading', 'work'] });
  });

  await t.test('PUT is full replacement incl. tags + updated_at = now()', async () => {
    const before = (await req('GET', `/api/bookmarks/${bmAlpha.id}`, { token: aliceToken })).data.bookmark;

    const put = await req('PUT', `/api/bookmarks/${bmAlpha.id}`, {
      token: aliceToken,
      body: { url: 'https://alpha.example.com/v2', title: 'Alpha Rewritten', tags: ['fresh', 'FRESH', ' zeta '] },
    });
    assert.equal(put.status, 200, put.text);
    assertBookmarkShape(put.data.bookmark);
    assert.equal(put.data.bookmark.title, 'Alpha Rewritten');
    assert.equal(put.data.bookmark.description, '', 'omitted description resets to empty');
    assert.deepEqual(put.data.bookmark.tags, ['fresh', 'zeta'], 'tags fully replaced');
    assert.notEqual(put.data.bookmark.updated_at, before.updated_at, 'updated_at advanced');

    assertError(await req('PUT', `/api/bookmarks/${bmAlpha.id}`, { token: aliceToken, body: { url: 'https://x.com' } }), 400, 'VALIDATION_ERROR'); // title required
    assertError(await req('PUT', `/api/bookmarks/${crypto.randomUUID()}`, { token: aliceToken, body: { url: 'https://x.com', title: 'x' } }), 404, 'NOT_FOUND');
  });

  await t.test('DELETE -> 204, cascades tags, subsequent GET -> 404', async () => {
    const del = await req('DELETE', `/api/bookmarks/${bmBeta.id}`, { token: aliceToken });
    assert.equal(del.status, 204);
    assert.equal(del.text, '');
    assertError(await req('GET', `/api/bookmarks/${bmBeta.id}`, { token: aliceToken }), 404, 'NOT_FOUND');
    const tags = await req('GET', '/api/tags', { token: aliceToken });
    assert.deepEqual(tags.data.tags, ['fresh', 'zeta'], "beta's personal tag is gone");
  });

  await t.test('ownership invariant: second user cannot see/modify first user bookmarks (404)', async () => {
    const reg = await req('POST', '/api/auth/register', {
      body: { username: 'bob', email: 'bob@example.com', password: 'password123' },
    });
    assert.equal(reg.status, 201, reg.text);
    bobToken = reg.data.token;

    const created = await req('POST', '/api/bookmarks', {
      token: bobToken,
      body: { url: 'https://bob.example.com', title: 'Bob Private', tags: ['bobonly'] },
    });
    assert.equal(created.status, 201, created.text);
    bmBob = created.data.bookmark;

    assertError(await req('GET', `/api/bookmarks/${bmAlpha.id}`, { token: bobToken }), 404, 'NOT_FOUND');
    assertError(await req('PUT', `/api/bookmarks/${bmAlpha.id}`, { token: bobToken, body: { url: 'https://evil.com', title: 'hijack' } }), 404, 'NOT_FOUND');
    assertError(await req('DELETE', `/api/bookmarks/${bmAlpha.id}`, { token: bobToken }), 404, 'NOT_FOUND');

    const bobList = await req('GET', '/api/bookmarks', { token: bobToken });
    assert.deepEqual(bobList.data.bookmarks.map((b) => b.id), [bmBob.id]);

    const aliceTags = await req('GET', '/api/tags', { token: aliceToken });
    assert.deepEqual(aliceTags.data.tags, ['fresh', 'zeta'], "alice does not see bob's tags");
    const bobTags = await req('GET', '/api/tags', { token: bobToken });
    assert.deepEqual(bobTags.data.tags, ['bobonly']);

    // alice untouched after bob's failed PUT/DELETE
    const aliceStill = await req('GET', `/api/bookmarks/${bmAlpha.id}`, { token: aliceToken });
    assert.equal(aliceStill.data.bookmark.title, 'Alpha Rewritten');
  });

  await t.test('unknown /api route keeps the unified error body', async () => {
    assertError(await req('GET', '/api/nope', { token: aliceToken }), 404, 'NOT_FOUND');
  });
});
