const { query } = require('./_lib/db');
const { requireAuth } = require('./_lib/auth');
const { json } = require('./_lib/body');

// Usage dashboard: AI calls, rate limit hits, member counts, workspace counts
exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });
  let userId;
  try { ({ userId } = requireAuth(event)); } catch (e) { return json(401, { ok: false, error: e.message }); }

  const orgId = event.queryStringParameters?.orgId || null;

  // Check admin
  if (orgId) {
    const mem = await query(`select role from org_memberships where org_id=$1 and user_id=$2`, [orgId, userId]);
    if (!mem.rows[0] || !['owner','admin'].includes(mem.rows[0].role)) {
      return json(403, { ok: false, error: 'Admin only' });
    }
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30d

  const [aiQ, aiErrQ, rateQ, wsQ, membersQ] = await Promise.all([
    // AI calls + avg latency
    orgId
      ? query(`select count(*) as calls, round(avg(latency_ms)) as avg_ms, sum(prompt_tokens+completion_tokens) as tokens
               from ai_usage_log where org_id=$1 and created_at>$2 and success=true`, [orgId, since])
      : query(`select count(*) as calls, round(avg(latency_ms)) as avg_ms, sum(prompt_tokens+completion_tokens) as tokens
               from ai_usage_log where user_id=$1 and created_at>$2 and success=true`, [userId, since]),
    // AI failures
    orgId
      ? query(`select count(*) as errors from ai_usage_log where org_id=$1 and created_at>$2 and success=false`, [orgId, since])
      : query(`select count(*) as errors from ai_usage_log where user_id=$1 and created_at>$2 and success=false`, [userId, since]),
    // Rate limit hits
    query(`select count(*) as hits from rate_limit_log where created_at>$1`, [since]),
    // Workspace count
    orgId
      ? query(`select count(*) as total from workspaces where org_id=$1`, [orgId])
      : query(`select count(*) as total from workspaces where user_id=$1`, [userId]),
    // Member count
    orgId
      ? query(`select count(*) as total from org_memberships where org_id=$1`, [orgId])
      : null
  ]);

  // AI calls per day (last 7 days)
  const dailyKey = orgId ? `org_id=$1` : `user_id=$1`;
  const dailyParam = orgId || userId;
  const daily = await query(
    `select date_trunc('day', created_at) as day, count(*) as calls
     from ai_usage_log where ${dailyKey} and created_at > now()-interval '7 days'
     group by 1 order by 1`,
    [dailyParam]
  );

  const aiEnabled = await query(`select value from global_settings where key='ai_enabled'`);

  return json(200, {
    ok: true,
    period: '30d',
    aiEnabled: aiEnabled.rows[0]?.value !== 'false',
    aiCalls: parseInt(aiQ.rows[0]?.calls || 0),
    aiAvgLatencyMs: parseInt(aiQ.rows[0]?.avg_ms || 0),
    aiTokensUsed: parseInt(aiQ.rows[0]?.tokens || 0),
    aiErrors: parseInt(aiErrQ.rows[0]?.errors || 0),
    rateLimitHits: parseInt(rateQ.rows[0]?.hits || 0),
    workspaceCount: parseInt(wsQ.rows[0]?.total || 0),
    memberCount: membersQ ? parseInt(membersQ.rows[0]?.total || 0) : 1,
    dailyCalls: daily.rows.map(r => ({ day: r.day, calls: parseInt(r.calls) }))
  });
};
