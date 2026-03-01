/**
 * reviews.js — Code review requests
 *
 * GET  ?workspaceId= → list reviews
 * POST { workspaceId, title, description?, commitIds[] } → create review
 * PATCH { id, status?, comment?, decision? } → update status or add a comment
 * DELETE ?id= → close/delete (creator only)
 */

const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');
const { notify } = require('./_lib/notify');

function auth(event) {
  const t = getBearerToken(event);
  if (!t) return null;
  try { return verifyToken(t); } catch { return null; }
}

const VALID_STATUSES = ['pending', 'approved', 'changes_requested', 'closed'];

exports.handler = async (event) => {
  const payload = auth(event);
  if (!payload) return json(401, { ok: false, error: 'Not authenticated' });
  const userId = payload.sub;

  // ── GET ─────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const { workspaceId, id } = event.queryStringParameters || {};

    // Single review with its comments
    if (id) {
      try {
        const [rRes, cRes] = await Promise.all([
          query(`SELECT r.*, u.email AS creator_email FROM reviews r JOIN users u ON u.id=r.created_by WHERE r.id=$1`, [id]),
          query(`SELECT rc.*, u.email AS author_email FROM review_comments rc JOIN users u ON u.id=rc.user_id WHERE rc.review_id=$1 ORDER BY rc.created_at ASC`, [id])
        ]);
        if (!rRes.rows.length) return json(404, { ok: false, error: 'Review not found' });
        return json(200, { ok: true, review: rRes.rows[0], comments: cRes.rows });
      } catch (err) {
        return json(500, { ok: false, error: err.message });
      }
    }

    if (!workspaceId) return json(400, { ok: false, error: 'workspaceId required' });
    try {
      const res = await query(
        `SELECT r.*, u.email AS creator_email FROM reviews r
         JOIN users u ON u.id=r.created_by
         WHERE r.workspace_id=$1 ORDER BY r.created_at DESC`,
        [workspaceId]
      );
      return json(200, { ok: true, reviews: res.rows });
    } catch (err) {
      return json(500, { ok: false, error: err.message });
    }
  }

  // ── POST — create review ──────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    const parsed = await readJson(event);
    if (!parsed.ok) return parsed.response;
    const { workspaceId, title, description, commitIds } = parsed.data || {};
    if (!workspaceId || !title?.trim()) return json(400, { ok: false, error: 'workspaceId and title required' });

    try {
      const res = await query(
        `INSERT INTO reviews (workspace_id, title, description, commit_ids, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [workspaceId, title.trim(), description || '', commitIds || [], userId]
      );
      const review = res.rows[0];
      notify('review.requested', { workspaceId, title: review.title },
        { userId }, getBearerToken(event)).catch(() => {});
      return json(201, { ok: true, review });
    } catch (err) {
      return json(500, { ok: false, error: err.message });
    }
  }

  // ── PATCH — update status or add comment ──────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    const parsed = await readJson(event);
    if (!parsed.ok) return parsed.response;
    const { id, status, comment, decision } = parsed.data || {};
    if (!id) return json(400, { ok: false, error: 'id required' });

    try {
      // Update review status if provided
      if (status && VALID_STATUSES.includes(status)) {
        await query('UPDATE reviews SET status=$1 WHERE id=$2', [status, id]);
      }

      // Add a comment/decision if provided
      if (comment?.trim()) {
        const validDecision = ['approve', 'request_changes'].includes(decision) ? decision : null;
        await query(
          `INSERT INTO review_comments (review_id, user_id, content, decision)
           VALUES ($1,$2,$3,$4)`,
          [id, userId, comment.trim(), validDecision]
        );

        // Auto-update review status based on decision
        if (validDecision === 'approve') {
          await query(`UPDATE reviews SET status='approved' WHERE id=$1 AND status='pending'`, [id]);
        } else if (validDecision === 'request_changes') {
          await query(`UPDATE reviews SET status='changes_requested' WHERE id=$1`, [id]);
        }
      }

      const r = await query(`SELECT * FROM reviews WHERE id=$1`, [id]);
      return json(200, { ok: true, review: r.rows[0] });
    } catch (err) {
      return json(500, { ok: false, error: err.message });
    }
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const { id } = event.queryStringParameters || {};
    if (!id) return json(400, { ok: false, error: 'id required' });
    try {
      await query('DELETE FROM reviews WHERE id=$1 AND created_by=$2', [id, userId]);
      return json(200, { ok: true });
    } catch (err) {
      return json(500, { ok: false, error: err.message });
    }
  }

  return json(405, { ok: false, error: 'Method not allowed' });
};
