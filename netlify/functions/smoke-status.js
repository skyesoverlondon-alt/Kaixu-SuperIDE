const { query } = require('./_lib/db');
const { json } = require('./_lib/auth');
const { checkRateLimit } = require('./_lib/ratelimit');

function requesterIp(event) {
  const h = event.headers || {};
  const forwarded = String(h['x-forwarded-for'] || h['X-Forwarded-For'] || '').split(',')[0].trim();
  return forwarded || String(h['client-ip'] || h['Client-Ip'] || '').trim() || 'unknown';
}

function buildBadgeSvg(label, value, color) {
  const l = String(label);
  const v = String(value);
  const labelWidth = Math.max(70, l.length * 7 + 14);
  const valueWidth = Math.max(88, v.length * 7 + 14);
  const width = labelWidth + valueWidth;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${l}: ${v}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".15"/>
    <stop offset="1" stop-opacity=".15"/>
  </linearGradient>
  <mask id="m"><rect width="${width}" height="20" rx="3" fill="#fff"/></mask>
  <g mask="url(#m)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${width}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="${Math.floor(labelWidth / 2)}" y="15" fill="#010101" fill-opacity=".3">${l}</text>
    <text x="${Math.floor(labelWidth / 2)}" y="14">${l}</text>
    <text x="${labelWidth + Math.floor(valueWidth / 2)}" y="15" fill="#010101" fill-opacity=".3">${v}</text>
    <text x="${labelWidth + Math.floor(valueWidth / 2)}" y="14">${v}</text>
  </g>
</svg>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });

  const maxHits = Math.max(parseInt(process.env.SMOKE_STATUS_RATE_MAX || '240', 10) || 240, 20);
  const windowSecs = Math.max(parseInt(process.env.SMOKE_STATUS_RATE_WINDOW_SECS || '60', 10) || 60, 10);
  const ip = requesterIp(event);

  try {
    const limited = await checkRateLimit(`ip:${ip}`, 'smoke-status', { maxHits, windowSecs });
    if (limited) {
      return json(429, { ok: false, error: 'Rate limit exceeded' }, {
        'Retry-After': String(windowSecs),
        'Cache-Control': 'no-store'
      });
    }

    const limit = Math.min(Math.max(parseInt(event.queryStringParameters?.limit || '30', 10) || 30, 5), 200);
    const rows = await query(
      `select created_at, details
       from audit_logs
       where action='smoke.run'
       order by created_at desc
       limit $1`,
      [limit]
    );

    const runs = rows.rows.map((row) => {
      const details = row.details || {};
      const summary = details.summary || {};
      const checks = Array.isArray(details.checks) ? details.checks : [];
      const total = Number(summary.total || checks.length || 0);
      const failed = Number(summary.failed || checks.filter((c) => !c?.ok).length || 0);
      const status = summary.status || (failed === 0 ? 'pass' : 'fail');
      return {
        createdAt: row.created_at,
        status,
        total,
        failed,
        source: details.source || 'manual'
      };
    });

    const totalRuns = runs.length;
    const passCount = runs.filter((r) => r.status === 'pass').length;
    const passRate = totalRuns ? Math.round((passCount / totalRuns) * 1000) / 10 : 0;
    const latest = runs[0] || null;
    const label = latest?.status === 'pass' ? 'passing' : 'failing';
    const color = latest?.status === 'pass' ? '#2ea44f' : '#d73a49';
    const badgeText = `${label} · ${passRate}%`;

    if (String(event.queryStringParameters?.format || '').toLowerCase() === 'svg') {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=30, s-maxage=120, stale-while-revalidate=300',
          Vary: 'Accept, X-Forwarded-For'
        },
        body: buildBadgeSvg('smoke', badgeText, color)
      };
    }

    return json(200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      latest,
      totalRuns,
      passCount,
      failCount: Math.max(totalRuns - passCount, 0),
      passRate,
      badge: {
        label: 'smoke',
        value: badgeText,
        svgPath: '/api/smoke-status?format=svg'
      }
    }, {
      'Cache-Control': 'public, max-age=30, s-maxage=120, stale-while-revalidate=300',
      Vary: 'Accept, X-Forwarded-For'
    });
  } catch (err) {
    return json(500, { ok: false, error: String(err?.message || err) });
  }
};