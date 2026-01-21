import { z } from 'zod';

/**
 * External event format types that can be ingested
 */
export const ExternalEventFormatSchema = z.enum([
  'openai_api',
  'anthropic_api',
  'google_ai_api',
  'azure_openai_api',
  'aws_bedrock_api',
  'webhook_generic',
  'webhook_github',
  'webhook_stripe',
  'erp_salesforce',
  'erp_sap',
  'erp_oracle',
  'database_postgres',
  'database_mysql',
  'database_mongodb',
  'identity_oauth2',
  'identity_saml',
  'identity_oidc',
  'custom',
]);

export type ExternalEventFormat = z.infer<typeof ExternalEventFormatSchema>;

/**
 * External event header schema
 */
export const ExternalEventHeadersSchema = z.record(z.string());

export type ExternalEventHeaders = z.infer<typeof ExternalEventHeadersSchema>;

/**
 * External event schema - raw format before normalization
 */
export const ExternalEventSchema = z.object({
  format: ExternalEventFormatSchema,
  raw_payload: z.unknown().describe('Raw payload from external system'),
  headers: ExternalEventHeadersSchema.optional(),
  received_at: z.string().datetime(),
  source_ip: z.string().optional(),
  content_type: z.string().optional(),
  encoding: z.string().optional(),
  signature: z.string().optional().describe('Webhook signature if present'),
  signature_algorithm: z.string().optional(),
});

export type ExternalEvent = z.infer<typeof ExternalEventSchema>;

/**
 * Factory function to create an ExternalEvent
 */
export function createExternalEvent(
  params: Omit<ExternalEvent, 'received_at'> & { received_at?: string }
): ExternalEvent {
  return ExternalEventSchema.parse({
    ...params,
    received_at: params.received_at ?? new Date().toISOString(),
  });
}

/**
 * Validate an ExternalEvent
 */
export function validateExternalEvent(event: unknown): ExternalEvent {
  return ExternalEventSchema.parse(event);
}

/**
 * Normalization result for tracking transformation metadata
 */
export const NormalizationResultSchema = z.object({
  success: z.boolean(),
  source_format: ExternalEventFormatSchema,
  target_event_type: z.string(),
  field_mappings: z.array(z.object({
    source_path: z.string(),
    target_path: z.string(),
    transformation: z.string().optional(),
  })),
  dropped_fields: z.array(z.string()).optional(),
  enriched_fields: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
  processing_time_ms: z.number(),
});

export type NormalizationResult = z.infer<typeof NormalizationResultSchema>;
