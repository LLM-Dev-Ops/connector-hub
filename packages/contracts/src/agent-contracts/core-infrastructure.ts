/**
 * Core Infrastructure Agent Contracts - Phase 6 (Layer 1)
 *
 * These contracts define the truth sources for:
 * - Configuration validation
 * - Schema enforcement
 * - Integration health
 *
 * ARCHITECTURAL RULES:
 * - All agents MUST be deterministic
 * - All agents MUST persist via ruvector-service ONLY
 * - All agents MUST emit exactly ONE DecisionEvent per invocation
 * - MAX_TOKENS: 800
 * - MAX_LATENCY_MS: 1500
 */

import { z } from 'zod';

// ============================================================================
// Performance Budgets - Enforced at runtime
// ============================================================================

export const PERFORMANCE_BUDGETS = {
  MAX_TOKENS: 800,
  MAX_LATENCY_MS: 1500,
} as const;

// ============================================================================
// Decision Types for Core Infrastructure
// ============================================================================

export const CoreInfraDecisionTypeSchema = z.enum([
  'config_validation_signal',
  'schema_violation_signal',
  'integration_health_signal',
]);

export type CoreInfraDecisionType = z.infer<typeof CoreInfraDecisionTypeSchema>;

// ============================================================================
// Configuration Validation Agent Contract
// ============================================================================

/**
 * Configuration source types
 */
export const ConfigSourceSchema = z.enum([
  'environment',
  'secret_manager',
  'ruvector',
  'file',
  'remote',
]);

export type ConfigSource = z.infer<typeof ConfigSourceSchema>;

/**
 * Configuration validation severity levels
 */
export const ConfigSeveritySchema = z.enum([
  'error',
  'warning',
  'info',
]);

export type ConfigSeverity = z.infer<typeof ConfigSeveritySchema>;

/**
 * Configuration validation issue
 */
export const ConfigValidationIssueSchema = z.object({
  path: z.string().describe('JSON path to the configuration key'),
  message: z.string().max(200).describe('Human-readable validation message'),
  severity: ConfigSeveritySchema,
  expected: z.string().optional().describe('Expected value or type'),
  actual: z.string().optional().describe('Actual value or type'),
  code: z.string().describe('Machine-readable error code'),
});

export type ConfigValidationIssue = z.infer<typeof ConfigValidationIssueSchema>;

/**
 * Configuration validation input
 */
export const ConfigValidationInputSchema = z.object({
  /** Configuration namespace (e.g., 'providers.openai', 'middleware.cache') */
  namespace: z.string().min(1).max(100),
  /** Configuration data to validate */
  config: z.record(z.unknown()),
  /** Source of the configuration */
  source: ConfigSourceSchema,
  /** Schema version to validate against */
  schema_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** Strict mode (fail on warnings) */
  strict: z.boolean().default(false),
});

export type ConfigValidationInput = z.infer<typeof ConfigValidationInputSchema>;

/**
 * Configuration validation output
 */
export const ConfigValidationOutputSchema = z.object({
  /** Validation passed */
  valid: z.boolean(),
  /** Validation issues (if any) */
  issues: z.array(ConfigValidationIssueSchema).max(50),
  /** Resolved configuration (with defaults applied) */
  resolved_config: z.record(z.unknown()).optional(),
  /** Configuration hash for cache invalidation */
  config_hash: z.string().length(64),
  /** Schema version used */
  schema_version: z.string(),
  /** Validation timestamp */
  validated_at: z.string().datetime(),
  /** Token count for budget tracking */
  token_count: z.number().max(PERFORMANCE_BUDGETS.MAX_TOKENS),
});

export type ConfigValidationOutput = z.infer<typeof ConfigValidationOutputSchema>;

/**
 * Full contract for ConfigValidationAgent
 */
export const ConfigValidationContractSchema = z.object({
  input: ConfigValidationInputSchema,
  output: ConfigValidationOutputSchema,
});

export type ConfigValidationContract = z.infer<typeof ConfigValidationContractSchema>;

// ============================================================================
// Schema Enforcement Agent Contract
// ============================================================================

/**
 * Schema types supported
 */
export const SchemaTypeSchema = z.enum([
  'json_schema',
  'zod',
  'protobuf',
  'avro',
  'openapi',
]);

export type SchemaType = z.infer<typeof SchemaTypeSchema>;

/**
 * Schema violation details
 */
export const SchemaViolationSchema = z.object({
  path: z.string().describe('JSON path to the violation'),
  message: z.string().max(200).describe('Violation description'),
  code: z.string().describe('Machine-readable violation code'),
  expected_type: z.string().optional(),
  actual_type: z.string().optional(),
  constraint: z.string().optional().describe('Constraint that was violated'),
});

export type SchemaViolation = z.infer<typeof SchemaViolationSchema>;

/**
 * Schema enforcement input
 */
export const SchemaEnforcementInputSchema = z.object({
  /** Payload to validate */
  payload: z.unknown(),
  /** Schema identifier */
  schema_id: z.string().min(1).max(100),
  /** Schema version */
  schema_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** Schema type */
  schema_type: SchemaTypeSchema,
  /** Validation mode */
  mode: z.enum(['strict', 'lenient', 'coerce']).default('strict'),
  /** Maximum depth to validate */
  max_depth: z.number().min(1).max(100).default(50),
});

export type SchemaEnforcementInput = z.infer<typeof SchemaEnforcementInputSchema>;

/**
 * Schema enforcement output
 */
export const SchemaEnforcementOutputSchema = z.object({
  /** Schema validation passed */
  valid: z.boolean(),
  /** Violations found */
  violations: z.array(SchemaViolationSchema).max(100),
  /** Coerced payload (if mode is 'coerce' and successful) */
  coerced_payload: z.unknown().optional(),
  /** Schema that was applied */
  schema_applied: z.object({
    id: z.string(),
    version: z.string(),
    type: SchemaTypeSchema,
    hash: z.string().length(64),
  }),
  /** Validation statistics */
  stats: z.object({
    fields_validated: z.number(),
    depth_reached: z.number(),
    duration_ms: z.number().max(PERFORMANCE_BUDGETS.MAX_LATENCY_MS),
  }),
  /** Token count for budget tracking */
  token_count: z.number().max(PERFORMANCE_BUDGETS.MAX_TOKENS),
});

export type SchemaEnforcementOutput = z.infer<typeof SchemaEnforcementOutputSchema>;

/**
 * Full contract for SchemaEnforcementAgent
 */
export const SchemaEnforcementContractSchema = z.object({
  input: SchemaEnforcementInputSchema,
  output: SchemaEnforcementOutputSchema,
});

export type SchemaEnforcementContract = z.infer<typeof SchemaEnforcementContractSchema>;

// ============================================================================
// Integration Health Agent Contract
// ============================================================================

/**
 * Integration types
 */
export const IntegrationTypeSchema = z.enum([
  'ruvector',
  'llm_provider',
  'secret_manager',
  'telemetry',
  'cache',
  'database',
  'external_api',
]);

export type IntegrationType = z.infer<typeof IntegrationTypeSchema>;

/**
 * Health status levels
 */
export const HealthStatusSchema = z.enum([
  'healthy',
  'degraded',
  'unhealthy',
  'unknown',
]);

export type HealthStatus = z.infer<typeof HealthStatusSchema>;

/**
 * Individual integration health check result
 */
export const IntegrationHealthCheckSchema = z.object({
  /** Integration identifier */
  integration_id: z.string().min(1).max(100),
  /** Integration type */
  type: IntegrationTypeSchema,
  /** Health status */
  status: HealthStatusSchema,
  /** Response latency in milliseconds */
  latency_ms: z.number().min(0).max(30000),
  /** Last successful check timestamp */
  last_success: z.string().datetime().optional(),
  /** Error message (if unhealthy) */
  error: z.string().max(500).optional(),
  /** Additional metadata */
  metadata: z.record(z.unknown()).optional(),
});

export type IntegrationHealthCheck = z.infer<typeof IntegrationHealthCheckSchema>;

/**
 * Integration health input
 */
export const IntegrationHealthInputSchema = z.object({
  /** Integrations to check (empty = all) */
  integrations: z.array(z.string()).default([]),
  /** Timeout for each health check */
  timeout_ms: z.number().min(100).max(10000).default(5000),
  /** Include detailed metadata */
  include_metadata: z.boolean().default(false),
  /** Force fresh check (bypass cache) */
  force_fresh: z.boolean().default(false),
});

export type IntegrationHealthInput = z.infer<typeof IntegrationHealthInputSchema>;

/**
 * Integration health output
 */
export const IntegrationHealthOutputSchema = z.object({
  /** Overall system health */
  overall_status: HealthStatusSchema,
  /** Individual integration health checks */
  integrations: z.array(IntegrationHealthCheckSchema),
  /** Aggregated statistics */
  stats: z.object({
    total_checked: z.number(),
    healthy_count: z.number(),
    degraded_count: z.number(),
    unhealthy_count: z.number(),
    unknown_count: z.number(),
    total_latency_ms: z.number(),
    avg_latency_ms: z.number(),
  }),
  /** Check timestamp */
  checked_at: z.string().datetime(),
  /** Token count for budget tracking */
  token_count: z.number().max(PERFORMANCE_BUDGETS.MAX_TOKENS),
});

export type IntegrationHealthOutput = z.infer<typeof IntegrationHealthOutputSchema>;

/**
 * Full contract for IntegrationHealthAgent
 */
export const IntegrationHealthContractSchema = z.object({
  input: IntegrationHealthInputSchema,
  output: IntegrationHealthOutputSchema,
});

export type IntegrationHealthContract = z.infer<typeof IntegrationHealthContractSchema>;

// ============================================================================
// Validation Helpers
// ============================================================================

export function validateConfigValidationInput(data: unknown): ConfigValidationInput {
  return ConfigValidationInputSchema.parse(data);
}

export function validateConfigValidationOutput(data: unknown): ConfigValidationOutput {
  return ConfigValidationOutputSchema.parse(data);
}

export function safeValidateConfigValidationInput(data: unknown) {
  return ConfigValidationInputSchema.safeParse(data);
}

export function safeValidateConfigValidationOutput(data: unknown) {
  return ConfigValidationOutputSchema.safeParse(data);
}

export function validateSchemaEnforcementInput(data: unknown): SchemaEnforcementInput {
  return SchemaEnforcementInputSchema.parse(data);
}

export function validateSchemaEnforcementOutput(data: unknown): SchemaEnforcementOutput {
  return SchemaEnforcementOutputSchema.parse(data);
}

export function safeValidateSchemaEnforcementInput(data: unknown) {
  return SchemaEnforcementInputSchema.safeParse(data);
}

export function safeValidateSchemaEnforcementOutput(data: unknown) {
  return SchemaEnforcementOutputSchema.safeParse(data);
}

export function validateIntegrationHealthInput(data: unknown): IntegrationHealthInput {
  return IntegrationHealthInputSchema.parse(data);
}

export function validateIntegrationHealthOutput(data: unknown): IntegrationHealthOutput {
  return IntegrationHealthOutputSchema.parse(data);
}

export function safeValidateIntegrationHealthInput(data: unknown) {
  return IntegrationHealthInputSchema.safeParse(data);
}

export function safeValidateIntegrationHealthOutput(data: unknown) {
  return IntegrationHealthOutputSchema.safeParse(data);
}
