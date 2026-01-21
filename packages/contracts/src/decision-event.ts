import { z } from 'zod';

/**
 * DecisionType enumeration representing the types of agent decisions
 * that can be recorded in the system.
 */
export const DecisionTypeSchema = z.enum([
  'database_query_result',
  'erp_surface_event',
  'webhook_ingest_event',
  'normalized_event',
  'auth_identity_verification',
]);

export type DecisionType = z.infer<typeof DecisionTypeSchema>;

/**
 * Schema for constraints applied during agent decision execution.
 * Captures contextual limitations and scoping information.
 */
export const ConstraintsAppliedSchema = z.object({
  /**
   * Connector scope limiting the execution context.
   * Defines which systems or data sources are accessible.
   */
  connector_scope: z.array(z.string()).optional().describe('Array of connector identifiers limiting execution scope'),

  /**
   * Authentication context identifying the user or system making the request.
   * Used for authorization and audit trails.
   */
  auth_context: z.object({
    user_id: z.string().optional().describe('Unique identifier for the authenticated user'),
    tenant_id: z.string().optional().describe('Multi-tenant organization identifier'),
    permissions: z.array(z.string()).optional().describe('List of permissions granted to the requester'),
  }).optional().describe('Authentication and authorization context'),

  /**
   * Rate limiting constraints applied to the execution.
   */
  rate_limits: z.object({
    max_queries_per_minute: z.number().optional(),
    max_rows_returned: z.number().optional(),
  }).optional().describe('Rate limiting constraints'),

  /**
   * Additional custom constraints as key-value pairs.
   */
  custom: z.record(z.unknown()).optional().describe('Custom constraint key-value pairs'),
});

export type ConstraintsApplied = z.infer<typeof ConstraintsAppliedSchema>;

/**
 * DecisionEvent schema representing a complete agent decision record.
 * This is the core contract for all agent outputs in the system.
 *
 * @remarks
 * All agents MUST emit DecisionEvents for audit, compliance, and coordination.
 * The schema is deterministic and machine-readable for downstream processing.
 *
 * @example
 * ```typescript
 * const event: DecisionEvent = {
 *   agent_id: 'database-query-agent-v1',
 *   agent_version: '1.2.3',
 *   decision_type: 'database_query_result',
 *   inputs_hash: 'abc123...',
 *   outputs: { rows: [...], metadata: {...} },
 *   confidence: 0.98,
 *   constraints_applied: {
 *     connector_scope: ['postgres-prod'],
 *     auth_context: { user_id: 'user-123' }
 *   },
 *   execution_ref: 'trace-xyz-789',
 *   timestamp: '2026-01-21T10:30:00.000Z'
 * };
 * ```
 */
export const DecisionEventSchema = z.object({
  /**
   * Unique identifier for the agent instance that made the decision.
   * Should be stable and version-aware (e.g., 'database-query-agent-v1').
   */
  agent_id: z.string()
    .min(1)
    .describe('Unique identifier for the agent instance'),

  /**
   * Semantic version of the agent following semver conventions.
   * Used for compatibility checking and rollback scenarios.
   */
  agent_version: z.string()
    .regex(/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/)
    .describe('Semantic version of the agent (e.g., 1.2.3 or 1.2.3-alpha.1)'),

  /**
   * Type of decision made by the agent.
   * Determines the expected structure of the outputs field.
   */
  decision_type: DecisionTypeSchema
    .describe('Type of decision made by the agent'),

  /**
   * SHA-256 hash of the input parameters.
   * Enables deterministic replay and cache validation.
   * MUST be lowercase hexadecimal string.
   */
  inputs_hash: z.string()
    .regex(/^[a-f0-9]{64}$/)
    .describe('SHA-256 hash of input parameters (lowercase hex)'),

  /**
   * Agent-specific output payload.
   * Structure varies by decision_type and agent contract.
   * MUST be JSON-serializable.
   */
  outputs: z.record(z.unknown())
    .describe('Agent-specific output payload (JSON-serializable)'),

  /**
   * Confidence score for validation or translation certainty.
   * Range: 0.0 (no confidence) to 1.0 (complete confidence).
   * Used for filtering low-quality results and A/B testing.
   */
  confidence: z.number()
    .min(0)
    .max(1)
    .describe('Confidence score for validation/translation certainty (0.0-1.0)'),

  /**
   * Constraints applied during execution.
   * Captures connector scope, auth context, and custom limitations.
   */
  constraints_applied: ConstraintsAppliedSchema
    .describe('Constraints applied during execution'),

  /**
   * Execution reference ID for correlation and tracing.
   * Links this decision to distributed traces and log aggregation.
   */
  execution_ref: z.string()
    .min(1)
    .describe('Trace ID or correlation ID for distributed tracing'),

  /**
   * ISO 8601 UTC timestamp when the decision was made.
   * MUST include timezone (Z suffix for UTC).
   */
  timestamp: z.string()
    .datetime()
    .describe('ISO 8601 UTC timestamp (e.g., 2026-01-21T10:30:00.000Z)'),
});

export type DecisionEvent = z.infer<typeof DecisionEventSchema>;

/**
 * Validates a DecisionEvent object against the schema.
 * Throws ZodError if validation fails.
 *
 * @param data - The data to validate
 * @returns Validated DecisionEvent
 * @throws {ZodError} If validation fails
 */
export function validateDecisionEvent(data: unknown): DecisionEvent {
  return DecisionEventSchema.parse(data);
}

/**
 * Safely validates a DecisionEvent object.
 * Returns success/error result without throwing.
 *
 * @param data - The data to validate
 * @returns SafeParseReturnType with success flag and data/error
 */
export function safeValidateDecisionEvent(data: unknown) {
  return DecisionEventSchema.safeParse(data);
}
