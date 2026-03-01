#!/usr/bin/env bash
set -euo pipefail

# Kaixu Gateway v5.x — manual deploy with Netlify CLI (no Git)
# This script installs deps, builds Functions locally, then deploys to production.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is not installed. Install Node.js (LTS) first." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is not installed. Install Node.js (LTS) first." >&2
  exit 1
fi

echo "==> Installing dependencies"
npm install

echo "==> Building Netlify Functions locally"
# Output goes to .netlify/functions
npx netlify functions:build

echo "==> Deploying to Netlify (production)"
# If you haven't linked the folder to a Netlify site yet, run:
#   npx netlify login
#   npx netlify init   (or: npx netlify link)
# Then rerun this script.
npx netlify deploy --prod --dir . --functions .netlify/functions --no-build

echo "==> Done."
