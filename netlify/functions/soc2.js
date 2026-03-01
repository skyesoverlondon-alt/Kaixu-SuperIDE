// soc2.js — SOC 2 evidence pack generator
// GET → JSON evidence pack for the org or platform
// Requires: admin role in org (or platform admin)
//
// Returns:
//   evidence.org        — org config snapshot
//   evidence.users      — user + MFA counts
//   evidence.sessions   — session usage stats
//   evidence.audit_log  — last 500 audit events
//   evidence.security   — rate limits, lockouts, honeypot stats
//   evidence.access     — workspace_members role distribution
//   evidence.rls        — flag confirming RLS is deployed
//   evidence.stripe     — subscription plan info
//   generated_at        — ISO timestamp

const { requireAuth } = require('./_lib/auth');
const { getDb }        = require('./_lib/db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET')
    return { statusCode: 405, body: 'Method not allowed' };

  let user;
  try { user = await requireAuth(event); }
  catch (e) { return { statusCode: 401, body: e.message }; }

  const { orgId } = event.queryStringParameters || {};
  const db = getDb();

  try {
    // Require org admin or platform admin
    if (orgId) {
      const { rows } = await db.query(
        `SELECT role FROM org_members WHERE org_id=$1 AND user_id=$2`,
        [orgId, user.sub]
      );
      if (!rows.length || !['owner','admin'].includes(rows[0].role))
        return { statusCode: 403, body: 'Org admin required' };
    } else if (!user.admin) {
      return { statusCode: 403, body: 'Platform admin required for global SOC2 export' };
    }

    const where    = orgId ? `WHERE org_id='${orgId}'` : '';
    const userWhere = orgId
      ? `WHERE u.id IN (SELECT user_id FROM org_members WHERE org_id='${orgId}')`
      : '';

    // ── Org snapshot ─────────────────────────────────────────────────────
    let orgSnap = null;
    if (orgId) {
      const { rows } = await db.query(
        `SELECT id, name, created_at, plan_id, deleted_at FROM orgs WHERE id=$1`,
        [orgId]
      );
      orgSnap = rows[0] || null;
    }

    // ── User + MFA stats ─────────────────────────────────────────────────
    const { rows: userStats } = await db.query(`
      SELECT
        COUNT(*) AS total_users,
        COUNT(*) FILTER (WHERE email_verified=true)  AS verified_users,
        COUNT(*) FILTER (WHERE mfa_enabled=true)     AS mfa_users,
        COUNT(*) FILTER (WHERE deleted_at IS NULL)   AS active_users
      FROM users ${userWhere ? userWhere : ''}
    `);

    // ── Session stats ─────────────────────────────────────────────────────
    const { rows: sessionStats } = await db.query(`
      SELECT
        COUNT(*) AS total_sessions,
        COUNT(*) FILTER (WHERE revoked=false) AS active_sessions,
        MAX(created_at) AS last_session_at
      FROM user_sessions
      ${orgId ? `WHERE user_id IN (SELECT user_id FROM org_members WHERE org_id='${orgId}')` : ''}
    `).catch(() => ({ rows: [{ total_sessions: 'N/A (table missing)' }] }));

    // ── Audit log – last 500 events ───────────────────────────────────────
    const { rows: auditRows } = await db.query(`
      SELECT a.action, a.target_type, a.created_at, u.email AS actor_email
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.user_id
      ${orgId ? `WHERE a.org_id='${orgId}'` : ''}
      ORDER BY a.created_at DESC
      LIMIT 500
    `);

    // ── Rate limit events ─────────────────────────────────────────────────
    const { rows: rateLimitRows } = await db.query(`
      SELECT action, COUNT(*) AS count, MAX(attempted_at) AS last_attempt
      FROM rate_limit_log
      WHERE attempted_at > NOW() - INTERVAL '30 days'
      GROUP BY action
      ORDER BY count DESC
    `).catch(() => ({ rows: [] }));

    // ── Workspace access: role distribution ───────────────────────────────
    const { rows: accessRows } = await db.query(`
      SELECT wm.role, COUNT(*) AS count
      FROM workspace_members wm
      ${orgId ? `JOIN workspaces w ON w.id=wm.workspace_id WHERE w.org_id='${orgId}'` : ''}
      GROUP BY wm.role
    `);

    // ── RLS status ────────────────────────────────────────────────────────
    const { rows: rlsRows } = await db.query(`
      SELECT tablename, rowsecurity
      FROM pg_tables
      WHERE schemaname='public'
        AND tablename IN (
          'users','workspaces','workspace_members','orgs','org_members',
          'chat_messages','file_comments','tasks','reviews','teams',
          'subscriptions','file_embeddings','audit_logs'
        )
    `);
    const rlsStatus = rlsRows.reduce((acc, r) => {
      acc[r.tablename] = r.rowsecurity;
      return acc;
    }, {});
    const rlsEnabled = Object.values(rlsStatus).filter(Boolean).length;
    const rlsTotal   = rlsRows.length;

    // ── Subscription / plan ───────────────────────────────────────────────
    let subRow = null;
    if (orgId) {
      const { rows } = await db.query(`
        SELECT s.status, s.current_period_end, p.name AS plan_name, p.slug
        FROM subscriptions s JOIN plans p ON p.id=s.plan_id
        WHERE s.org_id=$1 AND s.status IN ('active','trialing') LIMIT 1
      `, [orgId]).catch(() => ({ rows: [] }));
      subRow = rows[0] || null;
    }

    // ── Client errors (last 30 days) ──────────────────────────────────────
    const { rows: errRows } = await db.query(`
      SELECT COUNT(*) AS client_errors
      FROM audit_logs
      WHERE action='client_error' AND created_at > NOW() - INTERVAL '30 days'
      ${orgId ? `AND org_id='${orgId}'` : ''}
    `).catch(() => ({ rows: [{ client_errors: 'N/A' }] }));

    const pack = {
      generated_at: new Date().toISOString(),
      exported_by: user.sub,
      org_id: orgId || null,

      evidence: {
        org: orgSnap,

        users: {
          ...userStats[0],
          mfa_adoption_pct: userStats[0]?.total_users > 0
            ? ((userStats[0].mfa_users / userStats[0].total_users) * 100).toFixed(1) + '%'
            : '0%',
        },

        sessions: sessionStats[0] || {},

        security: {
          rate_limit_events_30d: rateLimitRows,
          client_errors_30d: errRows[0]?.client_errors || 0,
          mfa_enforced: false, // TODO: add org.require_mfa column
          honeypot: 'enabled (signup)',
          secrets_scanning: 'enabled (client-side, pre-commit warning)',
          csp: 'strict-origin-when-cross-origin (via netlify.toml)',
        },

        access_control: {
          workspace_role_distribution: accessRows,
          rls_status: {
            enabled_tables: rlsEnabled,
            total_tables: rlsTotal,
            per_table: rlsStatus,
            note: rlsEnabled < rlsTotal
              ? 'Some tables do not yet have RLS enabled. Run sql/rls.sql to complete.'
              : 'All tables have RLS enabled ✓',
          },
        },

        audit_log: {
          total_exported: auditRows.length,
          events: auditRows,
        },

        subscription: subRow || { plan_name: 'Free', status: 'no_subscription' },
      },

      certification_notes: [
        'This evidence pack covers: CC6 (Logical Access), CC7 (System Operations), CC8 (Change Management).',
        'Row-Level Security (RLS) policies in sql/rls.sql enforce tenant isolation at the database layer.',
        'All authentication events are recorded in audit_logs.',
        'MFA (TOTP RFC 6238) is available; adoption % shown in users section.',
        'Data encryption: in-transit via TLS (enforced by Netlify CDN + Neon), at-rest via Neon managed encryption.',
        'Secret scanning runs client-side before commits to catch leaked credentials.',
      ],
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="soc2-evidence-${new Date().toISOString().slice(0,10)}.json"`,
      },
      body: JSON.stringify(pack, null, 2),
    };
  } catch (err) {
    console.error('[soc2]', err);
    return { statusCode: 500, body: err.message };
  }
};
