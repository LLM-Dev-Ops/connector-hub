/**
 * Webhook Agent Contracts
 *
 * Defines the schema contracts for the Webhook Listener Agent.
 * This agent receives, authenticates, and validates inbound webhook payloads
 * from third-party systems.
 *
 * CLASSIFICATION: INGRESS CONNECTOR / WEBHOOK RECEIVER
 *
 * SCOPE:
 * - Verify webhook signatures
 * - Validate payload structure
 * - Enforce schema correctness
 * - Reject malformed or unauthorized requests
 * - Emit webhook ingestion DecisionEvents
 *
 * MUST NOT:
 * - Modify internal execution behavior
 * - Trigger workflows or retries
 * - Enforce governance or business policies
 * - Execute other agents
 * - Apply optimizations
 * - Emit analytical or anomaly signals
 */

import { z } from 'zod';
import {
  BaseAgentConfigSchema,
  DecisionEventSchema,
  type Confidence,
  type ConstraintsApplied,
  type DecisionEvent,
} from './types.js';

// ============================================================================
// Signature Verification Types
// ============================================================================

/**
 * Supported signature verification methods
 */
export const SignatureMethodSchema = z.enum([
  'hmac_sha256',
  'hmac_sha512',
  'jwt_hs256',
  'jwt_rs256',
  'api_key',
  'basic_auth',
  'none',
]);

export type SignatureMethod = z.infer<typeof SignatureMethodSchema>;

/**
 * Signature verification configuration
 */
export const SignatureConfigSchema = z.object({
  /** Verification method */
  method: SignatureMethodSchema,

  /** Header name containing the signature */
  header_name: z.string().default('X-Webhook-Signature'),

  /** Secret key for HMAC verification (not persisted) */
  secret_key: z.string().optional(),

  /** Public key for JWT/RSA verification (not persisted) */
  public_key: z.string().optional(),

  /** API key header name */
  api_key_header: z.string().default('X-API-Key'),

  /** Timestamp tolerance for replay protection (seconds) */
  timestamp_tolerance_seconds: z.number().min(0).max(3600).default(300),

  /** Timestamp header name */
  timestamp_header: z.string().default('X-Webhook-Timestamp'),
});

export type SignatureConfig = z.infer<typeof SignatureConfigSchema>;

// ============================================================================
// Webhook Request Schema
// ============================================================================

/**
 * Inbound webhook request schema
 */
export const WebhookRequestSchema = z.object({
  /** HTTP method (typically POST) */
  method: z.enum(['POST', 'PUT', 'PATCH']).default('POST'),

  /** Request path */
  path: z.string(),

  /** Request headers */
  headers: z.record(z.string()),

  /** Raw request body */
  body: z.string(),

  /** Parsed JSON body (if applicable) */
  parsed_body: z.record(z.unknown()).optional(),

  /** Query parameters */
  query_params: z.record(z.string()).optional(),

  /** Source IP address */
  source_ip: z.string().ip().optional(),

  /** Request timestamp (when received) */
  received_at: z.string().datetime(),

  /** Content type */
  content_type: z.string().default('application/json'),
});

export type WebhookRequest = z.infer<typeof WebhookRequestSchema>;

// ============================================================================
// Webhook Validation Result
// ============================================================================

/**
 * Validation error detail
 */
export const ValidationErrorSchema = z.object({
  /** Field path that failed validation */
  path: z.string(),

  /** Error code */
  code: z.string(),

  /** Human-readable message */
  message: z.string(),

  /** Expected value/type */
  expected: z.string().optional(),

  /** Actual value/type */
  actual: z.string().optional(),
});

export type ValidationError = z.infer<typeof ValidationErrorSchema>;

/**
 * Signature verification result
 */
export const SignatureVerificationResultSchema = z.object({
  /** Whether signature is valid */
  valid: z.boolean(),

  /** Verification method used */
  method: SignatureMethodSchema,

  /** Timestamp validation (if applicable) */
  timestamp_valid: z.boolean().optional(),

  /** Error message if invalid */
  error: z.string().optional(),
});

export type SignatureVerificationResult = z.infer<typeof SignatureVerificationResultSchema>;

/**
 * Complete webhook validation result
 */
export const WebhookValidationResultSchema = z.object({
  /** Overall validation status */
  valid: z.boolean(),

  /** Signature verification result */
  signature: SignatureVerificationResultSchema,

  /** Schema validation passed */
  schema_valid: z.boolean(),

  /** List of validation errors */
  errors: z.array(ValidationErrorSchema),

  /** Validation duration in milliseconds */
  validation_duration_ms: z.number(),
});

export type WebhookValidationResult = z.infer<typeof WebhookValidationResultSchema>;

// ============================================================================
// Webhook Agent Configuration
// ============================================================================

/**
 * Webhook Listener Agent configuration
 */
export const WebhookAgentConfigSchema = BaseAgentConfigSchema.extend({
  /** Signature verification configuration */
  signature: SignatureConfigSchema.optional(),

  /** Allowed source IP addresses (CIDR notation) */
  allowed_source_ips: z.array(z.string()).optional(),

  /** Allowed content types */
  allowed_content_types: z.array(z.string()).default(['application/json']),

  /** Custom payload schema (Zod-compatible JSON Schema) */
  payload_schema: z.record(z.unknown()).optional(),

  /** Enable replay protection */
  replay_protection: z.boolean().default(true),

  /** Enable rate limiting */
  rate_limit_enabled: z.boolean().default(true),

  /** Rate limit (requests per minute) */
  rate_limit_rpm: z.number().min(1).max(10000).default(100),

  /** Connector identifier */
  connector_id: z.string().min(1),

  /** Connector scope for constraints */
  connector_scope: z.string().min(1),
});

export type WebhookAgentConfig = z.infer<typeof WebhookAgentConfigSchema>;

// ============================================================================
// Webhook DecisionEvent Outputs
// ============================================================================

/**
 * Normalized webhook payload output
 */
export const WebhookOutputSchema = z.object({
  /** Original webhook source identifier */
  source_id: z.string(),

  /** Webhook event type (if identifiable) */
  event_type: z.string().optional(),

  /** Normalized payload */
  payload: z.record(z.unknown()),

  /** Original payload hash */
  original_payload_hash: z.string(),

  /** Normalization mapping applied */
  normalization_mapping: z.string().optional(),

  /** Extracted identifiers */
  identifiers: z
    .object({
      correlation_id: z.string().optional(),
      idempotency_key: z.string().optional(),
      external_id: z.string().optional(),
    })
    .optional(),
});

export type WebhookOutput = z.infer<typeof WebhookOutputSchema>;

// ============================================================================
// Webhook-Specific DecisionEvent
// ============================================================================

/**
 * Webhook ingestion DecisionEvent
 * Extends the base DecisionEvent with webhook-specific outputs
 */
export interface WebhookDecisionEvent extends DecisionEvent {
  decision_type: 'webhook_ingest_event';
  outputs: WebhookOutput;
}

/**
 * Create webhook-specific confidence metrics
 */
export function createWebhookConfidence(params: {
  signatureValid: boolean;
  schemaValid: boolean;
  payloadComplete: boolean;
  authLevel: 'none' | 'low' | 'medium' | 'high' | 'verified';
}): Confidence {
  const baseScore =
    (params.signatureValid ? 0.4 : 0) +
    (params.schemaValid ? 0.3 : 0) +
    (params.payloadComplete ? 0.3 : 0);

  return {
    score: baseScore,
    auth_assurance: params.authLevel,
    payload_completeness: params.payloadComplete ? 1.0 : 0.5,
    normalization_certainty: params.schemaValid ? 1.0 : 0.7,
    schema_validation: params.schemaValid ? 'passed' : 'failed',
  };
}

/**
 * Create webhook-specific constraints
 */
export function createWebhookConstraints(params: {
  connectorScope: string;
  identityContext?: string;
  schemaBoundaries?: string[];
  rateLimitApplied: boolean;
  payloadSizeBytes: number;
  timeoutMs: number;
}): ConstraintsApplied {
  return {
    connector_scope: params.connectorScope,
    identity_context: params.identityContext,
    schema_boundaries: params.schemaBoundaries,
    rate_limit_applied: params.rateLimitApplied,
    size_limit_bytes: params.payloadSizeBytes,
    timeout_ms: params.timeoutMs,
  };
}

// ============================================================================
// Data Persistence Rules (ruvector-service)
// ============================================================================

/**
 * Data that MUST be persisted to ruvector-service
 */
export const PersistedWebhookDataSchema = z.object({
  /** The DecisionEvent */
  decision_event: DecisionEventSchema,

  /** Request metadata (non-sensitive) */
  request_metadata: z.object({
    path: z.string(),
    content_type: z.string(),
    source_ip_hash: z.string(), // Hashed, not raw
    received_at: z.string().datetime(),
  }),

  /** Validation summary */
  validation_summary: z.object({
    signature_valid: z.boolean(),
    schema_valid: z.boolean(),
    error_count: z.number(),
  }),
});

export type PersistedWebhookData = z.infer<typeof PersistedWebhookDataSchema>;

/**
 * Data that MUST NOT be persisted (credentials, secrets)
 */
export const SensitiveDataFields = [
  'signature_secret',
  'api_key',
  'authorization_header',
  'bearer_token',
  'password',
  'private_key',
  'secret_key',
] as const;

/**
 * Sanitize headers by removing sensitive data
 */
export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sensitivePatterns = [
    /^authorization$/i,
    /^x-api-key$/i,
    /^x-auth/i,
    /^cookie$/i,
    /^x-webhook-signature$/i,
    /secret/i,
    /token/i,
    /password/i,
  ];

  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (sensitivePatterns.some((pattern) => pattern.test(key))) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
