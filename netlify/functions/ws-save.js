const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');
const logger = require('./_lib/logger')('ws-save');
const { checkRateLimit } = require('./_lib/ratelimit');

// Fire webhooks for a workspace event (best-effort, non-blocking)
async function fireWebhooks(workspaceId, orgId, event, payload) {
  try {
    const hooks = await query(
      `select url, secret, events from webhooks where enabled=true and (workspace_id=$1 or org_id=$2)`,
      [workspaceId, orgId || '00000000-0000-0000-0000-000000000000']
    );
    for (const hook of hooks.rows) {
      if (!hook.events.includes(event)) continue;
      const body = JSON.stringify({ event, workspaceId, ...payload });
      const sig = require('crypto').createHmac('sha256', hook.secret).update(body).digest('hex');
      fetch(hook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-KaixU-Signature': `sha256=${sig}` },
        body
      }).catch(() => {});
    }
  } catch { /* non-fatal */ }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
  const token = getBearerToken(event);
  if (!token) return json(401, { ok: false, error: 'Missing token' });

  // Rate limit: 60 saves/min per token
  const limited = await checkRateLimit(token, 'ws-save', { maxHits: 60, windowSecs: 60 });
  if (limited) return json(429, { ok: false, error: 'Too many save requests. Limit: 60/min.', retryAfter: 60 });

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

    const wsCheck = await query('select id, org_id, user_id from workspaces where id=$1', [wsId]);
    const ws0 = wsCheck.rows[0];
    if (!ws0) return json(404, { ok: false, error: 'Workspace not found' });

    if (ws0.org_id) {
      const mem = await query('select role from org_memberships where org_id=$1 and user_id=$2', [ws0.org_id, userId]);
      if (!mem.rows[0]) return json(403, { ok: false, error: 'Not allowed' });
      // Viewers cannot write
      if (mem.rows[0].role === 'viewer') return json(403, { ok: false, error: 'Viewers cannot save workspaces' });
    } else {
      const legacy = await query('select 1 from workspaces where id=$1 and user_id=$2', [wsId, userId]);
      if (!legacy.rows[0]) return json(403, { ok: false, error: 'Not allowed' });
    }

    const res = await query(
      'update workspaces set files=$1, name=coalesce($2,name), updated_at=now() where id=$3 returning id, name, updated_at',
      [fileObj, name || null, wsId]
    );
    const ws = res.rows[0];
    if (!ws) return json(404, { ok: false, error: 'Workspace not found' });

    // Audit log + webhook (non-blocking)
    query(`insert into audit_logs(user_id, org_id, action, details) values($1,$2,'ws.save',$3)`,
      [userId, ws0.org_id || null, JSON.stringify({ workspaceId: wsId, name: ws.name })]).catch(() => {});
    fireWebhooks(wsId, ws0.org_id, 'ws.save', { name: ws.name, updatedAt: ws.updated_at });

    return json(200, { ok: true, workspace: ws });
  } catch (err) {
    logger.error('ws_save_error', { error: err.message });
    return json(401, { ok: false, error: 'Invalid token' });
  }
};
