const { query } = require('./_lib/db');
const { requireAuth } = require('./_lib/auth');
const { json, readJson } = require('./_lib/body');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
  let userId;
  try { ({ userId } = requireAuth(event)); } catch (e) { return json(401, { ok: false, error: e.message }); }

  let body;
  try { body = await readJson(event); } catch { return json(400, { ok: false, error: 'Invalid JSON' }); }
  const { sessionId } = body;

  if (!sessionId) return json(400, { ok: false, error: 'sessionId required' });

  // Only allow revoking own sessions
  const r = await query(
    `update sessions set revoked_at=now()
     where id=$1 and user_id=$2 and revoked_at is null
     returning id`,
    [sessionId, userId]
  );

  if (!r.rows.length) return json(404, { ok: false, error: 'Session not found or already revoked' });
  return json(200, { ok: true });
};
