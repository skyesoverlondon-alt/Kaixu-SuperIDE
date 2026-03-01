const { query } = require('./_lib/db');
const { requireAuth } = require('./_lib/auth');
const { json } = require('./_lib/body');

// Activity feed: recent audit_log + ai_usage_log events for a workspace or org
exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });
  let userId;
  try { ({ userId } = requireAuth(event)); } catch (e) { return json(401, { ok: false, error: e.message }); }

  const orgId = event.queryStringParameters?.orgId;
  const workspaceId = event.queryStringParameters?.workspaceId;
  const limit = Math.min(parseInt(event.queryStringParameters?.limit || '50'), 200);

  if (orgId) {
    const mem = await query(`select role from org_memberships where org_id=$1 and user_id=$2`, [orgId, userId]);
    if (!mem.rows[0]) return json(403, { ok: false, error: 'Not a member' });
  }

  const rows = await query(
    orgId
      ? `select a.id, a.action, a.details, a.created_at, u.email as user_email
         from audit_logs a left join users u on u.id=a.user_id
         where a.org_id=$1 order by a.created_at desc limit $2`
      : workspaceId
        ? `select a.id, a.action, a.details, a.created_at, u.email as user_email
           from audit_logs a left join users u on u.id=a.user_id
           where a.details->>'workspaceId'=$1 order by a.created_at desc limit $2`
        : `select a.id, a.action, a.details, a.created_at, u.email as user_email
           from audit_logs a left join users u on u.id=a.user_id
           where a.user_id=$1 order by a.created_at desc limit $2`,
    orgId ? [orgId, limit] : workspaceId ? [workspaceId, limit] : [userId, limit]
  );

  return json(200, { ok: true, events: rows.rows });
};
