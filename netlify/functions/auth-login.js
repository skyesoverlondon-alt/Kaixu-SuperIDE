const bcrypt = require('bcryptjs');
const { query } = require('./_lib/db');
const { issueToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');
const { checkRateLimit } = require('./_lib/ratelimit');
const { logger } = require('./_lib/logger');

const log = logger('auth-login');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const parsed = await readJson(event);
  if (!parsed.ok) return parsed.response;

  const { email, password } = parsed.data || {};
  const e = String(email || '').trim().toLowerCase();
  const p = String(password || '');
  if (!e || !p) return json(400, { ok: false, error: 'Missing email or password' });

  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';

  // Rate limit: 10 attempts per IP per 5 min, 5 per email per 5 min
  const ipLimited = await checkRateLimit(ip, 'auth-login-ip', { maxHits: 10, windowSecs: 300 });
  if (ipLimited) {
    log.warn('rate_limited_ip', { ip });
    return json(429, { ok: false, error: 'Too many login attempts. Please wait 5 minutes.' });
  }
  const emailLimited = await checkRateLimit(e, 'auth-login-email', { maxHits: 5, windowSecs: 300 });
  if (emailLimited) {
    log.warn('rate_limited_email', { email: e, ip });
    return json(429, { ok: false, error: 'Too many login attempts for this account.' });
  }

  try {
    const res = await query('select id, email, password_hash from users where email=$1', [e]);
    const user = res.rows[0];
    if (!user) {
      log.warn('login_no_user', { email: e, ip });
      return json(401, { ok: false, error: 'Invalid credentials' });
    }
    const match = await bcrypt.compare(p, user.password_hash);
    if (!match) {
      log.warn('login_bad_password', { email: e, ip });
      return json(401, { ok: false, error: 'Invalid credentials' });
    }

    const token = issueToken({ sub: user.id, email: user.email });
    log.info('login_success', { userId: user.id, ip });
    return json(200, { ok: true, token, user: { id: user.id, email: user.email } });
  } catch (err) {
    log.error('db_error', { message: err.message });
    return json(500, { ok: false, error: 'Login failed' });
  }
};
