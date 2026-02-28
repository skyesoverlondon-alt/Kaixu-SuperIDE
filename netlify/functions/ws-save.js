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

    const res = await query(
      'update workspaces set files=$1, name=coalesce($2,name), updated_at=now() where id=$3 and user_id=$4 returning id, name, updated_at',
      [fileObj, name || null, wsId, userId]
    );
    const ws = res.rows[0];
    if (!ws) return json(404, { ok: false, error: 'Workspace not found' });
    return json(200, { ok: true, workspace: ws });
  } catch (err) {
    return json(401, { ok: false, error: 'Invalid token' });
  }
};
