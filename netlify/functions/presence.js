const { query } = require('./_lib/db');
const { requireAuth } = require('./_lib/auth');
const { json, readJson } = require('./_lib/body');

// Polling-based presence with live cursor + content hash sync.
// GET ?workspaceId= — returns list of active users (seen < 30s ago)
// POST { workspaceId, cursor?, filePath?, contentHash? } — upsert presence heartbeat

exports.handler = async (event) => {
  let userId, userEmail;
  try {
    const u = await requireAuth(event);
    userId = u.sub; userEmail = u.email;
  } catch (e) { return json(401, { ok: false, error: e.message }); }

  if (event.httpMethod === 'GET') {
    const workspaceId = event.queryStringParameters?.workspaceId;
    if (!workspaceId) return json(400, { ok: false, error: 'workspaceId required' });

    const rows = await query(
      `SELECT DISTINCT ON (user_id) user_id, details, created_at
       FROM audit_logs
       WHERE action='presence' AND details->>'workspaceId'=$1
         AND created_at > NOW()-INTERVAL '30 seconds'
       ORDER BY user_id, created_at DESC`,
      [workspaceId]
    );

    return json(200, {
      ok: true,
      users: rows.rows.map(r => ({
        userId:      r.user_id,
        email:       r.details?.email || '',
        cursor:      r.details?.cursor || null,
        filePath:    r.details?.filePath || null,
        contentHash: r.details?.contentHash || null,
        color:       r.details?.color || '#7c3aed',
        lastSeen:    r.created_at,
      }))
    });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try { const r = await readJson(event); body = r.data || r; }
    catch { return json(400, { ok: false, error: 'Invalid JSON' }); }

    const { workspaceId, cursor, filePath, contentHash } = body;
    if (!workspaceId) return json(400, { ok: false, error: 'workspaceId required' });

    // Assign a stable color per user (hash of userId)
    const colorPalette = ['#7c3aed','#0891b2','#059669','#d97706','#dc2626','#db2777','#7c3aed'];
    const colorIdx = [...userId].reduce((a, c) => a + c.charCodeAt(0), 0) % colorPalette.length;
    const color = colorPalette[colorIdx];

    await query(
      `INSERT INTO audit_logs(user_id, action, details) VALUES($1,'presence',$2)`,
      [userId, JSON.stringify({ workspaceId, email: userEmail, cursor: cursor || null, filePath: filePath || null, contentHash: contentHash || null, color })]
    );

    return json(200, { ok: true });
  }

  return json(405, { ok: false, error: 'Method not allowed' });
};
