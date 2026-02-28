const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
  const token = getBearerToken(event);
  if (!token) return json(401, { ok: false, error: 'Missing token' });

  const parsed = await readJson(event);
  if (!parsed.ok) return parsed.response;
  const name = String(parsed.data?.name || '').trim() || 'New Org';

  try {
    const claims = verifyToken(token);
    const userId = claims.sub;

    const oRes = await query(
      'insert into orgs(name, created_by) values($1,$2) returning id, name, created_at',
      [name, userId]
    );
    const org = oRes.rows[0];
    await query(
      'insert into org_memberships(org_id, user_id, role) values($1,$2,$3) on conflict do nothing',
      [org.id, userId, 'owner']
    );
    return json(200, { ok: true, org });
  } catch (err) {
    return json(400, { ok: false, error: String(err?.message || err) });
  }
};
