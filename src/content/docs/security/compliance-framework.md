---
title: "Compliance & Regulatory Framework"
---

<!-- title: Compliance & Regulatory Framework | last-updated: 2025-03-15 | owner: Acme Financial Services | status: current -->

# Compliance & Regulatory Framework

## Overview

Acme Financial Services operates under the supervision of multiple federal and state regulatory bodies. This document defines the regulatory inventory, control mappings, automated compliance tooling, testing calendar, audit readiness procedures, and incident reporting obligations that govern all technology systems and engineering practices.

All engineers, contractors, and third-party vendors with access to Acme Financial Services systems are required to understand and comply with the controls outlined in this framework. Compliance is not optional — regulatory violations can result in enforcement actions, consent orders, civil money penalties, and reputational harm.

---

## Regulatory Inventory

| Regulator | Jurisdiction | Key Regulations | Examination Cycle |
|-----------|-------------|----------------|-------------------|
| Office of the Comptroller of the Currency (OCC) | Federal — national banks | OCC Heightened Standards, 12 CFR Part 30 (Safety & Soundness), SR 11-7 (Model Risk) | Annual (continuous supervision for large banks) |
| Federal Deposit Insurance Corporation (FDIC) | Federal — insured deposits | FDIC Rules & Regulations, Part 364 (Standards for Safety & Soundness) | Annual |
| Securities and Exchange Commission (SEC) | Federal — securities | SOX Section 404, Regulation S-P (Privacy), Regulation SCI | Annual SOX audit; SEC examinations as scheduled |
| Financial Industry Regulatory Authority (FINRA) | Federal — broker-dealer | FINRA Rules 3110 (Supervision), 4370 (BCP), 2210 (Communications) | Cycle examination (typically every 2–4 years) |
| PCI Security Standards Council (PCI SSC) | Industry — payment cards | PCI-DSS v4.0 | Annual assessment (QSA), quarterly ASV scans |
| Financial Crimes Enforcement Network (FinCEN) | Federal — financial crimes | Bank Secrecy Act (BSA), 31 CFR Chapter X | Examined via OCC/FDIC supervisory process |
| Consumer Financial Protection Bureau (CFPB) | Federal — consumer protection | ECOA, TILA, RESPA, FCRA, HMDA, UDAAP | Supervisory examination as scheduled |
| New York Department of Financial Services (NYDFS) | State — New York | 23 NYCRR 500 (Cybersecurity Regulation) | Annual certification (February 15); examination as scheduled |
| State Banking Regulators (Various) | State | State-specific consumer protection, licensing, privacy laws | Varies by state |

---

## Controls Mapped to Regulations

### PCI-DSS v4.0

Acme Financial Services is a **PCI-DSS Level 1** service provider. The following technology controls are maintained to satisfy PCI-DSS v4.0 requirements:

| PCI-DSS Requirement | Control Implementation |
|---------------------|----------------------|
| 1 — Network Security Controls | Azure NSGs, AKS network policies (Calico), WAF (Azure Front Door), micro-segmentation between CDE and non-CDE |
| 2 — Secure Configurations | CIS Benchmarks enforced via Azure Policy; hardened container base images (Chainguard); no default credentials |
| 3 — Protect Stored Account Data | AES-256 encryption at rest (Azure Disk Encryption, TDE for databases); tokenization for PAN storage via payment processor; encryption key rotation every 90 days |
| 4 — Protect Data in Transit | TLS 1.3 enforced for all external connections; mTLS for internal service mesh (Istio); certificate management via Azure Key Vault |
| 6 — Secure Development | SDLC with mandatory code review, SAST (CodeQL), DAST (OWASP ZAP in CI), SCA (Dependabot), security training (annual) |
| 7 — Restrict Access | RBAC via Azure AD; least privilege; just-in-time (JIT) access for production via Azure PIM; quarterly access reviews |
| 8 — Identify Users & Authenticate | Azure AD SSO with MFA enforced; service accounts use managed identities; password policy per NIST 800-63B |
| 10 — Log & Monitor Activity | Centralized logging (Datadog), tamper-evident log storage (Azure Blob WORM), 1-year retention, real-time alerting for security events |
| 11 — Test Security Regularly | Annual pen test (third-party), quarterly ASV scans, continuous vulnerability scanning (Qualys), weekly container image scanning |
| 12 — Organizational Policies | Information Security Policy, Acceptable Use Policy, Incident Response Plan, vendor risk management |

### BSA/AML Compliance

| Control Area | Implementation |
|-------------|---------------|
| Customer Identification Program (CIP) | Identity verification at account opening via LexisNexis; document verification for non-digital channels; beneficial ownership collection (CDD Rule) |
| Customer Due Diligence (CDD) | Risk-based customer profiles; ongoing monitoring; beneficial ownership identification for legal entities per 31 CFR § 1010.230 |
| Enhanced Due Diligence (EDD) | Triggered for high-risk customers (PEPs, high-risk jurisdictions, MSBs); enhanced documentation, senior management approval, ongoing review |
| Transaction Monitoring | Automated monitoring via Risk Engine (see [Risk Engine — AML Screening](../technical/risk-engine.md#aml-screening)); rule-based and ML-based detection |
| SAR Filing | Semi-automated workflow; BSA Officer review and approval; FinCEN BSA E-Filing submission within 30 calendar days |

### SOX Section 404

SOX compliance covers both **IT General Controls (ITGC)** and **application-level controls** for systems that process, store, or transmit financial data affecting financial reporting:

**IT General Controls:**

| ITGC Domain | Controls |
|-------------|----------|
| Access to Programs & Data | Role-based access, quarterly access certifications, privileged access management (Azure PIM), separation of duties |
| Program Changes | Change management via GitHub pull requests, mandatory code review, approval gates, CAB review for production changes |
| Program Development | SDLC documentation, requirements traceability, testing evidence (unit, integration, UAT), security review |
| Computer Operations | Job scheduling monitoring (Quartz/Datadog), backup verification, incident management, capacity planning |

**Application Controls:**
- Input validation controls on all financial data entry points
- Processing controls with reconciliation checkpoints
- Output controls with control total verification before regulatory submission
- Interface controls for data exchange between systems (checksums, record counts, sequence validation)

### Basel III

Basel III capital adequacy requirements are addressed through:

- Automated risk-weighted asset (RWA) calculation pipelines
- Capital ratio computation (CET1, Tier 1, Total Capital)
- Stress testing integration (CCAR/DFAST scenarios)
- Regulatory capital reporting via the FFIEC 101/102 forms (see [Regulatory Reporting Platform](../technical/regulatory-reporting.md))

---

## Automated Compliance Checks

### Code-Level Scanning

**CodeQL Custom Queries**: The security engineering team maintains a library of custom CodeQL queries targeting financial services-specific patterns:

- Detection of PAN/card data in log statements or debug output
- Identification of unencrypted PII field access outside approved data access layers
- SQL injection and parameter binding verification for Oracle and PostgreSQL queries
- Authentication bypass pattern detection in API middleware chains
- Hard-coded credential and secret detection in configuration files

**GitHub Advanced Security (GHAS):**

| Feature | Configuration | Action on Finding |
|---------|--------------|-------------------|
| Secret Scanning | Enabled with custom patterns for internal API keys, database connection strings, and certificate passphrases | PR blocked; Security team notified via Slack #security-alerts |
| Dependabot | Enabled for all repositories; automatic PR creation for security patches | Critical/High: 48-hour SLA for merge. Medium: 7-day SLA. Low: next sprint |
| Code Scanning (CodeQL) | Runs on every PR and weekly scheduled scan on default branch | High/Critical findings block merge; Medium findings create tracking issues |

### Infrastructure Policy

**Azure Policy**: Organization-level policy assignments enforce:

- Encryption at rest for all storage accounts and databases
- Diagnostic settings enabled for all resources (logs sent to Datadog)
- Network restrictions (no public endpoints for databases, storage, or key vaults)
- Allowed VM SKUs (approved list only)
- Mandatory resource tagging (owner, cost-center, data-classification, regulatory-scope)

**OPA (Open Policy Agent) in AKS**: Gatekeeper admission controller enforces:

- Container images must originate from the approved ACR registry (`acmefinancial.azurecr.io`)
- No privileged containers or host network access
- Resource limits (CPU/memory) required on all pods
- No `latest` tag — all images must use immutable digest-based references
- Istio sidecar injection required for all workloads in CDE namespaces

---

## Compliance Testing Calendar

| Test / Assessment | Frequency | Owner | Typical Window | Regulatory Basis |
|-------------------|-----------|-------|----------------|-----------------|
| PCI-DSS Penetration Test | Annual | Third-party QSA (Coalfire) | Q1 (January–February) | PCI-DSS Req. 11.4 |
| ASV Vulnerability Scan | Quarterly | Approved Scanning Vendor (Qualys) | Q1–Q4 (first week of each quarter) | PCI-DSS Req. 11.3.2 |
| SOX ITGC Testing | Annual | Internal Audit + External Auditor (Deloitte) | Q3–Q4 (September–November) | SOX Section 404 |
| BSA/AML Program Review | Annual | BSA Officer + Internal Audit | Q2 (April–May) | BSA/AML (12 CFR 21.21) |
| Fair Lending Analysis | Annual | Fair Lending Officer + Third-party consultant | Q1 (February–March) | ECOA, Reg B, HMDA |
| Cybersecurity Risk Assessment | Annual | CISO + Third-party assessor | Q4 (October–November) | 23 NYCRR 500.09, FFIEC CAT |
| Business Continuity Test | Annual | BC/DR Program Manager | Q2 (June) | OCC Heightened Standards, FINRA 4370 |
| Vulnerability Scanning | Continuous | Security Operations | Ongoing (daily scans, weekly reports) | PCI-DSS 11.3.1, NYDFS 500.05 |
| Red Team Exercise | Biennial | Third-party (CrowdStrike) | Alternating Q3 | NYDFS, FFIEC best practices |

---

## Audit Readiness

### Evidence Collection

Audit evidence is collected automatically from authoritative systems of record to ensure accuracy and reduce manual preparation effort:

| Evidence Source | System | Collection Method | Retention |
|----------------|--------|-------------------|-----------|
| Code Changes & Approvals | GitHub Enterprise | API export of PRs, reviews, approvals, branch protection audit logs | 7 years (Azure Blob WORM) |
| Infrastructure Changes | Azure Activity Logs | Diagnostic settings streaming to Datadog and Azure Blob | 7 years |
| Access Reviews | Azure AD | Quarterly access certification exports, PIM activation logs | 7 years |
| Application Monitoring | Datadog | APM traces, custom metrics, SLO reports | 15 months (hot), 7 years (archived) |
| Incident Records | PagerDuty + ServiceNow | Incident timeline, resolution notes, post-incident reviews | 7 years |
| Vulnerability Findings | Qualys, GHAS, Dependabot | Scan results, remediation tracking | 7 years |

### Examiner Access Portal

A dedicated **Examiner Access Portal** provides regulatory examiners with self-service access to audit evidence during supervisory examinations:

- **Authentication**: Azure AD B2B guest accounts with MFA enforcement
- **Authorization**: Role-based access scoped to the specific examination (e.g., SOX ITGC, BSA/AML, IT Safety & Soundness)
- **Content**: Pre-staged evidence packages organized by control objective, with search and filtering capabilities
- **Audit Logging**: All examiner access is logged with user identity, timestamp, and accessed resources

### Examination Response Playbook

1. **Notification Receipt**: Regulatory Affairs logs examination notification in ServiceNow; assigns examination coordinator
2. **Scoping Meeting**: Examination coordinator, CISO, CRO, and relevant VP-level stakeholders conduct scoping meeting within 5 business days
3. **Evidence Preparation**: Engineering teams prepare evidence packages per examiner request lists; 10-business-day SLA for standard requests
4. **Examiner Sessions**: On-site or virtual sessions facilitated by examination coordinator; all responses reviewed by Legal before delivery
5. **Findings Management**: Preliminary findings documented in ServiceNow; remediation plans developed within 30 days; progress tracked via monthly steering committee

### Prior Findings Tracking

All regulatory findings, Matters Requiring Attention (MRAs), and Matters Requiring Immediate Attention (MRIAs) are tracked in ServiceNow with the following workflow:

- **Open**: Finding documented with root cause analysis
- **Remediation In Progress**: Action plan approved by business line head and board risk committee
- **Validation**: Internal Audit independently validates remediation effectiveness
- **Closed**: Regulator confirms closure during subsequent examination

---

## Incident Reporting Obligations

Financial institutions have mandatory incident reporting obligations with strict timelines. The following table summarizes reporting requirements:

| Incident Type | Regulator | Reporting Deadline | Trigger |
|--------------|-----------|-------------------|---------|
| Data Breach (customer PII) | OCC | 36 hours from discovery | Unauthorized access to, or disclosure of, customer information that is reasonably likely to cause substantial harm |
| Data Breach (customer PII) | State AGs | Varies by state (30–90 days) | State-specific breach notification thresholds (e.g., NY GBL § 899-aa: "without unreasonable delay") |
| Cyber Incident | CISA | 72 hours from determination | Substantial cyber incident affecting critical infrastructure functions (CIRCIA) |
| Cyber Incident | FinCEN | 72 hours | Cyber events involving or targeting financial transactions or accounts |
| Operational Disruption | OCC | 4 hours (notification), 5 business days (written) | Disruption to services that materially affects the bank's ability to serve customers or comply with regulations |
| Suspicious Activity | FinCEN (SAR) | 30 calendar days from initial detection (60 days if no suspect identified) | Known or suspected violations of federal law, suspicious transactions ≥ $5,000 |
| PCI Data Breach | PCI SSC / Card Brands | Immediate (24 hours) | Compromise or suspected compromise of cardholder data |

### Incident Response Coordination

1. **Detection**: Security Operations Center (SOC) or automated monitoring identifies potential reportable incident
2. **Classification**: Incident Commander classifies the incident per the reporting matrix above
3. **Notification Chain**: CISO → General Counsel → Regulatory Affairs → CEO/Board (for material incidents)
4. **Regulatory Filing**: Regulatory Affairs prepares and submits required notifications within mandated timeframes
5. **Evidence Preservation**: Legal hold initiated; relevant logs, artifacts, and communications preserved
6. **Post-Incident Review**: Root cause analysis, lessons learned, control improvements documented within 30 days

---

## Annual Compliance Attestations

| Attestation | Deadline | Responsible Officer | Board Approval Required |
|-------------|----------|--------------------|-----------------------|
| NYDFS Cybersecurity Certification (23 NYCRR 500.17) | February 15 | CISO | Yes |
| PCI-DSS Attestation of Compliance (AOC) | Per QSA assessment cycle | CISO | No (CTO sign-off) |
| SOX Management Assessment | Within 90 days of fiscal year-end | CFO + CEO | Yes |
| BSA/AML Program Adequacy | Annual (per OCC examination cycle) | BSA Officer | Yes (Audit Committee) |

## Contact

- **Compliance Program Owner**: Chief Compliance Officer — `cco-office@acmefinancial.com`
- **Security**: CISO Office — `ciso-office@acmefinancial.com`
- **Regulatory Affairs**: `regulatory-affairs@acmefinancial.com`
- **Slack**: `#compliance-questions` (general), `#security-incidents` (incident response)
