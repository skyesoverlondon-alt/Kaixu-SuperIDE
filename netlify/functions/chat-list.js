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
    // ensure workspace belongs to user
    const ws = await query('select id from workspaces where id=$1 and user_id=$2', [workspaceId, userId]);
    if (!ws.rows[0]) return json(404, { ok: false, error: 'Workspace not found' });

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
