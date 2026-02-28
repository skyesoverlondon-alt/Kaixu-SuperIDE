/*  POST /api/templates-create
    Auth required. Body: { org_id, name, description, tags, emoji, files, is_public }
    Returns:   { ok: true, template: { id, name, ... } }
*/
const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const token = getBearerToken(event);
  if (!token) return json(401, { ok: false, error: 'Authentication required' });

  let userId;
  try {
    const claims = verifyToken(token);
    userId = claims.sub;
  } catch (_) {
    return json(401, { ok: false, error: 'Invalid token' });
  }

  const parsed = await readJson(event);
  if (!parsed.ok) return parsed.response;

  const data = parsed.data || {};
  const orgId = (data.org_id || '').trim() || null;
  const name = (data.name || '').trim();
  const description = (data.description || '').trim();
  const tags = Array.isArray(data.tags) ? data.tags.map(String) : [];
  const emoji = (data.emoji || '📄').trim();
  const files = data.files && typeof data.files === 'object' ? data.files : {};
  const isPublic = !!data.is_public;

  if (!name) return json(400, { ok: false, error: 'name is required' });
  if (Object.keys(files).length === 0) return json(400, { ok: false, error: 'files must not be empty' });

  try {
    // If org_id provided, verify user is a member
    if (orgId) {
      const mem = await query(
        'select role from org_memberships where org_id=$1 and user_id=$2',
        [orgId, userId]
      );
      if (!mem.rows[0]) return json(403, { ok: false, error: 'Not a member of this org' });
    }

    const res = await query(
      `insert into templates (org_id, created_by, name, description, tags, emoji, files, is_public)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id, org_id, name, description, tags, emoji, is_public, created_at`,
      [orgId, userId, name, description, tags, emoji, files, isPublic]
    );

    return json(200, { ok: true, template: res.rows[0] });
  } catch (err) {
    return json(500, { ok: false, error: String(err?.message || err) });
  }
};
