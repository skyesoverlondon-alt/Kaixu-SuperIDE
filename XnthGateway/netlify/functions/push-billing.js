import { wrap } from "./_lib/wrap.js";
import { buildCors, json, getBearer, monthKeyUTC, badRequest } from "./_lib/http.js";
import { q } from "./_lib/db.js";
import { lookupKey, requireKeyRole } from "./_lib/authz.js";
import { audit } from "./_lib/audit.js";

function monthRangeUTC(month) {
  // month: YYYY-MM
  const [y, m] = month.split("-").map((x) => parseInt(x, 10));
  if (!y || !m || m < 1 || m > 12) return null;
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, 0, 0, 0));
  return { start, end };
}

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  const key = getBearer(req);
  if (!key) return json(401, { error: "Missing Authorization Bearer Kaixu Key" }, cors);

  const krow = await lookupKey(key);
  if (!krow) return json(401, { error: "Invalid Kaixu Key" }, cors);

  requireKeyRole(krow, "admin");

  const url = new URL(req.url);
  const month = (url.searchParams.get("month") || monthKeyUTC()).toString().slice(0, 7);
  const action = (url.searchParams.get("action") || "summary").toString(); // summary | invoice

  const range = monthRangeUTC(month);
  if (!range) return badRequest("Invalid month (YYYY-MM)", cors);

  // pricing version for this customer
  let pv = await q(
    `select b.pricing_version, b.monthly_cap_cents,
            p.base_month_cents, p.per_deploy_cents, p.per_gb_cents, p.currency
     from customer_push_billing b
     join push_pricing_versions p on p.version = b.pricing_version
     where b.customer_id=$1
     limit 1`,
    [krow.customer_id]
  );

  if (!pv.rowCount) {
    // default to version 1
    pv = await q(
      `select 1 as pricing_version, 0 as monthly_cap_cents,
              base_month_cents, per_deploy_cents, per_gb_cents, currency
       from push_pricing_versions where version=1 limit 1`,
      []
    );
    if (!pv.rowCount) return json(500, { error: "Push pricing not configured" }, cors);
  }

  const cfg = pv.rows[0];

  const usage = await q(
    `select
        count(*) filter (where event_type='deploy_ready')::int as deploys_ready,
        coalesce(sum(bytes) filter (where event_type='file_upload'),0)::bigint as bytes_uploaded
     from push_usage_events
     where customer_id=$1 and created_at >= $2 and created_at < $3`,
    [krow.customer_id, range.start.toISOString(), range.end.toISOString()]
  );

  const deploys = usage.rows[0]?.deploys_ready || 0;
  const bytes = Number(usage.rows[0]?.bytes_uploaded || 0);

  const gb = bytes / 1073741824; // GiB
  const base = cfg.base_month_cents;
  const deployCost = cfg.per_deploy_cents * deploys;
  const gbCost = Math.round(cfg.per_gb_cents * gb);
  const total = base + deployCost + gbCost;

  const breakdown = {
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
    monthly_cap_cents: cfg.monthly_cap_cents
  };

  if (req.method === "GET" && action === "summary") {
    return json(200, { ok: true, breakdown }, cors);
  }

  if (req.method === "POST" || (req.method === "GET" && action === "invoice")) {
    await q(
      `insert into push_invoices(customer_id, month, pricing_version, total_cents, breakdown, created_at, updated_at)
       values ($1,$2,$3,$4,$5::jsonb, now(), now())
       on conflict (customer_id, month)
       do update set pricing_version=excluded.pricing_version, total_cents=excluded.total_cents, breakdown=excluded.breakdown, updated_at=now()`,
      [krow.customer_id, month, cfg.pricing_version, total, JSON.stringify(breakdown)]
    );

    await audit(`key:${krow.key_last4}`, "PUSH_INVOICE_COMPUTE", `invoice:${month}`, { total_cents: total, pricing_version: cfg.pricing_version });

    return json(200, { ok: true, breakdown }, cors);
  }

  return json(405, { error: "Method not allowed" }, cors);
});
