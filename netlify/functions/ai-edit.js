const { verifyToken, getBearerToken, json } = require('./_lib/auth');
const { readJson } = require('./_lib/body');

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
  try {
    verifyToken(token);
  } catch {
    return json(401, { ok: false, error: 'Invalid token' });
  }

  const parsed = await readJson(event);
  if (!parsed.ok) return parsed.response;

  const { messages, model } = parsed.data || {};
  const msgs = Array.isArray(messages) ? messages : null;
  if (!msgs || msgs.length === 0) return json(400, { ok: false, error: 'Missing messages[]' });

  try {
    const { model: envModel } = getGateEnv();
    const m = String(model || envModel);

    const first = await generateJsonOnce({ model: m, messages: msgs });
    let obj = safeJsonParse(first.text);
    if (!validateAgentObject(obj)) {
      const repaired = await repairToJson({ model: m, raw: first.text });
      obj = safeJsonParse(repaired.text);
    }

    if (!validateAgentObject(obj)) {
      return json(502, { ok: false, error: 'AI returned invalid JSON. Try again.', raw: first.text });
    }

    return json(200, { ok: true, result: obj, usage: first.usage, model: first.model });
  } catch (err) {
    return json(500, { ok: false, error: String(err?.message || err) });
  }
};
