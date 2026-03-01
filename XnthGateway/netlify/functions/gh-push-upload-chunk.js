import { getStore } from "@netlify/blobs";
import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer } from "./_lib/http.js";
import { lookupKey, requireKeyRole } from "./_lib/authz.js";
import { q } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";

function store() {
  return getStore({ name: "kaixu_github_push_chunks", consistency: "strong" });
}

function intParam(v) {
  const n = parseInt(String(v || ""), 10);
  return Number.isFinite(n) ? n : null;
}

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "PUT") return json(405, { error: "Method not allowed" }, cors);

  const key = getBearer(req);
  if (!key) return json(401, { error: "Missing Authorization Bearer Kaixu Key" }, cors);

  const krow = await lookupKey(key);
  if (!krow) return json(401, { error: "Invalid Kaixu Key" }, cors);

  requireKeyRole(krow, "deployer");

  const url = new URL(req.url);
  const jobId = (url.searchParams.get("jobId") || "").toString();
  const part = intParam(url.searchParams.get("part"));
  const parts = intParam(url.searchParams.get("parts"));

  if (!jobId) return badRequest("Missing jobId", cors);
  if (part === null || part < 0) return badRequest("Invalid part", cors);
  if (parts === null || parts < 1) return badRequest("Invalid parts", cors);
  if (part >= parts) return badRequest("part must be < parts", cors);

  const j = await q(`select id, customer_id, parts, part_bytes from gh_push_jobs where job_id=$1 limit 1`, [jobId]);
  if (!j.rowCount) return json(404, { error: "Job not found" }, cors);
  const job = j.rows[0];
  if (job.customer_id !== krow.customer_id) return json(403, { error: "Forbidden" }, cors);

  const ab = await req.arrayBuffer();
  const buf = Buffer.from(ab);

  // Store chunk (zip) in blobs
  await store().set(`ghzip/${jobId}/${part}`, buf, { metadata: { part, parts } });

  const partKey = String(part);
  const existing = (job.part_bytes && typeof job.part_bytes === "object") ? job.part_bytes[partKey] : null;
  const prev = existing ? parseInt(existing, 10) : 0;
  const delta = Math.max(0, buf.length - (Number.isFinite(prev) ? prev : 0));

  await q(
    `update gh_push_jobs
     set parts = $2,
         received_parts = case when not (received_parts @> array[$3]) then array_append(received_parts, $3) else received_parts end,
         part_bytes = part_bytes || $4::jsonb,
         bytes_staged = (
           select coalesce(sum((value)::bigint),0) from jsonb_each_text(part_bytes || $4::jsonb)
         ),
         updated_at = now()
     where id = $1`,
    [job.id, parts, part, JSON.stringify({ [partKey]: buf.length })]
  );

  await q(
    `insert into gh_push_events(customer_id, api_key_id, job_row_id, event_type, bytes, meta)
     values ($1,$2,$3,'chunk', $4, $5::jsonb)`,
    [krow.customer_id, krow.api_key_id, job.id, delta, JSON.stringify({ part, parts, chunk_bytes: buf.length })]
  );

  await audit(`key:${krow.key_last4}`, "GITHUB_PUSH_CHUNK", `gh:${jobId}`, { part, parts, bytes: buf.length });

  return json(200, { ok: true, jobId, part, parts, bytes: buf.length }, cors);
});
