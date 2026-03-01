/*
  sso-oidc.js — OIDC / OAuth 2.0 SSO for kAIxU SuperIDE

  Supports: Google Workspace, Microsoft Azure AD, GitHub Enterprise, Okta, generic OIDC

  SP-initiated flow:
    GET  /sso-oidc?provider=google&orgId=xxx  → redirect to provider consent screen
    GET  /sso-oidc?code=...&state=...          → OIDC callback after user authenticates

  Org must have sso_provider='oidc' and sso_config set:
    {
      "provider":     "google" | "microsoft" | "github" | "okta" | "generic",
      "clientId":     "...",
      "clientSecret": "...",
      "domain":       "company.com",         // for Google Workspace HD param
      "tenantId":     "...",                 // for Azure AD
      "discoveryUrl": "https://..."          // for generic OIDC / Okta
    }

  Env vars:
    JWT_SECRET  — same secret used throughout auth
    APP_URL     — your Netlify site URL (for OIDC redirect_uri)
    DATABASE_URL — Neon connection string
*/

const { query } = require('./_lib/db');
const { signToken, json } = require('./_lib/auth');
const logger = require('./_lib/logger')('sso-oidc');
const crypto = require('crypto');

const CALLBACK_PATH = '/.netlify/functions/sso-oidc';

// ── Provider configs ───────────────────────────────────────────────────────────
function providerConfig(ssoConfig) {
  const appUrl = process.env.APP_URL || 'https://localhost';
  const redirectUri = `${appUrl}${CALLBACK_PATH}`;

  const providers = {
    google: {
      authUrl:    'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl:   'https://oauth2.googleapis.com/token',
      userinfoUrl:'https://www.googleapis.com/oauth2/v3/userinfo',
      scope:      'openid email profile',
      extraParams: ssoConfig.domain ? { hd: ssoConfig.domain } : {},
    },
    microsoft: {
      authUrl:    `https://login.microsoftonline.com/${ssoConfig.tenantId || 'common'}/oauth2/v2.0/authorize`,
      tokenUrl:   `https://login.microsoftonline.com/${ssoConfig.tenantId || 'common'}/oauth2/v2.0/token`,
      userinfoUrl:`https://graph.microsoft.com/v1.0/me`,
      scope:      'openid email profile User.Read',
      extraParams: {},
    },
    github: {
      authUrl:    `https://${ssoConfig.githubHost || 'github.com'}/login/oauth/authorize`,
      tokenUrl:   `https://${ssoConfig.githubHost || 'github.com'}/login/oauth/access_token`,
      userinfoUrl:`https://${ssoConfig.githubApiHost || 'api.github.com'}/user`,
      scope:      'read:user user:email',
      extraParams: {},
      responseType: 'code', // GitHub doesn't use OIDC discovery
    },
    okta: {
      authUrl:    `${ssoConfig.discoveryUrl}/v1/authorize`,
      tokenUrl:   `${ssoConfig.discoveryUrl}/v1/token`,
      userinfoUrl:`${ssoConfig.discoveryUrl}/v1/userinfo`,
      scope:      'openid email profile',
      extraParams: {},
    },
    generic: {
      authUrl:    ssoConfig.authorizationEndpoint,
      tokenUrl:   ssoConfig.tokenEndpoint,
      userinfoUrl:ssoConfig.userinfoEndpoint,
      scope:      ssoConfig.scope || 'openid email profile',
      extraParams: {},
    },
  };

  return { ...(providers[ssoConfig.provider] || providers.generic), redirectUri };
}

// ── Fetch org OIDC config from DB ─────────────────────────────────────────────────
async function getOrgOidcConfig(orgId) {
  const res = await query(
    `SELECT id, name, sso_provider, sso_domain, sso_config FROM orgs WHERE id = $1`,
    [orgId]
  );
  const org = res.rows[0];
  if (!org) throw new Error('Org not found');
  if (!['oidc', 'google', 'microsoft', 'github', 'okta'].includes(org.sso_provider)) {
    throw new Error('Org does not have OIDC configured');
  }
  if (!org.sso_config?.clientId || !org.sso_config?.clientSecret) {
    throw new Error('Org OIDC config is incomplete (requires clientId and clientSecret)');
  }
  return { org, config: { ...org.sso_config, provider: org.sso_config.provider || org.sso_provider } };
}

// ── JIT provisioning ───────────────────────────────────────────────────────────
async function jitProvision({ email, name, orgId, provider }) {
  const emailLower = email.toLowerCase().trim();
  const existing = await query(`SELECT id FROM users WHERE email = $1`, [emailLower]);
  let userId;

  if (existing.rows[0]) {
    userId = existing.rows[0].id;
  } else {
    const created = await query(
      `INSERT INTO users (email, email_verified, sso_provider, display_name, created_at)
       VALUES ($1, true, $2, $3, NOW())
       RETURNING id`,
      [emailLower, provider, name || emailLower.split('@')[0]]
    );
    userId = created.rows[0].id;
    logger.info('jit_user_created', { email: emailLower, provider, orgId });
  }

  // Ensure org membership
  await query(
    `INSERT INTO org_members (org_id, user_id, role)
     VALUES ($1, $2, 'member')
     ON CONFLICT (org_id, user_id) DO NOTHING`,
    [orgId, userId]
  );

  return { id: userId, email: emailLower, name };
}

// ── Token exchange ─────────────────────────────────────────────────────────────
async function exchangeCode({ code, config, ssoConfig }) {
  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    client_id:     ssoConfig.clientId,
    client_secret: ssoConfig.clientSecret,
    redirect_uri:  config.redirectUri,
    code,
  });

  const tokenRes = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Accept':        'application/json',
    },
    body: body.toString(),
  });

  const tokenData = await tokenRes.json();
  if (tokenData.error) throw new Error(`Token exchange failed: ${tokenData.error_description || tokenData.error}`);
  return tokenData;
}

// ── Fetch user profile from provider ──────────────────────────────────────────
async function fetchUserInfo({ accessToken, config, provider }) {
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };

  // GitHub needs email fetched separately if not public
  if (provider === 'github') {
    const [profileRes, emailsRes] = await Promise.all([
      fetch(config.userinfoUrl, { headers }),
      fetch(`${config.userinfoUrl.replace('/user', '/user/emails')}`, { headers }),
    ]);
    const profile = await profileRes.json();
    const emails  = await emailsRes.json().catch(() => []);
    const primary = Array.isArray(emails) ? emails.find(e => e.primary && e.verified)?.email : null;
    return { email: primary || profile.email, name: profile.name || profile.login };
  }

  const res = await fetch(config.userinfoUrl, { headers });
  const data = await res.json();

  // Microsoft Graph uses different field names
  if (provider === 'microsoft') {
    return { email: data.mail || data.userPrincipalName, name: data.displayName };
  }

  return { email: data.email, name: data.name };
}

// ── Handler ────────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const appUrl = process.env.APP_URL || 'https://localhost';

  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });

  const params = event.queryStringParameters || {};

  // ── Initiate: redirect to provider ──────────────────────────────────────────
  if (params.orgId && !params.code) {
    const { orgId } = params;
    try {
      const { config: ssoConfig } = await getOrgOidcConfig(orgId);
      const pConfig = providerConfig(ssoConfig);

      const state = crypto.randomBytes(16).toString('hex');
      const nonce = crypto.randomBytes(16).toString('hex');

      // State encodes orgId + CSRF token — store in a short-lived entry
      const statePayload = Buffer.from(JSON.stringify({ orgId, state, nonce, ts: Date.now() })).toString('base64url');

      const authParams = new URLSearchParams({
        response_type: 'code',
        client_id:     ssoConfig.clientId,
        redirect_uri:  pConfig.redirectUri,
        scope:         pConfig.scope,
        state:         statePayload,
        nonce,
        ...pConfig.extraParams,
      });

      return {
        statusCode: 302,
        headers: { Location: `${pConfig.authUrl}?${authParams}` },
        body: '',
      };
    } catch (err) {
      logger.error('oidc_initiate_failed', { error: err.message, orgId });
      return { statusCode: 302, headers: { Location: `${appUrl}/index.html?sso_error=${encodeURIComponent(err.message)}` }, body: '' };
    }
  }

  // ── Callback: handle provider redirect ──────────────────────────────────────
  if (params.code) {
    try {
      const { code, state: statePayload } = params;

      if (!statePayload) throw new Error('Missing state parameter');
      const stateData = JSON.parse(Buffer.from(statePayload, 'base64url').toString());

      // Verify state is not older than 10 minutes
      if (Date.now() - stateData.ts > 10 * 60 * 1000) throw new Error('SSO state expired — please try again');

      const { orgId } = stateData;
      const { config: ssoConfig } = await getOrgOidcConfig(orgId);
      const pConfig = providerConfig(ssoConfig);

      // Exchange code for tokens
      const tokenData = await exchangeCode({ code, config: pConfig, ssoConfig });
      const accessToken = tokenData.access_token;

      // Fetch user profile
      const { email, name } = await fetchUserInfo({
        accessToken,
        config: pConfig,
        provider: ssoConfig.provider,
      });

      if (!email) throw new Error('Provider did not return an email address');

      // Enforce domain restriction if configured
      if (ssoConfig.domain) {
        const domain = email.split('@')[1];
        if (domain !== ssoConfig.domain) {
          throw new Error(`Email domain @${domain} is not allowed for this org`);
        }
      }

      // JIT provision
      const user = await jitProvision({ email, name, orgId, provider: ssoConfig.provider });

      // Issue JWT
      const jwtToken = signToken({ sub: user.id, email: user.email });

      // Audit log
      query(
        `INSERT INTO audit_events (actor_id, event_type, resource_type, resource_id, metadata)
         VALUES ($1, 'sso.login', 'user', $1, $2)`,
        [user.id, JSON.stringify({ provider: ssoConfig.provider, orgId })]
      ).catch(() => {});

      return {
        statusCode: 302,
        headers: { Location: `${appUrl}/ide.html#sso_token=${jwtToken}` },
        body: '',
      };
    } catch (err) {
      logger.error('oidc_callback_failed', { error: err.message });
      return {
        statusCode: 302,
        headers: { Location: `${appUrl}/index.html?sso_error=${encodeURIComponent(err.message)}` },
        body: '',
      };
    }
  }

  return json(400, { ok: false, error: 'Missing orgId or code parameter' });
};
