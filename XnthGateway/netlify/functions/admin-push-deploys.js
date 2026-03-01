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
 * Admin deploy history.
 * GET /.netlify/functions/admin-push-deploys?customer_id=123&month=YYYY-MM&project_id=foo&limit=200
 */
export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  const admin = requireAdmin(req);
  if (!admin) return json(401, { error: "Unauthorized" }, cors);
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, cors);

  const url = new URL(req.url);
  const customer_id = url.searchParams.get("customer_id") ? parseInt(url.searchParams.get("customer_id"), 10) : null;
  const project_id = (url.searchParams.get("project_id") || "").toString().trim();
  const month = (url.searchParams.get("month") || monthKeyUTC()).toString().slice(0, 7);
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") || "200", 10)));

  if (!customer_id) return badRequest("Missing customer_id", cors);
  if (!/^\d{4}-\d{2}$/.test(month)) return badRequest("Invalid month. Use YYYY-MM", cors);

  const range = monthRangeUTC(month);
  if (!range) return badRequest("Invalid month. Use YYYY-MM", cors);

  const params = [customer_id, range.start.toISOString(), range.end.toISOString()];
  let where = "p.customer_id=$1 and p.created_at >= $2 and p.created_at < $3";
  if (project_id) {
    params.push(project_id);
    where += ` and pr.project_id=$${params.length}`;
  }
  params.push(limit);

  const res = await q(
    `select
        p.id as push_row_id,
        p.push_id,
        p.branch,
        p.title,
        p.deploy_id,
        p.state,
        p.url,
        p.error,
        cardinality(p.required_digests)::int as required_count,
        cardinality(p.uploaded_digests)::int as uploaded_count,
        pr.project_id,
        pr.name as project_name,
        pr.netlify_site_id,
        p.created_at,
        p.updated_at
     from push_pushes p
     join push_projects pr on pr.id = p.project_row_id
     where ${where}
     order by p.created_at desc
     limit $${params.length}`,
    params
  );

  return json(200, { month, deploys: res.rows }, cors);
});
