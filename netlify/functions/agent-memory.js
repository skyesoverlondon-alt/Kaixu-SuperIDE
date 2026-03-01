const { query } = require('./_lib/db');
const { requireAuth } = require('./_lib/auth');
const { json, readJson } = require('./_lib/body');

// GET ?workspaceId= — fetch agent memory
// POST { workspaceId, memory } — save agent memory
exports.handler = async (event) => {
  let userId;
  try { ({ userId } = requireAuth(event)); } catch (e) { return json(401, { ok: false, error: e.message }); }

  if (event.httpMethod === 'GET') {
    const workspaceId = event.queryStringParameters?.workspaceId;
    if (!workspaceId) return json(400, { ok: false, error: 'workspaceId required' });

    // Verify access
    const ws = await query(
      `select user_id from workspaces where id=$1`, [workspaceId]
    );
    if (!ws.rows[0]) return json(404, { ok: false, error: 'Workspace not found' });

    const mem = await query(`select memory, updated_at from agent_memory where workspace_id=$1`, [workspaceId]);
    return json(200, { ok: true, memory: mem.rows[0]?.memory || '', updatedAt: mem.rows[0]?.updated_at || null });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try { body = await readJson(event); } catch { return json(400, { ok: false, error: 'Invalid JSON' }); }
    const { workspaceId, memory } = body;
    if (!workspaceId) return json(400, { ok: false, error: 'workspaceId required' });

    // Verify ownership
    const ws = await query(`select user_id from workspaces where id=$1`, [workspaceId]);
    if (!ws.rows[0] || ws.rows[0].user_id !== userId) return json(403, { ok: false, error: 'Not allowed' });

    await query(
      `insert into agent_memory(workspace_id, memory, updated_at) values($1,$2,now())
       on conflict(workspace_id) do update set memory=excluded.memory, updated_at=now()`,
      [workspaceId, String(memory || '').slice(0, 10000)]
    );
    return json(200, { ok: true });
  }

  return json(405, { ok: false, error: 'Method not allowed' });
};
