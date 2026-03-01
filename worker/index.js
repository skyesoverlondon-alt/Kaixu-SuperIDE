/**
 * Kaixu Gateway — Cloudflare Worker
 *
 * Routes:
 *   POST /v1/generate  — AI chat completions (used by ai-edit.js)
 *   POST /embeddings   — Text embeddings for RAG (used by embeddings.js)
 *   GET  /health       — Health check
 *
 * Env vars already set on your Worker are used automatically.
 * The code tries every common name so nothing needs to be renamed.
 *
 * To deploy:
 *   1. Go to dash.cloudflare.com → Workers & Pages → kaixu67 → Edit Code
 *   2. Paste this entire file, replacing what's there
 *   3. Click Deploy — no env var changes needed
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-2.5-flash';
const EMBED_MODEL = 'text-embedding-004';

// Try every common name for the Gemini API key
function getGeminiKey(env) {
  return env.GEMINI_API_KEY
    || env.GOOGLE_AI_KEY
    || env.GOOGLE_API_KEY
    || env.AI_API_KEY
    || env.API_KEY
    || null;
}

// Try every common name for the gate auth token
// If none are set, auth is skipped (Netlify-side requireAuth is the real guard)
function getGateToken(env) {
  return env.GATE_TOKEN
    || env.KAIXU_GATE_TOKEN
    || env.AUTH_TOKEN
    || env.SECRET_TOKEN
    || env.TOKEN
    || null;
}


export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // ── CORS headers ──────────────────────────────────────────────────────
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ── Auth ──────────────────────────────────────────────────────────────
    // If a gate token is configured, enforce it. Otherwise skip (Netlify-side
    // requireAuth is the real security boundary).
    if (pathname !== '/health') {
      const gateToken = getGateToken(env);
      if (gateToken) {
        const authHeader = request.headers.get('Authorization') || '';
        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        if (token !== gateToken) {
          return Response.json(
            { ok: false, error: 'Unauthorized' },
            { status: 401, headers: corsHeaders }
          );
        }
      }
    }

    // ── Health ─────────────────────────────────────────────────────────────
    if (pathname === '/health') {
      return Response.json({ ok: true, gateway: 'kaixu', ts: Date.now() }, { headers: corsHeaders });
    }

    // ── POST /v1/generate — Chat completions (Gemini) ─────────────────────
    if (pathname === '/v1/generate' && request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch { return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400, headers: corsHeaders }); }

      const { model, system, messages, generationConfig, output } = body;
      const geminiModel = model || DEFAULT_MODEL;
      const apiKey = getGeminiKey(env);
      if (!apiKey) return Response.json({ ok: false, error: 'Gemini API key not configured on Worker' }, { status: 500, headers: corsHeaders });

      // Build Gemini contents array from messages
      const contents = (messages || []).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
      }));

      // Build system instruction
      const systemInstruction = system
        ? { parts: [{ text: system }] }
        : undefined;

      // Build generation config
      const genConfig = {
        temperature: generationConfig?.temperature ?? 0.0,
        maxOutputTokens: generationConfig?.maxOutputTokens ?? 8192,
        ...(output?.format === 'json' ? { responseMimeType: 'application/json' } : {}),
      };

      const geminiBody = {
        contents,
        generationConfig: genConfig,
        ...(systemInstruction ? { systemInstruction } : {}),
      };

      const geminiUrl = `${GEMINI_BASE}/models/${geminiModel}:generateContent?key=${apiKey}`;

      let geminiRes;
      try {
        geminiRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiBody),
        });
      } catch (err) {
        return Response.json({ ok: false, error: `Gemini fetch failed: ${err.message}` }, { status: 502, headers: corsHeaders });
      }

      const geminiData = await geminiRes.json().catch(() => ({}));

      if (geminiData.error) {
        return Response.json(
          { ok: false, error: geminiData.error.message || JSON.stringify(geminiData.error) },
          { status: 502, headers: corsHeaders }
        );
      }

      // Extract text from response
      const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

      return Response.json(
        { ok: true, text, model: geminiModel, raw: geminiData },
        { headers: corsHeaders }
      );
    }

    // ── POST /embeddings — Text embeddings for RAG (Gemini) ───────────────
    if (pathname === '/embeddings' && request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch { return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400, headers: corsHeaders }); }

      const { input } = body;
      if (!Array.isArray(input) || input.length === 0) {
        return Response.json({ ok: false, error: 'input must be a non-empty array of strings' }, { status: 400, headers: corsHeaders });
      }

      const apiKey = getGeminiKey(env);
      if (!apiKey) return Response.json({ ok: false, error: 'Gemini API key not configured on Worker' }, { status: 500, headers: corsHeaders });

      // Gemini embedContent is one string at a time — run in parallel (max 20 at once)
      const CHUNK = 20;
      const allEmbeddings = [];

      for (let i = 0; i < input.length; i += CHUNK) {
        const batch = input.slice(i, i + CHUNK);
        const results = await Promise.all(batch.map(async (text) => {
          const res = await fetch(
            `${GEMINI_BASE}/models/${EMBED_MODEL}:embedContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: `models/${EMBED_MODEL}`,
                content: { parts: [{ text: String(text) }] }
              }),
            }
          );
          const data = await res.json().catch(() => ({}));
          if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
          return { embedding: data.embedding.values };
        }));
        allEmbeddings.push(...results);
      }

      return Response.json({ data: allEmbeddings }, { headers: corsHeaders });
    }

    // ── 404 ───────────────────────────────────────────────────────────────
    return Response.json({ ok: false, error: `Unknown route: ${pathname}` }, { status: 404, headers: corsHeaders });
  }
};
