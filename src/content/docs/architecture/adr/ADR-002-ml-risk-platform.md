---
title: "ADR-002 ML-Based Risk Platform"
---

<!-- title: ADR-002 ML-Based Risk Platform | last-updated: 2025-03-15 | owner: Acme Financial Services | status: current -->

# ADR-002: ML-Based Risk Assessment Platform

## Status

**Accepted** — March 2022

## Context

AFS processes credit decisions for approximately 15,000 loan applications per month and screens over 1.2 million card transactions daily for fraud. The existing risk assessment capability relied on a vendor-provided scoring platform with limited customization, opaque model internals, and increasing licensing costs.

Several factors drove the need for a decision on the risk platform approach:

1. **Model Governance Requirements**: Federal Reserve SR 11-7 and OCC Bulletin 2011-12 establish comprehensive requirements for model risk management at financial institutions, including independent model validation, ongoing performance monitoring, and complete documentation of model development and assumptions. The vendor platform provided limited visibility into model internals, making it difficult to demonstrate compliance with these requirements to examiners.

2. **Proprietary Data Advantage**: AFS has accumulated over 10 years of granular loan performance data (approximately 5 million loans with complete lifecycle outcomes), representing a significant competitive advantage for credit risk modeling. The vendor platform could not leverage institution-specific behavioral features derived from this data.

3. **Explainability for Fair Lending**: The Equal Credit Opportunity Act (ECOA) and Regulation B require that adverse credit decisions include specific reasons. Additionally, fair lending examinations require demonstration that models do not produce disparate impact across protected classes. The vendor platform provided limited explainability, requiring manual adverse action reason generation.

4. **Vendor Lock-In Risk**: The existing vendor contract required a 24-month termination notice period and proprietary data formats that complicated migration. Annual licensing costs had increased 18% year-over-year for three consecutive years.

## Decision

AFS will build an in-house ML-based risk assessment platform using open-source technologies, deployed on AFS-managed infrastructure.

### Key Design Decisions

- **Technology Stack**: Python 3.11 with FastAPI for the serving layer, providing sub-100ms inference latency for real-time scoring requests.
- **Model Lifecycle**: MLflow provides experiment tracking, model versioning, model registry, and deployment pipeline integration. All model artifacts (code, data snapshots, hyperparameters, metrics) are versioned and auditable.
- **Model Selection**: XGBoost for credit scoring (gradient boosted trees provide strong performance with inherent feature importance), isolation forest for anomaly-based fraud detection. Both model types support SHAP (SHapley Additive exPlanations) for individual prediction explanations.
- **Deployment Pattern**: Models are deployed on AKS with a champion/challenger architecture. The champion model serves production traffic; challenger models receive shadow traffic (scored but not used for decisions) for validation before promotion. Model promotion requires independent validation team sign-off.
- **Feature Store**: A centralized feature store in PostgreSQL provides point-in-time correct feature retrieval for both training (batch) and inference (real-time), preventing data leakage and ensuring training/serving consistency. Approximately 300 features are maintained across credit, fraud, and AML domains.
- **Fair Lending Framework**: All credit models undergo disparate impact testing across protected classes (race, gender, age, national origin) before deployment. SHAP values provide individual-level explanations for adverse action notices. Prohibited variables (race, religion, national origin) are excluded from model inputs but monitored for proxy effects.

## Consequences

### Positive

- **Full Governance Control**: Complete visibility into model development, training data, feature engineering, and decision logic. The model inventory, validation reports, and performance monitoring dashboards directly address SR 11-7 and OCC 2011-12 requirements. Examiner access to MLflow experiment history has been praised in recent examinations.
- **Custom Feature Engineering**: Proprietary features derived from AFS transaction history, account behavior, and relationship data improve model performance by approximately 8% (measured by Gini coefficient) compared to the vendor model. Behavioral features such as transaction velocity patterns and account utilization trends are particularly impactful.
- **Explainability via SHAP**: Individual prediction explanations support adverse action notice generation (ECOA/Reg B compliance) and fair lending analysis. SHAP waterfall plots are generated for every credit decision and stored for seven years.
- **No Vendor Dependency**: Elimination of vendor licensing costs (approximately $4.2M annually) and removal of the 24-month termination constraint. AFS retains full ownership of model intellectual property.

### Negative

- **Dedicated ML Team**: The platform requires a dedicated team of 8 ML engineers for model development, feature engineering, platform maintenance, and model monitoring. Recruiting ML engineers with financial services domain knowledge is challenging and requires competitive compensation.
- **Tooling Investment**: Building the ML platform (feature store, model registry, serving infrastructure, monitoring dashboards, A/B testing framework) required approximately 14 months of engineering effort before the first production model was deployed.
- **Time-to-Market**: The initial credit scoring model required 9 months from project start to production deployment (including 3 months of independent validation). Subsequent model updates average 6-8 weeks for development and 4 weeks for validation.
