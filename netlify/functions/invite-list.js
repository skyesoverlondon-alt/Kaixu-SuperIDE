const { query } = require('./_lib/db');
const { requireAuth } = require('./_lib/auth');
const { json } = require('./_lib/body');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });
  let userId;
  try { ({ userId } = requireAuth(event)); } catch (e) { return json(401, { ok: false, error: e.message }); }

  const orgId = event.queryStringParameters?.orgId;
  if (!orgId) return json(400, { ok: false, error: 'orgId required' });

  const mem = await query(`select role from org_memberships where org_id=$1 and user_id=$2`, [orgId, userId]);
  if (!mem.rows[0] || !['owner','admin'].includes(mem.rows[0].role)) {
    return json(403, { ok: false, error: 'Admin only' });
  }

  const rows = await query(
    `select i.id, i.email, i.role, i.token, i.created_at, i.expires_at, i.accepted_at,
            u.email as accepted_by_email
     from org_invites i left join users u on u.id=i.accepted_by
     where i.org_id=$1 order by i.created_at desc limit 100`,
    [orgId]
  );

  return json(200, { ok: true, invites: rows.rows });
};
