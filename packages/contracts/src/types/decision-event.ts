import { z } from 'zod';

/**
 * Decision types for Connector Hub agents
 * Each agent emits exactly ONE DecisionEvent per invocation
 */
export const DecisionTypeSchema = z.enum([
  'erp_surface_event',
  'database_query_result',
  'webhook_ingest_event',
  'normalized_event',
  'auth_identity_verification',
]);

export type DecisionType = z.infer<typeof DecisionTypeSchema>;

/**
 * Constraint context applied during decision
 */
export const ConstraintsAppliedSchema = z.object({
  connector_scope: z.string().describe('Scope of the connector (e.g., "erp", "webhook", "database")'),
  auth_context: z.string().optional().describe('Authentication context if applicable'),
  schema_boundaries: z.array(z.string()).describe('Schema boundaries enforced'),
  rate_limits: z.object({
    requests_per_minute: z.number().optional(),
    concurrent_connections: z.number().optional(),
  }).optional(),
  data_classification: z.enum(['public', 'internal', 'confidential', 'restricted']).optional(),
});

export type ConstraintsApplied = z.infer<typeof ConstraintsAppliedSchema>;

/**
 * DecisionEvent schema - MUST be emitted by every agent invocation
 * This is the canonical output format for all Connector Hub agents
 */
export const DecisionEventSchema = z.object({
  agent_id: z.string().describe('Unique identifier for the agent type'),
  agent_version: z.string().describe('Semantic version of the agent'),
  decision_type: DecisionTypeSchema,
  inputs_hash: z.string().describe('SHA-256 hash of the input payload for audit trail'),
  outputs: z.record(z.unknown()).describe('The actual output data from the decision'),
  confidence: z.number().min(0).max(1).describe('Confidence score (0-1) for validation/translation certainty'),
  constraints_applied: ConstraintsAppliedSchema,
  execution_ref: z.string().describe('Unique reference for this execution (trace ID)'),
  timestamp: z.string().datetime().describe('UTC timestamp of the decision'),
  metadata: z.object({
    latency_ms: z.number().describe('Processing latency in milliseconds'),
    source_system: z.string().optional().describe('Source system identifier'),
    correlation_id: z.string().optional().describe('Correlation ID for request tracing'),
    environment: z.enum(['development', 'staging', 'production']).optional(),
  }).optional(),
});

export type DecisionEvent = z.infer<typeof DecisionEventSchema>;

/**
 * Factory function to create a DecisionEvent with defaults
 */
export function createDecisionEvent(
  params: Omit<DecisionEvent, 'timestamp'> & { timestamp?: string }
): DecisionEvent {
  return DecisionEventSchema.parse({
    ...params,
    timestamp: params.timestamp ?? new Date().toISOString(),
  });
}

/**
 * Validate a DecisionEvent
 */
export function validateDecisionEvent(event: unknown): DecisionEvent {
  return DecisionEventSchema.parse(event);
}
