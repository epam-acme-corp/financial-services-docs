---
title: "Core Banking Platform — Technical Deep-Dive"
---

<!-- title: Core Banking Platform — Technical Deep-Dive | last-updated: 2025-03-15 | owner: Acme Financial Services | status: current -->

# Core Banking Platform — Technical Deep-Dive

## 1. Platform Overview

The Core Banking Platform is the system of record for all deposit accounts, lending products, customer data, and general-ledger sub-ledger postings across Acme Financial Services.

| Attribute | Detail |
|-----------|--------|
| **Primary Language** | Java 17 (LTS) |
| **Framework** | Spring Boot 3.2, Spring Data JPA, Spring Security 6 |
| **Database** | Oracle 19c RAC (2-node active-active) |
| **Deployment** | AKS 1.28, 12 pod replicas (HPA: 8–20), non-PCI cluster |
| **Team Size** | 45 engineers (backend, QA, SRE, data) |
| **SLA** | Tier 1 — 99.95 % monthly uptime |
| **RTO / RPO** | 30 min / 0 (synchronous Data Guard) |
| **Repository** | `acme-core-banking` (monorepo, Gradle multi-module) |

The platform was originally deployed in 2008 as a monolithic J2EE application. Between 2020 and 2023, it was re-architected into a **modular monolith**: a single deployable unit composed of internally decoupled modules (Accounts, Transactions, Interest, Statements, GL) enforced via Java module system boundaries (`module-info.java`) and package-private visibility.

---

## 2. Account Management

### 2.1 Account Types

| Category | Product | Internal Code | Interest Bearing | Min Balance | FDIC Insured |
|----------|---------|---------------|------------------|-------------|-------------|
| Checking | Personal Checking | `CHK-PER` | No | $0 | Yes |
| Checking | Business Checking | `CHK-BIZ` | No | $2,500 | Yes |
| Savings | Standard Savings | `SAV-STD` | Yes — variable | $100 | Yes |
| Savings | High-Yield Savings | `SAV-HYD` | Yes — variable (premium tier) | $10,000 | Yes |
| Money Market | Money Market Account | `MMA-001` | Yes — tiered | $2,500 | Yes |
| Certificate of Deposit | CD (various terms) | `CD-NNN` | Yes — fixed | $1,000 | Yes |
| Loan — Personal | Personal Loan | `LN-PER` | N/A (borrower pays) | — | N/A |
| Loan — Auto | Auto Loan | `LN-AUTO` | N/A | — | N/A |
| Loan — HELOC | Home Equity Line of Credit | `LN-HELOC` | N/A | — | N/A |
| Loan — Commercial | Commercial Term Loan | `LN-COMM` | N/A | — | N/A |
| Loan — Commercial | Revolving Credit Facility | `LN-REVLV` | N/A | — | N/A |

### 2.2 Account Lifecycle

Every account progresses through a well-defined set of states:

```
Application → Approved → Active → Dormant → Closed
                                      ↘ Charged-Off (loans only)
```

| State | Description | Trigger |
|-------|-------------|---------|
| `APPLICATION` | Customer has submitted an account opening request; pending identity verification and credit check. | Customer action or banker initiation |
| `APPROVED` | Identity verified, credit check passed (if applicable), compliance screening cleared. | Risk Engine approval response |
| `ACTIVE` | Account is open for transactions. | First deposit posted or loan funded |
| `DORMANT` | No customer-initiated transactions for 12 consecutive months (deposit) or 90 days past due (loan). | Nightly batch dormancy check |
| `CLOSED` | Account closed at customer request, zero balance, or regulatory action. | Customer request / bank action |
| `CHARGED_OFF` | Loan written off as uncollectible after 180 days past due (consumer) or 90 days (commercial). | Nightly batch charge-off evaluation |

### 2.3 Account Opening Workflow

1. **Initiate** — Customer or banker submits an application via the API (`POST /v1/accounts/applications`).
2. **Identity Verification** — The platform calls the Risk Engine synchronously to perform CIP (Customer Identification Program) checks: Experian Precise ID, Equifax, OFAC SDN list.
3. **Credit Decision** — For lending products, the Risk Engine returns a credit score and approval/decline/refer decision.
4. **Compliance Screening** — AML/KYC screening against Refinitiv World-Check. Results are persisted and auditable.
5. **Account Provisioning** — On approval, the Accounts module creates the account record, assigns an account number (Luhn-checked, branch-prefixed), and initializes the GL sub-ledger entries.
6. **Notification** — A `banking.account.opened` Kafka event is published; downstream consumers (Wealth Portal, Data Warehouse, Regulatory Reporting) react asynchronously.

---

## 3. Transaction Processing

### 3.1 Double-Entry Bookkeeping

All monetary movements are recorded as **double-entry journal postings**. Every transaction debits one or more accounts and credits one or more accounts by equal amounts. The system rejects any posting batch that does not balance to zero.

### 3.2 Transaction Types

| Type | Code | Description |
|------|------|-------------|
| Debit | `DBT` | Withdrawal, purchase, fee assessment |
| Credit | `CRD` | Deposit, incoming transfer, interest credit |
| Internal Transfer | `XFR` | Movement between two Acme accounts |
| Wire Transfer | `WIR` | Outbound or inbound wire (Fedwire/SWIFT) |
| Interest Accrual | `INT` | Daily accrued interest posting |
| Fee | `FEE` | Monthly maintenance fee, overdraft fee, wire fee |
| Adjustment | `ADJ` | Operational or regulatory correction |
| Reversal | `REV` | Full or partial reversal of a prior posting |

### 3.3 Transaction Processing Flow

```
Initiate → Validate → Screen → Authorize → Post → Notify
```

| Step | Description | Latency Budget |
|------|-------------|----------------|
| **Initiate** | API receives the transaction request; assigns a UUID v7 transaction ID. | — |
| **Validate** | Schema validation, account status check, currency check, duplicate detection (idempotency). | < 5 ms |
| **Screen** | Synchronous call to Risk Engine for real-time AML/fraud screening. | < 100 ms |
| **Authorize** | Balance sufficiency check (with hold consideration), daily/transaction limit checks, dual-authorization for high-value transactions. | < 20 ms |
| **Post** | Double-entry journal entries written to `TRANSACTIONS` table within a single Oracle transaction; account balances updated atomically. | < 25 ms |
| **Notify** | Kafka event `banking.transaction.posted` published; triggers downstream processing (statements, data warehouse, notifications). | Async |

### 3.4 Idempotency

Every transaction request must include an `Idempotency-Key` header containing a UUID v7. The platform maintains a deduplication window of **72 hours** using a database-backed idempotency table. If a duplicate key is received within the window, the original response is replayed without re-executing the transaction.

### 3.5 Optimistic Locking

Account balance updates use **optimistic locking** (JPA `@Version` column) to avoid database-level row locks during high-concurrency scenarios. On version conflict, the transaction is retried up to three times with exponential backoff before returning HTTP 409 Conflict.

---

## 4. Daily Batch Processing (End-of-Day)

### 4.1 Batch Window

The EOD batch runs nightly from **11:00 PM to 4:00 AM Eastern Time**. The batch window is protected by an operational freeze: no deployments or infrastructure changes are permitted during this period.

### 4.2 Batch Job Sequence

| Order | Job | Description | Typical Duration |
|-------|-----|-------------|-----------------|
| 1 | Interest Accrual | Calculate and post daily interest for all interest-bearing accounts | 45 min |
| 2 | Fee Assessment | Assess monthly maintenance fees, overdraft fees (on applicable cycle dates) | 15 min |
| 3 | Dormancy Check | Flag accounts with no customer-initiated activity for 12+ months | 10 min |
| 4 | Charge-Off Evaluation | Evaluate past-due loans for charge-off eligibility | 10 min |
| 5 | Statement Generation | Generate monthly statements for accounts on their statement cycle date | 90 min |
| 6 | GL Aggregation | Aggregate sub-ledger postings into GL summary entries | 20 min |
| 7 | Regulatory Extracts | Produce CTR/SAR data feeds, FFIEC extracts | 30 min |
| 8 | Data Warehouse Feed | Full daily snapshot + incremental CDC catch-up | 20 min |
| **Total** | | | **~3.5 hours** |

All batch jobs are implemented as **Spring Batch** partitioned step flows with chunk-based processing (commit interval = 500 records). Job metadata is persisted in Oracle, enabling automatic restart from the last committed chunk in the event of failure.

### 4.3 Interest Calculation

| Account Category | Day Count Convention | Compounding | Posting Frequency |
|-----------------|---------------------|-------------|-------------------|
| Retail deposits | Actual/365 | Daily | Monthly |
| Commercial deposits | 30/360 | Daily | Monthly |
| Personal loans | Actual/365 | Daily | Monthly |
| Commercial loans | 30/360 | Daily | Monthly or quarterly (per contract) |
| CDs | Actual/365 | Daily | At maturity or per contract |

### 4.4 Statement Generation

- **Retail accounts:** PDF statements generated via Apache FOP, delivered to online banking portal and optionally mailed (via print vendor API).
- **Commercial accounts:** BAI2 (Cash Management Balance Reporting) files generated for electronic delivery to treasury management systems.

---

## 5. Reconciliation Engine

Reconciliation ensures that the platform's internal records agree with external counterparties and the general ledger.

### 5.1 Internal Sub-Ledger Reconciliation

Every posting date, the GL Aggregation batch job compares the sum of individual sub-ledger entries against the expected GL balances. Any discrepancy triggers a `RECON_BREAK` record and a PagerDuty alert (P2).

### 5.2 Nostro / Vostro Reconciliation

For correspondent banking relationships, the Payments Gateway forwards **MT940 statement messages** received via SWIFT. The reconciliation engine matches expected entries (from Core Banking's perspective) against the MT940 line items:

- **Auto-match rate:** 98 % of entries are matched automatically using transaction reference, amount, and value date.
- **Manual investigation:** The remaining 2 % are routed to the Operations team via a reconciliation workbench (internal tool) with an SLA of T+1 for breaks < $10,000 and T+0 (same day) for breaks ≥ $10,000.

### 5.3 Break Resolution SLAs

| Break Category | Auto-Resolve Target | Manual SLA | Escalation |
|---------------|--------------------|-----------:|------------|
| Sub-ledger vs. GL | 100 % auto | N/A — auto-correcting | P2 alert if delta > $0.01 |
| Nostro/vostro < $10K | 98 % auto | T+1 | P3 after 24 hrs |
| Nostro/vostro ≥ $10K | 98 % auto | T+0 | P2 immediate |
| Payments settlement | 99 % auto | T+1 | P2 after 4 hrs |

### 5.4 General Ledger Reconciliation

Monthly, the platform produces a GL trial balance extract that is imported into the enterprise ERP (SAP S/4HANA). The Finance team performs a full GL reconciliation with sign-off by the Controller before month-end close.

---

## 6. Database Schema

The following tables represent the core relational model. All tables reside in the `CORE_BANKING` Oracle schema.

```sql
CREATE TABLE CUSTOMERS (
    customer_id        NUMBER(18)      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_type      VARCHAR2(10)    NOT NULL CHECK (customer_type IN ('INDIVIDUAL','BUSINESS')),
    tax_id_encrypted   RAW(256)        NOT NULL,  -- AES-256 encrypted SSN/EIN
    first_name         VARCHAR2(100),
    last_name          VARCHAR2(100),
    business_name      VARCHAR2(200),
    date_of_birth      DATE,
    cip_status         VARCHAR2(20)    DEFAULT 'PENDING' NOT NULL,
    kyc_risk_rating    VARCHAR2(10),
    created_at         TIMESTAMP       DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at         TIMESTAMP       DEFAULT SYSTIMESTAMP NOT NULL,
    version            NUMBER(10)      DEFAULT 0 NOT NULL
);

CREATE TABLE PRODUCTS (
    product_id         NUMBER(18)      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_code       VARCHAR2(20)    NOT NULL UNIQUE,
    product_name       VARCHAR2(100)   NOT NULL,
    product_category   VARCHAR2(30)    NOT NULL,
    interest_bearing   CHAR(1)         DEFAULT 'N' CHECK (interest_bearing IN ('Y','N')),
    day_count_conv     VARCHAR2(20),   -- 'ACTUAL_365' or '30_360'
    is_active          CHAR(1)         DEFAULT 'Y' NOT NULL,
    created_at         TIMESTAMP       DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE ACCOUNTS (
    account_id         NUMBER(18)      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_number     VARCHAR2(20)    NOT NULL UNIQUE,
    customer_id        NUMBER(18)      NOT NULL REFERENCES CUSTOMERS(customer_id),
    product_id         NUMBER(18)      NOT NULL REFERENCES PRODUCTS(product_id),
    branch_code        VARCHAR2(10)    NOT NULL,
    status             VARCHAR2(20)    DEFAULT 'APPLICATION' NOT NULL,
    currency           VARCHAR2(3)     DEFAULT 'USD' NOT NULL,
    current_balance    NUMBER(18,2)    DEFAULT 0 NOT NULL,
    available_balance  NUMBER(18,2)    DEFAULT 0 NOT NULL,
    hold_amount        NUMBER(18,2)    DEFAULT 0 NOT NULL,
    opened_date        DATE,
    closed_date        DATE,
    last_activity_date DATE,
    created_at         TIMESTAMP       DEFAULT SYSTIMESTAMP NOT NULL,
    updated_at         TIMESTAMP       DEFAULT SYSTIMESTAMP NOT NULL,
    version            NUMBER(10)      DEFAULT 0 NOT NULL
);

CREATE TABLE TRANSACTIONS (
    transaction_id     NUMBER(18)      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idempotency_key    RAW(16)         NOT NULL UNIQUE,  -- UUID v7 stored as RAW
    account_id         NUMBER(18)      NOT NULL REFERENCES ACCOUNTS(account_id),
    transaction_type   VARCHAR2(10)    NOT NULL,
    direction          VARCHAR2(6)     NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
    amount             NUMBER(18,2)    NOT NULL,
    currency           VARCHAR2(3)     DEFAULT 'USD' NOT NULL,
    posting_date       DATE            NOT NULL,
    value_date         DATE            NOT NULL,
    description        VARCHAR2(500),
    reference_id       VARCHAR2(50),   -- external reference (wire ref, ACH trace)
    counterparty_acct  VARCHAR2(34),   -- IBAN or internal account number
    status             VARCHAR2(20)    DEFAULT 'POSTED' NOT NULL,
    gl_code            VARCHAR2(20)    NOT NULL,
    batch_id           NUMBER(18),
    created_at         TIMESTAMP       DEFAULT SYSTIMESTAMP NOT NULL,
    version            NUMBER(10)      DEFAULT 0 NOT NULL
)
PARTITION BY RANGE (posting_date) INTERVAL (NUMTOYMINTERVAL(1, 'MONTH')) (
    PARTITION p_initial VALUES LESS THAN (DATE '2018-01-01')
);

CREATE TABLE INTEREST_RATES (
    rate_id            NUMBER(18)      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id         NUMBER(18)      NOT NULL REFERENCES PRODUCTS(product_id),
    tier_min_balance   NUMBER(18,2)    DEFAULT 0,
    tier_max_balance   NUMBER(18,2),
    annual_rate        NUMBER(8,6)     NOT NULL,  -- e.g., 0.045000 = 4.50%
    effective_date     DATE            NOT NULL,
    expiry_date        DATE,
    created_at         TIMESTAMP       DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE INDEX idx_txn_account_posting ON TRANSACTIONS (account_id, posting_date) LOCAL;
CREATE INDEX idx_txn_idempotency     ON TRANSACTIONS (idempotency_key);
CREATE INDEX idx_acct_customer       ON ACCOUNTS (customer_id);
CREATE INDEX idx_acct_status         ON ACCOUNTS (status);
```

---

## 7. Partitioning & Archival Strategy

### 7.1 Table Partitioning

The `TRANSACTIONS` table uses **monthly range partitioning** on `posting_date` with Oracle's interval partitioning feature. New partitions are created automatically as data arrives for a new month.

| Table | Partition Strategy | Key Column | Interval |
|-------|--------------------|-----------|----------|
| `TRANSACTIONS` | Range (interval) | `posting_date` | Monthly |
| `ACCOUNTS` | List | `status` | — (Active, Dormant, Closed, Charged-Off) |
| `CUSTOMERS` | Hash | `customer_id` | 16 partitions |

### 7.2 Data Archival

Regulatory retention requirements (BSA/AML: 7 years; SEC 17a-4: 6 years) mandate long-term data preservation. The archival pipeline operates as follows:

1. **Monthly**, partitions older than 7 years are marked for archival.
2. **Oracle ILM (Information Lifecycle Management)** compresses the partition using Advanced Compression (HCC Query High).
3. **Export** — Data Pump exports the compressed partition to Azure Blob Storage (Archive tier) as an encrypted `.dmp` file.
4. **Verification** — A checksum comparison confirms integrity before the online partition is dropped.
5. **Catalog** — The archive manifest is registered in the Data Warehouse (Snowflake `ARCHIVE_CATALOG` table) for searchability.

Archived data can be restored to a staging Oracle instance within 4 hours to satisfy examiner or litigation-hold requests.

---

## 8. Performance Profile

| Metric | Value |
|--------|-------|
| Average daily transaction volume | ~2,000,000 |
| Peak daily transaction volume (month-end) | ~3,500,000 |
| API latency — p50 | < 50 ms |
| API latency — p99 | < 200 ms |
| EOD batch duration (typical) | ~3.5 hours |
| EOD batch duration (month-end) | ~4.5 hours |
| Active data volume | ~15 TB (Oracle) |
| Annual data growth | ~2.5 TB |
| HikariCP connection pool | 600 connections (across 12 replicas, 50 per pod) |
| JVM heap per pod | 4 GB (G1GC, max pause target 200 ms) |

### 8.1 Connection Pool Configuration

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 50
      minimum-idle: 20
      idle-timeout: 300000      # 5 minutes
      max-lifetime: 1800000     # 30 minutes
      connection-timeout: 5000  # 5 seconds
      leak-detection-threshold: 60000
```

With 12 pod replicas, the total maximum connection count is **600** against the Oracle RAC cluster (300 per RAC node). Connection limits are coordinated with the DBA team to remain within Oracle's configured `PROCESSES` parameter.

---

## 9. Integration Points

| Target System | Direction | Pattern | Protocol | Key Details |
|--------------|-----------|---------|----------|-------------|
| **Payments Gateway** | Bidirectional | Sync + Async | REST (balance holds, account lookup) + Kafka (`payment-authorized`, `payment-settled`) | Core Banking posts debits/credits upon settlement confirmation |
| **Risk Engine** | Outbound (sync) | Synchronous | REST (HTTPS) | < 100 ms SLA; called during account opening and transaction screening |
| **Regulatory Reporting** | Outbound | Database Link | Oracle DB Link (read-only against Data Guard standby) | Reporting queries isolated from production workload |
| **Wealth Mgmt Portal** | Inbound | Synchronous | REST (HTTPS) | Account balances, transaction history, profile data |
| **Data Warehouse** | Outbound | CDC | Oracle GoldenGate → Kafka → Snowflake Snowpipe | Near-real-time (< 15 min) change data capture for all core tables |

### 9.1 GoldenGate CDC Configuration

Oracle GoldenGate is configured to capture changes from the `CORE_BANKING` schema and publish them to Kafka topics in Avro format:

- **Extract process** reads the Oracle redo log in real time.
- **Replicat process** publishes change events to Kafka topics following the naming convention `cdc.core-banking.<table>`.
- **Schema evolution** is managed via Confluent Schema Registry with backward compatibility enforced.
- **Latency target:** p99 CDC latency < 15 minutes from Oracle commit to Snowflake availability.

---

## 10. Monitoring & Alerting

### 10.1 Key Dashboards (Datadog)

| Dashboard | Key Metrics |
|-----------|------------|
| Core Banking — API Health | Request rate, error rate, latency percentiles (p50/p95/p99), HTTP status distribution |
| Core Banking — Transaction Volume | Transactions per minute, by type, by channel; debit/credit balance |
| Core Banking — Batch Progress | Job status, step progress, chunk throughput, estimated completion time |
| Core Banking — Database | Active sessions, wait events, tablespace usage, Data Guard lag |

### 10.2 Alerting Thresholds (PagerDuty)

| Alert | Condition | Severity |
|-------|-----------|----------|
| API error rate > 1 % (5-min window) | Sustained HTTP 5xx rate | P2 |
| API p99 latency > 500 ms (5-min window) | Performance degradation | P3 |
| EOD batch not complete by 4:30 AM ET | Batch overrun | P1 |
| Data Guard apply lag > 30 seconds | DR readiness | P2 |
| HikariCP active connections > 90 % pool | Connection exhaustion risk | P3 |
| Reconciliation break > $10,000 | Financial discrepancy | P2 |

---

## 11. Document History

| Date | Author | Change |
|------|--------|--------|
| 2025-03-15 | Core Banking Engineering | Annual refresh; updated to Spring Boot 3.2, AKS 1.28 |
| 2024-10-01 | Core Banking Engineering | Added GoldenGate CDC integration details |
| 2024-06-15 | Core Banking Engineering | Updated Oracle schema DDL with partitioning |
| 2024-01-20 | Core Banking Engineering | Initial publication |
