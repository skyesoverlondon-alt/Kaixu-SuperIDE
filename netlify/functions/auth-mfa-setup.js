/**
 * auth-mfa-setup.js
 * GET  → generate TOTP secret + QR URL (idempotent — returns existing if already set)
 * POST → { token } verify first code to confirm setup and enable MFA
 */

const crypto = require('crypto');
const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');

// ─── RFC 4648 Base32 ─────────────────────────────────────────────────────────
const B32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_CHARS[(value << (5 - bits)) & 31];
  while (out.length % 8 !== 0) out += '=';
  return out;
}

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

// ─── RFC 6238 TOTP ────────────────────────────────────────────────────────────
function totp(secretB32, window = 0) {
  const counter = Math.floor(Date.now() / 1000 / 30) + window;
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const key = base32Decode(secretB32);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) |
               ((hmac[offset + 1] & 0xff) << 16) |
               ((hmac[offset + 2] & 0xff) << 8) |
               (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

function verifyTotp(secretB32, token) {
  const t = String(token || '').replace(/\s+/g, '');
  if (t.length !== 6) return false;
  // Allow ±1 window (90 s total drift)
  for (const w of [-1, 0, 1]) {
    if (totp(secretB32, w) === t) return true;
  }
  return false;
}

exports.handler = async (event) => {
  const bearerToken = getBearerToken(event);
  if (!bearerToken) return json(401, { ok: false, error: 'Not authenticated' });

  let payload;
  try { payload = verifyToken(bearerToken); }
  catch { return json(401, { ok: false, error: 'Invalid token' }); }

  const userId = payload.sub;

  // ── GET — return (or generate) secret ─────────────────────────────────────
  if (event.httpMethod === 'GET') {
    try {
      const res = await query(
        'SELECT email, mfa_secret, mfa_enabled FROM users WHERE id=$1', [userId]
      );
      const user = res.rows[0];
      if (!user) return json(404, { ok: false, error: 'User not found' });

      let secret = user.mfa_secret;
      if (!secret) {
        secret = base32Encode(crypto.randomBytes(20));
        await query('UPDATE users SET mfa_secret=$1 WHERE id=$2', [secret, userId]);
      }

      const issuer = 'kAIxU';
      const label = encodeURIComponent(`${issuer}:${user.email}`);
      const qrUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

      return json(200, {
        ok: true,
        secret,
        qrUrl,
        mfaEnabled: !!user.mfa_enabled
      });
    } catch (err) {
      return json(500, { ok: false, error: err.message });
    }
  }

  // ── POST — verify first token to confirm + enable ──────────────────────────
  if (event.httpMethod === 'POST') {
    const parsed = await readJson(event);
    if (!parsed.ok) return parsed.response;
    const { token } = parsed.data || {};

    try {
      const res = await query('SELECT mfa_secret FROM users WHERE id=$1', [userId]);
      const user = res.rows[0];
      if (!user || !user.mfa_secret) return json(400, { ok: false, error: 'Run GET first to generate secret' });

      if (!verifyTotp(user.mfa_secret, token)) {
        return json(400, { ok: false, error: 'Invalid TOTP code' });
      }

      await query('UPDATE users SET mfa_enabled=true WHERE id=$1', [userId]);
      return json(200, { ok: true, message: 'MFA enabled successfully' });
    } catch (err) {
      return json(500, { ok: false, error: err.message });
    }
  }

  return json(405, { ok: false, error: 'Method not allowed' });
};
