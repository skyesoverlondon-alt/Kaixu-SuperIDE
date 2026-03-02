// embeddings.js — RAG: sync file embeddings and perform semantic search
// Requires env: KAIXUSI_WORKER_URL, KAIXUSI_SECRET, DATABASE_URL
//
// POST { action: 'sync', workspaceId, files: [{path, content}] }
//   → embeds each file (chunked) and upserts into file_embeddings
//
// GET ?workspaceId=&q=&limit=5
//   → returns top-k semantically similar file chunks
//
// NOTE: embeddings route through the KaixuSI Cloudflare Worker.
// Worker endpoint: POST /v1/embed
// Worker response:  { embeddings: [[float, ...], ...], dimensions: 768, kaixusi: true }
// Provider: gemini / model: gemini-embedding-004 / outputDimensionality: 768

const { requireAuth } = require('./_lib/auth');
const { getDb }        = require('./_lib/db');
const { checkRateLimit } = require('./_lib/ratelimit');
const logger           = require('./_lib/logger')('embeddings');

// ── Embedding via KaixuSI Worker ─────────────────────────────────────────
// taskType: 'RETRIEVAL_DOCUMENT' for indexing, 'RETRIEVAL_QUERY' for search
async function embed(texts, taskType = 'RETRIEVAL_DOCUMENT', { userId, workspaceId } = {}) {
  const secret = process.env.KAIXUSI_SECRET;
  if (!secret) throw new Error('KAIXUSI_SECRET not configured');
  const base = (process.env.KAIXUSI_WORKER_URL || '').replace(/\/+$/, '');
  if (!base) throw new Error('KAIXUSI_WORKER_URL not configured');

  // batch in groups of 100
  const batches = [];
  for (let i = 0; i < texts.length; i += 100) batches.push(texts.slice(i, i + 100));

  const allVectors = [];
  for (const batch of batches) {
    const res = await fetch(`${base}/v1/embed`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secret}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        provider:             'gemini',
        model:                'gemini-embedding-004',
        input:                batch,
        taskType,
        outputDimensionality: 768,
        user_id:              userId      || null,
        workspace_id:         workspaceId || null,
        app_id:               'kaixu-superide',
      }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Worker error (${res.status}): ${result.error || JSON.stringify(result)}`);
    // Worker returns: { embeddings: [[float,...], ...], dimensions, provider, latency_ms, kaixusi }
    // Each entry is already a plain float array — no .values wrapping needed.
    allVectors.push(...(result.embeddings || []));
  }
  return allVectors;
}

// ── Chunking ──────────────────────────────────────────────────────────────
const CHUNK_SIZE = 800;  // characters per chunk
const CHUNK_OVERLAP = 100;

function chunkText(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + CHUNK_SIZE));
    start += CHUNK_SIZE - CHUNK_OVERLAP;
    if (start >= text.length) break;
  }
  return chunks;
}

// ── Handler ───────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  let user;
  try { user = await requireAuth(event); }
  catch (e) { return { statusCode: 401, body: e.message }; }

  const db = getDb();

  // ── Rate limit: 10 req/min per user ─────────────────────────────────────
  const limited = await checkRateLimit(user.sub, 'embeddings', { maxHits: 10, windowSecs: 60 });
  if (limited) return { statusCode: 429, body: JSON.stringify({ ok: false, error: 'Too many embedding requests. Limit: 10/min.', retryAfter: 60 }) };

  // ── GET: semantic search ─────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const { workspaceId, q, limit } = event.queryStringParameters || {};
    if (!workspaceId || !q)
      return { statusCode: 400, body: 'workspaceId and q required' };

    // Verify workspace access
    const access = await db.query(
      `SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2
       UNION SELECT 1 FROM workspaces WHERE id=$1 AND user_id=$2`,
      [workspaceId, user.sub]
    );
    if (!access.rows.length)
      return { statusCode: 403, body: 'No access' };

    try {
      const [queryVec] = await embed([q], 'RETRIEVAL_QUERY', { userId: user.sub, workspaceId });
      const k = Math.min(parseInt(limit) || 5, 20);
      const { rows } = await db.query(
        `SELECT file_path, chunk_index, chunk_text,
                1 - (embedding <=> $1::vector) AS similarity
         FROM file_embeddings
         WHERE workspace_id = $2
         ORDER BY embedding <=> $1::vector
         LIMIT $3`,
        [`[${queryVec.join(',')}]`, workspaceId, k]
      );
      return { statusCode: 200, body: JSON.stringify({ results: rows }) };
    } catch (err) {
      logger.exception(err, { action: 'GET' });
      return { statusCode: 500, body: err.message };
    }
  }

  // ── POST: sync embeddings ────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return { statusCode: 400, body: 'Invalid JSON' }; }

    const { action, workspaceId, files } = body;
    if (action !== 'sync') return { statusCode: 400, body: 'action must be "sync"' };
    if (!workspaceId || !Array.isArray(files) || !files.length)
      return { statusCode: 400, body: 'workspaceId and files[] required' };

    // Verify ownership/membership
    const access = await db.query(
      `SELECT 1 FROM workspaces WHERE id=$1 AND user_id=$2
       UNION
       SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 AND role IN ('owner','editor')`,
      [workspaceId, user.sub]
    );
    if (!access.rows.length)
      return { statusCode: 403, body: 'No access' };

    // Only embed text files, skip binaries, cap content at 20KB per file
    const textFiles = files
      .filter(f => typeof f.content === 'string' && f.content.length > 0)
      .map(f => ({ ...f, content: f.content.slice(0, 20000) }));

    if (!textFiles.length)
      return { statusCode: 200, body: JSON.stringify({ synced: 0 }) };

    // Build chunks
    const allChunks = [];
    for (const file of textFiles) {
      const chunks = chunkText(file.content);
      for (let i = 0; i < chunks.length; i++) {
        allChunks.push({ path: file.path, chunkIndex: i, text: chunks[i] });
      }
    }

    if (allChunks.length > 500) {
      return { statusCode: 400, body: 'Too many chunks (max 500 per sync). Sync fewer files at once.' };
    }

    try {
      const texts   = allChunks.map(c => c.text);
      const vectors = await embed(texts, 'RETRIEVAL_DOCUMENT', { userId: user.sub, workspaceId });

      // Upsert in batches of 50
      let synced = 0;
      for (let i = 0; i < allChunks.length; i++) {
        const { path, chunkIndex, text } = allChunks[i];
        const vec = `[${vectors[i].join(',')}]`;
        await db.query(`
          INSERT INTO file_embeddings (workspace_id, file_path, chunk_index, chunk_text, embedding, updated_at)
          VALUES ($1, $2, $3, $4, $5::vector, NOW())
          ON CONFLICT (workspace_id, file_path, chunk_index) DO UPDATE
            SET chunk_text = EXCLUDED.chunk_text,
                embedding  = EXCLUDED.embedding,
                updated_at = NOW()
        `, [workspaceId, path, chunkIndex, text, vec]);
        synced++;
      }

      // Remove stale chunks (files that were deleted)
      await db.query(`
        DELETE FROM file_embeddings
        WHERE workspace_id=$1
          AND (file_path, chunk_index) NOT IN (
            SELECT unnest($2::text[]), unnest($3::int[])
          )
      `, [
        workspaceId,
        allChunks.map(c => c.path),
        allChunks.map(c => c.chunkIndex),
      ]);

      logger.info('sync_complete', { synced, workspaceId });
      return { statusCode: 200, body: JSON.stringify({ synced }) };
    } catch (err) {
      logger.exception(err, { action: 'POST' });
      return { statusCode: 500, body: err.message };
    }
  }

  return { statusCode: 405, body: 'Method not allowed' };
};
