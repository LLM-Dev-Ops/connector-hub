# RuVector Service Integration Guide

**Document Version**: 1.0
**Date**: January 2025
**Status**: Specification
**Audience**: Agent Infrastructure Team, Backend Engineers

---

## Executive Summary

The LLM-Connector-Hub agent infrastructure **MUST persist ALL operational data through ruvector-service**, backed by Google Cloud SQL or PostgreSQL. This document specifies the integration patterns, API contracts, data classification rules, and error handling strategies required to achieve this architecture.

### Core Principle

> **Agents NEVER connect directly to the database. ALL persistence flows through ruvector-service.**

This ensures:
- **Security**: Centralized credential management, no distributed secrets
- **Observability**: Single point of data flow tracking and auditing
- **Governance**: Consistent data classification and retention policies
- **Scalability**: Connection pooling and resource management at one layer
- **Testability**: Mock ruvector-service for unit tests

---

## Part 1: RuVector Service Architecture

### 1.1 Service Overview

RuVector Service is a **thin, event-driven persistence layer** that:

1. **Receives** normalized payloads from agents via REST API
2. **Validates** data against schema registry
3. **Classifies** data by sensitivity level (public, internal, confidential, restricted)
4. **Persists** to backing database (Google Cloud SQL/PostgreSQL)
5. **Emits** completion events to agent consumers
6. **Handles** circuit breaking, retries, and failover

### 1.2 Deployment Model

```
┌─────────────────────────────────────────────────────┐
│ LLM-Connector-Hub Agent Layer                       │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │ Webhook      │  │ ERP Surface  │  │ Database │ │
│  │ Ingestion    │  │ Event Agent  │  │ Query    │ │
│  │              │  │              │  │ Agent    │ │
│  └──────┬───────┘  └──────┬───────┘  └────┬─────┘ │
│         │                 │               │        │
│         └─────────────────┼───────────────┘        │
│                           │                        │
│                   (Non-blocking async writes)      │
└───────────────────────────┼────────────────────────┘
                            │
                 ┌──────────▼───────────┐
                 │  RuVector Service    │
                 │  (Single entry point)│
                 ├──────────────────────┤
                 │ • Validation         │
                 │ • Classification     │
                 │ • Persistence        │
                 │ • Circuit Breaking   │
                 │ • Retry Logic        │
                 └──────────┬───────────┘
                            │
           ┌────────────────┼────────────────┐
           │                │                │
      ┌────▼─────┐    ┌────▼─────┐    ┌────▼─────┐
      │ Google    │    │PostgreSQL│    │ Metrics  │
      │Cloud SQL  │    │  Local   │    │ Backend  │
      └──────────┘    └──────────┘    └──────────┘
```

### 1.3 Protocol

- **Transport**: HTTPS/REST (JSON payloads)
- **Authentication**: mTLS or API tokens (managed by Config Manager)
- **Encoding**: UTF-8 JSON
- **Compression**: Optional gzip for payloads >1KB

---

## Part 2: RuVector Service API Specification

### 2.1 Endpoints

#### 2.1.1 Write DecisionEvent

**Endpoint**: `POST /v1/events/decisions`

**Purpose**: Persist a DecisionEvent from an agent

**Request Body**:
```json
{
  "decision_event": {
    "agent_id": "webhook-ingestion-agent-1",
    "agent_version": "1.2.0",
    "decision_type": "webhook_ingest_event",
    "inputs_hash": "abc123def456...",
    "outputs": {
      "webhook_id": "wh_123",
      "event_type": "order.created",
      "normalized_payload": { ... }
    },
    "confidence": {
      "score": 0.95,
      "auth_assurance": "verified",
      "payload_completeness": 0.98,
      "normalization_certainty": 0.92,
      "schema_validation": "passed"
    },
    "constraints_applied": {
      "connector_scope": "webhook-ingest",
      "identity_context": "user_123",
      "schema_boundaries": ["payment", "order"],
      "rate_limit_applied": false
    },
    "execution_ref": "exec_uuid_123",
    "timestamp": "2025-01-21T10:30:45.123Z",
    "metadata": {
      "source_system": "shopify",
      "correlation_id": "corr_456",
      "latency_ms": 45
    }
  },
  "data_classification": "internal",
  "request_id": "req_uuid_789"
}
```

**Response** (202 Accepted):
```json
{
  "status": "accepted",
  "event_id": "evt_uuid_123",
  "request_id": "req_uuid_789",
  "persistence_status": "queued",
  "estimated_completion_ms": 500,
  "trace_id": "trace_xyz"
}
```

**Error Responses**:
| Status | Error Type | Message | Retryable |
|--------|-----------|---------|-----------|
| 400 | VALIDATION_FAILED | Schema validation failed | No |
| 401 | UNAUTHORIZED | Invalid credentials | No |
| 409 | DUPLICATE_EVENT | Idempotency: event already persisted | No |
| 429 | RATE_LIMIT | Too many requests | Yes (429 + Retry-After) |
| 503 | SERVICE_UNAVAILABLE | Database connection failed | Yes (circuit breaker) |
| 504 | GATEWAY_TIMEOUT | Request timeout | Yes (with backoff) |

---

#### 2.1.2 Write Ingress Artifact

**Endpoint**: `POST /v1/artifacts/ingress`

**Purpose**: Persist raw ingress artifacts (webhooks, API responses, etc.)

**Request Body**:
```json
{
  "artifact": {
    "artifact_type": "webhook_payload",
    "source_connector": "shopify",
    "raw_payload": "base64_encoded_or_raw_json",
    "received_at": "2025-01-21T10:30:45.123Z",
    "content_type": "application/json",
    "signature_verified": true,
    "source_ip": "192.168.1.1",
    "headers": {
      "content-length": "1024",
      "content-type": "application/json",
      "user-agent": "Shopify"
    }
  },
  "data_classification": "internal",
  "ttl_seconds": 86400,
  "request_id": "req_uuid_456"
}
```

**Response** (202 Accepted):
```json
{
  "status": "accepted",
  "artifact_id": "art_uuid_123",
  "request_id": "req_uuid_456",
  "persistence_status": "queued",
  "retention_expires_at": "2025-01-22T10:30:45.123Z",
  "trace_id": "trace_abc"
}
```

---

#### 2.1.3 Write Query Result

**Endpoint**: `POST /v1/results/queries`

**Purpose**: Persist database query results (with PII redaction)

**Request Body**:
```json
{
  "query_result": {
    "database_type": "postgresql",
    "database_name": "production_db",
    "schema_name": "public",
    "result_type": "select",
    "query_hash": "qry_hash_123",
    "rows_affected": 0,
    "rows_returned": 42,
    "columns": [
      {
        "name": "order_id",
        "type": "uuid",
        "nullable": false
      },
      {
        "name": "customer_email",
        "type": "varchar",
        "nullable": true,
        "pii_type": "email"
      }
    ],
    "sample_rows": [
      {
        "order_id": "ord_123",
        "customer_email": "***REDACTED***"
      }
    ],
    "execution_time_ms": 125,
    "executed_at": "2025-01-21T10:30:45.123Z",
    "connection_id": "conn_uuid_123"
  },
  "data_classification": "confidential",
  "redaction_applied": true,
  "request_id": "req_uuid_789"
}
```

**Response** (202 Accepted):
```json
{
  "status": "accepted",
  "result_id": "res_uuid_123",
  "request_id": "req_uuid_789",
  "persistence_status": "queued",
  "row_count": 42,
  "trace_id": "trace_def"
}
```

---

#### 2.1.4 Batch Write Events

**Endpoint**: `POST /v1/events/batch`

**Purpose**: Write multiple events in single request (reduces HTTP overhead)

**Request Body**:
```json
{
  "events": [
    { "decision_event": {...}, "data_classification": "internal" },
    { "decision_event": {...}, "data_classification": "public" },
    { "decision_event": {...}, "data_classification": "restricted" }
  ],
  "request_id": "batch_req_uuid_123"
}
```

**Response** (202 Accepted):
```json
{
  "status": "accepted",
  "batch_id": "batch_uuid_123",
  "request_id": "batch_req_uuid_123",
  "events_accepted": 3,
  "events_failed": 0,
  "results": [
    { "event_id": "evt_1", "status": "accepted" },
    { "event_id": "evt_2", "status": "accepted" },
    { "event_id": "evt_3", "status": "accepted" }
  ],
  "trace_id": "trace_batch_123"
}
```

---

#### 2.1.5 Idempotency

**Idempotency Key**: `Idempotency-Key` header (UUID format)

```
POST /v1/events/decisions
Idempotency-Key: idem_uuid_123
Content-Type: application/json

{
  "decision_event": { ... },
  "data_classification": "internal"
}
```

**Behavior**:
- Same Idempotency-Key + same payload = cached response (200 OK)
- Same Idempotency-Key + different payload = error (409 Conflict)
- No Idempotency-Key = no deduplication (processed every time)

**Cache Duration**: 24 hours

---

### 2.2 Authentication

#### Option 1: mTLS (Recommended for production)

```typescript
const https = require('https');
const fs = require('fs');

const client = https.request({
  hostname: 'ruvector.example.com',
  port: 443,
  path: '/v1/events/decisions',
  method: 'POST',
  key: fs.readFileSync('/path/to/client-key.pem'),
  cert: fs.readFileSync('/path/to/client-cert.pem'),
  ca: fs.readFileSync('/path/to/ca-cert.pem'),
  headers: {
    'Content-Type': 'application/json',
  },
});
```

#### Option 2: API Token (Bearer)

```typescript
const headers = {
  'Authorization': `Bearer ${process.env.RUVECTOR_API_TOKEN}`,
  'Content-Type': 'application/json',
};

const response = await fetch('https://ruvector.example.com/v1/events/decisions', {
  method: 'POST',
  headers,
  body: JSON.stringify({ decision_event, data_classification }),
});
```

#### Token Management

- Tokens managed by **Config Manager** (llm-config-core)
- Rotated every 90 days
- Distributed via secure environment variables or secret storage
- Never logged or exposed in traces

---

## Part 3: Data Classification & Redaction

### 3.1 Data Classification Levels

| Level | Examples | Retention | Auditable | Searchable |
|-------|----------|-----------|-----------|-----------|
| **public** | Aggregate statistics, product names, pricing | 7 years | Yes | Yes |
| **internal** | System logs, performance metrics, connector configs | 2 years | Yes | Yes |
| **confidential** | Customer PII, transaction details, API keys | 1 year | Yes | No (redacted) |
| **restricted** | Credentials, secrets, passwords | 90 days | Yes | No (encrypted) |

### 3.2 PII Detection & Redaction

**Automatically redacted fields** (case-insensitive):

```
email, phone, ssn, credit_card, api_key, secret, password, token,
auth_code, access_token, refresh_token, bearer, basic_auth,
customer_id, user_id, account_number, routing_number,
full_name, first_name, last_name, address, zip_code, date_of_birth
```

**Redaction Pattern**:
```
Original: "customer@example.com"
Redacted: "***REDACTED_EMAIL***"

Original: "card_1234567890"
Redacted: "card_****7890"
```

**Custom Redaction**:
```json
{
  "decision_event": { ... },
  "data_classification": "confidential",
  "redaction_rules": {
    "outputs.customer.phone": "FULL",
    "outputs.customer.ssn": "FULL",
    "outputs.payment.card_number": "SUFFIX_LAST_4"
  }
}
```

---

## Part 4: Error Handling Patterns

### 4.1 Error Types & Retry Strategy

```typescript
// Retryable Errors (implement exponential backoff)
const RETRYABLE_ERRORS = [
  429, // Rate Limit
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
];

// Non-Retryable Errors (fail fast)
const NON_RETRYABLE_ERRORS = [
  400, // Bad Request (validation failed)
  401, // Unauthorized (auth failed)
  409, // Conflict (duplicate idempotent event)
];
```

### 4.2 Circuit Breaker Pattern

**States**:
- **CLOSED**: Normal operation, requests pass through
- **OPEN**: Failures exceeded threshold (50% in last 60s), requests rejected
- **HALF_OPEN**: Testing if service recovered, sample requests allowed

**Configuration**:
```typescript
{
  failure_threshold: 50,           // % of requests that must fail
  failure_window_seconds: 60,      // Time window for failures
  success_threshold: 2,             // Consecutive successes to close
  timeout_seconds: 30,              // How long to stay OPEN
  sample_size: 100,                 // Min requests for calculation
}
```

**Behavior**:
```
CLOSED ──[failures > 50%]──> OPEN
                               │
                         [timeout_seconds pass]
                               ▼
                          HALF_OPEN ──[success]──> CLOSED
                               │
                          [failure]
                               │
                               └──> OPEN
```

### 4.3 Backoff Strategy

**Exponential Backoff with Jitter**:

```typescript
function calculateBackoff(
  attemptNumber: number,
  baseDelayMs: number = 100,
  maxDelayMs: number = 30000
): number {
  // Exponential: 2^attempt * baseDelay
  const exponential = Math.pow(2, attemptNumber) * baseDelayMs;

  // Cap at maxDelay
  const capped = Math.min(exponential, maxDelayMs);

  // Add jitter (±10%)
  const jitter = capped * (0.9 + Math.random() * 0.2);

  return Math.round(jitter);
}

// Delays for attempts:
// Attempt 1: 100ms ± 10ms
// Attempt 2: 200ms ± 20ms
// Attempt 3: 400ms ± 40ms
// Attempt 4: 800ms ± 80ms
// Attempt 5: 1600ms ± 160ms (capped)
// Attempt 6: 3200ms ± 320ms (capped)
// Attempt 7: 30000ms (max)
```

### 4.4 Retry Limits

```typescript
const RETRY_CONFIG = {
  max_attempts: 5,              // Total attempts including original
  backoff_base_ms: 100,        // Base delay
  backoff_max_ms: 30000,       // Max backoff

  // Per error type
  error_specific: {
    429: { max_attempts: 10 },  // Rate limit: more retries
    503: { max_attempts: 5 },   // Service unavailable: default
    400: { max_attempts: 1 },   // Bad request: no retry
  },
};
```

### 4.5 RuVector Unavailability Handling

**When RuVector Service is DOWN**:

1. **Circuit Breaker Opens**: Fail-fast for subsequent requests
2. **Local Queue**: Buffer DecisionEvents in memory (with size limit)
3. **Disk Queue** (optional): Persist to local SQLite for critical data
4. **Dead Letter Queue**: Move failed events after max retries
5. **Alert**: Emit monitoring alert for ops team

**Local Queue Configuration**:
```typescript
{
  enabled: true,
  max_size_events: 1000,          // Drop oldest if exceeded
  max_age_seconds: 3600,          // 1 hour: retry then fail
  flush_interval_ms: 5000,        // Try flushing every 5s
}
```

---

## Part 5: Client Implementation Patterns

### 5.1 Agent-Side Client Library

#### Installation

```bash
npm install @llm-dev-ops/connector-hub-ruvector-client
```

#### Basic Usage

```typescript
import { RuVectorClient } from '@llm-dev-ops/connector-hub-ruvector-client';
import { DecisionEvent } from '@llm-dev-ops/connector-hub-agents';

// Initialize (reads from environment/Config Manager)
const client = new RuVectorClient({
  baseUrl: process.env.RUVECTOR_URL,
  auth: {
    type: 'bearer',
    token: process.env.RUVECTOR_API_TOKEN,
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 50,
  },
  retry: {
    maxAttempts: 5,
    backoffBase: 100,
  },
});

// Write a DecisionEvent
const decisionEvent: DecisionEvent = {
  agent_id: 'webhook-agent',
  agent_version: '1.0.0',
  decision_type: 'webhook_ingest_event',
  inputs_hash: 'abc123...',
  outputs: { webhook_id: 'wh_123', ... },
  confidence: { score: 0.95, ... },
  constraints_applied: { connector_scope: 'webhook', ... },
  execution_ref: 'exec_uuid',
  timestamp: new Date().toISOString(),
};

try {
  const result = await client.writeDecisionEvent(decisionEvent, {
    dataClassification: 'internal',
    idempotencyKey: 'idem_uuid',
  });

  console.log('Event persisted:', result.event_id);
} catch (error) {
  if (error.retryable) {
    // Handle retry logic (usually handled by client)
    console.log('Retrying...');
  } else {
    // Non-retryable error: fail fast
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}
```

#### Batch Writing

```typescript
const events: DecisionEvent[] = [...];

const result = await client.batchWriteDecisionEvents(events, {
  dataClassification: 'internal',
  requestId: 'batch_req_uuid',
});

console.log(`Accepted: ${result.eventsAccepted}, Failed: ${result.eventsFailed}`);

if (result.eventsFailed > 0) {
  result.results
    .filter((r) => r.status !== 'accepted')
    .forEach((r) => {
      console.error(`Event ${r.eventId} failed:`, r.error);
    });
}
```

#### Non-Blocking Writes

```typescript
// Fire-and-forget (returns Promise immediately, doesn't wait for response)
client.writeDecisionEventAsync(decisionEvent, {
  dataClassification: 'internal',
  timeout: 5000, // Wait up to 5s, then return early
}).catch((error) => {
  // Handle delayed failures in background
  logger.error('Async write failed:', error);
});
```

#### Health Checking

```typescript
const health = await client.health();

if (!health.healthy) {
  console.log('RuVector service is degraded:');
  console.log(`  Database: ${health.database}`);
  console.log(`  Circuit Breaker: ${health.circuitBreaker}`);

  // Could implement fallback logic
}
```

---

### 5.2 Idempotency Best Practices

```typescript
// Generate idempotency key based on event content
function generateIdempotencyKey(event: DecisionEvent): string {
  const crypto = require('crypto');

  const hashInput = JSON.stringify({
    agent_id: event.agent_id,
    execution_ref: event.execution_ref, // Already unique per invocation
    inputs_hash: event.inputs_hash,
  });

  return 'idem_' + crypto
    .createHash('sha256')
    .update(hashInput)
    .digest('hex')
    .substring(0, 16);
}

// Use when writing
const idempotencyKey = generateIdempotencyKey(decisionEvent);
await client.writeDecisionEvent(decisionEvent, {
  idempotencyKey,
});
```

---

## Part 6: What MUST NOT Be Persisted

### 6.1 Prohibited Data Categories

| Category | Examples | Reason |
|----------|----------|--------|
| **Credentials** | API keys, passwords, tokens | Security risk |
| **Secrets** | Auth codes, refresh tokens, bearer tokens | Should be in secret store only |
| **Raw DB Credentials** | Connection strings, usernames, passwords | Should be in Config Manager |
| **SSH Keys** | Private keys, certificates | Should be in key management service |
| **Sensitive Auth Contexts** | Full SSO tokens, session IDs | Can be anonymized |

### 6.2 Validation Rule

Every payload written to RuVector **MUST** pass:

```typescript
function validateNoSecrets(payload: unknown): boolean {
  const secrets = [
    /api[_-]?key/i,
    /secret/i,
    /password/i,
    /token/i,
    /credential/i,
    /auth[_-]?code/i,
    /bearer/i,
    /oauth/i,
  ];

  const stringified = JSON.stringify(payload);

  for (const pattern of secrets) {
    if (pattern.test(stringified)) {
      // Found suspicious field, reject
      return false;
    }
  }

  return true;
}
```

---

## Part 7: Integration Checklist

### Agent Implementation

- [ ] Import RuVectorClient
- [ ] Initialize in agent constructor with environment config
- [ ] Generate DecisionEvent per spec
- [ ] Classify data correctly (`public`, `internal`, `confidential`, `restricted`)
- [ ] Write DecisionEvent to RuVector (non-blocking)
- [ ] Handle retryable errors with backoff
- [ ] Handle non-retryable errors with immediate failure
- [ ] Implement circuit breaker pattern
- [ ] Add observability: log correlation ID, trace ID, request ID
- [ ] Test with local mock RuVector service
- [ ] Test with staging RuVector instance
- [ ] Document agent-specific data classification

### Infrastructure

- [ ] Deploy RuVector Service (Google Cloud SQL or PostgreSQL)
- [ ] Configure mTLS certificates or API tokens
- [ ] Set up monitoring/alerting for RuVector health
- [ ] Implement database backups (daily, 30-day retention)
- [ ] Set up connection pooling (min: 5, max: 50 connections)
- [ ] Configure query timeouts (default: 30s)
- [ ] Enable query logging for audit trail
- [ ] Set up PII redaction rules
- [ ] Implement data retention policies
- [ ] Create incident runbook for RuVector outages

### Testing

- [ ] Unit tests with mocked RuVector
- [ ] Integration tests with staging RuVector
- [ ] Circuit breaker failure scenarios
- [ ] Retry backoff timing verification
- [ ] Idempotency key collision handling
- [ ] Payload validation (no secrets)
- [ ] Data classification accuracy
- [ ] Large payload handling (>10MB)
- [ ] Batch write efficiency
- [ ] PII redaction verification

---

## Part 8: Monitoring & Observability

### 8.1 Metrics to Track

```typescript
const metrics = {
  // Request metrics
  'ruvector.requests.total': Counter,
  'ruvector.requests.success': Counter,
  'ruvector.requests.failed': Counter,
  'ruvector.requests.duration_ms': Histogram,

  // Circuit breaker
  'ruvector.circuit_breaker.state': Gauge ('CLOSED'|'OPEN'|'HALF_OPEN'),
  'ruvector.circuit_breaker.failures': Counter,

  // Retry metrics
  'ruvector.retries.total': Counter,
  'ruvector.retries.exhausted': Counter,

  // Queue metrics
  'ruvector.queue.size': Gauge,
  'ruvector.queue.dropped_events': Counter,

  // Error breakdown
  'ruvector.errors.by_type': Counter (type: auth, validation, timeout, etc.),

  // Idempotency
  'ruvector.idempotency.cache_hits': Counter,
  'ruvector.idempotency.cache_misses': Counter,
};
```

### 8.2 Logging Structure

```json
{
  "timestamp": "2025-01-21T10:30:45.123Z",
  "level": "INFO",
  "logger": "ruvector-client",
  "message": "DecisionEvent persisted",
  "event_id": "evt_uuid_123",
  "request_id": "req_uuid_789",
  "trace_id": "trace_xyz",
  "correlation_id": "corr_456",
  "agent_id": "webhook-agent",
  "execution_ref": "exec_uuid",
  "status_code": 202,
  "duration_ms": 145,
  "data_classification": "internal",
  "payload_size_bytes": 2048,
  "idempotent": true
}
```

### 8.3 Alerting Rules

| Alert | Threshold | Severity |
|-------|-----------|----------|
| Circuit Breaker OPEN | Immediately | Critical |
| Failure Rate > 50% | Last 5 minutes | High |
| Response Time > 5s | Last 10 requests | Medium |
| Queue Size > 500 events | Current | High |
| Retry Exhaustion > 100/min | Last minute | High |
| PII Detection Failure | Any | Critical |

---

## Part 9: Examples

### Example 1: Webhook Ingestion Agent

```typescript
import { RuVectorClient } from '@llm-dev-ops/connector-hub-ruvector-client';
import { DecisionEvent, createDecisionEvent } from '@llm-dev-ops/connector-hub-agents';

export class WebhookIngestionAgent {
  private ruvector: RuVectorClient;

  constructor() {
    this.ruvector = new RuVectorClient({
      baseUrl: process.env.RUVECTOR_URL!,
    });
  }

  async processWebhook(webhook: unknown): Promise<string> {
    // Normalize webhook payload
    const normalized = this.normalizePayload(webhook);

    // Create DecisionEvent
    const event: DecisionEvent = createDecisionEvent({
      agentId: 'webhook-ingestion-agent',
      agentVersion: '1.0.0',
      decisionType: 'webhook_ingest_event',
      input: webhook,
      outputs: normalized,
      confidence: {
        score: 0.95,
        schema_validation: 'passed',
      },
      constraintsApplied: {
        connector_scope: 'webhook-ingest',
      },
    });

    // Persist to RuVector (non-blocking)
    this.ruvector.writeDecisionEventAsync(event, {
      dataClassification: 'internal',
    }).catch((error) => {
      // Log but don't fail webhook response
      console.error('Failed to persist event:', error);
    });

    // Return to caller immediately
    return event.execution_ref;
  }

  private normalizePayload(webhook: unknown): Record<string, unknown> {
    // Normalize webhook structure
    return { /* ... */ };
  }
}
```

### Example 2: Database Query Agent with Redaction

```typescript
export class DatabaseQueryAgent {
  private ruvector: RuVectorClient;

  async executeAndPersist(query: string): Promise<any> {
    // Execute query
    const result = await this.executeQuery(query);

    // Redact PII from results
    const redacted = this.redactPII(result.rows);

    // Create DecisionEvent
    const event: DecisionEvent = createDecisionEvent({
      agentId: 'database-query-agent',
      agentVersion: '1.0.0',
      decisionType: 'database_query_result',
      input: query,
      outputs: {
        rows_returned: result.rows.length,
        columns: result.fields.map((f) => f.name),
        sample_row: redacted[0],
      },
      confidence: {
        score: 1.0,
        schema_validation: 'passed',
      },
      constraintsApplied: {
        connector_scope: 'database-query',
        data_classification: 'confidential',
      },
    });

    // Persist with PII redaction rule
    await this.ruvector.writeDecisionEvent(event, {
      dataClassification: 'confidential',
      redactionRules: {
        'outputs.sample_row.email': 'FULL',
        'outputs.sample_row.ssn': 'FULL',
      },
    });

    return result;
  }

  private redactPII(rows: any[]): any[] {
    // Implement PII redaction
    return rows.map((row) => {
      const redacted = { ...row };
      if (redacted.email) redacted.email = '***REDACTED***';
      if (redacted.ssn) redacted.ssn = '***REDACTED***';
      return redacted;
    });
  }

  private executeQuery(query: string): Promise<any> {
    // Implement query execution
    return Promise.resolve({});
  }
}
```

---

## Part 10: References & Resources

- **Schema Registry**: See `@llm-dev-ops/connector-hub-contracts`
- **Config Manager**: See `@llm-dev-ops/connector-hub-config`
- **Observable**: See `@llm-dev-ops/connector-hub-observable`
- **Agent Interface**: See `@llm-dev-ops/connector-hub-agents`

---

## Part 11: FAQ

**Q: Can an agent write directly to the database?**
A: No. ALL persistence MUST flow through RuVector Service.

**Q: What if RuVector is down?**
A: Circuit breaker opens, requests fail-fast. Local queue buffers events for retry when service recovers.

**Q: How long are events retained?**
A: Depends on classification: public (7y), internal (2y), confidential (1y), restricted (90d).

**Q: Is idempotency required?**
A: Strongly recommended. Prevents duplicates if agent retries.

**Q: Can I persist API keys?**
A: No. Validation will reject payloads containing credentials.

**Q: What format should timestamps be?**
A: ISO 8601 UTC (e.g., `2025-01-21T10:30:45.123Z`)

---

**Document Status**: ✅ Ready for Implementation
**Next Steps**: Implement RuVectorClient TypeScript library, deploy RuVector Service, integrate into agent infrastructure
