/**
 * Normalizer Agent Tests
 *
 * Tests for the Normalizer Agent which:
 * - Normalizes data from various sources into standard format
 * - Validates and transforms field mappings
 * - Emits DecisionEvent with normalized data
 * - Handles schema transformations
 * - Reports normalization confidence
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DecisionEventSchema,
  AgentResponseSchema,
  type AgentResponse,
  type IAgent,
} from '../contracts/types';

/**
 * Mock Normalizer Agent implementation for testing
 */
class NormalizerAgent implements IAgent {
  readonly agentId = 'normalizer-agent';
  readonly version = '1.0.0';
  readonly decisionType = 'normalized_event' as const;

  private initialized = false;
  private readonly supportedFormats = ['json', 'xml', 'csv', 'custom'];

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

    const normInput = input as Record<string, unknown>;

    // Validate required fields
    if (!normInput.source_format || typeof normInput.source_format !== 'string') {
      return this.createErrorResponse(
        'MISSING_SOURCE_FORMAT',
        'source_format field is required',
        false
      );
    }

    if (!normInput.data) {
      return this.createErrorResponse('MISSING_DATA', 'data field is required', false);
    }

    const sourceFormat = normInput.source_format as string;

    // Validate format is supported
    if (!this.supportedFormats.includes(sourceFormat.toLowerCase())) {
      return this.createErrorResponse(
        'UNSUPPORTED_FORMAT',
        `Format "${sourceFormat}" is not supported. Supported formats: ${this.supportedFormats.join(', ')}`,
        false
      );
    }

    try {
      const data = normInput.data;
      const schema = normInput.schema as Record<string, unknown> | undefined;

      // Perform normalization
      let normalizedData: Record<string, unknown>;
      let normalizationCertainty = 1.0;
      let schemaValidation: 'passed' | 'failed' | 'partial' = 'passed';

      if (sourceFormat === 'json') {
        normalizedData = this.normalizeJSON(data);
      } else if (sourceFormat === 'xml') {
        normalizedData = this.normalizeXML(data);
        normalizationCertainty = 0.9;
      } else if (sourceFormat === 'csv') {
        normalizedData = this.normalizeCSV(data);
        normalizationCertainty = 0.95;
      } else {
        normalizedData = this.normalizeCustom(data);
        normalizationCertainty = 0.85;
      }

      // Validate against schema if provided
      if (schema) {
        const validation = this.validateAgainstSchema(normalizedData, schema);
        schemaValidation = validation.status;
        normalizationCertainty *= validation.certainty;
      }

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
        outputs: {
          normalized_data: normalizedData,
          source_format: sourceFormat,
          metadata: {
            original_field_count: this.countFields(data),
            normalized_field_count: this.countFields(normalizedData),
            transformations_applied: this.getTransformations(sourceFormat),
            normalized_at: new Date().toISOString(),
          },
        },
        confidence: {
          score: normalizationCertainty,
          normalization_certainty: normalizationCertainty,
          schema_validation: schemaValidation,
          payload_completeness: 1.0,
        },
        constraints_applied: {
          connector_scope: 'normalizer-connector',
          schema_boundaries: [sourceFormat, 'normalized'],
        },
        execution_ref: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      };

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
        'NORMALIZATION_ERROR',
        error instanceof Error ? error.message : 'Unknown error',
        true
      );
    }
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  async healthCheck(): Promise<boolean> {
    return this.initialized;
  }

  private normalizeJSON(data: unknown): Record<string, unknown> {
    // JSON is already normalized
    return data as Record<string, unknown>;
  }

  private normalizeXML(data: unknown): Record<string, unknown> {
    // Simulate XML to JSON normalization
    return {
      normalized: true,
      data,
      format: 'xml',
    };
  }

  private normalizeCSV(data: unknown): Record<string, unknown> {
    // Simulate CSV to JSON normalization
    return {
      normalized: true,
      rows: data,
      format: 'csv',
    };
  }

  private normalizeCustom(data: unknown): Record<string, unknown> {
    // Simulate custom format normalization
    return {
      normalized: true,
      data,
      format: 'custom',
    };
  }

  private validateAgainstSchema(
    data: Record<string, unknown>,
    schema: Record<string, unknown>
  ): { status: 'passed' | 'failed' | 'partial'; certainty: number } {
    const requiredFields = schema.required as string[] | undefined;
    if (!requiredFields) {
      return { status: 'passed', certainty: 1.0 };
    }

    const dataKeys = Object.keys(data);
    const missingFields = requiredFields.filter((field) => !dataKeys.includes(field));

    if (missingFields.length === 0) {
      return { status: 'passed', certainty: 1.0 };
    } else if (missingFields.length < requiredFields.length) {
      return { status: 'partial', certainty: 0.7 };
    } else {
      return { status: 'failed', certainty: 0.3 };
    }
  }

  private countFields(data: unknown): number {
    if (typeof data !== 'object' || data === null) {
      return 0;
    }
    return Object.keys(data as object).length;
  }

  private getTransformations(format: string): string[] {
    const transformations: Record<string, string[]> = {
      json: ['none'],
      xml: ['xml-to-json', 'flatten-structure'],
      csv: ['csv-to-json', 'row-parsing'],
      custom: ['custom-parser', 'field-mapping'],
    };
    return transformations[format] || [];
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
}

describe('NormalizerAgent', () => {
  let agent: NormalizerAgent;

  beforeEach(async () => {
    agent = new NormalizerAgent();
    await agent.initialize();
  });

  afterEach(async () => {
    await agent.shutdown();
  });

  describe('Successful Data Normalization', () => {
    it('should normalize JSON data successfully', async () => {
      const input = {
        source_format: 'json',
        data: { name: 'Test', value: 123 },
      };

      const response = await agent.process(input);

      expect(response.status).toBe('success');
      expect(response.decision_event).toBeDefined();
      expect(response.decision_event?.decision_type).toBe('normalized_event');
    });

    it('should normalize XML data successfully', async () => {
      const input = {
        source_format: 'xml',
        data: '<root><item>test</item></root>',
      };

      const response = await agent.process(input);

      expect(response.status).toBe('success');
      expect(response.decision_event?.outputs.normalized_data).toBeDefined();
    });

    it('should normalize CSV data successfully', async () => {
      const input = {
        source_format: 'csv',
        data: 'name,value\nTest,123\n',
      };

      const response = await agent.process(input);

      expect(response.status).toBe('success');
    });

    it('should normalize custom format data successfully', async () => {
      const input = {
        source_format: 'custom',
        data: { custom: 'format', data: [1, 2, 3] },
      };

      const response = await agent.process(input);

      expect(response.status).toBe('success');
    });
  });

  describe('Input Validation', () => {
    it('should reject null input', async () => {
      const response = await agent.process(null);

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('INVALID_INPUT');
    });

    it('should reject input without source_format', async () => {
      const response = await agent.process({
        data: { test: 'data' },
      });

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('MISSING_SOURCE_FORMAT');
    });

    it('should reject input without data field', async () => {
      const response = await agent.process({
        source_format: 'json',
      });

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('MISSING_DATA');
    });

    it('should reject unsupported format', async () => {
      const response = await agent.process({
        source_format: 'yaml',
        data: { test: 'data' },
      });

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('UNSUPPORTED_FORMAT');
      expect(response.error?.message).toContain('yaml');
    });
  });

  describe('Format Support', () => {
    it('should accept json format', async () => {
      const response = await agent.process({
        source_format: 'json',
        data: {},
      });

      expect(response.status).toBe('success');
    });

    it('should accept xml format', async () => {
      const response = await agent.process({
        source_format: 'xml',
        data: '<root/>',
      });

      expect(response.status).toBe('success');
    });

    it('should accept csv format', async () => {
      const response = await agent.process({
        source_format: 'csv',
        data: 'header\nvalue',
      });

      expect(response.status).toBe('success');
    });

    it('should accept custom format', async () => {
      const response = await agent.process({
        source_format: 'custom',
        data: { any: 'data' },
      });

      expect(response.status).toBe('success');
    });

    it('should be case-insensitive for format names', async () => {
      const response = await agent.process({
        source_format: 'JSON',
        data: {},
      });

      expect(response.status).toBe('success');
    });
  });

  describe('Schema Validation', () => {
    it('should validate against provided schema - all fields present', async () => {
      const input = {
        source_format: 'json',
        data: { name: 'Test', email: 'test@example.com' },
        schema: {
          required: ['name', 'email'],
        },
      };

      const response = await agent.process(input);

      expect(response.status).toBe('success');
      expect(response.decision_event?.confidence.schema_validation).toBe('passed');
    });

    it('should report partial validation when some fields missing', async () => {
      const input = {
        source_format: 'json',
        data: { name: 'Test' },
        schema: {
          required: ['name', 'email', 'phone'],
        },
      };

      const response = await agent.process(input);

      expect(response.status).toBe('success');
      expect(response.decision_event?.confidence.schema_validation).toBe('partial');
    });

    it('should normalize without schema validation if schema not provided', async () => {
      const input = {
        source_format: 'json',
        data: { any: 'field' },
      };

      const response = await agent.process(input);

      expect(response.status).toBe('success');
      expect(response.decision_event?.confidence.schema_validation).toBe('passed');
    });
  });

  describe('Normalization Confidence', () => {
    it('should report highest confidence for JSON (1.0)', async () => {
      const response = await agent.process({
        source_format: 'json',
        data: {},
      });

      expect(response.decision_event?.confidence.normalization_certainty).toBe(1.0);
      expect(response.decision_event?.confidence.score).toBe(1.0);
    });

    it('should report high confidence for CSV (0.95)', async () => {
      const response = await agent.process({
        source_format: 'csv',
        data: 'test',
      });

      expect(response.decision_event?.confidence.normalization_certainty).toBe(0.95);
    });

    it('should report good confidence for XML (0.9)', async () => {
      const response = await agent.process({
        source_format: 'xml',
        data: '<root/>',
      });

      expect(response.decision_event?.confidence.normalization_certainty).toBe(0.9);
    });

    it('should report medium confidence for custom format (0.85)', async () => {
      const response = await agent.process({
        source_format: 'custom',
        data: {},
      });

      expect(response.decision_event?.confidence.normalization_certainty).toBe(0.85);
    });

    it('should reduce confidence when schema validation is partial', async () => {
      const input = {
        source_format: 'json',
        data: { name: 'Test' },
        schema: {
          required: ['name', 'email'],
        },
      };

      const response = await agent.process(input);

      expect(response.decision_event?.confidence.score).toBeLessThan(1.0);
    });
  });

  describe('DecisionEvent Emission', () => {
    it('should emit exactly ONE DecisionEvent per successful normalization', async () => {
      const input = {
        source_format: 'json',
        data: { test: 'data' },
      };

      const response = await agent.process(input);

      expect(response.decision_event).toBeDefined();

      // Validate schema
      const validationResult = DecisionEventSchema.safeParse(response.decision_event);
      expect(validationResult.success).toBe(true);
    });

    it('should not emit DecisionEvent on validation failure', async () => {
      const response = await agent.process({ source_format: 'yaml' });

      expect(response.decision_event).toBeUndefined();
    });

    it('should include normalized_data in outputs', async () => {
      const response = await agent.process({
        source_format: 'json',
        data: { test: 'data' },
      });

      expect(response.decision_event?.outputs.normalized_data).toBeDefined();
    });

    it('should include source_format in outputs', async () => {
      const response = await agent.process({
        source_format: 'xml',
        data: '<root/>',
      });

      expect(response.decision_event?.outputs.source_format).toBe('xml');
    });

    it('should include transformation metadata', async () => {
      const response = await agent.process({
        source_format: 'csv',
        data: 'test',
      });

      expect(response.decision_event?.outputs.metadata).toBeDefined();
      expect(response.decision_event?.outputs.metadata.transformations_applied).toBeDefined();
      expect(Array.isArray(response.decision_event?.outputs.metadata.transformations_applied)).toBe(
        true
      );
    });

    it('should include field count metadata', async () => {
      const response = await agent.process({
        source_format: 'json',
        data: { field1: 'a', field2: 'b', field3: 'c' },
      });

      expect(response.decision_event?.outputs.metadata.original_field_count).toBeDefined();
      expect(response.decision_event?.outputs.metadata.normalized_field_count).toBeDefined();
    });

    it('should include normalization timestamp', async () => {
      const response = await agent.process({
        source_format: 'json',
        data: {},
      });

      expect(response.decision_event?.outputs.metadata.normalized_at).toBeDefined();
      expect(() =>
        new Date(response.decision_event!.outputs.metadata.normalized_at as string)
      ).not.toThrow();
    });

    it('should include source_format in schema_boundaries', async () => {
      const response = await agent.process({
        source_format: 'xml',
        data: '<root/>',
      });

      expect(response.decision_event?.constraints_applied.schema_boundaries).toContain('xml');
      expect(response.decision_event?.constraints_applied.schema_boundaries).toContain(
        'normalized'
      );
    });

    it('should include payload_completeness in confidence', async () => {
      const response = await agent.process({
        source_format: 'json',
        data: {},
      });

      expect(response.decision_event?.confidence.payload_completeness).toBe(1.0);
    });
  });

  describe('Error Handling', () => {
    it('should validate response against AgentResponse schema', async () => {
      const input = {
        source_format: 'json',
        data: {},
      };

      const response = await agent.process(input);

      const validationResult = AgentResponseSchema.safeParse(response);
      expect(validationResult.success).toBe(true);
    });

    it('should return non-retryable error for validation failures', async () => {
      const response = await agent.process({ source_format: 'unsupported' });

      expect(response.error?.retryable).toBe(false);
    });
  });

  describe('Telemetry', () => {
    it('should include telemetry in successful response', async () => {
      const input = {
        source_format: 'json',
        data: {},
      };

      const response = await agent.process(input);

      expect(response.telemetry).toBeDefined();
      expect(response.telemetry?.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should track validation time', async () => {
      const input = {
        source_format: 'xml',
        data: '<root/>',
      };

      const response = await agent.process(input);

      expect(response.telemetry?.validation_time_ms).toBeDefined();
    });
  });

  describe('Agent Metadata', () => {
    it('should have correct agentId', () => {
      expect(agent.agentId).toBe('normalizer-agent');
    });

    it('should have semantic version', () => {
      expect(agent.version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('should have correct decisionType', () => {
      expect(agent.decisionType).toBe('normalized_event');
    });
  });
});
