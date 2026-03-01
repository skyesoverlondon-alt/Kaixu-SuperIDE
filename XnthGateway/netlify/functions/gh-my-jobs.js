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
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "25", 10)));

  const r = await q(
    `select job_id, owner, repo, branch, status, attempts, next_attempt_at, last_error, result_commit_sha, result_url,
            created_at, updated_at
     from gh_push_jobs
     where customer_id=$1
     order by created_at desc
     limit $2`,
    [krow.customer_id, limit]
  );

  return json(200, { ok: true, jobs: r.rows }, cors);
});
