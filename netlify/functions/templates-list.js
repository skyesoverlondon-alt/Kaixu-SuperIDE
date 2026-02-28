/*  GET /api/templates-list
    Query params:
      org_id  — filter to a specific org (requires auth + membership)
      public  — "true" to include public community templates
    Returns:   { ok: true, templates: [...] }
*/
const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });

  const qs = event.queryStringParameters || {};
  const orgId = (qs.org_id || '').trim();
  const includePublic = qs.public === 'true';

  // Try to authenticate (optional — unauthenticated only gets public)
  const token = getBearerToken(event);
  let userId = null;
  if (token) {
    try {
      const claims = verifyToken(token);
      userId = claims.sub;
    } catch (_) {
      // ignore bad token
    }
  }

  try {
    const orParts = [];
    const params = [];

    if (includePublic) {
      orParts.push('t.is_public = true');
    }

    if (orgId && userId) {
      // Verify membership first
      const mem = await query(
        'select 1 from org_memberships where org_id=$1 and user_id=$2',
        [orgId, userId]
      );
      if (mem.rows.length > 0) {
        params.push(orgId);
        orParts.push(`t.org_id = $${params.length}`);
      }
    }

    if (orParts.length === 0) {
      // No criteria — return only public
      orParts.push('t.is_public = true');
    }

    const whereClause = `where (${orParts.join(' or ')})`;

    const res = await query(
      `select t.id, t.org_id, t.name, t.description, t.tags, t.emoji,
              t.is_public, t.created_at,
              u.email as created_by_email,
              (select count(*) from jsonb_each(t.files)) as file_count
         from templates t
         left join users u on u.id = t.created_by
         ${whereClause}
         order by t.created_at desc
         limit 200`,
      params
    );

    return json(200, { ok: true, templates: res.rows });
  } catch (err) {
    return json(500, { ok: false, error: String(err?.message || err) });
  }
};
