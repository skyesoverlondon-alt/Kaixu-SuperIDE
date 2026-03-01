import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer } from "./_lib/http.js";
import { lookupKey, requireKeyRole } from "./_lib/authz.js";
import { q } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, cors);

  const workerSecret = (process.env.JOB_WORKER_SECRET || "").trim();
  if (!workerSecret) return json(500, { error: "Missing JOB_WORKER_SECRET", code: "CONFIG" }, cors);

  const key = getBearer(req);
  if (!key) return json(401, { error: "Missing Authorization Bearer Kaixu Key" }, cors);

  const krow = await lookupKey(key);
  if (!krow) return json(401, { error: "Invalid Kaixu Key" }, cors);

  requireKeyRole(krow, "deployer");

  let body;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }
  const jobId = (body.jobId || "").toString();
  if (!jobId) return badRequest("Missing jobId", cors);

  const j = await q(`select id, customer_id, parts, received_parts, status from gh_push_jobs where job_id=$1 limit 1`, [jobId]);
  if (!j.rowCount) return json(404, { error: "Job not found" }, cors);
  const job = j.rows[0];
  if (job.customer_id !== krow.customer_id) return json(403, { error: "Forbidden" }, cors);

  const parts = parseInt(job.parts, 10);
  if (!parts || parts < 1) return json(409, { error: "No chunks uploaded yet (parts not set)" }, cors);

  const received = new Set(job.received_parts || []);
  for (let i = 0; i < parts; i++) {
    if (!received.has(i)) return json(409, { error: `Missing chunk part ${i}`, code: "PARTS_INCOMPLETE" }, cors);
  }

  await q(`update gh_push_jobs set status='queued', updated_at=now() where id=$1`, [job.id]);

  // Trigger background worker
  const origin = process.env.URL || new URL(req.url).origin;
  await fetch(`${origin}/.netlify/functions/gh-push-background`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kaixu-job-secret": workerSecret
    },
    body: JSON.stringify({ jobId })
  });

  await q(
    `insert into gh_push_events(customer_id, api_key_id, job_row_id, event_type, bytes, meta)
     values ($1,$2,$3,'queue',0,$4::jsonb)`,
    [krow.customer_id, krow.api_key_id, job.id, JSON.stringify({ parts })]
  );

  await audit(`key:${krow.key_last4}`, "GITHUB_PUSH_QUEUE", `gh:${jobId}`, { parts });

  return json(202, { ok: true, queued: true, jobId }, cors);
});
