/**
 * Full Pipeline Integration Tests
 *
 * End-to-end integration tests for the complete agent pipeline:
 * Webhook Ingest → Normalizer → Persistence
 *
 * These tests verify:
 * - Data flows correctly between agents
 * - Each agent emits exactly ONE DecisionEvent
 * - No workflow execution or orchestration occurs
 * - Data transformations preserve integrity
 * - Error handling works across the pipeline
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DecisionEventSchema,
  type DecisionEvent,
  type AgentResponse,
} from '../../contracts/types';

// Mock implementations (would import from actual agent files in real implementation)
class WebhookIngestAgent {
  readonly agentId = 'webhook-ingest-agent';
  readonly version = '1.0.0';
  readonly decisionType = 'webhook_ingest_event' as const;

  async initialize() {}
  async shutdown() {}

  async process(input: unknown): Promise<AgentResponse> {
    const webhookInput = input as { source: string; payload: unknown };
    const crypto = require('crypto');

    const decisionEvent = {
      agent_id: this.agentId,
      agent_version: this.version,
      decision_type: this.decisionType,
      inputs_hash: crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex'),
      outputs: {
        source: webhookInput.source,
        received_at: new Date().toISOString(),
        payload: webhookInput.payload,
      },
      confidence: {
        score: 0.95,
        payload_completeness: 1.0,
        schema_validation: 'passed' as const,
      },
      constraints_applied: {
        connector_scope: 'webhook-connector',
      },
      execution_ref: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };

    return {
      status: 'success',
      decision_event: decisionEvent,
      telemetry: { duration_ms: 5, validation_time_ms: 1 },
    };
  }
}

class NormalizerAgent {
  readonly agentId = 'normalizer-agent';
  readonly version = '1.0.0';
  readonly decisionType = 'normalized_event' as const;

  async initialize() {}
  async shutdown() {}

  async process(input: unknown): Promise<AgentResponse> {
    const normInput = input as { source_format: string; data: unknown };
    const crypto = require('crypto');

    const decisionEvent = {
      agent_id: this.agentId,
      agent_version: this.version,
      decision_type: this.decisionType,
      inputs_hash: crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex'),
      outputs: {
        normalized_data: normInput.data,
        source_format: normInput.source_format,
        metadata: {
          original_field_count: 2,
          normalized_field_count: 2,
          transformations_applied: ['none'],
          normalized_at: new Date().toISOString(),
        },
      },
      confidence: {
        score: 1.0,
        normalization_certainty: 1.0,
        schema_validation: 'passed' as const,
      },
      constraints_applied: {
        connector_scope: 'normalizer-connector',
        schema_boundaries: [normInput.source_format, 'normalized'],
      },
      execution_ref: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };

    return {
      status: 'success',
      decision_event: decisionEvent,
      telemetry: { duration_ms: 3, validation_time_ms: 1 },
    };
  }
}

// Mock persistence service
class MockRuVectorService {
  public persistedEvents: DecisionEvent[] = [];

  async persist(event: DecisionEvent): Promise<void> {
    this.persistedEvents.push(event);
  }

  reset(): void {
    this.persistedEvents = [];
  }
}

describe('Full Pipeline Integration', () => {
  let webhookAgent: WebhookIngestAgent;
  let normalizerAgent: NormalizerAgent;
  let persistenceService: MockRuVectorService;

  beforeEach(async () => {
    webhookAgent = new WebhookIngestAgent();
    normalizerAgent = new NormalizerAgent();
    persistenceService = new MockRuVectorService();

    await webhookAgent.initialize();
    await normalizerAgent.initialize();
  });

  afterEach(async () => {
    await webhookAgent.shutdown();
    await normalizerAgent.shutdown();
    persistenceService.reset();
  });

  describe('Complete Pipeline Flow', () => {
    it('should process webhook → normalize → persist successfully', async () => {
      // Step 1: Webhook Ingestion
      const webhookInput = {
        source: 'github',
        payload: {
          event: 'push',
          repository: 'test-repo',
          commits: 3,
        },
      };

      const webhookResponse = await webhookAgent.process(webhookInput);

      expect(webhookResponse.status).toBe('success');
      expect(webhookResponse.decision_event).toBeDefined();
      expect(webhookResponse.decision_event?.decision_type).toBe('webhook_ingest_event');

      // Step 2: Normalization
      const normalizerInput = {
        source_format: 'json',
        data: webhookResponse.decision_event?.outputs,
      };

      const normalizerResponse = await normalizerAgent.process(normalizerInput);

      expect(normalizerResponse.status).toBe('success');
      expect(normalizerResponse.decision_event).toBeDefined();
      expect(normalizerResponse.decision_event?.decision_type).toBe('normalized_event');

      // Step 3: Persist both events
      await persistenceService.persist(webhookResponse.decision_event!);
      await persistenceService.persist(normalizerResponse.decision_event!);

      // Verify persistence
      expect(persistenceService.persistedEvents).toHaveLength(2);
      expect(persistenceService.persistedEvents[0].decision_type).toBe('webhook_ingest_event');
      expect(persistenceService.persistedEvents[1].decision_type).toBe('normalized_event');
    });

    it('should emit exactly TWO DecisionEvents (one per agent)', async () => {
      const webhookInput = {
        source: 'stripe',
        payload: { type: 'payment.succeeded' },
      };

      const webhookResponse = await webhookAgent.process(webhookInput);
      const normalizerInput = {
        source_format: 'json',
        data: webhookResponse.decision_event?.outputs,
      };
      const normalizerResponse = await normalizerAgent.process(normalizerInput);

      // Collect all decision events
      const allEvents = [webhookResponse.decision_event, normalizerResponse.decision_event].filter(
        (e) => e !== undefined
      );

      expect(allEvents).toHaveLength(2);
      expect(allEvents[0]?.decision_type).toBe('webhook_ingest_event');
      expect(allEvents[1]?.decision_type).toBe('normalized_event');
    });

    it('should preserve data integrity through the pipeline', async () => {
      const originalPayload = {
        user_id: 'user-123',
        action: 'login',
        timestamp: '2024-01-21T12:00:00Z',
      };

      const webhookInput = {
        source: 'auth-service',
        payload: originalPayload,
      };

      // Process through webhook agent
      const webhookResponse = await webhookAgent.process(webhookInput);
      const webhookOutputPayload = webhookResponse.decision_event?.outputs.payload;

      // Verify webhook preserved payload
      expect(webhookOutputPayload).toEqual(originalPayload);

      // Process through normalizer
      const normalizerInput = {
        source_format: 'json',
        data: webhookResponse.decision_event?.outputs,
      };

      const normalizerResponse = await normalizerAgent.process(normalizerInput);

      // Verify data is accessible in normalized output
      expect(normalizerResponse.decision_event?.outputs.normalized_data).toBeDefined();
    });
  });

  describe('DecisionEvent Schema Validation', () => {
    it('should emit valid DecisionEvents at each stage', async () => {
      const webhookInput = {
        source: 'test',
        payload: { test: 'data' },
      };

      // Webhook stage
      const webhookResponse = await webhookAgent.process(webhookInput);
      const webhookValidation = DecisionEventSchema.safeParse(webhookResponse.decision_event);
      expect(webhookValidation.success).toBe(true);

      // Normalizer stage
      const normalizerInput = {
        source_format: 'json',
        data: webhookResponse.decision_event?.outputs,
      };

      const normalizerResponse = await normalizerAgent.process(normalizerInput);
      const normalizerValidation = DecisionEventSchema.safeParse(normalizerResponse.decision_event);
      expect(normalizerValidation.success).toBe(true);
    });

    it('should generate unique execution_ref for each agent', async () => {
      const webhookInput = {
        source: 'test',
        payload: {},
      };

      const webhookResponse = await webhookAgent.process(webhookInput);
      const normalizerInput = {
        source_format: 'json',
        data: webhookResponse.decision_event?.outputs,
      };
      const normalizerResponse = await normalizerAgent.process(normalizerInput);

      const webhookRef = webhookResponse.decision_event?.execution_ref;
      const normalizerRef = normalizerResponse.decision_event?.execution_ref;

      expect(webhookRef).toBeDefined();
      expect(normalizerRef).toBeDefined();
      expect(webhookRef).not.toBe(normalizerRef);
    });

    it('should generate different inputs_hash for different stages', async () => {
      const webhookInput = {
        source: 'test',
        payload: { data: 'test' },
      };

      const webhookResponse = await webhookAgent.process(webhookInput);
      const normalizerInput = {
        source_format: 'json',
        data: webhookResponse.decision_event?.outputs,
      };
      const normalizerResponse = await normalizerAgent.process(normalizerInput);

      const webhookHash = webhookResponse.decision_event?.inputs_hash;
      const normalizerHash = normalizerResponse.decision_event?.inputs_hash;

      expect(webhookHash).toBeDefined();
      expect(normalizerHash).toBeDefined();
      expect(webhookHash).not.toBe(normalizerHash);
    });
  });

  describe('Error Propagation', () => {
    it('should stop pipeline on webhook validation failure', async () => {
      const invalidWebhookInput = null;

      const webhookResponse = await webhookAgent.process(invalidWebhookInput);

      expect(webhookResponse.status).not.toBe('success');
      expect(webhookResponse.decision_event).toBeUndefined();

      // Normalizer should not be called
      // In real implementation, pipeline would stop here
    });

    it('should handle normalizer validation failure independently', async () => {
      // First stage succeeds
      const webhookInput = {
        source: 'test',
        payload: { data: 'test' },
      };

      const webhookResponse = await webhookAgent.process(webhookInput);
      expect(webhookResponse.status).toBe('success');

      // Persist webhook event
      await persistenceService.persist(webhookResponse.decision_event!);

      // Second stage fails (invalid normalizer input)
      const invalidNormalizerInput = {
        source_format: 'unsupported-format',
        data: {},
      };

      const normalizerResponse = await normalizerAgent.process(invalidNormalizerInput);
      expect(normalizerResponse.status).not.toBe('success');

      // Only webhook event should be persisted
      expect(persistenceService.persistedEvents).toHaveLength(1);
      expect(persistenceService.persistedEvents[0].decision_type).toBe('webhook_ingest_event');
    });
  });

  describe('No Workflow Execution', () => {
    it('should not orchestrate or execute workflows', async () => {
      // Agents are passive - they only process inputs and emit events
      // No workflow engine, no orchestration, no decision-making

      const webhookInput = {
        source: 'test',
        payload: { action: 'trigger_workflow' }, // This should NOT trigger a workflow
      };

      const webhookResponse = await webhookAgent.process(webhookInput);

      // Agent only emits event, does not execute workflows
      expect(webhookResponse.decision_event).toBeDefined();
      expect(webhookResponse.decision_event?.outputs).not.toHaveProperty('workflow_executed');
      expect(webhookResponse.decision_event?.outputs).not.toHaveProperty('workflow_result');
    });

    it('should be pure ingestion and normalization agents', async () => {
      const webhookInput = {
        source: 'api',
        payload: { command: 'execute_action' },
      };

      const webhookResponse = await webhookAgent.process(webhookInput);

      // Agent ONLY ingests and normalizes - no execution
      expect(webhookResponse.decision_event?.decision_type).toBe('webhook_ingest_event');
      expect(webhookResponse.decision_event?.outputs.payload).toEqual({ command: 'execute_action' });

      // No command was executed, only ingested
      const normalizerInput = {
        source_format: 'json',
        data: webhookResponse.decision_event?.outputs,
      };

      const normalizerResponse = await normalizerAgent.process(normalizerInput);

      // Normalizer ONLY transforms - no execution
      expect(normalizerResponse.decision_event?.decision_type).toBe('normalized_event');
      expect(normalizerResponse.decision_event?.outputs.normalized_data).toBeDefined();
    });
  });

  describe('Telemetry Aggregation', () => {
    it('should collect telemetry from all pipeline stages', async () => {
      const webhookInput = {
        source: 'test',
        payload: {},
      };

      const webhookResponse = await webhookAgent.process(webhookInput);
      const normalizerInput = {
        source_format: 'json',
        data: webhookResponse.decision_event?.outputs,
      };
      const normalizerResponse = await normalizerAgent.process(normalizerInput);

      const telemetry = {
        webhook: webhookResponse.telemetry,
        normalizer: normalizerResponse.telemetry,
        total_duration:
          (webhookResponse.telemetry?.duration_ms || 0) +
          (normalizerResponse.telemetry?.duration_ms || 0),
      };

      expect(telemetry.webhook?.duration_ms).toBeGreaterThanOrEqual(0);
      expect(telemetry.normalizer?.duration_ms).toBeGreaterThanOrEqual(0);
      expect(telemetry.total_duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Idempotency', () => {
    it('should generate same inputs_hash for identical inputs', async () => {
      const input = {
        source: 'test',
        payload: { id: 123 },
      };

      const response1 = await webhookAgent.process(input);
      const response2 = await webhookAgent.process(input);

      expect(response1.decision_event?.inputs_hash).toBe(response2.decision_event?.inputs_hash);
    });

    it('should generate different execution_ref for repeated calls', async () => {
      const input = {
        source: 'test',
        payload: { id: 123 },
      };

      const response1 = await webhookAgent.process(input);
      const response2 = await webhookAgent.process(input);

      expect(response1.decision_event?.execution_ref).not.toBe(
        response2.decision_event?.execution_ref
      );
    });
  });

  describe('Multi-Source Pipeline', () => {
    it('should handle multiple webhook sources in parallel', async () => {
      const sources = ['github', 'stripe', 'slack', 'custom'];
      const responses = await Promise.all(
        sources.map((source) =>
          webhookAgent.process({
            source,
            payload: { source_specific: 'data' },
          })
        )
      );

      expect(responses).toHaveLength(4);
      responses.forEach((response, index) => {
        expect(response.status).toBe('success');
        expect(response.decision_event?.outputs.source).toBe(sources[index]);
      });
    });

    it('should process and normalize data from different formats', async () => {
      const formats = ['json', 'xml', 'csv', 'custom'];
      const responses = await Promise.all(
        formats.map((format) =>
          normalizerAgent.process({
            source_format: format,
            data: { test: 'data' },
          })
        )
      );

      expect(responses).toHaveLength(4);
      responses.forEach((response, index) => {
        expect(response.status).toBe('success');
        expect(response.decision_event?.outputs.source_format).toBe(formats[index]);
      });
    });
  });

  describe('Persistence Verification', () => {
    it('should persist all successful DecisionEvents', async () => {
      const inputs = [
        { source: 'source1', payload: { id: 1 } },
        { source: 'source2', payload: { id: 2 } },
        { source: 'source3', payload: { id: 3 } },
      ];

      for (const input of inputs) {
        const response = await webhookAgent.process(input);
        if (response.decision_event) {
          await persistenceService.persist(response.decision_event);
        }
      }

      expect(persistenceService.persistedEvents).toHaveLength(3);
      persistenceService.persistedEvents.forEach((event, index) => {
        expect(event.decision_type).toBe('webhook_ingest_event');
        expect(event.outputs.source).toBe(`source${index + 1}`);
      });
    });

    it('should not persist failed operations', async () => {
      const validInput = { source: 'valid', payload: {} };
      const invalidInput = null;

      const validResponse = await webhookAgent.process(validInput);
      const invalidResponse = await webhookAgent.process(invalidInput);

      if (validResponse.decision_event) {
        await persistenceService.persist(validResponse.decision_event);
      }

      // Invalid response has no decision_event to persist
      expect(invalidResponse.decision_event).toBeUndefined();

      // Only valid event persisted
      expect(persistenceService.persistedEvents).toHaveLength(1);
    });
  });
});
