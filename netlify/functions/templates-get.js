/*  GET /api/templates-get?id=<uuid>
    Returns the full template including files jsonb.
    Public templates are accessible without auth.
    Org-scoped templates require auth + org membership.
    Returns:   { ok: true, template: { id, name, files, ... } }
*/
const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });

  const qs = event.queryStringParameters || {};
  const id = (qs.id || '').trim();
  if (!id) return json(400, { ok: false, error: 'Missing id' });

  // Optional auth
  const token = getBearerToken(event);
  let userId = null;
  if (token) {
    try {
      const claims = verifyToken(token);
      userId = claims.sub;
    } catch (_) { /* ignore */ }
  }

  try {
    const res = await query(
      `select t.*, u.email as created_by_email
         from templates t
         left join users u on u.id = t.created_by
        where t.id = $1`,
      [id]
    );

    const tpl = res.rows[0];
    if (!tpl) return json(404, { ok: false, error: 'Template not found' });

    // Access control: public → always ok; org-scoped → must be member
    if (!tpl.is_public) {
      if (!userId) return json(401, { ok: false, error: 'Authentication required' });
      if (tpl.org_id) {
        const mem = await query(
          'select 1 from org_memberships where org_id=$1 and user_id=$2',
          [tpl.org_id, userId]
        );
        if (!mem.rows.length) return json(403, { ok: false, error: 'Access denied' });
      } else {
        // Private template without org — only creator can access
        if (tpl.created_by !== userId) return json(403, { ok: false, error: 'Access denied' });
      }
    }

    return json(200, { ok: true, template: tpl });
  } catch (err) {
    return json(500, { ok: false, error: String(err?.message || err) });
  }
};
