// kaixu-key-issue.js
// POST — issue or rotate a KaixuSI API key for the authenticated user.
// Keys are prefixed `ksk_` and stored as SHA-256 hashes.
// Returns the plaintext key ONCE — store it, it won't be shown again.
//
// Body: { label?: string, rotate?: boolean }
// Auth: Bearer <user JWT>  OR  caller is admin issuing for { targetUserId }

const crypto = require('crypto');
const { requireAuth } = require('./_lib/auth');
const { query }       = require('./_lib/db');
const { json }        = require('./_lib/body');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function hashKey(plaintext) {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

function generateKey() {
  const rand = crypto.randomBytes(36).toString('base64url');
  return `ksk_${rand}`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method not allowed' };

  const auth = requireAuth(event);
  if (!auth.ok) return { ...auth.response, headers: { ...auth.response.headers, ...CORS } };

  const callerId = auth.decoded.userId || auth.decoded.sub;
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  // Admin can issue for someone else
  const isAdmin = auth.decoded.role === 'admin' || auth.decoded.admin === true;
  const targetUserId = (isAdmin && body.targetUserId) ? body.targetUserId : callerId;
  const label = (body.label || 'My KaixuSI Key').slice(0, 80);
  const rotate = !!body.rotate;

  // Ensure user exists
  const userQ = await query('SELECT id, email FROM users WHERE id=$1', [targetUserId]);
  if (!userQ.rows.length) return json(404, { ok: false, error: 'User not found' }, CORS);
  const user = userQ.rows[0];

  if (rotate) {
    // Revoke all existing active keys for this user
    await query(
      `UPDATE kaixu_keys SET status='revoked', revoked_at=now() WHERE user_id=$1 AND status='active'`,
      [targetUserId]
    );
  } else {
    // Check if they already have an active key (non-admin path: one key per user)
    const existing = await query(
      `SELECT id FROM kaixu_keys WHERE user_id=$1 AND status='active' LIMIT 1`,
      [targetUserId]
    );
    if (existing.rows.length && !isAdmin) {
      return json(409, {
        ok: false,
        error: 'Active key already exists. Pass rotate:true to replace it.',
      }, CORS);
    }
  }

  const plaintext = generateKey();
  const hash      = hashKey(plaintext);

  await query(
    `INSERT INTO kaixu_keys (user_id, key_hash, label, status, created_at)
     VALUES ($1, $2, $3, 'active', now())`,
    [targetUserId, hash, label]
  );

  return json(200, {
    ok:        true,
    key:       plaintext,       // shown ONCE — store it
    label,
    user_id:   targetUserId,
    email:     user.email,
    note:      'This key will not be shown again. Store it securely.',
  }, CORS);
};
