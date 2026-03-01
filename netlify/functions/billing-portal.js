// billing-portal.js — open the Stripe Customer Portal for plan management
// POST { returnUrl }

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
        catch { reject(new Error('Stripe parse error')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, body: 'Method not allowed' };

  let user;
  try { user = await requireAuth(event); }
  catch (e) { return { statusCode: 401, body: e.message }; }

  const body = JSON.parse(event.body || '{}');
  const appUrl = process.env.APP_URL || 'https://your-app.netlify.app';
  const returnUrl = body.returnUrl || `${appUrl}/ide.html`;

  const db = getDb();
  try {
    const { rows } = await db.query(
      'SELECT stripe_customer_id FROM users WHERE id=$1', [user.sub]
    );
    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId)
      return { statusCode: 400, body: 'No Stripe customer found. Subscribe first.' };

    const portal = await stripePost('/v1/billing_portal/sessions', {
      customer: customerId,
      return_url: returnUrl,
    });
    return { statusCode: 200, body: JSON.stringify({ url: portal.url }) };
  } catch (err) {
    console.error('[billing-portal]', err);
    return { statusCode: 500, body: err.message };
  }
};
