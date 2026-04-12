---
title: "Architecture Overview"
---

<!-- title: Architecture Overview | last-updated: 2025-03-15 | owner: Acme Financial Services | status: current -->

# Acme Financial Services — Architecture Overview

## 1. Introduction

This document describes the architectural philosophy, patterns, and technical decisions that govern the Acme Financial Services technology estate. It is intended for engineers, architects, and technical leadership as the authoritative reference for understanding how our systems are designed, secured, deployed, and operated.

Acme Financial Services operates within a heavily regulated environment — subject to OCC, FDIC, SEC, FINRA, FinCEN, and state-level banking regulations. Every architectural decision is evaluated against a dual mandate: **deliver business capability** and **satisfy regulatory obligations**. This duality shapes every layer of the stack, from API design to data residency.

---

## 2. Architecture Principles

The following principles guide all system design and technology selection decisions. They are reviewed annually by the Architecture Review Board (ARB) and ratified by the CTO.

### 2.1 Domain-Driven Design

All systems are organized around business domains — not technical layers. Each domain owns its data, its APIs, and its deployment lifecycle. Domain boundaries are identified through event-storming workshops and validated against the organizational structure (Conway's Law). The current domain model comprises four **primary domains** (Banking, Payments, Risk, Wealth) and two **supporting domains** (Regulatory Reporting, Data & Analytics).

Bounded contexts are enforced at the repository, schema, and Kubernetes namespace level. Cross-domain communication is mediated by well-defined contracts (OpenAPI 3.1, AsyncAPI 3.0, or Avro schemas registered in Confluent Schema Registry) — never by shared databases or in-process library coupling.

### 2.2 Regulatory Compliance by Design

Compliance requirements are not retrofitted; they are embedded into architecture from inception. Key practices include:

- **Immutable audit logs** for every state-changing operation, retained per the applicable retention schedule (7 years for BSA/AML, 5 years for SEC Rule 17a-4).
- **Data lineage tracking** from source to report, enforced by dbt lineage graphs and Oracle Fine-Grained Auditing.
- **Segregation of duties** encoded in RBAC/ABAC policies, not left to procedural controls.
- **Regulator-ready data extraction** via pre-built data marts in Snowflake, enabling ad-hoc examiner requests to be fulfilled within 24 hours.

### 2.3 Defense in Depth

No single control is trusted in isolation. Security is layered across network, transport, application, and data tiers (detailed in Section 5). Every external-facing endpoint passes through at least three inspection points before reaching application code.

### 2.4 Operational Resilience

Systems are designed for graceful degradation, not binary availability. Circuit breakers (Resilience4j), bulkheads, rate limiters, and fallback paths ensure that a failure in one domain does not cascade. Chaos engineering experiments (Azure Chaos Studio) run monthly against production-equivalent environments.

### 2.5 Data Sovereignty

All customer data resides within the continental United States (East US and West US 2 Azure regions). No PII or financial data is transmitted to, processed in, or stored in non-US jurisdictions. Third-party integrations that require data egress (e.g., SWIFT messaging) are subject to data-minimization reviews and approved by the Data Protection Officer.

---

## 3. Service-Oriented Architecture

### 3.1 Architectural Style

Acme Financial Services follows a **service-oriented architecture (SOA)** — not a pure microservices decomposition. The distinction is deliberate:

- Core Banking, for example, is a single deployable unit (a "modular monolith") composed of internal modules (accounts, transactions, interest, statements) that share a process and a database but enforce module boundaries via Java module system (`module-info.java`) and package-private visibility.
- Payments Gateway is decomposed into four independently deployable services (authorization, clearing, settlement, dispute) that communicate via Kafka.
- Risk Engine is a small set of FastAPI services behind a single API gateway route.

This pragmatic approach avoids the operational overhead of hundreds of microservices while preserving domain autonomy. The guiding heuristic: **decompose when independent scaling, independent deployment, or technology heterogeneity provides measurable value; otherwise, keep it together.**

### 3.2 Domain Mapping

| Domain | Bounded Contexts | Style | Primary Repo(s) |
|--------|-----------------|-------|-----------------|
| Banking | Accounts, Transactions, Interest, Statements, GL | Modular monolith | `acme-core-banking` |
| Payments | Authorization, Clearing, Settlement, Disputes | Decomposed services | `acme-payments-*` (4 repos) |
| Risk | Credit Scoring, AML/KYC, Fraud Detection, Market Risk | Service cluster | `acme-risk-engine` |
| Wealth | Portfolio, Orders, Advisor CRM, Planning | SPA + BFF + services | `acme-wealth-portal`, `acme-wealth-bff` |
| Regulatory (supporting) | Call Reports, Stress Testing, SARs, CTRs | Batch jobs | `acme-regulatory-reporting` |
| Data & Analytics (supporting) | Ingestion, Transformation, Feature Store, BI | Pipeline DAGs | `acme-data-warehouse`, `acme-dbt-models` |

### 3.3 Conway's Law Alignment

Each domain is owned by a single engineering team (see the System Landscape document for headcounts). Teams have full autonomy over their technology choices within the guardrails defined by the ARB (approved languages, frameworks, databases, and cloud services). Cross-domain dependencies are managed via API contracts versioned in a central **API Catalog** (Backstage).

### 3.4 Service Mesh — Istio

All inter-service communication within the Kubernetes clusters is mediated by an **Istio 1.20 service mesh**:

- **Mutual TLS (mTLS)** is enforced cluster-wide via `PeerAuthentication` policies in STRICT mode. No plaintext traffic is permitted between pods.
- **Authorization policies** restrict which services can call which endpoints, implementing a zero-trust network model within the cluster.
- **Traffic management** — canary routing, retries, timeouts, and circuit-breaking — is configured declaratively via `VirtualService` and `DestinationRule` resources.
- **Observability** — Istio exports distributed traces (OpenTelemetry / Datadog APM), access logs, and golden-signal metrics (latency, traffic, errors, saturation) without application-level instrumentation.

---

## 4. Communication Patterns

### 4.1 Synchronous — REST (HTTPS)

The default pattern for request-response interactions where the caller requires an immediate answer. All REST APIs follow these conventions:

- **OpenAPI 3.1** specification committed alongside source code and published to the API Catalog.
- **Versioning:** URI-path versioning (`/v1/`, `/v2/`) for external APIs; header versioning (`Accept-Version`) for internal APIs.
- **Authentication:** OAuth 2.0 bearer tokens issued by the internal Authorization Server (Keycloak).
- **Rate limiting:** Enforced at the Azure API Management (APIM) layer — per-client, per-endpoint.
- **Idempotency:** All mutating endpoints accept an `Idempotency-Key` header (UUID v7). The server deduplicates within a 72-hour window using Redis.

### 4.2 Asynchronous — Apache Kafka

Kafka is the backbone for event-driven communication. It is used for:

- **Domain events** (e.g., `payment-authorized`, `account-opened`, `risk-score-computed`) enabling loose coupling between domains.
- **Change Data Capture (CDC)** via Oracle GoldenGate → Kafka → Snowflake Snowpipe, providing near-real-time analytical data.
- **Command distribution** for long-running processes (e.g., batch settlement instructions).

Kafka conventions:

| Aspect | Standard |
|--------|----------|
| Cluster | Confluent Platform 7.6 (Kafka 3.6) on dedicated AKS nodes |
| Schema governance | Confluent Schema Registry; Avro with backward compatibility enforced |
| Topic naming | `<domain>.<entity>.<event>` (e.g., `payments.card.authorized`) |
| Partitioning key | Business identifier (account ID, payment ID) to ensure ordering within an entity |
| Retention | 7 days for operational topics; 30 days for CDC topics; infinite for audit topics (tiered storage) |
| Delivery guarantee | Exactly-once semantics (`enable.idempotence=true`, transactional producers, `isolation.level=read_committed`) |

### 4.3 SWIFT Messaging

Cross-border wire transfers use the SWIFT network via **Alliance Lite2** hosted on a dedicated on-premises appliance connected to Azure over ExpressRoute. Message types include MT103 (customer transfers), MT202 (bank-to-bank), MT940 (account statements for nostro reconciliation), and the corresponding ISO 20022 MX equivalents as the industry migrates.

### 4.4 Batch Processing — Spring Batch

Regulatory Reporting and Core Banking EOD processes use **Spring Batch 5** for partitioned, restartable, checkpoint-aware batch jobs. Job metadata is persisted in Oracle, enabling automatic restart from the last committed chunk after an infrastructure failure.

### 4.5 GraphQL Federation

The Wealth Management Portal's Backend-for-Frontend (BFF) layer uses **Apollo Federation 2** to compose a unified GraphQL schema from sub-graphs exposed by Core Banking (accounts, balances) and the Wealth domain (portfolios, orders). This allows the React SPA to fetch complex, nested data structures in a single round trip while each domain retains ownership of its sub-graph.

---

## 5. Security Architecture

Security controls are organized in concentric layers, from the network edge to the data at rest.

### 5.1 Edge — Azure Front Door + WAF

All external traffic enters through **Azure Front Door** with a Web Application Firewall (WAF) policy. The WAF enforces OWASP Core Rule Set 3.2, geo-blocking (US-only for customer-facing portals), bot protection, and custom rules for known attack patterns. DDoS protection is provided by Azure DDoS Protection Standard.

### 5.2 API Gateway — Azure API Management (APIM)

APIM serves as the internal API gateway, handling:

- OAuth 2.0 token validation (JWT introspection against Keycloak).
- Rate limiting and quota enforcement.
- Request/response transformation and header injection.
- API versioning and deprecation management.

### 5.3 Service Mesh — Istio mTLS

Within the cluster, all pod-to-pod communication is encrypted and authenticated via Istio mTLS (STRICT mode). Istio `AuthorizationPolicy` resources implement fine-grained service-to-service access control.

### 5.4 Application — OAuth 2.0, RBAC, ABAC

- **OAuth 2.0 / OIDC** — Keycloak issues access tokens with scopes mapped to API permissions. Refresh tokens have a 15-minute sliding window.
- **Role-Based Access Control (RBAC)** — Coarse-grained access (e.g., `payments:write`, `accounts:read`).
- **Attribute-Based Access Control (ABAC)** — Fine-grained policies enforced by Open Policy Agent (OPA) sidecars. Attributes include user role, department, data classification, time of day, and transaction amount.

### 5.5 Data Encryption

| Layer | Mechanism | Key Management |
|-------|-----------|----------------|
| Data at rest (Oracle) | Transparent Data Encryption (TDE) | Oracle Wallet backed by Azure Key Vault |
| Data at rest (PostgreSQL) | `pgcrypto` extension for column-level encryption of PII fields | Azure Key Vault |
| Data at rest (MongoDB) | Client-Side Field Level Encryption (CSFLE) | Azure Key Vault (KMIP provider) |
| Data at rest (Snowflake) | Snowflake-managed encryption (AES-256), Tri-Secret Secure with customer-managed key | Azure Key Vault |
| Data in transit | TLS 1.3 (external), Istio mTLS (internal) | Cert-manager with Let's Encrypt (external), Istio CA (internal) |
| Card data (PCI) | HSM-based encryption (AES-256-GCM) | Azure Dedicated HSM (FIPS 140-2 Level 3), BYOK |

### 5.6 PCI-DSS Cardholder Data Environment (CDE)

The Payments Gateway's card-processing components operate within an isolated PCI-DSS CDE:

- **Network isolation:** Dedicated AKS node pool, Calico network policies, Azure NSGs restricting all ingress/egress to a whitelist of approved IP ranges and ports.
- **HSM integration:** Azure Dedicated HSM (Thales Luna 7) for PIN translation, card encryption key management, and tokenization key wrapping. Keys never leave the HSM boundary in plaintext.
- **Tokenization:** PANs are tokenized at the point of entry; downstream systems only handle opaque tokens. The token vault resides inside the CDE.
- **Audit logging:** Every access to cardholder data is logged to an immutable Datadog log archive with a 1-year retention, reviewed quarterly by the QSA.

### 5.7 Azure Dedicated HSM — BYOK

Bring Your Own Key (BYOK) is implemented for all regulated encryption use cases. Key ceremonies are conducted with dual control and split knowledge, witnessed by Compliance and Information Security.

---

## 6. Deployment Architecture

### 6.1 Kubernetes — AKS 1.28

All application workloads run on **Azure Kubernetes Service (AKS) 1.28**. Two clusters serve production:

| Cluster | Purpose | Node Pools | Notes |
|---------|---------|-----------|-------|
| `aks-prod-pci` | Payments CDE workloads | 3 pools (system, card-processing, settlement) | CIS-hardened, PCI-DSS scoped |
| `aks-prod-nonpci` | All other production workloads | 4 pools (system, banking, risk, general) | Standard security baseline |

Node pools use Azure Confidential VMs where required by data classification policy. Cluster autoscaler is enabled with min/max boundaries set per pool.

### 6.2 GitOps — ArgoCD

All deployments are managed by **ArgoCD 2.10** following a GitOps model:

1. Engineers merge code to `main` in their application repository.
2. **GitHub Actions** CI pipeline builds the container image, runs unit/integration tests, performs SAST (Checkmarx) and SCA (Snyk) scans, signs the image (Cosign), and pushes to Azure Container Registry.
3. A promotion workflow updates the Helm chart version in the corresponding **GitOps repository** (`acme-gitops-*`).
4. ArgoCD detects the change and reconciles the desired state against the cluster.
5. **Blue-green** deployments are used for Core Banking (zero-downtime cutover with instant rollback). **Canary** deployments (Argo Rollouts) are used for Payments and Risk, with automated analysis gates powered by Datadog metrics.

### 6.3 Network Policies — Calico

Calico `GlobalNetworkPolicy` resources enforce:

- **Default deny** for all ingress and egress at the namespace level.
- **Explicit allow** rules for approved service-to-service paths, matching the dependency map in the System Landscape document.
- **DNS egress** restricted to internal DNS and approved external domains (e.g., SWIFT, Bloomberg, Experian, Equifax endpoints).

### 6.4 CI/CD — GitHub Actions

Every repository includes a standardized GitHub Actions workflow (templated via a shared reusable workflow library):

| Stage | Tools | Gate |
|-------|-------|------|
| Build | Maven / Gradle (Java), Poetry (Python), npm (TypeScript) | Compilation and unit tests must pass |
| Test | JUnit 5, pytest, Jest/RTL | ≥ 80 % line coverage; no regression in mutation score |
| SAST | Checkmarx | Zero high/critical findings |
| SCA | Snyk | Zero high/critical vulnerabilities in direct dependencies |
| Container Scan | Trivy | Zero critical CVEs in final image |
| Sign | Cosign (Sigstore) | Image must be signed before push to ACR |
| Promote | Helm chart version bump in GitOps repo | Requires two approvals for production |

### 6.5 Environment Isolation

Each environment (Dev → Staging → UAT → Prod) is deployed in its own **AKS cluster** within its own **VNet spoke**. Promotion between environments is automated via ArgoCD ApplicationSets with progressive delivery gates.

---

## 7. Data Architecture Principles

### 7.1 Domain-Owned Data

Each domain owns its data store exclusively. No other domain may read from or write to another domain's database. Cross-domain data access is mediated by:

- **APIs** for synchronous queries.
- **Kafka events** for asynchronous data propagation.
- **Data Warehouse** for analytical cross-domain queries.

This principle eliminates hidden coupling and enables independent schema evolution.

### 7.2 Event Sourcing

The Payments Gateway uses **event sourcing** for payment lifecycle management. Every payment state transition (initiated → authorized → cleared → settled) is persisted as an immutable event in a Kafka topic and materialized into PostgreSQL read models via Kafka Streams. This provides a complete, auditable history of every payment and enables temporal queries ("What was the state of payment X at time T?").

### 7.3 CQRS

Command Query Responsibility Segregation is applied in the Payments and Risk domains:

- **Command side:** Validates and persists state changes (writes).
- **Query side:** Optimized read models (materialized views, denormalized tables) serve query traffic without competing for write locks.

### 7.4 Data Mesh

The Data Warehouse team operates as a **data platform** provider, not a centralized ETL team. Domain teams are responsible for publishing well-documented, SLA-backed **data products** into Snowflake:

- Each data product has an owner, a schema contract (defined in dbt), a freshness SLA, and a quality score (monitored via dbt tests and Great Expectations).
- The data platform provides shared infrastructure: Snowflake account management, Airflow cluster, dbt Cloud, schema registry, and data catalog (Atlan).

### 7.5 Data Classification

All data elements are classified into one of four tiers. Classification drives encryption, access control, masking, and retention policies.

| Tier | Label | Examples | Controls |
|------|-------|----------|----------|
| 1 | **Public** | Marketing content, published rates | No restrictions |
| 2 | **Internal** | Employee directories, internal memos | Authentication required; no external sharing |
| 3 | **Confidential** | Customer names, account balances, transaction history | Encryption at rest and in transit; ABAC; audit logging; masked in non-Prod |
| 4 | **Restricted** | SSN, PAN, PINs, authentication credentials | HSM-protected encryption; tokenization; need-to-know ABAC; enhanced audit logging; never present in non-Prod |

---

## 8. Cross-Cutting Concerns

### 8.1 Observability

All services emit structured logs (JSON), metrics (Prometheus-format scraped by Datadog), and distributed traces (OpenTelemetry) to **Datadog**. Dashboards, SLOs, and monitors are defined as code (Terraform Datadog provider) and version-controlled in the `acme-observability` repository.

### 8.2 Incident Management

Incidents follow a structured lifecycle: Detect → Triage → Mitigate → Resolve → Post-Incident Review. PagerDuty escalation policies are aligned with the domain team structure. Post-incident reviews are blameless; action items are tracked in Jira and reviewed weekly by the VP Engineering.

### 8.3 Disaster Recovery

DR architecture is detailed in the System Landscape document. At the architectural level, the key principle is: **every component must have a documented, tested recovery path**. Untested recovery paths are treated as non-existent.

---

## 9. Document History

| Date | Author | Change |
|------|--------|--------|
| 2025-03-15 | Architecture Review Board | Annual refresh; updated to AKS 1.28, Istio 1.20, ArgoCD 2.10 |
| 2024-09-01 | Platform Architecture | Added data mesh and data classification sections |
| 2024-03-15 | Security Architecture | Added PCI-DSS CDE and HSM BYOK details |
| 2023-09-20 | Platform Architecture | Initial publication |
