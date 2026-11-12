'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { fail, requireUuid, errorMiddleware } = require('./errors');
const {
  validateRegister,
  validateLogin,
  validateBookmarkInput,
  normalizeTagQuery,
} = require('./validate');
const { signToken, authRequired } = require('./auth');

// Express 4 doesn't catch rejected promises, so wrap every async handler.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function iso(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function serializeUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    created_at: iso(row.created_at),
  };
}

function serializeBookmark(row, tags) {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description,
    tags: tags.slice().sort(),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

// Minimal CORS, kept from the earlier implementation. Harmless behind nginx's
// same-origin reverse proxy; useful for direct/dev access. No extra dependency.
function cors(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

function createApp(pool, options = {}) {
  const jwtSecret = options.jwtSecret || process.env.JWT_SECRET;
  const jwtExpiresIn = options.jwtExpiresIn || process.env.JWT_EXPIRES_IN || '7d';
  if (!jwtSecret) throw new Error('JWT_SECRET is required');

  const app = express();
  app.disable('x-powered-by');
  app.use(cors);
  app.use(express.json({ limit: '64kb' }));

  const auth = authRequired(jwtSecret);
  const tokenFor = (userId) => signToken(userId, jwtSecret, jwtExpiresIn);

  // Kept: useful as the Compose healthcheck target.
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  // --- shared helpers -----------------------------------------------------

  // Attach each bookmark's tags in one query (parameterized IN placeholders).
  async function tagsForBookmarks(rows) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const { rows: tagRows } = await pool.query(
      `SELECT bookmark_id, name FROM tags WHERE bookmark_id IN (${placeholders}) ORDER BY name`,
      ids
    );
    const byId = new Map();
    for (const t of tagRows) {
      if (!byId.has(t.bookmark_id)) byId.set(t.bookmark_id, []);
      byId.get(t.bookmark_id).push(t.name);
    }
    return rows.map((r) => serializeBookmark(r, byId.get(r.id) || []));
  }

  // Three-table model: tags are child rows, so a write is DELETE + batched INSERT
  // inside a single transaction (full replacement semantics).
  async function replaceTags(client, bookmarkId, names) {
    await client.query('DELETE FROM tags WHERE bookmark_id=$1', [bookmarkId]);
    for (const name of names) {
      await client.query('INSERT INTO tags (bookmark_id, name) VALUES ($1, $2)', [bookmarkId, name]);
    }
  }

  async function withTransaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    } finally {
      client.release();
    }
  }

  // --- auth ---------------------------------------------------------------

  app.post('/api/auth/register', wrap(async (req, res) => {
    const { username, email, password } = validateRegister(req.body);

    // Explicit pre-check gives deterministic EMAIL_TAKEN / USERNAME_TAKEN codes.
    const dup = await pool.query(
      'SELECT username, email FROM users WHERE email=$1 OR username=$2',
      [email, username]
    );
    for (const r of dup.rows) {
      if (r.email === email) fail('EMAIL_TAKEN', 'Email is already registered');
      if (r.username === username) fail('USERNAME_TAKEN', 'Username is already taken');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email, created_at`,
      [username, email, passwordHash]
    );
    const user = serializeUser(rows[0]);
    res.status(201).json({ token: tokenFor(user.id), user });
  }));

  app.post('/api/auth/login', wrap(async (req, res) => {
    const { email, password } = validateLogin(req.body);
    const { rows } = await pool.query(
      'SELECT id, username, email, password_hash, created_at FROM users WHERE email=$1',
      [email]
    );
    if (!rows.length) fail('INVALID_CREDENTIALS', 'Invalid email or password');
    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) fail('INVALID_CREDENTIALS', 'Invalid email or password');
    const user = serializeUser(rows[0]);
    res.json({ token: tokenFor(user.id), user });
  }));

  app.get('/api/auth/me', auth, wrap(async (req, res) => {
    const { rows } = await pool.query(
      'SELECT id, username, email, created_at FROM users WHERE id=$1',
      [req.userId]
    );
    if (!rows.length) fail('UNAUTHORIZED', 'User no longer exists');
    res.json({ user: serializeUser(rows[0]) });
  }));

  // --- bookmarks ----------------------------------------------------------

  app.get('/api/bookmarks', auth, wrap(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const tag = normalizeTagQuery(req.query.tag);

    const params = [req.userId];
    const where = ['b.user_id = $1'];
    let join = '';

    if (tag) {
      join = ' JOIN tags t ON t.bookmark_id = b.id';
      params.push(tag);
      where.push(`t.name = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(
        `(b.title ILIKE $${params.length} OR b.url ILIKE $${params.length} ` +
        `OR b.description ILIKE $${params.length})`
      );
    }

    // q + tag combine as AND; DISTINCT collapses any duplicate joined rows.
    const sql =
      `SELECT DISTINCT b.id, b.url, b.title, b.description, b.created_at, b.updated_at ` +
      `FROM bookmarks b${join} WHERE ${where.join(' AND ')} ` +
      `ORDER BY b.created_at DESC, b.id DESC`;

    const { rows } = await pool.query(sql, params);
    res.json({ bookmarks: await tagsForBookmarks(rows) });
  }));

  app.get('/api/bookmarks/:id', auth, wrap(async (req, res) => {
    const id = requireUuid(req.params.id);
    const { rows } = await pool.query(
      `SELECT id, url, title, description, created_at, updated_at
       FROM bookmarks WHERE id=$1 AND user_id=$2`,
      [id, req.userId]
    );
    if (!rows.length) fail('NOT_FOUND', 'Bookmark not found');
    const [bookmark] = await tagsForBookmarks(rows);
    res.json({ bookmark });
  }));

  app.post('/api/bookmarks', auth, wrap(async (req, res) => {
    const input = validateBookmarkInput(req.body);
    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO bookmarks (user_id, url, title, description)
         VALUES ($1, $2, $3, $4)
         RETURNING id, url, title, description, created_at, updated_at`,
        [req.userId, input.url, input.title, input.description]
      );
      await replaceTags(client, rows[0].id, input.tags);
      return rows[0];
    });
    const [bookmark] = await tagsForBookmarks([row]);
    res.status(201).json({ bookmark });
  }));

  app.put('/api/bookmarks/:id', auth, wrap(async (req, res) => {
    const id = requireUuid(req.params.id);
    const input = validateBookmarkInput(req.body); // full replacement; title required

    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE bookmarks
         SET url=$1, title=$2, description=$3, updated_at=now()
         WHERE id=$4 AND user_id=$5
         RETURNING id`,
        [input.url, input.title, input.description, id, req.userId]
      );
      if (!rows.length) fail('NOT_FOUND', 'Bookmark not found');
      await replaceTags(client, id, input.tags);
    });

    const { rows } = await pool.query(
      `SELECT id, url, title, description, created_at, updated_at
       FROM bookmarks WHERE id=$1 AND user_id=$2`,
      [id, req.userId]
    );
    const [bookmark] = await tagsForBookmarks(rows);
    res.json({ bookmark });
  }));

  app.delete('/api/bookmarks/:id', auth, wrap(async (req, res) => {
    const id = requireUuid(req.params.id);
    const { rowCount } = await pool.query(
      'DELETE FROM bookmarks WHERE id=$1 AND user_id=$2',
      [id, req.userId]
    );
    if (!rowCount) fail('NOT_FOUND', 'Bookmark not found');
    res.status(204).end(); // tags cascade via ON DELETE CASCADE
  }));

  // --- tags ---------------------------------------------------------------

  app.get('/api/tags', auth, wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT DISTINCT name FROM tags t
       JOIN bookmarks b ON b.id = t.bookmark_id
       WHERE b.user_id = $1
       ORDER BY name`,
      [req.userId]
    );
    res.json({ tags: rows.map((r) => r.name) });
  }));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
  });

  app.use(errorMiddleware);
  return app;
}

module.exports = { createApp };
