const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });
  const token = getBearerToken(event);
  if (!token) return json(401, { ok: false, error: 'Missing token' });
  const workspaceId = (event.queryStringParameters?.workspaceId || '').trim();
  if (!workspaceId) return json(400, { ok: false, error: 'Missing workspaceId' });

  try {
    const claims = verifyToken(token);
    const userId = claims.sub;

    // Org-aware access check (matches ws-get.js pattern)
    const wsRes = await query('select id, org_id, user_id from workspaces where id=$1', [workspaceId]);
    const ws0 = wsRes.rows[0];
    if (!ws0) return json(404, { ok: false, error: 'Workspace not found' });
    if (ws0.org_id) {
      const mem = await query('select role from org_memberships where org_id=$1 and user_id=$2', [ws0.org_id, userId]);
      if (!mem.rows[0]) return json(403, { ok: false, error: 'Not allowed' });
    } else {
      if (ws0.user_id !== userId) return json(403, { ok: false, error: 'Not allowed' });
    }

    const limit = Math.min(parseInt(event.queryStringParameters?.limit || '200', 10) || 200, 500);
    const res = await query(
      'select id, role, text, operations, checkpoint_commit_id as "checkpointCommitId", created_at as "createdAt" from chats where workspace_id=$1 order by created_at asc limit $2',
      [workspaceId, limit]
    );
    return json(200, { ok: true, messages: res.rows });
  } catch (err) {
    return json(401, { ok: false, error: 'Invalid token' });
  }
};
