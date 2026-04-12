---
title: "ADR-003 Data Mesh Domain Architecture"
---

<!-- title: ADR-003 Data Mesh Domain Architecture | last-updated: 2025-03-15 | owner: Acme Financial Services | status: current -->

# ADR-003: Data Mesh Domain Architecture

## Status

**Accepted** — September 2023

## Context

AFS operates a centralized data warehouse in Snowflake with all ETL pipelines owned and maintained by a 15-person data engineering team. As the organization grew, several pain points emerged that threatened the scalability and quality of the analytical data platform.

1. **Centralized Team Bottleneck**: All data transformation requests routed through the central data engineering team, creating a 3 to 6 week backlog for new data product requests. Business-critical requests (regulatory reporting changes, new risk model features) competed with routine analytics requests for the same engineering capacity.

2. **Domain Expertise Gap**: The central team lacked deep domain knowledge in specialized areas such as credit risk modeling, wealth management portfolio analytics, and payment network reconciliation. This led to frequent rework cycles where domain SMEs reviewed and corrected data transformations, adding 2-3 weeks to delivery timelines.

3. **Cross-Domain Analytics Growth**: The demand for cross-domain analytical capabilities (such as customer 360 views combining banking, payments, wealth, and risk data) was growing at approximately 40% year-over-year. The centralized model could not scale to meet this demand without proportional headcount growth.

4. **Snowflake Data Sharing**: Snowflake native data sharing capabilities enabled zero-copy cross-account data access, making it technically feasible for domain teams to publish data products that other domains could consume without data movement or duplication.

## Decision

AFS will adopt a data mesh architecture where each business domain owns and publishes its analytical data products in Snowflake, supported by a self-serve data platform provided by the central data engineering team.

### Key Design Decisions

- **Domain-Owned Data Products**: Each domain (Banking, Payments, Risk, Wealth, Regulatory) is responsible for publishing curated, documented, and quality-tested data products in Snowflake. Data products follow a standardized structure: raw layer (ingested data), staging layer (cleaned and conformed), curated layer (business-ready aggregations), and an analytics layer (domain-specific analytical models).
- **Self-Serve Platform**: The central data engineering team provides templated dbt project structures, Airflow DAG templates, Great Expectations test suites, and CI/CD pipeline templates. Domain teams use these templates to build and deploy their data products without requiring deep data engineering expertise.
- **Federated Governance Council**: A cross-domain Data Governance Council (meeting bi-weekly) establishes and maintains standards for naming conventions, schema evolution rules, data classification tagging, documentation requirements, and quality SLO definitions. Each domain has a representative on the council, typically a senior engineer or data lead.
- **Quality SLOs via Great Expectations**: Every data product must define and pass quality SLOs covering freshness (data available by specified time), completeness (null rate thresholds), accuracy (reconciliation against source systems), and uniqueness (no duplicate records). Great Expectations checkpoints run as part of every Airflow DAG execution, with failures blocking downstream consumers and triggering PagerDuty alerts.
- **Snowflake Data Sharing**: Cross-domain data access is provided through Snowflake secure data shares, enabling zero-copy access without data movement. Access is granted at the data product level (not table level) through a self-service access request workflow integrated with the governance council approval process.

## Consequences

### Positive

- **Domain Quality Ownership**: Domain teams, possessing the deepest understanding of their data semantics and business rules, now own data quality. This has reduced data quality incidents in regulatory reporting by approximately 60% in the first six months following migration.
- **Faster Delivery**: New data product requests that previously required 3-6 weeks of central team involvement are now delivered in under one week by domain teams using self-serve templates. The payments team delivered a new FedNow analytics data product within 4 business days of the requirement being defined.
- **Reduced Central Bottleneck**: The central data engineering team has shifted from building domain-specific pipelines to maintaining the platform (dbt/Airflow templates, Snowflake administration, data quality framework, CI/CD pipelines). This enables the team to focus on cross-cutting capabilities rather than domain-specific data transformation work.
- **Regulatory Agility**: Domain teams can respond to regulatory data requests (OCC examination data pulls, new reporting requirements) without waiting for central team capacity. The regulatory reporting team independently modified their data products to support the updated HMDA reporting requirements within two weeks.

### Negative

- **Data Literacy Investment**: Domain engineering teams required training in dbt, Airflow, Great Expectations, and Snowflake SQL patterns. The initial training program required approximately 40 hours per engineer across 6 domain teams. Ongoing enablement sessions (monthly office hours) are maintained by the central team.
- **Governance Coordination**: Federated governance requires active participation from all domains. The bi-weekly governance council meeting and asynchronous Slack channel for standards discussions represent an ongoing coordination cost. Two domains initially fell behind on documentation standards, requiring escalation through engineering leadership.
- **Migration Period**: The migration from centralized ownership to domain ownership required approximately 6 months, during which both the central team and domain teams maintained parallel pipelines. This transition period increased operational complexity and required careful coordination to avoid data quality regressions.
- **Consistency Risk**: Without strong governance enforcement, there is a risk of inconsistent data definitions across domains (for example, different definitions of "active customer" between Banking and Wealth domains). The governance council maintains a shared business glossary in the Snowflake data catalog to mitigate this risk, with automated checks for naming convention compliance.
