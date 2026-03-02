/**
 * comments.js
 * File/line-level commenting for workspaces.
 *
 * GET  ?workspaceId=&filePath= → list comments
 * POST { workspaceId, filePath, lineNumber?, content } → create
 * PATCH { id, resolved } → resolve/unresolve
 * DELETE ?id= → delete (owner or resolver)
 */

const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');
const { checkRateLimit } = require('./_lib/ratelimit');

function auth(event) {
  const t = getBearerToken(event);
  if (!t) return null;
  try { return verifyToken(t); } catch { return null; }
}

exports.handler = async (event) => {
  const payload = auth(event);
  if (!payload) return json(401, { ok: false, error: 'Not authenticated' });
  const userId = payload.sub;

  // ── GET ─────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const { workspaceId, filePath } = event.queryStringParameters || {};
    if (!workspaceId) return json(400, { ok: false, error: 'workspaceId required' });

    // Verify workspace access
    const access = await query(
      `SELECT 1 FROM workspaces w
       LEFT JOIN workspace_members wm ON wm.workspace_id=w.id AND wm.user_id=$2
       WHERE w.id=$1 AND (w.user_id=$2 OR wm.user_id IS NOT NULL)`,
      [workspaceId, userId]
    );
    if (!access.rows.length) return json(403, { ok: false, error: 'Forbidden' });

    const params = [workspaceId];
    let sql = `SELECT fc.*, u.email AS author_email
               FROM file_comments fc
               JOIN users u ON u.id = fc.user_id
               WHERE fc.workspace_id=$1`;
    if (filePath) { sql += ` AND fc.file_path=$${params.push(filePath)}`; }
    sql += ' ORDER BY fc.created_at ASC';

    try {
      const res = await query(sql, params);
      return json(200, { ok: true, comments: res.rows });
    } catch (err) {
      return json(500, { ok: false, error: err.message });
    }
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    const parsed = await readJson(event);
    if (!parsed.ok) return parsed.response;
    const { workspaceId, filePath, lineNumber, content } = parsed.data || {};
    if (!workspaceId || !filePath || !content?.trim()) {
      return json(400, { ok: false, error: 'workspaceId, filePath, and content required' });
    }

    const access = await query(
      `SELECT 1 FROM workspaces w
       LEFT JOIN workspace_members wm ON wm.workspace_id=w.id AND wm.user_id=$2
       WHERE w.id=$1 AND (w.user_id=$2 OR wm.user_id IS NOT NULL)`,
      [workspaceId, userId]
    );
    if (!access.rows.length) return json(403, { ok: false, error: 'Forbidden' });

    try {
      const res = await query(
        `INSERT INTO file_comments (workspace_id, file_path, line_number, content, user_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [workspaceId, filePath, lineNumber || null, content.trim(), userId]
      );
      return json(201, { ok: true, comment: res.rows[0] });
    } catch (err) {
      return json(500, { ok: false, error: err.message });
    }
  }

  // ── PATCH — resolve/unresolve ─────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    const parsed = await readJson(event);
    if (!parsed.ok) return parsed.response;
    const { id, resolved } = parsed.data || {};
    if (!id) return json(400, { ok: false, error: 'id required' });

    try {
      const resolvedAt = resolved ? new Date().toISOString() : null;
      const res = await query(
        `UPDATE file_comments SET resolved_at=$1 WHERE id=$2 RETURNING *`,
        [resolvedAt, id]
      );
      if (!res.rows.length) return json(404, { ok: false, error: 'Comment not found' });
      return json(200, { ok: true, comment: res.rows[0] });
    } catch (err) {
      return json(500, { ok: false, error: err.message });
    }
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const { id } = event.queryStringParameters || {};
    if (!id) return json(400, { ok: false, error: 'id required' });

    try {
      await query(`DELETE FROM file_comments WHERE id=$1 AND user_id=$2`, [id, userId]);
      return json(200, { ok: true });
    } catch (err) {
      return json(500, { ok: false, error: err.message });
    }
  }

  return json(405, { ok: false, error: 'Method not allowed' });
};
