---
title: "Risk Engine Platform"
---

<!-- title: Risk Engine Platform | last-updated: 2025-03-15 | owner: Acme Financial Services | status: current -->

# Risk Engine Platform

## Platform Overview

The Acme Financial Services Risk Engine is the centralized decisioning platform responsible for credit scoring, fraud detection, and anti-money laundering (AML) screening across all lending and deposit products. The platform processes over 1.2 million transactions daily with sub-100ms latency requirements for real-time fraud screening and delivers credit decisions within 2 seconds end-to-end.

### Technology Stack

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| API Layer | FastAPI | 0.104 | Async REST endpoints for risk decisioning |
| Runtime | Python | 3.11.7 | Core application runtime |
| Primary Database | PostgreSQL | 15.4 | Feature store, model metadata, decision logs |
| Message Broker | Kafka | 3.6 | Event streaming for real-time feature computation |
| ML Platform | MLflow | 2.10 | Experiment tracking, model registry, serving |
| Feature Processing | Apache Spark | 3.5 | Batch feature engineering pipelines |
| Stream Processing | Kafka Streams | 3.6 | Real-time velocity and behavioral features |
| Container Orchestration | AKS | 1.28 | Kubernetes cluster (prod-risk-aks-eastus2) |
| Monitoring | Datadog | — | APM, custom metrics, SLO dashboards |

### Team Structure

The Risk Engine team comprises 25 engineers organized into the following functional groups:

| Role | Headcount | Responsibilities |
|------|-----------|-----------------|
| ML Engineers | 8 | Model development, training pipelines, feature engineering, model validation |
| Backend Engineers | 7 | API development, system integration, performance optimization, infrastructure |
| Data Engineers | 5 | Data pipelines, feature store, batch processing, data quality monitoring |
| QA Engineers | 3 | Integration testing, regression suites, performance testing, chaos engineering |
| Model Validators | 2 | Independent model validation, regulatory compliance, backtesting, documentation |

**Service Tier:** Tier 1 — 99.95% availability SLA, 24/7 on-call rotation, 15-minute incident response.

---

## Credit Scoring

### Model Architecture

The production credit scoring model uses **XGBoost** (gradient boosted decision trees) trained on 10 years of historical loan performance data encompassing approximately 5 million loan observations. The model is retrained on a quarterly cadence with monthly monitoring checkpoints to detect performance degradation.

Training infrastructure runs on dedicated AKS node pools with GPU-enabled VMs (Standard_NC6s_v3) for hyperparameter optimization. The champion model is served via MLflow Model Serving behind the FastAPI gateway.

### Feature Categories

The model ingests approximately 180 features organized into the following categories:

| Category | Feature Count | Examples | Source |
|----------|--------------|----------|--------|
| Credit History | 42 | Payment history, delinquency counts, oldest account age, inquiries (6mo/12mo), utilization trend | Bureau (Experian, TransUnion, Equifax) |
| Income & Employment | 28 | Gross income, net income, employment tenure, income stability index, employer verification status | Application, payroll verification, IRS 4506-C |
| Debt Obligations | 31 | DTI ratio, revolving balance, installment balance, mortgage payment, contingent liabilities | Bureau, application |
| Assets & Collateral | 22 | Liquid assets, retirement accounts, real estate equity, LTV ratio, collateral valuation delta | Application, appraisal, account aggregation |
| Application Attributes | 18 | Loan purpose, requested amount, term, channel (branch/digital/partner), time-on-page | Application system |
| Behavioral | 39 | Transaction velocity, deposit patterns, account tenure, product cross-sell depth, digital engagement score | Core banking, digital analytics |

### Model Output

Each credit scoring request returns a structured decision payload:

- **Credit Score**: Normalized score on a 300–850 scale, mapped to internal risk grades (A1–E5)
- **Probability of Default (PD)**: Calibrated 12-month default probability expressed as a percentage
- **Risk Drivers**: Top 5 contributing factors ranked by SHAP importance values, with consumer-friendly reason codes (per FCRA adverse action requirements)
- **Decision**: Approve, refer, decline, or counteroffer with recommended terms

### Fair Lending Compliance

All credit models comply with the **Equal Credit Opportunity Act (ECOA)** and **Regulation B** requirements:

- **Prohibited Variables**: Race, color, religion, national origin, sex, marital status, age (except as permitted by ECOA), and public assistance status are excluded from model inputs and feature derivation.
- **Disparate Impact Testing**: Quarterly adverse impact ratio analysis across all protected classes. Models must demonstrate that any observed disparities are justified by legitimate business necessity and that no less discriminatory alternative achieves comparable predictive performance.
- **Fair Lending Review Board**: New models and material changes require sign-off from the Fair Lending Officer, Chief Risk Officer, and Legal Counsel before production deployment.
- **Adverse Action Notices**: Automated generation of reason codes mapped to FCRA-compliant explanations, delivered within 30 days of adverse decision.

---

## Fraud Detection

### Architecture

The fraud detection subsystem operates as a **real-time scoring pipeline** with strict latency requirements of under 100 milliseconds per transaction. The system processes over 1.2 million transactions daily across all channels (ACH, wire, card-present, card-not-present, P2P, mobile deposit).

The scoring architecture uses a two-layer **ensemble approach**:

1. **Rule Engine**: Approximately 200 deterministic rules maintained by the Financial Crimes Unit. Rules cover velocity checks, geographic anomalies, known fraud patterns, device fingerprinting mismatches, and merchant category restrictions. Rules are versioned in Git and deployed via CI/CD with a mandatory 48-hour staging validation period.

2. **ML Layer — Isolation Forest**: An unsupervised anomaly detection model trained on 18 months of transaction data. The model identifies outlier transactions based on deviation from established customer behavioral profiles. Retrained monthly with weekly monitoring.

The **ensemble scoring** function combines rule engine flags and ML anomaly scores using a weighted aggregation, calibrated to produce a unified fraud probability score (0–100).

### Alert Workflow

| Score Range | Risk Level | Action | SLA |
|-------------|-----------|--------|-----|
| 0–30 | Low | Log and pass — no analyst review required | N/A |
| 31–60 | Medium | Queue for batch review — next business day analyst triage | 24 hours |
| 61–80 | High | Real-time alert — immediate analyst review, transaction held pending decision | 2 hours |
| 81–100 | Critical | Auto-block transaction, push alert to senior analyst and team lead, customer contact initiated | 30 minutes |

### Analyst Workflow

Fraud analysts interact with flagged transactions through the **Fraud Operations Console** (internal React application). The workflow proceeds as follows:

1. **Case Assignment**: Alerts are routed based on transaction type, dollar amount, and analyst specialization. Load balancing ensures equitable distribution across the 14-person analyst team.
2. **Investigation**: Analyst reviews transaction context, customer history, device telemetry, and behavioral patterns. The console surfaces related alerts and historical cases for the same customer or counterparty.
3. **Disposition**: Analyst marks the case as confirmed fraud, false positive, or escalation (to BSA/AML team if suspicious activity indicators are present).
4. **Feedback Loop**: Disposition labels are fed back into the ML training pipeline to continuously improve model accuracy.

### Performance Metrics

| Metric | Target | Current (Q4 2024) |
|--------|--------|--------------------|
| True Positive Rate (TPR) | > 92% | 94.1% |
| False Positive Rate (FPR) | < 3% | 2.4% |
| P95 Latency | < 100ms | 67ms |
| Mean Time to Disposition (High) | < 2 hours | 1.3 hours |
| Model AUC-ROC | > 0.95 | 0.967 |

---

## AML Screening

### Sanctions & Watchlist Screening

The platform integrates with **Refinitiv World-Check One** for comprehensive sanctions and watchlist screening. Screening occurs at the following touchpoints:

- **Customer onboarding** (CIP/KYC)
- **Wire transfers** (originator and beneficiary)
- **ACH origination** (batch pre-screening)
- **Periodic rescreening** (daily delta, full portfolio quarterly)

Watchlist coverage includes:

| List | Source | Update Frequency |
|------|--------|-----------------|
| OFAC SDN / SSI / Non-SDN | U.S. Treasury | Daily |
| EU Consolidated Sanctions | European Commission | Daily |
| PEP Database | Refinitiv | Continuous |
| Adverse Media | Refinitiv | Continuous |
| UN Security Council | United Nations | As published |
| HMT (UK) | HM Treasury | Daily |

### Ongoing Transaction Monitoring

The AML transaction monitoring system analyzes customer activity patterns to detect behaviors indicative of money laundering, terrorist financing, or other financial crimes:

- **Structuring Detection**: Identification of transactions structured to evade the $10,000 CTR reporting threshold. Pattern analysis across rolling 1-day, 7-day, and 30-day windows per customer.
- **Layering Detection**: Complex fund movement patterns involving rapid transfers between accounts, jurisdictions, or institutions designed to obscure the origin of funds.
- **Geographic Risk Scoring**: Transactions involving FATF-identified high-risk and non-cooperative jurisdictions receive elevated scrutiny. Country risk scores are updated quarterly per FATF mutual evaluation results.
- **Unusual Activity Profiles**: Deviation from established customer baseline activity using statistical z-score and peer group comparison models.

### Regulatory Filings

| Filing | Trigger | Deadline | Destination |
|--------|---------|----------|-------------|
| Currency Transaction Report (CTR) | Cash transactions > $10,000 (aggregate daily) | 15 calendar days | FinCEN via BSA E-Filing |
| Suspicious Activity Report (SAR) | Suspicious transactions ≥ $5,000 (or $2,000 for insider abuse) | 30 calendar days from detection | FinCEN via BSA E-Filing |

All AML records, including screening results, investigation notes, and filed reports, are retained for a minimum of **5 years** from the date of filing per BSA/AML record retention requirements (31 CFR § 1010.430).

---

## Model Governance

### MLflow Integration

The Risk Engine uses **MLflow** as the centralized ML lifecycle management platform:

- **Experiment Tracking**: All training runs log hyperparameters, metrics (AUC, KS statistic, Gini coefficient, PSI), and artifacts. Experiments are organized by model type and business use case.
- **Model Versioning**: Every trained model artifact is versioned with full reproducibility metadata including training data snapshot hash, feature schema version, and Python dependency lockfile.
- **Model Registry**: Production models are promoted through a staged registry workflow: `None → Staging → Production → Archived`. Stage transitions require approval from the model owner and an independent validator.

### Challenger/Champion Framework

New model versions are deployed as **challenger models** running in shadow mode alongside the production champion. The challenger receives live traffic for scoring but its decisions are not actioned. After a minimum 30-day observation period, performance comparison determines whether the challenger is promoted:

- Statistical significance testing (two-sided KS test, p < 0.01)
- Business metric comparison (approval rate, loss rate, revenue impact)
- Fair lending impact assessment
- Model Risk Management (MRM) review and sign-off

### Regulatory Compliance

Model governance adheres to **SR 11-7** (Federal Reserve Supervisory Guidance on Model Risk Management) and **OCC Bulletin 2011-12**:

| Requirement | Implementation | Frequency |
|-------------|---------------|-----------|
| Independent Validation | Dedicated model validation team (reports to CRO, not model developers) | Every new model, material change |
| Backtesting | Comparison of predicted vs. actual outcomes across all risk segments | Monthly |
| Annual Revalidation | Full model review including conceptual soundness, ongoing monitoring results, and outcomes analysis | Annual |
| Model Inventory | Centralized registry with risk tier, owner, validation status, next review date | Continuous (updated real-time) |

### Drift Detection

Production models are continuously monitored for data and concept drift:

- **Population Stability Index (PSI)**: Measures distributional shift in input features and model scores relative to the training population. Alert threshold: PSI > 0.10 (warning), PSI > 0.25 (critical — triggers mandatory retraining review).
- **Kullback-Leibler (KL) Divergence**: Information-theoretic measure of distributional divergence for individual features. Used to identify which specific features are driving population shifts.
- **Performance Monitoring**: Realized default rates are compared against predicted PD bands on a monthly cohort basis. Deviation beyond ±15% of expected triggers a model performance review.

---

## Feature Engineering

### Batch Processing

The batch feature engineering pipeline runs nightly on **Apache Spark 3.5** clusters provisioned on AKS. The pipeline computes approximately **300 features** per customer per execution cycle:

- **Execution Window**: 01:00–04:00 ET daily
- **Input Sources**: Core banking (Oracle CDC), bureau data (SFTP batch), transaction history (Kafka topic replay)
- **Output**: Materialized feature vectors written to the PostgreSQL feature store
- **Compute**: 8-node Spark cluster (Standard_E16s_v5), auto-scaling to 16 nodes during month-end processing

### Real-Time Features

Real-time features are computed using **Kafka Streams** applications consuming from transaction event topics:

- **Velocity Features**: Transaction count and amount aggregations over sliding windows (1hr, 6hr, 24hr, 7d, 30d) per customer, per channel, per merchant category
- **Session Features**: Device fingerprint consistency, geolocation velocity (impossible travel detection), behavioral biometrics score

### Feature Store

The PostgreSQL-based feature store provides **point-in-time correct** feature retrieval to prevent data leakage during model training:

- **Schema**: Versioned feature tables with effective timestamps enabling temporal joins
- **Serving**: Read replicas dedicated to online serving with connection pooling (PgBouncer, 200 max connections)
- **Lineage**: Feature definitions are tracked in a metadata catalog with full upstream lineage to source systems, transformation logic (Git SHA), and downstream model dependencies

---

## API Contracts

### Credit Score Request

```
POST /risk/credit-score
Content-Type: application/json
Authorization: Bearer {service-token}
X-Request-ID: {uuid}
X-Correlation-ID: {uuid}
```

**Request Body:**

```json
{
  "application_id": "APP-2025-0319-00847",
  "customer_id": "CUST-10482937",
  "product_type": "UNSECURED_PERSONAL",
  "requested_amount": 25000.00,
  "requested_term_months": 60,
  "purpose": "DEBT_CONSOLIDATION",
  "channel": "DIGITAL",
  "consent_timestamp": "2025-03-15T14:22:31Z",
  "bureau_pull_authorized": true
}
```

**Response:**

```json
{
  "request_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "application_id": "APP-2025-0319-00847",
  "score": 724,
  "risk_grade": "B2",
  "probability_of_default": 0.034,
  "decision": "APPROVE",
  "recommended_terms": {
    "approved_amount": 25000.00,
    "interest_rate": 8.49,
    "term_months": 60,
    "monthly_payment": 512.37
  },
  "risk_drivers": [
    {"rank": 1, "code": "RD14", "description": "Length of credit history below peer median"},
    {"rank": 2, "code": "RD07", "description": "Revolving utilization above 45%"},
    {"rank": 3, "code": "RD22", "description": "Recent credit inquiries in last 6 months"},
    {"rank": 4, "code": "RD03", "description": "Limited diversity of credit account types"},
    {"rank": 5, "code": "RD31", "description": "Debt-to-income ratio above threshold"}
  ],
  "model_version": "credit-xgb-v4.2.1",
  "scored_at": "2025-03-15T14:22:32.187Z"
}
```

### Fraud Screening Request

```
POST /risk/fraud-screen
Content-Type: application/json
Authorization: Bearer {service-token}
X-Request-ID: {uuid}
```

**Request Body:**

```json
{
  "transaction_id": "TXN-20250315-1422-98761",
  "customer_id": "CUST-10482937",
  "transaction_type": "ACH_DEBIT",
  "amount": 4750.00,
  "currency": "USD",
  "counterparty": {
    "name": "Consolidated Payments LLC",
    "routing_number": "021000021",
    "account_last4": "8832"
  },
  "channel": "ONLINE_BANKING",
  "device": {
    "fingerprint": "fp_8a3b2c1d4e5f",
    "ip_address": "198.51.100.42",
    "user_agent": "Mozilla/5.0"
  },
  "timestamp": "2025-03-15T14:22:33Z"
}
```

**Response:**

```json
{
  "transaction_id": "TXN-20250315-1422-98761",
  "fraud_score": 22,
  "risk_level": "LOW",
  "action": "PASS",
  "rule_flags": [],
  "ml_anomaly_score": 0.18,
  "evaluation_time_ms": 43,
  "model_version": "fraud-iforest-v2.8.0",
  "evaluated_at": "2025-03-15T14:22:33.043Z"
}
```

### AML Check Request

```
POST /risk/aml-check
Content-Type: application/json
Authorization: Bearer {service-token}
X-Request-ID: {uuid}
```

**Request Body:**

```json
{
  "check_type": "TRANSACTION_SCREENING",
  "customer_id": "CUST-10482937",
  "transaction_id": "TXN-20250315-1422-98761",
  "parties": [
    {
      "role": "ORIGINATOR",
      "name": "Jane M. Whitfield",
      "date_of_birth": "1983-06-14",
      "country": "US",
      "id_type": "SSN_LAST4",
      "id_value": "6721"
    },
    {
      "role": "BENEFICIARY",
      "name": "Consolidated Payments LLC",
      "country": "US",
      "entity_type": "BUSINESS",
      "registration_number": "EIN-82-1234567"
    }
  ],
  "transaction": {
    "amount": 4750.00,
    "currency": "USD",
    "type": "ACH_DEBIT",
    "originating_country": "US",
    "destination_country": "US"
  }
}
```

**Response:**

```json
{
  "check_id": "AML-20250315-0047821",
  "transaction_id": "TXN-20250315-1422-98761",
  "overall_risk": "LOW",
  "screening_results": {
    "ofac_match": false,
    "pep_match": false,
    "adverse_media_match": false,
    "sanctions_match": false
  },
  "monitoring_flags": [],
  "geographic_risk": "LOW",
  "ctr_required": false,
  "sar_recommended": false,
  "screening_provider": "REFINITIV_WORLD_CHECK",
  "screening_version": "2025.03.14",
  "checked_at": "2025-03-15T14:22:33.112Z"
}
```

---

## Operational Runbooks

For operational procedures, incident response, and troubleshooting guides, refer to:

- [Risk Engine Runbook](../runbooks/risk-engine-runbook.md)
- [Model Deployment Playbook](../runbooks/model-deployment.md)
- [Fraud Alert Escalation Procedures](../runbooks/fraud-escalation.md)
- [AML Filing Procedures](../runbooks/aml-filing.md)

## Contact

- **Platform Owner**: Risk Engineering — `risk-engineering@acmefinancial.com`
- **On-Call**: PagerDuty service `risk-engine-prod` (Tier 1 rotation)
- **Slack**: `#risk-engine-support` (general), `#risk-engine-incidents` (P1/P2)
- **Model Governance**: Model Risk Management Office — `mrm-office@acmefinancial.com`
