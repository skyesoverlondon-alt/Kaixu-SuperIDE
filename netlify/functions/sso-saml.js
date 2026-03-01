/*
  sso-saml.js — SAML 2.0 SSO for kAIxU SuperIDE

  SP-initiated flow:
    GET  /sso-saml?orgId=xxx        → redirect to IdP login page
    POST /sso-saml                  → receive SAML assertion, validate, issue JWT + redirect

  Org must have sso_provider='saml' and sso_config set:
    {
      "entryPoint": "https://idp.example.com/sso/saml",
      "issuer":     "https://kaixu.app",
      "cert":       "-----BEGIN CERTIFICATE-----\n..."
    }

  Env vars:
    JWT_SECRET     — same secret used throughout auth
    APP_URL        — your Netlify site URL (for redirect after auth)
    DATABASE_URL   — Neon connection string

  Dependencies: passport-saml (npm install passport-saml)
*/

const { query } = require('./_lib/db');
const { signToken, json } = require('./_lib/auth');
const logger = require('./_lib/logger')('sso-saml');
const crypto = require('crypto');

// ── SAML helpers ─────────────────────────────────────────────────────────────
function getSamlStrategy(config) {
  try {
    const { Strategy } = require('@node-saml/node-saml');
    return new Strategy({
      entryPoint:          config.entryPoint,
      issuer:              config.issuer || 'https://kaixu.app',
      cert:                config.cert,
      callbackUrl:         `${process.env.APP_URL}/.netlify/functions/sso-saml`,
      disableRequestedAuthnContext: true,
      wantAssertionsSigned: false,
    });
  } catch (e) {
    throw new Error('@node-saml/node-saml is not installed. Run: npm install @node-saml/node-saml');
  }
}

// ── Fetch org SAML config from DB ─────────────────────────────────────────────
async function getOrgSamlConfig(orgId) {
  const res = await query(
    `SELECT id, name, sso_provider, sso_config FROM orgs WHERE id = $1`,
    [orgId]
  );
  const org = res.rows[0];
  if (!org) throw new Error('Org not found');
  if (org.sso_provider !== 'saml') throw new Error('Org does not have SAML configured');
  if (!org.sso_config?.entryPoint || !org.sso_config?.cert) {
    throw new Error('Org SAML config is incomplete (requires entryPoint and cert)');
  }
  return { org, config: org.sso_config };
}

// ── JIT provisioning — create user on first SSO login ─────────────────────────
async function jitProvision({ email, firstName, lastName, orgId }) {
  const emailLower = email.toLowerCase().trim();

  // Check if user already exists
  const existing = await query(`SELECT id, email FROM users WHERE email = $1`, [emailLower]);
  let userId;

  if (existing.rows[0]) {
    userId = existing.rows[0].id;
  } else {
    // Create new user — SSO users have no password
    const created = await query(
      `INSERT INTO users (email, email_verified, sso_provider, created_at)
       VALUES ($1, true, 'saml', NOW())
       RETURNING id`,
      [emailLower]
    );
    userId = created.rows[0].id;
    logger.info('jit_user_created', { email: emailLower, orgId });
  }

  // Ensure org membership
  await query(
    `INSERT INTO org_members (org_id, user_id, role)
     VALUES ($1, $2, 'member')
     ON CONFLICT (org_id, user_id) DO NOTHING`,
    [orgId, userId]
  );

  return { id: userId, email: emailLower, firstName, lastName };
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const appUrl = process.env.APP_URL || 'https://localhost';

  // ── GET: initiate SP-initiated SAML flow ────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const { orgId } = event.queryStringParameters || {};
    if (!orgId) return json(400, { ok: false, error: 'orgId required' });

    try {
      const { config } = await getOrgSamlConfig(orgId);
      const saml = getSamlStrategy(config);

      // Generate SAML AuthnRequest redirect URL
      const redirectUrl = await new Promise((resolve, reject) => {
        saml.getAuthorizeUrl({}, (err, url) => err ? reject(err) : resolve(url));
      });

      // Stash orgId in RelayState so we can retrieve it on the callback
      const relayState = Buffer.from(JSON.stringify({ orgId })).toString('base64');
      const finalUrl = `${redirectUrl}&RelayState=${encodeURIComponent(relayState)}`;

      return {
        statusCode: 302,
        headers: { Location: finalUrl },
        body: '',
      };
    } catch (err) {
      logger.error('saml_initiate_failed', { error: err.message, orgId });
      return { statusCode: 302, headers: { Location: `${appUrl}/index.html?sso_error=${encodeURIComponent(err.message)}` }, body: '' };
    }
  }

  // ── POST: receive SAML assertion callback from IdP ──────────────────────────
  if (event.httpMethod === 'POST') {
    try {
      // Parse form body (SAML posts application/x-www-form-urlencoded)
      const params = new URLSearchParams(event.body || '');
      const samlResponse = params.get('SAMLResponse');
      const relayStateRaw = params.get('RelayState');

      if (!samlResponse) return json(400, { ok: false, error: 'Missing SAMLResponse' });

      let orgId;
      try {
        const relay = JSON.parse(Buffer.from(relayStateRaw || '', 'base64').toString());
        orgId = relay.orgId;
      } catch {
        return json(400, { ok: false, error: 'Invalid RelayState' });
      }

      const { config } = await getOrgSamlConfig(orgId);
      const saml = getSamlStrategy(config);

      // Validate SAML assertion
      const profile = await new Promise((resolve, reject) => {
        saml.validatePostResponse({ SAMLResponse: samlResponse }, (err, profile) =>
          err ? reject(err) : resolve(profile)
        );
      });

      const email = profile.email || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] || profile.nameID;
      if (!email) throw new Error('IdP did not return an email in SAML assertion');

      const firstName = profile.firstName || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'] || '';
      const lastName  = profile.lastName  || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname']    || '';

      // JIT provision
      const user = await jitProvision({ email, firstName, lastName, orgId });

      // Issue JWT (same format as auth-login)
      const token = signToken({ sub: user.id, email: user.email });

      // Log audit event
      query(
        `INSERT INTO audit_events (actor_id, event_type, resource_type, resource_id, metadata)
         VALUES ($1, 'sso.login', 'user', $1, $2)`,
        [user.id, JSON.stringify({ provider: 'saml', orgId })]
      ).catch(() => {});

      // Redirect to IDE with token in URL fragment (never in query string)
      return {
        statusCode: 302,
        headers: { Location: `${appUrl}/ide.html#sso_token=${token}` },
        body: '',
      };
    } catch (err) {
      logger.error('saml_callback_failed', { error: err.message });
      return {
        statusCode: 302,
        headers: { Location: `${appUrl}/index.html?sso_error=${encodeURIComponent(err.message)}` },
        body: '',
      };
    }
  }

  return json(405, { ok: false, error: 'Method not allowed' });
};
