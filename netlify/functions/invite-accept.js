const { query } = require('./_lib/db');
const { requireAuth } = require('./_lib/auth');
const { json } = require('./_lib/body');
const logger = require('./_lib/logger')('invite-accept');

exports.handler = async (event) => {
  // GET: validate token and show info. POST: actually accept (requires auth)
  const token = event.queryStringParameters?.token || null;
  let body = {};
  if (event.httpMethod === 'POST') {
    try { body = JSON.parse(event.body || '{}'); } catch {}
  }
  const tok = token || body.token;
  if (!tok) return json(400, { ok: false, error: 'token required' });

  // Look up invite
  const inv = await query(
    `select i.*, o.name as org_name from org_invites i
     join orgs o on o.id=i.org_id
     where i.token=$1`,
    [tok]
  );
  if (!inv.rows[0]) return json(404, { ok: false, error: 'Invite not found or already used' });
  const invite = inv.rows[0];
  if (invite.accepted_at) return json(409, { ok: false, error: 'Invite already accepted' });
  if (new Date(invite.expires_at) < new Date()) return json(410, { ok: false, error: 'Invite expired' });

  // GET — return invite info for display
  if (event.httpMethod === 'GET') {
    return json(200, {
      ok: true,
      invite: { orgId: invite.org_id, orgName: invite.org_name, email: invite.email, role: invite.role }
    });
  }

  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  // Must be authenticated
  let userId, userEmail;
  try { ({ userId, email: userEmail } = requireAuth(event)); } catch (e) { return json(401, { ok: false, error: e.message }); }

  // Check email matches (or allow any if email is empty)
  if (invite.email && invite.email !== userEmail?.toLowerCase()) {
    return json(403, { ok: false, error: 'This invite is for a different email address' });
  }

  // Add to org
  await query(
    `insert into org_memberships(org_id, user_id, role) values($1,$2,$3)
     on conflict(org_id, user_id) do update set role=excluded.role`,
    [invite.org_id, userId, invite.role]
  );
  await query(
    `update org_invites set accepted_at=now(), accepted_by=$1 where id=$2`,
    [userId, invite.id]
  );

  logger.info('invite_accepted', { orgId: invite.org_id, userId, role: invite.role });
  return json(200, { ok: true, orgId: invite.org_id, orgName: invite.org_name, role: invite.role });
};
