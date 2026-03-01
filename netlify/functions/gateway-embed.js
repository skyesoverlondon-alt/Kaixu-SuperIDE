// gateway-embed.js — local same-origin proxy to KaixuSI Worker embeddings endpoint
//
// Proxies embedding requests from the IDE (browser or server-side) to the
// KaixuSI Worker without CORS issues. Used for RAG document ingestion and
// semantic search.
//
// Request body:
//   { provider: "gemini", model: "gemini-embedding-001",
//     input: "text" | ["text1","text2"],
//     taskType: "RETRIEVAL_QUERY"|"RETRIEVAL_DOCUMENT",
//     outputDimensionality: 1536 }
//
// Response:
//   { provider, model, embeddings: [[float,...]], dimensions, latency_ms, kaixusi: true }
//
// Env: KAIXUSI_WORKER_URL, KAIXUSI_SECRET

const crypto = require('crypto');
const { getBearerToken, verifyToken } = require('./_lib/auth');
const { query } = require('./_lib/db');

const UPSTREAM = () => `${(process.env.KAIXUSI_WORKER_URL || '').replace(/\/+$/, '')}/v1/embed`;

async function resolveCustomerKey(token) {
  if (!token) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  if (token.startsWith('kxsi_')) {
    const res = await query(
      `UPDATE kaixu_customer_keys SET last_used_at=now(), call_count=call_count+1
       WHERE key_hash=$1 AND is_active=true AND revoked_at IS NULL
       RETURNING id, monthly_limit, call_count`,
      [hash]
    ).catch(() => null);
    const row = res?.rows?.[0];
    if (!row) return null;
    if (row.monthly_limit && row.call_count > row.monthly_limit)
      return { __over_quota: true, monthly_limit: row.monthly_limit };
    return { user_id: null, customer_key_id: row.id };
  }
  if (token.startsWith('ksk_')) {
    const res = await query(
      `UPDATE kaixu_keys SET last_used_at=now()
       WHERE key_hash=$1 AND status='active' RETURNING user_id, id`,
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

  // Resolve caller identity: accept customer kxsi_/ksk_ keys or IDE JWT.
  let userId = null;
  const tok = getBearerToken(event);
  if (tok?.startsWith('kxsi_') || tok?.startsWith('ksk_')) {
    const keyRow = await resolveCustomerKey(tok);
    if (!keyRow) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Invalid or revoked KaixuSI key' }) };
    if (keyRow.__over_quota) return { statusCode: 402, headers: CORS, body: JSON.stringify({ error: 'Monthly quota exceeded', monthly_limit: keyRow.monthly_limit }) };
    userId = keyRow.user_id || null;
  } else {
    try {
      if (tok) { const decoded = verifyToken(tok); userId = decoded?.sub || null; }
    } catch { /* no valid token — that's OK */ }
  }

  const enrichedBody = {
    ...bodyData,
    user_id: userId || bodyData.user_id || null,
    app_id:  bodyData.app_id || 'kaixu-superide',
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
