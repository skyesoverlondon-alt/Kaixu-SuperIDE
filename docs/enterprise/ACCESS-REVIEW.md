# Access Control and Review Standard

## Principle

Least privilege applies to all systems, repos, and production providers.

## Access domains

- GitHub repository and org permissions
- Netlify site/project permissions
- Neon database/project permissions
- Stripe dashboard permissions
- Monitoring and alerting systems

## Current operating model

- Single operator: Founder (Skyes Over London)
- No standing shared credentials permitted
- MFA required on all provider accounts that support it

## Review cadence

- Monthly manual access review
- Event-driven review on role change, vendor change, or suspicious activity

## Monthly checklist

1. Confirm only authorized identities have production access
2. Confirm dormant tokens and keys are rotated or revoked
3. Confirm GitHub and provider MFA remains enabled
4. Confirm service account usage is documented

## Evidence log

- Store monthly records in `docs/enterprise/evidence/access-reviews/`.
