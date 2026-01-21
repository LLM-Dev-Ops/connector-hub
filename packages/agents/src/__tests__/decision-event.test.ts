/**
 * DecisionEvent Schema Tests
 *
 * These tests validate the DecisionEvent schema and helper functions
 * from the contracts/types.ts module.
 */

import { describe, it, expect } from 'vitest';
import {
  DecisionEventSchema,
  ConfidenceSchema,
  ConstraintsAppliedSchema,
  DecisionTypeSchema,
  computeInputsHash,
  generateExecutionRef,
  getCurrentTimestamp,
  createDecisionEvent,
  type DecisionEvent,
  type Confidence,
  type ConstraintsApplied,
} from '../contracts/types';

describe('DecisionEvent Schema', () => {
  describe('Valid DecisionEvent Creation', () => {
    it('should validate a complete DecisionEvent', () => {
      const validEvent: DecisionEvent = {
        agent_id: 'webhook-ingest-agent-001',
        agent_version: '1.0.0',
        decision_type: 'webhook_ingest_event',
        inputs_hash: 'a'.repeat(64), // Valid SHA-256 hash
        outputs: {
          payload: { data: 'test' },
          normalized: true,
        },
        confidence: {
          score: 0.95,
          schema_validation: 'passed',
        },
        constraints_applied: {
          connector_scope: 'webhook-connector',
          rate_limit_applied: false,
        },
        execution_ref: '550e8400-e29b-41d4-a716-446655440000', // Valid UUID
        timestamp: '2024-01-21T12:00:00.000Z',
      };

      const result = DecisionEventSchema.safeParse(validEvent);
      expect(result.success).toBe(true);
    });

    it('should validate DecisionEvent with all optional fields', () => {
      const validEvent: DecisionEvent = {
        agent_id: 'test-agent',
        agent_version: '1.2.3',
        decision_type: 'normalized_event',
        inputs_hash: 'b'.repeat(64),
        outputs: { result: 'success' },
        confidence: {
          score: 0.85,
          auth_assurance: 'high',
          payload_completeness: 1.0,
          normalization_certainty: 0.9,
          schema_validation: 'passed',
        },
        constraints_applied: {
          connector_scope: 'test-scope',
          identity_context: 'user-123',
          schema_boundaries: ['schema-1', 'schema-2'],
          rate_limit_applied: true,
          size_limit_bytes: 1048576,
          timeout_ms: 30000,
        },
        execution_ref: '123e4567-e89b-12d3-a456-426614174000',
        timestamp: '2024-01-21T12:00:00.000Z',
        metadata: {
          custom_field: 'value',
          nested: { data: 123 },
        },
      };

      const result = DecisionEventSchema.safeParse(validEvent);
      expect(result.success).toBe(true);
    });
  });

  describe('Required Field Validation', () => {
    const baseEvent = {
      agent_id: 'test-agent',
      agent_version: '1.0.0',
      decision_type: 'webhook_ingest_event' as const,
      inputs_hash: 'a'.repeat(64),
      outputs: { test: true },
      confidence: { score: 0.9 },
      constraints_applied: { connector_scope: 'test' },
      execution_ref: '550e8400-e29b-41d4-a716-446655440000',
      timestamp: '2024-01-21T12:00:00.000Z',
    };

    it('should reject DecisionEvent without agent_id', () => {
      const { agent_id, ...invalidEvent } = baseEvent;
      const result = DecisionEventSchema.safeParse(invalidEvent);
      expect(result.success).toBe(false);
    });

    it('should reject DecisionEvent with empty agent_id', () => {
      const invalidEvent = { ...baseEvent, agent_id: '' };
      const result = DecisionEventSchema.safeParse(invalidEvent);
      expect(result.success).toBe(false);
    });

    it('should reject DecisionEvent without agent_version', () => {
      const { agent_version, ...invalidEvent } = baseEvent;
      const result = DecisionEventSchema.safeParse(invalidEvent);
      expect(result.success).toBe(false);
    });

    it('should reject DecisionEvent without decision_type', () => {
      const { decision_type, ...invalidEvent } = baseEvent;
      const result = DecisionEventSchema.safeParse(invalidEvent);
      expect(result.success).toBe(false);
    });

    it('should reject DecisionEvent without inputs_hash', () => {
      const { inputs_hash, ...invalidEvent } = baseEvent;
      const result = DecisionEventSchema.safeParse(invalidEvent);
      expect(result.success).toBe(false);
    });

    it('should reject DecisionEvent without outputs', () => {
      const { outputs, ...invalidEvent } = baseEvent;
      const result = DecisionEventSchema.safeParse(invalidEvent);
      expect(result.success).toBe(false);
    });

    it('should reject DecisionEvent without confidence', () => {
      const { confidence, ...invalidEvent } = baseEvent;
      const result = DecisionEventSchema.safeParse(invalidEvent);
      expect(result.success).toBe(false);
    });

    it('should reject DecisionEvent without constraints_applied', () => {
      const { constraints_applied, ...invalidEvent } = baseEvent;
      const result = DecisionEventSchema.safeParse(invalidEvent);
      expect(result.success).toBe(false);
    });

    it('should reject DecisionEvent without execution_ref', () => {
      const { execution_ref, ...invalidEvent } = baseEvent;
      const result = DecisionEventSchema.safeParse(invalidEvent);
      expect(result.success).toBe(false);
    });

    it('should reject DecisionEvent without timestamp', () => {
      const { timestamp, ...invalidEvent } = baseEvent;
      const result = DecisionEventSchema.safeParse(invalidEvent);
      expect(result.success).toBe(false);
    });
  });

  describe('Confidence Score Bounds', () => {
    it('should accept confidence score of 0.0', () => {
      const confidence: Confidence = { score: 0.0 };
      const result = ConfidenceSchema.safeParse(confidence);
      expect(result.success).toBe(true);
    });

    it('should accept confidence score of 1.0', () => {
      const confidence: Confidence = { score: 1.0 };
      const result = ConfidenceSchema.safeParse(confidence);
      expect(result.success).toBe(true);
    });

    it('should accept confidence score of 0.5', () => {
      const confidence: Confidence = { score: 0.5 };
      const result = ConfidenceSchema.safeParse(confidence);
      expect(result.success).toBe(true);
    });

    it('should reject confidence score below 0', () => {
      const confidence = { score: -0.1 };
      const result = ConfidenceSchema.safeParse(confidence);
      expect(result.success).toBe(false);
    });

    it('should reject confidence score above 1', () => {
      const confidence = { score: 1.1 };
      const result = ConfidenceSchema.safeParse(confidence);
      expect(result.success).toBe(false);
    });

    it('should validate payload_completeness bounds (0-1)', () => {
      expect(ConfidenceSchema.safeParse({ score: 0.9, payload_completeness: 0.0 }).success).toBe(true);
      expect(ConfidenceSchema.safeParse({ score: 0.9, payload_completeness: 1.0 }).success).toBe(true);
      expect(ConfidenceSchema.safeParse({ score: 0.9, payload_completeness: -0.1 }).success).toBe(false);
      expect(ConfidenceSchema.safeParse({ score: 0.9, payload_completeness: 1.1 }).success).toBe(false);
    });

    it('should validate normalization_certainty bounds (0-1)', () => {
      expect(ConfidenceSchema.safeParse({ score: 0.9, normalization_certainty: 0.0 }).success).toBe(true);
      expect(ConfidenceSchema.safeParse({ score: 0.9, normalization_certainty: 1.0 }).success).toBe(true);
      expect(ConfidenceSchema.safeParse({ score: 0.9, normalization_certainty: -0.1 }).success).toBe(false);
      expect(ConfidenceSchema.safeParse({ score: 0.9, normalization_certainty: 1.1 }).success).toBe(false);
    });
  });

  describe('Timestamp Format Validation', () => {
    it('should accept valid ISO 8601 timestamp', () => {
      const timestamps = [
        '2024-01-21T12:00:00.000Z',
        '2024-01-21T12:00:00Z',
        '2024-01-21T12:00:00.123Z',
        '2024-12-31T23:59:59.999Z',
      ];

      timestamps.forEach((timestamp) => {
        const event = {
          agent_id: 'test',
          agent_version: '1.0.0',
          decision_type: 'webhook_ingest_event' as const,
          inputs_hash: 'a'.repeat(64),
          outputs: {},
          confidence: { score: 0.9 },
          constraints_applied: { connector_scope: 'test' },
          execution_ref: '550e8400-e29b-41d4-a716-446655440000',
          timestamp,
        };
        const result = DecisionEventSchema.safeParse(event);
        expect(result.success).toBe(true);
      });
    });

    it('should reject invalid timestamp formats', () => {
      const invalidTimestamps = [
        '2024-01-21',
        '2024-01-21 12:00:00',
        'invalid-timestamp',
        '1642766400000', // Unix timestamp
      ];

      invalidTimestamps.forEach((timestamp) => {
        const event = {
          agent_id: 'test',
          agent_version: '1.0.0',
          decision_type: 'webhook_ingest_event' as const,
          inputs_hash: 'a'.repeat(64),
          outputs: {},
          confidence: { score: 0.9 },
          constraints_applied: { connector_scope: 'test' },
          execution_ref: '550e8400-e29b-41d4-a716-446655440000',
          timestamp,
        };
        const result = DecisionEventSchema.safeParse(event);
        expect(result.success).toBe(false);
      });
    });
  });

  describe('Inputs Hash Generation', () => {
    it('should generate consistent SHA-256 hash for same input', () => {
      const input = { key: 'value', number: 123 };
      const hash1 = computeInputsHash(input);
      const hash2 = computeInputsHash(input);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate different hashes for different inputs', () => {
      const input1 = { key: 'value1' };
      const input2 = { key: 'value2' };

      const hash1 = computeInputsHash(input1);
      const hash2 = computeInputsHash(input2);

      expect(hash1).not.toBe(hash2);
    });

    it('should generate same hash regardless of key order', () => {
      const input1 = { a: 1, b: 2, c: 3 };
      const input2 = { c: 3, a: 1, b: 2 };

      const hash1 = computeInputsHash(input1);
      const hash2 = computeInputsHash(input2);

      expect(hash1).toBe(hash2);
    });

    it('should accept inputs_hash of exactly 64 characters', () => {
      const validHash = 'a'.repeat(64);
      const event = {
        agent_id: 'test',
        agent_version: '1.0.0',
        decision_type: 'webhook_ingest_event' as const,
        inputs_hash: validHash,
        outputs: {},
        confidence: { score: 0.9 },
        constraints_applied: { connector_scope: 'test' },
        execution_ref: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: '2024-01-21T12:00:00.000Z',
      };

      const result = DecisionEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it('should reject inputs_hash with wrong length', () => {
      const invalidHashes = ['a'.repeat(63), 'a'.repeat(65), 'short'];

      invalidHashes.forEach((inputs_hash) => {
        const event = {
          agent_id: 'test',
          agent_version: '1.0.0',
          decision_type: 'webhook_ingest_event' as const,
          inputs_hash,
          outputs: {},
          confidence: { score: 0.9 },
          constraints_applied: { connector_scope: 'test' },
          execution_ref: '550e8400-e29b-41d4-a716-446655440000',
          timestamp: '2024-01-21T12:00:00.000Z',
        };

        const result = DecisionEventSchema.safeParse(event);
        expect(result.success).toBe(false);
      });
    });
  });

  describe('Decision Type Validation', () => {
    it('should accept all valid decision types', () => {
      const validTypes = [
        'webhook_ingest_event',
        'erp_surface_event',
        'database_query_result',
        'normalized_event',
        'auth_identity_verification',
      ] as const;

      validTypes.forEach((decision_type) => {
        const result = DecisionTypeSchema.safeParse(decision_type);
        expect(result.success).toBe(true);
      });
    });

    it('should reject invalid decision types', () => {
      const invalidTypes = ['invalid_type', 'random_event', ''];

      invalidTypes.forEach((decision_type) => {
        const result = DecisionTypeSchema.safeParse(decision_type);
        expect(result.success).toBe(false);
      });
    });
  });

  describe('Helper Functions', () => {
    it('should generate valid execution reference UUID', () => {
      const ref = generateExecutionRef();
      expect(ref).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('should generate unique execution references', () => {
      const ref1 = generateExecutionRef();
      const ref2 = generateExecutionRef();
      expect(ref1).not.toBe(ref2);
    });

    it('should generate valid ISO 8601 timestamp', () => {
      const timestamp = getCurrentTimestamp();
      expect(() => new Date(timestamp)).not.toThrow();
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should create valid DecisionEvent using helper', () => {
      const event = createDecisionEvent({
        agentId: 'test-agent',
        agentVersion: '1.0.0',
        decisionType: 'webhook_ingest_event',
        input: { test: 'data' },
        outputs: { result: 'success' },
        confidence: { score: 0.95 },
        constraintsApplied: { connector_scope: 'test-scope' },
      });

      const result = DecisionEventSchema.safeParse(event);
      expect(result.success).toBe(true);
      expect(event.agent_id).toBe('test-agent');
      expect(event.agent_version).toBe('1.0.0');
      expect(event.decision_type).toBe('webhook_ingest_event');
      expect(event.inputs_hash).toHaveLength(64);
      expect(event.execution_ref).toMatch(/^[0-9a-f-]{36}$/i);
      expect(event.timestamp).toBeTruthy();
    });

    it('should create DecisionEvent with metadata', () => {
      const event = createDecisionEvent({
        agentId: 'test-agent',
        agentVersion: '1.0.0',
        decisionType: 'normalized_event',
        input: { data: 123 },
        outputs: { normalized: true },
        confidence: { score: 0.85 },
        constraintsApplied: { connector_scope: 'normalizer' },
        metadata: { custom: 'value' },
      });

      expect(event.metadata).toEqual({ custom: 'value' });
    });
  });

  describe('Constraints Applied Validation', () => {
    it('should require connector_scope', () => {
      const valid: ConstraintsApplied = { connector_scope: 'test-scope' };
      expect(ConstraintsAppliedSchema.safeParse(valid).success).toBe(true);

      const invalid = { identity_context: 'user' };
      expect(ConstraintsAppliedSchema.safeParse(invalid).success).toBe(false);
    });

    it('should accept all optional constraint fields', () => {
      const constraints: ConstraintsApplied = {
        connector_scope: 'full-scope',
        identity_context: 'user-123',
        schema_boundaries: ['boundary-1', 'boundary-2'],
        rate_limit_applied: true,
        size_limit_bytes: 5242880,
        timeout_ms: 60000,
      };

      const result = ConstraintsAppliedSchema.safeParse(constraints);
      expect(result.success).toBe(true);
    });
  });

  describe('Agent Version Validation', () => {
    it('should accept valid semantic versions', () => {
      const validVersions = [
        '1.0.0',
        '0.1.0',
        '10.20.30',
        '1.0.0-alpha',
        '1.0.0-alpha.1',
        '1.0.0-beta.2',
        '2.3.4-rc.1',
      ];

      validVersions.forEach((agent_version) => {
        const event = {
          agent_id: 'test',
          agent_version,
          decision_type: 'webhook_ingest_event' as const,
          inputs_hash: 'a'.repeat(64),
          outputs: {},
          confidence: { score: 0.9 },
          constraints_applied: { connector_scope: 'test' },
          execution_ref: '550e8400-e29b-41d4-a716-446655440000',
          timestamp: '2024-01-21T12:00:00.000Z',
        };

        const result = DecisionEventSchema.safeParse(event);
        expect(result.success).toBe(true);
      });
    });

    it('should reject invalid version formats', () => {
      const invalidVersions = ['1.0', 'v1.0.0', '1', 'latest', '1.0.0.0'];

      invalidVersions.forEach((agent_version) => {
        const event = {
          agent_id: 'test',
          agent_version,
          decision_type: 'webhook_ingest_event' as const,
          inputs_hash: 'a'.repeat(64),
          outputs: {},
          confidence: { score: 0.9 },
          constraints_applied: { connector_scope: 'test' },
          execution_ref: '550e8400-e29b-41d4-a716-446655440000',
          timestamp: '2024-01-21T12:00:00.000Z',
        };

        const result = DecisionEventSchema.safeParse(event);
        expect(result.success).toBe(false);
      });
    });
  });
});
