const crypto = require('crypto');
const { query } = require('./_lib/db');
const { requireAuth } = require('./_lib/auth');
const { json, readJson } = require('./_lib/body');

// POST — create webhook
// GET  ?orgId= or ?workspaceId= — list webhooks
// DELETE — remove webhook
exports.handler = async (event) => {
  let userId;
  try { ({ userId } = requireAuth(event)); } catch (e) { return json(401, { ok: false, error: e.message }); }

  if (event.httpMethod === 'GET') {
    const orgId = event.queryStringParameters?.orgId;
    const workspaceId = event.queryStringParameters?.workspaceId;
    const rows = await query(
      orgId
        ? `select id, url, events, enabled, created_at from webhooks where org_id=$1 and created_by=$2`
        : `select id, url, events, enabled, created_at from webhooks where workspace_id=$1 and created_by=$2`,
      [orgId || workspaceId, userId]
    );
    return json(200, { ok: true, webhooks: rows.rows });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try { body = await readJson(event); } catch { return json(400, { ok: false, error: 'Invalid JSON' }); }
    const { orgId, workspaceId, url, events = ['ws.save'] } = body;
    if (!url || (!orgId && !workspaceId)) return json(400, { ok: false, error: 'url and orgId or workspaceId required' });

    try { new URL(url); } catch { return json(400, { ok: false, error: 'Invalid URL' }); }

    const secret = crypto.randomBytes(20).toString('hex');
    const r = await query(
      `insert into webhooks(org_id, workspace_id, url, events, secret, created_by) values($1,$2,$3,$4,$5,$6) returning id`,
      [orgId || null, workspaceId || null, url, events, secret, userId]
    );
    return json(200, { ok: true, id: r.rows[0].id, secret });
  }

  if (event.httpMethod === 'DELETE') {
    let body;
    try { body = await readJson(event); } catch { return json(400, { ok: false, error: 'Invalid JSON' }); }
    await query(`delete from webhooks where id=$1 and created_by=$2`, [body.id, userId]);
    return json(200, { ok: true });
  }

  return json(405, { ok: false, error: 'Method not allowed' });
};
