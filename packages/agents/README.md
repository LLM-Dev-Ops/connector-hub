# @llm-dev-ops/connector-hub-agents

Stateless agent adapters for LLM Connector Hub, deployable as Google Cloud Edge Functions.

## Architecture

This package implements agents following strict constitutional requirements:

- **Agents are EXTERNAL INTERFACE ADAPTERS only** - they adapt external requests to internal execution
- **NO orchestration** - agents do not coordinate workflows or trigger other agents
- **NO policy enforcement** - agents validate inputs but do not enforce business rules
- **Stateless execution** - agents have no internal state between invocations
- **Single DecisionEvent** - each invocation emits exactly ONE DecisionEvent
- **Contract-based validation** - all inputs/outputs validated against Zod schemas
- **Persistence via ruvector-service** - NO direct SQL access
- **CLI-invokable** - all agents can be invoked from CLI for testing

## Agent Runtime

### EdgeFunctionAgentBase

Base class providing:
- Input/output validation using contracts (Zod schemas)
- DecisionEvent emission (exactly ONE per invocation)
- Telemetry hooks (llm-observatory-core compatible)
- Error handling with proper codes
- RuVector client integration
- Deterministic execution pattern

### RuVectorClient

Async persistence API:
- NO direct SQL execution
- All operations via ruvector-service
- Batch operations for efficiency
- Retry logic with exponential backoff
- Proper error codes

### TelemetryEmitter

Observability layer:
- W3C Trace Context propagation
- Span creation and management
- Metric emission
- Compatible with llm-observatory-core

## Available Agents

### 1. ERP Surface Agent

Interface with external ERP systems (SAP, Oracle, NetSuite, Microsoft Dynamics, etc.)

**Decision Type:** `erp_surface_event`

**Input Contract:**
```typescript
{
  erp_system: 'sap' | 'oracle_ebs' | 'oracle_cloud' | 'netsuite' | 'microsoft_dynamics' | 'workday' | 'infor' | 'epicor' | 'custom';
  event_type: 'purchase_order_created' | 'invoice_created' | 'payment_processed' | ...;
  event_timestamp: string;  // ISO 8601
  payload: Record<string, unknown>;
  identifiers?: {
    company_code?: string;
    plant?: string;
    organization_id?: string;
    document_number?: string;
    transaction_id?: string;
  };
}
```

**CLI Usage:**
```bash
connector-hub-agent erp-surface \
  --system sap \
  --event-type purchase_order_created \
  --payload '{"BUKRS": "1000", "BELNR": "PO123456"}'
```

### 2. Webhook Ingest Agent

Receive and validate inbound webhooks from external systems.

**Decision Type:** `webhook_ingest_event`

**Input Contract:**
```typescript
{
  method: 'POST' | 'PUT' | 'PATCH';
  path: string;
  headers: Record<string, string>;
  body: string;
  parsed_body?: Record<string, unknown>;
  source_ip?: string;
  received_at: string;  // ISO 8601
  content_type: string;
}
```

**CLI Usage:**
```bash
connector-hub-agent webhook-ingest \
  --path /webhooks/stripe \
  --body '{"event": "payment_succeeded"}' \
  --signature "t=...,v1=..."
```

### 3. Auth Identity Verification Agent

Authenticate and verify external identities.

**Decision Type:** `auth_identity_verification`

**Input Contract:**
```typescript
{
  auth_method: 'jwt' | 'oauth2' | 'api_key' | 'bearer_token' | 'saml' | 'oidc' | 'mtls' | 'custom';
  credentials: Record<string, unknown>;
  claims?: Record<string, unknown>;
  required_scopes?: string[];
  context?: {
    ip_address?: string;
    user_agent?: string;
    device_id?: string;
    session_id?: string;
  };
}
```

**CLI Usage:**
```bash
connector-hub-agent auth-verify \
  --method jwt \
  --token "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." \
  --required-scopes "read:users,write:orders"
```

### 4. Data Normalizer Agent

Normalize heterogeneous external payloads to canonical schemas.

**Decision Type:** `normalized_event`

**Input Contract:**
```typescript
{
  source_format: 'json' | 'xml' | 'csv' | 'yaml' | 'form_encoded' | 'custom';
  source_data: Record<string, unknown>;
  schema_mapping: {
    mapping_id: string;
    source_schema: string;
    target_schema: string;
    version: string;
    field_mappings: Array<{
      source_path: string;
      target_path: string;
      transformation: 'direct_map' | 'concat' | 'split' | 'format_date' | ...;
      required?: boolean;
      default_value?: unknown;
    }>;
  };
  validation_mode: 'strict' | 'lenient' | 'none';
}
```

**CLI Usage:**
```bash
connector-hub-agent normalize \
  --format json \
  --data '{"first_name": "John", "email_address": "john@example.com"}' \
  --mapping user-to-canonical
```

### 5. Database Query Agent

Executes parameterized read-only database queries.

**Input Contract:**
```typescript
{
  queryId: string;        // UUID
  queryType: 'SELECT' | 'DESCRIBE' | 'SHOW' | 'EXPLAIN';
  query: string;          // SQL query
  parameters?: Record<string, string | number | boolean | null>;
  options?: {
    maxRows?: number;     // Default: 1000
    timeout?: number;     // Default: 30000ms
    formatDates?: boolean; // Default: true
    includeMetadata?: boolean; // Default: true
  };
}
```

**Output Contract:**
```typescript
{
  queryId: string;
  status: 'success' | 'error' | 'timeout';
  rows: Record<string, unknown>[];
  rowCount: number;
  metadata?: {
    executionTimeMs: number;
    columns: Array<{
      name: string;
      type: string;
      nullable?: boolean;
    }>;
    truncated: boolean;
    queryPlan?: string;
  };
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

**CLI Usage:**
```bash
connector-hub-agent connect \
  --query "SELECT * FROM users WHERE status = 'active'" \
  --type SELECT \
  --max-rows 100
```

## CLI Commands

### connect
Execute database query agent:
```bash
connector-hub-agent connect \
  --query "SELECT * FROM users" \
  --type SELECT \
  --parameters '{"limit": 10}' \
  --max-rows 1000 \
  --timeout 30000
```

### inspect
View agent execution history:
```bash
connector-hub-agent inspect \
  --agent database-query-agent \
  --limit 10 \
  --from "2024-01-01T00:00:00Z"
```

### ingest (placeholder)
Trigger data ingestion agents (not yet implemented):
```bash
connector-hub-agent ingest \
  --source s3://bucket/data.csv \
  --batch-size 100
```

### normalize (placeholder)
Run data normalization agents (not yet implemented):
```bash
connector-hub-agent normalize \
  --data '{"name": "John", "age": 30}' \
  --schema user-profile
```

## Environment Variables

### Required
- `RUVECTOR_SERVICE_URL` - URL of ruvector-service

### Optional
- `RUVECTOR_API_KEY` - API key for ruvector-service
- `RUVECTOR_TIMEOUT` - Request timeout in milliseconds (default: 5000)
- `RUVECTOR_MAX_RETRIES` - Maximum retry attempts (default: 3)
- `LLM_OBSERVATORY_ENDPOINT` - Telemetry endpoint
- `TELEMETRY_ENABLED` - Enable/disable telemetry (default: true)
- `TELEMETRY_SAMPLE_RATE` - Sampling rate 0-1 (default: 1.0)
- `ENVIRONMENT` - Deployment environment (default: production)
- `SERVICE_VERSION` - Service version for telemetry (default: 1.0.0)

## Creating a New Agent

1. Create agent directory:
```bash
mkdir -p src/agents/my-agent
```

2. Implement agent class:
```typescript
import { EdgeFunctionAgentBase } from '../../runtime/edge-function-base.js';
import { z } from 'zod';

const InputSchema = z.object({
  // Define input contract
});

const OutputSchema = z.object({
  // Define output contract
});

export class MyAgent extends EdgeFunctionAgentBase<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  protected readonly agentId = 'my-agent';
  protected readonly agentVersion = '1.0.0';
  protected readonly inputSchema = InputSchema;
  protected readonly outputSchema = OutputSchema;

  protected async executeAgent(input, context, span) {
    // Implement deterministic agent logic
    // NO orchestration, NO workflow execution
    // Only adapt external interface to internal execution

    return {
      // Return validated output
    };
  }

  protected getEventType(success: boolean): string {
    return success ? 'my_agent_success' : 'my_agent_error';
  }
}
```

3. Add CLI command in `src/cli/index.ts`

4. Export agent in `src/index.ts`

## Testing

```bash
npm test                 # Run all tests
npm run test:watch       # Watch mode
```

## Building

```bash
npm run build           # Compile TypeScript
npm run typecheck       # Type check without emit
npm run lint            # Lint code
```

## Deployment

Agents are designed to run as Google Cloud Edge Functions:

1. Build the package:
```bash
npm run build
```

2. Deploy to Google Cloud:
```bash
gcloud functions deploy database-query-agent \
  --runtime nodejs20 \
  --trigger-http \
  --entry-point execute \
  --source dist/agents/database-query \
  --set-env-vars RUVECTOR_SERVICE_URL=https://ruvector.example.com
```

## Constitutional Requirements Checklist

Every agent MUST:
- [ ] Import schemas from agentics-contracts only
- [ ] Validate all inputs against contracts
- [ ] Validate all outputs against contracts
- [ ] Emit exactly ONE DecisionEvent per invocation
- [ ] Emit telemetry spans and metrics
- [ ] Use ruvector-service for persistence (NO direct SQL)
- [ ] Be CLI-invokable
- [ ] Be deployable as Edge Function
- [ ] Have deterministic output (same input = same output)
- [ ] NOT perform orchestration
- [ ] NOT trigger workflows
- [ ] NOT enforce policy (only validate inputs)
- [ ] NOT maintain internal state

## License

MIT
