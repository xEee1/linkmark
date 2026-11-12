'use strict';

const express = require('express');
const { wrap, httpError } = require('./http');
const { requireAuth } = require('./auth');

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;

function normalizeTags(input) {
  if (input === undefined || input === null) return undefined;
  if (!Array.isArray(input)) throw httpError(400, 'tags 必须是字符串数组');
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim().toLowerCase();
    if (!name || name.length > MAX_TAG_LENGTH || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function normalizeUrl(url) {
  if (typeof url !== 'string') throw httpError(400, 'url 必须是字符串');
  const trimmed = url.trim();
  if (!trimmed) throw httpError(400, 'url 不能为空');
  try {
    const parsed = new URL(trimmed);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('bad protocol');
  } catch (e) {
    throw httpError(400, 'url 必须是合法的 http/https 地址');
  }
  return trimmed;
}

function cleanText(value, field, max) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw httpError(400, `${field} 必须是字符串`);
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw httpError(400, `${field} 过长（最多 ${max} 字符）`);
  }
  return trimmed;
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw httpError(404, '书签不存在');
  return id;
}

function bookmarkShape(row, tags = []) {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description,
    tags,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

async function ensureTag(client, userId, name) {
  const found = await client.query(
    'SELECT id FROM tags WHERE user_id = $1 AND name = $2',
    [userId, name]
  );
  if (found.rows.length) return found.rows[0].id;
  const inserted = await client.query(
    'INSERT INTO tags (user_id, name) VALUES ($1, $2) RETURNING id',
    [userId, name]
  );
  return inserted.rows[0].id;
}

async function setTags(client, userId, bookmarkId, names) {
  await client.query('DELETE FROM bookmark_tags WHERE bookmark_id = $1', [bookmarkId]);
  const result = [];
  for (const name of names) {
    const tagId = await ensureTag(client, userId, name);
    await client.query(
      'INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES ($1, $2)',
      [bookmarkId, tagId]
    );
    result.push(name);
  }
  return result;
}

async function tagsForBookmarks(queryable, ids) {
  const map = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return map;
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  const result = await queryable.query(
    `SELECT bt.bookmark_id, t.name
     FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id
     WHERE bt.bookmark_id IN (${placeholders})
     ORDER BY t.name`,
    ids
  );
  for (const row of result.rows) {
    if (map.has(row.bookmark_id)) map.get(row.bookmark_id).push(row.name);
  }
  return map;
}

function createBookmarksRouter(pool, jwtSecret) {
  const router = express.Router();
  router.use(requireAuth(jwtSecret));

  // GET /api/bookmarks?tag=xxx&q=yyy —— 列出当前用户书签，可按标签/关键词筛选
  router.get(
    '/',
    wrap(async (req, res) => {
      const tag =
        typeof req.query.tag === 'string' ? req.query.tag.trim().toLowerCase() : '';
      const q =
        typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const params = [req.userId];
      let sql = 'SELECT * FROM bookmarks WHERE user_id = $1';
      if (tag) {
        params.push(tag);
        sql += ` AND id IN (
          SELECT bt.bookmark_id FROM bookmark_tags bt
          JOIN tags t ON t.id = bt.tag_id
          WHERE t.name = $${params.length} AND t.user_id = $1
        )`;
      }
      if (q) {
        params.push('%' + q + '%');
        sql += ` AND (LOWER(title) LIKE $${params.length}
                      OR LOWER(url) LIKE $${params.length}
                      OR LOWER(description) LIKE $${params.length})`;
      }
      sql += ' ORDER BY created_at DESC, id DESC';
      const result = await pool.query(sql, params);
      const tagsMap = await tagsForBookmarks(
        pool,
        result.rows.map((r) => r.id)
      );
      res.json({
        bookmarks: result.rows.map((r) =>
          bookmarkShape(r, tagsMap.get(r.id) || [])
        ),
      });
    })
  );

  // POST /api/bookmarks —— 新建书签（可带标签）
  router.post(
    '/',
    wrap(async (req, res) => {
      const body = req.body || {};
      const url = normalizeUrl(body.url);
      const title = cleanText(body.title, 'title', 300) || url;
      const description = cleanText(body.description, 'description', 2000) ?? '';
      const tags = normalizeTags(body.tags) || [];
      const created = await withTransaction(pool, async (client) => {
        const result = await client.query(
          'INSERT INTO bookmarks (user_id, url, title, description) VALUES ($1, $2, $3, $4) RETURNING *',
          [req.userId, url, title, description]
        );
        const row = result.rows[0];
        return { row, tags: await setTags(client, req.userId, row.id, tags) };
      });
      res.status(201).json({ bookmark: bookmarkShape(created.row, created.tags) });
    })
  );

  // GET /api/bookmarks/:id —— 详情
  router.get(
    '/:id',
    wrap(async (req, res) => {
      const id = parseId(req.params.id);
      const result = await pool.query(
        'SELECT * FROM bookmarks WHERE id = $1 AND user_id = $2',
        [id, req.userId]
      );
      if (!result.rows.length) throw httpError(404, '书签不存在');
      const tagsMap = await tagsForBookmarks(pool, [id]);
      res.json({ bookmark: bookmarkShape(result.rows[0], tagsMap.get(id) || []) });
    })
  );

  // PUT /api/bookmarks/:id —— 编辑（只更新提供的字段；提供 tags 则整体替换）
  router.put(
    '/:id',
    wrap(async (req, res) => {
      const id = parseId(req.params.id);
      const body = req.body || {};
      const updated = await withTransaction(pool, async (client) => {
        const existing = await client.query(
          'SELECT * FROM bookmarks WHERE id = $1 AND user_id = $2',
          [id, req.userId]
        );
        if (!existing.rows.length) throw httpError(404, '书签不存在');
        const current = existing.rows[0];
        const url =
          body.url !== undefined ? normalizeUrl(body.url) : current.url;
        const title =
          body.title !== undefined
            ? cleanText(body.title, 'title', 300) || url
            : current.title;
        const description =
          body.description !== undefined
            ? cleanText(body.description, 'description', 2000) ?? ''
            : current.description;
        const result = await client.query(
          `UPDATE bookmarks SET url = $1, title = $2, description = $3,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $4 AND user_id = $5 RETURNING *`,
          [url, title, description, id, req.userId]
        );
        const tags = normalizeTags(body.tags);
        const finalTags =
          tags !== undefined
            ? await setTags(client, req.userId, id, tags)
            : (await tagsForBookmarks(client, [id])).get(id) || [];
        return { row: result.rows[0], tags: finalTags };
      });
      res.json({ bookmark: bookmarkShape(updated.row, updated.tags) });
    })
  );

  // DELETE /api/bookmarks/:id —— 删除（bookmark_tags 级联清理）
  router.delete(
    '/:id',
    wrap(async (req, res) => {
      const id = parseId(req.params.id);
      const result = await pool.query(
        'DELETE FROM bookmarks WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, req.userId]
      );
      if (!result.rows.length) throw httpError(404, '书签不存在');
      res.status(204).end();
    })
  );

  return router;
}

// GET /api/tags —— 当前用户的标签及每个标签下的书签数
function createTagsRouter(pool, jwtSecret) {
  const router = express.Router();
  router.use(requireAuth(jwtSecret));
  router.get(
    '/',
    wrap(async (req, res) => {
      const result = await pool.query(
        `SELECT t.id, t.name, COUNT(bt.bookmark_id) AS count
         FROM tags t LEFT JOIN bookmark_tags bt ON bt.tag_id = t.id
         WHERE t.user_id = $1
         GROUP BY t.id, t.name
         ORDER BY t.name`,
        [req.userId]
      );
      res.json({
        tags: result.rows.map((r) => ({
          id: r.id,
          name: r.name,
          count: Number(r.count),
        })),
      });
    })
  );
  return router;
}

module.exports = { createBookmarksRouter, createTagsRouter };
