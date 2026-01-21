import { z } from 'zod';

/**
 * Canonical event types supported by Connector Hub
 */
export const CanonicalEventTypeSchema = z.enum([
  'llm.completion.request',
  'llm.completion.response',
  'llm.stream.start',
  'llm.stream.chunk',
  'llm.stream.end',
  'llm.error',
  'webhook.received',
  'webhook.validated',
  'erp.record.created',
  'erp.record.updated',
  'erp.record.deleted',
  'database.query.executed',
  'database.result.returned',
  'auth.token.verified',
  'auth.token.refreshed',
  'auth.identity.resolved',
  'connector.health.check',
  'connector.metrics.emitted',
]);

export type CanonicalEventType = z.infer<typeof CanonicalEventTypeSchema>;

/**
 * Event source metadata
 */
export const EventSourceSchema = z.object({
  system: z.string().describe('Source system identifier'),
  connector: z.string().describe('Connector type that produced this event'),
  version: z.string().describe('Version of the source system/connector'),
  region: z.string().optional().describe('Geographic region if applicable'),
});

export type EventSource = z.infer<typeof EventSourceSchema>;

/**
 * Canonical event schema - the normalized internal format
 */
export const CanonicalEventSchema = z.object({
  id: z.string().uuid().describe('Unique event identifier'),
  type: CanonicalEventTypeSchema,
  source: EventSourceSchema,
  timestamp: z.string().datetime().describe('Event timestamp in UTC'),
  data: z.record(z.unknown()).describe('Event payload data'),
  correlation_id: z.string().optional().describe('Correlation ID for tracing'),
  causation_id: z.string().optional().describe('ID of the event that caused this event'),
  schema_version: z.string().describe('Version of the canonical schema'),
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
});

export type CanonicalEvent = z.infer<typeof CanonicalEventSchema>;

/**
 * Factory function to create a CanonicalEvent
 */
export function createCanonicalEvent(
  params: Omit<CanonicalEvent, 'id' | 'timestamp' | 'schema_version'> & {
    id?: string;
    timestamp?: string;
    schema_version?: string;
  }
): CanonicalEvent {
  return CanonicalEventSchema.parse({
    ...params,
    id: params.id ?? crypto.randomUUID(),
    timestamp: params.timestamp ?? new Date().toISOString(),
    schema_version: params.schema_version ?? '1.0.0',
  });
}

/**
 * Validate a CanonicalEvent
 */
export function validateCanonicalEvent(event: unknown): CanonicalEvent {
  return CanonicalEventSchema.parse(event);
}
