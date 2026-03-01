import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, getBearer, monthKeyUTC } from "./_lib/http.js";
import { q } from "./_lib/db.js";
import { resolveAuth, getMonthRollup, getKeyMonthRollup, customerCapCents, keyCapCents } from "./_lib/authz.js";

/**
 * User-facing summary endpoint.
 * GET /.netlify/functions/user-summary?month=YYYY-MM
 * Header: Authorization: Bearer <virtual_key>
 */
export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, cors);

  const key = getBearer(req);
  if (!key) return json(401, { error: "Missing Authorization: Bearer <virtual_key>" }, cors);

  const keyRow = await resolveAuth(key);
  if (!keyRow) return json(401, { error: "Invalid or revoked key" }, cors);
  if (!keyRow.is_active) return json(403, { error: "Customer disabled" }, cors);

  const url = new URL(req.url);
  const month = (url.searchParams.get("month") || monthKeyUTC()).toString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return badRequest("Invalid month format. Use YYYY-MM.", cors);

  const customerRes = await q(
    `select id, plan_name, monthly_cap_cents, is_active
     from customers where id=$1`,
    [keyRow.customer_id]
  );

  const custRoll = await getMonthRollup(keyRow.customer_id, month);
  const keyRoll = await getKeyMonthRollup(keyRow.api_key_id, month);

  const customer_cap_cents = customerCapCents(keyRow, custRoll);
  const key_cap_cents = keyCapCents(keyRow, custRoll);

  const customer_spent_cents = custRoll.spent_cents || 0;
  const key_spent_cents = keyRoll.spent_cents || 0;

  const customer_remaining_cents = Math.max(0, customer_cap_cents - customer_spent_cents);
  const key_remaining_cents = Math.max(0, key_cap_cents - key_spent_cents);

  return json(200, {
    customer: customerRes.rowCount ? customerRes.rows[0] : { id: keyRow.customer_id, plan_name: "", monthly_cap_cents: keyRow.customer_cap_cents, is_active: keyRow.is_active },
    key: {
      id: keyRow.api_key_id,
      label: keyRow.label || null,
      key_last4: keyRow.key_last4 || null,
      has_cap_override: keyRow.key_cap_cents != null
    },
    month: {
      month,
      // Back-compat fields (customer-level, i.e., universal spend)
      cap_cents: customer_cap_cents,
      spent_cents: customer_spent_cents,
      // Explicit fields
      customer_cap_cents,
      customer_spent_cents,
      customer_remaining_cents,
      key_cap_cents,
      key_spent_cents,
      key_remaining_cents,
      customer_tokens: (custRoll.input_tokens || 0) + (custRoll.output_tokens || 0),
      key_tokens: (keyRoll.input_tokens || 0) + (keyRoll.output_tokens || 0)
    }
  }, cors);
});
