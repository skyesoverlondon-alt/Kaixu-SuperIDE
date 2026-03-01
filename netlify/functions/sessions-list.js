const { query } = require('./_lib/db');
const { requireAuth } = require('./_lib/auth');
const { json } = require('./_lib/body');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });
  let userId;
  try { ({ userId } = requireAuth(event)); } catch (e) { return json(401, { ok: false, error: e.message }); }

  const rows = await query(
    `select id, device_hint, ip, created_at, last_seen, revoked_at
     from sessions where user_id=$1 order by last_seen desc limit 50`,
    [userId]
  );

  return json(200, {
    ok: true,
    sessions: rows.rows.map(r => ({
      id: r.id,
      deviceHint: r.device_hint,
      ip: r.ip,
      createdAt: r.created_at,
      lastSeen: r.last_seen,
      revoked: !!r.revoked_at
    }))
  });
};
