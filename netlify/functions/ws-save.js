const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
  const token = getBearerToken(event);
  if (!token) return json(401, { ok: false, error: 'Missing token' });

  const parsed = await readJson(event);
  if (!parsed.ok) return parsed.response;
  const { id, files, name } = parsed.data || {};
  const wsId = String(id || '').trim();
  if (!wsId) return json(400, { ok: false, error: 'Missing workspace id' });
  const fileObj = files && typeof files === 'object' ? files : null;
  if (!fileObj) return json(400, { ok: false, error: 'Missing files object' });

  try {
    const claims = verifyToken(token);
    const userId = claims.sub;

    // Verify membership before update
const wsCheck = await query('select id, org_id from workspaces where id=$1', [wsId]);
const ws0 = wsCheck.rows[0];
if (!ws0) return json(404, { ok:false, error:'Workspace not found' });

if (ws0.org_id) {
  const mem = await query('select role from org_memberships where org_id=$1 and user_id=$2', [ws0.org_id, userId]);
  if (!mem.rows[0]) return json(403, { ok:false, error:'Not allowed' });
} else {
  const legacy = await query('select 1 from workspaces where id=$1 and user_id=$2', [wsId, userId]);
  if (!legacy.rows[0]) return json(403, { ok:false, error:'Not allowed' });
}

const res = await query(
  'update workspaces set files=$1, name=coalesce($2,name), updated_at=now() where id=$3 returning id, name, updated_at',
  [fileObj, name || null, wsId]
);        
    const ws = res.rows[0];
    if (!ws) return json(404, { ok: false, error: 'Workspace not found' });
    return json(200, { ok: true, workspace: ws });
  } catch (err) {
    return json(401, { ok: false, error: 'Invalid token' });
  }
};
