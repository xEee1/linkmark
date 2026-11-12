'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const SCHEMA_PATH = path.join(__dirname, '..', 'db', 'schema.sql');

function createPool() {
  return new Pool({
    connectionString:
      process.env.DATABASE_URL ||
      'postgres://linkmark:linkmark@localhost:5432/linkmark',
  });
}

function schemaStatements() {
  const raw = fs.readFileSync(SCHEMA_PATH, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trim())
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function migrate(pool) {
  for (const statement of schemaStatements()) {
    await pool.query(statement);
  }
}

module.exports = { createPool, migrate };
