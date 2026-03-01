import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer } from "./_lib/http.js";
import { q } from "./_lib/db.js";
import { lookupKey, requireKeyRole } from "./_lib/authz.js";
import { audit } from "./_lib/audit.js";

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  const key = getBearer(req);
  if (!key) return json(401, { error: "Missing Authorization Bearer Kaixu Key" }, cors);

  const krow = await lookupKey(key);
  if (!krow) return json(401, { error: "Invalid Kaixu Key" }, cors);

  if (req.method === "GET") {
    requireKeyRole(krow, "viewer");
    const res = await q(
      `select project_id, name, netlify_site_id, created_at, updated_at
       from push_projects
       where customer_id=$1
       order by created_at desc
       limit 500`,
      [krow.customer_id]
    );
    return json(200, { projects: res.rows }, cors);
  }

  if (req.method === "POST") {
    requireKeyRole(krow, "admin");
    let body;
    try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }

    const project_id = (body.projectId || body.project_id || "").toString().trim();
    const name = (body.name || project_id || "Project").toString().trim().slice(0, 120);
    const netlify_site_id = (body.netlifySiteId || body.netlify_site_id || "").toString().trim();

    if (!project_id) return badRequest("Missing projectId", cors);
    if (!netlify_site_id) return badRequest("Missing netlifySiteId", cors);

    const up = await q(
      `insert into push_projects(customer_id, project_id, name, netlify_site_id)
       values ($1,$2,$3,$4)
       on conflict (customer_id, project_id)
       do update set name=excluded.name, netlify_site_id=excluded.netlify_site_id, updated_at=now()
       returning project_id, name, netlify_site_id, created_at, updated_at`,
      [krow.customer_id, project_id, name, netlify_site_id]
    );

    await audit(`key:${krow.key_last4}`, "PUSH_PROJECT_UPSERT", `project:${project_id}`, { customer_id: krow.customer_id, project_id, name, netlify_site_id, api_key_id: krow.api_key_id });

    return json(200, { project: up.rows[0] }, cors);
  }

  return json(405, { error: "Method not allowed" }, cors);
});
