---
title: "Kafka Event Schema Catalog — Acme Financial Services"
---

<!-- title: Kafka Event Schema Catalog — Acme Financial Services | last-updated: 2025-03-15 | owner: Acme Financial Services | status: current -->

# Kafka Event Schema Catalog — Acme Financial Services

This document is the authoritative reference for all Kafka event schemas produced and consumed within Acme Financial Services (FSI). It covers event infrastructure conventions, the full event catalog, Avro schema definitions, and schema evolution rules.

---

## 1. Event Infrastructure

### 1.1 Schema Registry

All Kafka event schemas are managed via **Confluent Schema Registry** (v7.5), deployed alongside the Confluent Platform cluster on Azure Kubernetes Service.

| Setting | Value |
|---|---|
| Serialization Format | **Apache Avro** |
| Compatibility Mode | **BACKWARD** (per-subject) |
| Subject Naming Strategy | `TopicRecordNameStrategy` — subject = `{topic}-{fully.qualified.record.name}` |
| Schema Registry URL | `https://schema-registry.fsi.acme.internal:8081` |
| Authentication | mTLS (service certificates issued by Acme FSI Private CA) |

### 1.2 Naming Conventions

- **Topic naming**: `{domain}.{entity}.{action}` — all lowercase, dot-separated.
  - Examples: `banking.account.opened`, `payments.payment.authorized`, `risk.fraud-alert.raised`
- **Key format**: The message key is the primary business identifier for the entity, serialized as a plain string (UTF-8). This ensures co-partitioning for related events.
  - Examples: `account_id` for account events, `transaction_id` for transaction events, `alert_id` for fraud alerts.

### 1.3 Standard Event Headers

Every event message includes the following Kafka headers (UTF-8 string values):

| Header | Type | Description |
|---|---|---|
| `event_id` | `string` (UUID v4) | Globally unique identifier for this event instance |
| `event_type` | `string` | Fully qualified event type (e.g., `com.acme.fsi.banking.events.AccountOpened`) |
| `event_timestamp` | `string` (ISO 8601) | Timestamp when the event was produced |
| `source_service` | `string` | Producing service identifier (e.g., `core-banking-service`) |
| `correlation_id` | `string` (UUID v4) | Correlation ID for distributed tracing; propagated from the originating API request |
| `schema_version` | `string` | Schema version number (e.g., `3`) |

---

## 2. Event Catalog

The following table lists all events in the FSI Kafka cluster.

| Event | Topic | Key | Producer | Primary Consumers | Retention |
|---|---|---|---|---|---|
| `AccountOpened` | `banking.account.opened` | `account_id` | Core Banking Service | Risk Service, Wealth Service, Data Platform | 30 days |
| `AccountClosed` | `banking.account.closed` | `account_id` | Core Banking Service | Risk Service, Wealth Service, Data Platform | 30 days |
| `TransactionProcessed` | `banking.transaction.processed` | `transaction_id` | Core Banking Service | Payments Service, Risk Service, Data Platform | 14 days |
| `TransferInitiated` | `banking.transfer.initiated` | `transaction_id` | Core Banking Service | Payments Service, Fraud Detection Service | 14 days |
| `TransferCompleted` | `banking.transfer.completed` | `transaction_id` | Payments Service | Core Banking Service, Data Platform | 14 days |
| `PaymentAuthorized` | `payments.payment.authorized` | `transaction_id` | Payments Service | Core Banking Service, Risk Service, Data Platform | 14 days |
| `PaymentSettled` | `payments.payment.settled` | `transaction_id` | Payments Service | Core Banking Service, Data Platform | 14 days |
| `FraudAlertRaised` | `risk.fraud-alert.raised` | `alert_id` | Fraud Detection Service | Core Banking Service, Compliance Service, Data Platform | 90 days |
| `CreditScoreUpdated` | `risk.credit-score.updated` | `account_id` | Risk Engine Service | Core Banking Service (underwriting), Wealth Service | 30 days |
| `RegulatoryReportGenerated` | `compliance.regulatory-report.generated` | `report_id` | Compliance Service | Data Platform, Audit Service | 90 days |

**Partition counts** are sized per topic based on throughput requirements. High-volume topics (`banking.transaction.processed`, `payments.payment.authorized`) use 24 partitions; standard topics use 12 partitions.

---

## 3. Avro Schema Definitions

### 3.1 AccountOpened

```json
{
  "type": "record",
  "name": "AccountOpened",
  "namespace": "com.acme.fsi.banking.events",
  "doc": "Emitted when a new customer account is opened in the Core Banking system.",
  "fields": [
    {"name": "event_id", "type": "string", "doc": "UUID v4 unique event identifier"},
    {"name": "event_timestamp", "type": "string", "doc": "ISO 8601 timestamp of event creation"},
    {"name": "account_id", "type": "string", "doc": "Unique account identifier (e.g., AC-10042387)"},
    {"name": "customer_id", "type": "string", "doc": "Unique customer identifier"},
    {"name": "account_type", "type": {"type": "enum", "name": "AccountType", "symbols": ["CHECKING", "SAVINGS", "MONEY_MARKET", "CD", "LOAN", "LINE_OF_CREDIT"]}, "doc": "Type of account opened"},
    {"name": "product_code", "type": "string", "doc": "Internal product catalog code"},
    {"name": "currency", "type": "string", "default": "USD", "doc": "ISO 4217 currency code"},
    {"name": "branch_code", "type": ["null", "string"], "default": null, "doc": "Branch code where account was opened; null for digital-only"},
    {"name": "opened_by", "type": "string", "doc": "User or system identifier that initiated account opening"}
  ]
}
```

### 3.2 TransactionProcessed

```json
{
  "type": "record",
  "name": "TransactionProcessed",
  "namespace": "com.acme.fsi.banking.events",
  "doc": "Emitted after a debit or credit transaction is posted to an account.",
  "fields": [
    {"name": "event_id", "type": "string", "doc": "UUID v4 unique event identifier"},
    {"name": "event_timestamp", "type": "string", "doc": "ISO 8601 timestamp of event creation"},
    {"name": "transaction_id", "type": "string", "doc": "Unique transaction identifier"},
    {"name": "account_id", "type": "string", "doc": "Account to which the transaction was posted"},
    {"name": "transaction_type", "type": {"type": "enum", "name": "TransactionType", "symbols": ["DEBIT", "CREDIT", "REVERSAL", "ADJUSTMENT"]}, "doc": "Type of transaction"},
    {"name": "amount", "type": {"type": "bytes", "logicalType": "decimal", "precision": 18, "scale": 2}, "doc": "Transaction amount"},
    {"name": "currency", "type": "string", "default": "USD", "doc": "ISO 4217 currency code"},
    {"name": "running_balance", "type": {"type": "bytes", "logicalType": "decimal", "precision": 18, "scale": 2}, "doc": "Account balance after this transaction"},
    {"name": "description", "type": ["null", "string"], "default": null, "doc": "Human-readable transaction description"},
    {"name": "channel", "type": {"type": "enum", "name": "Channel", "symbols": ["BRANCH", "ATM", "ONLINE", "MOBILE", "ACH", "WIRE", "INTERNAL"]}, "doc": "Originating channel"},
    {"name": "posting_date", "type": "string", "doc": "Business date (YYYY-MM-DD) the transaction was posted"}
  ]
}
```

### 3.3 PaymentAuthorized

```json
{
  "type": "record",
  "name": "PaymentAuthorized",
  "namespace": "com.acme.fsi.payments.events",
  "doc": "Emitted when a payment transaction is authorized by the Payments Service.",
  "fields": [
    {"name": "event_id", "type": "string", "doc": "UUID v4 unique event identifier"},
    {"name": "event_timestamp", "type": "string", "doc": "ISO 8601 timestamp of event creation"},
    {"name": "transaction_id", "type": "string", "doc": "Unique payment transaction identifier"},
    {"name": "account_id", "type": "string", "doc": "Payer account identifier"},
    {"name": "amount", "type": {"type": "bytes", "logicalType": "decimal", "precision": 18, "scale": 2}, "doc": "Authorized payment amount"},
    {"name": "currency", "type": "string", "default": "USD", "doc": "ISO 4217 currency code"},
    {"name": "payment_type", "type": {"type": "enum", "name": "PaymentType", "symbols": ["ACH", "WIRE", "RTP", "CHECK", "CARD", "INTERNAL_TRANSFER"]}, "doc": "Payment rail or method"},
    {"name": "merchant_category_code", "type": ["null", "string"], "default": null, "doc": "MCC code for card payments; null for non-card"},
    {"name": "authorization_code", "type": "string", "doc": "Authorization reference code"},
    {"name": "fraud_score", "type": "double", "doc": "Fraud probability score (0.0–1.0) from the real-time scoring engine"},
    {"name": "screening_result", "type": {"type": "enum", "name": "ScreeningResult", "symbols": ["PASS", "REVIEW", "BLOCK"]}, "doc": "Result of sanctions and AML screening"}
  ]
}
```

### 3.4 TransferCompleted

```json
{
  "type": "record",
  "name": "TransferCompleted",
  "namespace": "com.acme.fsi.payments.events",
  "doc": "Emitted when a fund transfer has been fully settled between accounts.",
  "fields": [
    {"name": "event_id", "type": "string", "doc": "UUID v4 unique event identifier"},
    {"name": "event_timestamp", "type": "string", "doc": "ISO 8601 timestamp of event creation"},
    {"name": "transaction_id", "type": "string", "doc": "Unique transfer transaction identifier"},
    {"name": "source_account_id", "type": "string", "doc": "Originating account identifier"},
    {"name": "destination_account_id", "type": "string", "doc": "Receiving account identifier"},
    {"name": "amount", "type": {"type": "bytes", "logicalType": "decimal", "precision": 18, "scale": 2}, "doc": "Transfer amount"},
    {"name": "currency", "type": "string", "default": "USD", "doc": "ISO 4217 currency code"},
    {"name": "transfer_type", "type": {"type": "enum", "name": "TransferType", "symbols": ["INTERNAL", "ACH", "WIRE", "RTP"]}, "doc": "Transfer rail"},
    {"name": "settlement_date", "type": "string", "doc": "Business date (YYYY-MM-DD) the transfer settled"},
    {"name": "status", "type": {"type": "enum", "name": "TransferStatus", "symbols": ["COMPLETED", "RETURNED", "REVERSED"]}, "doc": "Final disposition of the transfer"}
  ]
}
```

### 3.5 FraudAlertRaised

```json
{
  "type": "record",
  "name": "FraudAlertRaised",
  "namespace": "com.acme.fsi.risk.events",
  "doc": "Emitted when the Fraud Detection Service raises an alert on suspicious activity.",
  "fields": [
    {"name": "event_id", "type": "string", "doc": "UUID v4 unique event identifier"},
    {"name": "event_timestamp", "type": "string", "doc": "ISO 8601 timestamp of event creation"},
    {"name": "alert_id", "type": "string", "doc": "Unique fraud alert identifier"},
    {"name": "account_id", "type": "string", "doc": "Account under investigation"},
    {"name": "transaction_id", "type": ["null", "string"], "default": null, "doc": "Related transaction ID, if alert was triggered by a specific transaction"},
    {"name": "risk_score", "type": "double", "doc": "Composite risk score (0.0–1.0)"},
    {"name": "alert_type", "type": {"type": "enum", "name": "FraudAlertType", "symbols": ["TRANSACTION_ANOMALY", "VELOCITY_BREACH", "GEO_ANOMALY", "ACCOUNT_TAKEOVER", "FABRICATED_IDENTITY", "MULE_ACTIVITY"]}, "doc": "Category of fraud alert"},
    {"name": "rules_triggered", "type": {"type": "array", "items": "string"}, "doc": "List of rule IDs that triggered this alert (e.g., ['RULE-VEL-001', 'RULE-GEO-042'])"},
    {"name": "disposition", "type": {"type": "enum", "name": "AlertDisposition", "symbols": ["OPEN", "INVESTIGATING", "CONFIRMED_FRAUD", "FALSE_POSITIVE", "ESCALATED"]}, "doc": "Current disposition of the alert"}
  ]
}
```

### 3.6 CreditScoreUpdated

```json
{
  "type": "record",
  "name": "CreditScoreUpdated",
  "namespace": "com.acme.fsi.risk.events",
  "doc": "Emitted when an account's internal credit risk score is recalculated.",
  "fields": [
    {"name": "event_id", "type": "string", "doc": "UUID v4 unique event identifier"},
    {"name": "event_timestamp", "type": "string", "doc": "ISO 8601 timestamp of event creation"},
    {"name": "account_id", "type": "string", "doc": "Account whose credit score was updated"},
    {"name": "customer_id", "type": "string", "doc": "Customer identifier"},
    {"name": "previous_score", "type": ["null", "int"], "default": null, "doc": "Previous credit score; null if first calculation"},
    {"name": "new_score", "type": "int", "doc": "Updated credit score (300–850 internal scale)"},
    {"name": "score_change", "type": "int", "default": 0, "doc": "Delta between previous and new score"},
    {"name": "model_version", "type": "string", "doc": "Version of the credit scoring model used (e.g., 'csm-v3.2.1')"},
    {"name": "risk_grade", "type": {"type": "enum", "name": "RiskGrade", "symbols": ["AAA", "AA", "A", "BBB", "BB", "B", "CCC", "CC", "C", "D"]}, "doc": "Risk grade derived from the score"},
    {"name": "contributing_factors", "type": {"type": "array", "items": "string"}, "doc": "Top factors influencing the score (e.g., ['PAYMENT_HISTORY', 'UTILIZATION_RATIO', 'DELINQUENCY'])"}
  ]
}
```

---

## 4. Schema Evolution Rules

All schema changes must follow these rules to maintain backward compatibility and prevent consumer breakage.

### 4.1 Allowed Changes

| Change Type | Allowed? | Conditions |
|---|---|---|
| Add a new field | ✅ Yes | Field **must** have a `default` value or be a union with `null` (i.e., `["null", "type"]`). |
| Add a new enum symbol | ✅ Yes | New symbols must be appended to the **end** of the `symbols` array. Consumers must handle unknown enum values gracefully (log and skip). |
| Add a new `doc` string | ✅ Yes | Documentation-only change; no impact on serialization. |
| Widen a type (e.g., `int` → `long`) | ✅ Yes | Only for Avro-supported type promotions (`int` → `long`, `float` → `double`). |

### 4.2 Prohibited Changes

| Change Type | Allowed? | Reason |
|---|---|---|
| Remove an existing field | ❌ No | Breaks consumers that depend on the field. |
| Rename an existing field | ❌ No | Avro resolves by field name; renaming is equivalent to remove + add. |
| Change a field's type (non-promotion) | ❌ No | Causes deserialization errors in consumers. |
| Remove an enum symbol | ❌ No | Consumers holding data with the removed symbol cannot deserialize. |
| Reorder enum symbols | ❌ No | Avro encodes enums by ordinal position; reordering changes the wire format. |
| Change a field from optional to required | ❌ No | Older messages without the field will fail deserialization. |

### 4.3 Schema Review Process

1. **Author** submits a schema change via pull request to the `fsi-event-schemas` repository.
2. **CI pipeline** runs `confluent schema-registry compatibility check` against the Schema Registry's stored schema. The PR is blocked if the compatibility check fails.
3. **Peer review**: At least one member of the producing team and one member of the consuming team must approve the PR.
4. **Merge and deploy**: On merge to `main`, the CI/CD pipeline registers the new schema version in Schema Registry. The new version becomes the latest for that subject.
5. **Consumer notification**: A Slack notification is posted to `#fsi-event-schemas` with the schema diff and migration notes.

### 4.4 Versioning Semantics

Schema versions in the Confluent Schema Registry are auto-incremented integers (v1, v2, v3, …). The `schema_version` Kafka header on each produced message reflects the registry version used at serialization time. Consumers using the Avro deserializer with Schema Registry automatically resolve to the correct reader schema via the embedded schema ID in the message payload (Confluent wire format: magic byte + 4-byte schema ID + Avro payload).

---

## 5. Consumer Best Practices

- **Use specific Avro reader schemas**: Consumers should compile their reader schema from the `fsi-event-schemas` repository at build time. The Avro deserializer performs automatic schema resolution between the writer and reader schemas.
- **Handle unknown enum values**: When an enum field contains a symbol not in the consumer's reader schema, the consumer should log a warning and skip processing rather than fail.
- **Idempotency**: Every event carries a unique `event_id`. Consumers must use `event_id` for idempotent processing (e.g., deduplication via a processed-event store or Kafka consumer offset management).
- **Ordering guarantees**: Events for the same entity are partitioned by the entity's key (e.g., `account_id`). Consumers can rely on per-partition ordering but must not assume global ordering across partitions.
- **Dead-letter topics**: Consumers should route messages that fail deserialization or business validation to a dead-letter topic (`{original_topic}.dlq`) for manual review. Dead-letter topics have a 30-day retention.

---

*For questions about event schemas or to request a new event type, contact the FSI Event Platform team via `#fsi-event-platform` on Slack or submit a request through the `fsi-event-schemas` repository.*
