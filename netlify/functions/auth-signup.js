const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query } = require('./_lib/db');
const { issueToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');
const { checkRateLimit } = require('./_lib/ratelimit');
const logger = require('./_lib/logger');

const log = logger('auth-signup');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const parsed = await readJson(event);
  if (!parsed.ok) return parsed.response;

  const { email, password, website, phone_number } = parsed.data || {};

  // Honeypot: bots fill hidden fields, real users don't
  if (website || phone_number) {
    // Silently accept but don't create account
    return json(200, { ok: true, token: 'honeypot', user: { email: '' }, org: {}, workspace: {} });
  }

  const e = String(email || '').trim().toLowerCase();
  const p = String(password || '');
  if (!e || !e.includes('@')) return json(400, { ok: false, error: 'Invalid email' });
  if (p.length < 8) return json(400, { ok: false, error: 'Password must be 8+ characters' });

  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';

  // Rate limit: 5 signups per IP per hour
  const ipLimited = await checkRateLimit(ip, 'auth-signup-ip', { maxHits: 5, windowSecs: 3600 });
  if (ipLimited) {
    log.warn('signup_rate_limited', { ip });
    return json(429, { ok: false, error: 'Too many accounts created from this IP. Try again later.' });
  }

  try {
    const hash = await bcrypt.hash(p, 12);
    const userRes = await query(
      'insert into users(email, password_hash) values($1,$2) returning id, email, created_at',
      [e, hash]
    );
    const user = userRes.rows[0];

    // Create default org + membership
    const orgRes = await query(
      'insert into orgs(name, created_by) values($1,$2) returning id, name, created_at',
      ['Personal Org', user.id]
    );
    const org = orgRes.rows[0];
    await query(
      'insert into org_memberships(org_id, user_id, role) values($1,$2,$3) on conflict do nothing',
      [org.id, user.id, 'owner']
    );

    // Create default workspace within org
    const wsRes = await query(
      'insert into workspaces(user_id, org_id, created_by, name, files) values($1,$2,$3,$4,$5) returning id, name, files, updated_at',
      [user.id, org.id, user.id, 'Default Workspace', JSON.stringify({})]
    );
    const workspace = wsRes.rows[0];

    // Generate email verification token
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await query(
      `insert into email_verifications(user_id, token, expires_at) values($1,$2,$3) on conflict(user_id) do update set token=excluded.token, expires_at=excluded.expires_at`,
      [user.id, verifyToken, verifyExpires]
    ).catch(() => {}); // table may not exist yet

    const verifyUrl = `${process.env.URL || 'https://localhost'}/.netlify/functions/auth-verify-email?token=${verifyToken}`;
    // TODO: send email in production via SEND_EMAIL_API

    const token = issueToken({ sub: user.id, email: user.email });
    log.info('signup_success', { userId: user.id, ip });
    return json(200, { ok: true, token, user, org, workspace, dev_verify_url: verifyUrl });
  } catch (err) {
    const msg = String(err?.message || err);
    log.error('signup_error', { message: msg, ip });
    if (msg.toLowerCase().includes('unique')) {
      return json(409, { ok: false, error: 'Email already exists' });
    }
    if (msg.toLowerCase().includes('jwt_secret') || msg.toLowerCase().includes('missing/weak')) {
      return json(500, { ok: false, error: 'Server misconfiguration: JWT_SECRET not set' });
    }
    if (msg.toLowerCase().includes('database_url') || msg.toLowerCase().includes('connect')) {
      return json(500, { ok: false, error: 'Server misconfiguration: database not reachable' });
    }
    return json(500, { ok: false, error: 'Signup failed: ' + msg });
  }
};

  const parsed = await readJson(event);
  if (!parsed.ok) return parsed.response;

  const { email, password } = parsed.data || {};
  const e = String(email || '').trim().toLowerCase();
  const p = String(password || '');
  if (!e || !e.includes('@')) return json(400, { ok: false, error: 'Invalid email' });
  if (p.length < 8) return json(400, { ok: false, error: 'Password must be 8+ characters' });

  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';

  // Rate limit: 5 signups per IP per hour
  const ipLimited = await checkRateLimit(ip, 'auth-signup-ip', { maxHits: 5, windowSecs: 3600 });
  if (ipLimited) {
    log.warn('signup_rate_limited', { ip });
    return json(429, { ok: false, error: 'Too many accounts created from this IP. Try again later.' });
  }

  try {
    const hash = await bcrypt.hash(p, 12);
    const userRes = await query(
      'insert into users(email, password_hash) values($1,$2) returning id, email, created_at',
      [e, hash]
    );
    const user = userRes.rows[0];

    // Create default org + membership
    const orgRes = await query(
      'insert into orgs(name, created_by) values($1,$2) returning id, name, created_at',
      ['Personal Org', user.id]
    );
    const org = orgRes.rows[0];
    await query(
      'insert into org_memberships(org_id, user_id, role) values($1,$2,$3) on conflict do nothing',
      [org.id, user.id, 'owner']
    );

    // Create default workspace within org
    const wsRes = await query(
      'insert into workspaces(user_id, org_id, created_by, name, files) values($1,$2,$3,$4,$5) returning id, name, files, updated_at',
      [user.id, org.id, user.id, 'Default Workspace', JSON.stringify({})]
    );
    const workspace = wsRes.rows[0];

    const token = issueToken({ sub: user.id, email: user.email });
    log.info('signup_success', { userId: user.id, ip });
    return json(200, { ok: true, token, user, org, workspace });
  } catch (err) {
    const msg = String(err?.message || err);
    log.error('signup_error', { message: msg, ip });
    if (msg.toLowerCase().includes('unique')) {
      return json(409, { ok: false, error: 'Email already exists' });
    }
    if (msg.toLowerCase().includes('jwt_secret') || msg.toLowerCase().includes('missing/weak')) {
      return json(500, { ok: false, error: 'Server misconfiguration: JWT_SECRET not set' });
    }
    if (msg.toLowerCase().includes('database_url') || msg.toLowerCase().includes('connect')) {
      return json(500, { ok: false, error: 'Server misconfiguration: database not reachable' });
    }
    return json(500, { ok: false, error: 'Signup failed: ' + msg });
  }
};
