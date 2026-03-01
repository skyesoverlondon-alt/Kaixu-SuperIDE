\
# Kaixu Gateway v5.x — manual deploy with Netlify CLI (no Git) [PowerShell]
# Installs deps, builds Functions locally, then deploys to production.

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

function Require-Cmd($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "ERROR: '$name' is not installed or not on PATH."
  }
}

Require-Cmd node
Require-Cmd npm

Write-Host "==> Installing dependencies"
npm install

Write-Host "==> Building Netlify Functions locally"
# Output goes to .netlify/functions
npx netlify functions:build

Write-Host "==> Deploying to Netlify (production)"
# If you haven't linked the folder to a Netlify site yet, run:
#   npx netlify login
#   npx netlify init   (or: npx netlify link)
# Then rerun this script.
npx netlify deploy --prod --dir . --functions .netlify/functions --no-build

Write-Host "==> Done."
