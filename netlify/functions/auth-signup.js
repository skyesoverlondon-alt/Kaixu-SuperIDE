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

    // Create default workspace
    const wsRes = await query(
      'insert into workspaces(user_id, name, files) values($1,$2,$3) returning id, name, files, updated_at',
      [user.id, 'Default Workspace', {}]
    );
    const workspace = wsRes.rows[0];

    const token = issueToken({ sub: user.id, email: user.email });
    return json(200, { ok: true, token, user, workspace });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.toLowerCase().includes('unique')) {
      return json(409, { ok: false, error: 'Email already exists' });
    }
    return json(500, { ok: false, error: 'Signup failed' });
  }
};
