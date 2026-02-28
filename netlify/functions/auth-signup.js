const bcrypt = require('bcryptjs');
const { query } = require('./_lib/db');
const { issueToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const parsed = await readJson(event);
  if (!parsed.ok) return parsed.response;

  const { email, password } = parsed.data || {};
  const e = String(email || '').trim().toLowerCase();
  const p = String(password || '');
  if (!e || !e.includes('@')) return json(400, { ok: false, error: 'Invalid email' });
  if (p.length < 8) return json(400, { ok: false, error: 'Password must be 8+ characters' });

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
  [user.id, org.id, user.id, 'Default Workspace', {}]
);
const workspace = wsRes.rows[0];


    const token = issueToken({ sub: user.id, email: user.email });
    return json(200, { ok: true, token, user, org, workspace });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.toLowerCase().includes('unique')) {
      return json(409, { ok: false, error: 'Email already exists' });
    }
    return json(500, { ok: false, error: 'Signup failed' });
  }
};
