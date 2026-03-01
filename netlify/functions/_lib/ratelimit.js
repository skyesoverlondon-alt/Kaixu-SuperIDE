/*
  _lib/ratelimit.js — DB-backed rate limiter for Netlify functions
  Uses the `rate_limit_log` table (see schema.sql).

  Usage:
    const { checkRateLimit } = require('./_lib/ratelimit');
    const limited = await checkRateLimit(key, 'auth-login', { maxHits: 10, windowSecs: 60 });
    if (limited) return { statusCode: 429, body: JSON.stringify({ error: 'Too many requests' }) };
*/

const { query } = require('./db');

/**
 * Returns true if the caller is rate-limited (should block), false if OK.
 * @param {string} key        — IP or email used as the bucket key
 * @param {string} action     — e.g. 'auth-login', 'auth-signup'
 * @param {{ maxHits?: number, windowSecs?: number }} opts
 */
async function checkRateLimit(key, action, { maxHits = 10, windowSecs = 60 } = {}) {
  try {
    const windowStart = new Date(Date.now() - windowSecs * 1000).toISOString();

    // Prune old rows (background, non-blocking)
    query(`DELETE FROM rate_limit_log WHERE created_at < $1`, [windowStart]).catch(() => {});

    // Count hits in window
    const res = await query(
      `SELECT COUNT(*)::int AS hits
       FROM rate_limit_log
       WHERE bucket_key = $1 AND action = $2 AND created_at >= $3`,
      [key, action, windowStart]
    );

    const hits = res.rows[0]?.hits || 0;
    if (hits >= maxHits) return true;

    // Record this hit
    await query(
      `INSERT INTO rate_limit_log (bucket_key, action) VALUES ($1, $2)`,
      [key, action]
    );
    return false;
  } catch {
    // Don't block if rate limit table doesn't exist yet or query fails
    return false;
  }
}

module.exports = { checkRateLimit };

