/**
 * SchemaEnforcementAgent - Phase 6 Core Infrastructure (Layer 1)
 *
 * SCHEMA TRUTH SOURCE
 *
 * This agent is the authoritative source for schema validation.
 * It is DETERMINISTIC - same inputs always produce same outputs.
 *
 * ARCHITECTURAL RULES:
 * - MUST be deterministic
 * - MUST emit exactly ONE DecisionEvent per invocation (schema_violation_signal)
 * - MUST persist via ruvector-service ONLY
 * - MUST respect performance budgets (MAX_TOKENS=800, MAX_LATENCY_MS=1500)
 *
 * @packageDocumentation
 */

import { createHash } from 'crypto';
import { z } from 'zod';
import {
  SchemaEnforcementInput,
  SchemaEnforcementInputSchema,
  SchemaEnforcementOutput,
  SchemaEnforcementOutputSchema,
  SchemaViolation,
  SchemaType,
  PERFORMANCE_BUDGETS,
} from '@llm-dev-ops/connector-hub-contracts';
import { getRuvectorClient } from '../../infrastructure/ruvector-client.js';

// ============================================================================
// Schema Registry
// ============================================================================

/**
 * Schema registry with versioned schemas
 * All schemas are deterministic and immutable
 */
interface RegisteredSchema {
  type: SchemaType;
  schema: z.ZodType;
  hash: string;
}

const SCHEMA_REGISTRY: Record<string, Record<string, RegisteredSchema>> = {
  'decision-event': {
    '1.0.0': {
      type: 'zod',
      schema: z.object({
        agent_id: z.string().min(1),
        agent_version: z.string().regex(/^\d+\.\d+\.\d+$/),
        decision_type: z.string(),
        inputs_hash: z.string().length(64),
        outputs: z.record(z.unknown()),
        confidence: z.object({
          score: z.number().min(0).max(1),
        }),
        constraints_applied: z.object({
          connector_scope: z.string(),
        }),
        execution_ref: z.string().min(1),
        timestamp: z.string().datetime(),
      }),
      hash: 'a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd',
    },
  },
  'webhook-payload': {
    '1.0.0': {
      type: 'zod',
      schema: z.object({
        event_type: z.string().min(1),
        payload: z.record(z.unknown()),
        timestamp: z.string().datetime(),
        source: z.string().min(1),
        signature: z.string().optional(),
      }),
      hash: 'b2c3d4e5f67890123456789012345678901234567890123456789012345bcd1',
    },
  },
  'llm-request': {
    '1.0.0': {
      type: 'zod',
      schema: z.object({
        model: z.string().min(1),
        messages: z.array(z.object({
          role: z.enum(['system', 'user', 'assistant']),
          content: z.string(),
        })),
        max_tokens: z.number().optional(),
        temperature: z.number().min(0).max(2).optional(),
        stream: z.boolean().optional(),
      }),
      hash: 'c3d4e5f678901234567890123456789012345678901234567890123456cde2',
    },
  },
  'llm-response': {
    '1.0.0': {
      type: 'zod',
      schema: z.object({
        id: z.string().min(1),
        model: z.string().min(1),
        choices: z.array(z.object({
          index: z.number(),
          message: z.object({
            role: z.string(),
            content: z.string(),
          }),
          finish_reason: z.string().optional(),
        })),
        usage: z.object({
          prompt_tokens: z.number(),
          completion_tokens: z.number(),
          total_tokens: z.number(),
        }).optional(),
      }),
      hash: 'd4e5f6789012345678901234567890123456789012345678901234567def3',
    },
  },
  'erp-event': {
    '1.0.0': {
      type: 'zod',
      schema: z.object({
        event_id: z.string().min(1),
        event_type: z.string().min(1),
        entity_type: z.string().min(1),
        entity_id: z.string().min(1),
        data: z.record(z.unknown()),
        occurred_at: z.string().datetime(),
        source_system: z.string().min(1),
      }),
      hash: 'e5f67890123456789012345678901234567890123456789012345678ef04',
    },
  },
};

// ============================================================================
// Agent Context
// ============================================================================

export interface SchemaEnforcementContext {
  traceId: string;
  spanId?: string;
  correlationId?: string;
}

// ============================================================================
// SchemaEnforcementAgent
// ============================================================================

export class SchemaEnforcementAgent {
  public readonly agentId = 'schema-enforcement-agent';
  public readonly version = '1.0.0';
  public readonly decisionType = 'schema_violation_signal' as const;

  private readonly ruvector = getRuvectorClient();

  /**
   * Process schema enforcement request
   *
   * DETERMINISTIC: Same input always produces same output
   */
  async process(
    input: unknown,
    context: SchemaEnforcementContext
  ): Promise<{
    event: SchemaEnforcementDecisionEvent;
    output: SchemaEnforcementOutput;
    durationMs: number;
  }> {
    const startTime = Date.now();
    let fieldsValidated = 0;
    let depthReached = 0;

    // Validate input
    const validatedInput = SchemaEnforcementInputSchema.parse(input);

    // Perform deterministic validation
    const result = this.validatePayload(validatedInput, (fields, depth) => {
      fieldsValidated = fields;
      depthReached = depth;
    });

    const durationMs = Date.now() - startTime;

    // Check performance budget
    if (durationMs > PERFORMANCE_BUDGETS.MAX_LATENCY_MS) {
      console.warn(
        `[${this.agentId}] Performance budget exceeded: ${durationMs}ms > ${PERFORMANCE_BUDGETS.MAX_LATENCY_MS}ms`
      );
    }

    // Get schema info
    const schemaInfo = this.getSchemaInfo(validatedInput.schema_id, validatedInput.schema_version);

    // Create output
    const output: SchemaEnforcementOutput = {
      valid: result.valid,
      violations: result.violations,
      coerced_payload: result.coercedPayload,
      schema_applied: {
        id: validatedInput.schema_id,
        version: validatedInput.schema_version,
        type: validatedInput.schema_type,
        hash: schemaInfo?.hash || this.computePayloadHash({}),
      },
      stats: {
        fields_validated: fieldsValidated,
        depth_reached: depthReached,
        duration_ms: durationMs,
      },
      token_count: this.estimateTokenCount(validatedInput, result),
    };

    // Validate output against schema
    SchemaEnforcementOutputSchema.parse(output);

    // Create DecisionEvent
    const event = this.createDecisionEvent(validatedInput, output, context, durationMs);

    // Persist to Ruvector (async, non-blocking)
    this.persistValidationResult(validatedInput, output, event).catch(err => {
      console.error(`[${this.agentId}] Failed to persist to Ruvector:`, err);
    });

    return { event, output, durationMs };
  }

  /**
   * Validate payload against schema
   * DETERMINISTIC: No side effects, pure function
   */
  private validatePayload(
    input: SchemaEnforcementInput,
    onStats?: (fields: number, depth: number) => void
  ): {
    valid: boolean;
    violations: SchemaViolation[];
    coercedPayload?: unknown;
  } {
    const violations: SchemaViolation[] = [];

    // Get registered schema
    const schemaEntry = SCHEMA_REGISTRY[input.schema_id]?.[input.schema_version];
    if (!schemaEntry) {
      violations.push({
        path: '',
        message: `Schema not found: ${input.schema_id}@${input.schema_version}`,
        code: 'SCHEMA_NOT_FOUND',
      });
      onStats?.(0, 0);
      return { valid: false, violations };
    }

    // Track validation stats
    const stats = { fields: 0, maxDepth: 0 };
    this.countFieldsAndDepth(input.payload, stats, 0, input.max_depth);
    onStats?.(stats.fields, stats.maxDepth);

    // Perform validation based on mode
    if (input.mode === 'coerce') {
      const result = schemaEntry.schema.safeParse(input.payload);
      if (result.success) {
        return { valid: true, violations: [], coercedPayload: result.data };
      }
      // Fall through to collect violations
    }

    // Validate with strict or lenient mode
    const result = schemaEntry.schema.safeParse(input.payload);

    if (result.success) {
      return { valid: true, violations: [] };
    }

    // Convert Zod errors to violations
    for (const error of result.error.errors) {
      // Extract expected/actual types when available (for invalid_type errors)
      let expectedType: string | undefined;
      let actualType: string | undefined;
      if (error.code === 'invalid_type') {
        const typedError = error as z.ZodInvalidTypeIssue;
        expectedType = typedError.expected;
        actualType = typedError.received;
      }

      violations.push({
        path: error.path.join('.'),
        message: error.message,
        code: this.zodErrorToCode(error.code),
        expected_type: expectedType,
        actual_type: actualType,
        constraint: this.getConstraintDescription(error),
      });
    }

    // In lenient mode, partial validation is ok
    if (input.mode === 'lenient') {
      const criticalViolations = violations.filter(v =>
        v.code === 'INVALID_TYPE' || v.code === 'REQUIRED_FIELD_MISSING'
      );
      return {
        valid: criticalViolations.length === 0,
        violations,
      };
    }

    return { valid: false, violations };
  }

  /**
   * Count fields and depth in payload
   */
  private countFieldsAndDepth(
    obj: unknown,
    stats: { fields: number; maxDepth: number },
    currentDepth: number,
    maxDepth: number
  ): void {
    if (currentDepth > maxDepth) return;

    stats.maxDepth = Math.max(stats.maxDepth, currentDepth);

    if (obj === null || obj === undefined) return;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        this.countFieldsAndDepth(item, stats, currentDepth + 1, maxDepth);
      }
    } else if (typeof obj === 'object') {
      const keys = Object.keys(obj as object);
      stats.fields += keys.length;
      for (const key of keys) {
        this.countFieldsAndDepth((obj as Record<string, unknown>)[key], stats, currentDepth + 1, maxDepth);
      }
    }
  }

  /**
   * Get schema info from registry
   */
  private getSchemaInfo(schemaId: string, version: string): RegisteredSchema | null {
    return SCHEMA_REGISTRY[schemaId]?.[version] || null;
  }

  /**
   * Convert Zod error code to our code format
   */
  private zodErrorToCode(code: string): string {
    const mapping: Record<string, string> = {
      invalid_type: 'INVALID_TYPE',
      invalid_literal: 'INVALID_LITERAL',
      unrecognized_keys: 'UNRECOGNIZED_KEYS',
      invalid_union: 'INVALID_UNION',
      invalid_enum_value: 'INVALID_ENUM_VALUE',
      invalid_string: 'INVALID_STRING',
      too_small: 'VALUE_TOO_SMALL',
      too_big: 'VALUE_TOO_BIG',
      custom: 'CUSTOM_ERROR',
      invalid_date: 'INVALID_DATE',
      invalid_arguments: 'INVALID_ARGUMENTS',
      invalid_return_type: 'INVALID_RETURN_TYPE',
      invalid_intersection_types: 'INVALID_INTERSECTION',
      not_multiple_of: 'NOT_MULTIPLE_OF',
      not_finite: 'NOT_FINITE',
    };
    return mapping[code] || 'SCHEMA_VIOLATION';
  }

  /**
   * Get constraint description from Zod error
   */
  private getConstraintDescription(error: z.ZodIssue): string | undefined {
    if (error.code === 'too_small') {
      const e = error as z.ZodTooSmallIssue;
      return `minimum ${e.type}: ${e.minimum}`;
    }
    if (error.code === 'too_big') {
      const e = error as z.ZodTooBigIssue;
      return `maximum ${e.type}: ${e.maximum}`;
    }
    if (error.code === 'invalid_string') {
      const e = error as z.ZodInvalidStringIssue;
      return `string validation: ${e.validation}`;
    }
    return undefined;
  }

  /**
   * Compute deterministic hash of payload
   */
  private computePayloadHash(payload: unknown): string {
    const normalized = JSON.stringify(payload, (_, v) =>
      typeof v === 'object' && v !== null && !Array.isArray(v)
        ? Object.keys(v).sort().reduce((r, k) => ({ ...r, [k]: v[k] }), {})
        : v
    );
    return createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Estimate token count for budget tracking
   */
  private estimateTokenCount(
    input: SchemaEnforcementInput,
    result: { violations: SchemaViolation[] }
  ): number {
    const inputSize = JSON.stringify(input).length;
    const outputSize = JSON.stringify(result).length;
    return Math.ceil((inputSize + outputSize) / 4);
  }

  /**
   * Create DecisionEvent for this validation
   */
  private createDecisionEvent(
    input: SchemaEnforcementInput,
    output: SchemaEnforcementOutput,
    context: SchemaEnforcementContext,
    durationMs: number
  ): SchemaEnforcementDecisionEvent {
    return {
      agent_id: this.agentId,
      agent_version: this.version,
      decision_type: this.decisionType,
      inputs_hash: this.computePayloadHash(input),
      outputs: output as unknown as Record<string, unknown>,
      confidence: {
        score: output.valid ? 1.0 : Math.max(0, 1 - (output.violations.length * 0.1)),
        schema_validation: output.valid ? 'passed' : 'failed',
      },
      constraints_applied: {
        connector_scope: 'schema-enforcement',
        schema_boundaries: [input.schema_id, input.schema_version],
        timeout_ms: PERFORMANCE_BUDGETS.MAX_LATENCY_MS,
      },
      execution_ref: context.traceId,
      timestamp: new Date().toISOString(),
      metadata: {
        duration_ms: durationMs,
        token_count: output.token_count,
        correlation_id: context.correlationId,
        violations_count: output.violations.length,
        mode: input.mode,
      },
    };
  }

  /**
   * Persist validation result to Ruvector
   */
  private async persistValidationResult(
    input: SchemaEnforcementInput,
    output: SchemaEnforcementOutput,
    event: SchemaEnforcementDecisionEvent
  ): Promise<void> {
    const payloadHash = this.computePayloadHash(input.payload);
    const documentId = `schema-enforcement:${input.schema_id}:${payloadHash.substring(0, 16)}`;

    await this.ruvector.store(
      'schema-enforcement',
      documentId,
      {
        schema_id: input.schema_id,
        schema_version: input.schema_version,
        valid: output.valid,
        violations_count: output.violations.length,
        mode: input.mode,
        event_ref: event.execution_ref,
        timestamp: event.timestamp,
      },
      1800 // 30 minutes TTL
    );
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    const ruvectorHealth = await this.ruvector.healthCheck();
    return ruvectorHealth.healthy;
  }

  /**
   * List available schemas
   */
  listSchemas(): Array<{ id: string; versions: string[] }> {
    return Object.entries(SCHEMA_REGISTRY).map(([id, versions]) => ({
      id,
      versions: Object.keys(versions),
    }));
  }
}

// ============================================================================
// Decision Event Type
// ============================================================================

export interface SchemaEnforcementDecisionEvent {
  agent_id: string;
  agent_version: string;
  decision_type: 'schema_violation_signal';
  inputs_hash: string;
  outputs: Record<string, unknown>;
  confidence: {
    score: number;
    schema_validation: 'passed' | 'failed' | 'partial';
  };
  constraints_applied: {
    connector_scope: string;
    schema_boundaries: string[];
    timeout_ms: number;
  };
  execution_ref: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Export singleton factory
// ============================================================================

let agentInstance: SchemaEnforcementAgent | null = null;

export function getSchemaEnforcementAgent(): SchemaEnforcementAgent {
  if (!agentInstance) {
    agentInstance = new SchemaEnforcementAgent();
  }
  return agentInstance;
}
