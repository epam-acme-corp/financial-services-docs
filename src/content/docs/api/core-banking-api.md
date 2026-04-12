---
title: "Core Banking API Specification"
---

<!-- title: Core Banking API Specification | last-updated: 2025-03-15 | owner: Acme Financial Services | status: current -->

# Core Banking API Specification

## Overview

The Acme Financial Services Core Banking API provides programmatic access to account management, fund transfers, balance inquiries, transaction history, and customer data operations. This API serves as the primary integration layer between Acme's core ledger systems and upstream channels including online banking, mobile applications, branch teller workstations, and partner integrations.

All endpoints described in this document are internal to Acme's private network and are not exposed to external consumers directly. Channel-facing gateway teams must proxy through the API Gateway tier, which enforces additional rate limiting, IP allowlisting, and channel-specific authentication policies.

This specification covers version 2 of the Core Banking API, which replaces the legacy v1 SOAP-based interfaces that were retired in Q4 2024.

---

## General Conventions

### Base URL

All endpoints are served from the following base URL:

```
https://api.internal.afs.acme.com/api/v2/banking
```

Environment-specific base URLs follow the pattern `https://api.internal.afs.acme.com/api/v2/banking` for production, with `staging` and `uat` subdomains available for pre-production environments.

### Content Type

All request and response bodies use JSON encoding. Clients must include the `Content-Type: application/json` header on all requests that carry a body, and should include `Accept: application/json` on all requests.

### Authentication

The API uses OAuth 2.0 with the client credentials grant for service-to-service authentication. Access tokens are issued by the Acme Identity Platform at `https://auth.internal.acme.com/oauth2/token` and must be included in the `Authorization` header as a Bearer token.

Tokens are scoped to specific operations. The required scope for each endpoint is documented alongside its description. Token lifetime is 3600 seconds by default; clients should implement token caching and refresh logic accordingly.

### Idempotency

All mutating operations (POST, PUT, PATCH) require an `Idempotency-Key` header containing a UUID v7 value. The server uses this key to guarantee exactly-once semantics for a rolling 72-hour window. If a duplicate `Idempotency-Key` is received within that window, the server returns the original response without re-executing the operation.

Clients that omit the `Idempotency-Key` header on mutating requests will receive a `400 Bad Request` response.

### Pagination

List endpoints use cursor-based pagination. Clients pass `cursor` and `limit` as query parameters:

| Parameter | Type   | Default | Maximum | Description                              |
|-----------|--------|---------|---------|------------------------------------------|
| `cursor`  | string | —       | —       | Opaque cursor from a previous response   |
| `limit`   | int    | 50      | 200     | Number of records to return per page      |

The response envelope for paginated endpoints includes a `pagination` object with `next_cursor` and `has_more` fields. When `has_more` is `false`, the client has reached the end of the result set.

### Error Handling

The API returns errors in RFC 7807 Problem Details format. All error responses include a `Content-Type: application/problem+json` header. See the dedicated [Error Format](#error-format) section for the full schema and examples.

### Rate Limiting

Clients are subject to rate limits enforced per OAuth client ID. The default limit is 500 requests per minute per client. Rate limit status is communicated through standard headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` (Unix epoch timestamp).

---

## Account API

The Account API provides operations for retrieving account details, creating new accounts, querying balances, and listing transaction history.

### Retrieve Account

Returns the full account record for a given account identifier.

**Endpoint:** `GET /accounts/{accountId}`

**Required Scope:** `banking.read.accounts`

**Path Parameters:**

| Parameter   | Type   | Description                          |
|-------------|--------|--------------------------------------|
| `accountId` | string | The unique account identifier (UUID) |

**Response: 200 OK**

```json
{
  "account_id": "a1f9c8e2-74b3-4d91-b6e0-3c58a7d1ef04",
  "customer_id": "cust-88214f6a-3b9e-41dc-a4c7-9f12d6e08b73",
  "account_type": "checking",
  "product_code": "CHK-PREMIER-001",
  "status": "active",
  "currency": "USD",
  "opened_date": "2022-06-15",
  "branch_code": "BR-NYC-042",
  "links": {
    "self": "/api/v2/banking/accounts/a1f9c8e2-74b3-4d91-b6e0-3c58a7d1ef04",
    "balance": "/api/v2/banking/accounts/a1f9c8e2-74b3-4d91-b6e0-3c58a7d1ef04/balance",
    "transactions": "/api/v2/banking/accounts/a1f9c8e2-74b3-4d91-b6e0-3c58a7d1ef04/transactions",
    "customer": "/api/v2/banking/customers/cust-88214f6a-3b9e-41dc-a4c7-9f12d6e08b73"
  }
}
```

The `status` field may contain one of the following values: `active`, `dormant`, `frozen`, `closed`, or `pending_closure`. The `product_code` maps to entries in the Product Catalog maintained by the Deposits Operations team.

### Create Account

Opens a new account for an existing customer. Account creation triggers an asynchronous KYC verification workflow if the customer's last verified KYC record is older than 12 months. When KYC re-verification is triggered, the account is created in `pending_kyc` status and transitions to `active` upon successful verification.

**Endpoint:** `POST /accounts`

**Required Scope:** `banking.write.accounts`

**Request Body:**

```json
{
  "customer_id": "cust-88214f6a-3b9e-41dc-a4c7-9f12d6e08b73",
  "account_type": "savings",
  "product_code": "SAV-HIGHYIELD-002",
  "initial_deposit": {
    "amount": "25000.00",
    "currency": "USD",
    "funding_source_account_id": "a1f9c8e2-74b3-4d91-b6e0-3c58a7d1ef04"
  }
}
```

**Response: 201 Created**

```json
{
  "account_id": "b7d4e1a3-9f28-4c6b-8a15-2e0d3f7c9b61",
  "customer_id": "cust-88214f6a-3b9e-41dc-a4c7-9f12d6e08b73",
  "account_type": "savings",
  "product_code": "SAV-HIGHYIELD-002",
  "status": "active",
  "currency": "USD",
  "opened_date": "2025-03-15",
  "branch_code": "BR-NYC-042",
  "kyc_status": "verified",
  "links": {
    "self": "/api/v2/banking/accounts/b7d4e1a3-9f28-4c6b-8a15-2e0d3f7c9b61",
    "balance": "/api/v2/banking/accounts/b7d4e1a3-9f28-4c6b-8a15-2e0d3f7c9b61/balance",
    "transactions": "/api/v2/banking/accounts/b7d4e1a3-9f28-4c6b-8a15-2e0d3f7c9b61/transactions"
  }
}
```

If the customer's KYC is stale, the `status` field will return `pending_kyc` instead of `active`, and a `kyc_status` of `pending_review` will be present. The calling service should poll the account endpoint or subscribe to the `account.kyc.completed` event via the Event Bus to detect the transition.

The `initial_deposit` object is optional. When provided, the system debits the specified `funding_source_account_id` and credits the newly created account atomically. If the funding source has insufficient available balance, the entire operation is rejected with a `422 Unprocessable Entity` error.

### Retrieve Account Balance

Returns the current and available balances for an account, including pending hold information.

**Endpoint:** `GET /accounts/{accountId}/balance`

**Required Scope:** `banking.read.accounts`

**Response: 200 OK**

```json
{
  "account_id": "a1f9c8e2-74b3-4d91-b6e0-3c58a7d1ef04",
  "current_balance": "142587.34",
  "available_balance": "139087.34",
  "pending_holds": "3500.00",
  "pending_transactions_count": 3,
  "as_of": "2025-03-15T14:32:07.891Z",
  "currency": "USD"
}
```

The `current_balance` reflects all posted transactions. The `available_balance` is the `current_balance` minus any `pending_holds` from authorization holds, regulatory freezes, or uncleared deposits. The `as_of` timestamp indicates the exact moment the balance was computed and should be displayed to end users for transparency.

Balance values are represented as strings to preserve decimal precision and avoid floating-point rounding issues. All monetary amounts across this API follow the same convention.

### List Account Transactions

Returns a paginated list of transactions for a given account, ordered by posting date descending.

**Endpoint:** `GET /accounts/{accountId}/transactions`

**Required Scope:** `banking.read.transactions`

**Query Parameters:**

| Parameter    | Type   | Default | Description                                           |
|--------------|--------|---------|-------------------------------------------------------|
| `cursor`     | string | —       | Opaque pagination cursor                              |
| `limit`      | int    | 50      | Number of transactions to return (max 200)            |
| `from_date`  | string | —       | Start date filter in ISO 8601 format (YYYY-MM-DD)     |
| `to_date`    | string | —       | End date filter in ISO 8601 format (YYYY-MM-DD)       |
| `type`       | string | —       | Filter by transaction type (debit, credit)            |

**Response: 200 OK**

```json
{
  "account_id": "a1f9c8e2-74b3-4d91-b6e0-3c58a7d1ef04",
  "transactions": [
    {
      "transaction_id": "txn-e9a14b3c-7d28-4f61-9c0e-5b8a2d3f17e6",
      "type": "debit",
      "amount": "1250.00",
      "currency": "USD",
      "description": "Wire transfer to Meridian Supplies LLC",
      "posting_date": "2025-03-15T09:14:22.000Z",
      "value_date": "2025-03-15",
      "balance_after": "142587.34",
      "category": "wire_transfer",
      "reference": "WR-20250315-0042"
    },
    {
      "transaction_id": "txn-3f7c8a12-b4e6-4d9a-a1c5-8e2d0f6b39a7",
      "type": "credit",
      "amount": "8400.00",
      "currency": "USD",
      "description": "ACH deposit - Payroll",
      "posting_date": "2025-03-14T06:00:00.000Z",
      "value_date": "2025-03-14",
      "balance_after": "143837.34",
      "category": "ach_credit",
      "reference": "ACH-20250314-PR-1187"
    }
  ],
  "pagination": {
    "next_cursor": "eyJwb3NpdGlvbiI6MjAsInNvcnQiOiJwb3N0aW5nX2RhdGUifQ==",
    "has_more": true
  }
}
```

Transaction records are immutable once posted. Reversals and corrections appear as separate transactions with a `related_transaction_id` field referencing the original entry.

---

## Transfer API

The Transfer API enables internal book transfers between Acme accounts and outbound wire transfers to external beneficiaries. All transfer operations are subject to fraud detection rules, velocity limits, and applicable sanctions screening.

### Internal Transfer

Moves funds between two accounts held within Acme Financial Services. Internal transfers settle synchronously and are reflected in both account balances immediately upon completion.

**Endpoint:** `POST /transfers/internal`

**Required Scope:** `banking.write.transfers`

**Request Body:**

```json
{
  "source_account_id": "a1f9c8e2-74b3-4d91-b6e0-3c58a7d1ef04",
  "destination_account_id": "b7d4e1a3-9f28-4c6b-8a15-2e0d3f7c9b61",
  "amount": "5000.00",
  "currency": "USD",
  "reference": "Monthly savings allocation",
  "memo": "March 2025 auto-sweep"
}
```

**Response: 200 OK**

```json
{
  "transfer_id": "xfr-d4e8f1a2-6b3c-4a79-9d15-7c0e2f8b4a63",
  "type": "internal",
  "status": "completed",
  "source_account_id": "a1f9c8e2-74b3-4d91-b6e0-3c58a7d1ef04",
  "destination_account_id": "b7d4e1a3-9f28-4c6b-8a15-2e0d3f7c9b61",
  "amount": "5000.00",
  "currency": "USD",
  "reference": "Monthly savings allocation",
  "memo": "March 2025 auto-sweep",
  "timestamps": {
    "created_at": "2025-03-15T14:45:12.334Z",
    "completed_at": "2025-03-15T14:45:12.891Z"
  }
}
```

Internal transfers between accounts with different currencies are not supported in v2. Cross-currency transfers must be routed through the FX Conversion API first, then transferred as a single-currency operation.

If the source account has insufficient available balance, the transfer is rejected with a `422 Unprocessable Entity` error. The system validates against the `available_balance`, not the `current_balance`, to account for pending holds.

### Wire Transfer

Initiates an outbound wire transfer to an external beneficiary. Wire transfers are processed asynchronously because they require OFAC sanctions screening, compliance review (for amounts exceeding $10,000), and network settlement through the Federal Reserve's Fedwire or SWIFT network.

**Endpoint:** `POST /transfers/wire`

**Required Scope:** `banking.write.transfers`

**Request Body:**

```json
{
  "source_account_id": "a1f9c8e2-74b3-4d91-b6e0-3c58a7d1ef04",
  "amount": "28750.00",
  "currency": "USD",
  "beneficiary": {
    "name": "Meridian Supplies LLC",
    "account_number": "7742001389",
    "bank_name": "First National Commerce Bank",
    "swift_bic": "FNCBUS33",
    "iban": null,
    "address": {
      "line1": "400 Commerce Boulevard",
      "line2": "Suite 210",
      "city": "Charlotte",
      "state": "NC",
      "postal_code": "28202",
      "country": "US"
    }
  },
  "purpose": "Invoice payment - INV-2025-03-0847",
  "regulatory_reporting": {
    "remittance_info": "Payment for consulting services rendered February 2025"
  }
}
```

**Response: 202 Accepted**

```json
{
  "transfer_id": "xfr-8c1d3e7f-2a4b-4f69-b5c8-1e9d0a6f3b72",
  "type": "wire",
  "status": "pending_screening",
  "source_account_id": "a1f9c8e2-74b3-4d91-b6e0-3c58a7d1ef04",
  "amount": "28750.00",
  "currency": "USD",
  "beneficiary": {
    "name": "Meridian Supplies LLC",
    "bank_name": "First National Commerce Bank",
    "swift_bic": "FNCBUS33"
  },
  "screening_result": {
    "ofac_status": "pending",
    "submitted_at": "2025-03-15T15:02:44.127Z"
  },
  "timestamps": {
    "created_at": "2025-03-15T15:02:44.127Z"
  },
  "links": {
    "self": "/api/v2/banking/transfers/xfr-8c1d3e7f-2a4b-4f69-b5c8-1e9d0a6f3b72",
    "status": "/api/v2/banking/transfers/xfr-8c1d3e7f-2a4b-4f69-b5c8-1e9d0a6f3b72/status"
  }
}
```

The `202 Accepted` status indicates the wire transfer has been received and queued for processing. The `pending_screening` status means the beneficiary is undergoing OFAC sanctions screening. Callers must poll the status endpoint or subscribe to the `transfer.status.updated` event to track the transfer through its lifecycle.

Wire transfer status transitions follow this sequence: `pending_screening` → `screening_cleared` → `pending_settlement` → `sent_to_network` → `completed`. If screening fails, the status transitions to `screening_held` and requires manual review by the Compliance team.

The `iban` field is required for transfers to beneficiaries in SEPA countries and optional for domestic US transfers. The `swift_bic` field is required for all international transfers.

### Retrieve Transfer Status

Returns the current status and full details of a transfer, including screening results and network references when available.

**Endpoint:** `GET /transfers/{transferId}/status`

**Required Scope:** `banking.read.transfers`

**Response: 200 OK**

```json
{
  "transfer_id": "xfr-8c1d3e7f-2a4b-4f69-b5c8-1e9d0a6f3b72",
  "type": "wire",
  "status": "completed",
  "amount": "28750.00",
  "currency": "USD",
  "timestamps": {
    "created_at": "2025-03-15T15:02:44.127Z",
    "screening_cleared_at": "2025-03-15T15:03:11.482Z",
    "sent_to_network_at": "2025-03-15T15:15:00.000Z",
    "completed_at": "2025-03-15T16:42:33.719Z"
  },
  "screening_result": {
    "ofac_status": "cleared",
    "cleared_at": "2025-03-15T15:03:11.482Z",
    "risk_score": 12
  },
  "network_reference": "FEDW20250315FNCBUS33004718",
  "source_account_id": "a1f9c8e2-74b3-4d91-b6e0-3c58a7d1ef04",
  "beneficiary_name": "Meridian Supplies LLC"
}
```

The `network_reference` field is populated once the wire has been submitted to the payment network. This reference can be shared with the beneficiary's bank for tracing purposes. The `risk_score` in the screening result is an integer from 0 to 100, where values above 75 trigger automatic escalation to the Compliance hold queue.

---

## Customer API

The Customer API provides access to customer profile data, including personally identifiable information (PII). Access to PII fields requires elevated scopes and is subject to audit logging per Acme's data governance policies.

### Retrieve Customer

Returns customer profile data. PII fields such as `date_of_birth`, `tax_id`, `phone`, and `email` are only included when the requesting client holds the `banking.read.pii` scope. Without this scope, those fields are omitted from the response.

**Endpoint:** `GET /customers/{customerId}`

**Required Scope:** `banking.read.customers` (base), `banking.read.pii` (for PII fields)

**Response: 200 OK** (with PII scope)

```json
{
  "customer_id": "cust-88214f6a-3b9e-41dc-a4c7-9f12d6e08b73",
  "first_name": "Margaret",
  "last_name": "Thornton",
  "date_of_birth": "1978-11-23",
  "tax_id": "***-**-4829",
  "email": "m.thornton@example.com",
  "phone": "+12125550147",
  "address": {
    "line1": "892 Lexington Avenue",
    "line2": "Apt 14C",
    "city": "New York",
    "state": "NY",
    "postal_code": "10065",
    "country": "US"
  },
  "kyc_status": "verified",
  "kyc_verified_date": "2024-09-12",
  "risk_rating": "standard",
  "segment": "premier",
  "relationship_manager_id": "emp-4421",
  "created_at": "2019-03-08T10:14:33.000Z"
}
```

The `tax_id` field is always partially masked in API responses, even with the PII scope. Full tax ID retrieval requires a separate request through the Secure Data Vault API with additional multi-factor authentication.

### Update Customer

Applies a partial update to a customer record. Only the fields included in the request body are modified; all other fields remain unchanged.

**Endpoint:** `PUT /customers/{customerId}`

**Required Scope:** `banking.write.customers`

**Request Body:**

```json
{
  "email": "margaret.thornton@example.com",
  "phone": "+12125550198",
  "address": {
    "line1": "1040 Park Avenue",
    "line2": "Unit 22B",
    "city": "New York",
    "state": "NY",
    "postal_code": "10028",
    "country": "US"
  }
}
```

**Response: 200 OK**

```json
{
  "customer_id": "cust-88214f6a-3b9e-41dc-a4c7-9f12d6e08b73",
  "updated_fields": ["email", "phone", "address"],
  "updated_at": "2025-03-15T16:58:02.441Z",
  "verification_required": false
}
```

Address changes for customers with a `risk_rating` of `elevated` or `high` trigger a mandatory re-verification workflow, indicated by `verification_required: true` in the response. The customer's status is temporarily set to `pending_review` until the verification is completed.

Fields that cannot be updated via this endpoint include `customer_id`, `tax_id`, `date_of_birth`, and `kyc_status`. Changes to these fields require submission through the regulated data amendment process managed by the Operations team.

---

## Error Format

All error responses conform to RFC 7807 (Problem Details for HTTP APIs). The response body includes standard fields defined by the specification, plus Acme-specific extensions for tracing and debugging.

**Example Error Response: 422 Unprocessable Entity**

```json
{
  "type": "https://api.internal.afs.acme.com/errors/insufficient-funds",
  "title": "Insufficient Funds",
  "status": 422,
  "detail": "The source account a1f9c8e2-74b3-4d91-b6e0-3c58a7d1ef04 has an available balance of $2,340.12, which is less than the requested transfer amount of $5,000.00.",
  "instance": "/api/v2/banking/transfers/internal",
  "trace_id": "tr-7f3a1b9e-4c82-4d6a-b0e5-9a2d8f1c3e74",
  "timestamp": "2025-03-15T14:45:12.334Z"
}
```

**Standard Error Types:**

| HTTP Status | Type URI Suffix              | Title                    | Description                                    |
|-------------|------------------------------|--------------------------|------------------------------------------------|
| 400         | `/errors/bad-request`        | Bad Request              | Malformed request body or missing required fields |
| 401         | `/errors/unauthorized`       | Unauthorized             | Missing or invalid Bearer token                |
| 403         | `/errors/forbidden`          | Forbidden                | Valid token but insufficient scope             |
| 404         | `/errors/not-found`          | Not Found                | Resource does not exist                        |
| 409         | `/errors/conflict`           | Conflict                 | Idempotency key reused with different payload  |
| 422         | `/errors/insufficient-funds` | Insufficient Funds       | Account lacks available balance for operation  |
| 422         | `/errors/account-frozen`     | Account Frozen           | Target account is in frozen status             |
| 429         | `/errors/rate-limited`       | Too Many Requests        | Client has exceeded rate limit                 |
| 500         | `/errors/internal`           | Internal Server Error    | Unexpected system failure                      |
| 503         | `/errors/service-unavailable`| Service Unavailable      | Downstream dependency timeout or outage        |

The `trace_id` extension field is present on all error responses and corresponds to the distributed trace identifier propagated through Acme's observability platform. Support teams can use this value to correlate errors with internal logs and spans.

---

## Versioning and Deprecation Policy

The Core Banking API follows semantic versioning for its URL path prefix. Breaking changes result in a new major version (e.g., `/v3/banking`). Non-breaking additions such as new optional fields or new endpoints are introduced within the current version without prior notice.

When a version is scheduled for deprecation, a `Sunset` header is included in all responses from the affected version, indicating the retirement date per RFC 8594. Clients are expected to migrate within the communicated timeline, which is typically no less than 12 months from the deprecation announcement.

---

## Changelog

| Date       | Version | Description                                                  |
|------------|---------|--------------------------------------------------------------|
| 2025-03-15 | 2.4.0   | Added `regulatory_reporting` field to wire transfer request  |
| 2025-01-20 | 2.3.0   | Introduced cursor-based pagination, replacing offset-based   |
| 2024-11-08 | 2.2.1   | Fixed `as_of` timestamp precision in balance responses       |
| 2024-09-30 | 2.2.0   | Added `risk_score` to OFAC screening result                  |
| 2024-07-15 | 2.1.0   | Added customer partial update endpoint                       |
| 2024-04-01 | 2.0.0   | Initial v2 release replacing legacy SOAP interfaces          |
