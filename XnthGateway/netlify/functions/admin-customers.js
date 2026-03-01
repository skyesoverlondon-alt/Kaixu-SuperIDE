import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest } from "./_lib/http.js";
import { requireAdmin } from "./_lib/admin.js";
import { q } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";

function parseProviders(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(String).map(s=>s.trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map(s=>s.trim()).filter(Boolean);
  return null;
}

function parseModels(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  }
  return null;
}

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  const admin = requireAdmin(req);
  if (!admin) return json(401, { error: "Unauthorized" }, cors);

  if (req.method === "GET") {
    const res = await q(
      `select c.id, c.email, c.plan_name, c.monthly_cap_cents, c.is_active,
              c.max_devices_per_key, c.require_install_id, c.allowed_providers, c.allowed_models,
              c.stripe_customer_id, c.stripe_subscription_id, c.stripe_current_period_end,
              c.auto_topup_enabled, c.auto_topup_threshold_cents, c.auto_topup_amount_cents,
              c.created_at,
              (select count(*) from api_keys k where k.customer_id=c.id and k.revoked_at is null) as active_keys,
              exists(select 1 from customer_netlify_tokens t where t.customer_id=c.id) as has_netlify_token
       from customers c
       order by c.created_at desc
       limit 200`
    );
    return json(200, { customers: res.rows }, cors);
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }

    const email = (body.email || "").toString().trim().toLowerCase();
    if (!email) return badRequest("Missing email", cors);

    const plan_name = (body.plan_name || "starter").toString().slice(0, 40);
    const monthly_cap_cents = parseInt(body.monthly_cap_cents || process.env.DEFAULT_CUSTOMER_CAP_CENTS || "2000", 10);

    const ins = await q(
      `insert into customers(email, plan_name, monthly_cap_cents)
       values ($1,$2,$3)
       returning id, created_at`,
      [email, plan_name, monthly_cap_cents]
    );

    await audit("admin", "CUSTOMER_CREATE", `customer:${ins.rows[0].id}`, { email, plan_name, monthly_cap_cents });

    return json(200, { customer: { id: ins.rows[0].id, email, plan_name, monthly_cap_cents, created_at: ins.rows[0].created_at } }, cors);
  }

  if (req.method === "PATCH") {
    const url = new URL(req.url);
    const customer_id = url.searchParams.get("customer_id") ? parseInt(url.searchParams.get("customer_id"), 10) : null;
    if (!customer_id) return badRequest("Missing customer_id", cors);

    let body;
    try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }

    const updates = [];
    const params = [];
    let p = 1;

    const setIf = (field, transform = (x) => x) => {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        updates.push(`${field}=$${p++}`);
        params.push(transform(body[field]));
      }
    };

    setIf("email", v => (v || "").toString().trim().toLowerCase() || null);
    setIf("plan_name", v => (v || "").toString().slice(0, 40) || null);
    setIf("monthly_cap_cents", v => v === null ? null : parseInt(v, 10));
    setIf("is_active", v => !!v);

    // device + allowlists
    setIf("max_devices_per_key", v => v === null ? null : parseInt(v, 10));
    setIf("require_install_id", v => !!v);
    if (Object.prototype.hasOwnProperty.call(body, "allowed_providers")) {
      updates.push(`allowed_providers=$${p++}`);
      params.push(parseProviders(body.allowed_providers));
    }
    if (Object.prototype.hasOwnProperty.call(body, "allowed_models")) {
      updates.push(`allowed_models=$${p++}`);
      params.push(parseModels(body.allowed_models));
    }

    // billing
    setIf("stripe_customer_id", v => (v || "").toString().trim() || null);
    setIf("auto_topup_enabled", v => !!v);
    setIf("auto_topup_threshold_cents", v => v === null ? null : parseInt(v, 10));
    setIf("auto_topup_amount_cents", v => v === null ? null : parseInt(v, 10));

    if (!updates.length) return badRequest("No fields to update", cors);

    params.push(customer_id);
    await q(`update customers set ${updates.join(", ")} where id=$${p}`, params);

    await audit("admin", "CUSTOMER_UPDATE", `customer:${customer_id}`, { fields: Object.keys(body || {}) });

    const out = await q(
      `select id, email, plan_name, monthly_cap_cents, is_active,
              max_devices_per_key, require_install_id, allowed_providers, allowed_models,
              stripe_customer_id, auto_topup_enabled, auto_topup_threshold_cents, auto_topup_amount_cents
       from customers where id=$1`,
      [customer_id]
    );

    return json(200, { ok: true, customer: out.rowCount ? out.rows[0] : null }, cors);
  }

  return json(405, { error: "Method not allowed" }, cors);
});
