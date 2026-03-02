# Security Governance

## Organization profile

- Legal entity: **Skyes Over London**
- System owner: **Founder / Principal Engineer (single accountable owner)**
- Team model: one-person engineering and security operations

## Security ownership model

Because the organization is founder-led, one person performs multiple formal roles:

- Security Program Owner
- Incident Commander
- Change Approver
- Data Protection Point of Contact
- Vendor Risk Owner

Compensating controls for single-person operations:

1. Mandatory written runbooks for high-risk operations
2. All production changes tracked in Git with CI checks
3. Audit events retained in application data stores and provider logs
4. Customer-impacting incidents documented with a post-incident report

## Control objectives

1. Protect customer code, metadata, and account information
2. Maintain service availability and recoverability
3. Detect and respond to security events quickly
4. Enforce least privilege for all environments and integrations

## Security controls (current)

- Authentication and role-based access controls on protected APIs
- Endpoint rate limiting for AI and write operations
- Security headers and CSP at edge config
- Dependency audit in CI
- Structured logging and error monitoring
- Legal and contractual controls: privacy, DPA, subprocessors, SLA

## Risk acceptance

- Any accepted risk requires written rationale, expiry date, and mitigation plan in repository history.
- Default max risk acceptance period: 90 days.

## Evidence log

- CI pipeline checks: `.github/workflows/ci.yml`
- Security disclosure file: `.well-known/security.txt`
- Platform security policy page: `/security`
