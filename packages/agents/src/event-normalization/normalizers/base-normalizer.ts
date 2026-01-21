/**
 * Base Normalizer
 *
 * Abstract base class for format-specific normalizers.
 * Provides common normalization utilities.
 */

import type {
  ExternalEventInput,
  CanonicalEventOutput,
  CanonicalEventType,
  NormalizationConfig,
  FieldMapping,
  TransformContext,
  IFormatNormalizer,
  ExternalFormat,
} from '../types.js';

/**
 * Abstract base normalizer
 */
export abstract class BaseNormalizer implements IFormatNormalizer {
  abstract readonly format: ExternalFormat;

  /**
   * Normalize external event to canonical format
   */
  async normalize(
    input: ExternalEventInput,
    config: NormalizationConfig
  ): Promise<CanonicalEventOutput> {
    const startTime = Date.now();
    const eventType = this.detectEventType(input.raw_payload);
    const fieldMappings = this.getFieldMappings();

    const context: TransformContext = {
      format: input.format,
      raw_payload: input.raw_payload,
      headers: input.headers,
      timestamp: input.received_at ?? new Date().toISOString(),
    };

    // Apply field mappings
    const { data, droppedFields, appliedMappings, warnings } = this.applyFieldMappings(
      input.raw_payload as Record<string, unknown>,
      fieldMappings,
      context,
      config
    );

    // Validate normalized data
    const validationResult = this.validateNormalizedData(data, eventType, config);

    const processingTimeMs = Date.now() - startTime;

    return {
      id: crypto.randomUUID(),
      type: eventType,
      source: {
        format: input.format,
        system: this.getSystemName(input),
        connector: input.connector_metadata?.connector_id ?? 'unknown',
        version: input.connector_metadata?.connector_version ?? '1.0.0',
        region: this.extractRegion(input),
      },
      timestamp: input.received_at ?? new Date().toISOString(),
      data,
      correlation_id: this.extractCorrelationId(input),
      schema_version: '1.0.0',
      validation: {
        validated: validationResult.valid,
        validator_version: '1.0.0',
        validation_timestamp: new Date().toISOString(),
        errors: validationResult.errors,
      },
      normalization: {
        source_format: input.format,
        target_type: eventType,
        field_mappings: config.include_field_mappings ? appliedMappings : [],
        dropped_fields: config.include_dropped_fields ? droppedFields : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
        processing_time_ms: processingTimeMs,
      },
    };
  }

  /**
   * Detect canonical event type from raw payload
   */
  abstract detectEventType(payload: unknown): CanonicalEventType;

  /**
   * Get field mappings for this format
   */
  abstract getFieldMappings(): FieldMapping[];

  /**
   * Get system name from input
   */
  protected abstract getSystemName(input: ExternalEventInput): string;

  /**
   * Apply field mappings to transform data
   */
  protected applyFieldMappings(
    source: Record<string, unknown>,
    mappings: FieldMapping[],
    context: TransformContext,
    config: NormalizationConfig
  ): {
    data: Record<string, unknown>;
    droppedFields: string[];
    appliedMappings: Array<{ source_path: string; target_path: string; transformation?: string }>;
    warnings: string[];
  } {
    const data: Record<string, unknown> = {};
    const droppedFields: string[] = [];
    const appliedMappings: Array<{ source_path: string; target_path: string; transformation?: string }> = [];
    const warnings: string[] = [];
    const mappedPaths = new Set<string>();

    // Apply each mapping
    for (const mapping of mappings) {
      const value = this.getNestedValue(source, mapping.source_path);

      if (value === undefined) {
        if (mapping.required) {
          warnings.push(`Required field missing: ${mapping.source_path}`);
        }
        continue;
      }

      // Apply transformation if specified
      const transformedValue = mapping.transformation
        ? this.applyTransformation(value, mapping.transformation, context, config)
        : value;

      // Set in target
      this.setNestedValue(data, mapping.target_path, transformedValue);
      mappedPaths.add(mapping.source_path);
      appliedMappings.push({
        source_path: mapping.source_path,
        target_path: mapping.target_path,
        transformation: mapping.transformation,
      });
    }

    // Find dropped fields (fields in source not mapped)
    const allSourcePaths = this.getAllPaths(source);
    for (const path of allSourcePaths) {
      if (!mappedPaths.has(path)) {
        droppedFields.push(path);
      }
    }

    return { data, droppedFields, appliedMappings, warnings };
  }

  /**
   * Get nested value from object using dot notation
   */
  protected getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Set nested value in object using dot notation
   */
  protected setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (part === undefined) continue;

      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    const lastPart = parts[parts.length - 1];
    if (lastPart !== undefined) {
      current[lastPart] = value;
    }
  }

  /**
   * Get all paths in an object
   */
  protected getAllPaths(obj: Record<string, unknown>, prefix = ''): string[] {
    const paths: string[] = [];

    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        paths.push(...this.getAllPaths(value as Record<string, unknown>, path));
      } else {
        paths.push(path);
      }
    }

    return paths;
  }

  /**
   * Apply a transformation to a value
   */
  protected applyTransformation(
    value: unknown,
    transformation: string,
    context: TransformContext,
    config: NormalizationConfig
  ): unknown {
    // Check for custom transformations
    const customTransform = config.custom_transformations?.[transformation];
    if (customTransform) {
      try {
        return new Function('value', 'context', customTransform)(value, context);
      } catch {
        return value;
      }
    }

    // Built-in transformations
    switch (transformation) {
      case 'to_string':
        return String(value);
      case 'to_number':
        return Number(value);
      case 'to_boolean':
        return Boolean(value);
      case 'to_lowercase':
        return typeof value === 'string' ? value.toLowerCase() : value;
      case 'to_uppercase':
        return typeof value === 'string' ? value.toUpperCase() : value;
      case 'trim':
        return typeof value === 'string' ? value.trim() : value;
      case 'to_iso_date':
        if (value instanceof Date) return value.toISOString();
        // Handle Unix timestamp (seconds) - multiply by 1000 for milliseconds
        if (typeof value === 'number') {
          const ms = value < 1e12 ? value * 1000 : value;
          return new Date(ms).toISOString();
        }
        return new Date(String(value)).toISOString();
      case 'to_unix_timestamp':
        if (value instanceof Date) return value.getTime();
        // Handle Unix timestamp (seconds) - multiply by 1000 for milliseconds
        if (typeof value === 'number') {
          const ms = value < 1e12 ? value * 1000 : value;
          return new Date(ms).getTime();
        }
        return new Date(String(value)).getTime();
      case 'json_parse':
        return typeof value === 'string' ? JSON.parse(value) : value;
      case 'json_stringify':
        return JSON.stringify(value);
      case 'base64_decode':
        return typeof value === 'string' ? Buffer.from(value, 'base64').toString('utf8') : value;
      case 'base64_encode':
        return typeof value === 'string' ? Buffer.from(value).toString('base64') : value;
      default:
        return value;
    }
  }

  /**
   * Validate normalized data
   */
  protected validateNormalizedData(
    data: Record<string, unknown>,
    eventType: CanonicalEventType,
    config: NormalizationConfig
  ): { valid: boolean; errors?: Array<{ path: string; message: string; code: string }> } {
    const errors: Array<{ path: string; message: string; code: string }> = [];

    // Check payload size
    const payloadSize = JSON.stringify(data).length;
    if (payloadSize > config.max_payload_bytes) {
      errors.push({
        path: '$',
        message: `Payload size ${payloadSize} exceeds maximum ${config.max_payload_bytes}`,
        code: 'PAYLOAD_TOO_LARGE',
      });
    }

    // Format-specific validation
    const formatErrors = this.validateFormatSpecific(data, eventType);
    errors.push(...formatErrors);

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Format-specific validation (override in subclasses)
   */
  protected validateFormatSpecific(
    _data: Record<string, unknown>,
    _eventType: CanonicalEventType
  ): Array<{ path: string; message: string; code: string }> {
    return [];
  }

  /**
   * Extract correlation ID from input
   */
  protected extractCorrelationId(input: ExternalEventInput): string | undefined {
    const headers = input.headers ?? {};
    const correlationHeaders = [
      'x-correlation-id',
      'x-request-id',
      'x-trace-id',
      'correlation-id',
      'request-id',
      'trace-id',
    ];

    for (const header of correlationHeaders) {
      const value = headers[header] ?? headers[header.toLowerCase()];
      if (value) return value;
    }

    return undefined;
  }

  /**
   * Extract region from input
   */
  protected extractRegion(input: ExternalEventInput): string | undefined {
    const headers = input.headers ?? {};
    const regionHeaders = ['x-region', 'x-aws-region', 'x-gcp-region', 'x-azure-region'];

    for (const header of regionHeaders) {
      const value = headers[header] ?? headers[header.toLowerCase()];
      if (value) return value;
    }

    return undefined;
  }
}
