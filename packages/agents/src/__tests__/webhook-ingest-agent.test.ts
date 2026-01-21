/**
 * Webhook Ingest Agent Tests
 *
 * Tests for the Webhook Ingest Agent which:
 * - Validates incoming webhook payloads
 * - Normalizes webhook data
 * - Emits DecisionEvent with ingested data
 * - Handles authentication/authorization
 * - Enforces rate limits and size limits
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DecisionEventSchema,
  AgentResponseSchema,
  type AgentResponse,
  type IAgent,
} from '../contracts/types';

/**
 * Mock Webhook Ingest Agent implementation for testing
 */
class WebhookIngestAgent implements IAgent {
  readonly agentId = 'webhook-ingest-agent';
  readonly version = '1.0.0';
  readonly decisionType = 'webhook_ingest_event' as const;

  private initialized = false;
  private readonly maxPayloadBytes = 10485760; // 10MB
  private readonly rateLimitPerMinute = 100;
  private requestCounts = new Map<string, number>();

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async process(input: unknown): Promise<AgentResponse> {
    const startTime = Date.now();

    if (!this.initialized) {
      return this.createErrorResponse('NOT_INITIALIZED', 'Agent not initialized', false);
    }

    // Input validation
    if (typeof input !== 'object' || input === null) {
      return this.createErrorResponse('INVALID_INPUT', 'Input must be an object', false);
    }

    const webhookInput = input as Record<string, unknown>;

    // Validate required fields
    if (!webhookInput.payload) {
      return this.createErrorResponse('MISSING_PAYLOAD', 'Payload field is required', false);
    }

    if (!webhookInput.source || typeof webhookInput.source !== 'string') {
      return this.createErrorResponse('MISSING_SOURCE', 'Source field is required', false);
    }

    const source = webhookInput.source as string;
    const payload = webhookInput.payload;

    // Size validation
    const payloadSize = JSON.stringify(payload).length;
    if (payloadSize > this.maxPayloadBytes) {
      return this.createErrorResponse(
        'PAYLOAD_TOO_LARGE',
        `Payload size ${payloadSize} exceeds limit of ${this.maxPayloadBytes} bytes`,
        false
      );
    }

    // Rate limiting
    const requestCount = this.requestCounts.get(source) || 0;
    if (requestCount >= this.rateLimitPerMinute) {
      return {
        status: 'rate_limited',
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Rate limit of ${this.rateLimitPerMinute} requests per minute exceeded`,
          retryable: true,
        },
      };
    }

    // Authentication check (optional)
    let authAssurance: 'none' | 'low' | 'medium' | 'high' | 'verified' = 'none';
    let identityContext: string | undefined;

    if (webhookInput.auth_token) {
      // Simulate authentication validation
      const token = webhookInput.auth_token as string;
      if (token.startsWith('valid-')) {
        authAssurance = 'verified';
        identityContext = `user-${token.substring(6)}`;
      } else if (token.startsWith('medium-')) {
        authAssurance = 'medium';
        identityContext = `anonymous-${source}`;
      } else {
        return {
          status: 'auth_failed',
          error: {
            code: 'INVALID_AUTH_TOKEN',
            message: 'Authentication token is invalid',
            retryable: false,
          },
        };
      }
    }

    try {
      // Normalize webhook data
      const normalizedPayload = {
        source,
        received_at: new Date().toISOString(),
        payload,
        metadata: {
          content_type: webhookInput.content_type || 'application/json',
          size_bytes: payloadSize,
        },
      };

      // Create DecisionEvent
      const crypto = require('crypto');
      const inputsHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(input))
        .digest('hex');

      const decisionEvent = {
        agent_id: this.agentId,
        agent_version: this.version,
        decision_type: this.decisionType,
        inputs_hash: inputsHash,
        outputs: normalizedPayload,
        confidence: {
          score: 0.95,
          auth_assurance: authAssurance,
          payload_completeness: 1.0,
          schema_validation: 'passed' as const,
        },
        constraints_applied: {
          connector_scope: 'webhook-connector',
          identity_context: identityContext,
          rate_limit_applied: true,
          size_limit_bytes: this.maxPayloadBytes,
        },
        execution_ref: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      };

      // Update rate limit counter
      this.requestCounts.set(source, requestCount + 1);

      const duration = Date.now() - startTime;

      return {
        status: 'success',
        decision_event: decisionEvent,
        telemetry: {
          duration_ms: duration,
          validation_time_ms: 3,
        },
      };
    } catch (error) {
      return this.createErrorResponse(
        'PROCESSING_ERROR',
        error instanceof Error ? error.message : 'Unknown error',
        true
      );
    }
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.requestCounts.clear();
  }

  async healthCheck(): Promise<boolean> {
    return this.initialized;
  }

  private createErrorResponse(
    code: string,
    message: string,
    retryable: boolean
  ): AgentResponse {
    return {
      status: code.includes('INVALID') || code.includes('MISSING') ? 'validation_failed' : 'error',
      error: {
        code,
        message,
        retryable,
      },
    };
  }

  // Test helper to reset rate limits
  public resetRateLimits(): void {
    this.requestCounts.clear();
  }
}

describe('WebhookIngestAgent', () => {
  let agent: WebhookIngestAgent;

  beforeEach(async () => {
    agent = new WebhookIngestAgent();
    await agent.initialize();
  });

  afterEach(async () => {
    await agent.shutdown();
  });

  describe('Successful Webhook Ingestion', () => {
    it('should ingest valid webhook successfully', async () => {
      const input = {
        source: 'github',
        payload: { event: 'push', repo: 'test-repo' },
      };

      const response = await agent.process(input);

      expect(response.status).toBe('success');
      expect(response.decision_event).toBeDefined();
      expect(response.decision_event?.decision_type).toBe('webhook_ingest_event');
    });

    it('should normalize webhook data in outputs', async () => {
      const input = {
        source: 'stripe',
        payload: { type: 'payment.succeeded', amount: 1000 },
      };

      const response = await agent.process(input);

      expect(response.decision_event?.outputs.source).toBe('stripe');
      expect(response.decision_event?.outputs.payload).toEqual(input.payload);
      expect(response.decision_event?.outputs.received_at).toBeDefined();
    });

    it('should include metadata about the webhook', async () => {
      const input = {
        source: 'slack',
        payload: { message: 'test' },
        content_type: 'application/json',
      };

      const response = await agent.process(input);

      expect(response.decision_event?.outputs.metadata).toBeDefined();
      expect(response.decision_event?.outputs.metadata.content_type).toBe('application/json');
      expect(response.decision_event?.outputs.metadata.size_bytes).toBeGreaterThan(0);
    });
  });

  describe('Input Validation', () => {
    it('should reject null input', async () => {
      const response = await agent.process(null);

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('INVALID_INPUT');
    });

    it('should reject input without payload', async () => {
      const response = await agent.process({ source: 'test' });

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('MISSING_PAYLOAD');
    });

    it('should reject input without source', async () => {
      const response = await agent.process({ payload: { test: 'data' } });

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('MISSING_SOURCE');
    });

    it('should reject input with non-string source', async () => {
      const response = await agent.process({
        source: 123,
        payload: { test: 'data' },
      });

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('MISSING_SOURCE');
    });
  });

  describe('Size Limit Enforcement', () => {
    it('should accept payload within size limit', async () => {
      const input = {
        source: 'test',
        payload: { data: 'a'.repeat(1000) }, // 1KB
      };

      const response = await agent.process(input);

      expect(response.status).toBe('success');
    });

    it('should reject payload exceeding size limit', async () => {
      const input = {
        source: 'test',
        payload: { data: 'a'.repeat(11 * 1024 * 1024) }, // 11MB (exceeds 10MB limit)
      };

      const response = await agent.process(input);

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('should include size_limit_bytes in constraints_applied', async () => {
      const input = {
        source: 'test',
        payload: { test: 'data' },
      };

      const response = await agent.process(input);

      expect(response.decision_event?.constraints_applied.size_limit_bytes).toBe(10485760);
    });
  });

  describe('Rate Limiting', () => {
    it('should accept requests within rate limit', async () => {
      const input = {
        source: 'test-source',
        payload: { test: 'data' },
      };

      // Send 5 requests (within limit of 100)
      for (let i = 0; i < 5; i++) {
        const response = await agent.process(input);
        expect(response.status).toBe('success');
      }
    });

    it('should reject requests exceeding rate limit', async () => {
      const input = {
        source: 'rate-limited-source',
        payload: { test: 'data' },
      };

      // Send 101 requests (exceeds limit of 100)
      let lastResponse: AgentResponse | null = null;
      for (let i = 0; i < 101; i++) {
        lastResponse = await agent.process(input);
      }

      expect(lastResponse?.status).toBe('rate_limited');
      expect(lastResponse?.error?.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(lastResponse?.error?.retryable).toBe(true);
    });

    it('should track rate limits per source independently', async () => {
      const input1 = { source: 'source-1', payload: { test: 'data' } };
      const input2 = { source: 'source-2', payload: { test: 'data' } };

      // Fill up source-1
      for (let i = 0; i < 100; i++) {
        await agent.process(input1);
      }

      // source-2 should still work
      const response = await agent.process(input2);
      expect(response.status).toBe('success');

      // source-1 should be rate limited
      const response1 = await agent.process(input1);
      expect(response1.status).toBe('rate_limited');
    });

    it('should indicate rate_limit_applied in constraints', async () => {
      const input = {
        source: 'test',
        payload: { test: 'data' },
      };

      const response = await agent.process(input);

      expect(response.decision_event?.constraints_applied.rate_limit_applied).toBe(true);
    });
  });

  describe('Authentication Handling', () => {
    it('should process unauthenticated webhook with auth_assurance=none', async () => {
      const input = {
        source: 'public-webhook',
        payload: { test: 'data' },
      };

      const response = await agent.process(input);

      expect(response.status).toBe('success');
      expect(response.decision_event?.confidence.auth_assurance).toBe('none');
      expect(response.decision_event?.constraints_applied.identity_context).toBeUndefined();
    });

    it('should accept valid authentication token', async () => {
      const input = {
        source: 'authenticated-webhook',
        payload: { test: 'data' },
        auth_token: 'valid-user123',
      };

      const response = await agent.process(input);

      expect(response.status).toBe('success');
      expect(response.decision_event?.confidence.auth_assurance).toBe('verified');
      expect(response.decision_event?.constraints_applied.identity_context).toBe('user-user123');
    });

    it('should handle medium authentication level', async () => {
      const input = {
        source: 'semi-auth-webhook',
        payload: { test: 'data' },
        auth_token: 'medium-session',
      };

      const response = await agent.process(input);

      expect(response.status).toBe('success');
      expect(response.decision_event?.confidence.auth_assurance).toBe('medium');
    });

    it('should reject invalid authentication token', async () => {
      const input = {
        source: 'test',
        payload: { test: 'data' },
        auth_token: 'invalid-token',
      };

      const response = await agent.process(input);

      expect(response.status).toBe('auth_failed');
      expect(response.error?.code).toBe('INVALID_AUTH_TOKEN');
      expect(response.error?.retryable).toBe(false);
    });
  });

  describe('DecisionEvent Emission', () => {
    it('should emit exactly ONE DecisionEvent per successful invocation', async () => {
      const input = {
        source: 'test',
        payload: { test: 'data' },
      };

      const response = await agent.process(input);

      expect(response.decision_event).toBeDefined();

      // Validate schema
      const validationResult = DecisionEventSchema.safeParse(response.decision_event);
      expect(validationResult.success).toBe(true);
    });

    it('should not emit DecisionEvent on validation failure', async () => {
      const response = await agent.process(null);

      expect(response.decision_event).toBeUndefined();
    });

    it('should not emit DecisionEvent on auth failure', async () => {
      const input = {
        source: 'test',
        payload: { test: 'data' },
        auth_token: 'invalid',
      };

      const response = await agent.process(input);

      expect(response.decision_event).toBeUndefined();
    });

    it('should not emit DecisionEvent on rate limit', async () => {
      agent.resetRateLimits();
      const input = {
        source: 'limited',
        payload: { test: 'data' },
      };

      // Exceed rate limit
      for (let i = 0; i < 101; i++) {
        await agent.process(input);
      }

      const response = await agent.process(input);
      expect(response.decision_event).toBeUndefined();
    });

    it('should include payload_completeness in confidence', async () => {
      const input = {
        source: 'test',
        payload: { complete: 'data' },
      };

      const response = await agent.process(input);

      expect(response.decision_event?.confidence.payload_completeness).toBe(1.0);
    });

    it('should include connector_scope in constraints_applied', async () => {
      const input = {
        source: 'test',
        payload: { test: 'data' },
      };

      const response = await agent.process(input);

      expect(response.decision_event?.constraints_applied.connector_scope).toBe(
        'webhook-connector'
      );
    });
  });

  describe('Error Handling', () => {
    it('should validate response against AgentResponse schema', async () => {
      const input = {
        source: 'test',
        payload: { test: 'data' },
      };

      const response = await agent.process(input);

      const validationResult = AgentResponseSchema.safeParse(response);
      expect(validationResult.success).toBe(true);
    });

    it('should return non-retryable error for validation failures', async () => {
      const response = await agent.process({ source: 'test' });

      expect(response.error?.retryable).toBe(false);
    });

    it('should return retryable error for rate limiting', async () => {
      agent.resetRateLimits();
      const input = {
        source: 'limited',
        payload: { test: 'data' },
      };

      // Exceed rate limit
      for (let i = 0; i <= 100; i++) {
        await agent.process(input);
      }

      const response = await agent.process(input);
      expect(response.error?.retryable).toBe(true);
    });
  });

  describe('Telemetry', () => {
    it('should include telemetry in successful response', async () => {
      const input = {
        source: 'test',
        payload: { test: 'data' },
      };

      const response = await agent.process(input);

      expect(response.telemetry).toBeDefined();
      expect(response.telemetry?.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should track validation time', async () => {
      const input = {
        source: 'test',
        payload: { test: 'data' },
      };

      const response = await agent.process(input);

      expect(response.telemetry?.validation_time_ms).toBeDefined();
    });
  });

  describe('Agent Metadata', () => {
    it('should have correct agentId', () => {
      expect(agent.agentId).toBe('webhook-ingest-agent');
    });

    it('should have semantic version', () => {
      expect(agent.version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('should have correct decisionType', () => {
      expect(agent.decisionType).toBe('webhook_ingest_event');
    });
  });
});
