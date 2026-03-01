import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, monthKeyUTC } from "./_lib/http.js";
import { requireAdmin } from "./_lib/admin.js";
import { q } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";

function monthRangeUTC(month) {
  const [y, m] = String(month || "").split("-").map((x) => parseInt(x, 10));
  if (!y || !m || m < 1 || m > 12) return null;
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, 0, 0, 0));
  return { start, end };
}

async function getPushPricing(customer_id) {
  let pv = await q(
    `select b.pricing_version, b.monthly_cap_cents,
            p.base_month_cents, p.per_deploy_cents, p.per_gb_cents, p.currency
     from customer_push_billing b
     join push_pricing_versions p on p.version = b.pricing_version
     where b.customer_id=$1
     limit 1`,
    [customer_id]
  );

  if (!pv.rowCount) {
    pv = await q(
      `select 1 as pricing_version, 0 as monthly_cap_cents,
              base_month_cents, per_deploy_cents, per_gb_cents, currency
       from push_pricing_versions where version=1 limit 1`,
      []
    );
  }
  return pv.rowCount ? pv.rows[0] : null;
}

async function computeBreakdown(customer_id, month) {
  const range = monthRangeUTC(month);
  if (!range) return null;

  const cfg = await getPushPricing(customer_id);
  if (!cfg) return null;

  const usage = await q(
    `select
        count(*) filter (where event_type='deploy_ready')::int as deploys_ready,
        coalesce(sum(bytes) filter (where event_type='file_upload'),0)::bigint as bytes_uploaded
     from push_usage_events
     where customer_id=$1 and created_at >= $2 and created_at < $3`,
    [customer_id, range.start.toISOString(), range.end.toISOString()]
  );

  const deploys = usage.rows[0]?.deploys_ready || 0;
  const bytes = Number(usage.rows[0]?.bytes_uploaded || 0);
  const gb = bytes / 1073741824;

  const base = Number(cfg.base_month_cents || 0);
  const deployCost = Number(cfg.per_deploy_cents || 0) * deploys;
  const gbCost = Math.round(Number(cfg.per_gb_cents || 0) * gb);
  const total = base + deployCost + gbCost;

  return {
    month,
    pricing_version: cfg.pricing_version,
    currency: cfg.currency,
    base_month_cents: base,
    deploys_ready: deploys,
    per_deploy_cents: cfg.per_deploy_cents,
    deploy_cost_cents: deployCost,
    bytes_uploaded: bytes,
    gb_estimate: Math.round(gb * 1000) / 1000,
    per_gb_cents: cfg.per_gb_cents,
    storage_cost_cents: gbCost,
    total_cents: total,
    monthly_cap_cents: Number(cfg.monthly_cap_cents || 0)
  };
}

/**
 * Admin Push invoices.
 * GET  /.netlify/functions/admin-push-invoices?customer_id=123
 * POST /.netlify/functions/admin-push-invoices { customer_id, month }
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
      `select month, pricing_version, total_cents, breakdown, created_at, updated_at
       from push_invoices
       where customer_id=$1
       order by month desc
       limit 24`,
      [customer_id]
    );

    return json(200, { invoices: res.rows }, cors);
  }

  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, cors);

  let body;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }

  const customer_id = body.customer_id != null ? parseInt(body.customer_id, 10) : null;
  const month = (body.month || monthKeyUTC()).toString().slice(0, 7);
  if (!customer_id) return badRequest("Missing customer_id", cors);
  if (!/^\d{4}-\d{2}$/.test(month)) return badRequest("Invalid month. Use YYYY-MM", cors);

  const breakdown = await computeBreakdown(customer_id, month);
  if (!breakdown) return json(500, { error: "Push pricing not configured" }, cors);

  await q(
    `insert into push_invoices(customer_id, month, pricing_version, total_cents, breakdown, created_at, updated_at)
     values ($1,$2,$3,$4,$5::jsonb, now(), now())
     on conflict (customer_id, month)
     do update set pricing_version=excluded.pricing_version, total_cents=excluded.total_cents, breakdown=excluded.breakdown, updated_at=now()`,
    [customer_id, month, breakdown.pricing_version, breakdown.total_cents, JSON.stringify(breakdown)]
  );

  await audit("admin", "PUSH_INVOICE_COMPUTE", `customer:${customer_id}`, { month, total_cents: breakdown.total_cents, pricing_version: breakdown.pricing_version });

  return json(200, { ok: true, breakdown }, cors);
});
