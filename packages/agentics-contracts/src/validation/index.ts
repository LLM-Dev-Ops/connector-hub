/**
 * Validation utilities for Agentics contracts
 */

import { ZodError, ZodSchema } from 'zod';
import * as crypto from 'crypto';

/**
 * Validation result type
 */
export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: Array<{
    path: string;
    message: string;
    code: string;
  }>;
}

/**
 * Validate input against a Zod schema
 */
export function validateSchema<T>(
  schema: ZodSchema<T>,
  input: unknown
): ValidationResult<T> {
  try {
    const data = schema.parse(input);
    return { success: true, data };
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        success: false,
        errors: error.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
          code: e.code,
        })),
      };
    }
    throw error;
  }
}

/**
 * Safe validation that returns undefined on failure
 */
export function safeValidate<T>(
  schema: ZodSchema<T>,
  input: unknown
): T | undefined {
  const result = schema.safeParse(input);
  return result.success ? result.data : undefined;
}

/**
 * Generate SHA-256 hash of input for audit trail
 */
export function hashInput(input: unknown): string {
  const serialized = JSON.stringify(input, Object.keys(input as object).sort());
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

/**
 * Sanitize sensitive fields from input before logging
 */
export function sanitizeForLogging(
  input: Record<string, unknown>,
  sensitiveFields: string[] = ['credential', 'password', 'secret', 'token', 'api_key', 'apiKey']
): Record<string, unknown> {
  const sanitized = { ...input };

  for (const field of sensitiveFields) {
    if (field in sanitized) {
      const value = sanitized[field];
      if (typeof value === 'string') {
        sanitized[field] = value.length > 8
          ? `${value.substring(0, 4)}...${value.substring(value.length - 4)}`
          : '[REDACTED]';
      } else {
        sanitized[field] = '[REDACTED]';
      }
    }
  }

  return sanitized;
}

/**
 * Generate a token fingerprint for audit (not the actual token)
 */
export function generateTokenFingerprint(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').substring(0, 16);
}

/**
 * Check if a timestamp is within acceptable bounds
 */
export function isTimestampValid(
  timestamp: number,
  clockSkewSeconds: number = 60
): { valid: boolean; reason?: string } {
  const now = Math.floor(Date.now() / 1000);
  const skewedNow = now + clockSkewSeconds;

  if (timestamp > skewedNow) {
    return { valid: false, reason: 'Timestamp is in the future' };
  }

  return { valid: true };
}

/**
 * Check if a token has expired
 */
export function isTokenExpired(
  exp: number,
  clockSkewSeconds: number = 60,
  allowExpired: boolean = false
): { expired: boolean; expiresInSeconds: number } {
  const now = Math.floor(Date.now() / 1000);
  const adjustedExp = exp + clockSkewSeconds;
  const expiresInSeconds = adjustedExp - now;

  return {
    expired: allowExpired ? false : expiresInSeconds < 0,
    expiresInSeconds: Math.max(0, expiresInSeconds),
  };
}
