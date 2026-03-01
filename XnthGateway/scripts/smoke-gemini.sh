#!/usr/bin/env bash
set -euo pipefail

# Gemini-only smoke test for kAIxUGateway13.
# - Starts `netlify dev` with explicit dirs so the correct functions are served.
# - Forces GEMINI_API_KEY_LOCAL (preferred by providers.js) to avoid env overrides.
# - Runs the built-in E2E test pinned to provider=gemini.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "Missing .env in $ROOT_DIR" >&2
  exit 1
fi

# Load env for netlify dev (auth token, DB URL, etc.)
set -a
# shellcheck disable=SC1091
source .env
set +a

if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  echo "Missing ADMIN_PASSWORD in .env" >&2
  exit 1
fi
if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "Missing GEMINI_API_KEY in .env" >&2
  exit 1
fi

# Ensure the gateway uses this key even if netlify injects a different GEMINI_API_KEY.
export GEMINI_API_KEY_LOCAL="$GEMINI_API_KEY"

port_free() {
  local p="$1"
  if command -v lsof >/dev/null 2>&1; then
    ! lsof -i ":$p" >/dev/null 2>&1
  else
    ! (ss -lnt 2>/dev/null | grep -q ":$p ")
  fi
}

PORT="${PORT:-}"
if [[ -z "$PORT" ]]; then
  for p in $(seq 8890 8900); do
    if port_free "$p"; then
      PORT="$p"
      break
    fi
  done
fi

if [[ -z "${PORT:-}" ]]; then
  echo "Could not find a free port in 8890-8900. Set PORT=... manually." >&2
  exit 1
fi

ORIGIN="http://localhost:${PORT}"

LOG="$(mktemp -t kaixu-netlify-dev.XXXXXX.log)"
cleanup() {
  # Netlify CLI may spawn a child node process that can outlive the parent.
  # Most reliable cleanup is killing whatever is listening on the chosen port.
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti ":${PORT}" 2>/dev/null | xargs -r kill >/dev/null 2>&1 || true
  fi

  if [[ -n "${NETLIFY_DEV_PID:-}" ]] && kill -0 "$NETLIFY_DEV_PID" >/dev/null 2>&1; then
    kill "$NETLIFY_DEV_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$LOG" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Starting netlify dev on $ORIGIN (logs: $LOG)"
# Explicitly serve *this* gateway's functions.
npx netlify dev -d . -f netlify/functions --no-open -p "$PORT" >"$LOG" 2>&1 &
NETLIFY_DEV_PID=$!

# Wait for health endpoint to respond.
for _ in $(seq 1 30); do
  if curl -sf "${ORIGIN}/.netlify/functions/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -sf "${ORIGIN}/.netlify/functions/health" >/dev/null 2>&1; then
  echo "Gateway did not become ready on $ORIGIN" >&2
  echo "--- netlify dev log (tail) ---" >&2
  tail -n 80 "$LOG" >&2 || true
  exit 1
fi

echo "Running E2E (provider=gemini)"
KAIXU_ORIGIN="$ORIGIN" E2E_PROVIDER=gemini node --env-file=.env scripts/e2e-local.mjs

echo "Gemini smoke test: OK"