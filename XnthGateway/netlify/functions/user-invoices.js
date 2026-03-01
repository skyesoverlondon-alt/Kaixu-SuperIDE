import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer, monthKeyUTC } from "./_lib/http.js";
import { resolveAuth } from "./_lib/authz.js";
import { q } from "./_lib/db.js";
import { computeInvoiceSnapshot } from "./_lib/invoices.js";

/**
 * User invoice snapshot.
 * GET /.netlify/functions/user-invoices?month=YYYY-MM
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
  const month = (url.searchParams.get("month") || monthKeyUTC()).toString();
  if (!/^\d{4}-\d{2}$/.test(month)) return badRequest("Invalid month. Use YYYY-MM", cors);

  const res = await q(`select snapshot, created_at, updated_at from monthly_invoices where customer_id=$1 and month=$2`, [keyRow.customer_id, month]);
  if (res.rowCount) {
    return json(200, { exists: true, month, snapshot: res.rows[0].snapshot, created_at: res.rows[0].created_at, updated_at: res.rows[0].updated_at }, cors);
  }

  // If no stored snapshot, compute a live preview.
  const snap = await computeInvoiceSnapshot(keyRow.customer_id, month);
  if (!snap) return json(404, { error: "Not found" }, cors);
  return json(200, { exists: false, month, snapshot: snap }, cors);
});
