import { z } from 'zod';

/**
 * Source event type enumeration.
 */
export const SourceEventTypeSchema = z.enum([
  'database_query_result',
  'erp_surface_event',
  'webhook_ingest_event',
  'api_response',
  'custom',
]);

export type SourceEventType = z.infer<typeof SourceEventTypeSchema>;

/**
 * Normalization strategy enumeration.
 */
export const NormalizationStrategySchema = z.enum([
  'json_path',
  'jq_transform',
  'custom_script',
  'schema_mapping',
]);

export type NormalizationStrategy = z.infer<typeof NormalizationStrategySchema>;

/**
 * Schema mapping configuration.
 */
export const SchemaMappingSchema = z.object({
  /**
   * Source field to target field mappings.
   */
  field_mappings: z.array(z.object({
    source_path: z.string().describe('JSONPath or dot notation to source field'),
    target_field: z.string().describe('Target normalized field name'),
    transform: z.enum(['none', 'uppercase', 'lowercase', 'trim', 'date_iso8601', 'number', 'boolean', 'custom'])
      .default('none')
      .describe('Transformation to apply'),
    default_value: z.unknown().optional().describe('Default value if source missing'),
  })).describe('Field mapping definitions'),

  /**
   * Custom transformation script reference.
   */
  custom_transform_reference: z.string()
    .optional()
    .describe('Reference to custom transformation script'),
});

export type SchemaMapping = z.infer<typeof SchemaMappingSchema>;

/**
 * Input schema for Normalizer Agent.
 * Defines the contract for normalizing heterogeneous events.
 */
export const NormalizerInputSchema = z.object({
  /**
   * Source event type.
   */
  source_event_type: SourceEventTypeSchema
    .describe('Type of source event'),

  /**
   * Source event data (raw).
   */
  source_data: z.record(z.unknown())
    .describe('Source event data'),

  /**
   * Normalization strategy to use.
   */
  strategy: NormalizationStrategySchema
    .describe('Normalization strategy'),

  /**
   * Schema mapping configuration (for schema_mapping strategy).
   */
  schema_mapping: SchemaMappingSchema
    .optional()
    .describe('Schema mapping configuration'),

  /**
   * JQ transform expression (for jq_transform strategy).
   */
  jq_expression: z.string()
    .optional()
    .describe('JQ transform expression'),

  /**
   * Custom script reference (for custom_script strategy).
   */
  custom_script_reference: z.string()
    .optional()
    .describe('Custom script environment variable reference'),

  /**
   * Target schema version.
   */
  target_schema_version: z.string()
    .default('1.0.0')
    .describe('Target normalized schema version'),

  /**
   * Validation strictness.
   */
  validation_mode: z.enum(['strict', 'lenient', 'none'])
    .default('strict')
    .describe('Validation strictness mode'),
});

export type NormalizerInput = z.infer<typeof NormalizerInputSchema>;

/**
 * Normalized event schema.
 * Standard structure for all normalized events.
 */
export const NormalizedEventSchema = z.object({
  /**
   * Unique event identifier.
   */
  event_id: z.string()
    .describe('Unique event identifier'),

  /**
   * Event type (normalized taxonomy).
   */
  event_type: z.string()
    .describe('Normalized event type'),

  /**
   * Event timestamp (ISO 8601 UTC).
   */
  timestamp: z.string()
    .datetime()
    .describe('Event timestamp'),

  /**
   * Source system identifier.
   */
  source: z.object({
    system_type: z.string().describe('Source system type'),
    system_id: z.string().describe('Source system identifier'),
    event_type: SourceEventTypeSchema.describe('Original event type'),
  }).describe('Source information'),

  /**
   * Normalized entity data.
   */
  entity: z.object({
    id: z.string().describe('Entity identifier'),
    type: z.string().describe('Entity type'),
    attributes: z.record(z.unknown()).describe('Entity attributes'),
  }).describe('Normalized entity'),

  /**
   * Related entities (optional).
   */
  related_entities: z.array(z.object({
    id: z.string().describe('Related entity ID'),
    type: z.string().describe('Related entity type'),
    relationship: z.string().describe('Relationship type'),
  })).optional().describe('Related entities'),

  /**
   * Event metadata.
   */
  metadata: z.object({
    schema_version: z.string().describe('Normalized schema version'),
    confidence: z.number().min(0).max(1).optional().describe('Normalization confidence'),
    tags: z.array(z.string()).optional().describe('Event tags'),
    custom: z.record(z.unknown()).optional().describe('Custom metadata'),
  }).describe('Event metadata'),
});

export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;

/**
 * Normalization statistics.
 */
export const NormalizationStatsSchema = z.object({
  /**
   * Number of fields mapped.
   */
  fields_mapped: z.number()
    .int()
    .min(0)
    .describe('Number of fields successfully mapped'),

  /**
   * Number of fields with default values applied.
   */
  fields_defaulted: z.number()
    .int()
    .min(0)
    .describe('Number of fields using default values'),

  /**
   * Number of fields that failed mapping.
   */
  fields_failed: z.number()
    .int()
    .min(0)
    .describe('Number of fields that failed mapping'),

  /**
   * Processing time in milliseconds.
   */
  processing_time_ms: z.number()
    .min(0)
    .describe('Processing time in milliseconds'),
});

export type NormalizationStats = z.infer<typeof NormalizationStatsSchema>;

/**
 * Output schema for Normalizer Agent.
 * Contains normalized event and transformation metadata.
 */
export const NormalizerOutputSchema = z.object({
  /**
   * Normalized event.
   */
  normalized_event: NormalizedEventSchema
    .describe('Normalized event'),

  /**
   * Normalization statistics.
   */
  stats: NormalizationStatsSchema
    .describe('Normalization statistics'),

  /**
   * Validation warnings.
   */
  warnings: z.array(z.object({
    field: z.string().describe('Field name'),
    message: z.string().describe('Warning message'),
  })).optional().describe('Validation warnings'),

  /**
   * Transformation errors (if validation_mode is lenient).
   */
  errors: z.array(z.object({
    field: z.string().describe('Field name'),
    error: z.string().describe('Error message'),
  })).optional().describe('Transformation errors'),
});

export type NormalizerOutput = z.infer<typeof NormalizerOutputSchema>;

/**
 * Complete Normalizer Agent contract.
 */
export const NormalizerContractSchema = z.object({
  input: NormalizerInputSchema,
  output: NormalizerOutputSchema,
});

export type NormalizerContract = z.infer<typeof NormalizerContractSchema>;

/**
 * CLI invocation shape for Normalizer Agent.
 *
 * @example
 * ```bash
 * normalizer-agent \
 *   --source-event-type database_query_result \
 *   --source-data '{"user_id": 123, "name": "John"}' \
 *   --strategy schema_mapping \
 *   --schema-mapping '{"field_mappings": [...]}' \
 *   --target-schema-version 1.0.0
 * ```
 */
export const NormalizerCLISchema = z.object({
  'source-event-type': SourceEventTypeSchema.describe('Source event type'),
  'source-data': z.string().describe('JSON string of source data'),
  strategy: NormalizationStrategySchema.describe('Normalization strategy'),
  'schema-mapping': z.string().optional().describe('JSON string of schema mapping'),
  'jq-expression': z.string().optional().describe('JQ transform expression'),
  'custom-script-reference': z.string().optional().describe('Custom script reference'),
  'target-schema-version': z.string().optional().describe('Target schema version'),
  'validation-mode': z.enum(['strict', 'lenient', 'none']).optional().describe('Validation mode'),
});

export type NormalizerCLI = z.infer<typeof NormalizerCLISchema>;

/**
 * Validates normalizer input.
 */
export function validateNormalizerInput(data: unknown): NormalizerInput {
  return NormalizerInputSchema.parse(data);
}

/**
 * Validates normalizer output.
 */
export function validateNormalizerOutput(data: unknown): NormalizerOutput {
  return NormalizerOutputSchema.parse(data);
}

/**
 * Safely validates normalizer input.
 */
export function safeValidateNormalizerInput(data: unknown) {
  return NormalizerInputSchema.safeParse(data);
}

/**
 * Safely validates normalizer output.
 */
export function safeValidateNormalizerOutput(data: unknown) {
  return NormalizerOutputSchema.safeParse(data);
}
