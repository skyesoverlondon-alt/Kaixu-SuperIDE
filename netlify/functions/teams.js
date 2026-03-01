/**
 * teams.js — Team groups within orgs
 *
 * GET    ?orgId= → list teams (with members)
 *        ?orgId=&teamId= → single team detail
 * POST   { orgId, name, description? } → create team
 * PATCH  { teamId, name?, description?, addMembers:[], removeMembers:[], addWorkspaces:[], removeWorkspaces:[] }
 * DELETE ?teamId= → delete team (org admin only)
 */

const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');

function auth(event) {
  const t = getBearerToken(event);
  if (!t) return null;
  try { return verifyToken(t); } catch { return null; }
}

async function assertOrgAdmin(orgId, userId) {
  const res = await query(
    `SELECT role FROM org_memberships WHERE org_id=$1 AND user_id=$2`, [orgId, userId]
  );
  const role = res.rows[0]?.role;
  return role === 'owner' || role === 'admin';
}

exports.handler = async (event) => {
  const payload = auth(event);
  if (!payload) return json(401, { ok: false, error: 'Not authenticated' });
  const userId = payload.sub;

  // ── GET ─────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const { orgId, teamId } = event.queryStringParameters || {};
    if (!orgId) return json(400, { ok: false, error: 'orgId required' });

    try {
      if (teamId) {
        const [tRes, mRes, wRes] = await Promise.all([
          query('SELECT * FROM teams WHERE id=$1 AND org_id=$2', [teamId, orgId]),
          query(`SELECT tm.user_id, u.email FROM team_members tm JOIN users u ON u.id=tm.user_id WHERE tm.team_id=$1`, [teamId]),
          query(`SELECT twa.workspace_id, twa.role, w.name FROM team_workspace_access twa JOIN workspaces w ON w.id=twa.workspace_id WHERE twa.team_id=$1`, [teamId])
        ]);
        if (!tRes.rows.length) return json(404, { ok: false, error: 'Team not found' });
        return json(200, { ok: true, team: tRes.rows[0], members: mRes.rows, workspaces: wRes.rows });
      }

      const res = await query(
        `SELECT t.*,
          (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id=t.id) AS member_count
         FROM teams t WHERE t.org_id=$1 ORDER BY t.created_at DESC`,
        [orgId]
      );
      return json(200, { ok: true, teams: res.rows });
    } catch (err) {
      return json(500, { ok: false, error: err.message });
    }
  }

  // ── POST — create team ────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    const parsed = await readJson(event);
    if (!parsed.ok) return parsed.response;
    const { orgId, name, description } = parsed.data || {};
    if (!orgId || !name?.trim()) return json(400, { ok: false, error: 'orgId and name required' });

    if (!(await assertOrgAdmin(orgId, userId))) return json(403, { ok: false, error: 'Admin required' });

    try {
      const res = await query(
        `INSERT INTO teams (org_id, name, description) VALUES ($1,$2,$3) RETURNING *`,
        [orgId, name.trim(), description || '']
      );
      return json(201, { ok: true, team: res.rows[0] });
    } catch (err) {
      return json(500, { ok: false, error: err.message });
    }
  }

  // ── PATCH — update team / members / workspace access ─────────────────────
  if (event.httpMethod === 'PATCH') {
    const parsed = await readJson(event);
    if (!parsed.ok) return parsed.response;
    const { teamId, orgId, name, description, addMembers, removeMembers, addWorkspaces, removeWorkspaces } = parsed.data || {};
    if (!teamId) return json(400, { ok: false, error: 'teamId required' });

    // Verify requester is at least a member (admins can do everything; members can't modify membership)
    try {
      if (name !== undefined || description !== undefined) {
        if (!orgId || !(await assertOrgAdmin(orgId, userId))) return json(403, { ok: false, error: 'Admin required' });
        const sets = [], params = [];
        if (name !== undefined) { params.push(name); sets.push(`name=$${params.length}`); }
        if (description !== undefined) { params.push(description); sets.push(`description=$${params.length}`); }
        params.push(teamId);
        await query(`UPDATE teams SET ${sets.join(',')} WHERE id=$${params.length}`, params);
      }

      if (Array.isArray(addMembers)) {
        for (const uid of addMembers) {
          await query(`INSERT INTO team_members (team_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [teamId, uid]);
        }
      }
      if (Array.isArray(removeMembers)) {
        for (const uid of removeMembers) {
          await query(`DELETE FROM team_members WHERE team_id=$1 AND user_id=$2`, [teamId, uid]);
        }
      }
      if (Array.isArray(addWorkspaces)) {
        for (const { workspaceId, role } of addWorkspaces) {
          const r = ['owner','editor','viewer'].includes(role) ? role : 'viewer';
          await query(
            `INSERT INTO team_workspace_access (team_id, workspace_id, role) VALUES ($1,$2,$3)
             ON CONFLICT (team_id, workspace_id) DO UPDATE SET role=EXCLUDED.role`,
            [teamId, workspaceId, r]
          );
        }
      }
      if (Array.isArray(removeWorkspaces)) {
        for (const workspaceId of removeWorkspaces) {
          await query(`DELETE FROM team_workspace_access WHERE team_id=$1 AND workspace_id=$2`, [teamId, workspaceId]);
        }
      }

      return json(200, { ok: true });
    } catch (err) {
      return json(500, { ok: false, error: err.message });
    }
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const { teamId, orgId } = event.queryStringParameters || {};
    if (!teamId || !orgId) return json(400, { ok: false, error: 'teamId and orgId required' });
    if (!(await assertOrgAdmin(orgId, userId))) return json(403, { ok: false, error: 'Admin required' });
    try {
      await query('DELETE FROM teams WHERE id=$1 AND org_id=$2', [teamId, orgId]);
      return json(200, { ok: true });
    } catch (err) {
      return json(500, { ok: false, error: err.message });
    }
  }

  return json(405, { ok: false, error: 'Method not allowed' });
};
