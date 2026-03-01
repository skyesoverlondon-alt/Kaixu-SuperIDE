const { query } = require('./_lib/db');
const { requireAuth } = require('./_lib/auth');
const { json } = require('./_lib/body');

// WORM-ish audit log export — returns CSV or JSON
exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });
  let userId;
  try { ({ userId } = requireAuth(event)); } catch (e) { return json(401, { ok: false, error: e.message }); }

  const orgId = event.queryStringParameters?.orgId;
  const format = event.queryStringParameters?.format || 'json'; // json | csv
  const limit = Math.min(parseInt(event.queryStringParameters?.limit || '1000'), 10000);

  if (orgId) {
    const mem = await query(`select role from org_memberships where org_id=$1 and user_id=$2`, [orgId, userId]);
    if (!mem.rows[0] || !['owner','admin'].includes(mem.rows[0].role)) {
      return json(403, { ok: false, error: 'Admin only' });
    }
  }

  const rows = await query(
    orgId
      ? `select a.id, a.action, a.details, a.created_at, u.email as user_email
         from audit_logs a left join users u on u.id=a.user_id
         where a.org_id=$1 order by a.created_at desc limit $2`
      : `select a.id, a.action, a.details, a.created_at, u.email as user_email
         from audit_logs a left join users u on u.id=a.user_id
         where a.user_id=$1 order by a.created_at desc limit $2`,
    orgId ? [orgId, limit] : [userId, limit]
  );

  if (format === 'csv') {
    const header = 'id,action,user_email,created_at,details\n';
    const lines = rows.rows.map(r =>
      [r.id, r.action, r.user_email || '', r.created_at, JSON.stringify(r.details).replace(/"/g, '""')]
        .map(v => `"${v}"`).join(',')
    ).join('\n');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="audit-${Date.now()}.csv"`
      },
      body: header + lines
    };
  }

  return json(200, { ok: true, count: rows.rows.length, logs: rows.rows });
};
