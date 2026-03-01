// gateway-stream.js — local same-origin streaming proxy to XnthGateway
//
// Streams SSE events from the XnthGateway back to the browser client.
// Browser must use fetch + ReadableStream parsing (NOT EventSource — cannot POST).
//
// SSE events emitted by XnthGateway:
//   meta:  { provider, model, month: { month, cap_cents, spent_cents } }
//   delta: { text }
//   done:  { usage: { input_tokens, output_tokens, cost_cents }, month: {...} }
//   error: { error }
//
// Error codes to surface in UI:
//   402 → "Monthly cap reached" — block further calls
//   429 → rate limit — retry guidance
//   401 → invalid key
//
// Request body: { provider, model, messages, max_tokens?, temperature? }
// Env: KAIXU_VIRTUAL_KEY

const UPSTREAM = 'https://skyesol.netlify.app/.netlify/functions/gateway-stream';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method not allowed' };

  const virtualKey = process.env.KAIXU_VIRTUAL_KEY;
  if (!virtualKey) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'KAIXU_VIRTUAL_KEY not configured' }) };

  let body;
  try { body = event.body || '{}'; JSON.parse(body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  try {
    const res = await fetch(UPSTREAM, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${virtualKey}`,
        'Content-Type':  'application/json',
        'Accept':        'text/event-stream',
      },
      body,
    });

    // Collect the full SSE body and pass through
    // (Netlify Functions do not support true streaming responses;
    //  the full response is buffered and returned. For real-time streaming
    //  in the browser use the non-stream endpoint + simulate with delta chunks.)
    const responseBody = await res.text();
    return {
      statusCode: res.status,
      headers: {
        ...CORS,
        'Content-Type': res.headers.get('content-type') || 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body: responseBody,
    };
  } catch (err) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: `Gateway unreachable: ${err.message}` }) };
  }
};
