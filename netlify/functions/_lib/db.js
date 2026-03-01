const { Pool } = require('pg');

let _pool;
let _replicaPool;

function getPool() {
  if (_pool) return _pool;

  // Netlify-Neon integration can set any of these variable names depending on version:
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.NEON_DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.NETLIFY_DATABASE_URL ||
    process.env.PG_CONNECTION_STRING ||
    process.env.PGCONNSTRING;

  if (!connectionString) {
    throw new Error(
      'Missing database connection string. Add DATABASE_URL in Netlify → Site configuration → Environment variables. ' +
      'Value comes from Neon console → Connect → Connection string (Node.js).'
    );
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

// ── Read replica pool (Phase 28 — multi-region) ────────────────────────────
// Set DATABASE_REPLICA_URL in Netlify env to enable. Falls back to primary.
// Neon: enable read replica in console → Settings → Compute → Add replica
function getReplicaPool() {
  if (_replicaPool) return _replicaPool;
  const replicaUrl = process.env.DATABASE_REPLICA_URL;
  if (!replicaUrl) return getPool(); // fall back to primary if no replica configured
  _replicaPool = new Pool({
    connectionString: replicaUrl,
    max: 5,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 5_000, // stricter timeout for replica
    ssl: { rejectUnauthorized: false }
  });
  return _replicaPool;
}

// ── Simple query — always goes to primary (for writes) ────────────────────
async function query(text, params = []) {
  const pool = getPool();
  const res = await pool.query(text, params);
  return res;
}

// ── Read query — routes to replica if configured (for SELECT-only queries) ─
// Use readQuery() for all SELECT queries to distribute read load.
// Automatically falls back to primary if replica is unavailable.
async function readQuery(text, params = []) {
  try {
    const pool = getReplicaPool();
    return await pool.query(text, params);
  } catch (err) {
    // Replica failure → fall back to primary (never fail a read due to replica issues)
    console.warn(JSON.stringify({ level: 'warn', event: 'replica_fallback', error: err.message }));
    return query(text, params);
  }
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
//   db.readQuery(sql, params) → routes to read replica if available
function getDb(userId) {
  return {
    query:     userId ? (sql, p) => queryAs(userId, sql, p) : query,
    readQuery: (sql, p) => readQuery(sql, p),
    queryAs,
    pool: getPool(),
  };
}

module.exports = { query, readQuery, queryAs, getDb };

