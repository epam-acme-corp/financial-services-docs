---
title: "ADR-001 Event-Driven Payments Architecture"
---

<!-- title: ADR-001 Event-Driven Payments Architecture | last-updated: 2025-03-15 | owner: Acme Financial Services | status: current -->

# ADR-001: Event-Driven Payments Architecture

## Status

**Accepted** — January 2023

## Context

The Payments Gateway processes approximately 1.2 million card transactions, 50,000 wire transfers, and 200,000 ACH transactions daily. Prior to this decision, the payments platform used a synchronous request-response architecture where each downstream consumer (fraud detection, regulatory reporting, reconciliation, analytics) was called sequentially during payment processing.

This architecture presented several challenges:

1. **Audit Trail Requirements**: PCI-DSS Requirement 10 mandates comprehensive audit trails for all access to cardholder data and payment processing events. The Bank Secrecy Act (BSA) and Anti-Money Laundering (AML) regulations require complete, tamper-evident records of all financial transactions for a minimum of five years. The synchronous architecture relied on application-level logging, which was fragmented across services and difficult to reconstruct for examiner requests.

2. **Tight Coupling**: Adding a new downstream consumer (for example, real-time analytics or a new regulatory report) required modifying the payment processing pipeline, increasing deployment risk and testing scope. Each new integration point added latency to the critical payment authorization path.

3. **Downstream Consumer Independence**: Different consumers have fundamentally different processing characteristics. Fraud detection requires sub-50ms response times, while regulatory reporting can tolerate hours of delay. The synchronous model forced all consumers into the same latency budget, creating unnecessary constraints.

4. **Failure Isolation**: A failure in any downstream consumer (such as the analytics service) could cascade into payment processing failures, violating the 99.99% availability SLA for the payments platform.

## Decision

We will adopt Apache Kafka 3.6 as the event streaming backbone for the Payments Gateway, implementing an event-driven architecture for all payment lifecycle state transitions.

### Key Design Decisions

- **Exactly-Once Semantics**: Kafka idempotent producers and transactional consumers ensure that payment events are processed exactly once, critical for financial accuracy.
- **Partition Strategy**: All topics are partitioned by `account_id` to guarantee ordered processing per account. The `payment-initiated` and `payment-authorized` topics use 64 partitions; settlement topics use 32 partitions.
- **Topic Design**: Five core topics model the payment lifecycle:
  - `fsi.payments.payment-initiated` — Emitted when a payment request is validated and accepted
  - `fsi.payments.payment-authorized` — Emitted upon successful authorization (card network response, Fedwire confirmation, etc.)
  - `fsi.payments.payment-settled` — Emitted when funds settlement is confirmed
  - `fsi.payments.payment-failed` — Emitted when a payment fails at any stage (with failure reason and stage)
  - `fsi.payments.payment-reversed` — Emitted for chargebacks, returns, and manual reversals
- **Schema Management**: All events use Apache Avro serialization with schemas registered in Confluent Schema Registry. BACKWARD compatibility mode ensures consumers can handle schema evolution without breaking.
- **Consumer Group Isolation**: Each downstream system operates in its own consumer group, enabling independent processing rates, offset management, and failure recovery. Fraud detection, regulatory reporting, reconciliation, analytics, and core banking settlement each maintain separate consumer groups.
- **Retention**: Operational topics retain messages for 7 days. Audit-relevant topics (`payment-authorized`, `payment-settled`, `payment-reversed`) retain messages for 90 days to support regulatory examination and dispute resolution.

## Consequences

### Positive

- **Complete Audit Trail**: The Kafka event log provides an immutable, ordered record of every payment state transition, directly satisfying PCI-DSS Requirement 10 and BSA/AML record-keeping obligations. Events can be replayed for examination support or incident investigation.
- **Service Decoupling**: New consumers can subscribe to payment events without modifying the payment processing pipeline. The addition of FedNow instant payment support in 2024 required zero changes to existing consumers.
- **Real-Time Fraud Detection**: The fraud detection service consumes `payment-initiated` events asynchronously, enabling parallel processing that reduced fraud screening from the critical authorization path for pre-screened merchants.
- **Event Replay**: Complete payment event history can be replayed to rebuild downstream state, recover from consumer failures, or populate new analytical systems. This capability was exercised during the data warehouse migration in Q3 2023.

### Negative

- **Infrastructure Complexity**: Operating Kafka at financial-grade reliability requires dedicated expertise in cluster management, monitoring, and capacity planning. The team invested in Kafka-specific training and hired two senior infrastructure engineers.
- **Eventual Consistency**: Downstream systems are eventually consistent with the payment processing state. Consumer lag monitoring (Kafka consumer group lag metric) and SLO alerting were implemented to ensure lag remains within acceptable bounds (under 30 seconds for fraud detection, under 5 minutes for analytics).
- **Monitoring Investment**: Comprehensive Kafka monitoring (broker health, partition balance, consumer lag, schema registry availability) required significant Datadog dashboard and PagerDuty alert configuration. The team maintains 47 Kafka-specific alert rules across production and DR environments.
