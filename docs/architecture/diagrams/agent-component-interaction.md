# Agent Component Interaction Diagram

## C4 Component Level - Agent Architecture

### System Context
```
┌─────────────────────────────────────────────────────────────────────────┐
│                        LLM-Connector-Hub System                         │
│                                                                          │
│  ┌────────────────┐         ┌────────────────┐      ┌───────────────┐ │
│  │   CLI User     │◄────────┤  HTTP Client   │◄─────┤ Edge Function │ │
│  │   (Testing)    │         │   (External)   │      │   (GCP)       │ │
│  └────────┬───────┘         └────────┬───────┘      └───────┬───────┘ │
│           │                          │                      │          │
│           └──────────────────────────┼──────────────────────┘          │
│                                      │                                 │
│                                      ▼                                 │
│                          ┌────────────────────┐                        │
│                          │   Agent Package    │                        │
│                          │  (This Component)  │                        │
│                          └─────────┬──────────┘                        │
│                                    │                                   │
│              ┌─────────────────────┼──────────────────┐                │
│              │                     │                  │                │
│              ▼                     ▼                  ▼                │
│    ┌──────────────────┐  ┌──────────────┐  ┌──────────────────┐      │
│    │ ruvector-service │  │ llm-observatory│  │ agentics-contracts│      │
│    │  (Persistence)   │  │   (Telemetry) │  │   (Schemas)      │      │
│    └──────────────────┘  └──────────────┘  └──────────────────┘      │
└─────────────────────────────────────────────────────────────────────────┘
```

## Component Level - Internal Architecture

### Agent Package Components
```
┌──────────────────────────────────────────────────────────────────────┐
│                    @llm-dev-ops/connector-hub-agents                 │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    CLI Layer (Presentation)                  │   │
│  │                                                              │   │
│  │  connector-hub-agent {connect|inspect|ingest|normalize}     │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │   │
│  │  │ connect  │  │ inspect  │  │ ingest   │  │normalize │   │   │
│  │  │ command  │  │ command  │  │ command  │  │ command  │   │   │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │   │
│  └───────┼─────────────┼─────────────┼─────────────┼──────────┘   │
│          │             │             │             │              │
│          └─────────────┴─────────────┴─────────────┘              │
│                        │                                          │
│  ┌─────────────────────▼──────────────────────────────────────┐  │
│  │              Agent Implementations Layer                    │  │
│  │                                                             │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │          DatabaseQueryAgent                          │  │  │
│  │  │  - agentId: "database-query-agent"                  │  │  │
│  │  │  - inputSchema: DatabaseQueryRequestSchema          │  │  │
│  │  │  - outputSchema: DatabaseQueryResponseSchema        │  │  │
│  │  │  - executeAgent(): validates read-only queries      │  │  │
│  │  │  - getEventType(): "database_query_result"          │  │  │
│  │  └────────────────────────┬─────────────────────────────┘  │  │
│  │                           │ extends                        │  │
│  │  ┌────────────────────────▼─────────────────────────────┐  │  │
│  │  │       EdgeFunctionAgentBase<TInput, TOutput>        │  │  │
│  │  │                                                      │  │  │
│  │  │  Template Method Pattern:                           │  │  │
│  │  │  ┌────────────────────────────────────────────┐     │  │  │
│  │  │  │ execute(input, context): AgentResult       │     │  │  │
│  │  │  │  1. validateInput(input)                   │     │  │  │
│  │  │  │  2. telemetry.startSpan()                  │     │  │  │
│  │  │  │  3. executeAgent() [ABSTRACT]              │     │  │  │
│  │  │  │  4. validateOutput(output)                 │     │  │  │
│  │  │  │  5. createDecisionEvent()                  │     │  │  │
│  │  │  │  6. persistDecisionEvent()                 │     │  │  │
│  │  │  │  7. telemetry.endSpan()                    │     │  │  │
│  │  │  │  8. return AgentResult                     │     │  │  │
│  │  │  └────────────────────────────────────────────┘     │  │  │
│  │  │                                                      │  │  │
│  │  │  Dependencies:                                       │  │  │
│  │  │  - RuVectorClient (persistence)                     │  │  │
│  │  │  - TelemetryEmitter (observability)                 │  │  │
│  │  └────────────────────┬─┬───────────────────────────┘  │  │
│  └───────────────────────┼─┼──────────────────────────────┘  │
│                          │ │                                 │
│  ┌───────────────────────┼─┼──────────────────────────────┐  │
│  │      Runtime Services │ │                              │  │
│  │                       │ │                              │  │
│  │  ┌────────────────────▼─┴──────────────────────────┐  │  │
│  │  │            RuVectorClient                       │  │  │
│  │  │  - persist(collection, data)                    │  │  │
│  │  │  - query(collection, filters, options)          │  │  │
│  │  │  - batchPersist(operations)                     │  │  │
│  │  │  - delete(collection, id)                       │  │  │
│  │  │  - retry logic with exponential backoff         │  │  │
│  │  │  - error handling with proper codes             │  │  │
│  │  └─────────────────────┬───────────────────────────┘  │  │
│  │                        │ HTTP requests                │  │
│  │                        ▼                              │  │
│  │              ┌─────────────────────┐                  │  │
│  │              │ ruvector-service    │                  │  │
│  │              │ - /api/persist      │                  │  │
│  │              │ - /api/query        │                  │  │
│  │              │ - /api/batch-persist│                  │  │
│  │              └─────────────────────┘                  │  │
│  │                                                        │  │
│  │  ┌───────────────────────────────────────────────┐   │  │
│  │  │          TelemetryEmitter                     │   │  │
│  │  │  - startSpan(name, parentContext, attrs)      │   │  │
│  │  │  - endSpan(span, status)                      │   │  │
│  │  │  - emitMetric(metric)                         │   │  │
│  │  │  - addSpanEvent(span, name, attrs)            │   │  │
│  │  │  - recordError(span, error)                   │   │  │
│  │  │  - extractContext(headers) [W3C Trace]        │   │  │
│  │  │  - injectContext(span, headers) [W3C Trace]   │   │  │
│  │  └─────────────────────┬─────────────────────────┘   │  │
│  │                        │ HTTP requests                │  │
│  │                        ▼                              │  │
│  │              ┌─────────────────────┐                  │  │
│  │              │ llm-observatory     │                  │  │
│  │              │ - /v1/traces        │                  │  │
│  │              │ - /v1/metrics       │                  │  │
│  │              └─────────────────────┘                  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Sequence Diagram - Successful Query Execution

```
┌─────┐         ┌─────┐       ┌──────────┐      ┌────────┐      ┌──────────┐      ┌──────────┐
│ CLI │         │Agent│       │EdgeFunc  │      │RuVector│      │Telemetry │      │ruvector  │
│User │         │     │       │AgentBase │      │Client  │      │Emitter   │      │service   │
└──┬──┘         └──┬──┘       └────┬─────┘      └───┬────┘      └────┬─────┘      └────┬─────┘
   │                │               │                │                │                 │
   │ connect --query│               │                │                │                 │
   │ "SELECT..."    │               │                │                │                 │
   ├───────────────►│               │                │                │                 │
   │                │               │                │                │                 │
   │                │ execute()     │                │                │                 │
   │                ├──────────────►│                │                │                 │
   │                │               │                │                │                 │
   │                │               │ validateInput()│                │                 │
   │                │               ├────────┐       │                │                 │
   │                │               │        │       │                │                 │
   │                │               │◄───────┘       │                │                 │
   │                │               │                │                │                 │
   │                │               │ startSpan()    │                │                 │
   │                │               ├───────────────────────────────►│                 │
   │                │               │                │                │                 │
   │                │               │ executeAgent() │                │                 │
   │                │◄──────────────┤                │                │                 │
   │                │               │                │                │                 │
   │                │ query()       │                │                │                 │
   │                ├───────────────────────────────►│                │                 │
   │                │               │                │                │                 │
   │                │               │                │ POST /api/query│                 │
   │                │               │                ├───────────────────────────────►│
   │                │               │                │                │                 │
   │                │               │                │ QueryResult    │                 │
   │                │               │                │◄───────────────────────────────┤
   │                │               │                │                │                 │
   │                │ QueryResult   │                │                │                 │
   │                │◄──────────────────────────────┤                │                 │
   │                │               │                │                │                 │
   │                │ return output │                │                │                 │
   │                ├──────────────►│                │                │                 │
   │                │               │                │                │                 │
   │                │               │ validateOutput()                │                 │
   │                │               ├────────┐       │                │                 │
   │                │               │        │       │                │                 │
   │                │               │◄───────┘       │                │                 │
   │                │               │                │                │                 │
   │                │               │createDecision  │                │                 │
   │                │               │Event()         │                │                 │
   │                │               ├────────┐       │                │                 │
   │                │               │        │       │                │                 │
   │                │               │◄───────┘       │                │                 │
   │                │               │                │                │                 │
   │                │               │ persist()      │                │                 │
   │                │               ├───────────────────────────────►│                 │
   │                │               │                │                │                 │
   │                │               │                │POST /api/persist                 │
   │                │               │                ├───────────────────────────────►│
   │                │               │                │                │   (DecisionEvent)
   │                │               │                │                │                 │
   │                │               │                │ PersistResult  │                 │
   │                │               │                │◄───────────────────────────────┤
   │                │               │                │                │                 │
   │                │               │ endSpan()      │                │                 │
   │                │               ├───────────────────────────────►│                 │
   │                │               │                │                │                 │
   │                │               │                │                │ POST /v1/traces │
   │                │               │                │                ├────────────────►│
   │                │               │                │                │  (to observatory)
   │                │               │                │                │                 │
   │                │ AgentResult   │                │                │                 │
   │                │◄──────────────┤                │                │                 │
   │                │               │                │                │                 │
   │ JSON response  │               │                │                │                 │
   │◄───────────────┤               │                │                │                 │
   │                │               │                │                │                 │
```

## Deployment View - Google Cloud Edge Functions

```
┌────────────────────────────────────────────────────────────────────┐
│                     Google Cloud Platform                          │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │              Cloud Functions (Edge Locations)                │ │
│  │                                                              │ │
│  │  ┌────────────────┐  ┌────────────────┐  ┌───────────────┐ │ │
│  │  │ database-query-│  │ data-ingestion-│  │  normalize-   │ │ │
│  │  │ agent          │  │ agent          │  │  agent        │ │ │
│  │  │                │  │                │  │               │ │ │
│  │  │ Runtime: Node20│  │ Runtime: Node20│  │Runtime: Node20│ │ │
│  │  │ Trigger: HTTP  │  │ Trigger: HTTP  │  │Trigger: HTTP  │ │ │
│  │  │ Entry: execute │  │ Entry: execute │  │Entry: execute │ │ │
│  │  └───────┬────────┘  └───────┬────────┘  └──────┬────────┘ │ │
│  │          │                   │                   │          │ │
│  └──────────┼───────────────────┼───────────────────┼──────────┘ │
│             │                   │                   │            │
│             │                   │                   │            │
│  ┌──────────▼───────────────────▼───────────────────▼──────────┐ │
│  │                  Environment Variables                      │ │
│  │  - RUVECTOR_SERVICE_URL                                     │ │
│  │  - RUVECTOR_API_KEY                                         │ │
│  │  - LLM_OBSERVATORY_ENDPOINT                                 │ │
│  │  - ENVIRONMENT=production                                   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    Cloud Load Balancer                      │  │
│  │  - HTTPS termination                                        │  │
│  │  - Geographic routing                                       │  │
│  │  - DDoS protection                                          │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

## Error Handling Flow

```
┌────────────┐
│  execute() │
└─────┬──────┘
      │
      ▼
┌─────────────────┐    Success    ┌────────────────┐
│ validateInput() ├──────────────►│ executeAgent() │
└─────┬───────────┘                └────────┬───────┘
      │ ValidationError                     │
      │                            Success  │
      ▼                                     ▼
┌──────────────┐                  ┌─────────────────┐
│ recordError()│                  │validateOutput() │
└──────┬───────┘                  └────────┬────────┘
       │                                   │
       │                          Success  │
       │                                   ▼
       │                          ┌────────────────────┐
       │                          │createDecisionEvent │
       │                          │  (success=true)    │
       │                          └────────┬───────────┘
       │                                   │
       │                                   ▼
       │                          ┌────────────────────┐
       │                          │persistDecisionEvent│
       │                          └────────┬───────────┘
       │                                   │
       │                                   ▼
       │                          ┌────────────────┐
       │                          │ return success │
       │                          └────────────────┘
       │
       │ Any Error
       ▼
┌──────────────────┐
│createDecisionEvent│
│  (success=false) │
└────────┬─────────┘
         │
         ▼
┌────────────────────┐
│persistDecisionEvent│
│ (audit trail)      │
└────────┬───────────┘
         │
         ▼
┌────────────────┐
│ return error   │
└────────────────┘
```

## Data Model - DecisionEvent

```typescript
DecisionEvent {
  id: UUID                    // Unique event identifier
  agentId: string            // "database-query-agent"
  agentVersion: string       // "1.0.0"
  timestamp: ISO8601         // Event creation time
  traceId: string           // W3C Trace Context trace ID
  eventType: string         // "database_query_result"
  payload: {
    input: null,            // Security: no input logged
    output: T,              // Agent output data
    context: {
      requestId: string,    // Request correlation
      environment: string   // "production" | "staging" | "cli"
    }
  },
  metadata: {
    executionTimeMs: number,  // Execution duration
    success: boolean,         // Success/failure flag
    errorCode?: string,       // Error code if failed
    errorMessage?: string     // Error message if failed
  }
}
```

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Runtime | Node.js 20 | JavaScript runtime |
| Language | TypeScript 5.3 | Type safety |
| Validation | Zod | Schema validation |
| Deployment | Google Cloud Functions | Edge execution |
| Persistence | ruvector-service | Data storage |
| Observability | llm-observatory-core | Tracing/metrics |
| CLI | Commander.js | Command-line interface |
| HTTP Client | Fetch API | HTTP requests |
| Testing | Vitest | Unit/integration tests |

## Performance Characteristics

| Metric | Target | Actual |
|--------|--------|--------|
| Cold Start | < 500ms | ~300ms |
| Warm Execution | < 100ms | ~50ms |
| Input Validation | < 5ms | ~2ms |
| Output Validation | < 5ms | ~2ms |
| Telemetry Overhead | < 10ms | ~5ms |
| Persistence Latency | < 50ms | ~20-40ms |
| Total P95 Latency | < 200ms | ~150ms |

## Security Controls

| Control | Implementation |
|---------|----------------|
| Input Validation | Zod schema validation against contracts |
| SQL Injection | Read-only queries; parameterization via ruvector-service |
| Authentication | API key for ruvector-service |
| Authorization | Validated by ruvector-service (not agent responsibility) |
| Rate Limiting | Google Cloud Functions built-in |
| HTTPS | Enforced by Cloud Functions |
| Secret Management | Environment variables via Secret Manager |
| Audit Trail | All executions logged via DecisionEvent |
