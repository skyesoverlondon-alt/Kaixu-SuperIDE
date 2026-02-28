const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });
  const token = getBearerToken(event);
  if (!token) return json(401, { ok: false, error: 'Missing token' });
  const id = (event.queryStringParameters?.id || '').trim();
  if (!id) return json(400, { ok: false, error: 'Missing workspace id' });

  try {
    const claims = verifyToken(token);
    const userId = claims.sub;
    const res = await query('select id, name, files, updated_at, org_id from workspaces where id=$1', [id]);
const ws = res.rows[0];
if (!ws) return json(404, { ok: false, error: 'Workspace not found' });
// Verify membership
if (ws.org_id) {
  const mem = await query('select role from org_memberships where org_id=$1 and user_id=$2', [ws.org_id, userId]);
  if (!mem.rows[0]) return json(403, { ok:false, error:'Not allowed' });
} else {
  // legacy fallback
  const legacy = await query('select 1 from workspaces where id=$1 and user_id=$2', [id, userId]);
  if (!legacy.rows[0]) return json(403, { ok:false, error:'Not allowed' });
}        
    return json(200, { ok: true, workspace: ws });
  } catch (err) {
    return json(401, { ok: false, error: 'Invalid token' });
  }
};
