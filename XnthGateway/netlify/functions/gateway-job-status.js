import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer } from "./_lib/http.js";
import { q } from "./_lib/db.js";
import { resolveAuth } from "./_lib/authz.js";

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, cors);

  const key = getBearer(req);
  if (!key) return json(401, { error: "Missing Authorization: Bearer <virtual_key>" }, cors);

  const url = new URL(req.url);
  const id = (url.searchParams.get("id") || "").trim();
  if (!id) return badRequest("Missing ?id=<job_id>", cors);

  const keyRow = await resolveAuth(key);
  if (!keyRow) return json(401, { error: "Invalid or revoked key" }, cors);

  const r = await q(`select id, customer_id, api_key_id, provider, model, status, created_at, started_at, completed_at, heartbeat_at, input_tokens, output_tokens, cost_cents, error,
                    length(coalesce(output_text,'')) as output_len
                    from async_jobs where id = $1`, [id]);
  if (!r.rows.length) return json(404, { error: "Not found" }, cors);
  const job = r.rows[0];

  // Ownership check (avoid enumeration)
  if (String(job.customer_id) !== String(keyRow.customer_id)) return json(404, { error: "Not found" }, cors);

  // Optional: kick/re-kick worker if requested
  const kick = (url.searchParams.get("kick") || "").trim();
  if (kick === "1" && (job.status === "queued" || job.status === "running")) {
    const base = new URL(req.url);
    const workerUrl = new URL("/.netlify/functions/gateway-job-run-background", base);
    const secret = (process.env.JOB_WORKER_SECRET || "").trim();
    try {
      await fetch(workerUrl.toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(secret ? { "x-kaixu-job-secret": secret } : { "authorization": `Bearer ${key}` })
        },
        body: JSON.stringify({ id })
      });
    } catch {}
  }

  return json(200, { job }, cors);
});
