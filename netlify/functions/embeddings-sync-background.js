// embeddings-sync-background.js — Netlify Background Function (15-min timeout)
//
// Handles bulk embedding sync for large workspaces without hitting the 10s limit.
// Client fires this and forgets — no polling needed (indexing is background work).
//
// POST body: { workspaceId, files: [{ path, content }] }
// Auth: Bearer JWT token required
//
// Env: KAIXUSI_WORKER_URL, KAIXUSI_SECRET, DATABASE_URL

const { verifyToken, getBearerToken } = require('./_lib/auth');
const { getDb }                       = require('./_lib/db');
const { checkRateLimit }              = require('./_lib/ratelimit');
const logger                          = require('./_lib/logger')('embed-sync-bg');

const CHUNK_SIZE = 1500; // chars per chunk for indexing

function chunkContent(content) {
  const chunks = [];
  for (let i = 0; i < content.length; i += CHUNK_SIZE) {
    chunks.push(content.slice(i, i + CHUNK_SIZE));
  }
  return chunks.length ? chunks : [content.slice(0, CHUNK_SIZE)];
}

async function embedTexts(texts, taskType = 'RETRIEVAL_DOCUMENT') {
  const secret = process.env.KAIXUSI_SECRET;
  const base   = (process.env.KAIXUSI_WORKER_URL || '').replace(/\/+$/, '');
  if (!secret || !base) throw new Error('Missing KAIXUSI_SECRET or KAIXUSI_WORKER_URL');

  // Batch in groups of 100
  const allVectors = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const res = await fetch(`${base}/v1/embed`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: 'kaixu-embed', input: batch, taskType }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Embed error ${res.status}`);
    allVectors.push(...(data.embeddings || []));
  }
  return allVectors;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };

  // ── Auth ────────────────────────────────────────────────────────────────
  const token = getBearerToken(event);
  if (!token) return { statusCode: 401, body: '' };
  let decoded;
  try { decoded = verifyToken(token); } catch { return { statusCode: 401, body: '' }; }
  const userId = decoded?.sub || null;

  // ── Parse ───────────────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: '' }; }
  const { workspaceId, files } = body;
  if (!workspaceId || !Array.isArray(files) || !files.length) return { statusCode: 400, body: '' };

  // ── Rate limit: 5 full syncs / hour ────────────────────────────────────
  const limited = await checkRateLimit(userId, 'embeddings-sync', { maxHits: 5, windowSecs: 3600 });
  if (limited) {
    logger.warn('rate_limited', { userId, workspaceId });
    return { statusCode: 200, body: '' };
  }

  // ── Process all files ───────────────────────────────────────────────────
  const db = getDb();
  let totalChunks = 0;
  let totalFiles  = 0;

  const TEXT_EXTS = /\.(js|ts|jsx|tsx|mjs|cjs|html|htm|css|scss|less|json|jsonc|md|txt|yaml|yml|toml|env|sh|bash|py|rb|go|rs|java|c|cpp|h|hpp|cs|php|sql|graphql|svelte|vue|astro|xml|csv|ini|cfg|conf)$/i;

  for (const file of files) {
    if (!TEXT_EXTS.test(file.path)) continue;
    if (!file.content || file.content.length > 100000) continue;

    try {
      const chunks = chunkContent(file.content);
      const vectors = await embedTexts(chunks);

      // Upsert each chunk row
      for (let i = 0; i < chunks.length; i++) {
        const vec = vectors[i];
        if (!vec) continue;
        await db.query(
          `INSERT INTO file_embeddings (workspace_id, file_path, chunk_index, chunk_text, embedding, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (workspace_id, file_path, chunk_index)
           DO UPDATE SET chunk_text=EXCLUDED.chunk_text, embedding=EXCLUDED.embedding, updated_at=now()`,
          [workspaceId, file.path, i, chunks[i], JSON.stringify(vec)]
        );
        totalChunks++;
      }
      totalFiles++;
    } catch (err) {
      logger.warn('file_embed_failed', { path: file.path, error: err.message });
      // Continue with remaining files
    }
  }

  logger.info('sync_complete', { userId, workspaceId, totalFiles, totalChunks });
  return { statusCode: 200, body: '' };
};
