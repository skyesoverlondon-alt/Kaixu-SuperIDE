// _lib/quota.js — Per-org / per-user AI call quota enforcement
// Usage: const { checkQuota, recordUsage } = require('./_lib/quota');
// Returns { allowed: true } or { allowed: false, limit, used, resetAt }

const { query } = require('./db');

/**
 * Check whether userId/orgId are within their plan's ai_calls_limit for
 * the current calendar month. Limit of -1 means unlimited.
 */
async function checkQuota(userId, orgId) {
  try {
    // Resolve plan limit: prefer org subscription, fall back to user subscription
    let planLimit = -1; // default: unlimited (free tier gets checked separately)
    let subId = null;

    const orgSub = orgId ? await query(`
      SELECT s.id, p.ai_calls_limit
      FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
      WHERE s.org_id = $1 AND s.status IN ('active','trialing')
      ORDER BY s.created_at DESC LIMIT 1
    `, [orgId]) : { rows: [] };

    if (orgSub.rows.length) {
      planLimit = orgSub.rows[0].ai_calls_limit;
      subId = orgSub.rows[0].id;
    } else {
      const userSub = await query(`
        SELECT s.id, p.ai_calls_limit
        FROM subscriptions s
        JOIN plans p ON p.id = s.plan_id
        WHERE s.user_id = $1 AND s.status IN ('active','trialing')
        ORDER BY s.created_at DESC LIMIT 1
      `, [userId]);
      if (userSub.rows.length) {
        planLimit = userSub.rows[0].ai_calls_limit;
        subId = userSub.rows[0].id;
      } else {
        // No subscription → free tier: 50 AI calls/month
        planLimit = 50;
      }
    }

    // -1 = unlimited
    if (planLimit === -1) return { allowed: true, unlimited: true };

    // Count AI calls this calendar month
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const usedRes = orgId
      ? await query(`
          SELECT COALESCE(SUM(quantity),0) AS used
          FROM usage_meters
          WHERE org_id=$1 AND event='ai_call' AND recorded_at>=$2
        `, [orgId, monthStart])
      : await query(`
          SELECT COALESCE(SUM(quantity),0) AS used
          FROM usage_meters
          WHERE user_id=$1 AND event='ai_call' AND recorded_at>=$2
        `, [userId, monthStart]);

    const used = parseInt(usedRes.rows[0]?.used || 0, 10);

    // Reset is start of next month
    const resetAt = new Date(monthStart);
    resetAt.setMonth(resetAt.getMonth() + 1);

    if (used >= planLimit) {
      return { allowed: false, limit: planLimit, used, resetAt };
    }
    return { allowed: true, limit: planLimit, used };
  } catch (err) {
    // Never block the user due to quota DB errors
    console.error('[quota] check failed:', err.message);
    return { allowed: true, error: err.message };
  }
}

/**
 * Record one AI call unit to usage_meters.
 * Fire-and-forget — never throws.
 */
async function recordUsage(userId, orgId, workspaceId) {
  try {
    await query(
      `INSERT INTO usage_meters (user_id, org_id, workspace_id, event, quantity)
       VALUES ($1, $2, $3, 'ai_call', 1)`,
      [userId || null, orgId || null, workspaceId || null]
    );
  } catch (err) {
    console.error('[quota] record failed:', err.message);
  }
}

module.exports = { checkQuota, recordUsage };
