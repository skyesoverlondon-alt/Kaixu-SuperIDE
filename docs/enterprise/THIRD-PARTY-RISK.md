# Third-Party Risk Management

## Objective

Track and reassess critical suppliers that process or influence customer data and service availability.

## Critical suppliers

- Netlify (hosting/functions)
- Neon (database)
- Stripe (billing)
- SendGrid or SMTP provider (transactional email)
- Sentry (error monitoring)

## Review cadence

- Quarterly review for critical suppliers
- Immediate review on known incidents or material contract/control changes

## Assessment factors

- Security posture and public certifications
- Data handling and privacy commitments
- Availability/SLA posture
- Breach notification terms
- Subprocessor transparency

## Supplier change process

1. Evaluate replacement risk and migration impact
2. Update legal and subprocessor disclosures
3. Validate controls in staging before production cutover

## Evidence log

- Store supplier review snapshots in `docs/enterprise/evidence/vendor-reviews/`.
