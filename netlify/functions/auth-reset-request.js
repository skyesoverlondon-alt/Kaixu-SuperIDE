/*
  auth-reset-request.js — Initiate password reset
  POST /api/auth-reset-request  { email }
  ─ Generates a short-lived token, stores in DB.
  ─ In production, send via email; for now returns the token in non-prod so devs can test.
  ─ Rate-limited: 3 requests per email per 15 minutes.
*/

const crypto   = require('crypto');
const { query }          = require('./_lib/db');
const { checkRateLimit } = require('./_lib/ratelimit');
const { logger }         = require('./_lib/logger');
const { parseBody }      = require('./_lib/body');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ok  = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const err = (c, m) => ({ statusCode: c, headers: CORS, body: JSON.stringify({ error: m }) });

const log = logger('auth-reset-request');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return err(405, 'Method not allowed');

  let body;
  try { body = parseBody(event); } catch { return err(400, 'Invalid JSON'); }
  const email = String(body?.email || '').trim().toLowerCase();
  if (!email) return err(400, 'email required');

  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';

  // Rate limit by email (3 per 15 min)
  const limited = await checkRateLimit(email, 'auth-reset-request', { maxHits: 3, windowSecs: 900 });
  if (limited) {
    log.warn('rate_limited', { email, ip });
    return err(429, 'Too many reset requests. Try again in 15 minutes.');
  }

  try {
    const { rows } = await query('SELECT id FROM users WHERE email=$1', [email]);
    // Always respond OK — don't leak whether email exists
    if (!rows.length) {
      log.info('reset_no_user', { email });
      return ok({ ok: true, message: 'If that email is registered, a reset link has been sent.' });
    }

    const userId = rows[0].id;
    const token  = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET token=$2, expires_at=$3, used_at=NULL`,
      [userId, token, expiresAt]
    );

    log.info('reset_token_created', { email, userId });

    const isProd = process.env.NODE_ENV === 'production' && process.env.SEND_EMAIL_API;
    if (!isProd) {
      // Dev: return token directly so it can be copy-pasted or auto-filled
      return ok({ ok: true, dev_token: token, message: 'Dev mode: use this token to reset your password.' });
    }

    // Production: TODO integrate SendGrid / Resend / Postmark here
    // await sendResetEmail(email, token);
    return ok({ ok: true, message: 'If that email is registered, a reset link has been sent.' });
  } catch (e) {
    log.error('db_error', { message: e.message });
    return err(500, 'Internal error');
  }
};
