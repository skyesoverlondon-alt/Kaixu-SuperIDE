const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');
const { buildVerificationState } = require('./_lib/smoke-evidence');

async function verifyWorkspaceAccess(userId, workspaceId) {
  const wsRes = await query('select id, org_id, user_id from workspaces where id=$1', [workspaceId]);
  const ws = wsRes.rows[0];
  if (!ws) throw Object.assign(new Error('Workspace not found'), { status: 404 });

  if (ws.org_id) {
    const mem = await query('select role from org_memberships where org_id=$1 and user_id=$2', [ws.org_id, userId]);
    if (!mem.rows[0]) throw Object.assign(new Error('Not allowed'), { status: 403 });
  } else if (ws.user_id !== userId) {
    throw Object.assign(new Error('Not allowed'), { status: 403 });
  }

  return ws;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });

  const token = getBearerToken(event);
  if (!token) return json(401, { ok: false, error: 'Missing token' });

  let claims;
  try {
    claims = verifyToken(token);
  } catch {
    return json(401, { ok: false, error: 'Invalid token' });
  }

  const userId = claims.sub;
  const workspaceId = String(event.queryStringParameters?.workspaceId || '').trim();
  const signingKey = String(process.env.SMOKE_SIGNING_KEY || '');
  const signingKeyVersion = String(process.env.SMOKE_SIGNING_KEY_VERSION || '').trim() || null;

  try {
    if (workspaceId) await verifyWorkspaceAccess(userId, workspaceId);

    const sql = workspaceId
      ? `select id, created_at, details
        from audit_logs
        where action='smoke.run' and details->>'workspaceId'=$1
        order by created_at asc`
      : `select id, created_at, details
        from audit_logs
        where action='smoke.run' and user_id=$1
        order by created_at asc`;

    const rows = await query(sql, [workspaceId || userId]);

    let prevChainHash = null;
    const runs = rows.rows.map((row) => {
      const d = row.details || {};
      const verification = buildVerificationState(d, { prevChainHash, signingKey, signingKeyVersion });
      prevChainHash = verification.evidence.chainHash || prevChainHash;
      return {
        id: row.id,
        createdAt: row.created_at,
        runId: d.runId || null,
        verifyHash: verification.evidence.verifyHash,
        chainHash: verification.evidence.chainHash,
        signature: verification.evidence.signature,
        keyVersion: verification.evidence.keyVersion,
        source: d.source || 'manual',
        verification,
        workspaceId: d.workspaceId || null,
        summary: d.summary || null,
        checks: d.checks || []
      };
    });

    return json(200, {
      ok: true,
      exportedAt: new Date().toISOString(),
      scope: workspaceId ? 'workspace' : 'user',
      workspaceId: workspaceId || null,
      userId,
      totalRuns: runs.length,
      runs
    });
  } catch (err) {
    return json(err.status || 500, { ok: false, error: String(err?.message || err) });
  }
};
