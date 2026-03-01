import { wrap } from "./_lib/wrap.js";
import { buildCors, json, badRequest, monthKeyUTC } from "./_lib/http.js";
import { requireAdmin } from "./_lib/admin.js";

/**
 * Create a Stripe Checkout Session for a usage top-up.
 * POST /.netlify/functions/stripe-create-checkout { customer_id, amount_cents, month? }
 */
export default wrap(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  const admin = requireAdmin(req);
  if (!admin) return json(401, { error: "Unauthorized" }, cors);

  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, cors);

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return json(501, { error: "Stripe not configured (missing STRIPE_SECRET_KEY)" }, cors);

  let body;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON", cors); }

  const customer_id = parseInt(body.customer_id, 10);
  const amount_cents = parseInt(body.amount_cents, 10);
  const month = (body.month || monthKeyUTC()).toString();

  if (!Number.isFinite(customer_id)) return badRequest("Missing customer_id", cors);
  if (!Number.isFinite(amount_cents) || amount_cents <= 0) return badRequest("amount_cents must be > 0", cors);
  if (!/^\d{4}-\d{2}$/.test(month)) return badRequest("Invalid month", cors);

  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(secret, { apiVersion: "2024-06-20" });

  const origin = req.headers.get("origin") || process.env.PUBLIC_APP_ORIGIN || "";
  const success_url = process.env.STRIPE_SUCCESS_URL || (origin ? `${origin}/?billing=success` : undefined);
  const cancel_url = process.env.STRIPE_CANCEL_URL || (origin ? `${origin}/?billing=cancel` : undefined);

  if (!success_url || !cancel_url) {
    return json(400, { error: "Missing STRIPE_SUCCESS_URL/STRIPE_CANCEL_URL (or Origin header)" }, cors);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url,
    cancel_url,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: process.env.STRIPE_CURRENCY || "usd",
          unit_amount: amount_cents,
          product_data: {
            name: `Kaixu Usage Top-up (${month})`
          }
        }
      }
    ],
    metadata: {
      customer_id: String(customer_id),
      month,
      amount_cents: String(amount_cents)
    }
  });

  return json(200, { ok: true, url: session.url, id: session.id }, cors);
});
