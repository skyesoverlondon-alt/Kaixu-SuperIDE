import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, monthKeyUTC } from "./_lib/http.js";
import { requireAdmin } from "./_lib/admin.js";
import { q } from "./_lib/db.js";
import { computeInvoiceSnapshot } from "./_lib/invoices.js";
import { audit } from "./_lib/audit.js";

/**
 * Admin invoice snapshots.
 * GET  /.netlify/functions/admin-invoices?customer_id=123&month=YYYY-MM
 * POST /.netlify/functions/admin-invoices?customer_id=123&month=YYYY-MM  (creates/updates snapshot)
 */
export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  const admin = requireAdmin(req);
  if (!admin) return json(401, { error: "Unauthorized" }, cors);

  const url = new URL(req.url);
  const customer_id = url.searchParams.get("customer_id") ? parseInt(url.searchParams.get("customer_id"), 10) : null;
  const month = (url.searchParams.get("month") || monthKeyUTC()).toString();

  if (!customer_id) return badRequest("Missing customer_id", cors);
  if (!/^\d{4}-\d{2}$/.test(month)) return badRequest("Invalid month. Use YYYY-MM", cors);

  if (req.method === "GET") {
    const res = await q(`select snapshot, created_at, updated_at from monthly_invoices where customer_id=$1 and month=$2`, [customer_id, month]);
    if (res.rowCount) {
      return json(200, { exists: true, month, customer_id, snapshot: res.rows[0].snapshot, created_at: res.rows[0].created_at, updated_at: res.rows[0].updated_at }, cors);
    }
    const snap = await computeInvoiceSnapshot(customer_id, month);
    if (!snap) return json(404, { error: "Customer not found" }, cors);
    return json(200, { exists: false, month, customer_id, snapshot: snap }, cors);
  }

  if (req.method === "POST") {
    const snap = await computeInvoiceSnapshot(customer_id, month);
    if (!snap) return json(404, { error: "Customer not found" }, cors);

    await q(
      `insert into monthly_invoices(customer_id, month, snapshot)
       values ($1,$2,$3)
       on conflict (customer_id, month)
       do update set snapshot=excluded.snapshot, updated_at=now()`,
      [customer_id, month, snap]
    );

    await audit("admin", "INVOICE_SNAPSHOT", `customer:${customer_id}`, { month });

    return json(200, { ok: true, month, customer_id, snapshot: snap }, cors);
  }

  return json(405, { error: "Method not allowed" }, cors);
});
