import { wrap } from "./_lib/wrap.js";
import { json } from "./_lib/http.js";
import { q } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";

/**
 * Stripe webhook handler.
 * Configure your Stripe webhook endpoint to hit:
 *   https://<yoursite>/.netlify/functions/stripe-webhook
 */
export default wrap(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, { "content-type": "application/json" });

  const secret = process.env.STRIPE_SECRET_KEY;
  const whsec = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !whsec) {
    return json(501, { error: "Stripe not configured" }, { "content-type": "application/json" });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return json(400, { error: "Missing stripe-signature" }, { "content-type": "application/json" });

  const body = await req.text();

  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(secret, { apiVersion: "2024-06-20" });

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, whsec);
  } catch (e) {
    return json(400, { error: "Webhook signature verification failed" }, { "content-type": "application/json" });
  }

  // Only support Checkout Session completions for top-ups.
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const md = session.metadata || {};

    const customer_id = parseInt(md.customer_id, 10);
    const month = (md.month || "").toString();
    const amount_cents = parseInt(md.amount_cents, 10);

    if (Number.isFinite(customer_id) && /^\d{4}-\d{2}$/.test(month) && Number.isFinite(amount_cents) && amount_cents > 0) {
      // credit cap
      await q(
        `insert into monthly_usage(customer_id, month, spent_cents, extra_cents, input_tokens, output_tokens)
         values ($1,$2,0,$3,0,0)
         on conflict (customer_id, month)
         do update set extra_cents = monthly_usage.extra_cents + excluded.extra_cents`,
        [customer_id, month, amount_cents]
      );

      await q(
        `insert into topup_events(customer_id, month, amount_cents, source, stripe_session_id, status)
         values ($1,$2,$3,'stripe',$4,'applied')`,
        [customer_id, month, amount_cents, session.id]
      );

      await audit("system", "TOPUP_STRIPE", `customer:${customer_id}`, { month, amount_cents, session_id: session.id });
    }
  }

  return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
});
