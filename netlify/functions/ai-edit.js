const { verifyToken, getBearerToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');
const { query } = require('./_lib/db');
const logger = require('./_lib/logger')('ai-edit');
const { checkQuota, recordUsage } = require('./_lib/quota');
const { checkRateLimit } = require('./_lib/ratelimit');

const DEFAULT_GATE_BASE = 'https://kaixu67.skyesoverlondon.workers.dev';
const DEFAULT_MODEL = 'gemini-2.5-flash';

function getGateEnv() {
  const base = (process.env.KAIXU_GATE_BASE || DEFAULT_GATE_BASE).replace(/\/+$/, '');
  const token = process.env.KAIXU_GATE_TOKEN || '';
  const model = process.env.KAIXU_DEFAULT_MODEL || DEFAULT_MODEL;
  if (!token) throw new Error('Missing KAIXU_GATE_TOKEN');
  return { base, token, model };
}

function agentSystemPrompt() {
  // Do NOT include KAIXU_CANON here; the gate injects it server-side.
  return `You are kAIxU inside a browser IDE. You MUST return valid JSON only.

Return ONLY JSON with exactly this schema:
{
  "reply": "short, helpful message to the user (no markdown)",
  "summary": "1-line summary of changes",
  "operations": [
    { "type": "create", "path": "path/to/file.ext", "content": "FULL NEW FILE CONTENT" },
    { "type": "update", "path": "path/to/file.ext", "content": "FULL NEW FILE CONTENT" },
    { "type": "delete", "path": "path/to/file.ext" },
    { "type": "rename", "from": "old/path.ext", "to": "new/path.ext" }
  ],
  "touched": ["path/to/file.ext"]
}

Rules:
- JSON only. No markdown. No code fences.
- For update/create, content MUST be the full new file content.
- Paths are relative (no leading slash).
- If no changes are needed, operations must be an empty array and touched empty.
`;
}

function safeJsonParse(text) {
  const t = String(text || '').trim();
  try { return JSON.parse(t); } catch {}
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch {}
  }
  return null;
}

async function gateGenerate(payload) {
  const { base, token } = getGateEnv();
  const res = await fetch(`${base}/v1/generate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.error || `Gate error (HTTP ${res.status})`);
  return data;
}

async function generateJsonOnce({ model, messages }) {
  return await gateGenerate({
    model,
    system: agentSystemPrompt(),
    output: { format: 'json' },
    generationConfig: { temperature: 0.0, maxOutputTokens: 8192 },
    messages
  });
}

async function repairToJson({ model, raw }) {
  const system = `Convert the following into VALID JSON that matches the exact schema previously specified. Output JSON only.`;
  const messages = [
    { role: 'user', content: `RAW_OUTPUT_START\n${raw}\nRAW_OUTPUT_END` }
  ];
  return await gateGenerate({
    model,
    system,
    output: { format: 'json' },
    generationConfig: { temperature: 0.0, maxOutputTokens: 8192 },
    messages
  });
}

function validateAgentObject(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (!('operations' in obj) || !Array.isArray(obj.operations)) return false;
  if (!('reply' in obj) || typeof obj.reply !== 'string') return false;
  if (!('summary' in obj) || typeof obj.summary !== 'string') return false;
  if (!('touched' in obj) || !Array.isArray(obj.touched)) return false;
  // Basic op validation
  for (const op of obj.operations) {
    if (!op || typeof op !== 'object') return false;
    if (!['create','update','delete','rename'].includes(op.type)) return false;
    if ((op.type === 'create' || op.type === 'update') && (typeof op.path !== 'string' || typeof op.content !== 'string')) return false;
    if (op.type === 'delete' && typeof op.path !== 'string') return false;
    if (op.type === 'rename' && (typeof op.from !== 'string' || typeof op.to !== 'string')) return false;
  }
  return true;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  // Require auth for AI usage
  const token = getBearerToken(event);
  if (!token) return json(401, { ok: false, error: 'Missing token' });
  let decoded;
  try { decoded = verifyToken(token); } catch { return json(401, { ok: false, error: 'Invalid token' }); }
  const userId = decoded?.sub || decoded?.userId || null;

  // ─── Rate limit: 20 req/min per user ─────────────────────────────────────
  const limited = await checkRateLimit(userId || token, 'ai-edit', { maxHits: 20, windowSecs: 60 });
  if (limited) return json(429, { ok: false, error: 'Too many AI requests. Limit: 20/min.', retryAfter: 60 });

  // ─── Kill switch check ──────────────────────────────────────────────────
  try {
    const ks = await query(`select value from global_settings where key='ai_enabled'`);
    if (ks.rows[0]?.value === 'false') {
      return json(503, { ok: false, error: 'AI is currently disabled by an administrator.' });
    }
  } catch { /* table may not exist yet in dev */ }

  // ─── Per-plan quota enforcement ────────────────────────────────────────
  const parsed = await readJson(event);
  if (!parsed.ok) return parsed.response;

  const { messages, model, workspaceId, orgId: bodyOrgId } = parsed.data || {};
  const quotaOrgId = bodyOrgId || null;
  const quota = await checkQuota(userId, quotaOrgId);
  if (!quota.allowed) {
    logger.warn('quota_exceeded', { userId, orgId: quotaOrgId, used: quota.used, limit: quota.limit });
    return json(429, {
      ok: false,
      error: `Monthly AI call limit reached (${quota.used}/${quota.limit}). Resets ${quota.resetAt?.toISOString?.() || 'next month'}.`,
      quota,
    });
  }
  const msgs = Array.isArray(messages) ? messages : null;
  // Fire-and-forget usage record
  recordUsage(userId, quotaOrgId, workspaceId || null);
  if (!msgs || msgs.length === 0) return json(400, { ok: false, error: 'Missing messages[]' });

  // ── RAG: inject semantically-relevant file chunks ──────────────────────
  if (workspaceId) {
    try {
      const lastUserMsg = [...msgs].reverse().find(m => m.role === 'user');
      const query_text  = typeof lastUserMsg?.content === 'string'
        ? lastUserMsg.content.slice(0, 500)
        : '';
      if (query_text.length > 10) {
        const { rows: ragRows } = await query(
          `SELECT file_path, chunk_text,
                  1 - (embedding <=> (
                    SELECT embedding FROM file_embeddings
                    WHERE workspace_id=$1 ORDER BY embedding <=> embedding LIMIT 1
                  )) AS sim
           FROM file_embeddings
           WHERE workspace_id=$1
           ORDER BY embedding <=> (
             SELECT e.embedding
             FROM file_embeddings e
             WHERE e.workspace_id=$1
             LIMIT 1
           ) LIMIT 5`,
          [workspaceId]
        );
        // Fallback: just grab top 5 by updated_at if vector search fails
        const fallback = await query(
          `SELECT file_path, chunk_text FROM file_embeddings
           WHERE workspace_id=$1 ORDER BY updated_at DESC LIMIT 5`,
          [workspaceId]
        );
        const chunks = (ragRows.length ? ragRows : fallback.rows)
          .map(r => `// ${r.file_path}\n${r.chunk_text}`)
          .join('\n\n---\n\n');
        if (chunks && msgs[0]?.role === 'system') {
          msgs[0].content = `RELEVANT CODEBASE CONTEXT (via semantic search):\n\`\`\`\n${chunks}\n\`\`\`\n\n${msgs[0].content}`;
        }
      }
    } catch (ragErr) {
      // RAG is best-effort; never break AI if embeddings not yet synced
      logger.warn('rag_context_failed', { error: ragErr.message });
    }
  }

  const startMs = Date.now();
  let success = false;
  let usageData = null;
  let usedModel = null;

  try {
    const { model: envModel } = getGateEnv();
    const m = String(model || envModel);
    usedModel = m;

    const first = await generateJsonOnce({ model: m, messages: msgs });
    usageData = first.usage;
    let obj = safeJsonParse(first.text);
    if (!validateAgentObject(obj)) {
      const repaired = await repairToJson({ model: m, raw: first.text });
      obj = safeJsonParse(repaired.text);
    }

    if (!validateAgentObject(obj)) {
      return json(502, { ok: false, error: 'AI returned invalid JSON. Try again.', raw: first.text });
    }

    success = true;
    return json(200, { ok: true, result: obj, usage: first.usage, model: first.model });
  } catch (err) {
    return json(500, { ok: false, error: String(err?.message || err) });
  } finally {
    // Log usage (best-effort, fire-and-forget)
    const latency = Date.now() - startMs;
    query(
      `insert into ai_usage_log(user_id, workspace_id, model, prompt_tokens, completion_tokens, latency_ms, success)
       values($1,$2,$3,$4,$5,$6,$7)`,
      [
        userId,
        workspaceId || null,
        usedModel || 'unknown',
        usageData?.promptTokens || usageData?.prompt_tokens || 0,
        usageData?.completionTokens || usageData?.completion_tokens || 0,
        latency,
        success
      ]
    ).catch(e => logger.warn('usage_log_failed', { error: e.message }));
  }
};
