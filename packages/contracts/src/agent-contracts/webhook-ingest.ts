import { z } from 'zod';

/**
 * HTTP method enumeration for webhook requests.
 */
export const HTTPMethodSchema = z.enum([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

export type HTTPMethod = z.infer<typeof HTTPMethodSchema>;

/**
 * Webhook signature verification configuration.
 */
export const SignatureVerificationSchema = z.object({
  /**
   * Signature algorithm.
   */
  algorithm: z.enum(['hmac-sha256', 'hmac-sha512', 'rsa-sha256', 'none'])
    .describe('Signature verification algorithm'),

  /**
   * Header name containing signature.
   */
  header_name: z.string()
    .default('X-Signature')
    .describe('HTTP header containing signature'),

  /**
   * Secret key reference for HMAC verification.
   */
  secret_reference: z.string()
    .optional()
    .describe('Secret key environment variable reference (for HMAC)'),

  /**
   * Public key reference for RSA verification.
   */
  public_key_reference: z.string()
    .optional()
    .describe('Public key environment variable reference (for RSA)'),
});

export type SignatureVerification = z.infer<typeof SignatureVerificationSchema>;

/**
 * Input schema for Webhook Ingest Agent.
 * Defines the contract for ingesting webhook events.
 */
export const WebhookIngestInputSchema = z.object({
  /**
   * HTTP method of the webhook request.
   */
  method: HTTPMethodSchema
    .describe('HTTP method'),

  /**
   * Request path (relative to webhook base URL).
   */
  path: z.string()
    .describe('Request path'),

  /**
   * Request headers as key-value pairs.
   */
  headers: z.record(z.string())
    .describe('HTTP headers'),

  /**
   * Query parameters.
   */
  query_params: z.record(z.union([
    z.string(),
    z.array(z.string()),
  ])).optional().describe('Query parameters'),

  /**
   * Request body (raw string or parsed JSON).
   */
  body: z.union([
    z.string(),
    z.record(z.unknown()),
    z.array(z.unknown()),
  ]).optional().describe('Request body'),

  /**
   * Source IP address of the request.
   */
  source_ip: z.string()
    .optional()
    .describe('Source IP address'),

  /**
   * Webhook event timestamp (if provided in payload).
   */
  event_timestamp: z.string()
    .datetime()
    .optional()
    .describe('Event timestamp from webhook payload'),

  /**
   * Signature verification configuration.
   */
  signature_verification: SignatureVerificationSchema
    .optional()
    .describe('Signature verification settings'),

  /**
   * Idempotency key for duplicate detection.
   */
  idempotency_key: z.string()
    .optional()
    .describe('Idempotency key for duplicate detection'),
});

export type WebhookIngestInput = z.infer<typeof WebhookIngestInputSchema>;

/**
 * Webhook validation result.
 */
export const WebhookValidationSchema = z.object({
  /**
   * Whether webhook is valid.
   */
  is_valid: z.boolean()
    .describe('Whether webhook passed validation'),

  /**
   * Signature verification result.
   */
  signature_verified: z.boolean()
    .optional()
    .describe('Whether signature verification passed'),

  /**
   * Schema validation result.
   */
  schema_valid: z.boolean()
    .optional()
    .describe('Whether payload matches expected schema'),

  /**
   * Validation errors.
   */
  errors: z.array(z.object({
    field: z.string().describe('Field name'),
    message: z.string().describe('Error message'),
  })).optional().describe('Validation errors'),
});

export type WebhookValidation = z.infer<typeof WebhookValidationSchema>;

/**
 * Parsed webhook event.
 */
export const ParsedWebhookEventSchema = z.object({
  /**
   * Event ID (extracted or generated).
   */
  event_id: z.string()
    .describe('Unique event identifier'),

  /**
   * Event type (extracted from payload).
   */
  event_type: z.string()
    .describe('Event type'),

  /**
   * Parsed event data.
   */
  data: z.record(z.unknown())
    .describe('Parsed event data'),

  /**
   * Event timestamp.
   */
  timestamp: z.string()
    .datetime()
    .describe('Event timestamp'),

  /**
   * Source system identifier.
   */
  source_system: z.string()
    .optional()
    .describe('Source system identifier'),

  /**
   * Event metadata.
   */
  metadata: z.record(z.unknown())
    .optional()
    .describe('Event metadata'),
});

export type ParsedWebhookEvent = z.infer<typeof ParsedWebhookEventSchema>;

/**
 * Output schema for Webhook Ingest Agent.
 * Contains validation results and parsed event data.
 */
export const WebhookIngestOutputSchema = z.object({
  /**
   * Webhook validation result.
   */
  validation: WebhookValidationSchema
    .describe('Validation result'),

  /**
   * Parsed webhook event (if validation passed).
   */
  event: ParsedWebhookEventSchema
    .optional()
    .describe('Parsed webhook event'),

  /**
   * Whether this is a duplicate event.
   */
  is_duplicate: z.boolean()
    .default(false)
    .describe('Whether event is a duplicate'),

  /**
   * HTTP status code to return to webhook sender.
   */
  response_status: z.number()
    .int()
    .min(200)
    .max(599)
    .describe('HTTP status code to return'),

  /**
   * Response body to return to webhook sender.
   */
  response_body: z.record(z.unknown())
    .optional()
    .describe('Response body to return'),

  /**
   * Processing metadata.
   */
  processing_metadata: z.object({
    received_at: z.string().datetime().describe('Receipt timestamp'),
    processed_at: z.string().datetime().describe('Processing completion timestamp'),
    processing_time_ms: z.number().min(0).describe('Processing time in milliseconds'),
  }).describe('Processing metadata'),
});

export type WebhookIngestOutput = z.infer<typeof WebhookIngestOutputSchema>;

/**
 * Complete Webhook Ingest Agent contract.
 */
export const WebhookIngestContractSchema = z.object({
  input: WebhookIngestInputSchema,
  output: WebhookIngestOutputSchema,
});

export type WebhookIngestContract = z.infer<typeof WebhookIngestContractSchema>;

/**
 * CLI invocation shape for Webhook Ingest Agent.
 *
 * @example
 * ```bash
 * webhook-ingest-agent \
 *   --method POST \
 *   --path /webhooks/stripe \
 *   --headers '{"Content-Type": "application/json"}' \
 *   --body '{"event": "payment.succeeded"}' \
 *   --signature-verification '{"algorithm": "hmac-sha256", "secret_reference": "STRIPE_WEBHOOK_SECRET"}'
 * ```
 */
export const WebhookIngestCLISchema = z.object({
  method: HTTPMethodSchema.describe('HTTP method'),
  path: z.string().describe('Request path'),
  headers: z.string().describe('JSON string of headers'),
  'query-params': z.string().optional().describe('JSON string of query parameters'),
  body: z.string().optional().describe('Request body (JSON string or raw)'),
  'source-ip': z.string().optional().describe('Source IP address'),
  'event-timestamp': z.string().optional().describe('Event timestamp'),
  'signature-verification': z.string().optional().describe('JSON string of signature verification config'),
  'idempotency-key': z.string().optional().describe('Idempotency key'),
});

export type WebhookIngestCLI = z.infer<typeof WebhookIngestCLISchema>;

/**
 * Validates webhook ingest input.
 */
export function validateWebhookIngestInput(data: unknown): WebhookIngestInput {
  return WebhookIngestInputSchema.parse(data);
}

/**
 * Validates webhook ingest output.
 */
export function validateWebhookIngestOutput(data: unknown): WebhookIngestOutput {
  return WebhookIngestOutputSchema.parse(data);
}

/**
 * Safely validates webhook ingest input.
 */
export function safeValidateWebhookIngestInput(data: unknown) {
  return WebhookIngestInputSchema.safeParse(data);
}

/**
 * Safely validates webhook ingest output.
 */
export function safeValidateWebhookIngestOutput(data: unknown) {
  return WebhookIngestOutputSchema.safeParse(data);
}
