/**
 * Agentics Contracts - Core Type Definitions
 *
 * This module defines the canonical schemas and types for LLM-Connector-Hub agents.
 * These contracts are NON-NEGOTIABLE and define the boundary between external systems
 * and the Agentics platform.
 *
 * ARCHITECTURAL RULES:
 * - All agents are EXTERNAL INTERFACE ADAPTERS
 * - All agents are INGESTION & NORMALIZATION AGENTS
 * - All agents are NON-EXECUTING, NON-DECISION-MAKING COMPONENTS
 * - All agents emit exactly ONE DecisionEvent per invocation
 */

import { z } from 'zod';

// ============================================================================
// Decision Types - Categorization of agent outputs
// ============================================================================

/**
 * Decision types for LLM-Connector-Hub agents.
 * Each agent emits exactly one DecisionEvent with a specific decision_type.
 */
export const DecisionTypeSchema = z.enum([
  'webhook_ingest_event',
  'erp_surface_event',
  'database_query_result',
  'normalized_event',
  'auth_identity_verification',
]);

export type DecisionType = z.infer<typeof DecisionTypeSchema>;

// ============================================================================
// Confidence Semantics - Validation and translation certainty
// ============================================================================

/**
 * Confidence metrics for agent decisions.
 * Represents validation/translation certainty levels.
 */
export const ConfidenceSchema = z.object({
  /** Overall confidence score (0.0 - 1.0) */
  score: z.number().min(0).max(1),

  /** Authentication assurance level */
  auth_assurance: z.enum(['none', 'low', 'medium', 'high', 'verified']).optional(),

  /** Payload completeness indicator */
  payload_completeness: z.number().min(0).max(1).optional(),

  /** Normalization certainty */
  normalization_certainty: z.number().min(0).max(1).optional(),

  /** Schema validation result */
  schema_validation: z.enum(['passed', 'failed', 'partial']).optional(),
});

export type Confidence = z.infer<typeof ConfidenceSchema>;

// ============================================================================
// Constraints Applied - Connector scope and context
// ============================================================================

/**
 * Constraints applied during agent execution.
 * Defines the scope and boundaries of connector operations.
 */
export const ConstraintsAppliedSchema = z.object({
  /** Connector scope identifier */
  connector_scope: z.string(),

  /** Identity context (if authenticated) */
  identity_context: z.string().optional(),

  /** Schema boundaries enforced */
  schema_boundaries: z.array(z.string()).optional(),

  /** Rate limiting applied */
  rate_limit_applied: z.boolean().optional(),

  /** Size limits enforced */
  size_limit_bytes: z.number().optional(),

  /** Time constraints applied */
  timeout_ms: z.number().optional(),
});

export type ConstraintsApplied = z.infer<typeof ConstraintsAppliedSchema>;

// ============================================================================
// DecisionEvent - Core agent output schema
// ============================================================================

/**
 * DecisionEvent - The canonical output format for all LLM-Connector-Hub agents.
 *
 * REQUIRED FIELDS:
 * - agent_id: Unique identifier for the agent instance
 * - agent_version: Semantic version of the agent
 * - decision_type: Category of the decision
 * - inputs_hash: SHA-256 hash of inputs for idempotency
 * - outputs: The normalized payload/result
 * - confidence: Validation/translation certainty
 * - constraints_applied: Connector scope and context
 * - execution_ref: Unique execution reference for tracing
 * - timestamp: UTC timestamp of the event
 */
export const DecisionEventSchema = z.object({
  /** Unique identifier for the agent */
  agent_id: z.string().min(1),

  /** Semantic version of the agent (e.g., "1.0.0") */
  agent_version: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/),

  /** Type of decision being emitted */
  decision_type: DecisionTypeSchema,

  /** SHA-256 hash of inputs for idempotency checking */
  inputs_hash: z.string().length(64),

  /** The normalized output payload */
  outputs: z.record(z.unknown()),

  /** Confidence metrics for the decision */
  confidence: ConfidenceSchema,

  /** Constraints applied during execution */
  constraints_applied: ConstraintsAppliedSchema,

  /** Unique execution reference for tracing */
  execution_ref: z.string().uuid(),

  /** UTC timestamp (ISO 8601 format) */
  timestamp: z.string().datetime(),

  /** Optional metadata for additional context */
  metadata: z.record(z.unknown()).optional(),
});

export type DecisionEvent = z.infer<typeof DecisionEventSchema>;

// ============================================================================
// Agent Response - Standardized agent output wrapper
// ============================================================================

/**
 * Agent execution status
 */
export const AgentStatusSchema = z.enum([
  'success',
  'validation_failed',
  'auth_failed',
  'rate_limited',
  'timeout',
  'error',
]);

export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/**
 * Standardized agent response wrapper
 */
export const AgentResponseSchema = z.object({
  /** Execution status */
  status: AgentStatusSchema,

  /** The DecisionEvent (present on success) */
  decision_event: DecisionEventSchema.optional(),

  /** Error details (present on failure) */
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.record(z.unknown()).optional(),
      retryable: z.boolean(),
    })
    .optional(),

  /** Telemetry data for LLM-Observatory */
  telemetry: z
    .object({
      duration_ms: z.number(),
      memory_used_bytes: z.number().optional(),
      validation_time_ms: z.number().optional(),
    })
    .optional(),
});

export type AgentResponse = z.infer<typeof AgentResponseSchema>;

// ============================================================================
// Agent Interface - Base contract for all agents
// ============================================================================

/**
 * Base agent interface.
 * All LLM-Connector-Hub agents MUST implement this interface.
 */
export interface IAgent {
  /** Unique agent identifier */
  readonly agentId: string;

  /** Agent semantic version */
  readonly version: string;

  /** Agent decision type */
  readonly decisionType: DecisionType;

  /** Initialize the agent */
  initialize(): Promise<void>;

  /** Process a request and emit a DecisionEvent */
  process(input: unknown): Promise<AgentResponse>;

  /** Cleanup agent resources */
  shutdown(): Promise<void>;

  /** Health check */
  healthCheck(): Promise<boolean>;
}

// ============================================================================
// Agent Configuration - Base configuration schema
// ============================================================================

/**
 * Base agent configuration schema
 */
export const BaseAgentConfigSchema = z.object({
  /** Enable debug logging */
  debug: z.boolean().default(false),

  /** Request timeout in milliseconds */
  timeout_ms: z.number().min(100).max(300000).default(30000),

  /** Maximum payload size in bytes */
  max_payload_bytes: z.number().min(1024).max(104857600).default(10485760),

  /** Enable telemetry emission */
  telemetry_enabled: z.boolean().default(true),
});

export type BaseAgentConfig = z.infer<typeof BaseAgentConfigSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a SHA-256 hash of the input for idempotency checking
 */
export function computeInputsHash(input: unknown): string {
  const crypto = require('crypto');
  const normalized = JSON.stringify(input, Object.keys(input as object).sort());
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Generate a new execution reference UUID
 */
export function generateExecutionRef(): string {
  const crypto = require('crypto');
  return crypto.randomUUID();
}

/**
 * Get current UTC timestamp in ISO 8601 format
 */
export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Create a DecisionEvent with required fields
 */
export function createDecisionEvent(params: {
  agentId: string;
  agentVersion: string;
  decisionType: DecisionType;
  input: unknown;
  outputs: Record<string, unknown>;
  confidence: Confidence;
  constraintsApplied: ConstraintsApplied;
  metadata?: Record<string, unknown>;
}): DecisionEvent {
  return {
    agent_id: params.agentId,
    agent_version: params.agentVersion,
    decision_type: params.decisionType,
    inputs_hash: computeInputsHash(params.input),
    outputs: params.outputs,
    confidence: params.confidence,
    constraints_applied: params.constraintsApplied,
    execution_ref: generateExecutionRef(),
    timestamp: getCurrentTimestamp(),
    metadata: params.metadata,
  };
}
