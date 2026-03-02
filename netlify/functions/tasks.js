/**
 * tasks.js — Tasks / Issues mini-system
 *
 * GET  ?orgId=&workspaceId=&status= → list tasks
 * POST { orgId?, workspaceId?, title, description?, priority?, assigneeUserId?, dueDate? } → create
 * PATCH { id, ...fields } → update
 * DELETE ?id= → delete (creator only)
 */

const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');
const { notify } = require('./_lib/notify');
const { checkRateLimit } = require('./_lib/ratelimit');

function auth(event) {
  const t = getBearerToken(event);
  if (!t) return null;
  try { return verifyToken(t); } catch { return null; }
}

const VALID_STATUSES = ['open', 'in_progress', 'done'];
const VALID_PRIORITIES = ['low', 'medium', 'high'];

exports.handler = async (event) => {
  const payload = auth(event);
  if (!payload) return json(401, { ok: false, error: 'Not authenticated' });
  const userId = payload.sub;

  // ── GET ─────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const { orgId, workspaceId, status } = event.queryStringParameters || {};

    const params = [userId];
    let where = `(t.created_by=$1 OR t.assignee_user_id=$1
      OR EXISTS (SELECT 1 FROM org_memberships om WHERE om.org_id=t.org_id AND om.user_id=$1))`;

    if (orgId) where += ` AND t.org_id=$${params.push(orgId)}`;
    if (workspaceId) where += ` AND t.workspace_id=$${params.push(workspaceId)}`;
    if (status && VALID_STATUSES.includes(status)) where += ` AND t.status=$${params.push(status)}`;

    try {
      const res = await query(
        `SELECT t.*, u.email AS assignee_email, c.email AS creator_email
         FROM tasks t
         LEFT JOIN users u ON u.id=t.assignee_user_id
         LEFT JOIN users c ON c.id=t.created_by
         WHERE ${where}
         ORDER BY t.created_at DESC`,
        params
      );
      return json(200, { ok: true, tasks: res.rows });
    } catch (err) {
      return json(500, { ok: false, error: err.message });
    }
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    const parsed = await readJson(event);
    if (!parsed.ok) return parsed.response;
    const { orgId, workspaceId, title, description, priority, assigneeUserId, dueDate } = parsed.data || {};
    if (!title?.trim()) return json(400, { ok: false, error: 'title required' });

    const p = priority && VALID_PRIORITIES.includes(priority) ? priority : 'medium';

    try {
      const res = await query(
        `INSERT INTO tasks (org_id, workspace_id, title, description, priority, assignee_user_id, due_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [orgId || null, workspaceId || null, title.trim(), description || null, p, assigneeUserId || null, dueDate || null, userId]
      );
      const task = res.rows[0];
      // Fire notification (best-effort, non-blocking)
      notify('task.created', { title: task.title, priority: task.priority, workspaceId, orgId },
        { orgId: orgId || null, userId: assigneeUserId || null },
        getBearerToken(event)
      ).catch(() => {});
      return json(201, { ok: true, task });
    } catch (err) {
      return json(500, { ok: false, error: err.message });
    }
  }

  // ── PATCH ─────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    const parsed = await readJson(event);
    if (!parsed.ok) return parsed.response;
    const { id, title, description, status, priority, assigneeUserId, dueDate } = parsed.data || {};
    if (!id) return json(400, { ok: false, error: 'id required' });

    const sets = [], params = [];
    if (title !== undefined) { params.push(title); sets.push(`title=$${params.length}`); }
    if (description !== undefined) { params.push(description); sets.push(`description=$${params.length}`); }
    if (status && VALID_STATUSES.includes(status)) { params.push(status); sets.push(`status=$${params.length}`); }
    if (priority && VALID_PRIORITIES.includes(priority)) { params.push(priority); sets.push(`priority=$${params.length}`); }
    if (assigneeUserId !== undefined) { params.push(assigneeUserId || null); sets.push(`assignee_user_id=$${params.length}`); }
    if (dueDate !== undefined) { params.push(dueDate || null); sets.push(`due_date=$${params.length}`); }
    if (!sets.length) return json(400, { ok: false, error: 'No fields to update' });

    params.push(id);
    try {
      const res = await query(
        `UPDATE tasks SET ${sets.join(',')} WHERE id=$${params.length} RETURNING *`, params
      );
      if (!res.rows.length) return json(404, { ok: false, error: 'Task not found' });
      return json(200, { ok: true, task: res.rows[0] });
    } catch (err) {
      return json(500, { ok: false, error: err.message });
    }
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const { id } = event.queryStringParameters || {};
    if (!id) return json(400, { ok: false, error: 'id required' });
    try {
      await query('DELETE FROM tasks WHERE id=$1 AND created_by=$2', [id, userId]);
      return json(200, { ok: true });
    } catch (err) {
      return json(500, { ok: false, error: err.message });
    }
  }

  return json(405, { ok: false, error: 'Method not allowed' });
};
