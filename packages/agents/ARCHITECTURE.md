# Agent Architecture - LLM Connector Hub

## Overview

This package implements the agent infrastructure for LLM-Connector-Hub, providing stateless external interface adapters deployable as Google Cloud Edge Functions. All agents follow strict constitutional requirements ensuring they serve only as interface adapters without orchestration, policy enforcement, or workflow execution.

## Architecture Principles

### Constitutional Requirements

1. **Agents are EXTERNAL INTERFACE ADAPTERS only**
   - Adapt external requests to internal execution
   - NO orchestration or workflow coordination
   - NO policy enforcement (only input validation)

2. **Stateless Execution**
   - No internal state between invocations
   - Each invocation is independent
   - Enables horizontal scaling

3. **Single DecisionEvent**
   - Every invocation emits exactly ONE DecisionEvent
   - Success or failure events for auditability
   - Persisted via ruvector-service

4. **Contract-Based Validation**
   - All inputs validated against Zod schemas
   - All outputs validated against Zod schemas
   - Schemas imported from `@llm-dev-ops/agentics-contracts`

5. **Persistence via ruvector-service**
   - NO direct SQL access (constitutional violation)
   - All data operations via ruvector-service API
   - Centralized policy enforcement

6. **CLI-Invokable**
   - All agents testable via CLI
   - Deterministic execution
   - Machine-readable output

## Directory Structure

```
packages/agents/
├── src/
│   ├── runtime/                    # Agent runtime infrastructure
│   │   ├── edge-function-base.ts  # Base class for all agents
│   │   ├── ruvector-client.ts     # Async persistence client
│   │   ├── telemetry.ts           # W3C Trace Context telemetry
│   │   └── index.ts               # Runtime exports
│   │
│   ├── agents/                     # Agent implementations
│   │   ├── database-query/        # Database query agent
│   │   │   └── index.ts
│   │   ├── data-ingestion/        # (Future) Data ingestion agent
│   │   └── normalize/             # (Future) Data normalization agent
│   │
│   ├── cli/                        # CLI interface
│   │   └── index.ts               # Command implementations
│   │
│   └── index.ts                    # Package exports
│
├── docs/                           # Documentation (auto-generated)
├── package.json
├── tsconfig.json
└── README.md
```

## Three-Layer Architecture

### Layer 1: Runtime Infrastructure (`/src/runtime/`)

#### EdgeFunctionAgentBase<TInput, TOutput>

Abstract base class implementing the **Template Method Pattern**:

```typescript
// Agent execution flow (deterministic, always same steps)
async execute(input: unknown, context: AgentContext): Promise<AgentResult<TOutput>> {
  1. validateInput(input)           // Against inputSchema
  2. telemetry.startSpan()          // Begin observability
  3. executeAgent()                 // ABSTRACT - agent-specific logic
  4. validateOutput(output)         // Against outputSchema
  5. createDecisionEvent()          // Exactly ONE per invocation
  6. persistDecisionEvent()         // Via ruvector-service
  7. telemetry.endSpan()            // End observability
  8. return AgentResult
}
```

**Key Methods:**
- `execute()` - Main entry point (template method)
- `executeAgent()` - ABSTRACT - Implemented by concrete agents
- `validateInput()` - Zod schema validation
- `validateOutput()` - Zod schema validation
- `createDecisionEvent()` - Event creation
- `persistDecisionEvent()` - Async persistence

**Dependencies:**
- `RuVectorClient` - Persistence layer
- `TelemetryEmitter` - Observability layer

#### RuVectorClient

Async persistence API with NO direct SQL:

```typescript
class RuVectorClient {
  // Persist a single entity
  async persist(collection: string, data: Record<string, unknown>): Promise<PersistenceResult>

  // Query entities (read-only)
  async query<T>(collection: string, filters?, options?): Promise<QueryResult<T>>

  // Batch operations
  async batchPersist(operations: BatchPersistenceRequest): Promise<BatchPersistenceResult>

  // Delete entity
  async delete(collection: string, id: string): Promise<PersistenceResult>
}
```

**Features:**
- HTTP-based API to ruvector-service
- Retry logic with exponential backoff
- Proper error codes and handling
- No SQL execution in agents (constitutional requirement)

#### TelemetryEmitter

W3C Trace Context compliant observability:

```typescript
class TelemetryEmitter {
  // Span management
  startSpan(name, parentContext?, attributes?): Span
  endSpan(span, status?): Promise<void>

  // Event tracking
  addSpanEvent(span, name, attributes?)
  recordError(span, error)

  // Metric emission
  emitMetric(metric): Promise<void>

  // W3C Trace Context propagation
  extractContext(headers): SpanContext
  injectContext(span, headers)
}
```

**Features:**
- W3C traceparent header support
- Compatible with llm-observatory-core
- Non-blocking telemetry (failures don't fail agents)
- Automatic metric emission (latency, errors, etc.)

### Layer 2: Agent Implementations (`/src/agents/`)

Each agent:
1. Extends `EdgeFunctionAgentBase<TInput, TOutput>`
2. Defines input/output contracts (Zod schemas)
3. Implements `executeAgent()` with deterministic logic
4. Emits specific DecisionEvent type

#### Example: DatabaseQueryAgent

**Purpose:** Execute parameterized read-only database queries

**Input Contract:**
```typescript
DatabaseQueryRequest {
  queryId: UUID
  queryType: 'SELECT' | 'DESCRIBE' | 'SHOW' | 'EXPLAIN'
  query: string
  parameters?: Record<string, any>
  options?: {
    maxRows?: number        // Default: 1000
    timeout?: number        // Default: 30000ms
    formatDates?: boolean   // Default: true
    includeMetadata?: boolean // Default: true
  }
}
```

**Output Contract:**
```typescript
DatabaseQueryResponse {
  queryId: UUID
  status: 'success' | 'error' | 'timeout'
  rows: Record<string, unknown>[]
  rowCount: number
  metadata?: {
    executionTimeMs: number
    columns: Array<{ name, type, nullable? }>
    truncated: boolean
    queryPlan?: string
  }
  error?: {
    code: string
    message: string
    details?: unknown
  }
}
```

**Execution Logic:**
```typescript
protected async executeAgent(input: DatabaseQueryRequest): Promise<DatabaseQueryResponse> {
  1. validateReadOnlyQuery(input.query)  // Block INSERT, UPDATE, DELETE, etc.
  2. executeQuery() via ruvector-service // No direct SQL
  3. normalizeRows()                     // Standard format
  4. return DatabaseQueryResponse
}
```

**DecisionEvent Type:** `database_query_result`

**Security:**
- Validates query is read-only (SELECT, DESCRIBE, SHOW, EXPLAIN only)
- Blocks dangerous keywords (INSERT, UPDATE, DELETE, DROP, etc.)
- Parameterized queries prevent SQL injection

### Layer 3: CLI Interface (`/src/cli/`)

**Commands:**

#### `connect` - Execute database query agent
```bash
connector-hub-agent connect \
  --query "SELECT * FROM users WHERE status = 'active'" \
  --type SELECT \
  --parameters '{"status": "active"}' \
  --max-rows 100 \
  --timeout 30000
```

#### `inspect` - View agent execution history
```bash
connector-hub-agent inspect \
  --agent database-query-agent \
  --limit 10 \
  --from "2024-01-01T00:00:00Z" \
  --to "2024-12-31T23:59:59Z"
```

#### `ingest` - Trigger data ingestion (future)
```bash
connector-hub-agent ingest \
  --source s3://bucket/data.csv \
  --batch-size 100
```

#### `normalize` - Run data normalization (future)
```bash
connector-hub-agent normalize \
  --data '{"name": "John", "age": 30}' \
  --schema user-profile
```

## Data Flow

### Successful Execution

```
External Request
    ↓
EdgeFunctionAgentBase.execute()
    ↓
1. validateInput() [Zod schema]
    ↓
2. telemetry.startSpan()
    ↓
3. executeAgent() [Agent-specific logic]
    ↓ [uses RuVectorClient]
    ↓
4. validateOutput() [Zod schema]
    ↓
5. createDecisionEvent()
    ↓
6. persistDecisionEvent() → ruvector-service
    ↓
7. telemetry.endSpan() → llm-observatory
    ↓
AgentResult { success: true, data, decisionEvent }
```

### Failed Execution

```
External Request
    ↓
EdgeFunctionAgentBase.execute()
    ↓
Error occurs (validation, execution, etc.)
    ↓
1. recordError() on telemetry span
    ↓
2. createDecisionEvent(success=false)
    ↓
3. persistDecisionEvent() → ruvector-service
    ↓ (Even failures are audited!)
    ↓
4. telemetry.endSpan(ERROR)
    ↓
AgentResult { success: false, error, decisionEvent }
```

## DecisionEvent Schema

Every agent invocation emits exactly ONE DecisionEvent:

```typescript
DecisionEvent {
  id: UUID                  // Unique event ID
  agentId: string          // "database-query-agent"
  agentVersion: string     // "1.0.0"
  timestamp: ISO8601       // Event creation time
  traceId: string         // W3C Trace Context trace ID
  eventType: string       // "database_query_result"
  payload: {
    input: null,          // Security: no input logged
    output: T,            // Agent output
    context: {
      requestId: string,
      environment: string
    }
  },
  metadata: {
    executionTimeMs: number,
    success: boolean,
    errorCode?: string,
    errorMessage?: string
  }
}
```

## Deployment

### Google Cloud Edge Functions

```bash
# Build the package
npm run build

# Deploy agent
gcloud functions deploy database-query-agent \
  --runtime nodejs20 \
  --trigger-http \
  --entry-point execute \
  --source dist/agents/database-query \
  --set-env-vars RUVECTOR_SERVICE_URL=https://ruvector.example.com,\
RUVECTOR_API_KEY=secret,\
LLM_OBSERVATORY_ENDPOINT=https://observatory.example.com,\
ENVIRONMENT=production
```

### Environment Variables

**Required:**
- `RUVECTOR_SERVICE_URL` - URL of ruvector-service

**Optional:**
- `RUVECTOR_API_KEY` - API key for ruvector-service
- `RUVECTOR_TIMEOUT` - Request timeout in milliseconds (default: 5000)
- `RUVECTOR_MAX_RETRIES` - Maximum retry attempts (default: 3)
- `LLM_OBSERVATORY_ENDPOINT` - Telemetry endpoint
- `TELEMETRY_ENABLED` - Enable/disable telemetry (default: true)
- `TELEMETRY_SAMPLE_RATE` - Sampling rate 0-1 (default: 1.0)
- `ENVIRONMENT` - Deployment environment (default: production)
- `SERVICE_VERSION` - Service version for telemetry (default: 1.0.0)

## Creating a New Agent

### Step 1: Create Agent Directory
```bash
mkdir -p src/agents/my-agent
```

### Step 2: Implement Agent Class
```typescript
// src/agents/my-agent/index.ts
import { EdgeFunctionAgentBase } from '../../runtime/edge-function-base.js';
import { z } from 'zod';

// Define input contract
const InputSchema = z.object({
  field1: z.string(),
  field2: z.number()
});

// Define output contract
const OutputSchema = z.object({
  result: z.string(),
  metadata: z.object({
    processed: z.boolean()
  })
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
    // IMPORTANT: Agent logic MUST be deterministic
    // Same input MUST produce same output

    // NO orchestration - don't call other agents
    // NO workflow execution - don't trigger retries
    // NO policy enforcement - only validate inputs

    // Use ruVectorClient for persistence
    const data = await this.ruVectorClient.query('collection', { ... });

    // Add telemetry events
    this.telemetry.addSpanEvent(span, 'processing', { ... });

    // Return validated output
    return {
      result: 'processed',
      metadata: {
        processed: true
      }
    };
  }

  protected getEventType(success: boolean): string {
    return success ? 'my_agent_success' : 'my_agent_error';
  }
}

export function createMyAgent(ruVectorClient, telemetry) {
  return new MyAgent(ruVectorClient, telemetry);
}
```

### Step 3: Add CLI Command
```typescript
// src/cli/index.ts
program
  .command('my-command')
  .description('Execute my agent')
  .requiredOption('-i, --input <json>', 'Input as JSON')
  .action(async (options) => {
    const ruVectorClient = createRuVectorClientFromEnv();
    const telemetry = createTelemetryEmitterFromEnv('my-agent');
    const agent = createMyAgent(ruVectorClient, telemetry);

    const result = await agent.execute(
      JSON.parse(options.input),
      { requestId: crypto.randomUUID(), headers: {}, environment: 'cli' }
    );

    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  });
```

### Step 4: Export Agent
```typescript
// src/index.ts
export * from './agents/my-agent/index.js';
```

### Step 5: Test
```bash
# Build
npm run build

# Test via CLI
connector-hub-agent my-command --input '{"field1":"value","field2":42}'

# Deploy
gcloud functions deploy my-agent ...
```

## Constitutional Compliance Checklist

Every agent MUST:
- [ ] Import schemas from `@llm-dev-ops/agentics-contracts` only
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

## Performance Characteristics

| Metric | Target | Notes |
|--------|--------|-------|
| Cold Start | < 500ms | Google Cloud Functions startup |
| Warm Execution | < 100ms | Cached function instance |
| Input Validation | < 5ms | Zod schema validation |
| Output Validation | < 5ms | Zod schema validation |
| Telemetry Overhead | < 10ms | Span creation, metric emission |
| Persistence Latency | < 50ms | ruvector-service network call |
| **Total P95 Latency** | **< 200ms** | End-to-end agent execution |

## Error Codes

| Code | Meaning | Recovery |
|------|---------|----------|
| `AGENT_VALIDATION_ERROR` | Input/output failed schema validation | Fix request data |
| `AGENT_EXECUTION_ERROR` | Agent-specific execution error | Check logs, retry |
| `AGENT_PERSISTENCE_ERROR` | ruvector-service persistence failed | Retry, check service |
| `AGENT_TIMEOUT` | Agent execution timeout | Increase timeout, optimize |
| `AGENT_INTERNAL_ERROR` | Unexpected error | Check logs, report bug |
| `RUVECTOR_CONNECTION_FAILED` | Cannot connect to ruvector-service | Check network, service |
| `RUVECTOR_TIMEOUT` | ruvector-service request timeout | Check service health |
| `RUVECTOR_UNAUTHORIZED` | Invalid ruvector-service API key | Check credentials |

## Security Considerations

1. **Input Validation**
   - All inputs validated against Zod schemas
   - Reject invalid data before execution
   - No direct SQL to prevent injection

2. **Output Validation**
   - All outputs validated against Zod schemas
   - Ensures consistent response format
   - Prevents data leakage

3. **Parameterized Queries**
   - All database operations via ruvector-service
   - No direct SQL execution
   - Parameters sanitized by service

4. **API Key Management**
   - ruvector-service API key in environment
   - Never hardcoded or logged
   - Rotate regularly

5. **Audit Trail**
   - Every execution logged via DecisionEvent
   - Success and failure both recorded
   - Immutable audit log

## Related Documentation

- **ADR-003:** Agent Edge Function Architecture (`/docs/architecture/decisions/ADR-003-agent-edge-function-architecture.md`)
- **Technology Evaluation Matrix:** (`/docs/architecture/decisions/technology-evaluation-matrix.md`)
- **Component Interaction Diagram:** (`/docs/architecture/diagrams/agent-component-interaction.md`)
- **Package README:** (`/packages/agents/README.md`)

## References

- [Google Cloud Functions - Node.js](https://cloud.google.com/functions/docs/runtime-support#nodejs)
- [W3C Trace Context Specification](https://www.w3.org/TR/trace-context/)
- [Zod - TypeScript Schema Validation](https://zod.dev/)
- [Template Method Pattern](https://refactoring.guru/design-patterns/template-method)
- [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/)
