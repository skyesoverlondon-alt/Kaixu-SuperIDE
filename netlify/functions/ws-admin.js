/**
 * ws-admin.js — Workspace administrative actions (owner only)
 *
 * POST { action, workspaceId, newOwnerId? }
 *   action='delete'   → soft-delete (sets deleted_at)
 *   action='transfer' → change owner_user_id + update workspace_members
 *   action='restore'  → clear deleted_at
 */

const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');

function auth(event) {
  const t = getBearerToken(event);
  if (!t) return null;
  try { return verifyToken(t); } catch { return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const payload = auth(event);
  if (!payload) return json(401, { ok: false, error: 'Not authenticated' });
  const userId = payload.sub;

  const parsed = await readJson(event);
  if (!parsed.ok) return parsed.response;
  const { action, workspaceId, newOwnerId } = parsed.data || {};

  if (!action || !workspaceId) return json(400, { ok: false, error: 'action and workspaceId required' });

  try {
    // Verify ownership
    const wsRes = await query(
      `SELECT user_id, owner_user_id, name FROM workspaces WHERE id=$1 AND (deleted_at IS NULL OR $2='restore')`,
      [workspaceId, action]
    );
    const ws = wsRes.rows[0];
    if (!ws) return json(404, { ok: false, error: 'Workspace not found' });

    const effectiveOwner = ws.owner_user_id || ws.user_id;
    if (effectiveOwner !== userId) return json(403, { ok: false, error: 'Only the workspace owner can do this' });

    if (action === 'delete') {
      await query(`UPDATE workspaces SET deleted_at=NOW() WHERE id=$1`, [workspaceId]);
      await query(`INSERT INTO audit_logs (user_id, action, details) VALUES ($1,'workspace.delete',$2::jsonb)`,
        [userId, JSON.stringify({ workspaceId, name: ws.name })]);
      return json(200, { ok: true, message: 'Workspace soft-deleted (recoverable for 30 days)' });
    }

    if (action === 'restore') {
      await query(`UPDATE workspaces SET deleted_at=NULL WHERE id=$1`, [workspaceId]);
      return json(200, { ok: true, message: 'Workspace restored' });
    }

    if (action === 'transfer') {
      if (!newOwnerId) return json(400, { ok: false, error: 'newOwnerId required for transfer' });

      // Check new owner exists
      const newOwnerRes = await query('SELECT id, email FROM users WHERE id=$1', [newOwnerId]);
      if (!newOwnerRes.rows.length) return json(404, { ok: false, error: 'Target user not found' });

      await query(`UPDATE workspaces SET owner_user_id=$1, user_id=$1 WHERE id=$2`, [newOwnerId, workspaceId]);

      // Ensure old owner stays as editor, new owner has owner role
      await query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'editor')
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role='editor'`,
        [workspaceId, userId]
      );
      await query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'owner')
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role='owner'`,
        [workspaceId, newOwnerId]
      );

      await query(`INSERT INTO audit_logs (user_id, action, details) VALUES ($1,'workspace.transfer',$2::jsonb)`,
        [userId, JSON.stringify({ workspaceId, fromUser: userId, toUser: newOwnerId })]);

      return json(200, { ok: true, message: `Workspace transferred to ${newOwnerRes.rows[0].email}` });
    }

    return json(400, { ok: false, error: `Unknown action: ${action}` });
  } catch (err) {
    return json(500, { ok: false, error: err.message });
  }
};
