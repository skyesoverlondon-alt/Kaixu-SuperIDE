// gateway-embed.js — local same-origin proxy to XnthGateway embeddings endpoint
//
// Proxies embedding requests from the IDE (browser or server-side) to skyesol
// without CORS issues. Used for RAG document ingestion and semantic search.
//
// Request body:
//   { provider: "gemini", model: "gemini-embedding-001",
//     input: "text" | ["text1","text2"],
//     taskType: "RETRIEVAL_QUERY"|"RETRIEVAL_DOCUMENT",
//     outputDimensionality: 1536 }
//
// Response:
//   { provider, model, embeddings: [[float,...]], dimensions, usage, month }
//
// Env: KAIXU_VIRTUAL_KEY

const UPSTREAM = 'https://skyesol.netlify.app/.netlify/functions/gateway-embed';

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
      },
      body,
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
