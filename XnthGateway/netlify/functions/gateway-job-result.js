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

  const r = await q(`select id, customer_id, provider, model, status, created_at, started_at, completed_at, input_tokens, output_tokens, cost_cents, error, output_text
                    from async_jobs where id = $1`, [id]);
  if (!r.rows.length) return json(404, { error: "Not found" }, cors);
  const job = r.rows[0];

  if (String(job.customer_id) !== String(keyRow.customer_id)) return json(404, { error: "Not found" }, cors);

  if (job.status === "succeeded") {
    return json(200, {
      provider: job.provider,
      model: job.model,
      output_text: job.output_text || "",
      usage: { input_tokens: job.input_tokens || 0, output_tokens: job.output_tokens || 0, cost_cents: job.cost_cents || 0 },
      job: { id: job.id, status: job.status, created_at: job.created_at, started_at: job.started_at, completed_at: job.completed_at }
    }, cors);
  }

  if (job.status === "failed") return json(500, { error: job.error || "Job failed", job: { id: job.id, status: job.status } }, cors);

  return json(202, { status: job.status, job: { id: job.id, created_at: job.created_at, started_at: job.started_at } }, cors);
});
