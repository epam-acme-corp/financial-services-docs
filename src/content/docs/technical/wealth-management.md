---
title: "Wealth Management Portal"
---

<!-- title: Wealth Management Portal | last-updated: 2025-03-15 | owner: Acme Financial Services | status: current -->

# Wealth Management Portal

## Platform Overview

The Wealth Management Portal is the client-facing and advisor-facing digital platform supporting Acme Financial Services' wealth management and investment advisory business. The portal provides portfolio management, financial planning tools, secure client communications, and advisor productivity features for approximately 45,000 managed accounts representing over $18 billion in assets under management (AUM).

### Technology Stack

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Frontend | React | 18.2 | Single-page application with TypeScript 5.3 |
| BFF (Backend for Frontend) | Node.js | 20 LTS | API aggregation, session management, server-side rendering |
| Document Database | MongoDB | 7.0 | Client profiles, portfolios, documents, messaging |
| Cache | Redis | 7.2 | Session store, real-time market data cache, rate limiting |
| Market Data | Bloomberg B-PIPE | — | Real-time and reference data feeds |
| Search | Elasticsearch | 8.12 | Client search, document search, audit log indexing |
| Container Orchestration | AKS | 1.28 | Kubernetes cluster (prod-wealth-aks-eastus2) |
| CDN | Azure Front Door | — | Global content delivery, WAF, DDoS protection |
| Monitoring | Datadog | — | APM, RUM, uptime monitoring, SLO dashboards |

### Team & Service Tier

The platform is maintained by **20 engineers** (6 frontend, 5 backend, 3 mobile, 2 data, 2 QA, 1 security champion, 1 UX engineer). Service classification is **Tier 2** with a 99.9% availability SLA during market hours (9:30 AM – 4:00 PM ET, Mon–Fri).

---

## Portal Features

### Portfolio Dashboard

The portfolio dashboard provides clients and advisors with a consolidated, real-time view of investment holdings:

- **Real-Time Valuation**: Portfolio market value updated continuously during market hours via Bloomberg B-PIPE feed with sub-500ms latency. After-hours valuations use closing prices with clear timestamp indicators.
- **Asset Allocation**: Visual breakdown by asset class (equities, fixed income, alternatives, cash), geography, sector, and market capitalization. Actual allocation vs. target allocation comparison with drift indicators.
- **Performance Metrics**: Time-weighted return (TWR) and money-weighted return (MWR) calculations over configurable periods (MTD, QTD, YTD, 1yr, 3yr, 5yr, inception). Benchmark comparison against client-selected indices (S&P 500, Bloomberg Aggregate Bond, custom blended benchmarks).
- **Gain/Loss Summary**: Realized and unrealized gains with short-term/long-term classification, cost basis methods (specific lot, FIFO, average cost), and tax impact estimates.

### Asset Allocation Visualization

- **Interactive Charts**: Treemap and donut chart visualizations with drill-down capability from asset class → sector → individual holding
- **Risk Metrics**: Portfolio beta, standard deviation, Sharpe ratio, maximum drawdown, and Value at Risk (VaR) at 95% confidence interval displayed alongside allocation views
- **What-If Analysis**: Clients and advisors can model hypothetical allocation changes and preview projected risk/return impacts before executing trades

### Performance Analytics

- **Time-Weighted Return (TWR)**: Industry-standard performance measurement eliminating the impact of external cash flows, compliant with GIPS (Global Investment Performance Standards)
- **Money-Weighted Return (MWR)**: Internal rate of return reflecting the impact of client deposit and withdrawal timing
- **Attribution Analysis**: Return decomposition by asset allocation effect, security selection effect, and interaction effect relative to the benchmark
- **Fee Impact Reporting**: Gross vs. net performance comparison, fee breakdowns by type (advisory fee, fund expense ratios, transaction costs), cumulative fee impact over time

### Secure Messaging

- **End-to-End Encryption**: All messages between clients and advisors are encrypted in transit (TLS 1.3) and at rest (AES-256, MongoDB CSFLE for message body)
- **Compliance Archive**: All messages are retained for **7 years** per SEC Rule 17a-4 and FINRA Rule 4511 (books and records retention). Messages are immutable once sent and indexed for compliance search and supervisory review.
- **Attachment Support**: Secure file sharing with virus scanning (ClamAV), file type restrictions, and 25 MB size limit per attachment
- **Notification Preferences**: Configurable push notifications, email digests, and in-app alerts for new messages

### Document Vault

- **Role-Based Access**: Clients see their own documents; advisors see documents for clients in their book of business; compliance officers have full read access for supervisory purposes
- **Document Categories**: Account statements, tax documents (1099, K-1), trade confirmations, financial plans, compliance disclosures, signed agreements
- **Digital Signatures**: DocuSign integration for remote document execution (account opening forms, advisory agreements, beneficiary changes)
- **Version Control**: Document versions are tracked with full audit trail of uploads, views, and downloads

### Client Onboarding Wizard

The digital onboarding workflow guides new clients through account opening with integrated compliance checks:

1. **Identity Verification**: KYC (Know Your Customer) data collection with real-time identity verification via LexisNexis. AML screening via Risk Engine integration (see [Risk Engine — AML Screening](./risk-engine.md#aml-screening)).
2. **Risk Questionnaire**: Standardized risk tolerance assessment (10 questions) producing a risk score mapped to model portfolios (Conservative, Moderate Conservative, Moderate, Moderate Aggressive, Aggressive).
3. **Suitability Determination**: Automated suitability analysis comparing recommended portfolio to client risk profile, investment objectives, time horizon, liquidity needs, and tax situation per FINRA Rule 2111 and Regulation Best Interest (Reg BI).
4. **Document Execution**: Advisory agreement, account application, and disclosures presented for digital signature via DocuSign.
5. **Account Funding**: ACH linkage or wire instructions generated; initial funding tracked with automated follow-up reminders.

---

## Portfolio Management

### Bloomberg B-PIPE Integration

The platform consumes market data from **Bloomberg B-PIPE** (Bloomberg Professional Integrated Platform Enterprise) for real-time pricing, reference data, and historical time series:

- **Real-Time Feed**: Streaming quotes for approximately 12,000 securities (equities, ETFs, mutual funds, fixed income, options) covering client portfolio holdings. Target latency: **< 500ms** from Bloomberg tick to client-visible price update.
- **Reference Data**: Security master data (CUSIP, ISIN, SEDOL, security descriptions, classification codes, corporate actions) refreshed daily.
- **Historical Data**: End-of-day pricing and total return data for performance calculation, stored in MongoDB with date-partitioned collections.
- **Failover**: Primary feed from Bloomberg B-PIPE with secondary failover to Refinitiv Elektron. Feed health is monitored via Datadog with automated failover triggered after 30 seconds of stale data.
- **Cost Optimization**: Market data subscriptions are tiered by security type and usage. Subscription management is reviewed quarterly with the Bloomberg account team to align cost with actual coverage requirements.

### Portfolio Rebalancing

The rebalancing engine monitors portfolio drift and generates rebalancing recommendations:

- **Drift Threshold**: Rebalancing is triggered when any asset class allocation deviates more than **5%** from the target model allocation (configurable per client)
- **Tax-Aware Execution**: The rebalancing optimizer considers tax implications including short-term vs. long-term capital gains, tax lot selection, and wash sale avoidance
- **Model Alignment**: Rebalancing proposals align the portfolio to the assigned model while respecting client-specific constraints (ESG exclusions, concentrated positions, restricted securities)
- **Approval Workflow**: Rebalancing proposals are generated automatically but require advisor review and approval before trade execution. Bulk rebalancing across the advisor's book requires compliance pre-approval for trades exceeding $500,000 aggregate notional.

### Tax-Loss Harvesting Alerts

- **Automated Scanning**: Nightly batch scan of all taxable portfolios to identify positions with unrealized losses exceeding a configurable threshold (default: $1,000)
- **Wash Sale Detection**: Cross-account wash sale rule enforcement across all client accounts (individual, joint, IRA, trust) to prevent IRS disallowance under IRC Section 1091. The detection window covers 30 days before and after a sale.
- **Tax Benefit Calculation**: Estimated tax savings based on the client's marginal tax rate and applicable state tax rates
- **Advisor Notification**: Alerts delivered via the advisor dashboard and optional email digest, with one-click trade proposal generation

---

## Advisor Tools

### Client Book Management

- **AUM Tiers**: Clients segmented into service tiers (Ultra High Net Worth > $10M, High Net Worth $1M–$10M, Affluent $250K–$1M) with tier-specific SLAs for advisor responsiveness and review frequency
- **Household Grouping**: Related accounts grouped into households for consolidated reporting, household-level billing, and coordinated investment strategy
- **Next-Best-Action Engine**: ML-driven recommendations for client outreach based on life events (retirement approaching, large cash inflows, rebalancing opportunities, tax-loss harvesting windows, upcoming required minimum distributions)

### Proposal Generation

- **Monte Carlo Engine**: Retirement and goal-based planning with 10,000-iteration Monte Carlo simulation. Inputs include current portfolio, savings rate, time horizon, spending goals, Social Security, and pension estimates. Results presented as probability distributions with confidence intervals.
- **Compliance Review**: All proposals are logged for books and records compliance. Proposals recommending changes to the existing investment strategy require documented suitability justification.
- **Branded Output**: Client-facing proposals generated as branded PDF documents with customizable cover pages, charts, disclaimers, and advisor contact information.

### Compliance Pre-Clearance

- **Personal Trading**: All advisor personal securities transactions require pre-clearance through the compliance module. Requests are checked against the restricted list, client holdings (front-running prevention), and firm inventory.
- **Restricted List**: Centralized restricted securities list maintained by the Compliance department, updated in real-time based on material non-public information (MNPI) determinations, investment banking engagements, and research coverage.
- **Quarterly Reporting**: Advisors certify quarterly securities holdings and transaction reports per SEC Rule 204A-1 (Code of Ethics). Automated reconciliation against broker feeds flags discrepancies for compliance review.

---

## MongoDB Data Model

### Clients Collection

```json
{
  "_id": "client_10482937",
  "type": "INDIVIDUAL",
  "status": "ACTIVE",
  "name": {
    "first": "Jane",
    "middle": "M",
    "last": "Whitfield",
    "suffix": null
  },
  "contact": {
    "email": "j.whitfield@email.com",
    "phone": "+12125551234",
    "address": {
      "street1": "142 East 71st Street",
      "street2": "Apt 8B",
      "city": "New York",
      "state": "NY",
      "zip": "10021",
      "country": "US"
    }
  },
  "kyc": {
    "cip_verified": true,
    "cip_verified_date": "2021-04-15",
    "risk_rating": "STANDARD",
    "aml_last_screened": "2025-03-14",
    "pep_status": false,
    "beneficial_owners": []
  },
  "investment_profile": {
    "risk_tolerance": "MODERATE_AGGRESSIVE",
    "time_horizon": "10_PLUS_YEARS",
    "investment_objective": "GROWTH",
    "liquidity_needs": "LOW",
    "tax_bracket": "FEDERAL_35"
  },
  "advisor_id": "advisor_2847",
  "household_id": "hh_whitfield_2847",
  "service_tier": "HIGH_NET_WORTH",
  "created_at": "2021-04-15T10:30:00Z",
  "updated_at": "2025-03-10T16:45:22Z"
}
```

### Portfolios Collection

```json
{
  "_id": "portfolio_10482937_001",
  "client_id": "client_10482937",
  "account_type": "INDIVIDUAL_TAXABLE",
  "custodian": "PERSHING",
  "custodian_account_number_encrypted": "enc_v2:AES256:...",
  "model_id": "model_growth_aggressive",
  "holdings": [
    {
      "security_id": "AAPL",
      "cusip": "037833100",
      "quantity": 150,
      "cost_basis": 22875.00,
      "cost_basis_method": "SPECIFIC_LOT",
      "acquisition_date": "2022-08-15",
      "market_value": 26250.00,
      "weight": 0.0834,
      "unrealized_gain": 3375.00,
      "gain_term": "LONG_TERM"
    }
  ],
  "allocation": {
    "target": {"US_EQUITY": 0.45, "INTL_EQUITY": 0.20, "FIXED_INCOME": 0.25, "ALTERNATIVES": 0.05, "CASH": 0.05},
    "actual": {"US_EQUITY": 0.47, "INTL_EQUITY": 0.19, "FIXED_INCOME": 0.24, "ALTERNATIVES": 0.05, "CASH": 0.05},
    "max_drift": 0.05
  },
  "performance": {
    "ytd_twr": 0.0412,
    "1yr_twr": 0.1187,
    "inception_twr": 0.0923,
    "inception_date": "2021-05-01"
  },
  "market_value_total": 314750.00,
  "as_of_date": "2025-03-14",
  "updated_at": "2025-03-14T20:15:00Z"
}
```

### Indexing Strategy

| Collection | Index | Type | Purpose |
|-----------|-------|------|---------|
| clients | `{ advisor_id: 1, service_tier: 1 }` | Compound | Advisor book-of-business queries |
| clients | `{ household_id: 1 }` | Single | Household grouping lookups |
| clients | `{ "name.last": 1, "name.first": 1 }` | Compound | Client search |
| portfolios | `{ client_id: 1, account_type: 1 }` | Compound | Client portfolio retrieval |
| portfolios | `{ "holdings.security_id": 1 }` | Multikey | Security-level position queries |
| messages | `{ participants: 1, created_at: -1 }` | Compound | Message thread listing |

**Read Preference**: Secondary preferred for reporting and analytics queries; primary for transactional operations (trade execution, onboarding).

**Client-Side Field-Level Encryption (CSFLE)**: Sensitive fields are encrypted using MongoDB CSFLE with AWS KMS-managed data encryption keys:
- `contact.ssn` (deterministic — enables equality queries for CIP verification)
- `custodian_account_number_encrypted` (random — no query requirement)
- Message body content in the `messages` collection (random)

---

## Security

### Authentication & Authorization

| Aspect | Implementation |
|--------|---------------|
| Client Authentication | OAuth 2.0 / OpenID Connect via **Azure AD B2C**; social identity providers (Google, Apple) supported for initial registration with step-up to verified identity |
| Advisor Authentication | OAuth 2.0 / OpenID Connect via **Azure AD** (corporate directory); conditional access policies enforce managed device and compliant network requirements |
| Multi-Factor Authentication | Required for all users — TOTP (authenticator app), FIDO2 security keys for advisors, SMS as fallback (clients only, planned deprecation Q3 2025) |
| Session Management | 15-minute inactivity timeout; absolute session lifetime of 8 hours; sessions stored in Redis with secure, HttpOnly, SameSite=Strict cookies |
| API Authentication | OAuth 2.0 bearer tokens (JWT) with 15-minute expiry; refresh tokens (24-hour expiry, single-use rotation) |

### Role-Based Access Control (RBAC)

| Role | Permissions |
|------|------------|
| Client | View own portfolio, performance, documents; send/receive messages with assigned advisor; execute document signatures; manage notification preferences |
| Advisor | View/manage assigned client portfolios; generate proposals; execute trades (within approval limits); view household accounts; access advisor tools |
| Compliance Officer | Read-only access to all client data, messages, and documents for supervisory review; manage restricted list; review pre-clearance requests; access audit logs |
| Admin | User provisioning, role assignment, system configuration, feature flag management; no direct access to client financial data (separation of duties) |

### Data Protection

- **SOC 2 Type II**: Annual audit covering Security, Availability, and Confidentiality trust service criteria. Most recent report: Q4 2024 (no exceptions noted).
- **TLS 1.3**: Enforced for all client-facing and internal API connections. TLS 1.2 accepted for legacy integrations with deprecation timeline (end of Q2 2025).
- **No PII in Logs**: Application logging configuration strips all PII (names, SSNs, account numbers, email addresses) before log ingestion. Datadog log pipelines include secondary PII detection rules as a safety net.
- **Data Classification**: All data elements are classified per the enterprise data classification policy (Public, Internal, Confidential, Restricted). Portfolio holdings and financial data are classified as **Confidential**; SSN and account numbers are classified as **Restricted**.

---

## Operational Considerations

### Performance Targets

| Metric | Target | Current (Q4 2024) |
|--------|--------|--------------------|
| Dashboard Load Time (P95) | < 2 seconds | 1.4 seconds |
| Bloomberg Feed Latency (P95) | < 500ms | 320ms |
| API Response Time (P95) | < 300ms | 210ms |
| Availability (market hours) | 99.9% | 99.94% |
| RUM Apdex Score | > 0.90 | 0.93 |

### Disaster Recovery

- **RPO**: 1 hour (MongoDB continuous backup to Azure Blob, Redis AOF persistence)
- **RTO**: 2 hours (AKS failover to paired region, MongoDB Atlas multi-region replica set)
- **DR Drill**: Semi-annual, timed to avoid quarter-end reporting periods

## Contact

- **Platform Owner**: Wealth Management Engineering — `wealth-eng@acmefinancial.com`
- **On-Call**: PagerDuty service `wealth-portal-prod` (Tier 2)
- **Slack**: `#wealth-portal-support` (general), `#wealth-portal-incidents` (P1/P2)
- **Product**: Wealth Management Product — `wealth-product@acmefinancial.com`
