const { query } = require('./_lib/db');
const { json } = require('./_lib/auth');
const { checkRateLimit } = require('./_lib/ratelimit');
const { buildVerificationState } = require('./_lib/smoke-evidence');

function requesterIp(event) {
  const h = event.headers || {};
  const forwarded = String(h['x-forwarded-for'] || h['X-Forwarded-For'] || '').split(',')[0].trim();
  const ip = forwarded || String(h['client-ip'] || h['Client-Ip'] || '').trim() || 'unknown';
  return ip;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  const limit = Math.min(Math.max(parseInt(event.queryStringParameters?.limit || '100', 10) || 100, 1), 500);
  const signingKey = String(process.env.SMOKE_SIGNING_KEY || '');
  const signingKeyVersion = String(process.env.SMOKE_SIGNING_KEY_VERSION || '').trim() || null;
  const maxHits = Math.max(parseInt(process.env.SMOKE_PUBLIC_RATE_MAX || '180', 10) || 180, 20);
  const windowSecs = Math.max(parseInt(process.env.SMOKE_PUBLIC_RATE_WINDOW_SECS || '60', 10) || 60, 10);
  const ip = requesterIp(event);

  try {
    const limited = await checkRateLimit(`ip:${ip}`, 'smoke-public', { maxHits, windowSecs });
    if (limited) {
      return json(429, { ok: false, error: 'Rate limit exceeded' }, {
        'Retry-After': String(windowSecs),
        'Cache-Control': 'no-store'
      });
    }

    const rows = await query(
      `select id, created_at, details from (
         select id, created_at, details
         from audit_logs
         where action='smoke.run'
         order by created_at desc
         limit $1
       ) latest
       order by created_at asc`,
      [limit]
    );

    let prevChainHash = null;

    const runs = rows.rows.map((row) => {
      const details = row.details || {};
      const verification = buildVerificationState(details, { prevChainHash, signingKey, signingKeyVersion });
      prevChainHash = verification.evidence.chainHash || prevChainHash;
      const checks = Array.isArray(details.checks) ? details.checks : [];
      const summary = details.summary || {};
      const total = Number(summary.total || checks.length || 0);
      const failed = Number(summary.failed || checks.filter((check) => !check?.ok).length || 0);
      const status = summary.status || (failed === 0 ? 'pass' : 'fail');

      return {
        id: row.id,
        createdAt: row.created_at,
        runId: details.runId || null,
        verifyHash: verification.evidence.verifyHash,
        chainHash: verification.evidence.chainHash,
        signature: verification.evidence.signature,
        keyVersion: verification.evidence.keyVersion,
        verification,
        workspaceId: details.workspaceId || null,
        source: details.source || 'manual',
        status,
        total,
        failed,
        checks: checks.map((check) => ({
          name: String(check?.name || ''),
          ok: Boolean(check?.ok),
          latencyMs: check?.latencyMs == null ? null : Number(check.latencyMs),
          message: String(check?.message || '')
        }))
      };
    }).reverse();

    return json(200, {
      ok: true,
      kind: 'public-smoke-history',
      exportedAt: new Date().toISOString(),
      totalRuns: runs.length,
      runs
    }, {
      'Cache-Control': 'public, max-age=30, s-maxage=120, stale-while-revalidate=300',
      Vary: 'Accept, X-Forwarded-For'
    });
  } catch (err) {
    return json(500, { ok: false, error: String(err?.message || err) });
  }
};
