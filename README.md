# kAIxU Super IDE (Neon + Netlify Functions + kAIxU Gate)

This repo is a Git-deployable Netlify app that provides:

- Browser IDE backed by IndexedDB (fast local edits)
- Optional cloud sync + multi-device login via Neon Postgres
- Built-in Chat Timeline that can apply/undo file edits
- AI edits routed ONLY through kAIxU Gate (no provider keys in client)
- Upload/import: files + zips
- Preview: live preview with unsaved changes (and detachable preview)
- Basic source-control: local commits, diff safety, revert, patch export
- Built-in tutorial modal

## Git deployment required

Because this build uses Netlify Functions for auth, Neon DB access, and secure AI proxying.

Lord kAIxu, this must be deployed via Git or it will not be useful to you.

## 1) Neon setup

1. Create a Neon database.
2. Copy your connection string (Postgres URL).
3. Run the schema in `sql/schema.sql`.

## 2) Netlify environment variables

Set these in Netlify → Site settings → Environment variables:

- `NEON_DATABASE_URL` — Neon Postgres connection string
- `JWT_SECRET` — long random secret (32+ chars)

Gate (no provider keys here):
- `KAIXU_GATE_BASE` — default: `https://kaixu67.skyesoverlondon.workers.dev`
- `KAIXU_GATE_TOKEN` — your app token for the gate
- `KAIXU_DEFAULT_MODEL` — default: `gemini-2.5-flash`

Optional:
- `KAIXU_GLOBAL_SYSTEM` — if you want an additional system layer at the gate

## 3) Deploy

1. Push this repo to GitHub.
2. Netlify → Add new site → Import from Git.
3. Build command: leave blank
4. Publish directory: `.`

## 4) Signup flow (Netlify Forms + Neon)

- The UI submits a Netlify Form called `signup` (lead capture / audit).
- It also calls `/api/auth-signup` to actually create the user in Neon.

## 5) Local dev

You can run the static UI locally, but auth + AI proxy require functions.

Recommended local dev:

```bash
npm install
npx netlify dev
```

Security note:
This build keeps the Gate token server-side (Netlify Functions). The browser never sees provider keys or the gate token.
