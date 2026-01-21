/**
 * WebhookListenerAgent Tests
 *
 * Comprehensive test suite for the Webhook Listener Agent.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebhookListenerAgent, createWebhookListenerAgent } from '../WebhookListenerAgent.js';
import { createTestSignature, createTestJwt } from '../signature.js';
import { MockRuVectorClient } from '../../services/ruvector-client.js';
import { TelemetryService } from '../../services/telemetry.js';
import type { WebhookAgentConfig, WebhookRequest } from '../../contracts/index.js';

describe('WebhookListenerAgent', () => {
  let agent: WebhookListenerAgent;
  let mockRuVectorClient: MockRuVectorClient;
  let telemetry: TelemetryService;

  const baseConfig: WebhookAgentConfig = {
    connector_id: 'test-connector',
    connector_scope: 'test-webhook',
    debug: false,
    timeout_ms: 5000,
    max_payload_bytes: 1048576,
    telemetry_enabled: false,
    allowed_content_types: ['application/json'],
    rate_limit_enabled: false,
    rate_limit_rpm: 100,
  };

  const createRequest = (overrides: Partial<WebhookRequest> = {}): WebhookRequest => ({
    method: 'POST',
    path: '/webhook',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ event_type: 'test', data: { key: 'value' } }),
    received_at: new Date().toISOString(),
    content_type: 'application/json',
    ...overrides,
  });

  beforeEach(async () => {
    mockRuVectorClient = new MockRuVectorClient();
    telemetry = new TelemetryService({
      serviceName: 'test',
      logLevel: 'error',
    });

    agent = new WebhookListenerAgent(baseConfig, {
      ruvectorClient: mockRuVectorClient,
      telemetry,
    });

    await agent.initialize();
  });

  afterEach(async () => {
    await agent.shutdown();
    mockRuVectorClient.clear();
    telemetry.resetMetrics();
  });

  describe('constructor', () => {
    it('should create an agent with the correct ID', () => {
      expect(agent.agentId).toBe('webhook-listener-test-connector');
    });

    it('should have the correct version', () => {
      expect(agent.version).toBe('1.0.0');
    });

    it('should have the correct decision type', () => {
      expect(agent.decisionType).toBe('webhook_ingest_event');
    });
  });

  describe('process', () => {
    it('should successfully process a valid webhook request', async () => {
      const request = createRequest();
      const response = await agent.process(request);

      expect(response.status).toBe('success');
      expect(response.decision_event).toBeDefined();
      expect(response.decision_event?.decision_type).toBe('webhook_ingest_event');
      expect(response.decision_event?.agent_id).toBe('webhook-listener-test-connector');
      expect(response.telemetry?.duration_ms).toBeGreaterThan(0);
    });

    it('should emit a DecisionEvent with correct structure', async () => {
      const request = createRequest();
      const response = await agent.process(request);

      const event = response.decision_event!;

      // Required fields
      expect(event.agent_id).toBe('webhook-listener-test-connector');
      expect(event.agent_version).toBe('1.0.0');
      expect(event.decision_type).toBe('webhook_ingest_event');
      expect(event.inputs_hash).toHaveLength(64); // SHA-256 hex
      expect(event.execution_ref).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      ); // UUID format
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601

      // Confidence
      expect(event.confidence.score).toBeGreaterThan(0);
      expect(event.confidence.score).toBeLessThanOrEqual(1);

      // Constraints
      expect(event.constraints_applied.connector_scope).toBe('test-webhook');
    });

    it('should persist data to ruvector-service', async () => {
      const request = createRequest();
      await agent.process(request);

      expect(mockRuVectorClient.persistedItems).toHaveLength(1);
      expect(mockRuVectorClient.persistedItems[0].path).toBe('/api/v1/webhook-data');
    });

    it('should extract event type from payload', async () => {
      const request = createRequest({
        body: JSON.stringify({ event_type: 'user.created', data: {} }),
      });
      const response = await agent.process(request);

      const outputs = response.decision_event?.outputs as { event_type?: string };
      expect(outputs.event_type).toBe('user.created');
    });

    it('should extract identifiers from payload', async () => {
      const request = createRequest({
        body: JSON.stringify({
          id: 'ext-123',
          correlation_id: 'corr-456',
          idempotency_key: 'idemp-789',
        }),
      });
      const response = await agent.process(request);

      const outputs = response.decision_event?.outputs as {
        identifiers?: { external_id?: string; correlation_id?: string; idempotency_key?: string };
      };
      expect(outputs.identifiers?.external_id).toBe('ext-123');
      expect(outputs.identifiers?.correlation_id).toBe('corr-456');
      expect(outputs.identifiers?.idempotency_key).toBe('idemp-789');
    });
  });

  describe('validation', () => {
    it('should reject requests with invalid content type', async () => {
      const request = createRequest({
        content_type: 'text/plain',
        headers: { 'content-type': 'text/plain' },
      });
      const response = await agent.process(request);

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('PAYLOAD_VALIDATION_FAILED');
    });

    it('should reject requests with invalid JSON', async () => {
      const request = createRequest({
        body: 'not valid json',
      });
      const response = await agent.process(request);

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('PAYLOAD_VALIDATION_FAILED');
    });

    it('should reject payloads exceeding size limit', async () => {
      const smallConfig: WebhookAgentConfig = {
        ...baseConfig,
        max_payload_bytes: 10, // Very small limit
      };

      const smallAgent = new WebhookListenerAgent(smallConfig, {
        ruvectorClient: mockRuVectorClient,
        telemetry,
      });
      await smallAgent.initialize();

      const request = createRequest({
        body: JSON.stringify({ data: 'a'.repeat(100) }),
      });
      const response = await smallAgent.process(request);

      expect(response.status).toBe('validation_failed');
      expect(response.error?.message).toContain('exceeds limit');

      await smallAgent.shutdown();
    });
  });

  describe('signature verification', () => {
    it('should verify HMAC-SHA256 signatures', async () => {
      const secret = 'test-secret';
      const signedConfig: WebhookAgentConfig = {
        ...baseConfig,
        signature: {
          method: 'hmac_sha256',
          header_name: 'X-Webhook-Signature',
          secret_key: secret,
          timestamp_tolerance_seconds: 0, // Disable timestamp check
          timestamp_header: 'X-Webhook-Timestamp',
          api_key_header: 'X-API-Key',
        },
      };

      const signedAgent = new WebhookListenerAgent(signedConfig, {
        ruvectorClient: mockRuVectorClient,
        telemetry,
      });
      await signedAgent.initialize();

      const body = JSON.stringify({ test: 'data' });
      const signature = createTestSignature(body, secret, 'sha256');

      const request = createRequest({
        body,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': signature,
        },
      });

      const response = await signedAgent.process(request);
      expect(response.status).toBe('success');
      expect(response.decision_event?.confidence.auth_assurance).toBe('high');

      await signedAgent.shutdown();
    });

    it('should reject invalid HMAC signatures', async () => {
      const signedConfig: WebhookAgentConfig = {
        ...baseConfig,
        signature: {
          method: 'hmac_sha256',
          header_name: 'X-Webhook-Signature',
          secret_key: 'correct-secret',
          timestamp_tolerance_seconds: 0,
          timestamp_header: 'X-Webhook-Timestamp',
          api_key_header: 'X-API-Key',
        },
      };

      const signedAgent = new WebhookListenerAgent(signedConfig, {
        ruvectorClient: mockRuVectorClient,
        telemetry,
      });
      await signedAgent.initialize();

      const body = JSON.stringify({ test: 'data' });
      const wrongSignature = createTestSignature(body, 'wrong-secret', 'sha256');

      const request = createRequest({
        body,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': wrongSignature,
        },
      });

      const response = await signedAgent.process(request);
      expect(response.status).toBe('auth_failed');
      expect(response.error?.code).toBe('SIGNATURE_VERIFICATION_FAILED');

      await signedAgent.shutdown();
    });

    it('should verify API key authentication', async () => {
      const apiKey = 'test-api-key-12345';
      const apiKeyConfig: WebhookAgentConfig = {
        ...baseConfig,
        signature: {
          method: 'api_key',
          header_name: 'X-Webhook-Signature',
          secret_key: apiKey,
          timestamp_tolerance_seconds: 0,
          timestamp_header: 'X-Webhook-Timestamp',
          api_key_header: 'X-API-Key',
        },
      };

      const apiKeyAgent = new WebhookListenerAgent(apiKeyConfig, {
        ruvectorClient: mockRuVectorClient,
        telemetry,
      });
      await apiKeyAgent.initialize();

      const request = createRequest({
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
        },
      });

      const response = await apiKeyAgent.process(request);
      expect(response.status).toBe('success');
      expect(response.decision_event?.confidence.auth_assurance).toBe('medium');

      await apiKeyAgent.shutdown();
    });

    it('should verify JWT tokens', async () => {
      const secret = 'jwt-secret-key';
      const jwtConfig: WebhookAgentConfig = {
        ...baseConfig,
        signature: {
          method: 'jwt_hs256',
          header_name: 'X-Webhook-Signature',
          secret_key: secret,
          timestamp_tolerance_seconds: 0,
          timestamp_header: 'X-Webhook-Timestamp',
          api_key_header: 'X-API-Key',
        },
      };

      const jwtAgent = new WebhookListenerAgent(jwtConfig, {
        ruvectorClient: mockRuVectorClient,
        telemetry,
      });
      await jwtAgent.initialize();

      const token = createTestJwt({ sub: 'webhook-sender' }, secret);

      const request = createRequest({
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
      });

      const response = await jwtAgent.process(request);
      expect(response.status).toBe('success');
      expect(response.decision_event?.confidence.auth_assurance).toBe('verified');

      await jwtAgent.shutdown();
    });
  });

  describe('source IP validation', () => {
    it('should accept requests from allowed IPs', async () => {
      const ipConfig: WebhookAgentConfig = {
        ...baseConfig,
        allowed_source_ips: ['192.168.1.0/24', '10.0.0.0/8'],
      };

      const ipAgent = new WebhookListenerAgent(ipConfig, {
        ruvectorClient: mockRuVectorClient,
        telemetry,
      });
      await ipAgent.initialize();

      const request = createRequest({
        source_ip: '192.168.1.100',
      });

      const response = await ipAgent.process(request);
      expect(response.status).toBe('success');

      await ipAgent.shutdown();
    });

    it('should reject requests from disallowed IPs', async () => {
      const ipConfig: WebhookAgentConfig = {
        ...baseConfig,
        allowed_source_ips: ['192.168.1.0/24'],
      };

      const ipAgent = new WebhookListenerAgent(ipConfig, {
        ruvectorClient: mockRuVectorClient,
        telemetry,
      });
      await ipAgent.initialize();

      const request = createRequest({
        source_ip: '10.0.0.1',
      });

      const response = await ipAgent.process(request);
      expect(response.status).toBe('auth_failed');
      expect(response.error?.code).toBe('SOURCE_IP_NOT_ALLOWED');

      await ipAgent.shutdown();
    });
  });

  describe('healthCheck', () => {
    it('should return true when healthy', async () => {
      const healthy = await agent.healthCheck();
      expect(healthy).toBe(true);
    });
  });

  describe('metrics', () => {
    it('should track request metrics', async () => {
      const request = createRequest();
      await agent.process(request);
      await agent.process(request);

      const metrics = agent.getMetrics();
      expect(metrics.requestCount).toBe(2);
      expect(metrics.successCount).toBe(2);
      expect(metrics.errorCount).toBe(0);
    });

    it('should track error metrics', async () => {
      const request = createRequest({
        body: 'invalid json',
      });
      await agent.process(request);

      const metrics = agent.getMetrics();
      expect(metrics.errorCount).toBe(1);
    });
  });

  describe('factory function', () => {
    it('should create an agent using factory function', async () => {
      const factoryAgent = createWebhookListenerAgent(baseConfig, {
        ruvectorClient: mockRuVectorClient,
        telemetry,
      });

      await factoryAgent.initialize();
      expect(factoryAgent.agentId).toBe('webhook-listener-test-connector');
      await factoryAgent.shutdown();
    });
  });

  describe('idempotency', () => {
    it('should generate different execution refs for identical requests', async () => {
      const request = createRequest();

      const response1 = await agent.process(request);
      const response2 = await agent.process(request);

      expect(response1.decision_event?.execution_ref).not.toBe(
        response2.decision_event?.execution_ref
      );
    });

    it('should generate same inputs_hash for identical payloads', async () => {
      const request = createRequest();

      const response1 = await agent.process(request);
      const response2 = await agent.process(request);

      expect(response1.decision_event?.inputs_hash).toBe(
        response2.decision_event?.inputs_hash
      );
    });
  });
});
