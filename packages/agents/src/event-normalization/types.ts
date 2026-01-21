/**
 * Event Normalization Agent - Type Definitions
 *
 * Types for converting heterogeneous external events into canonical internal event formats.
 */

import { z } from 'zod';

/**
 * External event format identifiers
 */
export const ExternalFormatSchema = z.enum([
  'openai_api',
  'anthropic_api',
  'google_ai_api',
  'azure_openai_api',
  'aws_bedrock_api',
  'webhook_github',
  'webhook_stripe',
  'webhook_slack',
  'webhook_generic',
  'erp_salesforce',
  'erp_sap',
  'erp_dynamics',
  'database_postgres',
  'database_mysql',
  'database_mongodb',
  'auth_oauth2',
  'auth_saml',
  'auth_oidc',
  'custom',
]);

export type ExternalFormat = z.infer<typeof ExternalFormatSchema>;

/**
 * Canonical event type identifiers
 */
export const CanonicalEventTypeSchema = z.enum([
  'llm.request',
  'llm.response',
  'llm.stream_chunk',
  'llm.error',
  'webhook.received',
  'webhook.validated',
  'erp.record_change',
  'erp.query_result',
  'database.query_result',
  'database.connection_event',
  'auth.token_verified',
  'auth.identity_resolved',
  'connector.health_check',
  'connector.metrics',
  'unknown',
]);

export type CanonicalEventType = z.infer<typeof CanonicalEventTypeSchema>;

/**
 * External event input schema
 */
export const ExternalEventInputSchema = z.object({
  /** Source format of the event */
  format: ExternalFormatSchema,

  /** Raw payload from the external system */
  raw_payload: z.unknown(),

  /** HTTP headers if applicable */
  headers: z.record(z.string()).optional(),

  /** Timestamp when the event was received */
  received_at: z.string().datetime().optional(),

  /** Source IP address */
  source_ip: z.string().optional(),

  /** Content type header */
  content_type: z.string().optional(),

  /** Webhook signature if present */
  signature: z.string().optional(),

  /** Signature algorithm */
  signature_algorithm: z.string().optional(),

  /** Connector metadata */
  connector_metadata: z.object({
    connector_id: z.string(),
    connector_version: z.string(),
    environment: z.enum(['development', 'staging', 'production']).optional(),
  }).optional(),
});

export type ExternalEventInput = z.infer<typeof ExternalEventInputSchema>;

/**
 * Canonical event output schema
 */
export const CanonicalEventOutputSchema = z.object({
  /** Unique event identifier */
  id: z.string().uuid(),

  /** Canonical event type */
  type: CanonicalEventTypeSchema,

  /** Source information */
  source: z.object({
    format: ExternalFormatSchema,
    system: z.string(),
    connector: z.string(),
    version: z.string(),
    region: z.string().optional(),
  }),

  /** Event timestamp in UTC */
  timestamp: z.string().datetime(),

  /** Normalized event data */
  data: z.record(z.unknown()),

  /** Correlation ID for tracing */
  correlation_id: z.string().optional(),

  /** ID of the event that caused this event */
  causation_id: z.string().optional(),

  /** Schema version of the canonical format */
  schema_version: z.string(),

  /** Validation results */
  validation: z.object({
    validated: z.boolean(),
    validator_version: z.string().optional(),
    validation_timestamp: z.string().datetime().optional(),
    errors: z.array(z.object({
      path: z.string(),
      message: z.string(),
      code: z.string(),
    })).optional(),
  }),

  /** Normalization metadata */
  normalization: z.object({
    source_format: ExternalFormatSchema,
    target_type: CanonicalEventTypeSchema,
    field_mappings: z.array(z.object({
      source_path: z.string(),
      target_path: z.string(),
      transformation: z.string().optional(),
    })),
    dropped_fields: z.array(z.string()).optional(),
    enriched_fields: z.array(z.string()).optional(),
    warnings: z.array(z.string()).optional(),
    processing_time_ms: z.number(),
  }),
});

export type CanonicalEventOutput = z.infer<typeof CanonicalEventOutputSchema>;

/**
 * Normalization configuration
 */
export const NormalizationConfigSchema = z.object({
  /** Enable strict validation (fail on unknown fields) */
  strict_validation: z.boolean().default(false),

  /** Maximum payload size in bytes */
  max_payload_bytes: z.number().default(10 * 1024 * 1024),

  /** Include dropped fields in output */
  include_dropped_fields: z.boolean().default(true),

  /** Include field mappings in output */
  include_field_mappings: z.boolean().default(true),

  /** Custom field transformations */
  custom_transformations: z.record(z.string()).optional(),
});

export type NormalizationConfig = z.infer<typeof NormalizationConfigSchema>;

/**
 * Field mapping definition
 */
export interface FieldMapping {
  source_path: string;
  target_path: string;
  transformation?: string;
  required?: boolean;
}

/**
 * Transformation function type
 */
export type TransformFn = (value: unknown, context: TransformContext) => unknown;

/**
 * Transform context
 */
export interface TransformContext {
  format: ExternalFormat;
  raw_payload: unknown;
  headers?: Record<string, string>;
  timestamp: string;
}

/**
 * Normalizer interface for specific formats
 */
export interface IFormatNormalizer {
  /** Supported format */
  readonly format: ExternalFormat;

  /** Normalize external event to canonical format */
  normalize(
    input: ExternalEventInput,
    config: NormalizationConfig
  ): Promise<CanonicalEventOutput>;

  /** Detect canonical event type from raw payload */
  detectEventType(payload: unknown): CanonicalEventType;

  /** Get field mappings for this format */
  getFieldMappings(): FieldMapping[];
}
