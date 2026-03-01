const crypto = require('crypto');
const { query } = require('./_lib/db');
const { requireAuth } = require('./_lib/auth');
const { json, readJson } = require('./_lib/body');

// POST { workspaceId, expiresInHours } — create share link
// GET  ?token=xxx — fetch shared workspace files (read-only, no auth)
// DELETE { shareId } — revoke share
exports.handler = async (event) => {
  if (event.httpMethod === 'GET') {
    const token = event.queryStringParameters?.token;
    if (!token) return json(400, { ok: false, error: 'token required' });

    const share = await query(
      `select ws.files, ws.name, s.expires_at from workspace_shares s
       join workspaces ws on ws.id=s.workspace_id
       where s.token=$1`,
      [token]
    );
    if (!share.rows[0]) return json(404, { ok: false, error: 'Share not found' });
    if (share.rows[0].expires_at && new Date(share.rows[0].expires_at) < new Date()) {
      return json(410, { ok: false, error: 'Share link expired' });
    }
    return json(200, {
      ok: true,
      name: share.rows[0].name,
      files: share.rows[0].files,
      readOnly: true
    });
  }

  let userId;
  try { ({ userId } = requireAuth(event)); } catch (e) { return json(401, { ok: false, error: e.message }); }

  if (event.httpMethod === 'POST') {
    let body;
    try { body = await readJson(event); } catch { return json(400, { ok: false, error: 'Invalid JSON' }); }
    const { workspaceId, expiresInHours } = body;
    if (!workspaceId) return json(400, { ok: false, error: 'workspaceId required' });

    // Verify ownership
    const ws = await query(`select user_id from workspaces where id=$1`, [workspaceId]);
    if (!ws.rows[0]) return json(404, { ok: false, error: 'Workspace not found' });
    if (ws.rows[0].user_id !== userId) return json(403, { ok: false, error: 'Not your workspace' });

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = expiresInHours ? new Date(Date.now() + expiresInHours * 3600_000) : null;

    const r = await query(
      `insert into workspace_shares(workspace_id, token, created_by, expires_at) values($1,$2,$3,$4) returning id`,
      [workspaceId, token, userId, expiresAt]
    );
    const shareUrl = `${process.env.URL || 'https://localhost'}/preview-share.html?token=${token}`;
    return json(200, { ok: true, token, shareUrl, id: r.rows[0].id });
  }

  if (event.httpMethod === 'DELETE') {
    let body;
    try { body = await readJson(event); } catch { return json(400, { ok: false, error: 'Invalid JSON' }); }
    await query(
      `delete from workspace_shares where id=$1 and created_by=$2`,
      [body.shareId, userId]
    );
    return json(200, { ok: true });
  }

  return json(405, { ok: false, error: 'Method not allowed' });
};
