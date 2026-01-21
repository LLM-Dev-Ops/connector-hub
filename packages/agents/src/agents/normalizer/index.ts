/**
 * Data Normalizer Agent
 *
 * PURPOSE: Normalize heterogeneous external payloads to canonical schemas
 *
 * RESPONSIBILITIES:
 * - Transform data formats (JSON, XML, CSV, etc.)
 * - Map fields from source to target schemas
 * - Apply data type conversions
 * - Validate against canonical schemas
 * - Emit normalized_event DecisionEvents
 *
 * CLASSIFICATION: DATA TRANSFORMATION / NORMALIZATION AGENT
 *
 * SCOPE:
 * - Read-only transformations
 * - Schema mapping and validation
 * - Format conversions
 * - Data quality assessment
 *
 * CONSTRAINTS:
 * - MUST NOT modify source data
 * - MUST NOT execute business logic
 * - MUST NOT trigger workflows
 * - Confidence based on mapping completeness and validation success
 */

import { z } from 'zod';
import { BaseAgent } from '../../shared/BaseAgent.js';
import {
  type Confidence,
  type ConstraintsApplied,
  type BaseAgentConfig,
  computeInputsHash,
} from '../../contracts/index.js';

// ============================================================================
// Normalizer Schemas
// ============================================================================

/**
 * Supported source formats
 */
export const SourceFormatSchema = z.enum([
  'json',
  'xml',
  'csv',
  'yaml',
  'form_encoded',
  'custom',
]);

export type SourceFormat = z.infer<typeof SourceFormatSchema>;

/**
 * Field transformation types
 */
export const TransformationTypeSchema = z.enum([
  'direct_map',
  'concat',
  'split',
  'format_date',
  'format_number',
  'format_currency',
  'uppercase',
  'lowercase',
  'trim',
  'default_value',
  'conditional',
  'lookup',
  'custom',
]);

export type TransformationType = z.infer<typeof TransformationTypeSchema>;

/**
 * Field mapping configuration
 */
export const FieldMappingSchema = z.object({
  /** Source field path (dot notation) */
  source_path: z.string(),

  /** Target field path (dot notation) */
  target_path: z.string(),

  /** Transformation type */
  transformation: TransformationTypeSchema,

  /** Transformation parameters */
  params: z.record(z.unknown()).optional(),

  /** Required field */
  required: z.boolean().default(false),

  /** Default value if source is missing */
  default_value: z.unknown().optional(),

  /** Validation rule (Zod schema as JSON) */
  validation: z.record(z.unknown()).optional(),
});

export type FieldMapping = z.infer<typeof FieldMappingSchema>;

/**
 * Schema mapping configuration
 */
export const SchemaMappingSchema = z.object({
  /** Mapping identifier */
  mapping_id: z.string(),

  /** Source schema identifier */
  source_schema: z.string(),

  /** Target schema identifier */
  target_schema: z.string(),

  /** Version of the mapping */
  version: z.string().default('1.0.0'),

  /** Field mappings */
  field_mappings: z.array(FieldMappingSchema),

  /** Metadata about the mapping */
  metadata: z.record(z.unknown()).optional(),
});

export type SchemaMapping = z.infer<typeof SchemaMappingSchema>;

/**
 * Normalization request schema
 */
export const NormalizationRequestSchema = z.object({
  /** Source data format */
  source_format: SourceFormatSchema,

  /** Source data payload */
  source_data: z.record(z.unknown()),

  /** Schema mapping to apply */
  schema_mapping: SchemaMappingSchema,

  /** Validation mode */
  validation_mode: z.enum(['strict', 'lenient', 'none']).default('strict'),

  /** Include source data in output */
  include_source: z.boolean().default(false),
});

export type NormalizationRequest = z.infer<typeof NormalizationRequestSchema>;

/**
 * Normalization result schema
 */
export const NormalizationResultSchema = z.object({
  /** Normalized data */
  normalized_data: z.record(z.unknown()),

  /** Original source data hash */
  source_data_hash: z.string(),

  /** Schema mapping applied */
  mapping_applied: z.object({
    mapping_id: z.string(),
    version: z.string(),
    source_schema: z.string(),
    target_schema: z.string(),
  }),

  /** Mapping statistics */
  mapping_stats: z.object({
    total_fields: z.number(),
    mapped_fields: z.number(),
    missing_required_fields: z.array(z.string()),
    validation_errors: z.array(
      z.object({
        field: z.string(),
        error: z.string(),
      }),
    ),
  }),

  /** Data quality score (0-1) */
  quality_score: z.number().min(0).max(1),

  /** Original source data (if requested) */
  source_data: z.record(z.unknown()).optional(),
});

export type NormalizationResult = z.infer<typeof NormalizationResultSchema>;

/**
 * Data Normalizer Agent configuration
 */
export const NormalizerAgentConfigSchema = z
  .object({
    /** Allowed source formats */
    allowed_source_formats: z.array(SourceFormatSchema).optional(),

    /** Default validation mode */
    default_validation_mode: z
      .enum(['strict', 'lenient', 'none'])
      .default('strict'),

    /** Enable data quality scoring */
    enable_quality_scoring: z.boolean().default(true),

    /** Connector scope identifier */
    connector_scope: z.string().min(1),
  })
  .passthrough();

export type NormalizerAgentConfig = z.infer<typeof NormalizerAgentConfigSchema> &
  BaseAgentConfig;

// ============================================================================
// Data Normalizer Agent Implementation
// ============================================================================

export class DataNormalizerAgent extends BaseAgent {
  private readonly normalizerConfig: NormalizerAgentConfig;

  constructor(config: NormalizerAgentConfig) {
    super('data-normalizer-agent', '1.0.0', 'normalized_event', config);
    this.normalizerConfig = config;
  }

  protected async validateInput(input: unknown): Promise<{
    valid: boolean;
    error?: string;
    duration_ms?: number;
  }> {
    const startTime = Date.now();

    try {
      const parsed = NormalizationRequestSchema.parse(input);

      // Check if source format is allowed
      if (
        this.normalizerConfig.allowed_source_formats &&
        !this.normalizerConfig.allowed_source_formats.includes(parsed.source_format)
      ) {
        return {
          valid: false,
          error: `Source format ${parsed.source_format} is not allowed`,
          duration_ms: Date.now() - startTime,
        };
      }

      return {
        valid: true,
        duration_ms: Date.now() - startTime,
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Invalid normalization request',
        duration_ms: Date.now() - startTime,
      };
    }
  }

  protected async executeProcessing(input: unknown): Promise<{
    outputs: Record<string, unknown>;
    confidence: Confidence;
    constraintsApplied: ConstraintsApplied;
    metadata?: Record<string, unknown>;
  }> {
    const normalizationRequest = NormalizationRequestSchema.parse(input);

    // Perform normalization
    const normalizationResult = await this.normalizeData(normalizationRequest);

    // Check if normalization was successful
    const hasErrors = normalizationResult.mapping_stats.validation_errors.length > 0;
    const hasMissingRequired =
      normalizationResult.mapping_stats.missing_required_fields.length > 0;

    if (
      normalizationRequest.validation_mode === 'strict' &&
      (hasErrors || hasMissingRequired)
    ) {
      const errors = [
        ...normalizationResult.mapping_stats.validation_errors.map((e) => e.error),
        ...normalizationResult.mapping_stats.missing_required_fields.map(
          (f) => `Missing required field: ${f}`,
        ),
      ];
      throw new Error(`Normalization failed: ${errors.join(', ')}`);
    }

    // Calculate confidence
    const mappingCompleteness =
      normalizationResult.mapping_stats.total_fields > 0
        ? normalizationResult.mapping_stats.mapped_fields /
          normalizationResult.mapping_stats.total_fields
        : 0;

    const confidence: Confidence = {
      score: this.computeConfidenceScore(
        mappingCompleteness,
        normalizationResult.quality_score,
      ),
      payload_completeness: mappingCompleteness,
      normalization_certainty: hasErrors ? 0.7 : 1.0,
      schema_validation: hasErrors ? 'partial' : 'passed',
    };

    // Build constraints
    const constraintsApplied: ConstraintsApplied = {
      connector_scope: this.normalizerConfig.connector_scope,
      schema_boundaries: [
        `source:${normalizationRequest.schema_mapping.source_schema}`,
        `target:${normalizationRequest.schema_mapping.target_schema}`,
        `mapping:${normalizationRequest.schema_mapping.mapping_id}`,
      ],
      timeout_ms: this.config.timeout_ms,
    };

    return {
      outputs: normalizationResult,
      confidence,
      constraintsApplied,
      metadata: {
        source_format: normalizationRequest.source_format,
        validation_mode: normalizationRequest.validation_mode,
        mapping_version: normalizationRequest.schema_mapping.version,
      },
    };
  }

  /**
   * Normalize data according to schema mapping
   */
  private async normalizeData(
    request: NormalizationRequest,
  ): Promise<NormalizationResult> {
    const normalizedData: Record<string, unknown> = {};
    const validationErrors: Array<{ field: string; error: string }> = [];
    const missingRequiredFields: string[] = [];
    let mappedFieldCount = 0;

    // Apply each field mapping
    for (const mapping of request.schema_mapping.field_mappings) {
      try {
        // Get source value
        const sourceValue = this.getNestedValue(
          request.source_data,
          mapping.source_path,
        );

        // Check if required field is missing
        if (mapping.required && (sourceValue === undefined || sourceValue === null)) {
          missingRequiredFields.push(mapping.target_path);
          continue;
        }

        // Apply default value if needed
        const valueToTransform =
          sourceValue !== undefined && sourceValue !== null
            ? sourceValue
            : mapping.default_value;

        // Skip if no value and not required
        if (valueToTransform === undefined && !mapping.required) {
          continue;
        }

        // Apply transformation
        const transformedValue = this.applyTransformation(
          valueToTransform,
          mapping.transformation,
          mapping.params,
        );

        // Set in normalized data
        this.setNestedValue(normalizedData, mapping.target_path, transformedValue);
        mappedFieldCount++;
      } catch (error) {
        validationErrors.push({
          field: mapping.target_path,
          error: error instanceof Error ? error.message : 'Transformation failed',
        });
      }
    }

    // Calculate quality score
    const qualityScore = this.normalizerConfig.enable_quality_scoring
      ? this.calculateQualityScore(
          normalizedData,
          mappedFieldCount,
          request.schema_mapping.field_mappings.length,
          validationErrors.length,
        )
      : 1.0;

    return {
      normalized_data: normalizedData,
      source_data_hash: computeInputsHash(request.source_data),
      mapping_applied: {
        mapping_id: request.schema_mapping.mapping_id,
        version: request.schema_mapping.version,
        source_schema: request.schema_mapping.source_schema,
        target_schema: request.schema_mapping.target_schema,
      },
      mapping_stats: {
        total_fields: request.schema_mapping.field_mappings.length,
        mapped_fields: mappedFieldCount,
        missing_required_fields: missingRequiredFields,
        validation_errors: validationErrors,
      },
      quality_score: qualityScore,
      source_data: request.include_source ? request.source_data : undefined,
    };
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce((current: any, key) => current?.[key], obj);
  }

  /**
   * Set nested value in object using dot notation
   */
  private setNestedValue(
    obj: Record<string, unknown>,
    path: string,
    value: unknown,
  ): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    const target = keys.reduce((current: any, key) => {
      if (!(key in current)) {
        current[key] = {};
      }
      return current[key];
    }, obj);
    target[lastKey] = value;
  }

  /**
   * Apply transformation to value
   */
  private applyTransformation(
    value: unknown,
    transformation: TransformationType,
    params?: Record<string, unknown>,
  ): unknown {
    switch (transformation) {
      case 'direct_map':
        return value;

      case 'uppercase':
        return typeof value === 'string' ? value.toUpperCase() : value;

      case 'lowercase':
        return typeof value === 'string' ? value.toLowerCase() : value;

      case 'trim':
        return typeof value === 'string' ? value.trim() : value;

      case 'format_date':
        if (typeof value === 'string') {
          const date = new Date(value);
          return date.toISOString();
        }
        return value;

      case 'format_number':
        if (typeof value === 'string') {
          const num = parseFloat(value);
          return isNaN(num) ? value : num;
        }
        return value;

      case 'concat':
        if (params?.separator && Array.isArray(value)) {
          return value.join(params.separator as string);
        }
        return value;

      case 'split':
        if (typeof value === 'string' && params?.separator) {
          return value.split(params.separator as string);
        }
        return value;

      case 'default_value':
        return value !== undefined && value !== null ? value : params?.value;

      default:
        return value;
    }
  }

  /**
   * Calculate data quality score
   */
  private calculateQualityScore(
    normalizedData: Record<string, unknown>,
    mappedFields: number,
    totalFields: number,
    errorCount: number,
  ): number {
    // Mapping completeness
    const completeness = totalFields > 0 ? mappedFields / totalFields : 0;

    // Error penalty
    const errorPenalty = errorCount > 0 ? Math.min(0.5, errorCount * 0.1) : 0;

    // Data richness (non-null values)
    const values = Object.values(normalizedData);
    const nonNullValues = values.filter((v) => v !== null && v !== undefined).length;
    const richness = values.length > 0 ? nonNullValues / values.length : 0;

    // Weighted score
    const score = completeness * 0.5 + richness * 0.3 + (1 - errorPenalty) * 0.2;

    return Math.max(0, Math.min(1, score));
  }
}

/**
 * Factory function to create Data Normalizer Agent
 */
export function createDataNormalizerAgent(
  config: NormalizerAgentConfig,
): DataNormalizerAgent {
  return new DataNormalizerAgent(config);
}
