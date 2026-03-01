const { query } = require('./_lib/db');
const { requireAuth } = require('./_lib/auth');
const { json, readJson } = require('./_lib/body');
const logger = require('./_lib/logger')('admin-kill-switch');

// GET  — return current AI enabled status
// POST { enabled: true|false } — toggle (org admin or global admin)
exports.handler = async (event) => {
  let userId;
  try { ({ userId } = requireAuth(event)); } catch (e) { return json(401, { ok: false, error: e.message }); }

  if (event.httpMethod === 'GET') {
    const r = await query(`select value from global_settings where key='ai_enabled'`);
    return json(200, { ok: true, aiEnabled: r.rows[0]?.value !== 'false' });
  }

  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  let body;
  try { body = await readJson(event); } catch { return json(400, { ok: false, error: 'Invalid JSON' }); }
  const { enabled, orgId } = body;

  // For org-scoped kill switch, check org admin
  if (orgId) {
    const mem = await query(`select role from org_memberships where org_id=$1 and user_id=$2`, [orgId, userId]);
    if (!mem.rows[0] || !['owner','admin'].includes(mem.rows[0].role)) {
      return json(403, { ok: false, error: 'Admin only' });
    }
    // Store per-org setting
    const key = `ai_enabled_org_${orgId}`;
    await query(
      `insert into global_settings(key, value, updated_by) values($1,$2,$3)
       on conflict(key) do update set value=excluded.value, updated_by=excluded.updated_by, updated_at=now()`,
      [key, enabled ? 'true' : 'false', userId]
    );
    logger.info('org_ai_kill_switch', { orgId, enabled, by: userId });
    return json(200, { ok: true, aiEnabled: !!enabled, scope: 'org' });
  }

  // Global: only users with no org restriction (super-admin pattern)
  await query(
    `insert into global_settings(key, value, updated_by) values('ai_enabled',$1,$2)
     on conflict(key) do update set value=excluded.value, updated_by=excluded.updated_by, updated_at=now()`,
    [enabled ? 'true' : 'false', userId]
  );
  logger.info('global_ai_kill_switch', { enabled, by: userId });
  return json(200, { ok: true, aiEnabled: !!enabled, scope: 'global' });
};
