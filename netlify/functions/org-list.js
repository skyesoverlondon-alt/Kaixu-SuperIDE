const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });
  const token = getBearerToken(event);
  if (!token) return json(401, { ok: false, error: 'Missing token' });

  try {
    const claims = verifyToken(token);
    const userId = claims.sub;

    const res = await query(
      `select o.id, o.name, m.role, o.created_at
         from org_memberships m
         join orgs o on o.id = m.org_id
        where m.user_id = $1
        order by o.created_at desc`,
      [userId]
    );
    return json(200, { ok: true, orgs: res.rows });
  } catch (err) {
    return json(401, { ok: false, error: 'Invalid token' });
  }
};
