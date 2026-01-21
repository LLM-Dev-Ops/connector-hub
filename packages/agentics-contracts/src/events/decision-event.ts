/**
 * DecisionEvent Schema for Agentics Platform
 *
 * Every agent in the Agentics platform MUST emit exactly ONE DecisionEvent per invocation.
 * This provides a unified audit trail and telemetry format across all agents.
 */

import { z } from 'zod';

/**
 * Decision types for different agent categories
 */
export const DecisionTypeSchema = z.enum([
  // Connector agents
  'erp_surface_event',
  'database_query_result',
  'webhook_ingest_event',
  'normalized_event',
  'auth_identity_verification',

  // Future agent types
  'data_transformation',
  'schema_validation',
  'routing_decision',
]);

export type DecisionType = z.infer<typeof DecisionTypeSchema>;

/**
 * Confidence levels for decision outcomes
 */
export const ConfidenceSchema = z.object({
  /** Overall confidence score (0.0 - 1.0) */
  score: z.number().min(0).max(1),

  /** Confidence category */
  level: z.enum(['high', 'medium', 'low', 'uncertain']),

  /** Specific confidence factors */
  factors: z.record(z.string(), z.number().min(0).max(1)).optional(),

  /** Human-readable explanation */
  reasoning: z.string().optional(),
});

export type Confidence = z.infer<typeof ConfidenceSchema>;

/**
 * Constraints applied during agent execution
 */
export const ConstraintsAppliedSchema = z.object({
  /** Connector scope (e.g., 'erp', 'database', 'webhook') */
  connector_scope: z.string().optional(),

  /** Authentication context */
  auth_context: z.object({
    method: z.string(),
    identity_verified: z.boolean(),
    permissions: z.array(z.string()).optional(),
  }).optional(),

  /** Schema boundaries applied */
  schema_boundaries: z.array(z.string()).optional(),

  /** Rate limits applied */
  rate_limits: z.object({
    requests_remaining: z.number().optional(),
    reset_at: z.string().datetime().optional(),
  }).optional(),

  /** Additional custom constraints */
  custom: z.record(z.string(), z.unknown()).optional(),
});

export type ConstraintsApplied = z.infer<typeof ConstraintsAppliedSchema>;

/**
 * Agent outputs structure
 */
export const AgentOutputsSchema = z.object({
  /** Primary output data */
  data: z.unknown(),

  /** Output format */
  format: z.enum(['json', 'binary', 'text', 'stream']).default('json'),

  /** Schema reference for output validation */
  schema_ref: z.string().optional(),

  /** Warnings generated during processing */
  warnings: z.array(z.string()).optional(),

  /** Metadata about the output */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type AgentOutputs = z.infer<typeof AgentOutputsSchema>;

/**
 * Core DecisionEvent schema
 *
 * This is the canonical event format for all agent decisions in the Agentics platform.
 */
export const DecisionEventSchema = z.object({
  /** Unique identifier for the agent */
  agent_id: z.string().min(1),

  /** Semantic version of the agent */
  agent_version: z.string().regex(/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/),

  /** Type of decision made */
  decision_type: DecisionTypeSchema,

  /** SHA-256 hash of inputs for audit trail */
  inputs_hash: z.string().length(64),

  /** Agent outputs */
  outputs: AgentOutputsSchema,

  /** Confidence assessment */
  confidence: ConfidenceSchema,

  /** Constraints applied during execution */
  constraints_applied: ConstraintsAppliedSchema,

  /** Reference to execution context (trace ID, span ID, etc.) */
  execution_ref: z.object({
    trace_id: z.string(),
    span_id: z.string().optional(),
    parent_span_id: z.string().optional(),
    correlation_id: z.string().optional(),
  }),

  /** UTC timestamp of the decision */
  timestamp: z.string().datetime(),

  /** Duration of agent execution in milliseconds */
  duration_ms: z.number().nonnegative().optional(),

  /** Error information if the agent failed */
  error: z.object({
    code: z.string(),
    message: z.string(),
    recoverable: z.boolean(),
    details: z.unknown().optional(),
  }).optional(),
});

export type DecisionEvent = z.infer<typeof DecisionEventSchema>;

/**
 * Create a new DecisionEvent with defaults
 */
export function createDecisionEvent(
  partial: Omit<DecisionEvent, 'timestamp'> & { timestamp?: string }
): DecisionEvent {
  return DecisionEventSchema.parse({
    ...partial,
    timestamp: partial.timestamp ?? new Date().toISOString(),
  });
}

/**
 * Validate a DecisionEvent
 */
export function validateDecisionEvent(event: unknown): DecisionEvent {
  return DecisionEventSchema.parse(event);
}

/**
 * Check if an object is a valid DecisionEvent
 */
export function isValidDecisionEvent(event: unknown): event is DecisionEvent {
  return DecisionEventSchema.safeParse(event).success;
}
