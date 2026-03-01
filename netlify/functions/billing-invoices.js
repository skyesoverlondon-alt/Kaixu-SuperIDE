// billing-invoices.js — List Stripe invoices for the current user/org
// GET ?orgId=&limit=10&startingAfter=in_xxx
// Returns { invoices: [...], hasMore }

const https = require('https');
const { requireAuth } = require('./_lib/auth');
const { query }       = require('./_lib/db');
const { json }        = require('./_lib/body');

function stripeGet(path) {
  return new Promise((resolve, reject) => {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return reject(new Error('STRIPE_SECRET_KEY not set'));
    const req = https.request({
      hostname: 'api.stripe.com',
      path,
      method: 'GET',
      headers: { Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64') }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { reject(new Error('Bad JSON from Stripe')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET')
    return { statusCode: 405, body: 'Method not allowed' };

  let user;
  try { user = await requireAuth(event); }
  catch (e) { return json(401, { ok: false, error: e.message }); }

  const { orgId, limit = '10', startingAfter } = event.queryStringParameters || {};

  try {
    // Resolve stripe_customer_id from org or user
    let customerId = null;
    if (orgId) {
      const res = await query(
        `SELECT u.stripe_customer_id FROM org_members om
         JOIN users u ON u.id = om.user_id
         WHERE om.org_id=$1 AND om.role IN ('owner','admin')
         ORDER BY om.created_at ASC LIMIT 1`,
        [orgId]
      );
      customerId = res.rows[0]?.stripe_customer_id || null;
    }
    if (!customerId) {
      const res = await query('SELECT stripe_customer_id FROM users WHERE id=$1', [user.sub]);
      customerId = res.rows[0]?.stripe_customer_id || null;
    }
    if (!customerId) {
      return json(200, { ok: true, invoices: [], hasMore: false, note: 'No billing account yet' });
    }

    // Fetch invoices from Stripe
    const lim = Math.min(parseInt(limit, 10) || 10, 100);
    let path = `/v1/invoices?customer=${customerId}&limit=${lim}&expand[]=data.subscription`;
    if (startingAfter) path += `&starting_after=${startingAfter}`;

    const data = await stripeGet(path);

    if (data.error) {
      return json(502, { ok: false, error: data.error.message });
    }

    const invoices = (data.data || []).map(inv => ({
      id:          inv.id,
      number:      inv.number,
      status:      inv.status,          // draft|open|paid|uncollectible|void
      amountDue:   inv.amount_due,
      amountPaid:  inv.amount_paid,
      currency:    inv.currency,
      periodStart: inv.period_start,
      periodEnd:   inv.period_end,
      pdfUrl:      inv.invoice_pdf,
      hostedUrl:   inv.hosted_invoice_url,
      created:     inv.created,
      planName:    inv.lines?.data?.[0]?.description || '',
    }));

    return json(200, { ok: true, invoices, hasMore: data.has_more || false });
  } catch (err) {
    require('./_lib/logger')('billing-invoices').exception(err);
    return json(500, { ok: false, error: err.message });
  }
};
