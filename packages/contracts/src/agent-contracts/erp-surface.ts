import { z } from 'zod';

/**
 * ERP system type enumeration.
 * Supports major ERP platforms.
 */
export const ERPSystemTypeSchema = z.enum([
  'sap',
  'oracle_erp',
  'microsoft_dynamics',
  'netsuite',
  'workday',
  'custom',
]);

export type ERPSystemType = z.infer<typeof ERPSystemTypeSchema>;

/**
 * ERP connection configuration schema.
 * Supports OAuth, API key, and basic authentication.
 */
export const ERPConnectionConfigSchema = z.object({
  /**
   * ERP system type.
   */
  system_type: ERPSystemTypeSchema
    .describe('ERP system type'),

  /**
   * Base URL for ERP API.
   */
  base_url: z.string()
    .url()
    .describe('Base URL for ERP API'),

  /**
   * Authentication configuration.
   */
  auth: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('oauth2'),
      client_id: z.string().describe('OAuth2 client ID reference'),
      token_endpoint: z.string().url().describe('OAuth2 token endpoint'),
      scope: z.array(z.string()).optional().describe('OAuth2 scopes'),
    }),
    z.object({
      type: z.literal('api_key'),
      key_name: z.string().describe('API key header name'),
      key_reference: z.string().describe('API key environment variable reference'),
    }),
    z.object({
      type: z.literal('basic'),
      username_reference: z.string().describe('Username environment variable reference'),
      password_reference: z.string().describe('Password environment variable reference'),
    }),
  ]).describe('Authentication configuration'),

  /**
   * Request timeout in milliseconds.
   */
  timeout_ms: z.number()
    .int()
    .min(0)
    .default(60000)
    .describe('Request timeout in milliseconds'),

  /**
   * Retry configuration.
   */
  retry: z.object({
    max_attempts: z.number().int().min(0).default(3).describe('Maximum retry attempts'),
    backoff_ms: z.number().int().min(0).default(1000).describe('Backoff time in milliseconds'),
  }).optional().describe('Retry configuration'),
});

export type ERPConnectionConfig = z.infer<typeof ERPConnectionConfigSchema>;

/**
 * ERP event type enumeration.
 */
export const ERPEventTypeSchema = z.enum([
  'purchase_order',
  'sales_order',
  'invoice',
  'payment',
  'inventory_change',
  'customer_update',
  'vendor_update',
  'custom',
]);

export type ERPEventType = z.infer<typeof ERPEventTypeSchema>;

/**
 * Input schema for ERP Surface Agent.
 * Defines the contract for surfacing ERP events.
 */
export const ERPSurfaceInputSchema = z.object({
  /**
   * ERP connection configuration.
   */
  connection_config: ERPConnectionConfigSchema
    .describe('ERP connection configuration'),

  /**
   * Event type to surface.
   */
  event_type: ERPEventTypeSchema
    .describe('Type of ERP event to surface'),

  /**
   * Event filters (system-specific).
   */
  filters: z.record(z.unknown())
    .optional()
    .describe('Event filters (system-specific)'),

  /**
   * Date range for event surfacing.
   */
  date_range: z.object({
    start: z.string().datetime().describe('Start datetime (ISO 8601)'),
    end: z.string().datetime().describe('End datetime (ISO 8601)'),
  }).optional().describe('Date range filter'),

  /**
   * Pagination configuration.
   */
  pagination: z.object({
    page: z.number().int().min(1).default(1).describe('Page number'),
    page_size: z.number().int().min(1).max(1000).default(100).describe('Page size'),
  }).optional().describe('Pagination settings'),

  /**
   * Enable incremental sync mode.
   */
  incremental: z.boolean()
    .default(false)
    .describe('Enable incremental sync (only new/changed events)'),

  /**
   * Last sync timestamp for incremental mode.
   */
  last_sync_timestamp: z.string()
    .datetime()
    .optional()
    .describe('Last sync timestamp (for incremental sync)'),
});

export type ERPSurfaceInput = z.infer<typeof ERPSurfaceInputSchema>;

/**
 * ERP event record schema.
 * Represents a single surfaced event from the ERP system.
 */
export const ERPEventRecordSchema = z.object({
  /**
   * Unique event ID from ERP system.
   */
  event_id: z.string()
    .describe('Unique event identifier from ERP'),

  /**
   * Event type.
   */
  event_type: ERPEventTypeSchema
    .describe('Event type'),

  /**
   * Event payload (system-specific structure).
   */
  payload: z.record(z.unknown())
    .describe('Event payload (system-specific)'),

  /**
   * Event timestamp from ERP system.
   */
  timestamp: z.string()
    .datetime()
    .describe('Event timestamp (ISO 8601)'),

  /**
   * Entity ID (e.g., order ID, invoice ID).
   */
  entity_id: z.string()
    .optional()
    .describe('Related entity ID'),

  /**
   * Event status.
   */
  status: z.enum(['active', 'cancelled', 'completed', 'pending'])
    .optional()
    .describe('Event status'),

  /**
   * Custom metadata.
   */
  metadata: z.record(z.unknown())
    .optional()
    .describe('Custom metadata'),
});

export type ERPEventRecord = z.infer<typeof ERPEventRecordSchema>;

/**
 * Output schema for ERP Surface Agent.
 * Contains surfaced events and pagination information.
 */
export const ERPSurfaceOutputSchema = z.object({
  /**
   * Surfaced event records.
   */
  events: z.array(ERPEventRecordSchema)
    .describe('Surfaced ERP events'),

  /**
   * Pagination information.
   */
  pagination: z.object({
    current_page: z.number().int().min(1).describe('Current page number'),
    page_size: z.number().int().min(1).describe('Page size'),
    total_events: z.number().int().min(0).describe('Total number of events'),
    has_more: z.boolean().describe('Whether more pages exist'),
  }).describe('Pagination information'),

  /**
   * Sync metadata.
   */
  sync_metadata: z.object({
    sync_timestamp: z.string().datetime().describe('Current sync timestamp'),
    incremental: z.boolean().describe('Whether this was incremental sync'),
    events_surfaced: z.number().int().min(0).describe('Number of events surfaced'),
  }).describe('Sync metadata'),

  /**
   * Errors encountered during surfacing.
   */
  errors: z.array(z.object({
    error_code: z.string().describe('Error code'),
    message: z.string().describe('Error message'),
    event_id: z.string().optional().describe('Related event ID if applicable'),
  })).optional().describe('Errors encountered'),
});

export type ERPSurfaceOutput = z.infer<typeof ERPSurfaceOutputSchema>;

/**
 * Complete ERP Surface Agent contract.
 */
export const ERPSurfaceContractSchema = z.object({
  input: ERPSurfaceInputSchema,
  output: ERPSurfaceOutputSchema,
});

export type ERPSurfaceContract = z.infer<typeof ERPSurfaceContractSchema>;

/**
 * CLI invocation shape for ERP Surface Agent.
 *
 * @example
 * ```bash
 * erp-surface-agent \
 *   --connection-config '{"system_type": "sap", ...}' \
 *   --event-type purchase_order \
 *   --filters '{"status": "pending"}' \
 *   --incremental true
 * ```
 */
export const ERPSurfaceCLISchema = z.object({
  'connection-config': z.string().describe('JSON string of connection config'),
  'event-type': ERPEventTypeSchema.describe('Event type to surface'),
  filters: z.string().optional().describe('JSON string of event filters'),
  'date-range': z.string().optional().describe('JSON string of date range'),
  pagination: z.string().optional().describe('JSON string of pagination config'),
  incremental: z.boolean().optional().describe('Enable incremental sync'),
  'last-sync-timestamp': z.string().optional().describe('Last sync timestamp'),
});

export type ERPSurfaceCLI = z.infer<typeof ERPSurfaceCLISchema>;

/**
 * Validates ERP surface input.
 */
export function validateERPSurfaceInput(data: unknown): ERPSurfaceInput {
  return ERPSurfaceInputSchema.parse(data);
}

/**
 * Validates ERP surface output.
 */
export function validateERPSurfaceOutput(data: unknown): ERPSurfaceOutput {
  return ERPSurfaceOutputSchema.parse(data);
}

/**
 * Safely validates ERP surface input.
 */
export function safeValidateERPSurfaceInput(data: unknown) {
  return ERPSurfaceInputSchema.safeParse(data);
}

/**
 * Safely validates ERP surface output.
 */
export function safeValidateERPSurfaceOutput(data: unknown) {
  return ERPSurfaceOutputSchema.safeParse(data);
}
