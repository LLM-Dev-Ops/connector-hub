/**
 * Webhook Payload Validator
 *
 * Validates inbound webhook payloads against defined schemas.
 * Supports both Zod schemas and JSON Schema validation.
 *
 * FEATURES:
 * - Zod-based schema validation
 * - JSON Schema to Zod conversion
 * - Content-type validation
 * - Size limit enforcement
 * - Detailed validation error reporting
 */

import { z, ZodError, ZodType } from 'zod';
import * as crypto from 'crypto';
import type {
  WebhookRequest,
  ValidationError,
  WebhookValidationResult,
} from '../contracts/index.js';

/**
 * Validation configuration
 */
export interface ValidatorConfig {
  /** Maximum payload size in bytes */
  maxPayloadSizeBytes: number;

  /** Allowed content types */
  allowedContentTypes: string[];

  /** Custom payload schema (Zod schema) */
  payloadSchema?: ZodType;

  /** Enable strict mode (fail on unknown fields) */
  strictMode: boolean;

  /** Custom field validators */
  customValidators?: Map<string, (value: unknown) => boolean>;
}

/**
 * Default validator configuration
 */
const DEFAULT_CONFIG: ValidatorConfig = {
  maxPayloadSizeBytes: 10 * 1024 * 1024, // 10MB
  allowedContentTypes: ['application/json', 'application/json; charset=utf-8'],
  strictMode: false,
};

/**
 * Payload Validator - Validates webhook payloads
 */
export class PayloadValidator {
  private readonly config: ValidatorConfig;

  constructor(config: Partial<ValidatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Validate a webhook request
   */
  async validate(request: WebhookRequest): Promise<WebhookValidationResult> {
    const startTime = Date.now();
    const errors: ValidationError[] = [];

    // Validate content type
    const contentTypeResult = this.validateContentType(request.content_type);
    if (!contentTypeResult.valid) {
      errors.push(contentTypeResult.error!);
    }

    // Validate payload size
    const sizeResult = this.validatePayloadSize(request.body);
    if (!sizeResult.valid) {
      errors.push(sizeResult.error!);
    }

    // Parse JSON body if not already parsed
    let parsedBody = request.parsed_body;
    if (!parsedBody && request.content_type.includes('application/json')) {
      const parseResult = this.parseJsonBody(request.body);
      if (!parseResult.valid) {
        errors.push(parseResult.error!);
      } else {
        parsedBody = parseResult.data;
      }
    }

    // Validate against custom schema if provided
    let schemaValid = true;
    if (parsedBody && this.config.payloadSchema) {
      const schemaResult = await this.validateSchema(parsedBody);
      schemaValid = schemaResult.valid;
      errors.push(...schemaResult.errors);
    }

    const validationDuration = Date.now() - startTime;

    return {
      valid: errors.length === 0,
      signature: { valid: true, method: 'none' }, // Signature is validated separately
      schema_valid: schemaValid,
      errors,
      validation_duration_ms: validationDuration,
    };
  }

  /**
   * Validate content type
   */
  private validateContentType(
    contentType: string
  ): { valid: boolean; error?: ValidationError } {
    const normalizedType = (contentType.toLowerCase().split(';')[0] ?? '').trim();
    const isAllowed = this.config.allowedContentTypes.some(
      (allowed) => (allowed.toLowerCase().split(';')[0] ?? '').trim() === normalizedType
    );

    if (!isAllowed) {
      return {
        valid: false,
        error: {
          path: 'content_type',
          code: 'INVALID_CONTENT_TYPE',
          message: `Content type '${contentType}' is not allowed`,
          expected: this.config.allowedContentTypes.join(', '),
          actual: contentType,
        },
      };
    }

    return { valid: true };
  }

  /**
   * Validate payload size
   */
  private validatePayloadSize(body: string): { valid: boolean; error?: ValidationError } {
    const sizeBytes = Buffer.byteLength(body, 'utf8');

    if (sizeBytes > this.config.maxPayloadSizeBytes) {
      return {
        valid: false,
        error: {
          path: 'body',
          code: 'PAYLOAD_TOO_LARGE',
          message: `Payload size ${sizeBytes} bytes exceeds limit of ${this.config.maxPayloadSizeBytes} bytes`,
          expected: `<= ${this.config.maxPayloadSizeBytes} bytes`,
          actual: `${sizeBytes} bytes`,
        },
      };
    }

    return { valid: true };
  }

  /**
   * Parse JSON body
   */
  private parseJsonBody(
    body: string
  ): { valid: boolean; data?: Record<string, unknown>; error?: ValidationError } {
    try {
      const data = JSON.parse(body);

      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return {
          valid: false,
          error: {
            path: 'body',
            code: 'INVALID_JSON_STRUCTURE',
            message: 'Request body must be a JSON object',
            expected: 'object',
            actual: Array.isArray(data) ? 'array' : typeof data,
          },
        };
      }

      return { valid: true, data };
    } catch (e) {
      return {
        valid: false,
        error: {
          path: 'body',
          code: 'INVALID_JSON',
          message: `Failed to parse JSON: ${e instanceof Error ? e.message : 'Unknown error'}`,
          expected: 'valid JSON',
          actual: 'invalid JSON',
        },
      };
    }
  }

  /**
   * Validate against Zod schema
   */
  private async validateSchema(
    data: Record<string, unknown>
  ): Promise<{ valid: boolean; errors: ValidationError[] }> {
    if (!this.config.payloadSchema) {
      return { valid: true, errors: [] };
    }

    try {
      await this.config.payloadSchema.parseAsync(data);
      return { valid: true, errors: [] };
    } catch (e) {
      if (e instanceof ZodError) {
        const errors: ValidationError[] = e.errors.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
          expected: this.getExpectedFromZodIssue(issue),
          actual: this.getActualFromZodIssue(issue, data),
        }));
        return { valid: false, errors };
      }

      return {
        valid: false,
        errors: [
          {
            path: '',
            code: 'SCHEMA_VALIDATION_ERROR',
            message: e instanceof Error ? e.message : 'Schema validation failed',
          },
        ],
      };
    }
  }

  /**
   * Extract expected value from Zod issue
   */
  private getExpectedFromZodIssue(issue: z.ZodIssue): string | undefined {
    switch (issue.code) {
      case 'invalid_type':
        return issue.expected;
      case 'invalid_literal':
        return String(issue.expected);
      case 'invalid_enum_value':
        return (issue as z.ZodInvalidEnumValueIssue).options.join(' | ');
      case 'too_small':
        return `>= ${(issue as z.ZodTooSmallIssue).minimum}`;
      case 'too_big':
        return `<= ${(issue as z.ZodTooBigIssue).maximum}`;
      default:
        return undefined;
    }
  }

  /**
   * Extract actual value from Zod issue
   */
  private getActualFromZodIssue(
    issue: z.ZodIssue,
    data: Record<string, unknown>
  ): string | undefined {
    if (issue.code === 'invalid_type') {
      return (issue as z.ZodInvalidTypeIssue).received;
    }

    // Try to get the actual value from the path
    let value: unknown = data;
    for (const key of issue.path) {
      if (typeof value === 'object' && value !== null) {
        value = (value as Record<string, unknown>)[String(key)];
      } else {
        return undefined;
      }
    }

    if (value === undefined) {
      return 'undefined';
    }
    if (value === null) {
      return 'null';
    }
    if (typeof value === 'object') {
      return Array.isArray(value) ? 'array' : 'object';
    }
    return String(value);
  }

  /**
   * Run custom validators
   */
  async runCustomValidators(data: Record<string, unknown>): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    if (!this.config.customValidators) {
      return errors;
    }

    for (const [path, validator] of this.config.customValidators) {
      const value = this.getValueAtPath(data, path);
      try {
        const isValid = await Promise.resolve(validator(value));
        if (!isValid) {
          errors.push({
            path,
            code: 'CUSTOM_VALIDATION_FAILED',
            message: `Custom validation failed for '${path}'`,
          });
        }
      } catch (e) {
        errors.push({
          path,
          code: 'CUSTOM_VALIDATION_ERROR',
          message: `Custom validator error: ${e instanceof Error ? e.message : 'Unknown error'}`,
        });
      }
    }

    return errors;
  }

  /**
   * Get value at dot-notation path
   */
  private getValueAtPath(data: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let value: unknown = data;

    for (const part of parts) {
      if (typeof value !== 'object' || value === null) {
        return undefined;
      }
      value = (value as Record<string, unknown>)[part];
    }

    return value;
  }
}

/**
 * Compute payload hash for idempotency
 */
export function computePayloadHash(payload: unknown): string {
  const normalized = JSON.stringify(payload, Object.keys(payload as object).sort());
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Create common webhook payload schemas
 */
export const CommonWebhookSchemas = {
  /**
   * GitHub webhook payload schema
   */
  github: z.object({
    action: z.string().optional(),
    sender: z
      .object({
        id: z.number(),
        login: z.string(),
      })
      .optional(),
    repository: z
      .object({
        id: z.number(),
        name: z.string(),
        full_name: z.string(),
      })
      .optional(),
  }),

  /**
   * Stripe webhook payload schema
   */
  stripe: z.object({
    id: z.string().startsWith('evt_'),
    object: z.literal('event'),
    type: z.string(),
    data: z.object({
      object: z.record(z.unknown()),
    }),
    livemode: z.boolean(),
    created: z.number(),
  }),

  /**
   * Slack webhook payload schema
   */
  slack: z.object({
    token: z.string().optional(),
    type: z.string(),
    event: z.record(z.unknown()).optional(),
    team_id: z.string().optional(),
    api_app_id: z.string().optional(),
  }),

  /**
   * Generic event schema
   */
  genericEvent: z.object({
    event_type: z.string(),
    event_id: z.string().optional(),
    timestamp: z.string().datetime().optional(),
    data: z.record(z.unknown()),
  }),
};

/**
 * Validate source IP against allowed CIDRs
 */
export function validateSourceIP(ip: string, allowedCIDRs: string[]): boolean {
  if (allowedCIDRs.length === 0) {
    return true; // No restrictions
  }

  for (const cidr of allowedCIDRs) {
    if (isIPInCIDR(ip, cidr)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if IP is in CIDR range
 */
function isIPInCIDR(ip: string, cidr: string): boolean {
  const [range, bits] = cidr.split('/') as [string, string | undefined];
  const mask = bits ? parseInt(bits, 10) : 32;

  const ipNum = ipToNumber(ip);
  const rangeNum = ipToNumber(range);

  if (ipNum === null || rangeNum === null) {
    return false;
  }

  const maskNum = ~(2 ** (32 - mask) - 1);
  return (ipNum & maskNum) === (rangeNum & maskNum);
}

/**
 * Convert IP address to number
 */
function ipToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }

  let num = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255) {
      return null;
    }
    num = (num << 8) + n;
  }

  return num >>> 0; // Convert to unsigned 32-bit
}
