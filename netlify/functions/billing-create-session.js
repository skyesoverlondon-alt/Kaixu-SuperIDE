// billing-create-session.js — create a Stripe Checkout session for a subscription
// POST { priceId, successUrl, cancelUrl }
// Requires env: STRIPE_SECRET_KEY, APP_URL

const { requireAuth } = require('./_lib/auth');
const { getDb }        = require('./_lib/db');
const https            = require('https');
const qs               = require('querystring');

function stripePost(path, params) {
  return new Promise((resolve, reject) => {
    const body = qs.stringify(params);
    const opts = {
      hostname: 'api.stripe.com',
      path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Stripe parse error: ${data}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function stripeGet(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.stripe.com',
      path,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Stripe parse error: ${data}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, body: 'Method not allowed' };

  let user;
  try { user = await requireAuth(event); }
  catch (e) { return { statusCode: 401, body: e.message }; }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { priceId, successUrl, cancelUrl, orgId } = body;
  if (!priceId)
    return { statusCode: 400, body: 'priceId required' };

  const db = getDb();
  const appUrl = process.env.APP_URL || 'https://your-app.netlify.app';

  try {
    // Get or create Stripe customer
    const { rows } = await db.query(
      'SELECT stripe_customer_id FROM users WHERE id=$1', [user.sub]
    );
    let customerId = rows[0]?.stripe_customer_id;

    if (!customerId) {
      const { rows: u } = await db.query(
        'SELECT email FROM users WHERE id=$1', [user.sub]
      );
      const customer = await stripePost('/v1/customers', {
        email: u[0].email,
        metadata: { user_id: user.sub, org_id: orgId || '' },
      });
      customerId = customer.id;
      await db.query(
        'UPDATE users SET stripe_customer_id=$1 WHERE id=$2',
        [customerId, user.sub]
      );
    }

    // Check for existing active subscription
    const existing = await stripeGet(
      `/v1/subscriptions?customer=${customerId}&status=active&limit=1`
    );
    if (existing.data?.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({ alreadySubscribed: true, subscriptionId: existing.data[0].id }),
      };
    }

    // Create Checkout session
    const session = await stripePost('/v1/checkout/sessions', {
      customer: customerId,
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': 1,
      success_url: successUrl || `${appUrl}/ide.html?billing=success`,
      cancel_url: cancelUrl || `${appUrl}/ide.html?billing=cancel`,
      'subscription_data[metadata][user_id]': user.sub,
      'subscription_data[metadata][org_id]': orgId || '',
      allow_promotion_codes: 'true',
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url, sessionId: session.id }),
    };
  } catch (err) {
    console.error('[billing-create-session]', err);
    return { statusCode: 500, body: err.message };
  }
};
