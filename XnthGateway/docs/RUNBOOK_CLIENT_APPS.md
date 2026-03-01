# RUNBOOK: Client Apps → KaixuGateway13

This runbook documents how client apps should call KaixuGateway13, what headers to send, and how to handle streaming vs long responses.

## Base URL

- Deployed gateway base: `https://<your-site>.netlify.app`
- Function base: `https://<your-site>.netlify.app/.netlify/functions/...`

The bundled Admin/User dashboards allow overriding the base via:
- `localStorage.KAIXU_API_BASE = "https://<gateway-site>"`

## Auth

All client calls use:

- `Authorization: Bearer <virtual_key>`

A "virtual key" is a Kaixu key issued by the gateway (not an OpenAI/Anthropic key).

Some endpoints also accept short-lived **user session JWTs** minted by the gateway UI (internally these resolve to an `api_key_id`).

## Required / recommended headers

Recommended on **every** request:

- `x-kaixu-app: <app-name>`
- `x-kaixu-build: <build-id>`

Recommended for tracing:

- `x-kaixu-request-id: <uuid>` (optional; gateway will always return `x-kaixu-request-id`)

Device binding (required if enabled for the key/customer):

- `x-kaixu-install-id: <stable-install-id>`

Notes:
- If device binding / seat limits are enabled, missing `x-kaixu-install-id` will fail with HTTP `400`.
- If a device is revoked, calls fail with HTTP `403`.

## CORS (browser apps)

CORS is **strict-by-default**.

- If you are calling the gateway from a different origin (e.g. your app at `https://app.example.com`), set `ALLOWED_ORIGINS` to include that origin.
- If `ALLOWED_ORIGINS` is blank/unset, browser requests that include an `Origin` header will not receive `Access-Control-Allow-Origin`.

## Core AI endpoints

### 1) Non-stream JSON

- `POST /.netlify/functions/gateway-chat`

Body:
```json
{
  "provider": "openai|anthropic|gemini",
  "model": "...",
  "messages": [{"role":"user","content":"..."}],
  "max_tokens": 1024,
  "temperature": 1
}
```

Response `200`:
```json
{
  "provider": "openai",
  "model": "...",
  "output_text": "...",
  "usage": {"input_tokens": 0, "output_tokens": 0, "cost_cents": 0},
  "month": {"month":"YYYY-MM", "customer_cap_cents": 0, "customer_spent_cents": 0, "key_cap_cents": 0, "key_spent_cents": 0},
  "telemetry": {"install_id": "..."}
}
```

### 2) Streaming SSE

- `POST /.netlify/functions/gateway-stream`

Same body as `gateway-chat`.

Response is `text/event-stream` with events:

- `event: meta` → JSON (cap + telemetry)
- `event: delta` → `{ "text": "..." }`
- `event: done` → JSON (final usage + month rollups)
- `event: error` → `{ "error": "..." }`
- `event: ping` → keep-alive

## Long responses (Background Job + Polling)

For very large outputs (or when streaming is unreliable due to serverless timeouts), use job mode.

### Submit

- `POST /.netlify/functions/gateway-job-submit`

Response `202`:
```json
{
  "job_id": "uuid",
  "status_url": ".../gateway-job-status?id=...",
  "result_url": ".../gateway-job-result?id=...",
  "note": "Job accepted..."
}
```

### Poll

- `GET /.netlify/functions/gateway-job-status?id=<job_id>`

Returns `200` with `job.status` of `queued|running|succeeded|failed`.

Optional kick (re-invoke worker):
- `GET /.netlify/functions/gateway-job-status?id=<job_id>&kick=1`

### Fetch result

- `GET /.netlify/functions/gateway-job-result?id=<job_id>`

- `200` when succeeded
- `202` when still queued/running
- `500` when failed

## Use the built-in browser helper (AUTO MODE)

File:
- `assets/kaixu-client.js` (global `window.KaixuClient`)

It automatically chooses:
- SSE streaming for “normal” requests
- Background job + polling for “big” requests
- Falls back from stream → job when streaming fails / first token is too slow

## Common error codes

- `401` Missing/invalid key
- `403` Customer disabled, revoked device, or provider/model not allowed
- `402` Monthly cap reached (customer or key)
- `409` `UNPRICED_MODEL` (provider/model not in `pricing/pricing.json`)
- `429` Rate limit exceeded

## Health check

- `GET /.netlify/functions/health`

Includes build/schema identifiers, provider-key presence flags, and a DB connectivity check.

## Env vars that must exist for a working gateway

Minimum for core AI proxying:
- `NETLIFY_DATABASE_URL` (attached via Netlify DB / Neon)
- `JWT_SECRET`
- `ADMIN_PASSWORD`
- `ALLOWED_ORIGINS` (for browser apps; can be `*` for allow-all)
- At least one provider key: `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` or `GEMINI_API_KEY`

Strongly recommended:
- `KEY_PEPPER` (improves key hash security)
- `DB_ENCRYPTION_KEY` (for encrypted stored tokens)
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (better rate limiting)
- `JOB_WORKER_SECRET` (protects the background worker trigger endpoint)
