// org-settings.js — get and update org-level security settings
//
// GET  ?orgId=<id>   → { ok, settings }
// PATCH body { orgId, require_mfa?, sso_enabled? }  → { ok, settings }
//
// Requires: org owner or admin role

const { requireAuth, json } = require('./_lib/auth');
const { query }             = require('./_lib/db');
const { readJson }          = require('./_lib/body');
const logger                = require('./_lib/logger')('org-settings');

// Columns that admins are allowed to patch (safe allowlist)
const PATCHABLE = ['require_mfa', 'sso_enabled', 'sso_provider', 'sso_domain'];

exports.handler = async (event) => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  let userId;
  try { ({ userId } = requireAuth(event)); }
  catch (e) { return json(401, { ok: false, error: e.message }); }

  // ── GET: return current settings ──────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const orgId = event.queryStringParameters?.orgId;
    if (!orgId) return json(400, { ok: false, error: 'orgId required' });

    // Confirm caller is a member of the org
    const { rows: mem } = await query(
      `SELECT role FROM org_memberships WHERE org_id=$1 AND user_id=$2`,
      [orgId, userId]
    );
    if (!mem.length) return json(403, { ok: false, error: 'Not a member of this org' });

    const { rows } = await query(
      `SELECT id, name, require_mfa, sso_enabled, sso_provider, sso_domain, plan_id, created_at
       FROM orgs WHERE id=$1`,
      [orgId]
    );
    if (!rows.length) return json(404, { ok: false, error: 'Org not found' });

    return json(200, { ok: true, settings: rows[0], role: mem[0].role });
  }

  // ── PATCH: update settings ────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    const parsed = await readJson(event);
    if (!parsed.ok) return parsed.response;

    const { orgId, ...updates } = parsed.data || {};
    if (!orgId) return json(400, { ok: false, error: 'orgId required' });

    // Confirm caller is owner or admin
    const { rows: mem } = await query(
      `SELECT role FROM org_memberships WHERE org_id=$1 AND user_id=$2`,
      [orgId, userId]
    );
    if (!mem.length) return json(403, { ok: false, error: 'Not a member of this org' });
    if (!['owner', 'admin'].includes(mem[0].role)) {
      return json(403, { ok: false, error: 'Owner or admin required' });
    }

    // Build safe SET clause from allowlist
    const setClauses = [];
    const values = [];
    for (const col of PATCHABLE) {
      if (col in updates) {
        values.push(updates[col]);
        setClauses.push(`${col}=$${values.length}`);
      }
    }
    if (!setClauses.length) return json(400, { ok: false, error: 'No valid fields to update' });

    values.push(orgId);
    const { rows } = await query(
      `UPDATE orgs SET ${setClauses.join(', ')} WHERE id=$${values.length}
       RETURNING id, name, require_mfa, sso_enabled, sso_provider, sso_domain, plan_id`,
      values
    );
    if (!rows.length) return json(404, { ok: false, error: 'Org not found' });

    logger.info('settings_updated', { orgId, updatedBy: userId, fields: Object.keys(updates).filter(k => PATCHABLE.includes(k)) });

    return json(200, { ok: true, settings: rows[0] });
  }

  return json(405, { ok: false, error: 'Method not allowed' });
};
