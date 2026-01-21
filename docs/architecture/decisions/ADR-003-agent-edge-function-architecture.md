# ADR-003: Agent Edge Function Architecture

**Status:** Accepted
**Date:** 2026-01-21
**Decision Makers:** System Architecture Designer
**Technical Story:** Implement agent infrastructure for LLM-Connector-Hub as Google Cloud Edge Functions

## Context

The LLM-Connector-Hub requires an agent layer that serves as external interface adapters following strict constitutional requirements:

### Constitutional Requirements
- **Agents are EXTERNAL INTERFACE ADAPTERS only** - they adapt external requests to internal execution
- **NO orchestration** - agents do not coordinate workflows or trigger other agents
- **NO policy enforcement** - agents validate inputs but do not enforce business rules
- **Stateless execution** - agents have no internal state between invocations
- **Single DecisionEvent** - each invocation emits exactly ONE DecisionEvent
- **Contract-based validation** - all inputs/outputs validated against Zod schemas from `@llm-dev-ops/agentics-contracts`
- **Persistence via ruvector-service** - NO direct SQL access
- **CLI-invokable** - all agents must be testable via CLI
- **Deployable as Edge Functions** - must run on Google Cloud Edge Functions

### Quality Attributes
- **Observability:** Full distributed tracing compatibility with llm-observatory-core
- **Reliability:** Deterministic execution (same input = same output)
- **Scalability:** Stateless design enables horizontal scaling
- **Security:** Input validation, parameterized queries, no direct SQL
- **Testability:** CLI invocation for integration testing
- **Maintainability:** Clear separation of concerns, contract-driven

## Decision

We will implement a three-layer agent architecture:

### Layer 1: Runtime Infrastructure (`/src/runtime/`)

#### EdgeFunctionAgentBase
Abstract base class providing:
- Input validation using Zod schemas from contracts
- Output validation against contracts
- DecisionEvent creation and emission
- Telemetry span management
- Error normalization and handling
- RuVector client integration
- Template method pattern for agent execution

**Key Methods:**
```typescript
async execute(input: unknown, context: AgentContext): Promise<AgentResult<TOutput>>
protected abstract executeAgent(input: TInput, context: AgentContext, span: Span): Promise<TOutput>
protected getEventType(success: boolean): string
```

#### RuVectorClient
Async persistence layer:
- NO direct SQL execution (constitutional requirement)
- All operations delegated to ruvector-service
- Batch operations for efficiency
- Retry logic with exponential backoff
- Proper error codes and handling
- Query, persist, delete, batchPersist operations

#### TelemetryEmitter
W3C Trace Context compliant observability:
- Span creation and management
- Metric emission
- W3C traceparent header propagation
- Compatible with llm-observatory-core
- Non-blocking telemetry (failures don't fail agents)

### Layer 2: Agent Implementations (`/src/agents/`)

Each agent:
1. Extends `EdgeFunctionAgentBase<TInput, TOutput>`
2. Defines input/output contracts using Zod schemas
3. Implements `executeAgent()` with deterministic logic
4. Emits specific DecisionEvent type
5. Uses RuVectorClient for all persistence

**Example: DatabaseQueryAgent**
- Validates read-only queries (SELECT, DESCRIBE, SHOW, EXPLAIN)
- Blocks write operations (INSERT, UPDATE, DELETE, etc.)
- Executes parameterized queries via ruvector-service
- Normalizes result format
- Emits `database_query_result` DecisionEvent

### Layer 3: CLI Interface (`/src/cli/`)

Commands:
- `connect` - Execute database query agent
- `ingest` - Trigger data ingestion agents (future)
- `normalize` - Run data normalization agents (future)
- `inspect` - View agent execution history from ruvector-service

All agents MUST be CLI-invokable for testing and debugging.

## Architecture Diagram (C4 Component Level)

```
┌────────────────────────────────────────────────────────────────┐
│                    External Consumers                          │
│  (CLI, HTTP Requests, Google Cloud Edge Function Events)      │
└─────────────────────┬──────────────────────────────────────────┘
                      │
                      ▼
┌────────────────────────────────────────────────────────────────┐
│                  Agent Package                                 │
│  @llm-dev-ops/connector-hub-agents                            │
│                                                                │
│  ┌──────────────────────────────────────────────────────┐    │
│  │          EdgeFunctionAgentBase                       │    │
│  │  - Input Validation (Zod)                           │    │
│  │  - Output Validation (Zod)                          │    │
│  │  - DecisionEvent Emission                           │    │
│  │  - Telemetry Hooks                                  │    │
│  │  - Error Handling                                   │    │
│  └────────────┬─────────────────────────────────────────┘    │
│               │                                               │
│               │ extends                                       │
│               ▼                                               │
│  ┌─────────────────────────┐  ┌──────────────────────┐      │
│  │  DatabaseQueryAgent     │  │  Future Agents       │      │
│  │  - Read-only queries    │  │  - IngestionAgent    │      │
│  │  - Result normalization │  │  - NormalizeAgent    │      │
│  │  - SQL injection guard  │  │  - ...               │      │
│  └────────────┬────────────┘  └──────────────────────┘      │
│               │                                               │
│               │ uses                                          │
│               ▼                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │          Runtime Services                            │    │
│  │                                                       │    │
│  │  ┌──────────────┐  ┌──────────────┐                 │    │
│  │  │ RuVectorClient│  │ Telemetry    │                 │    │
│  │  │ - persist()   │  │ Emitter      │                 │    │
│  │  │ - query()     │  │ - startSpan()│                 │    │
│  │  │ - batch()     │  │ - emitMetric()│                 │    │
│  │  │ - delete()    │  │ - W3C trace  │                 │    │
│  │  └──────┬───────┘  └──────┬───────┘                 │    │
│  └─────────┼──────────────────┼──────────────────────────┘    │
└────────────┼──────────────────┼──────────────────────────────┘
             │                  │
             │                  │
    ┌────────▼────────┐  ┌─────▼──────────┐
    │ ruvector-service│  │ llm-observatory│
    │ - Persistence   │  │ - Tracing      │
    │ - Queries       │  │ - Metrics      │
    └─────────────────┘  └────────────────┘
```

## Data Flow

### Successful Agent Execution
```
1. External Request → Agent.execute(input, context)
2. Validate input against contract schema
3. Start telemetry span
4. Execute agent-specific logic (executeAgent)
5. Validate output against contract schema
6. Create DecisionEvent (exactly ONE)
7. Persist DecisionEvent to ruvector-service
8. End telemetry span
9. Return AgentResult with success=true
```

### Failed Agent Execution
```
1. External Request → Agent.execute(input, context)
2. Error occurs (validation, execution, etc.)
3. Record error on telemetry span
4. Create DecisionEvent with error metadata
5. Persist DecisionEvent (even for failures - auditability)
6. End telemetry span with ERROR status
7. Return AgentResult with success=false
```

## Consequences

### Positive
✅ **Constitutional Compliance:** All requirements satisfied
✅ **Stateless:** No internal state enables horizontal scaling
✅ **Deterministic:** Same input always produces same output
✅ **Observable:** Full distributed tracing via W3C Trace Context
✅ **Testable:** CLI invocation enables integration testing
✅ **Secure:** Input validation, parameterized queries, no direct SQL
✅ **Maintainable:** Clear separation of concerns via base class
✅ **Auditable:** Every execution produces a DecisionEvent
✅ **Portable:** Deployable to Google Cloud Edge Functions without modification

### Negative
⚠️ **Additional Latency:** Async persistence adds ~10-50ms per execution
⚠️ **External Dependency:** Requires ruvector-service availability
⚠️ **Learning Curve:** Developers must understand template method pattern
⚠️ **No Direct SQL:** Complex queries may require ruvector-service updates

### Risks and Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| ruvector-service downtime | Medium | High | Retry logic with exponential backoff; graceful degradation for telemetry |
| Contract schema drift | Medium | Medium | Automated contract testing; versioned schemas |
| Performance degradation | Low | Medium | Batch operations; async persistence; monitoring |
| Edge Function cold starts | High | Low | Keep-alive pings; warm pool maintenance |

## Implementation Notes

### Edge Function Deployment
```bash
gcloud functions deploy database-query-agent \
  --runtime nodejs20 \
  --trigger-http \
  --entry-point execute \
  --source dist/agents/database-query \
  --set-env-vars RUVECTOR_SERVICE_URL=https://ruvector.example.com
```

### Required Environment Variables
```bash
RUVECTOR_SERVICE_URL=https://ruvector-service.example.com  # Required
RUVECTOR_API_KEY=secret                                    # Optional
LLM_OBSERVATORY_ENDPOINT=https://observatory.example.com   # Optional
TELEMETRY_ENABLED=true                                     # Optional (default: true)
ENVIRONMENT=production                                     # Optional (default: production)
```

### CLI Testing
```bash
connector-hub-agent connect \
  --query "SELECT * FROM users WHERE status = 'active'" \
  --type SELECT \
  --max-rows 100
```

### Creating New Agents

1. Create directory: `src/agents/my-agent/`
2. Extend `EdgeFunctionAgentBase`
3. Define input/output schemas using Zod
4. Implement `executeAgent()` method
5. Override `getEventType()` for custom event types
6. Add CLI command in `src/cli/index.ts`
7. Export in `src/index.ts`

## Related ADRs

- **ADR-001:** Hexagonal Architecture (agents are external adapters)
- **ADR-002:** Contract-First Development (Zod schema validation)
- **ADR-004:** RuVector Service Design (persistence layer)
- **ADR-005:** Telemetry Standards (llm-observatory-core compatibility)

## References

- [Google Cloud Functions - Node.js](https://cloud.google.com/functions/docs/runtime-support#nodejs)
- [W3C Trace Context Specification](https://www.w3.org/TR/trace-context/)
- [Zod - TypeScript Schema Validation](https://zod.dev/)
- [Template Method Pattern](https://refactoring.guru/design-patterns/template-method)

## Acceptance Criteria

- [x] `EdgeFunctionAgentBase` implemented with template method pattern
- [x] `RuVectorClient` with NO direct SQL execution
- [x] `TelemetryEmitter` with W3C Trace Context support
- [x] `DatabaseQueryAgent` with read-only query validation
- [x] CLI commands: `connect`, `inspect`
- [x] All inputs/outputs validated against contracts
- [x] Every execution emits exactly ONE DecisionEvent
- [x] Package deployable to Google Cloud Edge Functions
- [x] README with usage examples and constitutional checklist
