# LLM-Connector-Hub Post-Deploy Verification Checklist

## Service Health

- [ ] Service is live and responding
- [ ] `/health` endpoint returns 200 OK
- [ ] `/ready` endpoint returns 200 OK (ruvector-service connected)

## Agent Endpoint Verification

### ERP Surface Agent
- [ ] `POST /erp-surface` accepts valid ERP events
- [ ] Returns DecisionEvent with `decision_type: erp_surface_event`
- [ ] Rejects invalid ERP systems
- [ ] Enforces read-only operations

### Database Query Agent
- [ ] `POST /database-query` accepts valid queries
- [ ] Returns DecisionEvent with query results
- [ ] Enforces read-only queries (SELECT, DESCRIBE, SHOW, EXPLAIN only)
- [ ] Respects query timeout limits

### Webhook Ingest Agent
- [ ] `POST /webhook-ingest` accepts webhook payloads
- [ ] Signature verification works for configured methods
- [ ] Replay protection active
- [ ] Rate limiting enforced

### Event Normalization Agent
- [ ] `POST /event-normalize` normalizes external events
- [ ] Supports all configured formats (OpenAI, Anthropic, GitHub, Stripe, etc.)
- [ ] Outputs canonical event schema

### Auth Identity Agent
- [ ] `POST /auth-identity` validates identity tokens
- [ ] JWT verification works
- [ ] API key validation works
- [ ] Returns identity verification DecisionEvent

## Persistence Verification

- [ ] DecisionEvents appear in ruvector-service
- [ ] No direct SQL connections from connector-hub
- [ ] Idempotent writes verified
- [ ] Append-only behavior confirmed

## Telemetry Verification

- [ ] Traces appear in LLM-Observatory
- [ ] Spans include correct service name
- [ ] Error events are recorded
- [ ] Latency metrics available

## CLI Verification

### connector-hub-agent CLI
```bash
# Test connectivity
connector-hub-agent connect --endpoint $SERVICE_URL

# Test webhook ingestion
connector-hub-agent ingest -c config.json --payload payload.json

# Test normalization
connector-hub-agent normalize --connector-id test < payload.json

# Inspect configuration
connector-hub-agent inspect -c config.json
```

### erp-surface CLI
```bash
# Test ERP event ingestion
erp-surface ingest \
  --erp-system sap \
  --event-type purchase_order_created \
  --payload '{"document_number": "PO-12345"}' \
  --tenant-id tenant-123

# Health check
erp-surface health

# Inspect configuration
erp-surface inspect --config
```

## Schema Compliance

- [ ] All DecisionEvents conform to agentics-contracts schema
- [ ] Input validation uses Zod schemas
- [ ] Output schemas match canonical definitions

## Security Verification

- [ ] Service account has minimal permissions
- [ ] Secrets retrieved from Secret Manager (not env vars in production)
- [ ] No credentials in logs
- [ ] CORS headers properly configured

## Integration Verification

- [ ] LLM-Orchestrator can consume normalized outputs
- [ ] LLM-Policy-Engine can reference identity verification
- [ ] Analytics-Hub can aggregate connector DecisionEvents
- [ ] No direct invocation of internal execution paths

## Performance Verification

- [ ] Response latency < 500ms for typical requests
- [ ] Memory usage stable
- [ ] No memory leaks over time
- [ ] Autoscaling works correctly

---

## Verification Commands

```bash
# Set service URL
export SERVICE_URL=$(gcloud run services describe llm-connector-hub --region=us-central1 --format='value(status.url)')

# Health check
curl -s "$SERVICE_URL/health" | jq .

# Ready check
curl -s "$SERVICE_URL/ready" | jq .

# Test ERP Surface
curl -s -X POST "$SERVICE_URL/erp-surface" \
  -H "Content-Type: application/json" \
  -d '{
    "event": {
      "erp_system": "sap",
      "event_type": "purchase_order_created",
      "event_timestamp": "2024-01-15T10:30:00Z",
      "payload": {"document_number": "PO-12345"}
    },
    "auth_context": {"tenant_id": "tenant-123"}
  }' | jq .

# Test Webhook Ingest
curl -s -X POST "$SERVICE_URL/webhook-ingest" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: test" \
  -d '{"event_type": "test.event", "data": {"id": "123"}}' | jq .

# Test Event Normalization
curl -s -X POST "$SERVICE_URL/event-normalize" \
  -H "Content-Type: application/json" \
  -d '{"format": "openai", "payload": {"model": "gpt-4", "usage": {"total_tokens": 100}}}' | jq .
```
