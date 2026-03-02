# kAIxU SuperIDE

Enterprise-grade browser IDE built on Netlify Functions + Neon PostgreSQL + kAIxU AI Gateway.

---

## What it is

A fully cloud-backed coding environment deployable in minutes. No servers to manage — Netlify hosts the functions, Neon hosts the database, kAIxU Gateway handles all AI inference.

**Core features:**
- Full browser IDE (CodeMirror) with syntax highlighting for all major languages
- Cloud workspace sync — edit on any device, changes persist instantly
- AI code editing via kAIxU Gateway — no provider API keys ever touch the browser
- Chat timeline with apply/undo for AI-generated file edits
- File explorer, outline view, search, problems panel, snippets
- Live preview with detachable preview window
- File upload + zip import/export
- Local commit history, diff view, revert, patch export

**Enterprise features:**
- Multi-tenant orgs with role-based access control (Owner / Admin / Member / Viewer)
- SAML 2.0 + OIDC SSO with JIT provisioning (Okta, Azure AD, Google Workspace)
- Stripe billing with plan enforcement and quota tracking
- Semantic code search (pgvector embeddings)
- Rate limiting on all AI and write endpoints
- Sentry error tracking
- Read replica routing for DB scalability
- Full legal pack: Privacy, Terms, DPA, Security Policy, Subprocessors, SLA

---

## Deploy in 5 steps

### 1. Fork + connect to Netlify

1. Fork or push this repo to GitHub
2. Netlify → Add new site → Import from Git → select the repo
3. Build command: leave blank
4. Publish directory: `.`
5. Deploy

### 2. Set up Neon

1. Create a project at https://console.neon.tech
2. Copy the connection string (starts with `postgres://`)
3. In the Neon SQL Editor, run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

4. Then run the schema:

```bash
node scripts/migrate.js
```

Or paste `sql/schema.sql` directly into the Neon SQL Editor.

### 3. Set up Stripe

See `DEV NOTES/Deploy Notes` for the full walkthrough. Short version:

1. Create 3 products in Stripe (Pro $19/mo, Team $79/mo, Enterprise custom)
2. Add a webhook endpoint pointing to `/.netlify/functions/stripe-webhook`
3. Copy the price IDs and insert the plans into Neon (SQL in Deploy Notes)
4. Copy your Stripe secret key and webhook signing secret for env vars (step 4)

### 4. Set Netlify environment variables

Netlify → Site settings → Environment variables:

**Required:**

| Variable                | Value                                           |
|-------------------------|-------------------------------------------------|
| `DATABASE_URL`          | Neon connection string                          |
| `JWT_SECRET`            | Random 64-char string (`openssl rand -hex 32`)  |
| `KAIXU_GATE_TOKEN`      | Your kAIxU gateway token                        |
| `SENDGRID_API_KEY`      | SendGrid API key (for emails)                   |
| `SMTP_FROM_EMAIL`       | e.g. `hello@kaixu.app`                         |
| `APP_URL`               | Your Netlify site URL                           |
| `STRIPE_SECRET_KEY`     | `sk_live_...` or `sk_test_...`                  |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` from Stripe webhook                 |

**Optional:**

| Variable               | Default / Notes                                          |
|------------------------|----------------------------------------------------------|
| `KAIXU_GATE_BASE`      | `https://kaixu67.skyesoverlondon.workers.dev`            |
| `KAIXU_DEFAULT_MODEL`  | `kAIxU-flash` (or `kAIxU-pro`)                          |
| `DATABASE_REPLICA_URL` | Neon read replica — falls back to primary if unset       |
| `GITHUB_CLIENT_ID`     | GitHub OAuth App (for GitHub integration)                |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App                                         |
| `SENTRY_DSN`           | Sentry project DSN (error tracking)                      |
| `SAML_CERT`            | IdP certificate (enterprise SAML SSO)                    |
| `SAML_PRIVATE_KEY`     | SP private key (enterprise SAML SSO)                     |

### 5. Validate + go live

Run the pre-flight checker before going live:

```bash
npm run setup:check        # checks env vars + model compliance
npm run setup:check:all    # + live DB connection, gateway ping, Stripe format
```

Then hit the health endpoint to confirm everything is connected:

```
GET https://YOUR-SITE.netlify.app/.netlify/functions/health
→ { "ok": true, "db": "ok", "gate": "ok" }
```

---

## Local development

```bash
npm install
npx netlify dev
```

All Netlify Functions run locally with `netlify dev`. Auth, DB, and AI proxy all work the same as production. Set your env vars in a `.env` file at the repo root (same variable names as above).

---

## Running tests

```bash
npm test                  # run all 46 tests
npm run test:coverage     # with coverage report
npm run test:watch        # watch mode
```

Tests cover: auth flows, billing quota enforcement, RBAC, tenant isolation, AI editing, embeddings.

CI runs automatically on every push and pull request via GitHub Actions (`.github/workflows/ci.yml`).

---

## Plan tiers

| Feature             | Free   | Pro     | Team    | Enterprise |
|---------------------|--------|---------|---------|------------|
| AI calls / month    | 100    | 2,000   | 10,000  | Unlimited  |
| Workspaces          | 3      | 20      | 100     | Unlimited  |
| Members per org     | 1      | 5       | 25      | Unlimited  |
| Storage             | 1 GB   | 10 GB   | 50 GB   | 500 GB     |
| SSO (SAML / OIDC)  | x      | x       | yes     | yes        |
| Priority support    | x      | x       | yes     | yes + SLA  |
| Price               | Free   | $19/mo  | $79/mo  | Custom     |

---

## AI models

All inference routes through the kAIxU Gateway. No underlying provider names are exposed to clients.

| Model       | Speed  | Context | Best for                               |
|-------------|--------|---------|----------------------------------------|
| kAIxU-flash | Fast   | 128k    | Code edits, autocomplete, quick tasks  |
| kAIxU-pro   | Slower | 1M      | Complex reasoning, large file analysis |

---

## Architecture

```
Browser (IDE)
    |
    +-- Static assets (Netlify CDN)
    |
    +-- Netlify Functions (Node.js 20)
            |
            +-- _lib/auth.js      -- JWT verification
            +-- _lib/db.js        -- Neon pool + read replica routing
            +-- _lib/ratelimit.js -- per-user/org rate limiting
            +-- _lib/logger.js    -- structured logging + Sentry
            |
            +-- auth-*            -- signup, login, MFA, password reset, sessions
            +-- ws-*              -- workspace CRUD + cloud sync
            +-- org-*             -- org management + invitations
            +-- ai-edit.js        -- proxies to kAIxU Gateway (quota enforced)
            +-- embeddings.js     -- pgvector semantic search
            +-- billing-*         -- Stripe subscription management
            +-- stripe-webhook.js -- Stripe event handling
            +-- sso-saml.js       -- SAML 2.0 IdP flow
            +-- sso-oidc.js       -- OIDC callback handler
            +-- health.js         -- uptime check endpoint
                    |
                    +-- Neon PostgreSQL (8 tables + pgvector)
                    +-- kAIxU Gateway (AI inference)
```

---

## Security

- All AI and write endpoints are rate-limited
- JWT Bearer auth on all 49 protected endpoints
- HSTS (2-year), CSP, Cross-Origin headers set via `netlify.toml`
- All DB queries parameterized (no SQL injection surface)
- 0 npm audit vulnerabilities
- Stripe webhook signature verification (no JWT needed on webhook route)

Full security policy: /security

Enterprise evidence bundle:

- `docs/enterprise/README.md`
- `docs/enterprise/SECURITY-GOVERNANCE.md`
- `docs/enterprise/INCIDENT-RESPONSE-RUNBOOK.md`
- `docs/enterprise/DISASTER-RECOVERY-BCP.md`
- `docs/enterprise/VULNERABILITY-MANAGEMENT.md`
- `docs/enterprise/ACCESS-REVIEW.md`
- `docs/enterprise/THIRD-PARTY-RISK.md`
- `docs/enterprise/COMPLIANCE-ROADMAP.md`
- `docs/enterprise/REPO-GOVERNANCE-CHECKLIST.md`
- `SECURITY.md`

Repository governance artifacts:

- `.github/CODEOWNERS`
- `.github/pull_request_template.md`

---

## Legal

- Privacy Policy: /privacy
- Terms of Service: /terms
- Data Processing Agreement: /dpa
- Security Policy: /security
- Subprocessors: /subprocessors
- SLA: /sla

Contact: legal@kaixu.app | privacy@kaixu.app | security@kaixu.app

---

## File structure

```
index.html              -- Landing page
ide.html                -- IDE shell (loads all frontend modules)
homelanding.html        -- Marketing landing page
styles.css              -- Global styles
manifest.json           -- PWA manifest
sw.js                   -- Service worker (offline support)

-- Frontend modules (load order: db -> ui -> editor -> explorer -> search ->
--   outline -> problems -> snippets -> templates -> commands -> app)
db.js                   -- IndexedDB (local file storage)
ui.js                   -- UI utilities (toast, modals, helpers)
editor.js               -- CodeMirror multi-tab editor + split panes
explorer.js             -- File tree
search.js               -- Workspace search panel
outline.js              -- Code outline/symbol view
problems.js             -- Problems panel (lint errors)
snippets.js             -- Snippet library
templates.js            -- File templates
commands.js             -- Command palette
app.js                  -- App bootstrap, auth, AI chat, sync engine

-- Feature modules (load after app.js)
diff.js                 -- Visual diff viewer (commit history)
scm.js                  -- Source control: branches, stash, blame, hunk revert
collab.js               -- Real-time presence + cursor overlays
demo.js                 -- Demo project loader
github.js               -- GitHub OAuth integration
admin.js                -- Admin console: org panel, usage, kill switch
search.worker.js        -- Background web worker for search indexing
jszip.min.js            -- ZIP import/export library

netlify/functions/      -- All backend functions
  _lib/                 -- Shared utilities (auth, db, logger, ratelimit, email)

scripts/
  migrate.js            -- Run SQL schema against Neon
  setup-check.js        -- Pre-flight env validator
  aria_pass.py          -- One-time accessibility patch for ARIA attributes

sql/schema.sql          -- Full database schema (run this first)
sql/rls.sql             -- Row-level security policies (optional, run after schema)
tests/                  -- Jest test suites (46 tests)
.github/workflows/      -- CI pipeline (GitHub Actions)

privacy.html            -- Privacy policy
terms.html              -- Terms of service
dpa.html                -- Data processing agreement
security.html           -- Security policy
subprocessors.html      -- Subprocessor list
sla.html                -- Service level agreement
```

---

Built by Skyes Over London LC
