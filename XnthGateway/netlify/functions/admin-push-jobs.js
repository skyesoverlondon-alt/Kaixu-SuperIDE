import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, monthKeyUTC } from "./_lib/http.js";
import { requireAdmin } from "./_lib/admin.js";
import { q } from "./_lib/db.js";

function monthRangeUTC(month) {
  const [y, m] = String(month || "").split("-").map((x) => parseInt(x, 10));
  if (!y || !m || m < 1 || m > 12) return null;
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, 0, 0, 0));
  return { start, end };
}

/**
 * Admin chunk job status.
 * GET /.netlify/functions/admin-push-jobs?customer_id=123&month=YYYY-MM&push_id=push_xxx&limit=200
 */
export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  const admin = requireAdmin(req);
  if (!admin) return json(401, { error: "Unauthorized" }, cors);
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, cors);

  const url = new URL(req.url);
  const customer_id = url.searchParams.get("customer_id") ? parseInt(url.searchParams.get("customer_id"), 10) : null;
  const push_id = (url.searchParams.get("push_id") || "").toString().trim();
  const month = (url.searchParams.get("month") || monthKeyUTC()).toString().slice(0, 7);
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") || "200", 10)));

  if (!customer_id) return badRequest("Missing customer_id", cors);
  if (!/^\d{4}-\d{2}$/.test(month)) return badRequest("Invalid month. Use YYYY-MM", cors);

  const range = monthRangeUTC(month);
  if (!range) return badRequest("Invalid month. Use YYYY-MM", cors);

  const params = [customer_id, range.start.toISOString(), range.end.toISOString()];
  let where = "p.customer_id=$1 and p.created_at >= $2 and p.created_at < $3";
  if (push_id) {
    params.push(push_id);
    where += ` and p.push_id=$${params.length}`;
  }
  params.push(limit);

  const res = await q(
    `select
        j.id as job_id,
        p.push_id,
        pr.project_id,
        j.sha1,
        j.deploy_path,
        j.parts,
        cardinality(j.received_parts)::int as received_count,
        j.bytes_staged,
        j.status,
        j.error,
        j.created_at,
        j.updated_at
     from push_jobs j
     join push_pushes p on p.id = j.push_row_id
     join push_projects pr on pr.id = p.project_row_id
     where ${where}
     order by j.updated_at desc
     limit $${params.length}`,
    params
  );

  return json(200, { month, jobs: res.rows }, cors);
});
