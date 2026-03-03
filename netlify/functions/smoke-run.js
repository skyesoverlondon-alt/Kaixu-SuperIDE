const crypto = require('crypto');
const { query } = require('./_lib/db');
const { verifyToken, getBearerToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');
const {
  normalizeChecks,
  summarizeChecks,
  buildVerificationPayload,
  computeEvidence,
  buildVerificationState
} = require('./_lib/smoke-evidence');

async function verifyWorkspaceAccess(userId, workspaceId) {
  const wsRes = await query('select id, org_id, user_id from workspaces where id=$1', [workspaceId]);
  const ws = wsRes.rows[0];
  if (!ws) throw Object.assign(new Error('Workspace not found'), { status: 404 });

  if (ws.org_id) {
    const mem = await query('select role from org_memberships where org_id=$1 and user_id=$2', [ws.org_id, userId]);
    if (!mem.rows[0]) throw Object.assign(new Error('Not allowed'), { status: 403 });
    return { orgId: ws.org_id };
  }

  if (ws.user_id !== userId) throw Object.assign(new Error('Not allowed'), { status: 403 });
  return { orgId: null };
}

async function loadRunsForScope({ userId, workspaceId, limit }) {
  const sql = workspaceId
     ? `select id, created_at, details from (
        select id, created_at, details
        from audit_logs
        where action='smoke.run' and details->>'workspaceId'=$1
        order by created_at desc
        limit $2
       ) latest
       order by created_at asc`
     : `select id, created_at, details from (
        select id, created_at, details
        from audit_logs
        where action='smoke.run' and user_id=$1
        order by created_at desc
        limit $2
       ) latest
       order by created_at asc`;

  const params = workspaceId ? [workspaceId, limit] : [userId, limit];
  return query(sql, params);
}

async function loadPreviousChainHash({ userId, workspaceId }) {
  const sql = workspaceId
    ? `select details
       from audit_logs
       where action='smoke.run' and details->>'workspaceId'=$1
       order by created_at desc
       limit 1`
    : `select details
       from audit_logs
       where action='smoke.run' and user_id=$1
       order by created_at desc
       limit 1`;
  const params = workspaceId ? [workspaceId] : [userId];
  const prev = await query(sql, params);
  return prev.rows[0]?.details?.evidence?.chainHash || null;
}

exports.handler = async (event) => {
  const token = getBearerToken(event);
  if (!token) return json(401, { ok: false, error: 'Missing token' });

  let claims;
  try {
    claims = verifyToken(token);
  } catch {
    return json(401, { ok: false, error: 'Invalid token' });
  }

  const userId = claims.sub;
  const signingKey = String(process.env.SMOKE_SIGNING_KEY || '');
  const signingKeyVersion = String(process.env.SMOKE_SIGNING_KEY_VERSION || '').trim() || null;

  if (event.httpMethod === 'GET') {
    const workspaceId = String(event.queryStringParameters?.workspaceId || '').trim();
    const limit = Math.min(Math.max(parseInt(event.queryStringParameters?.limit || '50', 10) || 50, 1), 200);

    try {
      if (workspaceId) await verifyWorkspaceAccess(userId, workspaceId);

      const rows = await loadRunsForScope({ userId, workspaceId, limit });
      let prevChainHash = null;

      const runs = rows.rows.map((row) => {
        const d = row.details || {};
        const verification = buildVerificationState(d, { prevChainHash, signingKey, signingKeyVersion });
        prevChainHash = verification.evidence.chainHash || prevChainHash;
        return {
          id: row.id,
          createdAt: row.created_at,
          runId: d.runId,
          verifyHash: verification.evidence.verifyHash,
          chainHash: verification.evidence.chainHash,
          signature: verification.evidence.signature,
          keyVersion: verification.evidence.keyVersion,
          verification,
          status: d.summary?.status || 'unknown',
          total: d.summary?.total || 0,
          failed: d.summary?.failed || 0,
          workspaceId: d.workspaceId || null,
          checks: d.checks || []
        };
      }).reverse();

      return json(200, { ok: true, runs });
    } catch (err) {
      return json(err.status || 500, { ok: false, error: String(err?.message || err) });
    }
  }

  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const parsed = await readJson(event);
  if (!parsed.ok) return parsed.response;

  const workspaceId = String(parsed.data?.workspaceId || '').trim();
  const checks = Array.isArray(parsed.data?.checks) ? parsed.data.checks : [];

  if (!checks.length) return json(400, { ok: false, error: 'At least one smoke check is required' });
  if (checks.length > 50) return json(400, { ok: false, error: 'Too many checks (max 50)' });

  try {
    let orgId = null;
    if (workspaceId) {
      const access = await verifyWorkspaceAccess(userId, workspaceId);
      orgId = access.orgId;
    }

    const createdAt = new Date().toISOString();
    const runId = crypto.randomUUID();

    const normalizedChecks = normalizeChecks(checks);
    const summary = summarizeChecks(normalizedChecks, parsed.data?.durationMs);
    const verificationPayload = buildVerificationPayload({
      runId,
      workspaceId: workspaceId || null,
      userId,
      createdAt,
      summary,
      checks: normalizedChecks,
      source: 'manual',
      version: 2
    });

    const prevChainHash = await loadPreviousChainHash({ userId, workspaceId: workspaceId || null });
    const evidence = computeEvidence(verificationPayload, { prevChainHash, signingKey, signingKeyVersion });

    const details = {
      ...verificationPayload,
      verifyHash: evidence.verifyHash,
      evidence,
      client: {
        userAgent: String(parsed.data?.client?.userAgent || '').slice(0, 500),
        appVersion: String(parsed.data?.client?.appVersion || '').slice(0, 120)
      }
    };

    const inserted = await query(
      `insert into audit_logs (user_id, org_id, action, details)
       values ($1, $2, 'smoke.run', $3::jsonb)
       returning id, created_at`,
      [userId, orgId, JSON.stringify(details)]
    );

    return json(200, {
      ok: true,
      run: {
        id: inserted.rows[0]?.id || null,
        createdAt: inserted.rows[0]?.created_at || createdAt,
        runId,
        verifyHash: evidence.verifyHash,
        chainHash: evidence.chainHash,
        signature: evidence.signature,
        keyVersion: evidence.keyVersion,
        workspaceId: workspaceId || null,
        summary
      }
    });
  } catch (err) {
    return json(err.status || 500, { ok: false, error: String(err?.message || err) });
  }
};
