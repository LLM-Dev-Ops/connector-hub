import { z } from 'zod';

/**
 * Webhook source types
 */
export const WebhookSourceTypeSchema = z.enum([
  'github',
  'stripe',
  'slack',
  'twilio',
  'sendgrid',
  'custom',
]);

export type WebhookSourceType = z.infer<typeof WebhookSourceTypeSchema>;

/**
 * Webhook received event schema (canonical format)
 */
export const WebhookReceivedEventSchema = z.object({
  source_type: WebhookSourceTypeSchema,
  event_type: z.string().describe('Provider-specific event type (e.g., "push", "payment.succeeded")'),
  delivery_id: z.string().optional(),
  payload: z.record(z.unknown()),
  headers: z.record(z.string()),
  signature_valid: z.boolean().nullable(),
  received_at: z.string().datetime(),
  source_ip: z.string().optional(),
  user_agent: z.string().optional(),
});

export type WebhookReceivedEvent = z.infer<typeof WebhookReceivedEventSchema>;

/**
 * GitHub webhook payload schema
 */
export const GitHubWebhookPayloadSchema = z.object({
  action: z.string().optional(),
  repository: z.object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
    owner: z.object({
      login: z.string(),
      id: z.number(),
    }),
  }).optional(),
  sender: z.object({
    login: z.string(),
    id: z.number(),
  }).optional(),
  installation: z.object({
    id: z.number(),
  }).optional(),
}).passthrough();

export type GitHubWebhookPayload = z.infer<typeof GitHubWebhookPayloadSchema>;

/**
 * Stripe webhook payload schema
 */
export const StripeWebhookPayloadSchema = z.object({
  id: z.string(),
  object: z.literal('event'),
  type: z.string(),
  data: z.object({
    object: z.record(z.unknown()),
    previous_attributes: z.record(z.unknown()).optional(),
  }),
  livemode: z.boolean(),
  created: z.number(),
  api_version: z.string().optional(),
}).passthrough();

export type StripeWebhookPayload = z.infer<typeof StripeWebhookPayloadSchema>;

/**
 * Generic webhook payload schema (for custom webhooks)
 */
export const GenericWebhookPayloadSchema = z.record(z.unknown());

export type GenericWebhookPayload = z.infer<typeof GenericWebhookPayloadSchema>;

/**
 * Webhook validation result
 */
export const WebhookValidationResultSchema = z.object({
  valid: z.boolean(),
  source_type: WebhookSourceTypeSchema,
  signature_algorithm: z.string().optional(),
  validation_error: z.string().optional(),
  validated_at: z.string().datetime(),
});

export type WebhookValidationResult = z.infer<typeof WebhookValidationResultSchema>;
