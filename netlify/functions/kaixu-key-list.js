// kaixu-key-list.js
// GET — list KaixuSI API keys
//
// Admin (role=admin):  returns ALL keys across ALL users + usage stats
// Regular user:        returns their own key(s) only
//
// Auth: Bearer <user JWT>
// Query params: ?status=active|revoked|all  (default: all)

const { requireAuth } = require('./_lib/auth');
const { query }       = require('./_lib/db');
const { json }        = require('./_lib/body');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: 'Method not allowed' };

  const auth = requireAuth(event);
  if (!auth.ok) return { ...auth.response, headers: { ...auth.response.headers, ...CORS } };

  const callerId = auth.decoded.userId || auth.decoded.sub;
  const isAdmin  = auth.decoded.role === 'admin' || auth.decoded.admin === true;
  const status   = event.queryStringParameters?.status || 'all';

  const statusFilter = status === 'all' ? '' : `AND k.status=$${isAdmin ? 2 : 2}`;

  let rows;
  if (isAdmin) {
    // Admin: all keys + user email + 30-day usage
    const params = status === 'all' ? [] : [status];
    const whereStatus = status === 'all' ? '' : `AND k.status=$1`;
    const q = await query(`
      SELECT
        k.id,
        k.label,
        k.status,
        k.created_at,
        k.last_used_at,
        k.revoked_at,
        u.id        AS user_id,
        u.email     AS user_email,
        u.name      AS user_name,
        COALESCE(ai.calls, 0)  AS calls_30d,
        COALESCE(ai.tokens, 0) AS tokens_30d,
        COALESCE(ai.errors, 0) AS errors_30d
      FROM kaixu_keys k
      JOIN users u ON u.id = k.user_id
      LEFT JOIN (
        SELECT user_id,
               COUNT(*) FILTER (WHERE success) AS calls,
               SUM(prompt_tokens + completion_tokens) FILTER (WHERE success) AS tokens,
               COUNT(*) FILTER (WHERE NOT success) AS errors
        FROM ai_usage_log
        WHERE created_at > now() - interval '30 days'
          AND app_id = 'kaixu-superide'
        GROUP BY user_id
      ) ai ON ai.user_id = k.user_id
      ${whereStatus}
      ORDER BY k.created_at DESC
      LIMIT 500
    `, params);
    rows = q.rows;
  } else {
    // Regular user: own keys only
    const params = status === 'all' ? [callerId] : [callerId, status];
    const whereStatus = status === 'all' ? '' : `AND k.status=$2`;
    const q = await query(`
      SELECT
        k.id,
        k.label,
        k.status,
        k.created_at,
        k.last_used_at,
        k.revoked_at
      FROM kaixu_keys k
      WHERE k.user_id=$1 ${whereStatus}
      ORDER BY k.created_at DESC
    `, params);
    rows = q.rows;
  }

  // Never return key_hash
  return json(200, {
    ok:    true,
    total: rows.length,
    keys:  rows,
  }, CORS);
};
