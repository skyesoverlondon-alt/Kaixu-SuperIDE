# Kaixu Gateway Site v5 (Netlify DB + Universal Caps + Devices + Exports + Stripe Top-ups)

This build keeps ops tiny (Netlify DB + Netlify Functions) while adding the missing “real-world” controls: **universal caps**, **device seats**, **allowlists**, **exports**, **invoice snapshots**, and **Stripe top-ups**.

## What’s in
1) **Gateway**: multi-provider proxy with **SSE streaming** + non-streaming JSON
2) **Auth**: customers + sub-keys (many keys per customer)
3) **Universal caps**: 
   - customer monthly cap
   - key override cap
   - optional “top-up” extra cap per month
4) **Rate limiting**:
   - Netlify DB counters (default)
   - **Upstash sliding-window limiter** (optional, recommended)
5) **Devices / Seats**:
   - optional `x-kaixu-install-id` binding
   - key-level max seats (override) and customer-level max seats (default)
   - revoke/unrevoke devices
6) **Allowlists**:
   - provider allowlist (customer or key override)
   - model allowlist (customer or key override)
7) **Usage metering + logs** (Netlify DB)
8) **Exports** (CSV): events, monthly summary, invoice export
9) **Invoice snapshots**: compute + store per month (admin) and view (user)
10) **Stripe top-ups** (optional): Checkout + webhook credits `extra_cents`
11) **Dashboards**:
   - Admin console (`/index.html`)
   - User console (`/dashboard.html`)

## Netlify DB native ✅
- Uses Netlify DB (Neon Postgres) via `@netlify/neon`.
- No `DATABASE_URL` needed; Netlify injects `NETLIFY_DATABASE_URL` when DB is attached.

## Pricing (P0 / production blocker)
Billing + caps depend on `pricing/pricing.json`.

This build ships with pricing entries for:
- OpenAI: `gpt-4o`, `gpt-4o-mini`
- Anthropic: `claude-3-5-sonnet-20241022`, `claude-opus-4-6`
- Gemini: `gemini-2.5-flash`

All rates are **provider list price + 31%** (your markup).

Important behavior:
- If a request uses a (provider, model) pair **not present** in `pricing.json`, the gateway returns **409 UNPRICED_MODEL** (no “$0” bypass).
- Make sure your customer/key model allowlists only include models that exist in `pricing.json`.

## KaixuPush enterprise boundary (Netlify tokens)
By default, KaixuPush can use a single site-wide `NETLIFY_AUTH_TOKEN`. That’s convenient, but not multi-tenant safe.

This build supports **per-customer Netlify tokens**, stored encrypted in Netlify DB:

- Set/clear from Admin UI (Customers tab), or call:
  - `POST /.netlify/functions/admin-netlify-token` with `{ customer_id, token }`
  - `DELETE /.netlify/functions/admin-netlify-token` with `{ customer_id }`

KaixuPush will:
1) Use the customer’s encrypted token if present.
2) Otherwise fall back to `NETLIFY_AUTH_TOKEN` (back-compat).


## Deploy checklist
### 0) Choose your deploy path (important)
This project includes **Netlify Functions with NPM dependencies** (Neon DB, Blobs, optional Stripe/Upstash). That means the Functions must be **bundled** as part of deployment.

Supported paths:

**Recommended (production): Git-connected deploy**
- Push this folder to a GitHub repo and connect it to Netlify.
- Netlify will run the build/bundle step for Functions during deploy.

**Manual (no Git): Netlify CLI deploy**
- Run the included script:
  - macOS/Linux: `bash scripts/deploy.sh`
  - Windows: `powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1`
- The script runs:
  - `npm install`
  - `npx netlify functions:build`
  - `npx netlify deploy --prod`

**Drag/drop (Netlify Drop): static-only unless you prebundle Functions**
- Drag/drop deployments do not run a dependency install or Functions build step.
- You can still drop this site, but **only the static dashboards will work** unless you prebundle the Functions artifacts.

Why: Netlify’s manual deploy workflow does not automatically install dependencies and bundle Functions unless you deploy via Git or the Netlify CLI (or you ship prebuilt Function bundles).

References:
- https://docs.netlify.com/deploy/create-deploys/ (manual deploys don’t run a build command)
- https://docs.netlify.com/build/functions/deploy/ (deploying Functions via Git/CLI)



### A) Add Netlify DB (Neon)
- Netlify UI: **Extensions → Neon database → Install → Add database**

### B) Database schema (auto-provisioned)
You **do not** need to run any manual SQL to get started.

On first real request, `netlify/functions/_lib/db.js` automatically creates/patches the required tables & columns (customers, keys, usage, invoices, devices, push tables, monitor tables, async jobs, etc.).

- The `/sql` folder is kept as **reference / legacy migration notes** only.
- In a later “ops-hardened” deployment, you can move schema management to explicit migrations and disable request-path DDL, for strict ops discipline, but this repo currently prioritizes rapid setup over cold-start optimization.

### C) Netlify env vars
Required:
- `JWT_SECRET`
- `ADMIN_PASSWORD`

Optional hardening:
- `DISABLE_ADMIN_PASSWORD_HEADER=true` to disable legacy `x-admin-password` header auth and require admin JWTs only.

Providers (set any you want to sell):
- `OPENAI_API_KEY` (optional)
- `ANTHROPIC_API_KEY` (optional)
- `GEMINI_API_KEY` (optional)

CORS:
- `ALLOWED_ORIGINS` = comma-separated list (e.g. https://yourapp.com,https://admin.yourapp.com)
- **Production:** you MUST set this explicitly.
- `ALLOWED_ORIGINS=*` enables allow-all (dev only).
- If `ALLOWED_ORIGINS` is unset/blank and a browser `Origin` header is present, the gateway does **not** grant CORS (strict-by-default).

Rate limits:
- `DEFAULT_RPM_LIMIT` (example: 120)

Optional (stronger RPM limiting with Upstash):
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Optional (Stripe top-ups):
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_CURRENCY` (default `usd`)
- `STRIPE_SUCCESS_URL` and `STRIPE_CANCEL_URL` (or set `PUBLIC_APP_ORIGIN`)
- `PUBLIC_APP_ORIGIN` (e.g. https://your-site.netlify.app)

## Endpoints

Admin:
- `/.netlify/functions/admin-login`
- `/.netlify/functions/admin-customers` (GET list, POST create, PATCH update)
- `/.netlify/functions/admin-keys` (GET list, POST create, PATCH update/revoke toggle, PUT rotate)
- `/.netlify/functions/admin-usage`
- `/.netlify/functions/admin-devices`
- `/.netlify/functions/admin-export`
- `/.netlify/functions/admin-invoices`
- `/.netlify/functions/admin-topup`
- `/.netlify/functions/stripe-create-checkout` (admin)
- `/.netlify/functions/stripe-webhook`

Gateway:
- `/.netlify/functions/gateway-stream` (SSE)
- `/.netlify/functions/gateway-chat` (JSON)

User dashboard:
- `/dashboard.html`
- `/.netlify/functions/user-summary`
- `/.netlify/functions/user-events`
- `/.netlify/functions/user-devices`
- `/.netlify/functions/user-export`
- `/.netlify/functions/user-invoices`
- `/.netlify/functions/user-topup-checkout`

## Local dev
1) Install deps: `npm i`
2) Start: `netlify dev`

Netlify DB requires Node 20.12.2+. This repo includes `.node-version` and sets Node in `netlify.toml`.

## kAIxu canon enforcement (server-side)

This build **forces** the kAIxu origin + governance canon on every request.
- The gateway prepends a **system** instruction block (the “kAIxu CANON”) to every request **before** calling any provider.
- Any client-provided system/developer prompts are kept, but appended *after* the canon (so they cannot erase it).
- Health endpoint exposes a hash so you can verify what is enforced.

Check: `/.netlify/functions/health` → `build.kaixu_system_hash`
Build: `deploy-kaixuCanon-20260221102017`


## Async Jobs (Background + Polling) — for long DEV outputs

Netlify serverless streaming can still hit timeouts when "time to first token" is slow or responses are huge.  
This repo now supports **Background Job + Polling** (15-minute worker limit on Netlify Background Functions).

### 1) Submit a job
`POST /.netlify/functions/gateway-job-submit`

Headers:
- `Authorization: Bearer <virtual_key>`
- `Content-Type: application/json`

Body (same as gateway-chat):
```json
{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "messages": [{"role":"user","content":"Write a long response..."}],
  "max_tokens": 8192,
  "temperature": 0.7
}
```

Response (202):
- `job_id`
- `status_url`
- `result_url`

### 2) Poll status
`GET status_url`  
Optional: `&kick=1` will re-trigger the worker if the job is still queued/running.

### 3) Fetch final result
`GET result_url`  
- returns 200 when complete
- returns 202 if still running
- returns 500 if failed

### Security note (recommended)
Set `JOB_WORKER_SECRET` in Netlify env vars. The enqueue function will pass it to the background worker using `x-kaixu-job-secret`.

## Gateway Base Switch (no rebuild)

The Admin + User dashboards now include a **Gateway Base** switch (top right). This lets you point the UI at:

- the **Netlify-hosted gateway** (default)
- your **Dedicated gateway (VPS / Docker / container)**

How it works:
- If **Gateway Base** is blank, the dashboard calls the **same site** you loaded the page from.
- If you set it to a full URL like `https://gateway.yourdomain.com`, all API calls are sent to:
  `https://gateway.yourdomain.com/.netlify/functions/...`

Where it’s stored:
- Browser localStorage key: `KAIXU_API_BASE`
- Per device / per browser profile.

Quick use:
1) Open **Admin** (`/index.html`) or **User Dashboard** (`/dashboard.html`)
2) Click **Gateway Base**
3) Paste your dedicated base (example: `https://gateway.yourdomain.com`)
4) Click **Save**
5) Use “Open Health for this base” to verify you’re hitting the right gateway.

Tip:
- If you run the dedicated gateway on plain HTTP for local testing (ex: `http://localhost:8787`), that works too.


## Monitor (Admin)

The Admin panel now includes a **Monitor** tab that acts like a live event listener for gateway problems.

What it captures:
- Returned HTTP errors (4xx/5xx) from any function
- Thrown errors (uncaught exceptions) with stack traces
- Upstream/provider failures with upstream status + truncated provider body
- Slow responses (>= 15s)

How you debug fast:
1) Every gateway response includes the header `x-kaixu-request-id`.
2) In Admin → Monitor, paste that value into **Search request_id** and hit Search.
3) Click the event row to open the full JSON payload (copy button included).

Strongly recommended (for your apps):
- Send `x-kaixu-app: <app-name>` and `x-kaixu-build: <build-id>` on every request to the gateway.
- Optionally send `x-kaixu-request-id: <uuid>` if your client already generates trace IDs.

Monitor endpoints:
- `GET /.netlify/functions/admin-monitor-events` (polling)
- `GET /.netlify/functions/admin-monitor-stream` (live SSE over fetch)
- `POST /.netlify/functions/admin-monitor-prune` (delete old logs)



## AUTO MODE client pattern (SSE vs Job+Polling)

For IDE-style apps where **sometimes** responses are small (streaming works great) and sometimes they’re huge (serverless streaming can time out), use the built-in client helper:

- File: `assets/kaixu-client.js`
- Global: `window.KaixuClient`

### Quick usage (browser)

1) Load the helper in your app:

```html
<script src="https://YOUR-GATEWAY-SITE.netlify.app/assets/kaixu-client.js"></script>
```

2) Call `KaixuClient.autoChat(...)`:

```js
await KaixuClient.autoChat({
  apiBase: "https://gateway.yourdomain.com", // optional; omit to use same-origin / KAIXU_API_BASE
  apiKey: "<YOUR_KEY>",
  payload: {
    provider: "openai",
    model: "gpt-4.1-mini",
    messages: [{ role:"user", content:"Generate a large multi-file code output..." }],
    max_tokens: 3000
  },
  expectLargeOutput: true,         // optional hint (DEV mode)
  onMeta:  (m)=>console.log(m),    // stream meta OR job submit info
  onDelta: (t)=>appendToUI(t),     // only in stream mode
  onStatus:(s)=>console.log(s),    // only in job mode (poll status)
  onDone:  (d)=>console.log(d)     // stream done OR job result
});
```

AUTO MODE behavior:
- If the request looks “big” (high `max_tokens`, large message size, or `expectLargeOutput: true`), it uses **Background Job + Polling**.
- Otherwise it tries **SSE streaming** first.
- If SSE fails (or no first token arrives fast enough), it **falls back** to Job+Polling automatically.

See `examples/auto-client.js` for a working pattern.

## Client Error Reporter (front-end errors → Admin Monitor)

Endpoint:
- `POST /.netlify/functions/client-error-report`

Headers (recommended):
- `x-kaixu-app: SkyIDE`
- `x-kaixu-build: skyide-2026.02.21`
- Optional security:
  - If you set `CLIENT_ERROR_TOKEN` in env, the client must send `x-kaixu-error-token: <same value>`

Body (minimal):
```json
{
  "client": { "url": "https://app...", "route": "/editor", "feature_flags": { "dev": true } },
  "error": { "name": "TypeError", "message": "x is undefined", "stack": "..." },
  "context": { "anything": "useful" }
}
```

Browser helper:
- `KaixuClient.reportClientError(...)`
- `KaixuClient.installGlobalErrorHooks(...)` (captures `window.onerror` + `unhandledrejection`)

See `examples/client-error-reporter.js`.

### Viewing these in Admin → Monitor
Client errors appear as:
- `kind = client_error`
Use the Monitor filters (Level/Kind/App/Function/Request ID) to isolate the exact failing app and paste the full JSON into your IDE for repairs.


## GitHub Push Gateway (optional add-on)

This build can also act as a **GitHub push gateway**: upload a ZIP (chunked), then the gateway commits the extracted files to a GitHub repo/branch using the GitHub REST Git database APIs (blobs → tree → commit → ref update).

### Configure GitHub access

Option A (recommended): GitHub OAuth App (web flow)
- Set env vars:
  - GITHUB_CLIENT_ID
  - GITHUB_CLIENT_SECRET
  - GITHUB_OAUTH_REDIRECT_URL (must match your OAuth app callback URL)
- Connect:
  - POST /.netlify/functions/github-oauth-start (Bearer Kaixu Key with admin role)
  - Open `authorize_url` in browser, approve
  - Callback stores the token encrypted per-customer

Option B: Fine-grained PAT / classic PAT
- Store per-customer via admin endpoint:
  - POST /.netlify/functions/admin-github-token

Token permissions needed:
- Fine-grained: Repository Contents = write (and Workflows = write if touching .github/workflows)
- Classic: repo scope (and workflow scope if touching workflows)

### GitHub Push (ZIP → commit)

1) Init a job
- POST /.netlify/functions/gh-push-init
  - body: { owner, repo, branch, message }

2) Upload ZIP chunks
- PUT /.netlify/functions/gh-push-upload-chunk?jobId=...&part=0&parts=N  (binary body)
- repeat for part 1..N-1

3) Complete (queue background commit)
- POST /.netlify/functions/gh-push-upload-complete
  - body: { jobId }

4) Poll status
- GET /.netlify/functions/gh-push-status?jobId=...

Background worker requires JOB_WORKER_SECRET (set in env vars).

### Useful endpoints
- GET /.netlify/functions/github-whoami
- GET /.netlify/functions/github-repos
- POST /.netlify/functions/github-create-repo


## V6 Notes
- GitHub Push now uses a dedicated Netlify Blobs store: `kaixu_github_push_chunks`.
- Added scheduled cleanup: `gh-chunk-cleanup` (@daily).
- Admin UI includes a GitHub Push tab for token status, repo list, and job list.
---

## Kaixu Voice Engine (Inbound AI Phone Assistant)

This build adds a **Twilio-compatible inbound call assistant** that runs inside the gateway as Netlify Functions.
It uses a cheap + reliable **TwiML Gather Speech loop** (speech → text → LLM → speech) and is designed to evolve into
realtime streaming later without changing your customer-facing API.

### What you get

- Public webhooks (Twilio → Kaixu):
  - `/.netlify/functions/voice-twilio-inbound` (A Call Comes In)
  - `/.netlify/functions/voice-twilio-turn` (conversation loop)
  - `/.netlify/functions/voice-twilio-status` (status callback; closes calls + rollups)
- Admin provisioning:
  - `/.netlify/functions/admin-voice-numbers` (CRUD voice numbers + playbooks)
  - `/.netlify/functions/admin-voice-usage` (monthly rollups)
- Customer visibility (via their normal gateway virtual keys):
  - `/.netlify/functions/user-voice-summary`
  - `/.netlify/functions/user-voice-calls`

### Database tables added

- `voice_numbers` (maps a phone number to a customer + playbook)
- `voice_calls` (per-call audit + costs)
- `voice_call_messages` (turn-by-turn transcript)
- `voice_usage_monthly` (minutes + estimated cost + billed cost w/ markup)

### Twilio setup (minimal)

1) Buy/attach a phone number in Twilio.
2) In Twilio number settings:
   - Voice → **A CALL COMES IN** → Webhook:
     - `https://YOUR_NETLIFY_SITE/.netlify/functions/voice-twilio-inbound`
   - Status Callback URL (recommended):
     - `https://YOUR_NETLIFY_SITE/.netlify/functions/voice-twilio-status`
     - Status events: initiated, ringing, answered, completed
3) In Netlify env vars, set:
   - `TWILIO_AUTH_TOKEN` (required for signature validation)
   - Optional: `VOICE_FALLBACK_TRANSFER_NUMBER`

### Provision a customer number (Admin)

Call `admin-voice-numbers` (admin-auth required via `x-admin-password`) to create a mapping:

POST `/.netlify/functions/admin-voice-numbers`

```json
{
  "customer_id": 123,
  "phone_number": "+14805551234",
  "provider": "twilio",
  "default_llm_provider": "openai",
  "default_llm_model": "gpt-4.1-mini",
  "locale": "en-US",
  "timezone": "America/Phoenix",
  "playbook": {
    "greeting": "Skyes Over London. How can I help you today?",
    "system_prompt": "You are a SOLEnterprises business assistant. Keep responses concise. Ask one question at a time.",
    "transfer_number": "+14804695416"
  }
}
```

### How billing is calculated

On terminal call status, the gateway:
- Computes minutes = `ceil(duration_seconds / 60)`
- Calculates estimated upstream cost using env defaults:
  - `VOICE_AI_RELAY_USD_PER_MIN` + `VOICE_TELEPHONY_USD_PER_MIN` + `VOICE_RECORDING_USD_PER_MIN`
- Applies markup (`VOICE_MARKUP_PCT`, default 31%)
- Stores per-call costs and monthly rollups in `voice_usage_monthly`

This is designed to match your “gateway pays upstream, customers pay you” model.

### Upgrade path (next)

- Replace Gather-loop with Twilio ConversationRelay or SIP audio streaming
- Add outbound campaigns + scheduled followups
- Add live monitoring via WebSocket (active calls, interruption stats, sentiment)
- Add per-tenant policies (DLP/redaction, restricted actions, approvals)
