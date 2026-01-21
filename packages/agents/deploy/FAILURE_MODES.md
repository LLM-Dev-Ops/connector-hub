# LLM-Connector-Hub Failure Modes & Rollback Procedures

## Common Deployment Failures

### 1. Authentication Misconfiguration

**Symptoms:**
- 403 Forbidden responses
- "Permission denied" in logs
- Service account errors

**Detection:**
```bash
# Check service account
gcloud run services describe llm-connector-hub --region=us-central1 --format='value(spec.template.spec.serviceAccountName)'

# Check IAM bindings
gcloud projects get-iam-policy agentics-dev --filter="bindings.members:llm-connector-hub-sa"
```

**Resolution:**
```bash
# Grant missing permissions
gcloud projects add-iam-policy-binding agentics-dev \
  --member="serviceAccount:llm-connector-hub-sa@agentics-dev.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 2. Webhook Signature Mismatch

**Symptoms:**
- 401 Unauthorized on webhook endpoints
- "Signature verification failed" errors
- Webhooks rejected despite valid payloads

**Detection:**
```bash
# Test with verbose logging
curl -v -X POST "$SERVICE_URL/webhook-ingest" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: $(echo -n '{}' | openssl dgst -sha256 -hmac 'your-secret')" \
  -d '{}'
```

**Resolution:**
- Verify secret key matches webhook provider configuration
- Check signature header name matches configuration
- Verify timestamp tolerance settings

### 3. Schema Drift

**Symptoms:**
- Validation errors on previously working payloads
- "Unexpected property" or "Missing required field" errors
- DecisionEvents rejected by downstream consumers

**Detection:**
```bash
# Check schema version
curl -s "$SERVICE_URL/health" | jq '.version'

# Test with known-good payload
curl -s -X POST "$SERVICE_URL/erp-surface" \
  -H "Content-Type: application/json" \
  -d @test-payloads/erp-event-v1.json
```

**Resolution:**
- Roll back to previous version
- Update schemas to maintain backward compatibility
- Coordinate schema changes across services

### 4. RuVector Service Unreachable

**Symptoms:**
- `/ready` returns 503
- "ruvector: unreachable" in health check
- DecisionEvents not persisted

**Detection:**
```bash
# Check readiness
curl -s "$SERVICE_URL/ready" | jq .

# Check secret value
gcloud secrets versions access latest --secret=ruvector-service-url
```

**Resolution:**
```bash
# Update ruvector URL secret
echo -n "https://correct-ruvector-url.run.app" | \
  gcloud secrets versions add ruvector-service-url --data-file=-

# Redeploy to pick up new secret
gcloud run services update llm-connector-hub --region=us-central1
```

### 5. Memory/CPU Exhaustion

**Symptoms:**
- 503 Service Unavailable errors
- "Memory limit exceeded" in logs
- Slow response times

**Detection:**
```bash
# Check revision status
gcloud run revisions list --service=llm-connector-hub --region=us-central1

# Check logs for OOM
gcloud logging read "resource.type=cloud_run_revision AND severity>=ERROR" --limit=50
```

**Resolution:**
```bash
# Increase resources
gcloud run services update llm-connector-hub \
  --region=us-central1 \
  --memory=1Gi \
  --cpu=2
```

---

## Detection Signals

| Signal | Metric | Threshold | Action |
|--------|--------|-----------|--------|
| Failed ingestion | HTTP 4xx rate | > 5% | Check input validation |
| Rejected payloads | HTTP 400 rate | > 10% | Check schema compatibility |
| Missing DecisionEvents | Persistence failures | Any | Check ruvector connectivity |
| High latency | P99 latency | > 2s | Scale up or optimize |
| Error rate | HTTP 5xx rate | > 1% | Check logs, rollback |

---

## Rollback Procedure

### Quick Rollback (Traffic Shift)

```bash
# List available revisions
gcloud run revisions list --service=llm-connector-hub --region=us-central1

# Route traffic to previous revision
gcloud run services update-traffic llm-connector-hub \
  --region=us-central1 \
  --to-revisions=llm-connector-hub-00001-abc=100
```

### Full Rollback (Redeploy Previous Image)

```bash
# Find previous image
gcloud container images list-tags gcr.io/agentics-dev/llm-connector-hub

# Deploy previous image
gcloud run deploy llm-connector-hub \
  --image=gcr.io/agentics-dev/llm-connector-hub:previous-tag \
  --region=us-central1
```

### Emergency Rollback (Disable Service)

```bash
# Scale to zero (emergency stop)
gcloud run services update llm-connector-hub \
  --region=us-central1 \
  --max-instances=0

# Re-enable when ready
gcloud run services update llm-connector-hub \
  --region=us-central1 \
  --max-instances=10
```

---

## Safe Redeploy Strategy

### Pre-Deploy Checklist

1. [ ] Run tests locally: `npm test --workspace=packages/agents`
2. [ ] Build succeeds: `npm run build --workspace=packages/agents`
3. [ ] TypeScript passes: `npm run typecheck --workspace=packages/agents`
4. [ ] Schema backward compatible
5. [ ] Secrets configured in Secret Manager
6. [ ] Previous revision available for rollback

### Gradual Rollout

```bash
# Deploy new revision without traffic
gcloud run deploy llm-connector-hub \
  --image=gcr.io/agentics-dev/llm-connector-hub:new-version \
  --region=us-central1 \
  --no-traffic

# Verify new revision health
NEW_REVISION=$(gcloud run revisions list --service=llm-connector-hub --region=us-central1 --format='value(metadata.name)' --limit=1)
gcloud run revisions describe $NEW_REVISION --region=us-central1

# Gradual traffic shift
gcloud run services update-traffic llm-connector-hub \
  --region=us-central1 \
  --to-revisions=$NEW_REVISION=10

# Monitor for 10 minutes, then increase
gcloud run services update-traffic llm-connector-hub \
  --region=us-central1 \
  --to-revisions=$NEW_REVISION=50

# Full rollout
gcloud run services update-traffic llm-connector-hub \
  --region=us-central1 \
  --to-latest
```

### Data Safety

- All connector writes go through ruvector-service
- ruvector-service handles durability
- No data loss on connector-hub rollback
- DecisionEvents are append-only (no destructive operations)

---

## Monitoring Commands

```bash
# Real-time logs
gcloud logging tail "resource.type=cloud_run_revision AND resource.labels.service_name=llm-connector-hub"

# Error logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=llm-connector-hub AND severity>=ERROR" --limit=100

# Request latency
gcloud monitoring metrics describe run.googleapis.com/request_latencies

# Instance count
gcloud run services describe llm-connector-hub --region=us-central1 --format='value(status.traffic)'
```
