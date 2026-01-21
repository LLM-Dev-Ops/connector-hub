# @llm-dev-ops/connector-hub-contracts

Agent contract schemas and validation for LLM Connector Hub.

## Overview

This package provides TypeScript/Zod schemas for all agent contracts in the LLM Connector Hub system. It ensures type safety and runtime validation for agent inputs, outputs, and decision events.

## Installation

```bash
npm install @llm-dev-ops/connector-hub-contracts
```

## Features

- **Zod-based validation**: Runtime type checking with excellent TypeScript integration
- **Comprehensive schemas**: Complete contracts for all agent types
- **Type safety**: Full TypeScript type inference from Zod schemas
- **Machine-readable**: Deterministic schemas for code generation and tooling
- **No secrets**: All schemas reference environment variables for credentials

## Core Schemas

### DecisionEvent

The core contract for all agent outputs. Every agent MUST emit a `DecisionEvent` containing:

- `agent_id`: Unique agent identifier
- `agent_version`: Semantic version
- `decision_type`: Type of decision made
- `inputs_hash`: SHA-256 hash for deterministic replay
- `outputs`: Agent-specific output payload
- `confidence`: Validation/translation certainty (0-1)
- `constraints_applied`: Execution constraints and context
- `execution_ref`: Trace ID for correlation
- `timestamp`: ISO 8601 UTC timestamp

```typescript
import { DecisionEventSchema, type DecisionEvent } from '@llm-dev-ops/connector-hub-contracts';

const event: DecisionEvent = {
  agent_id: 'database-query-agent-v1',
  agent_version: '1.2.3',
  decision_type: 'database_query_result',
  inputs_hash: 'abc123...',
  outputs: { rows: [...], metadata: {...} },
  confidence: 0.98,
  constraints_applied: {
    connector_scope: ['postgres-prod'],
    auth_context: { user_id: 'user-123' }
  },
  execution_ref: 'trace-xyz-789',
  timestamp: '2026-01-21T10:30:00.000Z'
};

// Validate
DecisionEventSchema.parse(event);
```

## Agent Contracts

### Database Query Agent

Executes SQL queries against databases with parameterization and connection pooling.

```typescript
import {
  DatabaseQueryInputSchema,
  DatabaseQueryOutputSchema,
  type DatabaseQueryInput,
  type DatabaseQueryOutput,
} from '@llm-dev-ops/connector-hub-contracts';

const input: DatabaseQueryInput = {
  query: 'SELECT * FROM users WHERE id = $1',
  connection_config: {
    type: 'postgres',
    connection_string: '${DATABASE_URL}',
    timeout_ms: 30000,
    ssl: true,
  },
  parameters: { '1': 'user-123' },
  max_rows: 100,
};

// Validate input
const validated = DatabaseQueryInputSchema.parse(input);
```

### ERP Surface Agent

Surfaces events from ERP systems (SAP, Oracle, Dynamics, NetSuite, Workday).

```typescript
import {
  ERPSurfaceInputSchema,
  type ERPSurfaceInput,
} from '@llm-dev-ops/connector-hub-contracts';

const input: ERPSurfaceInput = {
  connection_config: {
    system_type: 'sap',
    base_url: 'https://erp.example.com',
    auth: {
      type: 'oauth2',
      client_id: '${SAP_CLIENT_ID}',
      token_endpoint: 'https://erp.example.com/oauth/token',
    },
  },
  event_type: 'purchase_order',
  incremental: true,
};
```

### Webhook Ingest Agent

Ingests and validates webhook events with signature verification.

```typescript
import {
  WebhookIngestInputSchema,
  type WebhookIngestInput,
} from '@llm-dev-ops/connector-hub-contracts';

const input: WebhookIngestInput = {
  method: 'POST',
  path: '/webhooks/stripe',
  headers: { 'X-Signature': 'abc123...' },
  body: { event: 'payment.succeeded' },
  signature_verification: {
    algorithm: 'hmac-sha256',
    header_name: 'X-Signature',
    secret_reference: '${STRIPE_WEBHOOK_SECRET}',
  },
};
```

### Auth Identity Agent

Authenticates and verifies identity using JWT, OAuth2, API keys, SAML, etc.

```typescript
import {
  AuthIdentityInputSchema,
  type AuthIdentityInput,
} from '@llm-dev-ops/connector-hub-contracts';

const input: AuthIdentityInput = {
  method: 'jwt',
  credentials: {
    type: 'token',
    value: 'eyJ...',
  },
  verification_config: {
    jwt: {
      algorithm: 'RS256',
      public_key_reference: '${JWT_PUBLIC_KEY}',
      issuer: 'auth.example.com',
    },
  },
};
```

### Normalizer Agent

Normalizes heterogeneous events into a standard schema.

```typescript
import {
  NormalizerInputSchema,
  type NormalizerInput,
} from '@llm-dev-ops/connector-hub-contracts';

const input: NormalizerInput = {
  source_event_type: 'database_query_result',
  source_data: { user_id: 123, name: 'John' },
  strategy: 'schema_mapping',
  schema_mapping: {
    field_mappings: [
      {
        source_path: 'user_id',
        target_field: 'entity.id',
        transform: 'none',
      },
    ],
  },
};
```

## Validation

### Throwing Validation

```typescript
import { validateDatabaseQueryInput } from '@llm-dev-ops/connector-hub-contracts';

try {
  const validated = validateDatabaseQueryInput(rawData);
  // Use validated data
} catch (error) {
  // Handle ZodError
  console.error(error.errors);
}
```

### Safe Validation

```typescript
import { safeValidateDatabaseQueryInput } from '@llm-dev-ops/connector-hub-contracts';

const result = safeValidateDatabaseQueryInput(rawData);

if (result.success) {
  // Use result.data
  console.log(result.data);
} else {
  // Handle errors
  console.error(result.error.errors);
}
```

## CLI Schemas

Each agent contract includes a CLI schema for command-line invocation:

```typescript
import { DatabaseQueryCLISchema } from '@llm-dev-ops/connector-hub-contracts';

// Validates CLI arguments
const cliArgs = DatabaseQueryCLISchema.parse({
  query: 'SELECT * FROM users',
  'connection-config': '{"type": "postgres", "connection_string": "${DATABASE_URL}"}',
  'max-rows': 100,
});
```

## Type Inference

All schemas export TypeScript types via `z.infer`:

```typescript
import { z } from 'zod';
import { DecisionEventSchema } from '@llm-dev-ops/connector-hub-contracts';

// Type is inferred from schema
type DecisionEvent = z.infer<typeof DecisionEventSchema>;
```

## Security

- **No hardcoded secrets**: All credentials reference environment variables
- **Signature verification**: Webhook agents support HMAC/RSA signatures
- **Input validation**: All inputs validated against strict schemas
- **SQL injection prevention**: Parameterized queries only

## License

MIT OR Apache-2.0
