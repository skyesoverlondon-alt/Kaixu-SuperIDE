const { query } = require('./_lib/db');
const { json } = require('./_lib/auth');
const { checkRateLimit } = require('./_lib/ratelimit');

function requesterIp(event) {
  const h = event.headers || {};
  const forwarded = String(h['x-forwarded-for'] || h['X-Forwarded-For'] || '').split(',')[0].trim();
  return forwarded || String(h['client-ip'] || h['Client-Ip'] || '').trim() || 'unknown';
}

function monthKey(isoDate) {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });

  const ip = requesterIp(event);
  const maxHits = Math.max(parseInt(process.env.SMOKE_MONTHLY_RATE_MAX || '120', 10) || 120, 20);
  const windowSecs = Math.max(parseInt(process.env.SMOKE_MONTHLY_RATE_WINDOW_SECS || '60', 10) || 60, 10);

  try {
    const limited = await checkRateLimit(`ip:${ip}`, 'smoke-monthly-report', { maxHits, windowSecs });
    if (limited) {
      return json(429, { ok: false, error: 'Rate limit exceeded' }, {
        'Retry-After': String(windowSecs),
        'Cache-Control': 'no-store'
      });
    }

    const months = Math.min(Math.max(parseInt(event.queryStringParameters?.months || '12', 10) || 12, 1), 36);
    const format = String(event.queryStringParameters?.format || 'json').toLowerCase();

    const rows = await query(
      `select created_at, details
       from audit_logs
       where action='smoke.run'
         and created_at >= (date_trunc('month', now()) - (($1::int - 1) * interval '1 month'))
       order by created_at asc`,
      [months]
    );

    const bucket = new Map();
    for (const row of rows.rows) {
      const key = monthKey(row.created_at);
      if (!key) continue;
      if (!bucket.has(key)) {
        bucket.set(key, {
          month: key,
          totalRuns: 0,
          passRuns: 0,
          failRuns: 0,
          schedulerRuns: 0,
          manualRuns: 0,
          totalChecks: 0,
          failedChecks: 0
        });
      }

      const details = row.details || {};
      const summary = details.summary || {};
      const checks = Array.isArray(details.checks) ? details.checks : [];
      const totalChecks = Number(summary.total || checks.length || 0);
      const failedChecks = Number(summary.failed || checks.filter((c) => !c?.ok).length || 0);
      const status = summary.status || (failedChecks === 0 ? 'pass' : 'fail');
      const source = details.source || 'manual';

      const stat = bucket.get(key);
      stat.totalRuns += 1;
      stat.passRuns += status === 'pass' ? 1 : 0;
      stat.failRuns += status === 'fail' ? 1 : 0;
      stat.schedulerRuns += source === 'scheduler' ? 1 : 0;
      stat.manualRuns += source === 'scheduler' ? 0 : 1;
      stat.totalChecks += totalChecks;
      stat.failedChecks += failedChecks;
    }

    const monthsData = Array.from(bucket.values()).map((item) => ({
      ...item,
      runPassRate: item.totalRuns ? Math.round((item.passRuns / item.totalRuns) * 1000) / 10 : 0,
      checkPassRate: item.totalChecks ? Math.round(((item.totalChecks - item.failedChecks) / item.totalChecks) * 1000) / 10 : 0
    }));

    if (format === 'csv') {
      const header = [
        'month',
        'totalRuns',
        'passRuns',
        'failRuns',
        'runPassRate',
        'totalChecks',
        'failedChecks',
        'checkPassRate',
        'schedulerRuns',
        'manualRuns'
      ];
      const lines = [header.join(',')];
      for (const row of monthsData) {
        lines.push([
          row.month,
          row.totalRuns,
          row.passRuns,
          row.failRuns,
          row.runPassRate,
          row.totalChecks,
          row.failedChecks,
          row.checkPassRate,
          row.schedulerRuns,
          row.manualRuns
        ].join(','));
      }

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=600',
          Vary: 'Accept, X-Forwarded-For'
        },
        body: lines.join('\n')
      };
    }

    return json(200, {
      ok: true,
      kind: 'monthly-smoke-trust-report',
      generatedAt: new Date().toISOString(),
      months,
      totals: {
        totalRuns: monthsData.reduce((acc, item) => acc + item.totalRuns, 0),
        passRuns: monthsData.reduce((acc, item) => acc + item.passRuns, 0),
        failRuns: monthsData.reduce((acc, item) => acc + item.failRuns, 0)
      },
      reports: monthsData
    }, {
      'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=600',
      Vary: 'Accept, X-Forwarded-For'
    });
  } catch (err) {
    return json(500, { ok: false, error: String(err?.message || err) });
  }
};
