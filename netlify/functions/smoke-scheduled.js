const crypto = require('crypto');
const { query } = require('./_lib/db');
const { json } = require('./_lib/auth');
const {
  normalizeChecks,
  summarizeChecks,
  buildVerificationPayload,
  computeEvidence
} = require('./_lib/smoke-evidence');
const { sendEmail } = require('./_lib/email');

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return { ok: res.ok, status: res.status };
}

async function sendSmokeFailureAlerts({ runId, summary, checks }) {
  const failedChecks = (Array.isArray(checks) ? checks : []).filter((c) => !c?.ok).map((c) => ({
    name: c?.name,
    latencyMs: c?.latencyMs,
    message: c?.message
  }));
  const eventPayload = {
    event: 'smoke.failed',
    source: 'scheduler',
    runId,
    summary,
    failedChecks,
    generatedAt: new Date().toISOString()
  };

  const webhookEnv = String(process.env.SMOKE_ALERT_WEBHOOK_URLS || process.env.SMOKE_ALERT_WEBHOOK_URL || '');
  const webhookUrls = webhookEnv.split(',').map((s) => s.trim()).filter(Boolean);
  const webhookResults = await Promise.all(webhookUrls.map(async (url) => {
    try {
      const result = await postJson(url, eventPayload);
      return { url, ok: result.ok, status: result.status };
    } catch (err) {
      return { url, ok: false, error: String(err?.message || err) };
    }
  }));

  const emailEnv = String(process.env.SMOKE_ALERT_EMAIL_TO || '');
  const emails = emailEnv.split(',').map((s) => s.trim()).filter(Boolean);
  const textBody = [
    'kAIxU scheduled smoke failure',
    `runId: ${runId}`,
    `status: ${summary?.status || 'fail'}`,
    `failed: ${summary?.failed || 0}/${summary?.total || 0}`,
    '',
    ...failedChecks.map((check) => `- ${check.name}: ${check.message || 'failed'}`)
  ].join('\n');
  const emailResults = await Promise.all(emails.map(async (to) => {
    const result = await sendEmail({
      to,
      subject: '[kAIxU] Scheduled smoke failure',
      text: textBody,
      html: `<pre>${textBody.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))}</pre>`
    });
    return { to, ...result };
  }));

  return {
    attempted: webhookUrls.length + emails.length,
    delivered: webhookResults.filter((r) => r.ok).length + emailResults.filter((r) => r.ok).length,
    webhookResults,
    emailResults
  };
}

async function timed(name, fn) {
  const start = Date.now();
  try {
    const message = await fn();
    return {
      name,
      ok: true,
      latencyMs: Date.now() - start,
      message: String(message || 'ok').slice(0, 1000)
    };
  } catch (err) {
    return {
      name,
      ok: false,
      latencyMs: Date.now() - start,
      message: String(err?.message || err).slice(0, 1000)
    };
  }
}

async function loadPreviousSchedulerChainHash() {
  const prev = await query(
    `select details
     from audit_logs
     where action='smoke.run' and details->>'source'='scheduler'
     order by created_at desc
     limit 1`,
    []
  );
  return prev.rows[0]?.details?.evidence?.chainHash || null;
}

async function runScheduledSmoke() {
  const checks = [];
  const startedAt = Date.now();

  checks.push(await timed('Database connectivity', async () => {
    await query('select 1 as ok', []);
    return 'db=ok';
  }));

  checks.push(await timed('JWT secret presence', async () => {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
      throw new Error('JWT_SECRET missing or weak');
    }
    return 'jwt=ok';
  }));

  checks.push(await timed('Public smoke endpoint', async () => {
    const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.APP_URL || '';
    if (!base) return 'skipped:no-base-url';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const target = `${String(base).replace(/\/$/, '')}/.netlify/functions/smoke-public?limit=1`;
    const res = await fetch(target, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    return `ok:runs=${Number(body.totalRuns || 0)}`;
  }));

  const normalizedChecks = normalizeChecks(checks);
  const summary = summarizeChecks(normalizedChecks, Date.now() - startedAt);
  const createdAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  const signingKey = String(process.env.SMOKE_SIGNING_KEY || '');
  const signingKeyVersion = String(process.env.SMOKE_SIGNING_KEY_VERSION || '').trim() || null;
  const prevChainHash = await loadPreviousSchedulerChainHash();

  const verificationPayload = buildVerificationPayload({
    runId,
    workspaceId: null,
    userId: null,
    createdAt,
    summary,
    checks: normalizedChecks,
    source: 'scheduler',
    version: 2
  });

  const evidence = computeEvidence(verificationPayload, { prevChainHash, signingKey, signingKeyVersion });

  let alerts = null;
  if (summary.status === 'fail') {
    alerts = await sendSmokeFailureAlerts({ runId, summary, checks: normalizedChecks });
  }

  const details = {
    ...verificationPayload,
    verifyHash: evidence.verifyHash,
    evidence,
    scheduler: {
      job: 'netlify-scheduled-smoke',
      cron: '0 */6 * * *',
      environment: process.env.CONTEXT || process.env.NODE_ENV || 'unknown'
    },
    alerts
  };

  const inserted = await query(
    `insert into audit_logs (user_id, org_id, action, details)
     values (null, null, 'smoke.run', $1::jsonb)
     returning id, created_at`,
    [JSON.stringify(details)]
  );

  return {
    id: inserted.rows[0]?.id || null,
    createdAt: inserted.rows[0]?.created_at || createdAt,
    runId,
    summary,
    verifyHash: evidence.verifyHash,
    chainHash: evidence.chainHash,
    signature: evidence.signature,
    keyVersion: evidence.keyVersion,
    alerts
  };
}

exports.handler = async (event = {}) => {
  if (event.httpMethod && event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  const scheduleKey = String(process.env.SMOKE_SCHEDULE_KEY || '');
  const headerKey = String(event.headers?.['x-smoke-schedule-key'] || event.headers?.['X-Smoke-Schedule-Key'] || '');
  if (event.httpMethod && scheduleKey && headerKey !== scheduleKey) {
    return json(401, { ok: false, error: 'Unauthorized schedule trigger' });
  }

  try {
    const run = await runScheduledSmoke();
    return json(200, { ok: true, run });
  } catch (err) {
    return json(500, { ok: false, error: String(err?.message || err) });
  }
};

exports.config = {
  schedule: '0 */6 * * *'
};