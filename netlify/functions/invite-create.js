const crypto = require('crypto');
const { query } = require('./_lib/db');
const { requireAuth } = require('./_lib/auth');
const { json, readJson } = require('./_lib/body');
const logger = require('./_lib/logger')('invite-create');
const { checkRateLimit } = require('./_lib/ratelimit');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
  let userId;
  try { ({ userId } = requireAuth(event)); } catch (e) { return json(401, { ok: false, error: e.message }); }

  // Rate limit: 20 invites/hour per user
  const limited = await checkRateLimit(userId, 'invite-create', { maxHits: 20, windowSecs: 3600 });
  if (limited) return json(429, { ok: false, error: 'Too many invites. Limit: 20/hour.', retryAfter: 3600 });

  let body;
  try { body = await readJson(event); } catch { return json(400, { ok: false, error: 'Invalid JSON' }); }
  const { orgId, email, role = 'member' } = body;

  if (!orgId || !email) return json(400, { ok: false, error: 'orgId and email required' });
  if (!['admin','member','viewer'].includes(role)) return json(400, { ok: false, error: 'Invalid role' });

  // Must be owner or admin
  const mem = await query(
    `select role from org_memberships where org_id=$1 and user_id=$2`,
    [orgId, userId]
  );
  if (!mem.rows[0] || !['owner','admin'].includes(mem.rows[0].role)) {
    return json(403, { ok: false, error: 'Must be owner or admin to invite' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await query(
    `insert into org_invites(org_id, email, role, token, created_by, expires_at)
     values($1,$2,$3,$4,$5,$6)
     on conflict do nothing`,
    [orgId, email.toLowerCase().trim(), role, token, userId, expiresAt]
  );

  logger.info('invite_created', { orgId, email, role, createdBy: userId });

  const inviteUrl = `${process.env.URL || 'https://localhost'}/.netlify/functions/invite-accept?token=${token}`;

  // In production with SEND_EMAIL_API: send email with inviteUrl
  // For now, return the URL (dev mode + in-app copy)
  return json(200, {
    ok: true,
    token,
    inviteUrl,
    message: `Invite created for ${email}. Share the invite link.`
  });
};
