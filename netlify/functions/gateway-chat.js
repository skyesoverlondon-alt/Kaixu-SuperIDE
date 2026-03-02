// gateway-chat.js — local same-origin proxy to KaixuSI Worker chat endpoint
//
// Allows browser/frontend to POST to /.netlify/functions/gateway-chat
// without hitting CORS. This function runs server-side and forwards to the
// KaixuSI Cloudflare Worker with KAIXUSI_SECRET.
//
// Request body (pass-through): { provider, model, messages, max_tokens?, temperature? }
// Response: { output_text, provider, model, usage, latency_ms, kaixusi: true }
//
// For streaming, use gateway-stream.js
// Env: KAIXUSI_WORKER_URL, KAIXUSI_SECRET

const crypto = require('crypto');
const { getBearerToken, verifyToken } = require('./_lib/auth');
const { query } = require('./_lib/db');
const { checkRateLimit } = require('./_lib/ratelimit');

const UPSTREAM = () => `${(process.env.KAIXUSI_WORKER_URL || '').replace(/\/+$/, '')}/v1/chat`;

async function resolveCustomerKey(token) {
  if (!token) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');

  // kxsi_ keys — new kaixu_customer_keys table (has quota tracking)
  if (token.startsWith('kxsi_')) {
    const res = await query(
      `UPDATE kaixu_customer_keys
       SET last_used_at=now(), call_count=call_count+1
       WHERE key_hash=$1 AND is_active=true AND revoked_at IS NULL
       RETURNING id, monthly_limit, call_count`,
      [hash]
    ).catch(() => null);
    const row = res?.rows?.[0];
    if (!row) return null;
    if (row.monthly_limit && row.call_count > row.monthly_limit) {
      return { __over_quota: true, monthly_limit: row.monthly_limit };
    }
    return { user_id: null, customer_key_id: row.id };
  }

  // ksk_ keys — legacy kaixu_keys table (per-user)
  if (token.startsWith('ksk_')) {
    const res = await query(
      `UPDATE kaixu_keys SET last_used_at=now()
       WHERE key_hash=$1 AND status='active'
       RETURNING user_id, id`,
      [hash]
    ).catch(() => null);
    return res?.rows?.[0] || null;
  }

  return null;
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method not allowed' };

  const virtualKey = process.env.KAIXUSI_SECRET;
  if (!virtualKey) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'KAIXUSI_SECRET not configured' }) };
  const workerUrl = process.env.KAIXUSI_WORKER_URL;
  if (!workerUrl) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'KAIXUSI_WORKER_URL not configured' }) };

  let bodyData;
  try { bodyData = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  // Resolve caller identity — accept either a JWT or a customer ksk_ API key.
  let userId = null;
  const tok = getBearerToken(event);
  if (tok?.startsWith('ksk_') || tok?.startsWith('kxsi_')) {
    // Customer API key path — validate against DB
    const keyRow = await resolveCustomerKey(tok);
    if (!keyRow) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Invalid or revoked KaixuSI key' }) };
    if (keyRow.__over_quota) return { statusCode: 402, headers: CORS, body: JSON.stringify({ error: 'Monthly quota exceeded', monthly_limit: keyRow.monthly_limit }) };
    userId = keyRow.user_id || null;
  } else {
    // JWT path — optional, unauthenticated calls still pass through
    try {
      if (tok) { const decoded = verifyToken(tok); userId = decoded?.userId || decoded?.sub || null; }
    } catch { /* no valid JWT — that's OK */ }
  }

  // ── Rate limit: 30 req/min per caller (AI is expensive) ─────────────────
  const clientIp = event.headers['x-forwarded-for']?.split(',')[0]?.trim() || event.headers['client-ip'] || 'anon';
  const rlKey = userId || clientIp;
  const limited = await checkRateLimit(rlKey, 'gateway-chat', { maxHits: 30, windowSecs: 60 });
  if (limited) return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: 'Rate limit exceeded. Max 30 requests/min.', retryAfter: 60 }) };

  // Inject attribution; preserve any workspace_id / org_id the client already sent.
  const enrichedBody = {
    ...bodyData,
    user_id:  userId || bodyData.user_id || null,
    app_id:   bodyData.app_id || 'kaixu-superide',
  };

  try {
    const res = await fetch(UPSTREAM(), {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${virtualKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(enrichedBody),
    });

    const responseBody = await res.text();
    return {
      statusCode: res.status,
      headers: { ...CORS, 'Content-Type': res.headers.get('content-type') || 'application/json' },
      body: responseBody,
    };
  } catch (err) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: `Gateway unreachable: ${err.message}` }) };
  }
};
