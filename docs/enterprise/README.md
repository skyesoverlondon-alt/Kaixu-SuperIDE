# Enterprise Evidence Bundle

This folder contains governance and operational evidence artifacts for enterprise security and procurement reviews.

Company: **Skyes Over London**  
Product: **kAIxU Super IDE**  
Operating Model: **Founder-led, single-person engineering and operations team**

## Included artifacts

- `SECURITY-GOVERNANCE.md` — security ownership model and control framework
- `INCIDENT-RESPONSE-RUNBOOK.md` — incident triage, severity, containment, and comms process
- `DISASTER-RECOVERY-BCP.md` — backup, recovery targets, and business continuity process
- `VULNERABILITY-MANAGEMENT.md` — scanning, remediation SLAs, and exception handling
- `ACCESS-REVIEW.md` — access control standards and periodic review evidence process
- `THIRD-PARTY-RISK.md` — supplier inventory and reassessment cadence
- `COMPLIANCE-ROADMAP.md` — SOC 2 / ISO 27001 preparation milestones
- `dossier/EXECUTIVE-READINESS-BRIEF.md` — boardroom summary for procurement calls
- `dossier/TRUST-SECURITY-POSTURE.md` — trust/security narrative for diligence reviewers
- `dossier/STANDARD-SECURITY-QUESTIONNAIRE.md` — reusable SSQ baseline responses

## How to use this package

1. Keep this folder updated whenever controls, infrastructure, or vendors change.
2. Export runbook drill outcomes and attach evidence links in each artifact’s “Evidence log” section.
3. During enterprise due diligence, provide this folder with legal pages (`/security`, `/privacy`, `/dpa`, `/subprocessors`, `/sla`).

## Review cadence

- Policy review: quarterly
- Evidence refresh: monthly
- Major update trigger: architecture, vendor, auth, billing, or data-flow change

## Automated packet generation

Generate a dated, procurement-ready evidence bundle with checksums:

```bash
npm run evidence:bundle
```

Output location:

- Directory bundle: `artifacts/evidence-bundles/<timestamp>/`
- Manifest: `MANIFEST.json` (includes SHA-256 per artifact)
- Zip bundle (when `zip` is available): `artifacts/evidence-bundles/packet-<timestamp>.zip`

## Smoke download evidence

Run the live smoke download verification and save a dated artifact:

```bash
npm run smoke:downloads
```

Output artifact:

- `artifacts/evidence-bundles/<timestamp>/smoke-download-verification.json`

Public investor smoke access (no signup):

- `/investor-smoke`
- `/investor-trust`
- `/smoke?public=1`
- `/api/smoke-public?limit=200`
- `/api/smoke-status`
- `/api/smoke-status?format=svg`
- `artifacts/evidence-bundles/SMOKE-LEDGER.json`
- `artifacts/evidence-bundles/latest-smoke.json`

Public investor smoke URL (no signup required):

- `/investor-smoke`

Integrity + automation controls:

- Evidence fields: `verifyHash`, `chainHash`, optional HMAC `signature`
- Signing key env: `SMOKE_SIGNING_KEY`
- Scheduled verification job: `/.netlify/functions/smoke-scheduled` (every 6 hours)
- Optional manual schedule trigger key: `SMOKE_SCHEDULE_KEY`
