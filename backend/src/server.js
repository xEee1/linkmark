'use strict';

require('dotenv').config();

const { Pool } = require('pg');
const { createApp } = require('./app');

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Refusing to start.');
  process.exit(1);
}

// Schema is NOT created here: ops mounts db/init.sql into the Postgres
// container's /docker-entrypoint-initdb.d/ on first startup.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const app = createApp(pool, {
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`linkmark backend listening on :${port}`);
});
