// usage-meter.js — record a usage event to usage_meters table
// POST { event, workspaceId?, orgId?, quantity? }
// Auth optional (event = 'ai_call', 'page_view', etc.)

const { getDb }       = require('./_lib/db');
const { getBearer, verifyToken } = require('./_lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { event: meterEvent, workspaceId, orgId, quantity = 1 } = body;
  if (!meterEvent) return { statusCode: 400, body: 'event required' };

  // Auth is optional; try to get user_id
  let userId = null;
  try {
    const token = getBearer(event);
    if (token) {
      const decoded = verifyToken(token);
      userId = decoded?.sub || null;
    }
  } catch { /* no auth — use anonymous */ }

  const db = getDb();
  try {
    // Get subscription if we have a user / org
    let subId = null;
    if (userId || orgId) {
      const { rows } = await db.query(`
        SELECT id FROM subscriptions
        WHERE (user_id=$1 OR org_id=$2)
          AND status IN ('active','trialing')
        ORDER BY created_at DESC LIMIT 1
      `, [userId, orgId || null]);
      subId = rows[0]?.id || null;
    }

    await db.query(`
      INSERT INTO usage_meters (subscription_id, user_id, org_id, event, quantity, recorded_at)
      VALUES ($1,$2,$3,$4,$5,NOW())
    `, [subId, userId, orgId || null, meterEvent, quantity]);

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    // Never fail the caller over metering errors
    require('./_lib/logger')('usage-meter').error('meter_error', { message: err.message });
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
