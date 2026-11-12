'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const express = require('express');
const { wrap, httpError } = require('./http');

function validateCredentials(body) {
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (username.length < 3 || username.length > 50) {
    throw httpError(400, '用户名长度需为 3-50 个字符');
  }
  if (password.length < 6) {
    throw httpError(400, '密码长度至少 6 个字符');
  }
  return { username, password };
}

function publicUser(row) {
  return { id: row.id, username: row.username, created_at: row.created_at };
}

function signToken(userId, jwtSecret) {
  return jwt.sign({ sub: String(userId) }, jwtSecret, { expiresIn: '7d' });
}

function requireAuth(jwtSecret) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) return next(httpError(401, '缺少或无效的 Authorization 头'));
    try {
      const payload = jwt.verify(match[1], jwtSecret);
      req.userId = Number(payload.sub);
      if (!Number.isInteger(req.userId) || req.userId <= 0) {
        throw new Error('bad sub');
      }
      next();
    } catch (e) {
      next(httpError(401, 'Token 无效或已过期'));
    }
  };
}

function createAuthRouter(pool, jwtSecret) {
  const router = express.Router();

  router.post(
    '/register',
    wrap(async (req, res) => {
      const { username, password } = validateCredentials(req.body || {});
      const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
      if (existing.rows.length) throw httpError(409, '用户名已被注册');
      const passwordHash = await bcrypt.hash(password, 10);
      const result = await pool.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
        [username, passwordHash]
      );
      const user = publicUser(result.rows[0]);
      res.status(201).json({ token: signToken(user.id, jwtSecret), user });
    })
  );

  router.post(
    '/login',
    wrap(async (req, res) => {
      const { username, password } = validateCredentials(req.body || {});
      const result = await pool.query(
        'SELECT id, username, password_hash, created_at FROM users WHERE username = $1',
        [username]
      );
      const row = result.rows[0];
      if (!row || !(await bcrypt.compare(password, row.password_hash))) {
        throw httpError(401, '用户名或密码错误');
      }
      const user = publicUser(row);
      res.json({ token: signToken(user.id, jwtSecret), user });
    })
  );

  router.get(
    '/me',
    requireAuth(jwtSecret),
    wrap(async (req, res) => {
      const result = await pool.query(
        'SELECT id, username, created_at FROM users WHERE id = $1',
        [req.userId]
      );
      if (!result.rows.length) throw httpError(401, '用户不存在');
      res.json({ user: publicUser(result.rows[0]) });
    })
  );

  return router;
}

module.exports = { createAuthRouter, requireAuth };
