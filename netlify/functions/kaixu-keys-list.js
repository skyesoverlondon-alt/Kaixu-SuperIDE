/**
 * GET /kaixu-keys-list
 * List all KaixuSI customer API keys (paginated).
 * Requires: valid JWT auth + admin access.
 * Query params: ?page=1&limit=50&active=true
 */

const { query } = require('./_lib/db');
const { requireAuth, json } = require('./_lib/auth');

function isAdmin(event, decoded) {
  const adminSecret = process.env.KAIXUSI_ADMIN_SECRET;
  if (adminSecret) {
    const h = event.headers || {};
    const hval = h['x-kaixusi-admin'] || h['X-KaixuSI-Admin'] || '';
    if (hval === adminSecret) return true;
  }
  if (decoded?.role === 'admin' || decoded?.role === 'owner') return true;
  return false;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });

  const auth = requireAuth(event);
  if (!auth.ok) return auth.response;

  if (!isAdmin(event, auth.decoded)) {
    return json(403, { ok: false, error: 'Admin access required' });
  }

  const params = event.queryStringParameters || {};
  const page  = Math.max(1, parseInt(params.page || '1', 10));
  const limit = Math.min(200, Math.max(1, parseInt(params.limit || '50', 10)));
  const offset = (page - 1) * limit;
  const activeOnly = params.active === 'true';

  try {
    const where = activeOnly ? 'WHERE is_active = true AND revoked_at IS NULL' : '';

    const total = await query(
      `SELECT COUNT(*) AS cnt FROM kaixu_customer_keys ${where}`
    );

    const rows = await query(
      `SELECT
         id, label, owner_email,
         created_at, revoked_at, last_used_at,
         call_count, monthly_limit, is_active,
         -- show first 8 chars of hash for identity, never full hash
         left(key_hash, 8) AS key_prefix
       FROM kaixu_customer_keys
       ${where}
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    // Also grab aggregate usage from ai_usage_log keyed by key_hash if available
    return json(200, {
      ok: true,
      total: parseInt(total.rows[0].cnt, 10),
      page, limit,
      keys: rows.rows
    });
  } catch (err) {
    console.error('kaixu-keys-list error:', err);
    return json(500, { ok: false, error: String(err?.message || err) });
  }
};
