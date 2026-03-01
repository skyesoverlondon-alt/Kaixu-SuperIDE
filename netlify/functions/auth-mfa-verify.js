/**
 * auth-mfa-verify.js
 * POST { token } — verify TOTP during login (called after password check).
 * Client passes the pending partial token (stored in sessionStorage) + the 6-digit code.
 * Returns a full JWT if valid.
 */

const crypto = require('crypto');
const { query } = require('./_lib/db');
const { issueToken, verifyToken, getBearerToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');

const B32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(str) {
  str = str.replace(/=+$/, '').toUpperCase();
  const lookup = {};
  for (let i = 0; i < B32_CHARS.length; i++) lookup[B32_CHARS[i]] = i;
  let bits = 0, value = 0;
  const out = [];
  for (const ch of str) {
    if (!(ch in lookup)) continue;
    value = (value << 5) | lookup[ch];
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

function verifyTotp(secretB32, token) {
  const t = String(token || '').replace(/\s+/g, '');
  if (t.length !== 6) return false;
  for (const w of [-1, 0, 1]) {
    const counter = Math.floor(Date.now() / 1000 / 30) + w;
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(counter));
    const key = base32Decode(secretB32);
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = ((hmac[offset] & 0x7f) << 24) |
                 ((hmac[offset + 1] & 0xff) << 16) |
                 ((hmac[offset + 2] & 0xff) << 8) |
                 (hmac[offset + 3] & 0xff);
    if (String(code % 1_000_000).padStart(6, '0') === t) return true;
  }
  return false;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  // Client sends the pre-MFA "partial" JWT (short-lived 5-min, mfa_pending:true)
  const bearerToken = getBearerToken(event);
  if (!bearerToken) return json(401, { ok: false, error: 'Missing authorization' });

  let payload;
  try { payload = verifyToken(bearerToken); }
  catch { return json(401, { ok: false, error: 'Invalid or expired pre-auth token' }); }

  if (!payload.mfa_pending) {
    // Already a full token — allow through (no-op for non-MFA users)
    return json(200, { ok: true, token: bearerToken });
  }

  const parsed = await readJson(event);
  if (!parsed.ok) return parsed.response;
  const { token: totpCode } = parsed.data || {};

  try {
    const res = await query(
      'SELECT id, email, mfa_secret, mfa_enabled FROM users WHERE id=$1', [payload.sub]
    );
    const user = res.rows[0];
    if (!user) return json(401, { ok: false, error: 'User not found' });
    if (!user.mfa_enabled || !user.mfa_secret) {
      // MFA not set up — issue full token anyway
      const fullToken = issueToken({ sub: user.id, email: user.email });
      return json(200, { ok: true, token: fullToken });
    }

    if (!verifyTotp(user.mfa_secret, totpCode)) {
      return json(400, { ok: false, error: 'Invalid authenticator code' });
    }

    const fullToken = issueToken({ sub: user.id, email: user.email });
    return json(200, { ok: true, token: fullToken, user: { id: user.id, email: user.email } });
  } catch (err) {
    return json(500, { ok: false, error: err.message });
  }
};
