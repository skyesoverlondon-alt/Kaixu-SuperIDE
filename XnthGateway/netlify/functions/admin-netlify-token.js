import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest } from "./_lib/http.js";
import { requireAdmin } from "./_lib/admin.js";
import { q } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";
import { setNetlifyTokenForCustomer, clearNetlifyTokenForCustomer } from "./_lib/netlifyTokens.js";

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  const admin = requireAdmin(req);
  if (!admin) return json(401, { error: "Unauthorized" }, cors);

  if (req.method === "GET") {
    const url = new URL(req.url);
    const customer_id = parseInt((url.searchParams.get("customer_id") || "").trim(), 10);
    if (!Number.isFinite(customer_id)) return badRequest("Missing customer_id", cors);

    const r = await q(`select 1 as ok from customer_netlify_tokens where customer_id=$1`, [customer_id]);
    return json(200, { customer_id, has_token: r.rows.length > 0 }, cors);
  }

  let body;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }

  const customer_id = parseInt((body.customer_id || "").toString().trim(), 10);
  if (!Number.isFinite(customer_id)) return badRequest("Missing customer_id", cors);

  if (req.method === "POST") {
    const token = (body.token || "").toString().trim();
    if (!token) return badRequest("Missing token", cors);
    await setNetlifyTokenForCustomer(customer_id, token);
    await audit("admin", "NETLIFY_TOKEN_SET", `customer:${customer_id}`);
    return json(200, { ok: true, customer_id }, cors);
  }

  if (req.method === "DELETE") {
    await clearNetlifyTokenForCustomer(customer_id);
    await audit("admin", "NETLIFY_TOKEN_CLEAR", `customer:${customer_id}`);
    return json(200, { ok: true, customer_id }, cors);
  }

  return json(405, { error: "Method not allowed" }, cors);
});
