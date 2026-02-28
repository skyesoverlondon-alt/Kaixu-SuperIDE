const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });
  const token = getBearerToken(event);
  if (!token) return json(401, { ok: false, error: 'Missing token' });

  const orgId = String(event.queryStringParameters?.org_id || '').trim();
  if (!orgId) return json(400, { ok: false, error: 'Missing org_id' });

  try {
    const claims = verifyToken(token);
    const userId = claims.sub;

    // membership required
    const mem = await query('select role from org_memberships where org_id=$1 and user_id=$2', [orgId, userId]);
    if (!mem.rows[0]) return json(403, { ok:false, error:'Not a member of this org' });

    const res = await query(
      'select id, name, updated_at from workspaces where org_id=$1 order by updated_at desc limit 50',
      [orgId]
    );
    return json(200, { ok:true, workspaces: res.rows });
  } catch (err) {
    return json(401, { ok:false, error:'Invalid token' });
  }
};
