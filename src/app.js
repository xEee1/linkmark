'use strict';

const express = require('express');
const cors = require('cors');
const { createAuthRouter } = require('./auth');
const { createBookmarksRouter, createTagsRouter } = require('./bookmarks');

function createApp({ pool, jwtSecret, corsOrigin } = {}) {
  if (!pool) throw new Error('createApp 需要一个 pool');
  const secret =
    jwtSecret || process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';

  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: corsOrigin || process.env.CORS_ORIGIN || true }));
  app.use(express.json({ limit: '64kb' }));

  // 健康检查（无需鉴权，供 Docker Compose healthcheck / 探活使用）
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/api/auth', createAuthRouter(pool, secret));
  app.use('/api/bookmarks', createBookmarksRouter(pool, secret));
  app.use('/api/tags', createTagsRouter(pool, secret));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // 统一错误处理
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: '请求体不是合法的 JSON' });
    }
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({
      error: status >= 500 ? '服务器内部错误' : err.message,
    });
  });

  return app;
}

module.exports = { createApp };
