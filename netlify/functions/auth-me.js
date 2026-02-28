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

    const orgsRes = await query(
  `select o.id, o.name, m.role, o.created_at
     from org_memberships m
     join orgs o on o.id = m.org_id
    where m.user_id = $1
    order by o.created_at desc`,
  [userId]
);
const orgs = orgsRes.rows || [];
const defaultOrgId = orgs[0]?.id || null;

const wsRes = defaultOrgId
  ? await query('select id, name, updated_at, org_id from workspaces where org_id=$1 order by updated_at desc limit 20', [defaultOrgId])
  : await query('select id, name, updated_at, org_id from workspaces where user_id=$1 order by updated_at desc limit 20', [userId]);

return json(200, { ok: true, user, orgs, defaultOrgId, workspaces: wsRes.rows });        
  } catch (err) {
    return json(401, { ok: false, error: 'Invalid token' });
  }
};
