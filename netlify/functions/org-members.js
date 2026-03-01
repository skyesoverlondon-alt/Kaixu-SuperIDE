'use strict';
const { query } = require('./_lib/db');
const { requireAuth } = require('./_lib/auth');
const { readBody } = require('./_lib/body');
const logger = require('./_lib/logger')('org-members');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, PATCH, DELETE, OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  try {
    const user = await requireAuth(event);

    // ── GET — list members for an org ─────────────────────────────────────
    if (event.httpMethod === 'GET') {
      const orgId = event.queryStringParameters?.orgId;
      if (!orgId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'orgId required' }) };

      // Caller must be a member of the org
      const selfRow = await query(
        `SELECT role FROM org_memberships WHERE org_id=$1 AND user_id=$2`,
        [orgId, user.userId]
      );
      if (!selfRow.rows.length) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Not a member of this org' }) };

      const rows = await query(
        `SELECT om.user_id AS "userId", u.email, om.role, om.created_at AS "joinedAt"
         FROM org_memberships om
         JOIN users u ON u.id = om.user_id
         WHERE om.org_id = $1
         ORDER BY om.created_at ASC`,
        [orgId]
      );

      logger.info({ orgId, count: rows.rows.length }, 'org members listed');
      return { statusCode: 200, headers, body: JSON.stringify({ members: rows.rows }) };
    }

    // ── PATCH — change a member's role ─────────────────────────────────────
    if (event.httpMethod === 'PATCH') {
      const body = await readBody(event);
      const { orgId, userId, role } = body;
      if (!orgId || !userId || !role) return { statusCode: 400, headers, body: JSON.stringify({ error: 'orgId, userId, role required' }) };
      const VALID_ROLES = ['admin', 'member', 'viewer'];
      if (!VALID_ROLES.includes(role)) return { statusCode: 400, headers, body: JSON.stringify({ error: `role must be one of ${VALID_ROLES.join(', ')}` }) };

      // Must be owner or admin
      const selfRow = await query(
        `SELECT role FROM org_memberships WHERE org_id=$1 AND user_id=$2`,
        [orgId, user.userId]
      );
      if (!selfRow.rows.length || !['owner', 'admin'].includes(selfRow.rows[0].role)) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin or owner required' }) };
      }

      // Can't demote owners
      const targetRow = await query(
        `SELECT role FROM org_memberships WHERE org_id=$1 AND user_id=$2`,
        [orgId, userId]
      );
      if (!targetRow.rows.length) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Member not found' }) };
      if (targetRow.rows[0].role === 'owner') return { statusCode: 403, headers, body: JSON.stringify({ error: 'Cannot change owner role' }) };

      await query(
        `UPDATE org_memberships SET role=$1 WHERE org_id=$2 AND user_id=$3`,
        [role, orgId, userId]
      );

      // Audit log
      await query(
        `INSERT INTO audit_logs (org_id, user_id, action, metadata)
         VALUES ($1, $2, 'member.role_changed', $3::jsonb)`,
        [orgId, user.userId, JSON.stringify({ targetUserId: userId, newRole: role })]
      ).catch(() => {});

      logger.info({ orgId, targetUserId: userId, newRole: role }, 'member role changed');
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── DELETE — remove a member ──────────────────────────────────────────
    if (event.httpMethod === 'DELETE') {
      const body = await readBody(event);
      const { orgId, userId } = body;
      if (!orgId || !userId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'orgId and userId required' }) };

      // Must be owner or admin; can't remove owner
      const selfRow = await query(
        `SELECT role FROM org_memberships WHERE org_id=$1 AND user_id=$2`,
        [orgId, user.userId]
      );
      if (!selfRow.rows.length || !['owner', 'admin'].includes(selfRow.rows[0].role)) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin or owner required' }) };
      }

      // Allow self-removal (leaving an org)
      if (userId !== user.userId) {
        const targetRow = await query(
          `SELECT role FROM org_memberships WHERE org_id=$1 AND user_id=$2`,
          [orgId, userId]
        );
        if (!targetRow.rows.length) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Member not found' }) };
        if (targetRow.rows[0].role === 'owner') return { statusCode: 403, headers, body: JSON.stringify({ error: 'Cannot remove org owner' }) };
      }

      await query(
        `DELETE FROM org_memberships WHERE org_id=$1 AND user_id=$2`,
        [orgId, userId]
      );

      // Audit log
      await query(
        `INSERT INTO audit_logs (org_id, user_id, action, metadata)
         VALUES ($1, $2, 'member.removed', $3::jsonb)`,
        [orgId, user.userId, JSON.stringify({ removedUserId: userId })]
      ).catch(() => {});

      logger.info({ orgId, removedUserId: userId }, 'member removed');
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (e) {
    if (e.status) return { statusCode: e.status, headers, body: JSON.stringify({ error: e.message }) };
    logger.error(e, 'org-members error');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal error' }) };
  }
};
