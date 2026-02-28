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
  if (!e || !p) return json(400, { ok: false, error: 'Missing email or password' });

  try {
    const res = await query('select id, email, password_hash from users where email=$1', [e]);
    const user = res.rows[0];
    if (!user) return json(401, { ok: false, error: 'Invalid credentials' });
    const ok = await bcrypt.compare(p, user.password_hash);
    if (!ok) return json(401, { ok: false, error: 'Invalid credentials' });

    const token = issueToken({ sub: user.id, email: user.email });
    return json(200, { ok: true, token, user: { id: user.id, email: user.email } });
  } catch (err) {
    return json(500, { ok: false, error: 'Login failed' });
  }
};
