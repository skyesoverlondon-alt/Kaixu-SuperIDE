/**
 * POST /kaixu-keys-issue
 * Issue a new KaixuSI customer API key.
 * Requires: valid JWT auth + admin role OR KAIXUSI_ADMIN_SECRET header.
 * Body: { label?, owner_email?, monthly_limit? }
 * Returns: { ok, key_id, key }  — key is shown ONCE, only the hash is stored.
 */

const { query } = require('./_lib/db');
const { requireAuth, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');
const crypto = require('crypto');

function isAdmin(event, decoded) {
  // Option 1: master admin secret header
  const adminSecret = process.env.KAIXUSI_ADMIN_SECRET;
  if (adminSecret) {
    const h = event.headers || {};
    const hval = h['x-kaixusi-admin'] || h['X-KaixuSI-Admin'] || '';
    if (hval === adminSecret) return true;
  }
  // Option 2: JWT role
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

  const { label = '', owner_email = '', monthly_limit = 1000 } = parsed.data || {};

  // Generate a secure key: kxsi_<64 hex chars>
  const rawKey = 'kxsi_' + crypto.randomBytes(32).toString('hex');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  try {
    const res = await query(
      `INSERT INTO kaixu_customer_keys (key_hash, label, owner_email, monthly_limit)
       VALUES ($1, $2, $3, $4)
       RETURNING id, label, owner_email, monthly_limit, created_at`,
      [keyHash, label || null, owner_email || null, Math.max(1, Math.min(100000, Number(monthly_limit) || 1000))]
    );

    return json(201, {
      ok: true,
      message: 'Key issued. Save it now — the plaintext is shown once only.',
      key: rawKey,
      key_id: res.rows[0].id,
      label: res.rows[0].label,
      owner_email: res.rows[0].owner_email,
      monthly_limit: res.rows[0].monthly_limit,
      created_at: res.rows[0].created_at
    });
  } catch (err) {
    console.error('kaixu-keys-issue error:', err);
    return json(500, { ok: false, error: String(err?.message || err) });
  }
};
