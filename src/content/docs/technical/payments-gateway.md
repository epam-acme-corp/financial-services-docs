---
title: "Payments Gateway — Technical Deep-Dive"
---

<!-- title: Payments Gateway — Technical Deep-Dive | last-updated: 2025-03-15 | owner: Acme Financial Services | status: current -->

# Payments Gateway — Technical Deep-Dive

## 1. Platform Overview

The Payments Gateway is the centralized payment processing platform for Acme Financial Services, handling all card transactions (acquiring and issuing), wire transfers (domestic and cross-border), ACH origination and receipt, SEPA credit transfers and direct debits, and FedNow instant payment receipt.

| Attribute | Detail |
|-----------|--------|
| **Primary Language** | Java 17 (LTS) |
| **Framework** | Spring Boot 3.2, Spring Kafka, Spring WebFlux (reactive endpoints) |
| **Messaging** | Apache Kafka 3.6 (Confluent Platform 7.6) |
| **Database** | PostgreSQL 15 (Azure Database for PostgreSQL — Flexible Server) |
| **Cache** | Redis 7 (Azure Cache for Redis Enterprise, geo-replicated) |
| **Deployment** | AKS 1.28, PCI-DSS dedicated cluster (`aks-prod-pci`) |
| **Team Size** | 30 engineers (backend, QA, SRE, compliance) |
| **SLA** | Tier 1 — 99.99 % monthly uptime (~4.3 min tolerated downtime/month) |
| **RTO / RPO** | 10 min / < 1 second (streaming replication) |
| **Repositories** | `acme-payments-auth`, `acme-payments-clearing`, `acme-payments-settlement`, `acme-payments-disputes` |

### Daily Volume

| Channel | Average Daily Volume | Peak (Month-End / Payroll) |
|---------|---------------------|---------------------------|
| Card transactions (acquiring + issuing) | ~1,200,000 | ~2,000,000 |
| Wire transfers (Fedwire + SWIFT) | ~50,000 | ~80,000 |
| ACH (origination + receipt) | ~200,000 | ~350,000 |
| SEPA (SCT + SDD) | ~15,000 | ~25,000 |
| FedNow (receive-only) | ~5,000 | ~12,000 |

---

## 2. Payment Types

### 2.1 Card Payments

#### Acquiring

Acme processes card-present (CP) and card-not-present (CNP) transactions on behalf of merchant clients through direct connections to Visa (VisaNet) and Mastercard (Banknet) via an acquiring processor. Authorization requests are routed, approved or declined, and a real-time authorization response is returned to the merchant terminal or e-commerce gateway within the p99 latency SLA.

#### Issuing

For Acme-issued debit and credit cards, the Payments Gateway receives incoming authorization requests from the card networks, performs balance/credit-limit checks against Core Banking, applies fraud rules via the Risk Engine, and returns an approve or decline response.

#### Card-Not-Present & 3-D Secure 2

All CNP transactions require **3-D Secure 2 (3DS2)** authentication orchestrated via an EMVCo-certified Access Control Server (ACS). The frictionless flow handles approximately 85 % of authentications; the remaining 15 % trigger a step-up challenge (OTP or biometric).

#### Tokenization

Primary Account Numbers (PANs) are tokenized at the point of entry using HSM-generated format-preserving tokens. Downstream services — including Core Banking, Risk Engine, and the Data Warehouse — only receive opaque tokens. The token vault is housed within the PCI CDE and accessible exclusively by the authorization service.

### 2.2 Wire Transfers

#### Domestic — Fedwire

- **Outbound:** Initiated via Core Banking or the Wealth Management Portal. The Payments Gateway validates the request, performs OFAC screening (via Risk Engine), and submits to the Federal Reserve via the Fedwire Funds Service.
- **Inbound:** Received from Fedwire, matched to the beneficiary account in Core Banking, and credited.
- **Cut-off times:** Outbound Fedwire submissions close at 6:00 PM ET (customer-initiated) and 6:30 PM ET (bank-initiated).

#### Cross-Border — SWIFT

Cross-border wires are transmitted via the SWIFT network using **Alliance Lite2** (see Section 7 for integration details). Message types include:

| MT Type | Description | Direction |
|---------|-------------|-----------|
| MT103 | Single Customer Credit Transfer | Outbound / Inbound |
| MT202 | General Financial Institution Transfer | Outbound / Inbound |
| MT940 | Customer Statement (end-of-day) | Inbound (from correspondent banks) |
| MT199 | Free-format message (queries/investigations) | Bidirectional |
| MT299 | Free-format message (treasury) | Bidirectional |

### 2.3 ACH

- **Origination:** Acme originates ACH credits (payroll, vendor payments) and debits (loan payments, recurring billing) via the Federal Reserve's FedACH service.
- **Receipt:** Inbound ACH entries are received, validated, and posted to customer accounts.
- **Same-Day ACH:** Supported for both origination and receipt. Same-day window cut-off times: 10:30 AM ET, 2:45 PM ET.
- **Returns:** Return reason codes R01 through R85 are processed. Common returns (R01 — Insufficient Funds, R02 — Account Closed, R03 — No Account) are auto-resolved; others are routed to the Operations team.

### 2.4 SEPA

- **SEPA Credit Transfer (SCT):** EUR-denominated credit transfers to EEA beneficiaries, submitted via a SEPA-connected correspondent bank.
- **SEPA Direct Debit (SDD):** Collection of EUR receivables from EEA debtors under a signed mandate.
- **ISO 20022:** All SEPA messages use ISO 20022 XML schemas (`pain.001`, `pain.008`, `pacs.008`, `camt.053`).

### 2.5 FedNow

- **Receive-only:** Acme currently supports receiving FedNow instant payments. Outbound origination is on the 2025 H2 roadmap.
- **Transaction limit:** $500,000 per transaction (Federal Reserve network limit).
- **Availability:** 24/7/365 — no cut-off times.

---

## 3. Processing Flow

Every payment — regardless of channel — passes through a standardized processing pipeline:

| Step | Action | Latency Budget | Key Component |
|------|--------|----------------|---------------|
| 1 | **Initiate** | — | API Gateway receives request; assigns UUID v7 payment ID |
| 2 | **Validate** | < 20 ms | Schema validation, currency check, duplicate detection (Redis idempotency), account status verification |
| 3 | **Screen** | < 100 ms | Synchronous call to Risk Engine: OFAC/sanctions screening, fraud scoring, AML rule evaluation |
| 4 | **Authorize** | < 50 ms | Balance/credit-limit hold (Core Banking REST call for issuing), card network authorization (VisaNet/Banknet for acquiring), Fedwire submission |
| 5 | **Clear** | Batch (card) / Real-time (wire/ACH) | Card clearing files (TC/IPM) generated nightly; wires clear upon Fedwire/SWIFT confirmation; ACH files submitted per window |
| 6 | **Settle** | T+0 to T+2 | Net settlement with card networks; gross settlement for wires; net settlement for ACH |
| **End-to-end (auth)** | | **< 500 ms (p99)** | |

### 3.1 Latency Performance

| Metric | Target | Actual (30-day avg) |
|--------|--------|---------------------|
| Authorization p50 | < 150 ms | 120 ms |
| Authorization p95 | < 350 ms | 280 ms |
| Authorization p99 | < 500 ms | 420 ms |
| Screening (Risk Engine) p99 | < 100 ms | 72 ms |
| Validation p99 | < 20 ms | 12 ms |

---

## 4. Kafka Topology

Kafka is the backbone for asynchronous communication within the Payments domain and with downstream systems.

### 4.1 Topic Inventory

| Topic | Partition Key | Partitions | Producers | Consumers | Retention | Schema |
|-------|--------------|------------|-----------|-----------|-----------|--------|
| `payments.payment.initiated` | `payment_id` | 64 | Authorization Service | Clearing Service, Data Warehouse | 7 days | Avro (`PaymentInitiated.avsc`) |
| `payments.payment.authorized` | `payment_id` | 64 | Authorization Service | Core Banking, Clearing Service, Risk Engine | 7 days | Avro (`PaymentAuthorized.avsc`) |
| `payments.payment.settled` | `payment_id` | 32 | Settlement Service | Core Banking, Data Warehouse, Regulatory Reporting | 30 days | Avro (`PaymentSettled.avsc`) |
| `payments.payment.failed` | `payment_id` | 32 | Authorization Service, Clearing Service | Disputes Service, Data Warehouse | 30 days | Avro (`PaymentFailed.avsc`) |
| `payments.payment.reversed` | `payment_id` | 32 | Disputes Service | Core Banking, Settlement Service, Data Warehouse | 30 days | Avro (`PaymentReversed.avsc`) |

### 4.2 Kafka Configuration

```yaml
# Producer configuration (authorization-service)
spring:
  kafka:
    producer:
      bootstrap-servers: ${KAFKA_BOOTSTRAP_SERVERS}
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: io.confluent.kafka.serializers.KafkaAvroSerializer
      acks: all
      retries: 2147483647
      enable.idempotence: true
      transactional.id: auth-svc-${POD_NAME}
      max.in.flight.requests.per.connection: 5
      compression.type: zstd
    consumer:
      isolation.level: read_committed
      auto.offset.reset: earliest
      enable.auto.commit: false
      max.poll.records: 500
```

### 4.3 Delivery Guarantees

- **Exactly-once semantics (EOS):** Enabled via transactional producers (`enable.idempotence=true`, `transactional.id`) and `read_committed` consumer isolation level.
- **Schema governance:** All topic schemas are registered in Confluent Schema Registry with **backward compatibility** enforced. Breaking changes require ARB approval and a phased migration plan.
- **Consumer lag monitoring:** Datadog monitors consumer group lag for every consumer. Alert thresholds: P3 if lag exceeds 10,000 messages for 5 minutes; P2 if lag exceeds 100,000 messages.

---

## 5. PCI-DSS Architecture

### 5.1 Cardholder Data Environment (CDE)

The CDE is a network-isolated segment within the `aks-prod-pci` cluster. It contains:

- **Authorization Service** — Processes card authorization requests; has access to the token vault and HSM.
- **Token Vault** — PostgreSQL instance storing PAN-to-token mappings, encrypted at rest (pgcrypto AES-256) and column-level encrypted.
- **HSM Gateway** — Proxy service for Azure Dedicated HSM (Thales Luna 7) operations.

### 5.2 HSM Integration

| Operation | HSM Function | Protocol |
|-----------|-------------|----------|
| PAN encryption/decryption | AES-256-GCM encrypt/decrypt | PKCS#11 |
| PIN translation (issuing) | 3DES PIN block translate | PKCS#11 |
| Token generation | Format-preserving encryption (FF1) | PKCS#11 |
| Key wrapping (BYOK) | AES key wrap | PKCS#11 |
| Digital signing (SWIFT) | RSA-2048 / ECDSA P-256 | PKCS#11 |

HSMs are FIPS 140-2 Level 3 validated. Key ceremonies (generation, rotation, destruction) require dual control with split knowledge, witnessed by Information Security and Compliance personnel. Key rotation occurs annually or immediately upon suspected compromise.

### 5.3 Data Minimization

- **CVV/CVC:** Never stored. Used only in-memory during the authorization request and discarded.
- **PAN:** Tokenized at entry; only the token vault (inside CDE) holds the mapping.
- **Magnetic stripe data:** Never stored.
- **Cardholder name:** Stored only where required for clearing/dispute purposes; encrypted at rest.

### 5.4 Access Controls

- CDE Kubernetes namespace uses Calico `NetworkPolicy` with default-deny ingress and egress.
- Only the API Gateway (APIM) and the Clearing Service can initiate connections to the Authorization Service.
- SSH access to CDE nodes is disabled; all administration via `kubectl` through a Bastion host with MFA and session recording.
- Access reviews are conducted quarterly; all access is logged and retained for 1 year.

### 5.5 Compliance Validation

| Activity | Frequency | Performed By |
|----------|-----------|-------------|
| PCI DSS Level 1 assessment (ROC) | Annual | External QSA (Coalfire) |
| ASV vulnerability scan | Quarterly | Qualys |
| Penetration test (external + internal) | Annual | Bishop Fox |
| Internal vulnerability scan | Monthly | Qualys + Snyk |
| Code review (SAST) | Every PR | Checkmarx (automated in CI) |
| Log review | Daily (automated) + weekly (manual) | SRE + InfoSec |

---

## 6. SWIFT Integration

### 6.1 Alliance Lite2

SWIFT connectivity is provided by **Alliance Lite2**, a cloud-based SWIFT interface hosted on a dedicated on-premises appliance connected to Azure via ExpressRoute. Alliance Lite2 provides:

- **FIN messaging** — Structured financial messages (MT series).
- **FileAct** — Bulk file transfers for clearing and reporting.
- **SWIFTNet Link** — Secure IP connectivity to the SWIFT network.

### 6.2 Message Flow

```
Payments Gateway → Alliance Lite2 Appliance → SWIFTNet → Correspondent Bank
                         (ExpressRoute)           (FIN/FileAct)
```

### 6.3 Supported Message Types

| Message | Direction | Purpose | Daily Volume |
|---------|-----------|---------|-------------|
| MT103 | Outbound / Inbound | Single customer credit transfer | ~35,000 |
| MT202 | Outbound / Inbound | Bank-to-bank transfer (cover payment) | ~10,000 |
| MT940 | Inbound | End-of-day account statement from correspondents | ~200 |
| MT199 | Bidirectional | Free-format inquiry / investigation | ~500 |
| MT299 | Bidirectional | Free-format treasury message | ~100 |

### 6.4 Sanctions Screening

Every outbound SWIFT message is screened against sanctions lists before transmission:

1. **Pre-screening:** The Payments Gateway calls the Risk Engine, which queries Refinitiv World-Check One and the OFAC SDN list.
2. **Hit resolution:** True hits are blocked and routed to the BSA/AML Compliance team for investigation. False positives are documented and released with dual approval.
3. **Post-screening:** Inbound MT103/MT202 messages are screened upon receipt before crediting the beneficiary account.

### 6.5 ISO 20022 Migration

SWIFT's ISO 20022 migration (effective November 2025 for cross-border payments) requires support for MX message equivalents:

| Legacy MT | ISO 20022 MX Equivalent | Migration Status |
|-----------|------------------------|-----------------|
| MT103 | pacs.008 | Development complete; UAT in progress |
| MT202 | pacs.009 | Development complete; UAT in progress |
| MT940 | camt.053 | Development complete; production pilot Q2 2025 |
| MT199 | — (free-format retained) | No change required |

The Payments Gateway implements a **dual-format adapter** that can send and receive both MT and MX formats during the coexistence period. Message translation is handled by an in-house library (`acme-swift-translator`) with comprehensive round-trip test coverage.

---

## 7. Idempotency Strategy

Payment processing requires robust idempotency to prevent duplicate authorization, double settlement, or repeated fund movement.

### 7.1 API-Level Idempotency (Redis)

Every mutating API call must include an `Idempotency-Key` header (UUID v7). The Authorization Service checks Redis for the key before processing:

- **Cache hit:** Return the stored response without re-executing the operation.
- **Cache miss:** Process the request, store the response in Redis with a **72-hour TTL**, and return the result.

Redis is deployed as an Azure Cache for Redis Enterprise (6-node cluster, active geo-replication between East US and West US 2).

### 7.2 Kafka Producer Idempotency

Kafka producers are configured with `enable.idempotence=true` and transactional IDs, ensuring that retried produces do not result in duplicate messages on the broker.

### 7.3 Settlement Idempotency

Settlement files and instructions include a unique settlement batch ID. The settlement engine checks for prior processing of the batch ID before executing. If a duplicate batch is detected, the engine logs a warning and skips re-processing.

### 7.4 End-to-End Deduplication

The payment ID (UUID v7, assigned at initiation) is propagated through every stage of the pipeline. Each stage (authorize, clear, settle) maintains its own processed-ID set, ensuring that even if an upstream retry occurs, the downstream stage does not re-execute.

---

## 8. Monitoring & Alerting

### 8.1 Datadog Dashboards

| Dashboard | Key Widgets |
|-----------|------------|
| **Payments — Authorization** | Auth success rate (target > 99.5 %), decline reason distribution, latency heatmap (p50/p95/p99), throughput (TPS), error rate by HTTP status |
| **Payments — Kafka** | Consumer lag per group, producer throughput, broker disk usage, partition distribution, under-replicated partitions |
| **Payments — Settlement** | Settlement file generation status, net settlement position, reconciliation break count, settlement cycle time |
| **Payments — SWIFT** | SWIFT queue depth, message delivery latency, NAK rate, sanctions screening hit rate |
| **Payments — PCI Compliance** | CDE pod count, network policy violations, HSM operation latency, failed authentication attempts |

### 8.2 SLOs

| SLO | Target | Window | Burn Rate Alert |
|-----|--------|--------|----------------|
| Authorization availability | 99.99 % | 30-day rolling | P1 at 14.4x (1-hour), P2 at 6x (6-hour) |
| Authorization latency (p99 < 500 ms) | 99.9 % | 30-day rolling | P2 at 6x (6-hour) |
| Settlement timeliness (files delivered by cut-off) | 100 % | Per cycle | P1 on any miss |
| SWIFT delivery (MT103 acknowledged within 30 min) | 99.9 % | 30-day rolling | P2 at 6x (6-hour) |

### 8.3 PagerDuty Alerting

| Alert | Condition | Severity | Escalation |
|-------|-----------|----------|------------|
| Auth success rate < 99.5 % (5 min) | Drop in approval rate | P1 | Payments on-call → VP Engineering (15 min) |
| Auth p99 > 500 ms (5 min) | Latency breach | P2 | Payments on-call |
| Kafka consumer lag > 100,000 (5 min) | Processing backlog | P2 | Payments on-call |
| SWIFT queue depth > 500 (15 min) | SWIFT delivery delay | P2 | Payments on-call + Treasury Ops |
| HSM operation latency > 50 ms (5 min) | HSM degradation | P2 | Payments on-call + InfoSec |
| PCI CDE network policy violation | Unexpected traffic in CDE | P1 | InfoSec on-call → CISO (immediate) |
| Settlement file not generated by T-30 min before cut-off | Settlement delay risk | P1 | Payments on-call + Settlement Ops |
| Redis replication lag > 5 s | Cache inconsistency risk | P3 | Payments on-call |

---

## 9. Disaster Recovery

### 9.1 Architecture

| Component | Primary (East US) | DR (West US 2) | Replication |
|-----------|------------------|----------------|-------------|
| PostgreSQL | Azure Flexible Server | Read replica (async streaming) | < 1 s lag |
| Redis | Enterprise 6-node | Active geo-replica | Sub-second |
| Kafka | 6-broker cluster | MirrorMaker 2 (async) | < 30 s lag |
| AKS | `aks-prod-pci` | `aks-dr-pci` (warm standby) | ArgoCD sync |
| SWIFT (Alliance Lite2) | On-premises appliance | — (manual failover to backup appliance) | N/A |

### 9.2 Failover Procedure

1. **Detection:** Datadog availability monitors detect primary region unavailability (3 consecutive failures over 90 seconds).
2. **Decision:** PagerDuty alerts the Payments on-call engineer and VP Engineering. Failover requires explicit approval (no fully automated failover to avoid split-brain).
3. **Execution:** Azure Traffic Manager DNS failover routes traffic to West US 2. PostgreSQL replica is promoted. Redis geo-replica becomes primary. Kafka consumers in DR cluster resume from last committed offset.
4. **Validation:** Automated smoke tests verify authorization, clearing, and settlement service health.
5. **Communication:** Status page updated; stakeholder notification sent via Opsgenie.

DR failover drills are conducted **monthly** for the Payments Gateway due to its Tier 1 SLA and PCI-DSS requirements.

---

## 10. Document History

| Date | Author | Change |
|------|--------|--------|
| 2025-03-15 | Payments Engineering | Annual refresh; added FedNow, ISO 20022 migration status |
| 2024-11-01 | Payments Engineering | Updated Kafka to 3.6 (Confluent Platform 7.6) |
| 2024-07-15 | Security Architecture | Added PCI-DSS CDE architecture section |
| 2024-03-01 | Payments Engineering | Initial publication |
