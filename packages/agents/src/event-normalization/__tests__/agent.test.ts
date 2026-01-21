/**
 * Event Normalization Agent - Agent Tests
 *
 * Tests for the main EventNormalizationAgent class.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventNormalizationAgent, createEventNormalizationAgent } from '../agent.js';
import type { RuVectorClient } from '../../runtime/ruvector-client.js';
import type { TelemetryEmitter, Span, SpanContext } from '../../runtime/telemetry.js';
import type { AgentContext } from '../../runtime/edge-function-base.js';

// Mock RuVectorClient
const createMockRuVectorClient = (): RuVectorClient => ({
  persist: vi.fn().mockResolvedValue({ success: true, id: 'test-id' }),
  query: vi.fn().mockResolvedValue({ success: true, data: [] }),
  batchPersist: vi.fn().mockResolvedValue({ success: true, results: [], failedCount: 0, successCount: 0 }),
  delete: vi.fn().mockResolvedValue({ success: true }),
} as unknown as RuVectorClient);

// Mock TelemetryEmitter
const createMockTelemetry = (): TelemetryEmitter => ({
  startSpan: vi.fn().mockReturnValue({
    name: 'test-span',
    startTime: Date.now(),
    context: { traceId: 'trace-123', spanId: 'span-123' },
    attributes: {},
    events: [],
    status: { code: 'UNSET' },
  } as Span),
  endSpan: vi.fn().mockResolvedValue(undefined),
  addSpanEvent: vi.fn(),
  emitMetric: vi.fn().mockResolvedValue(undefined),
  recordError: vi.fn(),
  extractContext: vi.fn(),
  injectContext: vi.fn(),
} as unknown as TelemetryEmitter);

const createMockContext = (): AgentContext => ({
  requestId: 'req-123',
  headers: {},
  environment: 'test',
});

describe('EventNormalizationAgent', () => {
  let agent: EventNormalizationAgent;
  let mockRuVectorClient: RuVectorClient;
  let mockTelemetry: TelemetryEmitter;

  beforeEach(() => {
    mockRuVectorClient = createMockRuVectorClient();
    mockTelemetry = createMockTelemetry();
    agent = createEventNormalizationAgent(mockRuVectorClient, mockTelemetry);
  });

  describe('execute', () => {
    it('should normalize OpenAI request successfully', async () => {
      const input = {
        event: {
          format: 'openai_api' as const,
          raw_payload: {
            model: 'gpt-4',
            messages: [{ role: 'user', content: 'Hello' }],
          },
          received_at: new Date().toISOString(),
        },
      };

      const result = await agent.execute(input, createMockContext());

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.normalized_event.type).toBe('llm.request');
      expect(result.data?.normalized_event.source.format).toBe('openai_api');
      expect(result.decisionEvent).toBeDefined();
      expect(result.decisionEvent.agentId).toBe('event-normalization-agent');
    });

    it('should normalize webhook event successfully', async () => {
      const input = {
        event: {
          format: 'webhook_github' as const,
          raw_payload: {
            action: 'opened',
            repository: {
              id: 123,
              name: 'test-repo',
              full_name: 'owner/test-repo',
              owner: { login: 'owner', id: 1 },
            },
            sender: { login: 'user', id: 2 },
          },
          headers: {
            'x-github-event': 'push',
          },
          received_at: new Date().toISOString(),
        },
      };

      const result = await agent.execute(input, createMockContext());

      expect(result.success).toBe(true);
      expect(result.data?.normalized_event.type).toBe('webhook.validated');
      expect(result.data?.normalized_event.source.format).toBe('webhook_github');
    });

    it('should include metrics in output', async () => {
      const input = {
        event: {
          format: 'openai_api' as const,
          raw_payload: {
            model: 'gpt-4',
            messages: [{ role: 'user', content: 'Hello' }],
          },
          received_at: new Date().toISOString(),
        },
      };

      const result = await agent.execute(input, createMockContext());

      expect(result.success).toBe(true);
      expect(result.data?.metrics).toBeDefined();
      expect(result.data?.metrics.processing_time_ms).toBeGreaterThanOrEqual(0);
      expect(result.data?.metrics.field_mappings_applied).toBeGreaterThan(0);
    });

    it('should persist normalized event to ruvector-service', async () => {
      const input = {
        event: {
          format: 'openai_api' as const,
          raw_payload: {
            model: 'gpt-4',
            messages: [{ role: 'user', content: 'Hello' }],
          },
          received_at: new Date().toISOString(),
        },
      };

      await agent.execute(input, createMockContext());

      expect(mockRuVectorClient.persist).toHaveBeenCalledWith(
        'normalized_events',
        expect.objectContaining({
          event_type: 'llm.request',
          source_format: 'openai_api',
        })
      );
    });

    it('should emit DecisionEvent with correct event type', async () => {
      const input = {
        event: {
          format: 'openai_api' as const,
          raw_payload: {
            model: 'gpt-4',
            messages: [{ role: 'user', content: 'Hello' }],
          },
          received_at: new Date().toISOString(),
        },
      };

      const result = await agent.execute(input, createMockContext());

      expect(result.decisionEvent.eventType).toBe('normalized_event');
    });

    it('should handle validation errors gracefully', async () => {
      const input = {
        event: {
          format: 'invalid_format' as any,
          raw_payload: {},
          received_at: new Date().toISOString(),
        },
      };

      const result = await agent.execute(input, createMockContext());

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.decisionEvent.eventType).toBe('normalization_error');
    });

    it('should emit telemetry spans', async () => {
      const input = {
        event: {
          format: 'openai_api' as const,
          raw_payload: {
            model: 'gpt-4',
            messages: [{ role: 'user', content: 'Hello' }],
          },
          received_at: new Date().toISOString(),
        },
      };

      await agent.execute(input, createMockContext());

      expect(mockTelemetry.startSpan).toHaveBeenCalled();
      expect(mockTelemetry.addSpanEvent).toHaveBeenCalled();
      expect(mockTelemetry.endSpan).toHaveBeenCalled();
    });

    it('should respect custom normalization config', async () => {
      const input = {
        event: {
          format: 'openai_api' as const,
          raw_payload: {
            model: 'gpt-4',
            messages: [{ role: 'user', content: 'Hello' }],
            custom_field: 'value',
          },
          received_at: new Date().toISOString(),
        },
        config: {
          strict_validation: false,
          max_payload_bytes: 10 * 1024 * 1024,
          include_dropped_fields: false,
          include_field_mappings: false,
        },
      };

      const result = await agent.execute(input, createMockContext());

      expect(result.success).toBe(true);
      // With include_dropped_fields: false, dropped_fields should be undefined
      expect(result.data?.normalized_event.normalization.dropped_fields).toBeUndefined();
    });
  });

  describe('DecisionEvent compliance', () => {
    it('should emit exactly one DecisionEvent per invocation', async () => {
      const input = {
        event: {
          format: 'openai_api' as const,
          raw_payload: {
            model: 'gpt-4',
            messages: [{ role: 'user', content: 'Hello' }],
          },
          received_at: new Date().toISOString(),
        },
      };

      const result = await agent.execute(input, createMockContext());

      expect(result.decisionEvent).toBeDefined();
      expect(result.decisionEvent.agentId).toBe('event-normalization-agent');
      expect(result.decisionEvent.agentVersion).toBe('1.0.0');
      expect(result.decisionEvent.timestamp).toBeDefined();
      expect(result.decisionEvent.traceId).toBeDefined();
    });

    it('should include trace ID from context', async () => {
      const context: AgentContext = {
        requestId: 'req-123',
        headers: {},
        environment: 'test',
        traceContext: {
          traceId: 'custom-trace-id',
          spanId: 'custom-span-id',
        },
      };

      const input = {
        event: {
          format: 'openai_api' as const,
          raw_payload: {
            model: 'gpt-4',
            messages: [{ role: 'user', content: 'Hello' }],
          },
          received_at: new Date().toISOString(),
        },
      };

      const result = await agent.execute(input, context);

      expect(result.decisionEvent.traceId).toBe('custom-trace-id');
    });

    it('should emit DecisionEvent even on failure', async () => {
      const input = {
        event: {
          format: 'invalid' as any,
          raw_payload: {},
          received_at: new Date().toISOString(),
        },
      };

      const result = await agent.execute(input, createMockContext());

      expect(result.success).toBe(false);
      expect(result.decisionEvent).toBeDefined();
      expect(result.decisionEvent.metadata.success).toBe(false);
    });
  });

  describe('Architectural constraints', () => {
    it('should persist via ruvector-service only', async () => {
      const input = {
        event: {
          format: 'openai_api' as const,
          raw_payload: {
            model: 'gpt-4',
            messages: [{ role: 'user', content: 'Hello' }],
          },
          received_at: new Date().toISOString(),
        },
      };

      await agent.execute(input, createMockContext());

      // Verify persist was called (via ruvector-service, not direct SQL)
      expect(mockRuVectorClient.persist).toHaveBeenCalled();
    });

    it('should be deterministic (same input produces same output structure)', async () => {
      const input = {
        event: {
          format: 'openai_api' as const,
          raw_payload: {
            model: 'gpt-4',
            messages: [{ role: 'user', content: 'Hello' }],
          },
          received_at: '2024-01-01T00:00:00.000Z',
        },
      };

      const result1 = await agent.execute(input, createMockContext());
      const result2 = await agent.execute(input, createMockContext());

      // Same structure and data (excluding timestamps and IDs)
      expect(result1.data?.normalized_event.type).toBe(result2.data?.normalized_event.type);
      expect(result1.data?.normalized_event.source).toEqual(result2.data?.normalized_event.source);
      expect(result1.data?.normalized_event.data).toEqual(result2.data?.normalized_event.data);
    });

    it('should not modify internal execution behavior', async () => {
      // This test verifies the agent only normalizes and doesn't do anything else
      const input = {
        event: {
          format: 'openai_api' as const,
          raw_payload: {
            model: 'gpt-4',
            messages: [{ role: 'user', content: 'Execute workflow X' }],
          },
          received_at: new Date().toISOString(),
        },
      };

      const result = await agent.execute(input, createMockContext());

      // Agent should just normalize, not interpret or execute the message content
      expect(result.success).toBe(true);
      expect(result.data?.normalized_event.type).toBe('llm.request');
      // No workflow execution or internal behavior modification
    });
  });
});

describe('createEventNormalizationAgent factory', () => {
  it('should create agent with provided dependencies', () => {
    const mockRuVectorClient = createMockRuVectorClient();
    const mockTelemetry = createMockTelemetry();

    const agent = createEventNormalizationAgent(mockRuVectorClient, mockTelemetry);

    expect(agent).toBeInstanceOf(EventNormalizationAgent);
  });
});
