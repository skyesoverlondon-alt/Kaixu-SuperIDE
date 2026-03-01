import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer } from "./_lib/http.js";
import { q } from "./_lib/db.js";
import { lookupKey, requireKeyRole } from "./_lib/authz.js";

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
  const pushId = (url.searchParams.get("pushId") || "").toString();
  const sha1 = (url.searchParams.get("sha1") || "").toString().toLowerCase();
  if (!pushId) return badRequest("Missing pushId", cors);
  if (!/^[a-f0-9]{40}$/.test(sha1)) return badRequest("Missing/invalid sha1", cors);

  const pres = await q(`select id, customer_id from push_pushes where push_id=$1 limit 1`, [pushId]);
  if (!pres.rowCount) return json(404, { error: "Push not found" }, cors);
  const push = pres.rows[0];
  if (push.customer_id !== krow.customer_id) return json(403, { error: "Forbidden" }, cors);

  const j = await q(
    `select sha1, deploy_path, parts, received_parts, status, error, created_at, updated_at
     from push_jobs where push_row_id=$1 and sha1=$2 limit 1`,
    [push.id, sha1]
  );
  if (!j.rowCount) return json(404, { error: "Job not found" }, cors);

  return json(200, { job: j.rows[0] }, cors);
});
