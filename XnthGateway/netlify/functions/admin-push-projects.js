import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest } from "./_lib/http.js";
import { requireAdmin } from "./_lib/admin.js";
import { q } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";

/**
 * Admin KaixuPush project registry.
 * GET  /.netlify/functions/admin-push-projects?customer_id=123
 * POST /.netlify/functions/admin-push-projects  { customer_id, project_id, name, netlify_site_id }
 * PATCH /.netlify/functions/admin-push-projects { customer_id, id|project_id, ...fields }
 * DELETE /.netlify/functions/admin-push-projects { customer_id, id|project_id }
 */
export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  const admin = requireAdmin(req);
  if (!admin) return json(401, { error: "Unauthorized" }, cors);

  const url = new URL(req.url);

  if (req.method === "GET") {
    const customer_id = url.searchParams.get("customer_id") ? parseInt(url.searchParams.get("customer_id"), 10) : null;
    if (!customer_id) return badRequest("Missing customer_id", cors);

    const res = await q(
      `select id, project_id, name, netlify_site_id, created_at, updated_at
       from push_projects
       where customer_id=$1
       order by created_at desc`,
      [customer_id]
    );
    return json(200, { projects: res.rows }, cors);
  }

  let body;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }

  const customer_id = body.customer_id != null ? parseInt(body.customer_id, 10) : null;
  if (!customer_id) return badRequest("Missing customer_id", cors);

  if (req.method === "POST") {
    const project_id = (body.project_id || body.projectId || "").toString().trim();
    const name = (body.name || "").toString().trim();
    const netlify_site_id = (body.netlify_site_id || body.netlifySiteId || "").toString().trim();

    if (!project_id) return badRequest("Missing project_id", cors);
    if (!name) return badRequest("Missing name", cors);
    if (!netlify_site_id) return badRequest("Missing netlify_site_id", cors);

    const res = await q(
      `insert into push_projects(customer_id, project_id, name, netlify_site_id, created_at, updated_at)
       values ($1,$2,$3,$4, now(), now())
       on conflict (customer_id, project_id)
       do update set name=excluded.name, netlify_site_id=excluded.netlify_site_id, updated_at=now()
       returning id, project_id, name, netlify_site_id, created_at, updated_at`,
      [customer_id, project_id, name, netlify_site_id]
    );

    await audit("admin", "PUSH_PROJECT_UPSERT", `customer:${customer_id}`, { project_id, name, netlify_site_id });
    return json(200, { project: res.rows[0] }, cors);
  }

  if (req.method === "PATCH") {
    const id = body.id != null ? parseInt(body.id, 10) : null;
    const project_id = (body.project_id || body.projectId || "").toString().trim();

    const updates = [];
    const params = [];
    let p = 1;

    const setIf = (field, value) => {
      updates.push(`${field}=$${p++}`);
      params.push(value);
    };

    if (Object.prototype.hasOwnProperty.call(body, "name")) setIf("name", (body.name || "").toString().trim());
    if (Object.prototype.hasOwnProperty.call(body, "netlify_site_id")) setIf("netlify_site_id", (body.netlify_site_id || "").toString().trim());
    if (Object.prototype.hasOwnProperty.call(body, "netlifySiteId")) setIf("netlify_site_id", (body.netlifySiteId || "").toString().trim());

    if (!updates.length) return badRequest("No fields to update", cors);

    updates.push("updated_at=now()");

    let where = "";
    if (id) {
      where = `where id=$${p++} and customer_id=$${p++}`;
      params.push(id, customer_id);
    } else if (project_id) {
      where = `where customer_id=$${p++} and project_id=$${p++}`;
      params.push(customer_id, project_id);
    } else {
      return badRequest("Missing id or project_id", cors);
    }

    const res = await q(
      `update push_projects set ${updates.join(", ")} ${where}
       returning id, project_id, name, netlify_site_id, created_at, updated_at`,
      params
    );

    await audit("admin", "PUSH_PROJECT_UPDATE", `customer:${customer_id}`, { id, project_id });
    return json(200, { project: res.rows[0] || null }, cors);
  }

  if (req.method === "DELETE") {
    const id = body.id != null ? parseInt(body.id, 10) : null;
    const project_id = (body.project_id || body.projectId || "").toString().trim();

    if (!id && !project_id) return badRequest("Missing id or project_id", cors);

    if (id) {
      await q(`delete from push_projects where id=$1 and customer_id=$2`, [id, customer_id]);
    } else {
      await q(`delete from push_projects where customer_id=$1 and project_id=$2`, [customer_id, project_id]);
    }

    await audit("admin", "PUSH_PROJECT_DELETE", `customer:${customer_id}`, { id, project_id });
    return json(200, { ok: true }, cors);
  }

  return json(405, { error: "Method not allowed" }, cors);
});
