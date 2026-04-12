---
title: "Regulatory Reporting Platform"
---

<!-- title: Regulatory Reporting Platform | last-updated: 2025-03-15 | owner: Acme Financial Services | status: current -->

# Regulatory Reporting Platform

## System Overview

The Regulatory Reporting Platform is responsible for generating, validating, and submitting all mandatory financial and compliance reports to federal and state regulatory bodies. The platform serves as the single authoritative source for regulatory data extraction, transformation, and filing across Acme Financial Services' banking, lending, and wealth management lines of business.

### Technology Stack

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Batch Framework | Spring Batch | 5.1 | Job orchestration, chunk-oriented processing, restartability |
| Runtime | Java | 17 (LTS) | Application runtime (Eclipse Temurin) |
| Scheduler | Quartz | 2.3.2 | Cron-based job scheduling with cluster-aware coordination |
| Source Database | Oracle | 19c | Read-only access to core banking, lending, and trading systems |
| Analytics Warehouse | Snowflake | Enterprise | Historical reporting data, cross-period analytics, trend analysis |
| Report Generation | JasperReports | 6.21 | PDF and formatted output generation |
| XBRL Processing | Arelle | 2.x | XBRL instance document creation and validation |
| Container Orchestration | AKS | 1.28 | Kubernetes cluster (prod-reporting-aks-eastus2) |
| Monitoring | Datadog | — | Job monitoring, SLA tracking, alerting |

### Team & Service Tier

The platform is maintained by **6 engineers** (3 backend, 2 data engineers, 1 QA). Service classification is **Tier 2** under normal operations, automatically elevated to **Tier 1** during regulatory filing windows (typically the last 10 business days of each reporting period).

---

## Report Inventory

| Report | Regulator | Frequency | Format | Deadline | Status |
|--------|-----------|-----------|--------|----------|--------|
| Basel III Capital Adequacy (FFIEC 101/102) | OCC | Quarterly | XBRL | T+30 calendar days | Automated |
| MiFID II Transaction Reporting | FCA / ESMA | Daily | XML (ISO 20022) | T+1 business day | Automated |
| SOX Section 404 — IT Controls | SEC / PCAOB | Annual | PDF + CSV evidence packages | Fiscal year-end + 60 days | Semi-automated |
| FDIC Call Report (FFIEC 031/041) | FDIC | Quarterly | XBRL | T+30 calendar days | Automated |
| Currency Transaction Report (CTR) | FinCEN | Per event (> $10,000 cash) | BSA E-Filing (Form 112) | 15 calendar days | Automated |
| Suspicious Activity Report (SAR) | FinCEN | Per event | BSA E-Filing (Form 111) | 30 calendar days from detection | Semi-automated |
| HMDA Loan Application Register (LAR) | CFPB | Annual | LAR (pipe-delimited) | March 1 | Automated |
| CRA Data Collection | OCC | Annual | CRA aggregate tables | March 1 | Automated |

---

## Batch Architecture

### Processing Framework

The platform is built on **Spring Batch 5.1** with a chunk-oriented processing model that provides transaction management, restartability, and skip/retry policies for fault tolerance.

**Execution Window**: All batch reporting jobs execute during the **2:00 AM – 6:00 AM ET** nightly processing window. This window is coordinated with upstream core banking batch cycles that complete by 1:30 AM ET and downstream data warehouse refresh jobs that begin at 6:30 AM ET.

### Job Scheduling

**Quartz Scheduler** manages job execution with cluster-aware coordination across multiple AKS pod replicas to prevent duplicate execution. Job definitions are stored in PostgreSQL (scheduler metadata database) and support:

- **Cron Triggers**: Scheduled execution based on calendar expressions (e.g., quarterly reports on the 5th business day after quarter-end)
- **Dependency Chains**: Jobs can be configured with predecessor dependencies ensuring correct execution order
- **Calendar Awareness**: Business day calendars exclude federal holidays and bank holidays from scheduling calculations
- **Misfire Handling**: Jobs that miss their scheduled window due to infrastructure issues are automatically rescheduled with alerting

### Processing Pipeline

Each reporting job follows the standard Spring Batch **Reader → Processor → Writer** pattern:

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   ItemReader  │────▶│  ItemProcessor   │────▶│   ItemWriter     │
│ (Oracle/Snow) │     │ (Transform/Val)  │     │ (XBRL/XML/CSV)   │
└──────────────┘     └──────────────────┘     └──────────────────┘
       │                      │                        │
  Data Extraction      Business Rules &          Report Output &
  & Chunking          Regulatory Mapping         Filing Submission
```

**Restartability**: All jobs are designed for restart from the last successful checkpoint. Spring Batch's `JobRepository` persists step execution context, enabling recovery after failures without reprocessing completed chunks. Chunk size is tuned per report type (typically 1,000–5,000 records per chunk).

**Parallel Processing**: High-volume reports (e.g., MiFID II daily reporting, HMDA LAR) use Spring Batch's partitioned step execution to distribute work across multiple threads. The partitioning strategy segments data by product line or business date to ensure even distribution.

---

## Data Extraction

### Oracle Database Access

The platform connects to core banking Oracle 19c databases via **read-only database links** with a dedicated connection pool:

- **Connection Pool**: HikariCP, 10 maximum connections per source database
- **Access Pattern**: Read-only service account (`SVC_REGRPT_RO`) with SELECT grants on reporting-specific materialized views
- **Network**: Private endpoint via Azure Private Link — no public internet exposure

### Materialized Views

Source data is pre-aggregated into **materialized views** maintained by the core banking DBA team. These views serve as the stable contract between source systems and reporting:

- `MV_LOAN_PORTFOLIO_DAILY` — Loan-level positions with accruals
- `MV_DEPOSIT_BALANCES_DAILY` — Deposit account balances by product
- `MV_TRADING_POSITIONS` — Securities positions and mark-to-market
- `MV_CAPITAL_COMPONENTS` — Risk-weighted assets and capital calculations
- `MV_TRANSACTION_DETAIL` — Transaction-level records for CTR/SAR

Materialized views are refreshed nightly by 1:30 AM ET. The reporting platform validates freshness timestamps before extraction begins.

### Two-Phase Validation

Every data extraction passes through a **two-phase validation** process:

**Phase 1 — Technical Validation:**
- Schema conformance (column types, null constraints, enumerated values)
- Referential integrity checks across related entities
- Date range validation (no future-dated records, no stale data)
- Duplicate detection (primary key and composite key uniqueness)

**Phase 2 — Business Validation:**
- Control total reconciliation against source system general ledger balances
- Cross-report consistency checks (e.g., Call Report total assets must reconcile with Basel III RWA inputs)
- Threshold-based anomaly detection (quarter-over-quarter variance exceeding ±10% triggers manual review)
- Regulatory edit checks (FFIEC edit rules for Call Reports, CFPB edit checks for HMDA)

### Reconciliation Control Totals

Each extraction job produces reconciliation control totals that are compared against source system authoritative balances:

| Control Point | Source | Tolerance | Escalation |
|--------------|--------|-----------|------------|
| Total Assets | General Ledger (Oracle) | $0 (exact match) | Immediate — blocks report submission |
| Loan Count | Loan Servicing Platform | 0 records | Immediate — blocks report submission |
| Deposit Balances | Core Banking | ≤ $1,000 (rounding) | Warning — requires analyst sign-off |
| RWA Total | Risk Engine | ≤ 0.01% | Warning — requires risk team confirmation |

---

## Report Formats

### XBRL (eXtensible Business Reporting Language)

Basel III and FDIC Call Reports are filed in **XBRL** format using the FFIEC taxonomy:

- Instance documents are generated using the **Arelle** XBRL processor
- Taxonomy validation ensures all required concepts are populated and calculation linkbase relationships are satisfied
- Filing is submitted via the FFIEC Central Data Repository (CDR) portal using automated browser-based submission (Selenium-backed, with manual fallback)

### XML — ISO 20022

MiFID II transaction reports use the **ISO 20022** XML message standard:

- Messages conform to the `auth.030.001.02` schema for transaction reporting
- Validation against the FCA-published XSD schemas before submission
- Submission via the FCA Market Data Processor (MDP) gateway using mutual TLS authentication

### CSV & Pipe-Delimited

HMDA LAR files use CFPB-specified **pipe-delimited** format. CRA data submissions use fixed-width and CSV formats per OCC specifications. All delimited files include header records with record counts and control totals for validation.

### PDF — JasperReports

SOX 404 evidence packages and internal management reports are generated as **PDF** documents using JasperReports 6.21. Templates are maintained in version control with parameterized data binding. Digital signatures are applied using the organization's code signing certificate.

---

## Audit Trail

### Immutable Execution Records

Every reporting job execution produces an immutable audit record containing:

| Field | Description |
|-------|-------------|
| Job Execution ID | Unique identifier (UUID) for the job run |
| Job Name | Canonical report identifier (e.g., `FFIEC_031_Q4_2024`) |
| Start Timestamp | ISO 8601 timestamp of job initiation |
| End Timestamp | ISO 8601 timestamp of job completion |
| Status | COMPLETED, FAILED, STOPPED |
| Input Record Count | Total records read from source |
| Output Record Count | Total records written to report output |
| Skipped Record Count | Records skipped due to validation failures (with error details) |
| Control Totals | Key financial aggregates for reconciliation |
| Validation Summary | Pass/fail status for Phase 1 and Phase 2 validation |
| Data Snapshot Hash | SHA-256 hash of the input dataset |
| Report Output Hash | SHA-256 hash of the generated report file |
| Reviewer Sign-Off | User ID and timestamp of the reviewer who approved submission |
| Submission Confirmation | Regulator-provided acknowledgment ID (where applicable) |

### Retention Policy

Audit records and report artifacts are retained for a minimum of **7 years** per regulatory requirements (SOX record retention, BSA/AML 5-year minimum extended to 7 years per organizational policy).

### Storage Architecture

Report artifacts and audit records are stored in **Azure Blob Storage** with **WORM (Write Once Read Many)** immutability policies:

- **Container**: `regulatory-reports-prod` with time-based retention lock (7 years, locked policy — cannot be shortened)
- **Access Tier**: Hot for current year, Cool for 1–3 years, Archive for 3–7 years (automated lifecycle management)
- **Encryption**: Azure Storage Service Encryption (SSE) with customer-managed keys (Azure Key Vault)
- **Access Controls**: Azure AD RBAC — write access limited to the reporting service principal; read access granted to Internal Audit, Compliance, and regulatory examination teams
- **Replication**: GRS (Geo-Redundant Storage) with secondary region read access for disaster recovery

---

## Operations

### Monitoring & Alerting

| Alert | Condition | Severity | Notification |
|-------|-----------|----------|-------------|
| Job Failure | Any reporting job terminates with FAILED status | P1 (filing window) / P2 (non-filing) | PagerDuty + Slack #reg-reporting-alerts |
| SLA Breach | Report not submitted by T-2 days before regulatory deadline | P1 | PagerDuty + email to Head of Regulatory Reporting |
| Reconciliation Failure | Control total mismatch exceeding tolerance | P2 | Slack #reg-reporting-alerts |
| Source Data Freshness | Materialized views older than expected refresh time | P3 | Slack #reg-reporting-alerts |

### Disaster Recovery

- **RPO**: 1 hour (Azure Blob GRS replication)
- **RTO**: 4 hours (AKS failover to paired region)
- **DR Drill Frequency**: Semi-annual, coordinated with enterprise BC/DR exercises

## Contact

- **Platform Owner**: Regulatory Reporting Engineering — `reg-reporting-eng@acmefinancial.com`
- **On-Call**: PagerDuty service `reg-reporting-prod` (Tier 2 / Tier 1 during filing)
- **Slack**: `#reg-reporting-support` (general), `#reg-reporting-alerts` (automated alerts)
- **Business Stakeholders**: Regulatory Affairs Office — `regulatory-affairs@acmefinancial.com`
