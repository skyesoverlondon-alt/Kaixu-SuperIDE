import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest } from "./_lib/http.js";
import { requireAdmin } from "./_lib/admin.js";
import { q } from "./_lib/db.js";

export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  const admin = requireAdmin(req);
  if (!admin) return json(401, { error: "Unauthorized" }, cors);

  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, cors);

  const url = new URL(req.url);
  const customer_id = url.searchParams.get("customer_id") ? parseInt(url.searchParams.get("customer_id"), 10) : null;
  if (!customer_id) return badRequest("Missing customer_id", cors);

  const month = (url.searchParams.get("month") || new Date().toISOString().slice(0, 7)).toString().slice(0, 7);

  const capRes = await q(`select monthly_cap_cents, email, plan_name from customers where id=$1`, [customer_id]);
  if (capRes.rowCount === 0) return json(404, { error: "Customer not found" }, cors);

  const roll = await q(
    `select spent_cents, extra_cents, input_tokens, output_tokens, updated_at
     from monthly_usage where customer_id=$1 and month=$2`,
    [customer_id, month]
  );

  const events = await q(
    `select id, provider, model, input_tokens, output_tokens, cost_cents, created_at
     from usage_events
     where customer_id=$1 and to_char(created_at at time zone 'UTC','YYYY-MM')=$2
     order by created_at desc
     limit 200`,
    [customer_id, month]
  );

  const perKey = await q(
    `select m.api_key_id as id, k.key_last4, k.label,
            m.spent_cents, m.input_tokens, m.output_tokens, m.updated_at
     from monthly_key_usage m
     join api_keys k on k.id = m.api_key_id
     where m.customer_id=$1 and m.month=$2
     order by m.spent_cents desc`,
    [customer_id, month]
  );

  return json(200, {
    customer: { id: customer_id, ...capRes.rows[0] },
    month,
    rollup: roll.rowCount ? roll.rows[0] : { spent_cents: 0, extra_cents: 0, input_tokens: 0, output_tokens: 0, updated_at: null },
    per_key: perKey.rows,
    events: events.rows
  }, cors);
});
