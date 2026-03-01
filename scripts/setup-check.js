#!/usr/bin/env node
/**
 * scripts/setup-check.js — kAIxU SuperIDE environment pre-flight check
 *
 * Run before first deployment or after changing env vars:
 *   node scripts/setup-check.js
 *
 * Checks:
 *   1. All required environment variables are set
 *   2. JWT_SECRET meets minimum strength requirements
 *   3. Database connection is reachable (optional: pass --db to test)
 *   4. Kaixu AI gateway is reachable (optional: pass --gate to test)
 *   5. Stripe credentials format (optional: pass --stripe to test)
 */

'use strict';

const flags = process.argv.slice(2);
const CHECK_DB    = flags.includes('--db');
const CHECK_GATE  = flags.includes('--gate');
const CHECK_STRIPE = flags.includes('--stripe');
const CHECK_ALL   = flags.includes('--all');

// ── Colour helpers ────────────────────────────────────────────────────────────
const c = {
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

const PASS = c.green('✓');
const FAIL = c.red('✗');
const WARN = c.yellow('⚠');
const INFO = c.cyan('·');

let errors = 0;
let warnings = 0;

function pass(msg) { console.log(`  ${PASS}  ${msg}`); }
function fail(msg) { console.log(`  ${FAIL}  ${c.red(msg)}`); errors++; }
function warn(msg) { console.log(`  ${WARN}  ${c.yellow(msg)}`); warnings++; }
function info(msg) { console.log(`  ${INFO}  ${c.dim(msg)}`); }

// ── Required env vars ─────────────────────────────────────────────────────────
const REQUIRED = [
  { key: 'JWT_SECRET',          desc: 'JWT signing secret (64+ chars recommended)',  minLen: 16 },
  { key: 'DATABASE_URL',        desc: 'Neon PostgreSQL connection string',           minLen: 20 },
  { key: 'KAIXU_GATE_TOKEN',    desc: 'Bearer token for kAIxU AI gateway',           minLen: 10 },
];

const OPTIONAL = [
  { key: 'KAIXU_GATE_BASE',     desc: 'AI gateway base URL (default: kaixu67.skyesoverlondon.workers.dev)' },
  { key: 'KAIXU_DEFAULT_MODEL', desc: 'Default AI model (default: kAIxU-flash)' },
  { key: 'DATABASE_REPLICA_URL',desc: 'Neon read replica URL (Phase 28: multi-region reads)' },
  { key: 'SENDGRID_API_KEY',    desc: 'SendGrid API key (required for all emails)' },
  { key: 'SMTP_FROM_EMAIL',     desc: 'From address for transactional emails' },
  { key: 'APP_URL',             desc: 'Public site URL (used in email links)' },
  { key: 'STRIPE_SECRET_KEY',   desc: 'Stripe secret key (required for billing)' },
  { key: 'STRIPE_WEBHOOK_SECRET',desc:'Stripe webhook signing secret' },
  { key: 'GITHUB_CLIENT_ID',    desc: 'GitHub OAuth App client ID (required for GitHub integration)' },
  { key: 'GITHUB_CLIENT_SECRET',desc: 'GitHub OAuth App client secret' },
  { key: 'SENTRY_DSN',          desc: 'Sentry DSN (required for error monitoring)' },
  { key: 'SAML_SP_CERT',        desc: 'SAML SP certificate PEM (required for SAML SSO)' },
  { key: 'SAML_SP_KEY',         desc: 'SAML SP private key PEM (required for SAML SSO)' },
];

// ── Section: Required vars ────────────────────────────────────────────────────
console.log('\n' + c.bold('kAIxU SuperIDE — Setup Pre-flight Check'));
console.log(c.dim('─'.repeat(50)));
console.log(c.bold('\n① Required environment variables\n'));

for (const { key, desc, minLen } of REQUIRED) {
  const val = process.env[key];
  if (!val) {
    fail(`${key} is not set — ${desc}`);
  } else if (minLen && val.length < minLen) {
    fail(`${key} is too short (${val.length} chars, need ${minLen}+) — ${desc}`);
  } else {
    pass(`${key} ${c.dim(`(${val.length} chars)`)}`);
  }
}

// ── Section: JWT strength ────────────────────────────────────────────────────
console.log(c.bold('\n② JWT_SECRET strength\n'));
const jwtSecret = process.env.JWT_SECRET || '';
if (jwtSecret.length >= 64) {
  pass('JWT_SECRET is 64+ characters — good');
} else if (jwtSecret.length >= 32) {
  warn('JWT_SECRET is 32–63 characters — acceptable but 64+ recommended for production');
} else if (jwtSecret.length >= 16) {
  warn('JWT_SECRET is 16–31 characters — increase to 64+ before production');
}

// ── Section: Optional vars ───────────────────────────────────────────────────
console.log(c.bold('\n③ Optional environment variables\n'));

const emailVars = ['SENDGRID_API_KEY', 'SMTP_FROM_EMAIL', 'APP_URL'];
const billingVars = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
const githubVars = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'];
const ssoVars = ['SAML_SP_CERT', 'SAML_SP_KEY'];
const observabilityVars = ['SENTRY_DSN'];

for (const { key, desc } of OPTIONAL) {
  const val = process.env[key];
  if (val) {
    pass(`${key} ${c.dim('set')}`);
  } else {
    const group = emailVars.includes(key) ? 'emails'
      : billingVars.includes(key) ? 'billing'
      : githubVars.includes(key) ? 'GitHub integration'
      : ssoVars.includes(key) ? 'SAML SSO'
      : observabilityVars.includes(key) ? 'error monitoring'
      : 'optional feature';
    info(`${key} not set — ${group} feature will be unavailable (${desc})`);
  }
}

// ── Section: Model name check ─────────────────────────────────────────────────
console.log(c.bold('\n④ Model name compliance\n'));
const model = process.env.KAIXU_DEFAULT_MODEL || 'kAIxU-flash';
const allowedModels = ['kAIxU-flash', 'kAIxU-pro'];
if (allowedModels.includes(model)) {
  pass(`KAIXU_DEFAULT_MODEL = ${model} ${c.dim('(valid gate branded name)')}`);
} else {
  fail(`KAIXU_DEFAULT_MODEL = "${model}" — must be one of: ${allowedModels.join(', ')}. Raw vendor model IDs are rejected by the gate.`);
}

// ── Section: Database connection ─────────────────────────────────────────────
if (CHECK_DB || CHECK_ALL) {
  console.log(c.bold('\n⑤ Database connection\n'));
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
    const res = await pool.query('SELECT current_database(), now()');
    pass(`Connected to: ${res.rows[0].current_database}`);
    pass(`Server time: ${res.rows[0].now}`);

    // Check tables exist
    const tables = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    const tableNames = tables.rows.map(r => r.table_name);
    const requiredTables = ['users','workspaces','orgs','org_memberships','plans','sessions','audit_events','global_settings'];
    for (const t of requiredTables) {
      if (tableNames.includes(t)) pass(`Table exists: ${t}`);
      else fail(`Table missing: ${t} — run: node scripts/migrate.js`);
    }

    // Check pgvector
    const ext = await pool.query(`SELECT extname FROM pg_extension WHERE extname = 'vector'`);
    if (ext.rows.length) pass('pgvector extension enabled');
    else warn('pgvector extension not found — run: CREATE EXTENSION IF NOT EXISTS vector; (required for embeddings/RAG)');

    await pool.end();
  } catch (err) {
    fail(`Database connection failed: ${err.message}`);
    if (err.message.includes('ECONNREFUSED') || err.message.includes('ETIMEDOUT')) {
      info('Check DATABASE_URL and ensure Neon project is active');
    }
  }
}

// ── Section: AI gateway ping ─────────────────────────────────────────────────
if (CHECK_GATE || CHECK_ALL) {
  console.log(c.bold('\n⑥ kAIxU AI gateway\n'));
  try {
    const base = (process.env.KAIXU_GATE_BASE || 'https://kaixu67.skyesoverlondon.workers.dev').replace(/\/+$/, '');
    const token = process.env.KAIXU_GATE_TOKEN || '';
    if (!token) {
      fail('KAIXU_GATE_TOKEN not set — cannot test gateway');
    } else {
      const res = await fetch(`${base}/v1/health`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.ok) {
        pass(`Gateway healthy: ${base}/v1/health`);
        pass(`keyConfigured: ${data.keyConfigured}`);
        pass(`authConfigured: ${data.authConfigured}`);
        if (data.openGate) warn('openGate: true — token auth is DISABLED in the gateway. This is insecure for production.');
      } else {
        fail(`Gateway returned ok:false — ${data.error || 'unknown error'}`);
      }
    }
  } catch (err) {
    fail(`Gateway request failed: ${err.message}`);
  }
}

// ── Section: Stripe format check ──────────────────────────────────────────────
if (CHECK_STRIPE || CHECK_ALL) {
  console.log(c.bold('\n⑦ Stripe credentials format\n'));
  const sk = process.env.STRIPE_SECRET_KEY || '';
  const wh = process.env.STRIPE_WEBHOOK_SECRET || '';

  if (!sk) fail('STRIPE_SECRET_KEY not set');
  else if (sk.startsWith('sk_live_')) pass('STRIPE_SECRET_KEY — live mode');
  else if (sk.startsWith('sk_test_')) warn('STRIPE_SECRET_KEY — test mode (ok for staging, not production)');
  else fail('STRIPE_SECRET_KEY format unrecognised — should start with sk_live_ or sk_test_');

  if (!wh) fail('STRIPE_WEBHOOK_SECRET not set — webhook signature verification will fail');
  else if (wh.startsWith('whsec_')) pass('STRIPE_WEBHOOK_SECRET — format ok');
  else fail('STRIPE_WEBHOOK_SECRET format unrecognised — should start with whsec_');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + c.dim('─'.repeat(50)));

if (errors === 0 && warnings === 0) {
  console.log(c.green(c.bold('\n✓ All checks passed — ready to deploy\n')));
  process.exit(0);
} else if (errors === 0) {
  console.log(c.yellow(c.bold(`\n⚠ ${warnings} warning(s) — review before production\n`)));
  process.exit(0);
} else {
  console.log(c.red(c.bold(`\n✗ ${errors} error(s), ${warnings} warning(s) — fix before deploying\n`)));
  if (!CHECK_DB && !CHECK_ALL) info('Run with --db to test database connection');
  if (!CHECK_GATE && !CHECK_ALL) info('Run with --gate to test AI gateway');
  if (!CHECK_STRIPE && !CHECK_ALL) info('Run with --stripe to test Stripe credentials');
  info('Run with --all to test everything');
  console.log();
  process.exit(1);
}
