/*
  auth-reset-confirm.js — Confirm password reset with token
  POST /api/auth-reset-confirm  { token, newPassword }
  ─ Verifies token (not expired, not used), hashes new password, updates user.
*/

const bcrypt    = require('bcryptjs');
const { query }      = require('./_lib/db');
const { logger }     = require('./_lib/logger');
const { parseBody }  = require('./_lib/body');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ok  = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const err = (c, m) => ({ statusCode: c, headers: CORS, body: JSON.stringify({ error: m }) });

const log = logger('auth-reset-confirm');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return err(405, 'Method not allowed');

  let body;
  try { body = parseBody(event); } catch { return err(400, 'Invalid JSON'); }

  const token       = String(body?.token || '').trim();
  const newPassword = String(body?.newPassword || '').trim();

  if (!token)                 return err(400, 'token required');
  if (newPassword.length < 8) return err(400, 'Password must be at least 8 characters');

  try {
    const { rows } = await query(
      `SELECT user_id, expires_at, used_at FROM password_reset_tokens WHERE token = $1`,
      [token]
    );

    if (!rows.length)        return err(400, 'Invalid or expired reset token');
    const { user_id, expires_at, used_at } = rows[0];
    if (used_at)             return err(400, 'This reset link has already been used');
    if (new Date() > new Date(expires_at)) return err(400, 'Reset token has expired');

    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user_id]);
    await query('UPDATE password_reset_tokens SET used_at=now() WHERE token=$1', [token]);

    log.info('password_reset_success', { userId: user_id });
    return ok({ ok: true, message: 'Password updated. You can now log in.' });
  } catch (e) {
    log.error('db_error', { message: e.message });
    return err(500, 'Internal error');
  }
};
