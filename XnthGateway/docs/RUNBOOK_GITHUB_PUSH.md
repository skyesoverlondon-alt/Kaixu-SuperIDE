# Kaixu GitHub Push Gateway — Runbook (V6)

This module turns the Kaixu Gateway suite into a GitHub “push gateway”:
- Stage a ZIP (chunked) into Netlify Blobs
- Background worker assembles ZIP and pushes it as a single commit using the Git database API
- Scheduled retry runner requeues transient failures

## Key Endpoints (client-side, Kaixu Key required)
- POST /.netlify/functions/gh-push-init
- PUT  /.netlify/functions/gh-push-upload-chunk?jobId=...&part=...&parts=...
- POST /.netlify/functions/gh-push-upload-complete
- GET  /.netlify/functions/gh-push-status?jobId=...

## Token Configuration
Recommended:
- GitHub OAuth App via:
  - POST /.netlify/functions/github-oauth-start
  - GET  /.netlify/functions/github-oauth-callback

Alternative:
- Store PAT per customer (encrypted) using admin endpoint:
  - POST /.netlify/functions/admin-github-token

## Scheduled Jobs
- gh-job-retry: every 5 minutes
- gh-chunk-cleanup: daily

## Environment Variables (minimum for reliable ops)
- JOB_WORKER_SECRET (required; workers fail-closed without it)
- DB_ENCRYPTION_KEY (recommended; encrypt tokens)
- GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / GITHUB_OAUTH_REDIRECT_URL (if using OAuth)
- GITHUB_CHUNK_RETENTION_HOURS (default 48)

## Failure Modes & What To Do
- status=retry_wait: transient error; scheduler will retry automatically.
- status=expired: job abandoned past retention; re-init and re-upload.
- status=failed: non-transient (bad zip, auth, repo perms); fix root cause and re-run.

