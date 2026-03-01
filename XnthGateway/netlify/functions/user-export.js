import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer, monthKeyUTC, text } from "./_lib/http.js";
import { resolveAuth, getMonthRollup, getKeyMonthRollup, customerCapCents, keyCapCents } from "./_lib/authz.js";
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
 * User exports for the currently authenticated key.
 * GET /.netlify/functions/user-export?type=events|summary|invoice&month=YYYY-MM
 *
 * Auth: Authorization: Bearer <Kaixu Virtual Key>
 */
export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, cors);

  const token = getBearer(req);
  if (!token) return json(401, { error: "Missing Authorization" }, cors);

  const keyRow = await resolveAuth(token);
  if (!keyRow) return json(401, { error: "Invalid or revoked key" }, cors);

  const url = new URL(req.url);
  const type = (url.searchParams.get("type") || "events").toString();
  const month = (url.searchParams.get("month") || monthKeyUTC()).toString();
  const limit = Math.min(5000, Math.max(1, parseInt(url.searchParams.get("limit") || "5000", 10)));

  if (!/^\d{4}-\d{2}$/.test(month)) return badRequest("Invalid month. Use YYYY-MM", cors);

  const range = monthRangeUTC(month);
  if (!range) return badRequest("Invalid month. Use YYYY-MM", cors);

  if (type === "events") {
    const res = await q(
      `select created_at, provider, model, input_tokens, output_tokens, cost_cents, install_id
       from usage_events
       where api_key_id=$1 and created_at >= $2 and created_at < $3
       order by created_at asc
       limit $3`,
      [keyRow.api_key_id, range.start.toISOString(), range.end.toISOString(), limit]
    );

    const csv = toCsv({
      header: ["created_at", "provider", "model", "input_tokens", "output_tokens", "cost_cents", "install_id"],
      rows: res.rows.map(r => [r.created_at, r.provider, r.model, r.input_tokens, r.output_tokens, r.cost_cents, r.install_id])
    });

    return text(200, csv, {
      ...cors,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename=kaixu-events-${month}-key${keyRow.key_last4}.csv`
    });
  }

  if (type === "summary") {
    const custRoll = await getMonthRollup(keyRow.customer_id, month);
    const keyRoll = await getKeyMonthRollup(keyRow.api_key_id, month);
    const cap = customerCapCents(keyRow, custRoll);
    const kcap = keyCapCents(keyRow, custRoll);

    const csv = toCsv({
      header: ["month", "customer_id", "plan", "customer_cap_cents", "customer_spent_cents", "customer_extra_cents", "key_id", "key_last4", "key_label", "key_cap_cents", "key_spent_cents"],
      rows: [[
        month,
        keyRow.customer_id,
        keyRow.customer_plan_name || "",
        cap,
        custRoll.spent_cents || 0,
        custRoll.extra_cents || 0,
        keyRow.api_key_id,
        keyRow.key_last4,
        keyRow.label || "",
        kcap,
        keyRoll.spent_cents || 0
      ]]
    });

    return text(200, csv, {
      ...cors,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename=kaixu-summary-${month}-key${keyRow.key_last4}.csv`
    });
  }

  if (type === "invoice") {
    const existing = await q(
      `select snapshot, created_at, updated_at from monthly_invoices where customer_id=$1 and month=$2`,
      [keyRow.customer_id, month]
    );

    const snap = existing.rowCount ? existing.rows[0].snapshot : (await computeInvoiceSnapshot(keyRow.customer_id, month));
    if (!snap) return json(404, { error: "Invoice not found" }, cors);

    // Provide a simple invoice CSV: totals + per-key rows
    const rows = [];
    rows.push(["TOTAL", "", "", snap.totals.spent_cents, snap.totals.total_tokens]);
    for (const k of (snap.keys || [])) {
      rows.push(["KEY", k.api_key_id, k.key_last4, k.spent_cents, (k.input_tokens || 0) + (k.output_tokens || 0)]);
    }

    const csv = toCsv({
      header: ["type", "api_key_id", "key_last4", "spent_cents", "total_tokens"],
      rows
    });

    return text(200, csv, {
      ...cors,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename=kaixu-invoice-${month}-customer${keyRow.customer_id}.csv`
    });
  }

  return badRequest("Unknown type. Use events|summary|invoice", cors);
});