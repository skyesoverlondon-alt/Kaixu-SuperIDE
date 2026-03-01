// stripe-webhook.js — handle Stripe webhook events
// Requires env: STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY
//
// Handled events:
//   customer.subscription.created
//   customer.subscription.updated
//   customer.subscription.deleted
//   invoice.payment_succeeded
//   invoice.payment_failed

const { getDb } = require('./_lib/db');
const crypto     = require('crypto');

// ── Stripe signature verification ──────────────────────────────────────────
function verifyStripeSignature(rawBody, sigHeader, secret) {
  const parts = sigHeader.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    acc[k] = v;
    return acc;
  }, {});
  const ts = parts.t;
  const sig = parts.v1;
  const payload = `${ts}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');
  if (expected !== sig) throw new Error('Stripe signature mismatch');
  // Reject webhooks older than 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(ts)) > 300)
    throw new Error('Stripe webhook timestamp too old');
}

// ── Plan lookup by Stripe price ID ─────────────────────────────────────────
async function getPlanByPriceId(db, priceId) {
  const { rows } = await db.query(
    'SELECT * FROM plans WHERE stripe_price_id=$1', [priceId]
  );
  return rows[0] || null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, body: 'Method not allowed' };

  const sig    = event.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const rawBody = event.body;

  try {
    verifyStripeSignature(rawBody, sig, secret);
  } catch (err) {
    console.error('[stripe-webhook] signature error:', err.message);
    return { statusCode: 400, body: `Webhook error: ${err.message}` };
  }

  let stripeEvent;
  try { stripeEvent = JSON.parse(rawBody); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const db = getDb();
  const obj = stripeEvent.data?.object;

  try {
    switch (stripeEvent.type) {
      // ── Subscription created ──────────────────────────────────────────────
      case 'customer.subscription.created': {
        const userId  = obj.metadata?.user_id;
        const orgId   = obj.metadata?.org_id || null;
        const priceId = obj.items?.data?.[0]?.price?.id;
        const plan    = priceId ? await getPlanByPriceId(db, priceId) : null;

        await db.query(`
          INSERT INTO subscriptions
            (stripe_subscription_id, user_id, org_id, plan_id, status,
             current_period_start, current_period_end, stripe_customer_id)
          VALUES ($1,$2,$3,$4,$5,to_timestamp($6),to_timestamp($7),$8)
          ON CONFLICT (stripe_subscription_id) DO UPDATE SET
            status=$5,
            current_period_start=to_timestamp($6),
            current_period_end=to_timestamp($7)
        `, [
          obj.id, userId, orgId, plan?.id || null, obj.status,
          obj.current_period_start, obj.current_period_end, obj.customer,
        ]);

        // Update org or user plan tier
        if (plan) {
          if (orgId) {
            await db.query('UPDATE orgs SET plan_id=$1 WHERE id=$2', [plan.id, orgId]);
          } else if (userId) {
            await db.query('UPDATE users SET plan_id=$1 WHERE id=$2', [plan.id, userId]);
          }
        }
        console.log('[stripe-webhook] subscription created:', obj.id);
        break;
      }

      // ── Subscription updated ──────────────────────────────────────────────
      case 'customer.subscription.updated': {
        const priceId = obj.items?.data?.[0]?.price?.id;
        const plan    = priceId ? await getPlanByPriceId(db, priceId) : null;

        await db.query(`
          UPDATE subscriptions
          SET status=$2, current_period_start=to_timestamp($3),
              current_period_end=to_timestamp($4), plan_id=$5
          WHERE stripe_subscription_id=$1
        `, [
          obj.id, obj.status,
          obj.current_period_start, obj.current_period_end,
          plan?.id || null,
        ]);
        console.log('[stripe-webhook] subscription updated:', obj.id, obj.status);
        break;
      }

      // ── Subscription cancelled/deleted ──────────────────────────────────
      case 'customer.subscription.deleted': {
        await db.query(`
          UPDATE subscriptions
          SET status='canceled', canceled_at=NOW()
          WHERE stripe_subscription_id=$1
        `, [obj.id]);

        // Downgrade org/user to free plan
        const { rows: sub } = await db.query(
          'SELECT user_id, org_id FROM subscriptions WHERE stripe_subscription_id=$1',
          [obj.id]
        );
        if (sub.length) {
          const { user_id, org_id } = sub[0];
          const { rows: freePlan } = await db.query(
            "SELECT id FROM plans WHERE name='free' OR slug='free' LIMIT 1"
          );
          const freePlanId = freePlan[0]?.id || null;
          if (org_id)  await db.query('UPDATE orgs  SET plan_id=$1 WHERE id=$2', [freePlanId, org_id]);
          if (user_id) await db.query('UPDATE users SET plan_id=$1 WHERE id=$2', [freePlanId, user_id]);
        }
        console.log('[stripe-webhook] subscription deleted:', obj.id);
        break;
      }

      // ── Invoice paid ──────────────────────────────────────────────────────
      case 'invoice.payment_succeeded': {
        const subId = obj.subscription;
        if (subId) {
          await db.query(`
            UPDATE subscriptions
            SET status='active', last_invoice_at=NOW(), last_invoice_amount=$2
            WHERE stripe_subscription_id=$1
          `, [subId, obj.amount_paid]);
          // Record in usage_meters
          await db.query(`
            INSERT INTO usage_meters (subscription_id, event, amount_cents, recorded_at)
            VALUES (
              (SELECT id FROM subscriptions WHERE stripe_subscription_id=$1),
              'invoice_paid', $2, NOW()
            )
          `, [subId, obj.amount_paid]);
        }
        console.log('[stripe-webhook] invoice paid:', obj.id, obj.amount_paid);
        break;
      }

      // ── Invoice payment failed ────────────────────────────────────────────
      case 'invoice.payment_failed': {
        const subId = obj.subscription;
        if (subId) {
          await db.query(`
            UPDATE subscriptions SET status='past_due' WHERE stripe_subscription_id=$1
          `, [subId]);
        }
        console.log('[stripe-webhook] invoice payment FAILED:', obj.id);
        break;
      }

      default:
        console.log('[stripe-webhook] unhandled event:', stripeEvent.type);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error('[stripe-webhook] handler error:', err);
    return { statusCode: 500, body: err.message };
  }
};
