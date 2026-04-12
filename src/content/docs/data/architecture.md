---
title: "Data Architecture — Acme Financial Services"
---

<!-- title: Data Architecture — Acme Financial Services | last-updated: 2025-03-15 | owner: Acme Financial Services | status: current -->

# Data Architecture — Acme Financial Services

This document describes the data architecture for Acme Financial Services (FSI), covering the database landscape, schema design, analytics platform, orchestration, data mesh strategy, governance, and privacy compliance. It is the authoritative reference for data engineers, platform teams, and governance stakeholders.

---

## 1. Database Landscape

Acme FSI operates a polyglot persistence strategy. Each database technology is selected based on workload characteristics, regulatory requirements, and operational SLAs.

| Database | Version | Primary Domain | Workload Profile | Deployment | HA / DR |
|---|---|---|---|---|---|
| Oracle Database | 19c RAC | Core Banking | OLTP, ACID, high-throughput writes | On-premises (2-node RAC) | Active-Active, Data Guard Standby |
| PostgreSQL | 15 | Payments, Risk Analytics | OLTP + moderate analytics | Azure Database for PostgreSQL – Flexible Server | Zone-redundant HA, geo-replica |
| Redis | 7 | Session cache, rate-limit counters, lookup tables | In-memory key-value | Azure Cache for Redis (Premium) | Active geo-replication |
| MongoDB | 7 | Wealth Management, document store | Document-oriented, flexible schema | Azure Cosmos DB for MongoDB vCore | Multi-region writes |
| Snowflake | Enterprise | Enterprise Analytics, Regulatory Reporting | OLAP, large-scale transformations | Snowflake on Azure (East US 2) | Fail-safe, Time Travel (90 days) |

---

## 2. Oracle 19c — Core Banking Schema

### 2.1 Tablespace Inventory

The Core Banking Oracle instance hosts the authoritative system of record for customer accounts, transactions, and product definitions.

| Tablespace | Purpose | Current Size | Monthly Growth | Datafile Count | Encryption |
|---|---|---|---|---|---|
| `ACCOUNTS_DATA` | Customer and account master records | 1.2 TB | ~15 GB | 8 | TDE (AES-256) |
| `TRANSACTIONS_DATA` | Debit, credit, and transfer transaction journal | 4.8 TB | ~120 GB | 24 | TDE (AES-256) |
| `INDEX_TS` | B-tree and bitmap indexes for accounts and transactions | 1.6 TB | ~40 GB | 12 | TDE (AES-256) |
| `PRODUCTS_DATA` | Product catalog, interest rates, fee schedules | 80 GB | ~1 GB | 4 | TDE (AES-256) |
| `ARCHIVE_TS` | Historical transactions beyond 24-month online window | 8.5 TB | ~100 GB | 32 | TDE (AES-256) |

### 2.2 Partitioning Strategy

All high-volume tables in `TRANSACTIONS_DATA` use **monthly range partitioning** on the `transaction_date` column.

- **Partition scheme**: `RANGE (transaction_date)` with monthly intervals auto-created via `INTERVAL` partitioning.
- **Local indexes**: Every index on partitioned tables is a **local index**, ensuring partition pruning during queries and enabling independent partition maintenance.
- **Partition maintenance automation**: A PL/SQL procedure (`PKG_PARTITION_MGMT.MAINTAIN_PARTITIONS`) runs nightly at 01:00 UTC via DBMS_SCHEDULER. It pre-creates partitions 3 months ahead and moves partitions older than 24 months to `ARCHIVE_TS` using `ALTER TABLE ... MOVE PARTITION ... TABLESPACE ARCHIVE_TS ONLINE UPDATE INDEXES`.
- **Statistics refresh**: `DBMS_STATS.GATHER_TABLE_STATS` runs daily at 02:00 UTC with `granularity => 'PARTITION'` for the current and previous month partitions.

### 2.3 RAC Configuration

| Parameter | Value |
|---|---|
| Cluster Nodes | 2 (active-active) |
| Interconnect | 25 GbE redundant private network |
| Storage | Oracle ASM with HIGH redundancy (triple mirroring) |
| Workload Management | Oracle Automatic Workload Management (AWM) — read-write distributed across both nodes with service-based routing |
| Connection Failover | Transparent Application Failover (TAF) with `FAILOVER_TYPE=SELECT`, `FAILOVER_METHOD=BASIC` |
| Backup | RMAN incremental-merge to Azure Blob (daily), full backup weekly |
| Data Guard | Physical standby in secondary data center, async redo transport, RPO < 5 seconds |

---

## 3. Snowflake — Enterprise Analytics Platform

### 3.1 Medallion Architecture

Acme FSI follows a **medallion (multi-hop) pattern** in Snowflake to enforce data quality progression from raw ingestion through curated consumption layers.

| Layer | Snowflake Database | Schema Naming Convention | Refresh Cadence | Retention | Description |
|---|---|---|---|---|---|
| **Raw** | `FSI_RAW` | `{SOURCE_SYSTEM}_RAW` (e.g., `CORE_BANKING_RAW`) | Near real-time (Snowpipe) + daily batch | 90 days | Immutable landing zone. Data arrives as-is via Snowpipe (Kafka connector) or staged files. No transformations applied. |
| **Staging** | `FSI_STAGING` | `{DOMAIN}_STAGING` (e.g., `BANKING_STAGING`) | Daily 06:00 UTC | 30 days | Light cleansing: type casting, deduplication, null handling, surrogate key generation. Incremental merge (SCD Type 2 where applicable). |
| **Curated** | `FSI_CURATED` | `{DOMAIN}_CURATED` (e.g., `PAYMENTS_CURATED`) | Daily 06:00 UTC (post-staging) | Unlimited | Business-conformed dimensions and facts. Enforced naming standards, documented column descriptions, and validated against Great Expectations suites. |
| **Analytics** | `FSI_ANALYTICS` | `{USE_CASE}_ANALYTICS` (e.g., `RISK_ANALYTICS`) | Daily / On-demand | Unlimited | Aggregated views, materialized for BI consumption (Tableau, Power BI). Domain-specific wide tables optimized for query performance. |

### 3.2 dbt Project

- **Models**: ~150 dbt models organized by domain (`banking`, `payments`, `risk`, `wealth`, `compliance`).
- **Tests**: ~400 tests including schema tests (`not_null`, `unique`, `accepted_values`, `relationships`) and custom data tests for business rules (e.g., transaction balances must reconcile within ±$0.01).
- **Documentation**: Auto-generated dbt docs catalog deployed to an internal portal. Every model has a `description`, and every column in curated and analytics layers has a `description` and `meta` tag indicating data classification.
- **Materializations**: Raw and staging models use `incremental` with `merge` strategy. Curated uses `incremental` or `table` depending on volume. Analytics uses `table` for predictable BI performance.
- **CI**: Pull requests trigger `dbt build --select state:modified+` against a CI Snowflake database (`FSI_CI`) with row-limited clones.

### 3.3 Data Sharing and Data Mesh

Snowflake **Secure Data Sharing** is used to publish curated data products to consuming domains without data movement. Each domain owns a share (e.g., `BANKING_SHARE`, `RISK_SHARE`) mapped to a reader database in consuming accounts or databases. This underpins the broader data mesh strategy described in Section 5.

---

## 4. Airflow Orchestration

All batch data pipelines are orchestrated via **Apache Airflow 2.8** running on Azure Kubernetes Service (AKS) with the KubernetesExecutor.

### 4.1 DAG Inventory

| DAG ID | Schedule (UTC) | Avg Duration | Description | Key Operators |
|---|---|---|---|---|
| `daily_core_banking_etl` | 04:30 | 45 min | Extracts account and transaction data from Oracle via LogMiner CDC, stages into `FSI_RAW.CORE_BANKING_RAW` | `OracleToSnowflakeOperator`, `SnowflakeOperator` |
| `daily_payments_etl` | 05:00 | 30 min | Ingests payment clearing files from SFTP and ISO 20022 messages from Kafka | `SFTPToSnowflakeOperator`, `KafkaConsumeOperator` |
| `daily_risk_data_aggregation` | 05:30 | 20 min | Aggregates risk exposure data from PostgreSQL and external market feeds | `PostgresOperator`, `HttpOperator`, `SnowflakeOperator` |
| `daily_dbt_transform` | 06:00 | 60 min | Executes dbt build across staging → curated → analytics layers | `BashOperator` (dbt CLI) |
| `regulatory_data_prep` | 06:30 | 30 min | Prepares CTR, SAR, and Call Report datasets for regulatory submission | `SnowflakeOperator`, `S3UploadOperator` |
| `weekly_feature_refresh` | Sun 02:00 | 90 min | Refreshes ML feature store tables used by fraud and credit scoring models | `SnowflakeOperator`, `PythonOperator` |
| `monthly_data_quality_report` | 1st of month, 07:00 | 15 min | Generates data quality KPI report and distributes to governance committee | `GreatExpectationsOperator`, `EmailOperator` |

### 4.2 Dependencies and Error Handling

- **Cross-DAG dependencies**: `daily_dbt_transform` uses `ExternalTaskSensor` to wait on successful completion of `daily_core_banking_etl`, `daily_payments_etl`, and `daily_risk_data_aggregation`. Similarly, `regulatory_data_prep` depends on `daily_dbt_transform`.
- **Retry policy**: All tasks default to `retries=3` with `retry_delay=timedelta(minutes=5)` and exponential backoff (`retry_exponential_backoff=True`, `max_retry_delay=timedelta(minutes=30)`).
- **Alerting**: On task failure after final retry, a callback triggers a **PagerDuty** incident (Severity P2 for production DAGs). A Slack notification is sent to `#fsi-data-alerts` for all retries.
- **SLA monitoring**: Each DAG has an SLA (`sla=timedelta(...)`) configured. SLA misses trigger a warning to the on-call data engineer via PagerDuty (Severity P3).

---

## 5. Data Mesh — Domain Data Products

Acme FSI is adopting a **data mesh** operating model. Each business domain publishes certified **data products** with well-defined SLOs, schemas, and ownership.

### 5.1 Domain Data Products

| Data Product | Owner Domain | Source Layer | Published Via | Refresh | SLO (Freshness) | SLO (Completeness) | Primary Consumers |
|---|---|---|---|---|---|---|---|
| `account_summary` | Banking | `FSI_CURATED.BANKING_CURATED` | Snowflake Share | Daily by 07:00 UTC | ≤ 3 hours | ≥ 99.5% | Risk, Wealth, Compliance |
| `transaction_daily` | Banking | `FSI_CURATED.BANKING_CURATED` | Snowflake Share | Daily by 07:00 UTC | ≤ 3 hours | ≥ 99.9% | Payments, Risk, Compliance, Analytics |
| `payment_daily` | Payments | `FSI_CURATED.PAYMENTS_CURATED` | Snowflake Share | Daily by 07:30 UTC | ≤ 3.5 hours | ≥ 99.5% | Banking, Risk, Compliance |
| `credit_risk_scores` | Risk | `FSI_CURATED.RISK_CURATED` | Snowflake Share + API | Daily by 08:00 UTC | ≤ 4 hours | ≥ 99.0% | Banking (underwriting), Wealth |
| `fraud_alert_daily` | Risk | `FSI_CURATED.RISK_CURATED` | Snowflake Share | Daily by 07:30 UTC | ≤ 3.5 hours | ≥ 99.9% | Compliance, Banking |
| `client_portfolio_daily` | Wealth | `FSI_CURATED.WEALTH_CURATED` | Snowflake Share | Daily by 08:30 UTC | ≤ 5 hours | ≥ 99.0% | Analytics, Compliance |

### 5.2 Federated Governance

Data mesh at Acme FSI follows a **federated computational governance** model:

- **Naming convention**: All data product tables follow `{domain}_{entity}_{granularity}` (e.g., `banking_account_summary_daily`). Columns follow `snake_case` with domain-specific prefixes avoided in curated layer.
- **Schema evolution**: Backward-compatible changes only. New columns must be nullable or have defaults. Removals require a 90-day deprecation window with consumer notification.
- **Data classification tagging**: Every column carries a `meta.classification` tag (`PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `RESTRICTED`) in dbt, propagated to Snowflake column comments and the data catalog.
- **Automated quality gates**: All curated-layer models must pass a **Great Expectations** validation suite before the data product is marked as available. Suites enforce completeness, uniqueness, referential integrity, and domain-specific business rules.

---

## 6. Data Governance

### 6.1 Data Classification Framework

| Classification | Definition | Example Data | Access Control | Encryption at Rest | Masking |
|---|---|---|---|---|---|
| **Public** | Non-sensitive, approved for external disclosure | Product names, branch addresses | Open read | Standard | None |
| **Internal** | Business data not intended for external parties | Aggregate transaction volumes, internal KPIs | Role-based (Snowflake RBAC) | Standard | None |
| **Confidential** | Sensitive business data, material non-public information | Customer PII (name, email, phone), account balances | Need-to-know, approval required | TDE / Snowflake encryption | Dynamic masking in non-production |
| **Restricted** | Highly sensitive, regulatory-controlled | SSN, Tax ID, credit scores, SARs | Named-user access list, MPA | TDE (AES-256) / Snowflake encryption | Column-level masking, tokenization |

### 6.2 Data Lineage Tracking

Lineage is captured at multiple layers to ensure end-to-end traceability from source to consumption:

- **Snowflake ACCESS_HISTORY**: Enabled on all production databases. Captures read/write lineage at the column level, retained for 365 days. Queried via `SNOWFLAKE.ACCOUNT_USAGE.ACCESS_HISTORY`.
- **dbt lineage**: The dbt DAG provides model-level lineage. Exposed in the auto-generated dbt docs and integrated with the internal data catalog via the dbt metadata API.
- **Airflow lineage**: Airflow OpenLineage integration emits lineage events for every task execution, captured in a Marquez instance for cross-pipeline lineage visualization.

### 6.3 Data Quality SLOs

| Domain | Completeness | Timeliness (Data Available By) | Accuracy | Monitoring |
|---|---|---|---|---|
| Banking (accounts) | ≥ 99.5% non-null on required fields | 07:00 UTC | ≥ 99.9% reconciliation vs. GL | Great Expectations + custom reconciliation job |
| Banking (transactions) | ≥ 99.9% | 07:00 UTC | ≥ 99.99% (± $0.01 tolerance) | Great Expectations + end-of-day GL reconciliation |
| Payments | ≥ 99.5% | 07:30 UTC | ≥ 99.9% vs. clearing network confirms | Great Expectations |
| Risk | ≥ 99.0% | 08:00 UTC | Model-validated (backtesting) | Great Expectations + model monitoring |
| Wealth | ≥ 99.0% | 08:30 UTC | ≥ 99.5% vs. custodian feeds | Great Expectations |

### 6.4 Data Retention Policy

Retention periods align with U.S. federal regulatory requirements and internal risk policy.

| Regulation / Standard | Applicable Data | Minimum Retention | Acme FSI Policy |
|---|---|---|---|
| Bank Secrecy Act (BSA) / FinCEN | CTRs, SARs, KYC records, transaction records | 5 years (records), 5 years post-filing (SARs) | **7 years** |
| SEC / FINRA Rule 17a-4 | Trade records, customer communications, account statements | 6 years (trade records), 3 years (communications) | **7 years** |
| Sarbanes-Oxley (SOX) | Audit workpapers, financial records, internal controls evidence | 7 years | **7 years** |
| Internal Risk Policy | Model training datasets, risk decisioning logs | N/A (internal) | **5 years** |

Archival beyond the online retention window is handled by automated partition moves (Oracle) and Snowflake Time Travel + Fail-safe, with long-term archive to Azure Blob Storage (Cool tier) encrypted with customer-managed keys (Azure Key Vault).

---

## 7. Privacy Compliance — GDPR and CCPA

### 7.1 Data Subject Rights

Acme FSI supports the following data subject rights across all systems:

- **Right of Access (GDPR Art. 15 / CCPA §1798.100)**: Data subjects can request a full export of personal data. The request is fulfilled by the Privacy Operations team within 30 days (GDPR) or 45 days (CCPA) using an automated extraction pipeline that queries Oracle, PostgreSQL, MongoDB, and Snowflake by `customer_id`.
- **Right to Erasure (GDPR Art. 17)**: Erasure is executed as soft-delete (anonymization) where regulatory retention requirements apply, and hard-delete where they do not. The `privacy_erasure_pipeline` Airflow DAG orchestrates anonymization across all data stores, replacing PII with hashed tokens and setting a `gdpr_erased_flag`.
- **Right to Rectification (GDPR Art. 16)**: Corrections to master data are applied in the Core Banking system of record and propagated downstream via CDC within 24 hours.
- **Right to Portability (GDPR Art. 20)**: Data is exported in machine-readable JSON format via the Customer Data API endpoint.

### 7.2 Data Inventory and Processing Register

A centralized **Record of Processing Activities (RoPA)** is maintained in OneTrust, cataloging every processing activity, its legal basis (consent, contract, legitimate interest, legal obligation), data categories, retention periods, and third-party recipients.

### 7.3 Consent Management

- Consent records are stored in a dedicated `CONSENT_MANAGEMENT` schema in PostgreSQL.
- Consent preferences are exposed to downstream systems via a Kafka topic (`compliance.consent.updated`).
- Consent withdrawal triggers an automated review workflow to cease non-essential processing within 48 hours.

### 7.4 Data Protection Impact Assessments (DPIAs)

DPIAs are required for any new processing activity involving Restricted data, automated decision-making, or large-scale profiling. Completed assessments are stored in OneTrust and reviewed by the Data Protection Officer (DPO) and Legal.

### 7.5 Cross-Border Data Transfers

Personal data of EU/EEA data subjects is processed within the Azure EU West region. Where cross-border transfers to the United States are necessary (e.g., centralized fraud models), transfers are governed by **Standard Contractual Clauses (SCCs)** supplemented by a Transfer Impact Assessment (TIA). All transfers are encrypted in transit (TLS 1.3) and at rest.

### 7.6 Breach Notification

- **GDPR**: The DPO must be notified within 24 hours of discovery. Supervisory authority notification within **72 hours** if the breach is likely to result in a risk to individuals. Data subjects are notified "without undue delay" if the breach is likely to result in high risk.
- **CCPA**: Notification to affected California residents "in the most expedient time possible and without unreasonable delay," and no later than required by California Civil Code §1798.82.
- **Internal process**: Security Operations triggers the Incident Response Plan (IRP). The Privacy Operations team assesses scope, determines notification obligations, and coordinates with Legal and Communications.

---

*For questions about this architecture, contact the FSI Data Platform team via `#fsi-data-platform` on Slack or email `fsi-data-platform@acme.com`.*
