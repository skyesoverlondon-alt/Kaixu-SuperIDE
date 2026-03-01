/**
 * POST /kaixu-keys-revoke
 * Revoke or reactivate a KaixuSI customer API key.
 * Requires: valid JWT auth + admin access.
 * Body: { id, action? }  — action: "revoke" (default) | "restore"
 */

const { query } = require('./_lib/db');
const { requireAuth, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');

function isAdmin(event, decoded) {
  const adminSecret = process.env.KAIXUSI_ADMIN_SECRET;
  if (adminSecret) {
    const h = event.headers || {};
    const hval = h['x-kaixusi-admin'] || h['X-KaixuSI-Admin'] || '';
    if (hval === adminSecret) return true;
  }
  if (decoded?.role === 'admin' || decoded?.role === 'owner') return true;
  return false;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const auth = requireAuth(event);
  if (!auth.ok) return auth.response;

  if (!isAdmin(event, auth.decoded)) {
    return json(403, { ok: false, error: 'Admin access required' });
  }

  const parsed = await readJson(event);
  if (!parsed.ok) return parsed.response;

  const { id, action = 'revoke' } = parsed.data || {};
  if (!id) return json(400, { ok: false, error: 'Missing key id' });

  try {
    let row;
    if (action === 'restore') {
      const res = await query(
        `UPDATE kaixu_customer_keys
         SET revoked_at = NULL, is_active = true
         WHERE id = $1
         RETURNING id, label, owner_email, is_active, revoked_at`,
        [id]
      );
      row = res.rows[0];
      if (!row) return json(404, { ok: false, error: 'Key not found' });
      return json(200, { ok: true, action: 'restored', key: row });
    } else {
      const res = await query(
        `UPDATE kaixu_customer_keys
         SET revoked_at = now(), is_active = false
         WHERE id = $1
         RETURNING id, label, owner_email, is_active, revoked_at`,
        [id]
      );
      row = res.rows[0];
      if (!row) return json(404, { ok: false, error: 'Key not found' });
      return json(200, { ok: true, action: 'revoked', key: row });
    }
  } catch (err) {
    console.error('kaixu-keys-revoke error:', err);
    return json(500, { ok: false, error: String(err?.message || err) });
  }
};
