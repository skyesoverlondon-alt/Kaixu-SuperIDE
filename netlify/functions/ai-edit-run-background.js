// ai-edit-run-background.js — Netlify Background Function (15-min timeout)
//
// Handles long-running AI edit operations that exceed the 10s Netlify limit.
// Client workflow:
//   1. Client generates a UUID jobId
//   2. Client POSTs to /api/ai-edit-run-background with { jobId, messages, model?, workspaceId? }
//   3. Netlify immediately returns 202 — this function runs asynchronously
//   4. Client polls /api/ai-job-status?jobId=X every 2s until status=done|error
//
// Env: KAIXUSI_WORKER_URL, KAIXUSI_SECRET, DATABASE_URL

const { verifyToken, getBearerToken, json } = require('./_lib/auth');
const { readJson }                           = require('./_lib/body');
const { query }                              = require('./_lib/db');
const logger                                 = require('./_lib/logger')('ai-edit-bg');
const { checkRateLimit }                     = require('./_lib/ratelimit');
const { checkQuota, recordUsage }            = require('./_lib/quota');

// ── Re-use the same model map as ai-edit.js ──────────────────────────────────
const DEFAULT_MODEL = 'kAIxU-flash';
const getWorkerUrl  = () => (process.env.KAIXUSI_WORKER_URL || '').replace(/\/+$/, '');

const MODEL_MAP = {
  'kAIxU-flash': {
    provider: process.env.KAIXU_FLASH_PROVIDER || 'gemini',
    model:    process.env.KAIXU_FLASH_MODEL    || 'gemini-2.5-flash',
  },
  'kAIxU-pro': {
    provider: process.env.KAIXU_PRO_PROVIDER || 'anthropic',
    model:    process.env.KAIXU_PRO_MODEL    || 'claude-3-5-sonnet-20241022',
  },
};

function resolveModel(name) {
  return MODEL_MAP[name] || MODEL_MAP[DEFAULT_MODEL];
}

function safeJsonParse(text) {
  const t = String(text || '').trim();
  try { return JSON.parse(t); } catch {}
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s >= 0 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch {} }
  return null;
}

function validateAgentObject(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (!Array.isArray(obj.operations)) return false;
  if (typeof obj.reply !== 'string') return false;
  if (typeof obj.summary !== 'string') return false;
  if (!Array.isArray(obj.touched)) return false;
  for (const op of obj.operations) {
    if (!['create', 'update', 'delete', 'rename'].includes(op.type)) return false;
    if ((op.type === 'create' || op.type === 'update') &&
        (typeof op.path !== 'string' || typeof op.content !== 'string')) return false;
    if (op.type === 'delete' && typeof op.path !== 'string') return false;
    if (op.type === 'rename' && (typeof op.from !== 'string' || typeof op.to !== 'string')) return false;
  }
  return true;
}

function agentSystemPrompt() {
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
- If no changes are needed, operations must be an empty array and touched empty.`;
}

async function gateGenerate({ provider, model, messages, userId, workspaceId, orgId }) {
  const secret = process.env.KAIXUSI_SECRET;
  const base   = getWorkerUrl();
  if (!secret || !base) throw new Error('Missing KAIXUSI_SECRET or KAIXUSI_WORKER_URL');

  const res  = await fetch(`${base}/v1/chat`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider, model,
      messages,
      max_tokens:   8192,
      temperature:  0,
      user_id:      userId      || null,
      workspace_id: workspaceId || null,
      org_id:       orgId       || null,
      app_id:       'kaixu-superide',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Gate error (HTTP ${res.status})`);
  return { text: data.output_text || '', usage: data.usage || {}, model: data.model || model };
}

async function setJobStatus(jobId, status, extra = {}) {
  const setClauses = ['status=$2', 'updated_at=now()'];
  const params = [jobId, status];
  if (extra.result !== undefined) { setClauses.push(`result=$${params.push(JSON.stringify(extra.result))}`); }
  if (extra.error  !== undefined) { setClauses.push(`error=$${params.push(extra.error)}`); }
  if (extra.model  !== undefined) { setClauses.push(`model=$${params.push(extra.model)}`); }
  if (extra.prompt_tokens       !== undefined) { setClauses.push(`prompt_tokens=$${params.push(extra.prompt_tokens)}`); }
  if (extra.completion_tokens   !== undefined) { setClauses.push(`completion_tokens=$${params.push(extra.completion_tokens)}`); }
  if (extra.latency_ms          !== undefined) { setClauses.push(`latency_ms=$${params.push(extra.latency_ms)}`); }
  await query(`UPDATE ai_jobs SET ${setClauses.join(', ')} WHERE id=$1`, params)
    .catch(e => logger.warn('job_update_failed', { jobId, error: e.message }));
}

exports.handler = async (event) => {
  // Background functions don't surface their return value — Netlify already sent 202.
  // We still return so the function exits cleanly.
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };

  // ── Auth ────────────────────────────────────────────────────────────────
  const token = getBearerToken(event);
  if (!token) return { statusCode: 401, body: '' };
  let decoded;
  try { decoded = verifyToken(token); } catch { return { statusCode: 401, body: '' }; }
  const userId = decoded?.sub || decoded?.userId || null;

  // ── Parse body ─────────────────────────────────────────────────────────
  const parsed = await readJson(event);
  if (!parsed.ok) return { statusCode: 400, body: '' };
  const { jobId, messages, model, workspaceId, orgId: bodyOrgId } = parsed.data || {};

  if (!jobId || typeof jobId !== 'string' || jobId.length < 10) {
    return { statusCode: 400, body: JSON.stringify({ error: 'jobId required' }) };
  }

  // ── Create job record ──────────────────────────────────────────────────
  try {
    await query(
      `INSERT INTO ai_jobs (id, user_id, workspace_id, org_id, status)
       VALUES ($1, $2, $3, $4, 'running')
       ON CONFLICT (id) DO UPDATE SET status='running', updated_at=now()`,
      [jobId, userId, workspaceId || null, bodyOrgId || null]
    );
  } catch (e) {
    logger.error('job_insert_failed', { jobId, error: e.message });
    return { statusCode: 500, body: '' };
  }

  // ── Rate limit ─────────────────────────────────────────────────────────
  const limited = await checkRateLimit(userId, 'ai-edit', { maxHits: 20, windowSecs: 60 });
  if (limited) {
    await setJobStatus(jobId, 'error', { error: 'Rate limit exceeded (20 AI calls/min)' });
    return { statusCode: 200, body: '' };
  }

  // ── Kill switch ────────────────────────────────────────────────────────
  try {
    const ks = await query(`SELECT value FROM global_settings WHERE key='ai_enabled'`);
    if (ks.rows[0]?.value === 'false') {
      await setJobStatus(jobId, 'error', { error: 'AI is currently disabled.' });
      return { statusCode: 200, body: '' };
    }
  } catch { /* dev — table may not exist */ }

  // ── Quota ──────────────────────────────────────────────────────────────
  const quota = await checkQuota(userId, bodyOrgId || null);
  if (!quota.allowed) {
    await setJobStatus(jobId, 'error', {
      error: `Monthly AI call limit reached (${quota.used}/${quota.limit}).`,
    });
    return { statusCode: 200, body: '' };
  }
  recordUsage(userId, bodyOrgId || null, workspaceId || null);

  const msgs = Array.isArray(messages) ? messages : [];
  if (!msgs.length) {
    await setJobStatus(jobId, 'error', { error: 'Missing messages[]' });
    return { statusCode: 200, body: '' };
  }

  // ── RAG context injection ──────────────────────────────────────────────
  if (workspaceId) {
    try {
      const lastUser = [...msgs].reverse().find(m => m.role === 'user');
      const qText = typeof lastUser?.content === 'string' ? lastUser.content.slice(0, 500) : '';
      if (qText.length > 10) {
        const fallback = await query(
          `SELECT file_path, chunk_text FROM file_embeddings WHERE workspace_id=$1 ORDER BY updated_at DESC LIMIT 5`,
          [workspaceId]
        );
        const chunks = fallback.rows.map(r => `// ${r.file_path}\n${r.chunk_text}`).join('\n\n---\n\n');
        if (chunks && msgs[0]?.role === 'system') {
          msgs[0].content = `RELEVANT CODEBASE CONTEXT:\n\`\`\`\n${chunks}\n\`\`\`\n\n${msgs[0].content}`;
        }
      }
    } catch (e) { logger.warn('rag_failed', { error: e.message }); }
  }

  // ── AI call ─────────────────────────────────────────────────────────────
  const startMs = Date.now();
  try {
    const brandedName = String(model || DEFAULT_MODEL);
    const { provider, model: resolvedModel } = resolveModel(brandedName);
    const usedModel = `${provider}/${resolvedModel}`;

    const first = await gateGenerate({
      provider, model: resolvedModel,
      messages: [{ role: 'system', content: agentSystemPrompt() }, ...msgs],
      userId, workspaceId, orgId: bodyOrgId,
    });

    let obj = safeJsonParse(first.text);

    if (!validateAgentObject(obj)) {
      // Repair pass
      const repair = await gateGenerate({
        provider, model: resolvedModel,
        messages: [
          { role: 'system', content: 'Convert to valid JSON matching the schema. Output JSON only.' },
          { role: 'user',   content: `RAW_OUTPUT_START\n${first.text}\nRAW_OUTPUT_END` },
        ],
        userId, workspaceId, orgId: bodyOrgId,
      });
      obj = safeJsonParse(repair.text);
    }

    if (!validateAgentObject(obj)) {
      await setJobStatus(jobId, 'error', { error: 'AI returned invalid JSON. Try again.', latency_ms: Date.now() - startMs });
      return { statusCode: 200, body: '' };
    }

    await setJobStatus(jobId, 'done', {
      result: obj,
      model:  usedModel,
      prompt_tokens:     first.usage?.promptTokens     || first.usage?.prompt_tokens     || 0,
      completion_tokens: first.usage?.completionTokens || first.usage?.completion_tokens || 0,
      latency_ms: Date.now() - startMs,
    });

    // Usage log (best-effort)
    query(
      `INSERT INTO ai_usage_log(user_id, workspace_id, model, prompt_tokens, completion_tokens, latency_ms, success)
       VALUES ($1,$2,$3,$4,$5,$6,true)`,
      [userId, workspaceId || null, usedModel,
       first.usage?.promptTokens || 0, first.usage?.completionTokens || 0, Date.now() - startMs]
    ).catch(() => {});

  } catch (err) {
    logger.error('ai_edit_bg_failed', { jobId, error: err.message });
    await setJobStatus(jobId, 'error', { error: String(err?.message || err), latency_ms: Date.now() - startMs });
  }

  return { statusCode: 200, body: '' };
};
