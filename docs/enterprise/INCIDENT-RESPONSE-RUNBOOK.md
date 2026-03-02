# Incident Response Runbook

## Scope

Applies to security, availability, and data-integrity incidents affecting kAIxU Super IDE.

## Severity levels

- **SEV-1 (Critical):** Active compromise, confirmed data exposure, or full production outage
- **SEV-2 (High):** Major functionality degraded, suspicious security signal with plausible impact
- **SEV-3 (Medium):** Isolated bug/security issue with workaround and low blast radius
- **SEV-4 (Low):** Non-urgent hardening issue

## Initial response targets

- SEV-1: acknowledge within 15 minutes, contain within 60 minutes
- SEV-2: acknowledge within 30 minutes, contain within 4 hours
- SEV-3: acknowledge within 1 business day
- SEV-4: triage in backlog cycle

## Response workflow

1. Detect signal (monitoring, user report, provider alert, CI alert)
2. Open incident record in repository issues or internal log
3. Classify severity and impacted surface
4. Contain (disable affected paths, rotate secrets, apply kill switch where applicable)
5. Eradicate root cause and verify fix
6. Recover services and monitor stability
7. Publish post-incident report within 5 business days for SEV-1/2

## Communications

- Internal comms owner: Founder (single owner)
- External customer comms: direct email and/or status update page
- Regulatory/legal escalation: legal counsel as needed for breach notification obligations

## Required post-incident report fields

- Timeline (UTC)
- Impact summary
- Root cause
- Detection source
- Containment and recovery actions
- Preventive action items with owners and deadlines

## Evidence log

- Place post-incident records under `docs/enterprise/evidence/incidents/`.
