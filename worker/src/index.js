/**
 * KaixuSI — Cloudflare Worker Brain
 *
 * This worker IS the KaixuSI model.
 * It is the intelligence layer for the kAIxU SuperIDE and any
 * external app that holds a valid KaixuSI key.
 *
 * Routes:
 *   GET  /health
 *   POST /v1/chat    — non-streaming AI chat
 *   POST /v1/stream  — SSE streaming AI chat
 *   POST /v1/embed   — text embeddings
 *
 * Environment secrets (set via wrangler secret or CF dashboard):
 *   KAIXUSI_SECRET     — main bearer token checked for all /v1/* calls
 *   OPENAI_KEY         — OpenAI API key
 *   ANTHROPIC_KEY      — Anthropic API key
 *   GEMINI_KEY         — Google Gemini API key
 *   DATABASE_URL       — Neon PostgreSQL connection string (for usage logging)
 *
 * External apps call this with the same KAIXUSI_SECRET.
 * Per-user attribution is carried in the request body.
 */

// ─── CORS ─────────────────────────────────────────────────────────────────────
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin':  origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Kaixu-App, X-Kaixu-User-Id, X-Kaixu-Workspace-Id, X-Kaixu-Org-Id',
    'Access-Control-Max-Age':       '86400',
  };
}

function handleOptions(request) {
  const origin = request.headers.get('Origin') || '*';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function jsonResp(data, status = 200, origin = '*') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

function errResp(message, status = 400, origin = '*') {
  return jsonResp({ error: message }, status, origin);
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function checkAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  // Accepts either the primary secret or registered external keys.
  // For now: single KAIXUSI_SECRET; extend to KV/DB key registry later.
  return token === (env.KAIXUSI_SECRET || '');
}

// ─── kAIxU MODEL ALIASES ─────────────────────────────────────────────────────
// Client code uses kAIxU brand names only. The worker resolves them to the
// underlying provider/model internally — nothing leaks to the client.
const KAIXU_ALIASES = {
  'kaixu-flash': { provider: 'gemini', model: 'gemini-2.5-flash' },
  'kaixu-brain': { provider: 'gemini', model: 'gemini-2.5-flash' },
  'kaixu-nano' : { provider: 'gemini', model: 'gemini-2.0-flash' },
  'kaixu-pro'  : { provider: 'gemini', model: 'gemini-2.5-pro'   },
  'kaixu-embed': { provider: 'gemini', model: 'gemini-embedding-001' },
};
function resolveKaixuModel(provider, model) {
  const alias = KAIXU_ALIASES[model] || KAIXU_ALIASES[provider] || null;
  if (alias) return alias;
  return { provider: provider || 'gemini', model: model || 'gemini-2.5-flash' };
}

// ─── ATTRIBUTION ─────────────────────────────────────────────────────────────
// Resolve the calling user's identity from request body OR dedicated headers.
// Body fields take precedence; headers are a fallback for callers that can't
// modify their request body (e.g. streaming clients).
function resolveContext(request, body) {
  return {
    user_id:      body.user_id      || request.headers.get('X-Kaixu-User-Id')      || null,
    workspace_id: body.workspace_id || request.headers.get('X-Kaixu-Workspace-Id') || null,
    org_id:       body.org_id       || request.headers.get('X-Kaixu-Org-Id')        || null,
    app_id:       body.app_id       || request.headers.get('X-Kaixu-App')            || 'unknown',
  };
}

// ─── PROVIDER CALLS ───────────────────────────────────────────────────────────

async function callOpenAI({ model, messages, max_tokens, temperature, stream }, env) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model || 'gpt-4o',
      messages,
      max_tokens: max_tokens || 4096,
      temperature: temperature ?? 0.7,
      stream: stream || false,
    }),
  });
  return res;
}

async function callAnthropic({ model, messages, max_tokens, temperature, stream }, env) {
  // Separate system message if present (Anthropic requires it as top-level param)
  const systemMsg = messages.find(m => m.role === 'system');
  const userMsgs  = messages.filter(m => m.role !== 'system');

  const body = {
    model: model || 'claude-3-5-sonnet-20241022',
    messages: userMsgs,
    max_tokens: max_tokens || 4096,
    temperature: temperature ?? 0.7,
    stream: stream || false,
  };
  if (systemMsg) body.system = systemMsg.content;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         env.ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type':      'application/json',
    },
    body: JSON.stringify(body),
  });
  return res;
}

async function callGemini({ model, messages, max_tokens, temperature, stream }, env) {
  const geminiModel = model || 'gemini-2.5-flash';
  // Translate OpenAI-style messages → Gemini contents format
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMsgs  = messages.filter(m => m.role !== 'system');

  const contents = chatMsgs.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const endpoint = stream
    ? `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?key=${env.GEMINI_KEY}`
    : `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${env.GEMINI_KEY}`;

  const body = {
    contents,
    generationConfig: {
      maxOutputTokens: max_tokens || 4096,
      temperature: temperature ?? 0.7,
    },
  };
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res;
}

// ─── TEXT EXTRACTION (non-streaming) ─────────────────────────────────────────
async function extractText(provider, providerRes) {
  const data = await providerRes.json().catch(() => ({}));

  if (provider === 'openai') {
    return {
      text:  data.choices?.[0]?.message?.content || '',
      usage: data.usage || {},
    };
  }

  if (provider === 'anthropic') {
    return {
      text:  data.content?.[0]?.text || '',
      usage: {
        input_tokens:  data.usage?.input_tokens  || 0,
        output_tokens: data.usage?.output_tokens || 0,
      },
    };
  }

  if (provider === 'gemini') {
    const candidate = data.candidates?.[0];
    const text      = candidate?.content?.parts?.map(p => p.text || '').join('') || '';
    const meta      = data.usageMetadata || {};
    return {
      text,
      usage: {
        input_tokens:  meta.promptTokenCount    || 0,
        output_tokens: meta.candidatesTokenCount || 0,
      },
    };
  }

  return { text: '', usage: {} };
}

// ─── EMBED ─────────────────────────────────────────────────────────────────────
async function embedGemini({ input, taskType, outputDimensionality }, env) {
  const model    = 'gemini-embedding-001';
  const dims     = outputDimensionality || 1536;
  const task     = taskType || 'RETRIEVAL_DOCUMENT';

  const results = await Promise.all(input.map(async text => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${env.GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          taskType: task,
          outputDimensionality: dims,
        }),
      }
    );
    const d = await res.json().catch(() => ({}));
    return d.embedding?.values || [];
  }));

  return { embeddings: results, dimensions: dims };
}

async function embedOpenAI({ input, model: modelName }, env) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelName || 'text-embedding-3-small',
      input,
    }),
  });
  const data = await res.json().catch(() => ({}));
  const embeddings = (data.data || []).map(d => d.embedding || []);
  return { embeddings, dimensions: embeddings[0]?.length || 0 };
}

// ─── USAGE LOGGING ─────────────────────────────────────────────────────────────
// Logs asynchronously to Neon via the @neondatabase/serverless HTTP connector.
// If DATABASE_URL is absent, silently skips (no crash).
async function logUsage({ provider, model, user_id, workspace_id, org_id, app_id, usage, latency_ms }, env) {
  const dbUrl = env.DATABASE_URL;
  if (!dbUrl) return;

  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(dbUrl);
    await sql`
      INSERT INTO ai_usage_log
        (provider, model, user_id, workspace_id, org_id, app_id,
         input_tokens, output_tokens, latency_ms, created_at)
      VALUES
        (${provider}, ${model}, ${user_id || null}, ${workspace_id || null},
         ${org_id || null}, ${app_id || null},
         ${usage?.input_tokens || 0}, ${usage?.output_tokens || 0},
         ${latency_ms}, now())
    `;
  } catch (_) {
    // Usage logging is best-effort — never fail the main request
  }
}

// ─── ROUTE: /v1/chat ──────────────────────────────────────────────────────────
async function routeChat(request, env) {
  const origin = request.headers.get('Origin') || '*';
  const body   = await request.json().catch(() => ({}));

  let {
    provider    = 'gemini',
    model       = 'gemini-2.5-flash',
    messages    = [],
    max_tokens,
    temperature,
  } = body;
  ({ provider, model } = resolveKaixuModel(provider, model));

  // Resolve per-user attribution from body OR headers
  const { user_id, workspace_id, org_id, app_id } = resolveContext(request, body);

  if (!messages.length) return errResp('messages required', 400, origin);

  let providerRes;
  const t0 = Date.now();

  if (provider === 'openai') {
    providerRes = await callOpenAI({ model, messages, max_tokens, temperature, stream: false }, env);
  } else if (provider === 'anthropic') {
    providerRes = await callAnthropic({ model, messages, max_tokens, temperature, stream: false }, env);
  } else {
    providerRes = await callGemini({ model, messages, max_tokens, temperature, stream: false }, env);
  }

  if (!providerRes.ok) {
    const errText = await providerRes.text().catch(() => '');
    return errResp(`Provider error (${providerRes.status}): ${errText}`, 502, origin);
  }

  const { text, usage } = await extractText(provider, providerRes);
  const latency_ms = Date.now() - t0;

  // Fire-and-forget usage log
  env.ctx?.waitUntil(logUsage({ provider, model, user_id, workspace_id, org_id, app_id, usage, latency_ms }, env));

  return jsonResp({
    output_text: text,
    provider,
    model,
    usage,
    latency_ms,
    attributed_to: { user_id, workspace_id, org_id, app_id },
    kaixusi: true,
  }, 200, origin);
}

// ─── ROUTE: /v1/stream ────────────────────────────────────────────────────────
async function routeStream(request, env) {
  const origin = request.headers.get('Origin') || '*';
  const body   = await request.json().catch(() => ({}));

  let {
    provider    = 'gemini',
    model       = 'gemini-2.5-flash',
    messages    = [],
    max_tokens,
    temperature,
  } = body;
  ({ provider, model } = resolveKaixuModel(provider, model));

  // Resolve per-user attribution from body OR headers
  const { user_id, workspace_id, org_id, app_id } = resolveContext(request, body);

  if (!messages.length) return errResp('messages required', 400, origin);

  let providerRes;
  if (provider === 'openai') {
    providerRes = await callOpenAI({ model, messages, max_tokens, temperature, stream: true }, env);
  } else if (provider === 'anthropic') {
    providerRes = await callAnthropic({ model, messages, max_tokens, temperature, stream: true }, env);
  } else {
    providerRes = await callGemini({ model, messages, max_tokens, temperature, stream: true }, env);
  }

  if (!providerRes.ok) {
    const errText = await providerRes.text().catch(() => '');
    return errResp(`Provider error (${providerRes.status}): ${errText}`, 502, origin);
  }

  // Proxy the SSE stream back to the caller with CORS headers
  const { readable, writable } = new TransformStream();
  const writer  = writable.getWriter();
  const encoder = new TextEncoder();
  const t0      = Date.now();
  let outputTokens = 0;

  env.ctx?.waitUntil((async () => {
    const reader = providerRes.body.getReader();
    const dec    = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        // Rough token count for logging (estimate)
        outputTokens += Math.ceil(chunk.length / 4);
        await writer.write(encoder.encode(chunk));
      }
    } finally {
      await writer.close().catch(() => {});
      const latency_ms = Date.now() - t0;
      logUsage({ provider, model, user_id, workspace_id, org_id, app_id,
        usage: { input_tokens: 0, output_tokens: outputTokens }, latency_ms }, env);
    }
  })());

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': providerRes.headers.get('Content-Type') || 'text/event-stream',
      'Cache-Control': 'no-cache',
      ...corsHeaders(origin),
    },
  });
}

// ─── ROUTE: /v1/embed ─────────────────────────────────────────────────────────
async function routeEmbed(request, env) {
  const origin = request.headers.get('Origin') || '*';
  const body   = await request.json().catch(() => ({}));

  let {
    provider            = 'gemini',
    model,
    input               = [],
    taskType,
    outputDimensionality,
  } = body;
  ({ provider, model } = resolveKaixuModel(provider, model || 'kaixu-embed'));

  // Resolve per-user attribution from body OR headers
  const { user_id, workspace_id, org_id, app_id } = resolveContext(request, body);

  if (!input.length) return errResp('input required', 400, origin);

  let result;
  const t0 = Date.now();

  if (provider === 'openai') {
    result = await embedOpenAI({ input, model }, env);
  } else {
    result = await embedGemini({ input, taskType, outputDimensionality }, env);
  }

  const latency_ms = Date.now() - t0;
  env.ctx?.waitUntil(logUsage({ provider, model: model || 'gemini-embedding-001',
    user_id, workspace_id, org_id, app_id,
    usage: { input_tokens: input.length, output_tokens: 0 }, latency_ms }, env));

  return jsonResp({ ...result, provider, latency_ms, attributed_to: { user_id, workspace_id, org_id, app_id }, kaixusi: true }, 200, origin);
}

// ─── ROUTE: /health ───────────────────────────────────────────────────────────
async function routeHealth(request, env) {
  const origin = request.headers.get('Origin') || '*';
  return jsonResp({
    status:  'ok',
    brain:   'KaixuSI',
    version: '1.0.0',
    ts:      new Date().toISOString(),
    // Lets the IDE know it has reached the genuine KaixuSI worker (not a proxy)
    origin:  'self-hosted',
  }, 200, origin);
}

// ─── MAIN FETCH HANDLER ───────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    // Attach ctx to env for waitUntil access in sub-functions
    env.ctx = ctx;

    const url    = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';

    // CORS preflight
    if (request.method === 'OPTIONS') return handleOptions(request);

    // Public health route (no auth)
    if (request.method === 'GET' && url.pathname === '/health') {
      return routeHealth(request, env);
    }

    // All /v1/* routes require auth
    if (url.pathname.startsWith('/v1/')) {
      if (!checkAuth(request, env)) {
        return errResp('Unauthorized', 401, origin);
      }

      if (request.method === 'POST' && url.pathname === '/v1/chat') {
        return routeChat(request, env);
      }
      if (request.method === 'POST' && url.pathname === '/v1/stream') {
        return routeStream(request, env);
      }
      if (request.method === 'POST' && url.pathname === '/v1/embed') {
        return routeEmbed(request, env);
      }

      return errResp('Not found', 404, origin);
    }

    return errResp('Not found', 404, origin);
  },
};
