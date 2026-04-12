---
title: "System Landscape"
---

<!-- title: System Landscape | last-updated: 2025-03-15 | owner: Acme Financial Services | status: current -->

# Acme Financial Services — System Landscape

## 1. Overview

Acme Financial Services operates a portfolio of six mission-critical systems that collectively support retail banking, commercial banking, payments processing, risk management, regulatory compliance, wealth management, and enterprise analytics. This document provides a comprehensive inventory of these systems, their interdependencies, third-party integrations, infrastructure topology, and engineering team structure.

All systems are hosted on Microsoft Azure within a private Virtual Network hub-spoke architecture connected to on-premises data centers via ExpressRoute. Production workloads run across the East US (primary) and West US 2 (disaster recovery) regions under an active-passive DR strategy unless otherwise noted below.

---

## 2. System Inventory

| # | System | Primary Stack | Database | Team Size | Year Launched | SLA Tier | DR Strategy |
|---|--------|---------------|----------|-----------|---------------|----------|-------------|
| 1 | Core Banking Platform | Java 17 / Spring Boot 3.2 | Oracle 19c RAC (2-node) | 45 engineers | 2008 | Tier 1 — 99.95 % | Active-passive (Data Guard) |
| 2 | Payments Gateway | Java 17 / Spring Boot 3.2, Kafka 3.6 | PostgreSQL 15, Redis 7 | 30 engineers | 2019 | Tier 1 — 99.99 % | Active-passive (streaming replication + geo-replicated Redis) |
| 3 | Risk Engine | Python 3.11 / FastAPI | PostgreSQL 15 | 25 engineers | 2021 | Tier 2 — 99.9 % | Active-passive (PostgreSQL logical replication) |
| 4 | Regulatory Reporting | Java 17 / Spring Batch 5 | Oracle 19c (shared with Core Banking) | 10 engineers (shared) | 2015 | Tier 2 — 99.9 % | Active-passive (Data Guard, shared instance) |
| 5 | Wealth Management Portal | React 18, Node.js 20 (BFF) | MongoDB 7 (Atlas) | 20 engineers | 2022 | Tier 2 — 99.9 % | Multi-region Atlas cluster (East US / West US 2) |
| 6 | Data Warehouse & Analytics | Airflow 2.8, dbt 1.7 | Snowflake (Enterprise) | 15 engineers | 2020 | Tier 3 — 99.5 % | Snowflake cross-region failover group |

---

## 3. System Descriptions

### 3.1 Core Banking Platform

The Core Banking Platform is the system of record for all customer accounts, balances, and general-ledger postings. Originally deployed in 2008 on a monolithic J2EE stack, the platform was incrementally re-architected between 2020 and 2023 onto Java 17 and Spring Boot 3.2, retaining Oracle 19c RAC as the persistence layer to preserve transactional integrity guarantees required by federal regulators.

- **Purpose:** Account lifecycle management, double-entry transaction posting, interest accrual, statement generation, GL sub-ledger reconciliation.
- **SLA Tier:** Tier 1 — 99.95 % monthly uptime, with a Recovery Time Objective (RTO) of 30 minutes and Recovery Point Objective (RPO) of zero (synchronous Data Guard).
- **DR Strategy:** Active-passive across East US and West US 2. Oracle Data Guard provides synchronous redo-log shipping. Automated failover is orchestrated via custom runbooks in Azure Automation. Full DR drills are executed quarterly.

### 3.2 Payments Gateway

The Payments Gateway handles all payment origination, authorization, clearing, and settlement for card (Visa / Mastercard acquiring and issuing), ACH, Fedwire, SWIFT, SEPA, and FedNow receive-only transactions.

- **Purpose:** Real-time payment authorization, fraud pre-screening, clearing file generation, settlement reconciliation, and chargeback/dispute processing.
- **SLA Tier:** Tier 1 — 99.99 % monthly uptime (approximately 4.3 minutes of tolerated downtime per month). RTO 10 minutes, RPO < 1 second.
- **DR Strategy:** Active-passive with PostgreSQL streaming replication to West US 2. Redis is geo-replicated via Azure Cache for Redis Enterprise. Kafka MirrorMaker 2 replicates topics to the DR cluster on a best-effort basis. Failover is semi-automated and validated monthly.

### 3.3 Risk Engine

The Risk Engine provides near-real-time credit risk scoring, AML/KYC screening, fraud detection, and market risk calculation for the trading desk.

- **Purpose:** Transaction-level risk scoring (< 100 ms SLA), customer onboarding screening, continuous due-diligence monitoring, batch portfolio risk aggregation.
- **SLA Tier:** Tier 2 — 99.9 % monthly uptime. RTO 1 hour, RPO 5 minutes.
- **DR Strategy:** Active-passive with PostgreSQL logical replication. ML model artifacts are stored in Azure Blob Storage with geo-redundant storage (GRS).

### 3.4 Regulatory Reporting

Regulatory Reporting consolidates data from Core Banking, Payments, and Risk to produce mandated filings: Call Reports (FFIEC 031/041), FR Y-9C, CCAR/DFAST stress-testing submissions, SARs, CTRs, and FATCA/CRS reports.

- **Purpose:** Scheduled and ad-hoc regulatory report generation, data quality validation, submission packaging, and audit-trail retention.
- **SLA Tier:** Tier 2 — 99.9 % monthly uptime. Reporting deadlines are the binding SLA; batch jobs must complete within defined windows.
- **DR Strategy:** Shares the Core Banking Oracle Data Guard instance. Spring Batch job metadata is persisted in the same Oracle schema, enabling restart-from-last-checkpoint after a failover.

### 3.5 Wealth Management Portal

The Wealth Management Portal is a customer- and advisor-facing single-page application for portfolio management, financial planning, and investment order execution.

- **Purpose:** Portfolio visualization, model portfolio allocation, trade order capture, advisor CRM, customer self-service.
- **SLA Tier:** Tier 2 — 99.9 % monthly uptime. RTO 30 minutes, RPO 1 minute.
- **DR Strategy:** MongoDB Atlas multi-region cluster with automated failover. The React SPA is served from Azure CDN with a global anycast endpoint.

### 3.6 Data Warehouse & Analytics

The Data Warehouse ingests data from all upstream systems and provides a curated analytical layer for business intelligence, regulatory analytics, and machine-learning feature engineering.

- **Purpose:** Enterprise data consolidation, dimensional modeling, self-service analytics (Tableau / Power BI), ML feature store, regulatory data marts.
- **SLA Tier:** Tier 3 — 99.5 % monthly uptime. Data freshness SLA: CDC streams arrive within 15 minutes; batch loads complete by 06:00 ET.
- **DR Strategy:** Snowflake cross-region failover group between East US and West US 2. Airflow metadata is backed up to Azure Blob Storage GRS.

---

## 4. System Dependency Map

The diagram below describes the primary communication patterns between systems. Communication types are classified as synchronous REST, asynchronous Kafka, batch file/process, or database link.

```
                          ┌──────────────────────────┐
                          │   Wealth Mgmt Portal     │
                          │  (React 18 / Node.js 20) │
                          └──────────┬───────────────┘
                                     │ REST (HTTPS)
                          ┌──────────▼───────────────┐
                          │   Core Banking Platform   │◄──── DB Link ────┐
                          │   (Java 17 / Oracle 19c)  │                  │
                          └──┬──────────┬─────────────┘                  │
                  REST+Kafka │          │ REST (<100ms)        ┌─────────┴──────────┐
                 ┌───────────▼──┐  ┌────▼──────────┐          │ Regulatory Reporting│
                 │  Payments    │  │  Risk Engine   │          │ (Spring Batch /     │
                 │  Gateway     │  │  (FastAPI)     │          │  Oracle 19c shared) │
                 │  (Kafka 3.6) │  └────────────────┘          └────────────────────┘
                 └──────┬───────┘          │ Kafka                      │ Batch
                        │ Kafka            │                            │
                 ┌──────▼──────────────────▼────────────────────────────▼──┐
                 │               Data Warehouse (Snowflake)                │
                 │          Airflow 2.8 / dbt 1.7 / GoldenGate CDC        │
                 └─────────────────────────────────────────────────────────┘
```

### Communication Pattern Details

| Source | Target | Pattern | Protocol / Mechanism | Notes |
|--------|--------|---------|----------------------|-------|
| Core Banking | Payments Gateway | Sync + Async | REST (HTTPS) for balance holds; Kafka `payment-authorized` topic for settlement confirmation | Two-phase commit not used; compensating transactions handle failures |
| Core Banking | Risk Engine | Synchronous | REST (HTTPS) | < 100 ms response SLA for real-time transaction screening |
| Core Banking | Regulatory Reporting | Database Link | Oracle DB Link (read-only) | Reporting queries run against a read-replica standby to avoid production load |
| Core Banking | Wealth Mgmt Portal | Synchronous | REST (HTTPS) | BFF aggregates Core Banking and market-data APIs |
| Core Banking | Data Warehouse | CDC | Oracle GoldenGate → Kafka → Snowflake Snowpipe | Near-real-time (< 15 min latency) |
| Payments Gateway | Data Warehouse | Async | Kafka topics mirrored to Snowflake via Kafka Connect (Snowflake Sink) | Settlement and authorization events |
| Risk Engine | Data Warehouse | Async | Kafka `risk-score-computed` topic | Scores and screening results |
| Regulatory Reporting | Data Warehouse | Batch | Airflow-orchestrated dbt models pull from Oracle + Snowflake | Nightly and ad-hoc |
| Wealth Mgmt Portal | Core Banking | Synchronous | REST (HTTPS) | Trade orders, account inquiries |
| Payments Gateway | Risk Engine | Synchronous | REST (HTTPS) | Pre-authorization fraud/AML check (< 100 ms) |

---

## 5. Third-Party Integrations

| Vendor / Service | Product | Integration Type | Consuming System(s) | Purpose |
|------------------|---------|------------------|----------------------|---------|
| Bloomberg | B-PIPE (real-time market data) | TCP/IP socket, proprietary API | Wealth Mgmt Portal, Risk Engine | Real-time pricing, reference data, analytics |
| SWIFT | Alliance Lite2 | SWIFT FileAct / FIN (MT/MX) | Payments Gateway | Cross-border wire transfers, correspondent banking messages (MT103, MT202, MT940) |
| Experian | PowerCurve, Precise ID | REST API (TLS 1.3) | Risk Engine | Credit bureau pulls, identity verification |
| Equifax | Interconnect, The Work Number | REST API (TLS 1.3) | Risk Engine | Credit bureau pulls, income/employment verification |
| Refinitiv (LSEG) | World-Check One | REST API | Risk Engine, Payments Gateway | Sanctions and PEP screening |
| Visa | VisaNet (Base II / TC files) | ISO 8583 via payment processor | Payments Gateway | Card authorization, clearing, settlement |
| Mastercard | Banknet | ISO 8583 via payment processor | Payments Gateway | Card authorization, clearing, settlement |

---

## 6. Technology Stack Summary

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Languages | Java | 17 (LTS) | Core Banking, Payments, Regulatory Reporting |
| | Python | 3.11 | Risk Engine, Data pipelines |
| | TypeScript | 5.3 | Wealth Mgmt Portal (React + Node.js BFF) |
| | SQL / PL/SQL | — | Stored procedures, analytics |
| Frameworks | Spring Boot | 3.2 | REST APIs, batch processing |
| | FastAPI | 0.109 | Risk Engine API |
| | React | 18 | Wealth Mgmt Portal SPA |
| | Node.js | 20 (LTS) | Wealth Mgmt Portal BFF |
| | dbt | 1.7 | Data transformation |
| Messaging | Apache Kafka | 3.6 (Confluent Platform 7.6) | Event streaming, CDC delivery |
| Databases | Oracle | 19c RAC | Core Banking, Regulatory Reporting |
| | PostgreSQL | 15 | Payments Gateway, Risk Engine |
| | Redis | 7 | Payments caching, idempotency store |
| | MongoDB | 7 (Atlas) | Wealth Mgmt Portal |
| | Snowflake | Enterprise | Data Warehouse |
| Orchestration | Apache Airflow | 2.8 | Data pipeline scheduling |
| Container Platform | AKS | 1.28 | All workloads |
| Service Mesh | Istio | 1.20 | mTLS, traffic management |
| GitOps | ArgoCD | 2.10 | Continuous deployment |
| CI/CD | GitHub Actions | — | Build, test, security scanning |
| Monitoring | Datadog | — | APM, logs, dashboards, SLOs |
| Alerting | PagerDuty | — | Incident management |
| Secrets | Azure Key Vault + HashiCorp Vault | — | Secret management, PKI |
| IaC | Terraform | 1.7 | Infrastructure provisioning |

---

## 7. Infrastructure Overview

### 7.1 Azure Topology

All workloads run within a **private Virtual Network (VNet) hub-spoke** architecture:

- **Hub VNet** — Shared services: Azure Firewall, Bastion, DNS Private Resolver, ExpressRoute Gateway.
- **Spoke VNets** — One per environment (Prod, UAT, Staging, Dev) with VNet peering to the hub.
- **ExpressRoute** — Dedicated 10 Gbps circuit connecting Azure to the Acme corporate data center for access to on-premises Active Directory, legacy mainframe systems, and SWIFT Alliance Lite2 appliances.

### 7.2 PCI-DSS Segment

The Payments Gateway and related card-processing components are deployed within a **dedicated PCI-DSS Cardholder Data Environment (CDE)**:

- Isolated AKS node pool with Calico network policies restricting ingress/egress to approved endpoints only.
- **Hardware Security Modules (HSMs):** Azure Dedicated HSM (Thales Luna 7), FIPS 140-2 Level 3 validated, used for card encryption key management (BYOK), PIN translation, and tokenization.
- Quarterly ASV (Approved Scanning Vendor) scans and annual penetration tests performed by an independent QSA.

### 7.3 Disaster Recovery

| Aspect | Detail |
|--------|--------|
| Primary Region | East US |
| DR Region | West US 2 |
| Strategy | Active-passive for all Tier 1 and Tier 2 systems |
| RTO (Tier 1) | ≤ 30 minutes |
| RPO (Tier 1) | Zero (synchronous replication) |
| DR Drills | Quarterly full-failover exercises; results reported to the Board Risk Committee |

### 7.4 Environments

| Environment | Purpose | Refresh Cadence | Data |
|-------------|---------|-----------------|------|
| **Production** | Live customer traffic | — | Real customer data (PII/PCI controls enforced) |
| **UAT** | Business acceptance testing, regulatory dry-runs | Refreshed from Prod monthly (tokenized) | Masked/tokenized copy of Prod |
| **Staging** | Pre-production release validation, performance testing | Refreshed from Prod weekly (tokenized) | Masked/tokenized copy of Prod |
| **Dev** | Feature development, integration testing | Seeded from fixtures | Fully anonymized reference data set |

---

## 8. Engineering Team Structure

| Team | System Ownership | Headcount | Reporting Line |
|------|-----------------|-----------|----------------|
| Core Banking Engineering | Core Banking Platform | 45 | VP Engineering — Banking |
| Payments Engineering | Payments Gateway | 30 | VP Engineering — Payments |
| Risk & Compliance Engineering | Risk Engine | 25 | VP Engineering — Risk |
| Regulatory Technology | Regulatory Reporting | 10 | VP Engineering — Risk (shared) |
| Wealth Digital | Wealth Management Portal | 20 | VP Engineering — Wealth |
| Data Platform | Data Warehouse & Analytics | 15 | VP Engineering — Data |
| **Total** | | **~145** | |

Each team operates with embedded SRE and QA engineers. Cross-cutting functions — architecture, security engineering, and platform engineering (Kubernetes, CI/CD, observability) — are organized as a shared **Platform & Security** guild that provides tooling, guardrails, and consultative support to product teams.

---

## 9. Document History

| Date | Author | Change |
|------|--------|--------|
| 2025-03-15 | Platform Architecture | Initial publication |
| 2025-01-10 | Platform Architecture | Added FedNow receive-only capability to Payments Gateway |
| 2024-09-22 | Data Platform | Updated Data Warehouse to Airflow 2.8 and dbt 1.7 |
| 2024-06-01 | Payments Engineering | Kafka upgrade to 3.6 (Confluent Platform 7.6) |
