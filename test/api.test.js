'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');
const { migrate } = require('../src/db');
const { createApp } = require('../src/app');

async function setup() {
  // pg-mem 提供纯 JS 的内存版 Postgres，无需真实数据库即可端到端验证
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  const app = createApp({ pool, jwtSecret: 'test-secret' });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { pool, server, base: `http://127.0.0.1:${server.address().port}` };
}

async function close(ctx) {
  await new Promise((resolve) => ctx.server.close(resolve));
  await ctx.pool.end();
}

async function request(ctx, method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(ctx.base + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = text;
    }
  }
  return { status: res.status, data };
}

test('端到端：认证 / 书签 CRUD / 标签与关键词筛选 / 数据隔离', async (t) => {
  const ctx = await setup();
  t.after(() => close(ctx));

  let r = await request(ctx, 'GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'ok');

  // 鉴权：未带 token 不可访问
  r = await request(ctx, 'GET', '/api/bookmarks');
  assert.equal(r.status, 401);

  // 参数校验
  r = await request(ctx, 'POST', '/api/auth/register', {
    body: { username: 'ab', password: '123' },
  });
  assert.equal(r.status, 400);

  // 注册
  r = await request(ctx, 'POST', '/api/auth/register', {
    body: { username: 'alice', password: 'secret123' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.user.username, 'alice');
  assert.ok(r.data.token);
  const token = r.data.token;

  // 重名冲突
  r = await request(ctx, 'POST', '/api/auth/register', {
    body: { username: 'alice', password: 'secret123' },
  });
  assert.equal(r.status, 409);

  // 登录成功 / 失败
  r = await request(ctx, 'POST', '/api/auth/login', {
    body: { username: 'alice', password: 'secret123' },
  });
  assert.equal(r.status, 200);
  assert.ok(r.data.token);
  r = await request(ctx, 'POST', '/api/auth/login', {
    body: { username: 'alice', password: 'wrongpass' },
  });
  assert.equal(r.status, 401);

  // me
  r = await request(ctx, 'GET', '/api/auth/me', { token });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.username, 'alice');

  // 创建书签（标签去重 + 统一小写）
  r = await request(ctx, 'POST', '/api/bookmarks', {
    token,
    body: {
      url: 'https://developer.mozilla.org',
      title: 'MDN Web Docs',
      description: 'Web 开发文档',
      tags: ['前端', 'Docs', '前端'],
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id1 = r.data.bookmark.id;
  assert.equal(r.data.bookmark.title, 'MDN Web Docs');
  assert.deepEqual(r.data.bookmark.tags.slice().sort(), ['docs', '前端']);

  r = await request(ctx, 'POST', '/api/bookmarks', {
    token,
    body: { url: 'https://nodejs.org', title: 'Node.js', tags: ['后端', 'Runtime'] },
  });
  assert.equal(r.status, 201);
  const id2 = r.data.bookmark.id;

  // 非法 url
  r = await request(ctx, 'POST', '/api/bookmarks', {
    token,
    body: { url: 'not-a-url' },
  });
  assert.equal(r.status, 400);

  // 列表
  r = await request(ctx, 'GET', '/api/bookmarks', { token });
  assert.equal(r.status, 200);
  assert.equal(r.data.bookmarks.length, 2);

  // 关键词筛选（命中 title / url，忽略大小写）
  r = await request(ctx, 'GET', '/api/bookmarks?q=MDN', { token });
  assert.equal(r.data.bookmarks.length, 1);
  assert.equal(r.data.bookmarks[0].id, id1);
  r = await request(ctx, 'GET', '/api/bookmarks?q=nodejs.org', { token });
  assert.equal(r.data.bookmarks.length, 1);

  // 标签筛选
  r = await request(ctx, 'GET', '/api/bookmarks?tag=' + encodeURIComponent('前端'), { token });
  assert.equal(r.data.bookmarks.length, 1);
  assert.equal(r.data.bookmarks[0].id, id1);

  // 标签 + 关键词组合：无命中
  r = await request(
    ctx,
    'GET',
    '/api/bookmarks?tag=' + encodeURIComponent('后端') + '&q=mdn',
    { token }
  );
  assert.equal(r.data.bookmarks.length, 0);

  // 标签列表 + 计数
  r = await request(ctx, 'GET', '/api/tags', { token });
  assert.equal(r.status, 200);
  const names = r.data.tags.map((x) => x.name);
  assert.ok(names.includes('前端'));
  assert.ok(names.includes('docs'));
  const front = r.data.tags.find((x) => x.name === '前端');
  assert.equal(front.count, 1);

  // 详情
  r = await request(ctx, 'GET', `/api/bookmarks/${id1}`, { token });
  assert.equal(r.status, 200);
  assert.equal(r.data.bookmark.id, id1);

  // 编辑（改标题 + 整体替换标签）
  r = await request(ctx, 'PUT', `/api/bookmarks/${id1}`, {
    token,
    body: { title: 'MDN', tags: ['前端', '参考'] },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.bookmark.title, 'MDN');
  assert.equal(r.data.bookmark.url, 'https://developer.mozilla.org');
  assert.deepEqual(r.data.bookmark.tags.slice().sort(), ['前端', '参考']);

  // 数据隔离：另一个用户看不到 alice 的书签
  r = await request(ctx, 'POST', '/api/auth/register', {
    body: { username: 'bob', password: 'secret123' },
  });
  const bobToken = r.data.token;
  r = await request(ctx, 'GET', '/api/bookmarks', { token: bobToken });
  assert.equal(r.data.bookmarks.length, 0);
  r = await request(ctx, 'GET', `/api/bookmarks/${id1}`, { token: bobToken });
  assert.equal(r.status, 404);

  // 删除（本人）
  r = await request(ctx, 'DELETE', `/api/bookmarks/${id1}`, { token });
  assert.equal(r.status, 204);
  r = await request(ctx, 'GET', `/api/bookmarks/${id1}`, { token });
  assert.equal(r.status, 404);
  r = await request(ctx, 'GET', '/api/bookmarks', { token });
  assert.equal(r.data.bookmarks.length, 1);
  assert.equal(r.data.bookmarks[0].id, id2);
});
