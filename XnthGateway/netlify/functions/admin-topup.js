import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, monthKeyUTC } from "./_lib/http.js";
import { requireAdmin } from "./_lib/admin.js";
import { q } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";

/**
 * Manual top-up credit (in-house).
 * POST /.netlify/functions/admin-topup { customer_id, amount_cents, month? }
 */
export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  const admin = requireAdmin(req);
  if (!admin) return json(401, { error: "Unauthorized" }, cors);
  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, cors);

  let body;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }

  const customer_id = parseInt(body.customer_id, 10);
  const amount_cents = parseInt(body.amount_cents, 10);
  const month = (body.month || monthKeyUTC()).toString();

  if (!Number.isFinite(customer_id)) return badRequest("Missing customer_id", cors);
  if (!Number.isFinite(amount_cents) || amount_cents <= 0) return badRequest("amount_cents must be > 0", cors);
  if (!/^\d{4}-\d{2}$/.test(month)) return badRequest("Invalid month", cors);

  await q(
    `insert into monthly_usage(customer_id, month, spent_cents, extra_cents, input_tokens, output_tokens)
     values ($1,$2,0,$3,0,0)
     on conflict (customer_id, month)
     do update set extra_cents = monthly_usage.extra_cents + excluded.extra_cents`,
    [customer_id, month, amount_cents]
  );

  await q(
    `insert into topup_events(customer_id, month, amount_cents, source, status)
     values ($1,$2,$3,'manual','applied')`,
    [customer_id, month, amount_cents]
  );

  await audit("admin", "TOPUP_MANUAL", `customer:${customer_id}`, { month, amount_cents });

  return json(200, { ok: true, customer_id, month, amount_cents }, cors);
});
