/**
 * ConfigValidationAgent - Phase 6 Core Infrastructure (Layer 1)
 *
 * CONFIGURATION TRUTH SOURCE
 *
 * This agent is the authoritative source for configuration validation.
 * It is DETERMINISTIC - same inputs always produce same outputs.
 *
 * ARCHITECTURAL RULES:
 * - MUST be deterministic
 * - MUST emit exactly ONE DecisionEvent per invocation (config_validation_signal)
 * - MUST persist via ruvector-service ONLY
 * - MUST respect performance budgets (MAX_TOKENS=800, MAX_LATENCY_MS=1500)
 *
 * @packageDocumentation
 */

import { createHash } from 'crypto';
import { z } from 'zod';
import {
  ConfigValidationInput,
  ConfigValidationInputSchema,
  ConfigValidationOutput,
  ConfigValidationOutputSchema,
  ConfigValidationIssue,
  ConfigSeverity,
  PERFORMANCE_BUDGETS,
} from '@llm-dev-ops/connector-hub-contracts';
import { getRuvectorClient } from '../../infrastructure/ruvector-client.js';

// ============================================================================
// Configuration Schemas Registry
// ============================================================================

/**
 * Known configuration schemas for validation
 * Each schema is versioned and deterministic
 */
const CONFIG_SCHEMAS: Record<string, Record<string, z.ZodType>> = {
  'providers.openai': {
    '1.0.0': z.object({
      api_key_env: z.string().min(1),
      model: z.string().default('gpt-4'),
      max_tokens: z.number().min(1).max(128000).default(4096),
      temperature: z.number().min(0).max(2).default(0.7),
      timeout_ms: z.number().min(1000).max(300000).default(30000),
      base_url: z.string().url().optional(),
    }),
  },
  'providers.anthropic': {
    '1.0.0': z.object({
      api_key_env: z.string().min(1),
      model: z.string().default('claude-3-opus-20240229'),
      max_tokens: z.number().min(1).max(200000).default(4096),
      temperature: z.number().min(0).max(1).default(0.7),
      timeout_ms: z.number().min(1000).max(300000).default(30000),
    }),
  },
  'middleware.cache': {
    '1.0.0': z.object({
      enabled: z.boolean().default(true),
      ttl_seconds: z.number().min(1).max(86400).default(3600),
      max_size_mb: z.number().min(1).max(1024).default(256),
      strategy: z.enum(['lru', 'lfu', 'fifo']).default('lru'),
    }),
  },
  'middleware.retry': {
    '1.0.0': z.object({
      enabled: z.boolean().default(true),
      max_attempts: z.number().min(1).max(10).default(3),
      base_delay_ms: z.number().min(100).max(10000).default(1000),
      max_delay_ms: z.number().min(1000).max(60000).default(30000),
      exponential: z.boolean().default(true),
    }),
  },
  'ruvector': {
    '1.0.0': z.object({
      service_url: z.string().url(),
      timeout_ms: z.number().min(100).max(30000).default(5000),
      retry_attempts: z.number().min(0).max(5).default(3),
    }),
  },
  'telemetry': {
    '1.0.0': z.object({
      enabled: z.boolean().default(true),
      endpoint: z.string().url(),
      batch_size: z.number().min(1).max(1000).default(100),
      flush_interval_ms: z.number().min(1000).max(60000).default(10000),
    }),
  },
};

// ============================================================================
// Agent Context
// ============================================================================

export interface ConfigValidationContext {
  traceId: string;
  spanId?: string;
  correlationId?: string;
}

// ============================================================================
// ConfigValidationAgent
// ============================================================================

export class ConfigValidationAgent {
  public readonly agentId = 'config-validation-agent';
  public readonly version = '1.0.0';
  public readonly decisionType = 'config_validation_signal' as const;

  private readonly ruvector = getRuvectorClient();

  /**
   * Process configuration validation request
   *
   * DETERMINISTIC: Same input always produces same output
   */
  async process(
    input: unknown,
    context: ConfigValidationContext
  ): Promise<{
    event: ConfigValidationDecisionEvent;
    output: ConfigValidationOutput;
    durationMs: number;
  }> {
    const startTime = Date.now();

    // Validate input
    const validatedInput = ConfigValidationInputSchema.parse(input);

    // Perform deterministic validation
    const result = this.validateConfig(validatedInput);

    const durationMs = Date.now() - startTime;

    // Check performance budget
    if (durationMs > PERFORMANCE_BUDGETS.MAX_LATENCY_MS) {
      console.warn(
        `[${this.agentId}] Performance budget exceeded: ${durationMs}ms > ${PERFORMANCE_BUDGETS.MAX_LATENCY_MS}ms`
      );
    }

    // Create output
    const output: ConfigValidationOutput = {
      valid: result.valid,
      issues: result.issues,
      resolved_config: result.valid ? result.resolvedConfig : undefined,
      config_hash: this.computeConfigHash(validatedInput.config),
      schema_version: validatedInput.schema_version,
      validated_at: new Date().toISOString(),
      token_count: this.estimateTokenCount(validatedInput, result),
    };

    // Validate output against schema
    ConfigValidationOutputSchema.parse(output);

    // Create DecisionEvent
    const event = this.createDecisionEvent(validatedInput, output, context, durationMs);

    // Persist to Ruvector (async, non-blocking for response)
    this.persistValidationResult(validatedInput, output, event).catch(err => {
      console.error(`[${this.agentId}] Failed to persist to Ruvector:`, err);
    });

    return { event, output, durationMs };
  }

  /**
   * Validate configuration against schema
   * DETERMINISTIC: No side effects, pure function
   */
  private validateConfig(input: ConfigValidationInput): {
    valid: boolean;
    issues: ConfigValidationIssue[];
    resolvedConfig?: Record<string, unknown>;
  } {
    const issues: ConfigValidationIssue[] = [];

    // Get schema for namespace and version
    const namespaceSchemas = CONFIG_SCHEMAS[input.namespace];
    if (!namespaceSchemas) {
      issues.push({
        path: 'namespace',
        message: `Unknown configuration namespace: ${input.namespace}`,
        severity: 'error',
        code: 'UNKNOWN_NAMESPACE',
      });
      return { valid: false, issues };
    }

    const schema = namespaceSchemas[input.schema_version];
    if (!schema) {
      issues.push({
        path: 'schema_version',
        message: `Unsupported schema version: ${input.schema_version}`,
        severity: 'error',
        expected: Object.keys(namespaceSchemas).join(', '),
        actual: input.schema_version,
        code: 'UNSUPPORTED_VERSION',
      });
      return { valid: false, issues };
    }

    // Validate against schema
    const parseResult = schema.safeParse(input.config);

    if (!parseResult.success) {
      // Convert Zod errors to our format
      for (const error of parseResult.error.errors) {
        issues.push({
          path: error.path.join('.'),
          message: error.message,
          severity: 'error',
          code: this.zodErrorToCode(error.code),
        });
      }
      return { valid: false, issues };
    }

    // Check for warnings (deprecated fields, etc.)
    const warnings = this.checkForWarnings(input.namespace, input.config);
    issues.push(...warnings);

    // In strict mode, warnings become errors
    const hasErrors = issues.some(i => i.severity === 'error');
    const hasWarnings = issues.some(i => i.severity === 'warning');

    if (input.strict && hasWarnings) {
      return { valid: false, issues };
    }

    return {
      valid: !hasErrors,
      issues,
      resolvedConfig: parseResult.data as Record<string, unknown>,
    };
  }

  /**
   * Check for warnings in configuration
   */
  private checkForWarnings(
    namespace: string,
    config: Record<string, unknown>
  ): ConfigValidationIssue[] {
    const warnings: ConfigValidationIssue[] = [];

    // Check for deprecated fields
    const deprecatedFields: Record<string, string[]> = {
      'providers.openai': ['api_key'], // Should use api_key_env
      'providers.anthropic': ['api_key'],
    };

    const deprecated = deprecatedFields[namespace] || [];
    for (const field of deprecated) {
      if (field in config) {
        warnings.push({
          path: field,
          message: `Field '${field}' is deprecated. Use environment variable reference instead.`,
          severity: 'warning',
          code: 'DEPRECATED_FIELD',
        });
      }
    }

    // Check for insecure configurations
    if ('timeout_ms' in config && (config.timeout_ms as number) < 1000) {
      warnings.push({
        path: 'timeout_ms',
        message: 'Very low timeout may cause frequent failures',
        severity: 'warning',
        expected: '>= 1000',
        actual: String(config.timeout_ms),
        code: 'LOW_TIMEOUT',
      });
    }

    return warnings;
  }

  /**
   * Convert Zod error code to our error code format
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
    };
    return mapping[code] || 'VALIDATION_ERROR';
  }

  /**
   * Compute deterministic hash of configuration
   */
  private computeConfigHash(config: Record<string, unknown>): string {
    const normalized = JSON.stringify(config, Object.keys(config).sort());
    return createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Estimate token count for budget tracking
   */
  private estimateTokenCount(
    input: ConfigValidationInput,
    result: { issues: ConfigValidationIssue[] }
  ): number {
    // Rough estimation: 4 characters per token
    const inputSize = JSON.stringify(input).length;
    const outputSize = JSON.stringify(result).length;
    return Math.ceil((inputSize + outputSize) / 4);
  }

  /**
   * Create DecisionEvent for this validation
   */
  private createDecisionEvent(
    input: ConfigValidationInput,
    output: ConfigValidationOutput,
    context: ConfigValidationContext,
    durationMs: number
  ): ConfigValidationDecisionEvent {
    return {
      agent_id: this.agentId,
      agent_version: this.version,
      decision_type: this.decisionType,
      inputs_hash: this.computeConfigHash(input as unknown as Record<string, unknown>),
      outputs: output as unknown as Record<string, unknown>,
      confidence: {
        score: output.valid ? 1.0 : 0.0,
        schema_validation: output.valid ? 'passed' : 'failed',
      },
      constraints_applied: {
        connector_scope: 'config-validation',
        schema_boundaries: [input.namespace, input.schema_version],
        timeout_ms: PERFORMANCE_BUDGETS.MAX_LATENCY_MS,
      },
      execution_ref: context.traceId,
      timestamp: new Date().toISOString(),
      metadata: {
        duration_ms: durationMs,
        token_count: output.token_count,
        correlation_id: context.correlationId,
      },
    };
  }

  /**
   * Persist validation result to Ruvector
   */
  private async persistValidationResult(
    input: ConfigValidationInput,
    output: ConfigValidationOutput,
    event: ConfigValidationDecisionEvent
  ): Promise<void> {
    const documentId = `config-validation:${input.namespace}:${output.config_hash}`;

    await this.ruvector.store(
      'config-validation',
      documentId,
      {
        input: {
          namespace: input.namespace,
          source: input.source,
          schema_version: input.schema_version,
        },
        output: {
          valid: output.valid,
          issues_count: output.issues.length,
          config_hash: output.config_hash,
        },
        event_ref: event.execution_ref,
        timestamp: event.timestamp,
      },
      3600 // 1 hour TTL
    );
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    const ruvectorHealth = await this.ruvector.healthCheck();
    return ruvectorHealth.healthy;
  }
}

// ============================================================================
// Decision Event Type
// ============================================================================

export interface ConfigValidationDecisionEvent {
  agent_id: string;
  agent_version: string;
  decision_type: 'config_validation_signal';
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

let agentInstance: ConfigValidationAgent | null = null;

export function getConfigValidationAgent(): ConfigValidationAgent {
  if (!agentInstance) {
    agentInstance = new ConfigValidationAgent();
  }
  return agentInstance;
}
