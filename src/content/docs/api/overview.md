---
title: "API Landscape Overview — Acme Financial Services"
---

<!-- title: API Landscape Overview — Acme Financial Services | last-updated: 2025-03-15 | owner: Acme Financial Services | status: current -->

# API Landscape Overview — Acme Financial Services

This document provides an overview of the Acme Financial Services (FSI) API landscape, covering the service catalog, authentication mechanisms, gateway architecture, rate-limiting policies, and versioning strategy. It is the primary reference for internal developers, partner integrators, and API governance stakeholders.

---

## 1. API Catalog

Acme FSI exposes four primary API domains, each backed by dedicated Spring Boot 3 (Java 17) microservices.

| API Domain | Base Path | Transport | Auth Model | Primary Consumers | Service Runtime |
|---|---|---|---|---|---|
| **Core Banking** | `/api/v2/banking` | REST (JSON) | OAuth 2.0 Client Credentials | Payments service, Risk service, Internal back-office | Spring Boot 3.2 / Java 17 |
| **Payments** | `/api/v1/payments` | REST (JSON) | OAuth 2.0 Client Credentials | Core Banking, Partner banks (ISO 20022 adapters) | Spring Boot 3.2 / Java 17 |
| **Risk** | `/api/v1/risk` | REST (JSON) | OAuth 2.0 Client Credentials | Core Banking (underwriting), Compliance | Python 3.11 / FastAPI |
| **Wealth Management** | `/api/v1/wealth` | REST (JSON) | OAuth 2.0 Authorization Code + PKCE | Wealth advisors (React 18 SPA), Client mobile app | Spring Boot 3.2 / Java 17 |

All APIs follow OpenAPI 3.1 specification. Specifications are published to the internal developer portal and are the source of truth for contract testing.

---

## 2. Authentication and Authorization

### 2.1 Service-to-Service (Internal)

Internal service-to-service calls use **OAuth 2.0 Client Credentials** flow, issued by **Azure Active Directory (Azure AD)**.

- Each microservice is registered as an Azure AD **App Registration** with a unique `client_id`.
- Tokens are requested against the resource audience URI (e.g., `api://fsi-core-banking-prod`).
- Access tokens are **JWT** format, signed with RS256, and have a **1-hour expiry**.
- Services validate tokens locally using the Azure AD JWKS endpoint. Token claims (`roles`, `scp`) are used for fine-grained authorization.
- Client secrets are stored in **Azure Key Vault** and rotated every 90 days via automated pipeline.

### 2.2 External Partner Access

External partner integrations (e.g., partner banks, clearing networks) require **mutual TLS (mTLS)** in addition to OAuth 2.0.

- Partners are issued a client certificate signed by the Acme FSI Private CA.
- Certificate validity is **1 year**. Rotation begins 60 days before expiry, coordinated by the Partner Integration team.
- The API Gateway (Azure APIM) terminates the mTLS connection, validates the client certificate against a trusted certificate store, and maps the certificate thumbprint to the partner's Azure AD App Registration.
- Partner traffic is routed to a dedicated APIM **product** with partner-specific rate limits and policies.

### 2.3 User-Facing (Wealth Management)

The Wealth Management portal and mobile application authenticate end users via **OAuth 2.0 Authorization Code with PKCE**, issued by **Azure AD B2C**.

- Users authenticate through Azure AD B2C custom policies supporting email/password and federated identity providers.
- **Multi-Factor Authentication (MFA)** is required for all user sessions. Azure AD B2C enforces TOTP or SMS as the second factor.
- Access tokens have a **1-hour expiry**. Refresh tokens have a **24-hour expiry** with sliding window.
- Token scopes are mapped to user roles (`wealth.read`, `wealth.trade`, `wealth.admin`) enforced by the API layer.
- Session management: the React 18 SPA uses `@azure/msal-react` for silent token renewal. The mobile app uses platform-native MSAL libraries.

---

## 3. API Gateway — Azure API Management

All API traffic — internal and external — routes through **Azure API Management (APIM)**, deployed in the internal VNet (Premium tier).

### 3.1 Gateway Responsibilities

| Responsibility | Implementation |
|---|---|
| **Authentication** | JWT validation (Azure AD / Azure AD B2C), mTLS termination for partner traffic |
| **Rate Limiting** | Per-subscription rate limiting via APIM policies (see Section 4) |
| **Request/Response Logging** | All requests logged to Azure Event Hubs → Splunk for security monitoring and audit |
| **API Analytics** | Azure APIM built-in analytics dashboard; custom metrics forwarded to Azure Monitor / Grafana |
| **SSL/TLS Termination** | TLS 1.3 enforced on external endpoints; TLS 1.2 minimum on internal |
| **Request Transformation** | Header injection (correlation ID, request timestamp), payload validation against OpenAPI spec |
| **Circuit Breaking** | Backend health probes with automatic circuit break on 5xx error rate > 10% over 60 seconds |

### 3.2 Internal vs. External Routing

- **Internal traffic**: Routed via Azure Private Endpoints. No public internet exposure. APIM validates the Azure AD token and forwards to the backend service via the internal load balancer.
- **External traffic**: Enters through Azure Front Door (WAF-enabled) → APIM external gateway. Azure Front Door enforces geo-filtering, DDoS protection, and bot detection before traffic reaches APIM.
- **Partner traffic**: Dedicated APIM product (`fsi-partner-apis`) with mTLS policy, separate subscription keys, and partner-specific rate limits.

---

## 4. Rate Limiting

Rate limits are enforced at the API Gateway (APIM) level using the `rate-limit-by-key` policy, keyed by subscription ID.

| Tier | Applies To | Requests / Minute | Burst (Requests / Second) | Quota (Requests / Day) | Retry Behavior |
|---|---|---|---|---|---|
| **Internal Tier 1** | Core Banking ↔ Payments, Core Banking ↔ Risk | 10,000 | 500 | Unlimited | N/A (internal SLA) |
| **Internal Tier 2** | Non-critical internal consumers (reporting, back-office tools) | 5,000 | 200 | Unlimited | N/A |
| **External Partner** | Partner banks, clearing networks | 1,000 | 50 | 500,000 | HTTP `429 Too Many Requests` with `Retry-After` header |
| **Wealth User** | End-user sessions (Wealth portal, mobile app) | 300 | 20 | 50,000 | HTTP `429 Too Many Requests` with `Retry-After` header |

**HTTP 429 response format:**

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Please retry after the specified interval.",
    "retryAfterSeconds": 12
  }
}
```

The `Retry-After` HTTP header is included in all 429 responses, indicating the number of seconds the client should wait before retrying. Clients that repeatedly exceed limits are flagged for review by the API Governance team.

---

## 5. API Versioning Strategy

### 5.1 Versioning Scheme

Acme FSI uses **URL-based versioning** with a major version segment in the base path:

```
/api/v1/payments/transfers
/api/v2/banking/accounts
```

- **Major version** increments indicate breaking changes (e.g., removed fields, changed semantics, restructured endpoints).
- **Non-breaking changes** (new optional fields, new endpoints, additional enum values) are released within the current major version without a version bump.

### 5.2 Lifecycle Policy

| Phase | Duration | Description |
|---|---|---|
| **Current** | Ongoing | The latest major version. Receives all new features and bug fixes. |
| **Supported** | 12 months from next major release | Previous major version. Receives security patches and critical bug fixes only. No new features. |
| **Deprecated** | 6-month notice period | Announced via developer portal, API response header (`Deprecation: true`, `Sunset: <date>`), and direct notification to registered consumers. |
| **Retired** | After deprecation period | Endpoint returns `410 Gone`. Traffic is blocked at the gateway. |

### 5.3 Current Version Status

| API Domain | Current Version | Previous Version | Previous Version Sunset Date |
|---|---|---|---|
| Core Banking | v2 | v1 (Deprecated) | 2025-09-30 |
| Payments | v1 | — | — |
| Risk | v1 | — | — |
| Wealth Management | v1 | — | — |

Deprecation announcements and migration guides are published on the FSI Developer Portal at `https://developer.acme.com/fsi`.

---

## 6. Cross-Cutting Concerns

### 6.1 Observability

- **Distributed tracing**: All services propagate W3C Trace Context headers. Traces are collected via OpenTelemetry SDK and exported to Azure Monitor Application Insights.
- **Correlation ID**: Every request is assigned a `X-Correlation-Id` header at the gateway. This ID is propagated through all downstream calls and included in log entries.
- **Health checks**: Each service exposes `/actuator/health` (Spring Boot) or `/health` (FastAPI) endpoints, probed by Azure Load Balancer and APIM backend health checks.

### 6.2 Error Response Standard

All APIs follow RFC 7807 (`application/problem+json`) for error responses:

```json
{
  "type": "https://developer.acme.com/fsi/errors/insufficient-funds",
  "title": "Insufficient Funds",
  "status": 422,
  "detail": "Account AC-10042387 has insufficient available balance for the requested transfer amount.",
  "instance": "/api/v2/banking/transfers/TXN-9928371",
  "correlationId": "d4f8c3a1-7b2e-4e9f-a1c3-8d7e6f5a4b3c"
}
```

---

*For API onboarding, access requests, or technical support, contact the FSI API Platform team via `#fsi-api-platform` on Slack or email `fsi-api-platform@acme.com`.*
