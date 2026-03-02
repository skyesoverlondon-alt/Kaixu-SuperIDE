// ai-job-status.js — Poll the status of an async AI background job
//
// GET /.netlify/functions/ai-job-status?jobId=<uuid>
//
// Response while pending/running:
//   { ok: true, status: 'queued'|'running', jobId }
//
// Response when done:
//   { ok: true, status: 'done', jobId, result: { reply, summary, operations, touched }, model, latency_ms }
//
// Response on error:
//   { ok: false, status: 'error', jobId, error: "..." }
//
// Returns 404 if jobId not found (job may have expired or never been created).
// Jobs are readable only by their creator user.

const { verifyToken, getBearerToken, json } = require('./_lib/auth');
const { query }                             = require('./_lib/db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'GET only' });

  const token = getBearerToken(event);
  if (!token) return json(401, { ok: false, error: 'Not authenticated' });
  let decoded;
  try { decoded = verifyToken(token); } catch { return json(401, { ok: false, error: 'Invalid token' }); }
  const userId = decoded?.sub || decoded?.userId || null;

  const { jobId } = event.queryStringParameters || {};
  if (!jobId) return json(400, { ok: false, error: 'jobId required' });

  try {
    const res = await query(
      `SELECT id, status, result, error, model, prompt_tokens, completion_tokens, latency_ms, created_at, updated_at
       FROM ai_jobs
       WHERE id=$1 AND user_id=$2`,
      [jobId, userId]
    );

    const row = res.rows[0];
    if (!row) return json(404, { ok: false, error: 'Job not found or not yours' });

    if (row.status === 'done') {
      return json(200, {
        ok:       true,
        status:   'done',
        jobId:    row.id,
        result:   row.result,
        model:    row.model,
        latency_ms: row.latency_ms,
        prompt_tokens:     row.prompt_tokens,
        completion_tokens: row.completion_tokens,
      });
    }

    if (row.status === 'error') {
      return json(200, {
        ok:     false,
        status: 'error',
        jobId:  row.id,
        error:  row.error || 'Unknown error',
      });
    }

    // queued or running
    return json(200, {
      ok:     true,
      status: row.status,
      jobId:  row.id,
    });
  } catch (err) {
    return json(500, { ok: false, error: err.message });
  }
};
