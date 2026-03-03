// notifications.js — send and manage Slack/email notifications for org events
//
// GET  ?orgId=&userId=          → list notification preferences
// POST (manage)  { action:'set', orgId?, userId?, channel, config, events }
// POST (trigger) { action:'send', event, data, orgId?, userId? }
//
// Env vars:
//   RESEND_API_KEY or SENDGRID_API_KEY — for email notifications
//   SMTP_FROM_EMAIL       — sender address (e.g. noreply@yourapp.com)
//
// Slack webhooks are configured by the org/user in notification_preferences.config.webhook_url

const { requireAuth } = require('./_lib/auth');
const { getDb }        = require('./_lib/db');
const { sendEmail }    = require('./_lib/email');
const https            = require('https');
const { URL }          = require('url');
const logger           = require('./_lib/logger')('notifications');

// ── Delivery: Slack ───────────────────────────────────────────────────────
async function deliverSlack(webhookUrl, text, blocks) {
  const payload = JSON.stringify(blocks ? { text, blocks } : { text });
  return new Promise((resolve, reject) => {
    const u = new URL(webhookUrl);
    const opts = {
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Delivery: Email via shared provider utility (Resend/SendGrid) ─────────
async function deliverEmail(to, subject, text) {
  const result = await sendEmail({ to, subject, text });
  if (!result.ok) throw new Error(result.error || 'Email delivery failed');
  return { status: result.statusCode || 200 };
}

// ── Delivery: Custom Webhook ───────────────────────────────────────────────
async function deliverWebhook(webhookUrl, event, data) {
  const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  return new Promise((resolve, reject) => {
    const u = new URL(webhookUrl);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-Kaixu-Event': event,
      },
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Build human-readable message ──────────────────────────────────────────
function buildMessage(event, data) {
  const templates = {
    'task.created':       `📋 New task: "${data.title || 'Untitled'}" (priority: ${data.priority || 'medium'})`,
    'task.updated':       `✏️ Task updated: "${data.title || ''}" → status: ${data.status || '?'}`,
    'review.requested':   `👀 Code review requested for workspace "${data.workspaceName || data.workspaceId || ''}"`,
    'review.approved':    `✅ Code review approved by ${data.reviewer || 'someone'}`,
    'review.changes':     `🔄 Changes requested on review by ${data.reviewer || 'someone'}`,
    'ws.shared':          `🔗 Workspace "${data.workspaceName || data.workspaceId || ''}" was shared with ${data.invitee || 'someone'}`,
    'invite.accepted':    `👾 ${data.email || 'Someone'} accepted your invite to org "${data.orgName || ''}"`,
    'ws.save':            `💾 Workspace saved: "${data.workspaceName || ''}"`,
    'member.joined':      `🎉 ${data.email || 'A new member'} joined the org`,
    'member.removed':     `👋 ${data.email || 'A member'} was removed from the org`,
    'ai.limit_warning':   `⚠️ AI usage warning: ${data.used || '?'}/${data.limit || '?'} calls used this month`,
    'subscription.changed': `💳 Subscription changed to ${data.planName || 'new plan'}`,
  };
  return templates[event] || `kAIxU event: ${event} — ${JSON.stringify(data)}`;
}

// ── Main Handler ──────────────────────────────────────────────────────────
exports.handler = async (event) => {
  let user;
  try { user = await requireAuth(event); }
  catch (e) { return { statusCode: 401, body: e.message }; }

  const db = getDb();

  // ── GET: list preferences ────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const { orgId, userId } = event.queryStringParameters || {};
    const target = userId || user.sub;

    // Org admin can read org prefs; user reads own prefs
    if (orgId) {
      const { rows } = await db.query(
        'SELECT role FROM org_members WHERE org_id=$1 AND user_id=$2',
        [orgId, user.sub]
      );
      if (!rows.length) return { statusCode: 403, body: 'Not an org member' };
    }

    const { rows } = await db.query(
      `SELECT id, channel, events, enabled, created_at,
              config->'webhook_url' IS NOT NULL AS has_slack,
              config->'to' IS NOT NULL AS has_email
       FROM notification_preferences
       WHERE ${orgId ? `org_id='${orgId}'` : `user_id='${target}'`}
       ORDER BY channel`
    );
    return { statusCode: 200, body: JSON.stringify({ preferences: rows }) };
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { action } = body;

  // ── action: set — upsert notification preference ─────────────────────────
  if (action === 'set') {
    const { orgId, userId, channel, config = {}, events = [], enabled = true } = body;
    if (!channel) return { statusCode: 400, body: 'channel required' };
    if (!['email','slack','webhook'].includes(channel))
      return { statusCode: 400, body: 'Invalid channel' };

    const targetUserId = orgId ? null : (userId || user.sub);
    const targetOrgId  = orgId || null;

    if (orgId) {
      const { rows } = await db.query(
        'SELECT role FROM org_members WHERE org_id=$1 AND user_id=$2',
        [orgId, user.sub]
      );
      if (!rows.length || !['owner','admin'].includes(rows[0].role))
        return { statusCode: 403, body: 'Org admin required' };
    }

    await db.query(`
      INSERT INTO notification_preferences (user_id, org_id, channel, config, events, enabled)
      VALUES ($1, $2, $3, $4::jsonb, $5::text[], $6)
      ON CONFLICT (${orgId ? 'org_id, channel' : 'user_id, channel'}) DO UPDATE
        SET config=$4::jsonb, events=$5::text[], enabled=$6
    `, [targetUserId, targetOrgId, channel, JSON.stringify(config), events, enabled]);

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  // ── action: delete — remove preference ──────────────────────────────────
  if (action === 'delete') {
    const { id } = body;
    if (!id) return { statusCode: 400, body: 'id required' };
    await db.query(
      'DELETE FROM notification_preferences WHERE id=$1 AND (user_id=$2 OR org_id IN (SELECT org_id FROM org_members WHERE user_id=$2 AND role IN (\'owner\',\'admin\')))',
      [id, user.sub]
    );
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  // ── action: send — trigger notification for an event ────────────────────
  if (action === 'send') {
    const { event: evtName, data = {}, orgId, userId: targetUserId } = body;
    if (!evtName) return { statusCode: 400, body: 'event required' };

    // Look up all matching preferences
    const conditions = [];
    if (orgId)         conditions.push(`org_id='${orgId}'`);
    if (targetUserId)  conditions.push(`user_id='${targetUserId}'`);
    if (!conditions.length) {
      return { statusCode: 400, body: 'orgId or userId required for send' };
    }

    const { rows: prefs } = await db.query(`
      SELECT channel, config, events FROM notification_preferences
      WHERE enabled=true AND (${conditions.join(' OR ')})
        AND (events && ARRAY[$1]::text[] OR events = ARRAY[]::text[])
    `, [evtName]);

    const message = buildMessage(evtName, data);
    const results = [];

    for (const pref of prefs) {
      const cfg = pref.config || {};
      try {
        if (pref.channel === 'slack' && cfg.webhook_url) {
          const r = await deliverSlack(cfg.webhook_url, message);
          results.push({ channel: 'slack', status: r.status });
        } else if (pref.channel === 'email' && cfg.to) {
          const r = await deliverEmail(cfg.to, `[kAIxU] ${evtName}`, message);
          results.push({ channel: 'email', status: r.status });
        } else if (pref.channel === 'webhook' && cfg.url) {
          const r = await deliverWebhook(cfg.url, evtName, data);
          results.push({ channel: 'webhook', status: r.status });
        }
      } catch (deliveryErr) {
        logger.error('delivery_failed', { channel: pref.channel, error: deliveryErr.message });
        results.push({ channel: pref.channel, error: deliveryErr.message });
      }
    }

    // Also fire existing webhooks from webhooks table
    const { rows: webhooks } = await db.query(`
      SELECT url, secret FROM webhooks
      WHERE enabled=true AND (org_id=$1 OR workspace_id=$2)
        AND (events = '{}' OR $3 = ANY(events))
    `, [orgId || null, data.workspaceId || null, evtName]);

    for (const wh of webhooks) {
      try {
        await deliverWebhook(wh.url, evtName, data);
        results.push({ channel: 'webhook_table', url: wh.url, status: 'sent' });
      } catch (err) {
        results.push({ channel: 'webhook_table', url: wh.url, error: err.message });
      }
    }

    logger.info('event_delivered', { event: evtName, channels: results.length });
    return { statusCode: 200, body: JSON.stringify({ ok: true, delivered: results.length, results }) };
  }

  return { statusCode: 400, body: `Unknown action: ${action}` };
};
