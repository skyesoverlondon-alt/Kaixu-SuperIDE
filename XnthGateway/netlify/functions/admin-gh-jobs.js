import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest } from "./_lib/http.js";
import { requireAdmin } from "./_lib/admin.js";
import { q } from "./_lib/db.js";

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, cors);

  const admin = requireAdmin(req);
  if (!admin) return json(401, { error: "Unauthorized" }, cors);

  const url = new URL(req.url);
  const customer_id = parseInt((url.searchParams.get("customer_id") || "").trim(), 10);
  const limit = parseInt((url.searchParams.get("limit") || "50").trim(), 10);
  if (!Number.isFinite(customer_id)) return badRequest("Missing customer_id", cors);

  const lim = Number.isFinite(limit) && limit > 0 && limit <= 200 ? limit : 50;

  const r = await q(
    `select job_id, owner, repo, branch, commit_message, parts, bytes_staged, status,
            attempts, next_attempt_at, last_error, last_error_at,
            result_commit_sha, result_url,
            created_at, updated_at
     from gh_push_jobs
     where customer_id=$1
     order by updated_at desc
     limit $2`,
    [customer_id, lim]
  );

  return json(200, { ok: true, jobs: r.rows }, cors);
});
