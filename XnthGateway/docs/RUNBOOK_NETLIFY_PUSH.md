# KaixuPush (Netlify Deploy Proxy) — Runbook (V6)

KaixuPush deploys a file set to a Netlify Site using digest deploys.
- Init deploy with path→sha1 map
- Upload required digests (direct or chunked)
- Background upload for large files
- Async deploy completion worker
- Scheduled cleanup + retry engine

## Endpoints (Kaixu Key required)
- POST push-init
- PUT  push-upload
- PUT  push-upload-chunk
- POST push-upload-complete
- GET  push-file-status
- POST push-complete (async default)
- GET  push-status

## Scheduled Jobs
- push-job-retry: every 5 minutes
- push-chunk-cleanup: daily

## Environment Variables (reliable production)
- JOB_WORKER_SECRET (required)
- PUSH_NETLIFY_MAX_DEPLOYS_PER_MIN / DAY (rate pacing)
- PUSH_JOB_MAX_ATTEMPTS, PUSH_JOB_RETRY_BASE_MS, PUSH_JOB_RETRY_MAX_MS
- PUSH_CHUNK_RETENTION_HOURS

