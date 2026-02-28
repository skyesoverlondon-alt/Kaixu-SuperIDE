const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });
  const token = getBearerToken(event);
  if (!token) return json(401, { ok: false, error: 'Missing token' });

  try {
    const claims = verifyToken(token);
    const userId = claims.sub;
    const uRes = await query('select id, email, created_at from users where id=$1', [userId]);
    const user = uRes.rows[0];
    if (!user) return json(401, { ok: false, error: 'Invalid token' });

    const wsRes = await query(
      'select id, name, updated_at from workspaces where user_id=$1 order by updated_at desc limit 20',
      [userId]
    );

    return json(200, { ok: true, user, workspaces: wsRes.rows });
  } catch (err) {
    return json(401, { ok: false, error: 'Invalid token' });
  }
};
