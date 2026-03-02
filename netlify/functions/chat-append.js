const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');
const { checkRateLimit } = require('./_lib/ratelimit');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
  const token = getBearerToken(event);
  if (!token) return json(401, { ok: false, error: 'Missing token' });

  const parsed = await readJson(event);
  if (!parsed.ok) return parsed.response;
  const { workspaceId, role, text, operations, checkpointCommitId } = parsed.data || {};
  const wsId = String(workspaceId || '').trim();
  const r = String(role || '').trim();
  const t = String(text || '').trim();
  if (!wsId || !t || !['user','assistant','system'].includes(r)) {
    return json(400, { ok: false, error: 'Missing/invalid fields' });
  }

  try {
    const claims = verifyToken(token);
    const userId = claims.sub;

    // ── Rate limit: 60 chat messages / min ─────────────────────────
    const rlLimited = await checkRateLimit(userId, 'chat-append', { maxHits: 60, windowSecs: 60 });
    if (rlLimited) return json(429, { ok: false, error: 'Too many requests.', retryAfter: 60 });

    // Verify access (org-aware)
    const wsRes = await query('select org_id, user_id from workspaces where id=$1', [wsId]);
    const ws = wsRes.rows[0];
    if (!ws) return json(404, { ok: false, error: 'Workspace not found' });
    if (ws.org_id) {
      const mem = await query('select role from org_memberships where org_id=$1 and user_id=$2', [ws.org_id, userId]);
      if (!mem.rows[0]) return json(403, { ok: false, error: 'Not allowed' });
    } else {
      if (ws.user_id !== userId) return json(403, { ok: false, error: 'Not allowed' });
    }

    const res = await query(
      'insert into chats(workspace_id, role, text, operations, checkpoint_commit_id) values($1,$2,$3,$4,$5) returning id, created_at',
      [wsId, r, t, operations || null, checkpointCommitId || null]
    );
    return json(200, { ok: true, id: res.rows[0].id, createdAt: res.rows[0].created_at });
  } catch (err) {
    return json(401, { ok: false, error: 'Invalid token' });
  }
};
