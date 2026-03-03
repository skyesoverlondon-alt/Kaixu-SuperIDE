const { query } = require('./_lib/db');
const { json } = require('./_lib/auth');
const { checkRateLimit } = require('./_lib/ratelimit');

function requesterIp(event) {
  const h = event.headers || {};
  const forwarded = String(h['x-forwarded-for'] || h['X-Forwarded-For'] || '').split(',')[0].trim();
  return forwarded || String(h['client-ip'] || h['Client-Ip'] || '').trim() || 'unknown';
}

function getRunSummary(details) {
  const summary = details?.summary || {};
  const checks = Array.isArray(details?.checks) ? details.checks : [];
  const total = Number(summary.total || checks.length || 0);
  const failed = Number(summary.failed || checks.filter((c) => !c?.ok).length || 0);
  return {
    total,
    failed,
    status: summary.status || (failed === 0 ? 'pass' : 'fail'),
    source: details?.source || 'manual'
  };
}

function pct(den, num) {
  return den ? Math.round((num / den) * 10000) / 100 : 100;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });

  const ip = requesterIp(event);
  const maxHits = Math.max(parseInt(process.env.STATUS_HISTORY_RATE_MAX || '180', 10) || 180, 20);
  const windowSecs = Math.max(parseInt(process.env.STATUS_HISTORY_RATE_WINDOW_SECS || '60', 10) || 60, 10);

  try {
    const limited = await checkRateLimit(`ip:${ip}`, 'status-history', { maxHits, windowSecs });
    if (limited) {
      return json(429, { ok: false, error: 'Rate limit exceeded' }, {
        'Retry-After': String(windowSecs),
        'Cache-Control': 'no-store'
      });
    }

    const rows = await query(
      `select created_at, details
       from audit_logs
       where action='smoke.run'
         and created_at >= (now() - interval '30 days')
       order by created_at asc`,
      []
    );

    const now = Date.now();
    const windows = {
      '24h': { ms: 24 * 60 * 60 * 1000, total: 0, pass: 0, failedChecks: 0 },
      '7d': { ms: 7 * 24 * 60 * 60 * 1000, total: 0, pass: 0, failedChecks: 0 },
      '30d': { ms: 30 * 24 * 60 * 60 * 1000, total: 0, pass: 0, failedChecks: 0 }
    };

    const dailyMap = new Map();
    const incidents = [];

    for (const row of rows.rows) {
      const createdMs = new Date(row.created_at).getTime();
      if (Number.isNaN(createdMs)) continue;

      const run = getRunSummary(row.details || {});
      const dayKey = new Date(createdMs).toISOString().slice(0, 10);
      if (!dailyMap.has(dayKey)) {
        dailyMap.set(dayKey, { date: dayKey, totalRuns: 0, passRuns: 0, failRuns: 0, failedChecks: 0 });
      }
      const day = dailyMap.get(dayKey);
      day.totalRuns += 1;
      day.passRuns += run.status === 'pass' ? 1 : 0;
      day.failRuns += run.status === 'fail' ? 1 : 0;
      day.failedChecks += run.failed;

      if (run.status === 'fail') {
        incidents.push({
          createdAt: row.created_at,
          source: run.source,
          failedChecks: run.failed,
          totalChecks: run.total
        });
      }

      Object.values(windows).forEach((win) => {
        if (now - createdMs <= win.ms) {
          win.total += 1;
          win.pass += run.status === 'pass' ? 1 : 0;
          win.failedChecks += run.failed;
        }
      });
    }

    const daily = Array.from(dailyMap.values())
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((item) => ({
        ...item,
        availability: pct(item.totalRuns, item.passRuns)
      }));

    const uptime = {
      '24h': {
        availability: pct(windows['24h'].total, windows['24h'].pass),
        totalRuns: windows['24h'].total,
        failedRuns: Math.max(windows['24h'].total - windows['24h'].pass, 0),
        failedChecks: windows['24h'].failedChecks
      },
      '7d': {
        availability: pct(windows['7d'].total, windows['7d'].pass),
        totalRuns: windows['7d'].total,
        failedRuns: Math.max(windows['7d'].total - windows['7d'].pass, 0),
        failedChecks: windows['7d'].failedChecks
      },
      '30d': {
        availability: pct(windows['30d'].total, windows['30d'].pass),
        totalRuns: windows['30d'].total,
        failedRuns: Math.max(windows['30d'].total - windows['30d'].pass, 0),
        failedChecks: windows['30d'].failedChecks
      }
    };

    return json(200, {
      ok: true,
      kind: 'smoke-status-history',
      generatedAt: new Date().toISOString(),
      slaTarget: Number(process.env.SMOKE_SLA_TARGET || 99.9),
      uptime,
      daily,
      incidents: incidents.slice(-20).reverse()
    }, {
      'Cache-Control': 'public, max-age=60, s-maxage=180, stale-while-revalidate=300',
      Vary: 'Accept, X-Forwarded-For'
    });
  } catch (err) {
    return json(500, { ok: false, error: String(err?.message || err) });
  }
};
