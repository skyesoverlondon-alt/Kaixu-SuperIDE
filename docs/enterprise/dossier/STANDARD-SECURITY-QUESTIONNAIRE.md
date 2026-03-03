# Standard Security Questionnaire (SSQ)

## Document Intent

This baseline SSQ is designed for procurement and security review intake. Responses reflect the current operating state of kAIxU Super IDE by Skyes Over London.

## Company and Product

**Q: Legal company name?**  
A: Skyes Over London.

**Q: Product under review?**  
A: kAIxU Super IDE.

**Q: Team and operating model?**  
A: Founder-led, single-operator engineering and security model with documented compensating controls.

## Security Governance

**Q: Do you maintain formal security governance documentation?**  
A: Yes. See `docs/enterprise/SECURITY-GOVERNANCE.md`.

**Q: Is there a vulnerability disclosure process?**  
A: Yes. Public disclosure metadata is available at `/.well-known/security.txt`; policy is in `SECURITY.md`.

**Q: Do you have defined vulnerability remediation SLAs?**  
A: Yes. See `docs/enterprise/VULNERABILITY-MANAGEMENT.md`.

## Identity and Access Management

**Q: Is user authentication required for protected endpoints?**  
A: Yes.

**Q: Is role-based access control implemented?**  
A: Yes, role-enforced access paths are implemented for multi-tenant and admin-sensitive operations.

**Q: Is MFA supported?**  
A: Yes, MFA support is implemented.

**Q: Do you perform periodic access reviews?**  
A: Yes, monthly review cadence is defined in `docs/enterprise/ACCESS-REVIEW.md`.

## Application Security

**Q: Do you enforce transport and browser security controls?**  
A: Yes. Security headers and CSP are enforced through deployment configuration.

**Q: Are APIs protected against abuse?**  
A: Yes. Rate limiting is implemented for sensitive/write and AI-heavy endpoints.

**Q: Do you run dependency vulnerability checks?**  
A: Yes, dependency audit checks are included in CI.

## Monitoring and Incident Response

**Q: Is there an incident response process with severity levels?**  
A: Yes. See `docs/enterprise/INCIDENT-RESPONSE-RUNBOOK.md`.

**Q: Is there disaster recovery/business continuity documentation?**  
A: Yes. See `docs/enterprise/DISASTER-RECOVERY-BCP.md`.

**Q: Do you keep incident and recovery evidence?**  
A: Yes. Evidence directories are maintained under `docs/enterprise/evidence/`.

## Data Protection and Third Parties

**Q: Do you provide legal and privacy documentation?**  
A: Yes. Privacy, Terms, DPA, Security, Subprocessors, and SLA pages are published.

**Q: Do you track third-party/vendor risk?**  
A: Yes. See `docs/enterprise/THIRD-PARTY-RISK.md`.

## External Assurance

**Q: Do you currently provide SOC 2 or ISO certification reports?**  
A: Not at this time. Roadmap is documented in `docs/enterprise/COMPLIANCE-ROADMAP.md`.

**Q: Do you currently provide independent penetration test reports?**  
A: Planned as a near-term deliverable per compliance roadmap.

## Evidence Production

**Q: Can you generate a procurement-ready evidence packet on demand?**  
A: Yes. Run `npm run evidence:bundle` to generate a dated evidence bundle with dossier and governance artifacts.
