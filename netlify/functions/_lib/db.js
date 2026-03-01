const { Pool } = require('pg');

let _pool;

function getPool() {
  if (_pool) return _pool;

  // Netlify-Neon integration sets DATABASE_URL; fall back to manual NEON_DATABASE_URL
  const connectionString = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!connectionString) {
    throw new Error('Missing DATABASE_URL (set via Netlify-Neon integration or manually as NEON_DATABASE_URL)');
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

// ── Simple query (no RLS user context) ────────────────────────────────────
async function query(text, params = []) {
  const pool = getPool();
  const res = await pool.query(text, params);
  return res;
}

// ── RLS-aware query: sets app.current_user_id in the transaction ──────────
// Use this for any query that touches RLS-enabled tables.
async function queryAs(userId, text, params = []) {
  const pool   = getPool();
  const client = await pool.connect();
  try {
    // Use SET LOCAL so the setting is scoped to this transaction only
    await client.query('BEGIN');
    await client.query(
      `SET LOCAL app.current_user_id = '${String(userId).replace(/'/g, '')}'`
    );
    const res = await client.query(text, params);
    await client.query('COMMIT');
    return res;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── getDb(): returns an object for callers that use .query() pattern ───────
// Supports both simple and RLS-aware usage:
//   const db = getDb(userId);
//   db.query(sql, params)  → runs as userId if provided
function getDb(userId) {
  return {
    query: userId ? (sql, p) => queryAs(userId, sql, p) : query,
    queryAs,
    pool: getPool(),
  };
}

module.exports = { query, queryAs, getDb };
