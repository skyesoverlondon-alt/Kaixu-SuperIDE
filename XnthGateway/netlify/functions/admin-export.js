import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, monthKeyUTC, text } from "./_lib/http.js";
import { requireAdmin } from "./_lib/admin.js";
import { q } from "./_lib/db.js";
import { toCsv } from "./_lib/csv.js";
import { computeInvoiceSnapshot } from "./_lib/invoices.js";

function monthRangeUTC(month) {
  const [y, m] = String(month || "").split("-").map((x) => parseInt(x, 10));
  if (!y || !m || m < 1 || m > 12) return null;
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, 0, 0, 0));
  return { start, end };
}


/**
 * Admin exports.
 * GET /.netlify/functions/admin-export?customer_id=123&type=events|summary|invoice&month=YYYY-MM&api_key_id=456
 */
export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  const admin = requireAdmin(req);
  if (!admin) return json(401, { error: "Unauthorized" }, cors);
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, cors);

  const url = new URL(req.url);
  const customer_id = url.searchParams.get("customer_id") ? parseInt(url.searchParams.get("customer_id"), 10) : null;
  const api_key_id = url.searchParams.get("api_key_id") ? parseInt(url.searchParams.get("api_key_id"), 10) : null;
  const type = (url.searchParams.get("type") || "events").toString();
  const month = (url.searchParams.get("month") || monthKeyUTC()).toString();
  const limit = Math.min(20000, Math.max(1, parseInt(url.searchParams.get("limit") || "20000", 10)));

  if (!customer_id) return badRequest("Missing customer_id", cors);
  if (!/^\d{4}-\d{2}$/.test(month)) return badRequest("Invalid month. Use YYYY-MM", cors);

  if (type === "events") {
    const range = monthRangeUTC(month);
    if (!range) return badRequest("Invalid month. Use YYYY-MM", cors);

    const params = [customer_id, range.start.toISOString(), range.end.toISOString()];
    let where = "customer_id=$1 and created_at >= $2 and created_at < $3";
    if (api_key_id) {
      params.push(api_key_id);
      where += " and api_key_id=$4";
    }
    params.push(limit);
    const limitPos = params.length;

    const res = await q(
      `select created_at, api_key_id, provider, model, input_tokens, output_tokens, cost_cents, install_id
       from usage_events
       where ${where}
       order by created_at asc
       limit $${limitPos}`,
      params
    );

    const csv = toCsv({
      header: ["created_at", "api_key_id", "provider", "model", "input_tokens", "output_tokens", "cost_cents", "install_id"],
      rows: res.rows.map(r => [r.created_at, r.api_key_id, r.provider, r.model, r.input_tokens, r.output_tokens, r.cost_cents, r.install_id])
    });

    return text(200, csv, {
      ...cors,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename=kaixu-admin-events-${month}-customer${customer_id}${api_key_id ? ('-key'+api_key_id) : ''}.csv`
    });
  }

  if (type === "summary") {
    const roll = await q(
      `select month, spent_cents, extra_cents, input_tokens, output_tokens
       from monthly_usage where customer_id=$1 and month=$2`,
      [customer_id, month]
    );

    const cust = await q(
      `select id, email, plan_name, monthly_cap_cents from customers where id=$1`,
      [customer_id]
    );

    const r = roll.rowCount ? roll.rows[0] : { month, spent_cents: 0, extra_cents: 0, input_tokens: 0, output_tokens: 0 };
    const c = cust.rowCount ? cust.rows[0] : { id: customer_id, email: "", plan_name: "", monthly_cap_cents: 0 };

    const csv = toCsv({
      header: ["month", "customer_id", "email", "plan", "cap_cents", "extra_cents", "spent_cents", "input_tokens", "output_tokens"],
      rows: [[month, c.id, c.email, c.plan_name, c.monthly_cap_cents, r.extra_cents || 0, r.spent_cents || 0, r.input_tokens || 0, r.output_tokens || 0]]
    });

    return text(200, csv, {
      ...cors,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename=kaixu-admin-summary-${month}-customer${customer_id}.csv`
    });
  }

  if (type === "invoice") {
    const existing = await q(`select snapshot from monthly_invoices where customer_id=$1 and month=$2`, [customer_id, month]);
    const snap = existing.rowCount ? existing.rows[0].snapshot : (await computeInvoiceSnapshot(customer_id, month));
    if (!snap) return json(404, { error: "Invoice not found" }, cors);

    const rows = [];
    rows.push(["TOTAL", "", "", snap.totals.spent_cents, snap.totals.total_tokens]);
    for (const k of (snap.keys || [])) rows.push(["KEY", k.api_key_id, k.key_last4, k.spent_cents, (k.input_tokens||0)+(k.output_tokens||0)]);

    const csv = toCsv({ header: ["type","api_key_id","key_last4","spent_cents","total_tokens"], rows });

    return text(200, csv, {
      ...cors,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename=kaixu-admin-invoice-${month}-customer${customer_id}.csv`
    });
  }

  return badRequest("Unknown type. Use events|summary|invoice", cors);
});