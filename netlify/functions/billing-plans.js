// billing-plans.js — list plans and get current subscription for the authed user/org
// GET ?orgId=  → { plans, subscription }

const { requireAuth } = require('./_lib/auth');
const { getDb }        = require('./_lib/db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET')
    return { statusCode: 405, body: 'Method not allowed' };

  let user;
  try { user = await requireAuth(event); }
  catch (e) { return { statusCode: 401, body: e.message }; }

  const orgId = event.queryStringParameters?.orgId || null;
  const db    = getDb();

  try {
    const { rows: plans } = await db.query(
      'SELECT * FROM plans ORDER BY price_cents ASC'
    );

    // Current subscription: prefer org-level, fall back to user-level
    let subQuery;
    if (orgId) {
      subQuery = await db.query(`
        SELECT s.*, p.name AS plan_name, p.slug AS plan_slug,
               p.ai_calls_limit, p.seats_limit, p.price_cents
        FROM subscriptions s
        JOIN plans p ON p.id = s.plan_id
        WHERE s.org_id = $1 AND s.status IN ('active','trialing','past_due')
        ORDER BY s.created_at DESC LIMIT 1
      `, [orgId]);
    } else {
      subQuery = await db.query(`
        SELECT s.*, p.name AS plan_name, p.slug AS plan_slug,
               p.ai_calls_limit, p.seats_limit, p.price_cents
        FROM subscriptions s
        JOIN plans p ON p.id = s.plan_id
        WHERE s.user_id = $1 AND s.status IN ('active','trialing','past_due')
        ORDER BY s.created_at DESC LIMIT 1
      `, [user.sub]);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        plans,
        subscription: subQuery.rows[0] || null,
      }),
    };
  } catch (err) {
    console.error('[billing-plans]', err);
    return { statusCode: 500, body: err.message };
  }
};
