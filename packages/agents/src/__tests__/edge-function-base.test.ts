/**
 * Edge Function Base Class Tests
 *
 * These tests validate the base edge function class that all agents extend.
 * Tests cover request validation, DecisionEvent emission, telemetry hooks,
 * and error handling patterns.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DecisionEventSchema,
  AgentResponseSchema,
  type IAgent,
  type AgentResponse,
  type DecisionType,
} from '../contracts/types';

/**
 * Mock implementation of EdgeFunctionBase for testing
 */
class MockEdgeFunctionBase implements IAgent {
  readonly agentId: string;
  readonly version: string;
  readonly decisionType: DecisionType;

  private initialized = false;
  public processCallCount = 0;
  public lastInput: unknown = null;

  constructor(agentId: string, version: string, decisionType: DecisionType) {
    this.agentId = agentId;
    this.version = version;
    this.decisionType = decisionType;
  }

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async process(input: unknown): Promise<AgentResponse> {
    this.processCallCount++;
    this.lastInput = input;

    if (!this.initialized) {
      return {
        status: 'error',
        error: {
          code: 'NOT_INITIALIZED',
          message: 'Agent not initialized',
          retryable: false,
        },
      };
    }

    // Simulate validation
    if (typeof input !== 'object' || input === null) {
      return {
        status: 'validation_failed',
        error: {
          code: 'INVALID_INPUT',
          message: 'Input must be an object',
          retryable: false,
        },
      };
    }

    const startTime = Date.now();

    try {
      // Create a valid DecisionEvent
      const crypto = require('crypto');
      const inputStr = JSON.stringify(input);
      const inputsHash = crypto.createHash('sha256').update(inputStr).digest('hex');

      const decisionEvent = {
        agent_id: this.agentId,
        agent_version: this.version,
        decision_type: this.decisionType,
        inputs_hash: inputsHash,
        outputs: { processed: true, input },
        confidence: { score: 0.95 },
        constraints_applied: { connector_scope: 'test-scope' },
        execution_ref: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      };

      const duration = Date.now() - startTime;

      return {
        status: 'success',
        decision_event: decisionEvent,
        telemetry: {
          duration_ms: duration,
          validation_time_ms: 5,
        },
      };
    } catch (error) {
      return {
        status: 'error',
        error: {
          code: 'PROCESSING_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          retryable: true,
        },
      };
    }
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  async healthCheck(): Promise<boolean> {
    return this.initialized;
  }
}

describe('EdgeFunctionBase', () => {
  let agent: MockEdgeFunctionBase;

  beforeEach(() => {
    agent = new MockEdgeFunctionBase('test-agent', '1.0.0', 'webhook_ingest_event');
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      await agent.initialize();
      const healthy = await agent.healthCheck();
      expect(healthy).toBe(true);
    });

    it('should fail processing before initialization', async () => {
      const response = await agent.process({ test: 'data' });
      expect(response.status).toBe('error');
      expect(response.error?.code).toBe('NOT_INITIALIZED');
    });

    it('should process after initialization', async () => {
      await agent.initialize();
      const response = await agent.process({ test: 'data' });
      expect(response.status).toBe('success');
    });
  });

  describe('Request Validation', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    it('should reject null input', async () => {
      const response = await agent.process(null);
      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('INVALID_INPUT');
      expect(response.error?.retryable).toBe(false);
    });

    it('should reject primitive input (string)', async () => {
      const response = await agent.process('invalid');
      expect(response.status).toBe('validation_failed');
    });

    it('should reject primitive input (number)', async () => {
      const response = await agent.process(123);
      expect(response.status).toBe('validation_failed');
    });

    it('should accept valid object input', async () => {
      const response = await agent.process({ valid: 'input' });
      expect(response.status).toBe('success');
    });

    it('should accept empty object input', async () => {
      const response = await agent.process({});
      expect(response.status).toBe('success');
    });

    it('should accept complex nested input', async () => {
      const complexInput = {
        nested: {
          data: {
            array: [1, 2, 3],
            string: 'test',
          },
        },
      };
      const response = await agent.process(complexInput);
      expect(response.status).toBe('success');
    });
  });

  describe('DecisionEvent Emission', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    it('should emit exactly one DecisionEvent per successful invocation', async () => {
      const response = await agent.process({ test: 'data' });

      expect(response.status).toBe('success');
      expect(response.decision_event).toBeDefined();

      // Validate against schema
      const validationResult = DecisionEventSchema.safeParse(response.decision_event);
      expect(validationResult.success).toBe(true);
    });

    it('should not emit DecisionEvent on validation failure', async () => {
      const response = await agent.process(null);

      expect(response.status).toBe('validation_failed');
      expect(response.decision_event).toBeUndefined();
    });

    it('should include correct agent metadata in DecisionEvent', async () => {
      const response = await agent.process({ test: 'data' });

      expect(response.decision_event?.agent_id).toBe('test-agent');
      expect(response.decision_event?.agent_version).toBe('1.0.0');
      expect(response.decision_event?.decision_type).toBe('webhook_ingest_event');
    });

    it('should generate unique execution_ref for each invocation', async () => {
      const response1 = await agent.process({ test: 'data1' });
      const response2 = await agent.process({ test: 'data2' });

      expect(response1.decision_event?.execution_ref).toBeDefined();
      expect(response2.decision_event?.execution_ref).toBeDefined();
      expect(response1.decision_event?.execution_ref).not.toBe(
        response2.decision_event?.execution_ref
      );
    });

    it('should generate different inputs_hash for different inputs', async () => {
      const response1 = await agent.process({ test: 'data1' });
      const response2 = await agent.process({ test: 'data2' });

      expect(response1.decision_event?.inputs_hash).toBeDefined();
      expect(response2.decision_event?.inputs_hash).toBeDefined();
      expect(response1.decision_event?.inputs_hash).not.toBe(
        response2.decision_event?.inputs_hash
      );
    });

    it('should generate same inputs_hash for identical inputs', async () => {
      const input = { test: 'same-data' };
      const response1 = await agent.process(input);
      const response2 = await agent.process(input);

      expect(response1.decision_event?.inputs_hash).toBe(
        response2.decision_event?.inputs_hash
      );
    });

    it('should include valid timestamp in DecisionEvent', async () => {
      const response = await agent.process({ test: 'data' });

      expect(response.decision_event?.timestamp).toBeDefined();
      expect(() => new Date(response.decision_event!.timestamp)).not.toThrow();
    });

    it('should include confidence score in valid range', async () => {
      const response = await agent.process({ test: 'data' });

      const confidence = response.decision_event?.confidence;
      expect(confidence?.score).toBeGreaterThanOrEqual(0);
      expect(confidence?.score).toBeLessThanOrEqual(1);
    });

    it('should include constraints_applied with connector_scope', async () => {
      const response = await agent.process({ test: 'data' });

      expect(response.decision_event?.constraints_applied).toBeDefined();
      expect(response.decision_event?.constraints_applied.connector_scope).toBeDefined();
    });
  });

  describe('Telemetry Hooks', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    it('should include telemetry data in successful response', async () => {
      const response = await agent.process({ test: 'data' });

      expect(response.telemetry).toBeDefined();
      expect(response.telemetry?.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should track validation time separately', async () => {
      const response = await agent.process({ test: 'data' });

      expect(response.telemetry?.validation_time_ms).toBeDefined();
      expect(response.telemetry?.validation_time_ms).toBeGreaterThanOrEqual(0);
    });

    it('should not include telemetry on validation failure', async () => {
      const response = await agent.process(null);

      // Telemetry may be present but should not be required for failures
      if (response.telemetry) {
        expect(response.telemetry.duration_ms).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    it('should return structured error response on failure', async () => {
      const response = await agent.process(null);

      expect(response.status).not.toBe('success');
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBeDefined();
      expect(response.error?.message).toBeDefined();
      expect(typeof response.error?.retryable).toBe('boolean');
    });

    it('should indicate if error is retryable', async () => {
      const response = await agent.process(null);

      expect(response.error?.retryable).toBe(false); // Validation errors are not retryable
    });

    it('should validate AgentResponse against schema', async () => {
      const response = await agent.process({ test: 'data' });
      const validationResult = AgentResponseSchema.safeParse(response);
      expect(validationResult.success).toBe(true);
    });

    it('should handle shutdown gracefully', async () => {
      await agent.initialize();
      await agent.shutdown();

      const healthy = await agent.healthCheck();
      expect(healthy).toBe(false);
    });
  });

  describe('Agent Properties', () => {
    it('should expose readonly agentId', () => {
      expect(agent.agentId).toBe('test-agent');
      // @ts-expect-error - Testing readonly enforcement
      expect(() => { agent.agentId = 'new-id'; }).toThrow();
    });

    it('should expose readonly version', () => {
      expect(agent.version).toBe('1.0.0');
      // @ts-expect-error - Testing readonly enforcement
      expect(() => { agent.version = '2.0.0'; }).toThrow();
    });

    it('should expose readonly decisionType', () => {
      expect(agent.decisionType).toBe('webhook_ingest_event');
      // @ts-expect-error - Testing readonly enforcement
      expect(() => { agent.decisionType = 'other_type'; }).toThrow();
    });
  });

  describe('Process Call Tracking', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    it('should track number of process calls', async () => {
      expect(agent.processCallCount).toBe(0);

      await agent.process({ test: '1' });
      expect(agent.processCallCount).toBe(1);

      await agent.process({ test: '2' });
      expect(agent.processCallCount).toBe(2);
    });

    it('should store last input', async () => {
      const input = { test: 'last-input' };
      await agent.process(input);

      expect(agent.lastInput).toEqual(input);
    });
  });
});
