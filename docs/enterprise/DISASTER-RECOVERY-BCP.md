# Disaster Recovery and Business Continuity

## Objective

Ensure kAIxU Super IDE can recover from platform disruption while preserving customer data integrity.

## Core dependencies

- Hosting/runtime: Netlify
- Primary data store: Neon PostgreSQL
- AI inference upstream: kAIxU Gateway
- Billing: Stripe

## Recovery targets

- Target Recovery Time Objective (RTO): 4 hours
- Target Recovery Point Objective (RPO): 1 hour for operational data, best-effort for in-flight sessions

## Recovery strategy

1. Confirm scope: hosting outage vs database outage vs provider incident
2. Validate provider status pages and logs
3. Execute service-specific failover/recovery steps:
   - Re-deploy latest known good build
   - Validate database connectivity and migration state
   - Disable non-critical features (for example advanced AI operations) until stable
4. Run smoke tests (`smoketest.html` and API health checks)
5. Announce restoration and monitor for regression

## Backup and retention

- Database backup posture follows Neon managed backup controls
- Source of truth for app code is Git repository with protected history
- Critical configuration values are maintained as environment secrets in hosting platform

## Continuity for single-operator model

- Runbooks are stored in-repo for reproducible recovery steps
- Critical credentials stored in managed secret stores with secure recovery options
- Recovery drill is run at least quarterly and logged

## Evidence log

- Store drill outcomes in `docs/enterprise/evidence/dr-drills/`.
