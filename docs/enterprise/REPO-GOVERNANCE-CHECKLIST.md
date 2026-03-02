# Repository Governance Checklist

## Purpose

Define minimum GitHub governance controls expected for enterprise procurement readiness.

## Recommended GitHub settings

For branch `main`:

1. Require pull request before merging
2. Require status checks to pass (`Lint + Test` workflow)
3. Require linear history
4. Block force pushes and branch deletion
5. Enable secret scanning and push protection

## Solo-founder operating note

In a one-person team, separation of duties is limited. Compensate with:

- PR template completion on every merge
- CI checks required before merge
- Signed, descriptive commits for security-sensitive changes
- Written evidence for high-risk changes in `docs/enterprise/evidence/`

## Current ownership mapping

- Primary code owner: `@skyesoverlondon-alt`
- Company: Skyes Over London
