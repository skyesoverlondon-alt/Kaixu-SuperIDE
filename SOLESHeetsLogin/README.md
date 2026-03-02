# SoleSheets Login (Hardened)

A portable Netlify Functions + static UI login module wired to Neon Postgres with HS256 JWT sessions.

## What’s included
- UI: `index.html` + `protected.html` (calls `/.netlify/functions/me`).
- Functions: `login`, `signup`, `me`, `logout`, shared `_helpers`.
- Storage: Neon Postgres table `auth_users` (auto-created on first run).
- Sessions: HS256 JWT (7d) in HttpOnly+Secure `kxp_session` (configurable name via `AUTH_COOKIE_NAME`).

## Endpoints
- POST `/.netlify/functions/signup` — body `{ email, password }`. Bcrypt hash stored in `auth_users`. `ADMIN_EMAILS` marks role=admin.
- POST `/.netlify/functions/login` — body `{ email, password }`. Verifies hash, issues session cookie.
- GET `/.netlify/functions/me` — returns `{ ok, user, exp }` if session valid.
- POST `/.netlify/functions/logout` — clears session cookie.

## Environment variables
- `NEON_DATABASE_URL` (required) — connection string to Neon.
- `CUSTOMER_JWT_SECRET` (preferred) or `AUTH_SECRET` or `KAIXU_SERVICE_SECRET` (required) — HS256 signing secret (>=24 chars).
- `ADMIN_EMAILS` (optional) — comma-separated admin emails.
- `AUTH_COOKIE_NAME` (optional) — defaults to `kxp_session`.

## Setup
1) Install deps in this folder: `npm install` (needs `@neondatabase/serverless`, `jose`, `bcryptjs`, `cookie`, `nanoid`).
2) Ensure `NEON_DATABASE_URL` and the JWT secret are set in Netlify env vars.
3) Deploy/serve. The first auth call creates `auth_users` with indexes automatically.
4) Open `index.html`, sign up, then log in; `protected.html` should show the session payload.

## Notes
- Password policy: min length 10 (enforced in signup).
- Session cookie: HttpOnly, Secure, SameSite=Strict, Max-Age 7d.
- Last login timestamp is recorded best-effort.
- No rate limiting / lockouts are in this module; add behind Netlify Edge/Function middleware if needed.
