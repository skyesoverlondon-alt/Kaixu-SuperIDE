/**
 * auth-mfa-disable.js
 * POST { token } — verify current TOTP then disable MFA.
 */

const crypto = require('crypto');
const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');
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

  const bearerToken = getBearerToken(event);
  if (!bearerToken) return json(401, { ok: false, error: 'Not authenticated' });

  let payload;
  try { payload = verifyToken(bearerToken); }
  catch { return json(401, { ok: false, error: 'Invalid token' }); }

  const parsed = await readJson(event);
  if (!parsed.ok) return parsed.response;
  const { token: totpCode } = parsed.data || {};

  try {
    const res = await query(
      'SELECT mfa_secret, mfa_enabled FROM users WHERE id=$1', [payload.sub]
    );
    const user = res.rows[0];
    if (!user) return json(404, { ok: false, error: 'User not found' });
    if (!user.mfa_enabled) return json(400, { ok: false, error: 'MFA is not enabled' });

    if (!verifyTotp(user.mfa_secret, totpCode)) {
      return json(400, { ok: false, error: 'Invalid authenticator code' });
    }

    await query('UPDATE users SET mfa_enabled=false, mfa_secret=null WHERE id=$1', [payload.sub]);
    return json(200, { ok: true, message: 'MFA disabled' });
  } catch (err) {
    return json(500, { ok: false, error: err.message });
  }
};
