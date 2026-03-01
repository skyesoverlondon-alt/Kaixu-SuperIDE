import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer } from "./_lib/http.js";
import { lookupKey, requireKeyRole } from "./_lib/authz.js";
import { q } from "./_lib/db.js";

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, cors);

  const key = getBearer(req);
  if (!key) return json(401, { error: "Missing Authorization Bearer Kaixu Key" }, cors);

  const krow = await lookupKey(key);
  if (!krow) return json(401, { error: "Invalid Kaixu Key" }, cors);

  requireKeyRole(krow, "viewer");

  const url = new URL(req.url);
  const jobId = (url.searchParams.get("jobId") || "").toString();
  if (!jobId) return badRequest("Missing jobId", cors);

  const r = await q(`select * from gh_push_jobs where job_id=$1 limit 1`, [jobId]);
  if (!r.rowCount) return json(404, { error: "Job not found" }, cors);
  const job = r.rows[0];
  if (job.customer_id !== krow.customer_id) return json(403, { error: "Forbidden" }, cors);

  return json(200, {
    ok: true,
    job: {
      jobId: job.job_id,
      status: job.status,
      owner: job.owner,
      repo: job.repo,
      branch: job.branch,
      commit_message: job.commit_message,
      parts: job.parts,
      received_parts: job.received_parts,
      bytes_staged: job.bytes_staged,
      attempts: job.attempts,
      next_attempt_at: job.next_attempt_at,
      last_error: job.last_error,
      result_commit_sha: job.result_commit_sha,
      result_url: job.result_url,
      created_at: job.created_at,
      updated_at: job.updated_at
    }
  }, cors);
});
