'use strict';

const { createPool, migrate } = require('./db');
const { createApp } = require('./app');

// Compose 中数据库容器可能比后端晚几秒才接受连接，做有限次重试以支持「一键拉起」
async function initDatabase(pool, attempts = 15) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('SELECT 1');
      await migrate(pool);
      return;
    } catch (err) {
      lastErr = err;
      console.warn(
        `[warn] 数据库尚未就绪 (${i}/${attempts})，1 秒后重试: ${err.message}`
      );
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw lastErr;
}

async function main() {
  const port = Number(process.env.PORT || 3001);
  if (!process.env.JWT_SECRET) {
    console.warn(
      '[warn] JWT_SECRET 未设置，使用仅用于开发环境的默认密钥；生产环境务必配置。'
    );
  }

  const pool = createPool();
  // 启动时幂等建表（CREATE TABLE IF NOT EXISTS），并容忍数据库稍后就绪
  await initDatabase(pool);
  console.log('[info] 数据库结构已就绪');

  const app = createApp({ pool, jwtSecret: process.env.JWT_SECRET });
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`[info] linkmark API 已启动: http://0.0.0.0:${port}`);
  });

  const shutdown = (signal) => {
    console.log(`[info] 收到 ${signal}，正在关闭...`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[fatal] 启动失败:', err);
  process.exit(1);
});
