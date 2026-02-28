const { Pool } = require('pg');

let _pool;

function getPool() {
  if (_pool) return _pool;

  const connectionString = process.env.NEON_DATABASE_URL;
  if (!connectionString) {
    throw new Error('Missing NEON_DATABASE_URL');
  }

  _pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
    ssl: { rejectUnauthorized: false }
  });

  return _pool;
}

async function query(text, params = []) {
  const pool = getPool();
  const res = await pool.query(text, params);
  return res;
}

module.exports = { query };
