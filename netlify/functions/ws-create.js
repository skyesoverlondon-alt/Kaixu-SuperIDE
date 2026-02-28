const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
  const token = getBearerToken(event);
  if (!token) return json(401, { ok: false, error: 'Missing token' });

  const parsed = await readJson(event);
  if (!parsed.ok) return parsed.response;

  const orgId = String(parsed.data?.org_id || '').trim();
  const name = String(parsed.data?.name || '').trim() || 'New Workspace';
  if (!orgId) return json(400, { ok:false, error:'Missing org_id' });

  try {
    const claims = verifyToken(token);
    const userId = claims.sub;

    const mem = await query('select role from org_memberships where org_id=$1 and user_id=$2', [orgId, userId]);
    if (!mem.rows[0]) return json(403, { ok:false, error:'Not a member of this org' });

    const res = await query(
      'insert into workspaces(org_id, created_by, user_id, name, files) values($1,$2,$2,$3,$4) returning id, name, updated_at',
      [orgId, userId, name, {}]
    );
    return json(200, { ok:true, workspace: res.rows[0] });
  } catch (err) {
    return json(400, { ok:false, error:String(err?.message||err) });
  }
};
