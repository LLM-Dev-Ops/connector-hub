/**
 * Shared utilities for Connector Hub agents
 */

import { createHash } from 'crypto';

/**
 * Generate SHA-256 hash of input for audit trail
 */
export function hashInput(input: unknown): string {
  const serialized = JSON.stringify(input, Object.keys(input as object).sort());
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Generate a unique execution reference (trace ID)
 */
export function generateExecutionRef(): string {
  return crypto.randomUUID();
}

/**
 * Get current UTC timestamp in ISO format
 */
export function utcNow(): string {
  return new Date().toISOString();
}

/**
 * Safe JSON parse with fallback
 */
export function safeJsonParse<T>(input: string, fallback: T): T {
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

/**
 * Determine if an error is retryable
 */
export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  const retryablePatterns = [
    'timeout',
    'rate limit',
    'too many requests',
    '429',
    '503',
    '502',
    '504',
    'connection refused',
    'econnrefused',
    'econnreset',
    'network error',
  ];
  return retryablePatterns.some(pattern => message.includes(pattern));
}

/**
 * Extract correlation ID from headers
 */
export function extractCorrelationId(headers: Record<string, string | undefined>): string | undefined {
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
 * Mask sensitive data in a string (API keys, tokens, etc.)
 */
export function maskSensitiveData(input: string): string {
  // Mask API keys (common patterns)
  let masked = input.replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-***MASKED***');
  masked = masked.replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer ***MASKED***');
  masked = masked.replace(/api[_-]?key[=:]\s*[a-zA-Z0-9._-]+/gi, 'api_key=***MASKED***');

  return masked;
}

/**
 * Calculate confidence score based on validation results
 */
export function calculateConfidence(params: {
  schemaValidation: boolean;
  fieldCompleteness: number; // 0-1
  formatCompliance: boolean;
  signatureVerified?: boolean;
}): number {
  let score = 0;
  let factors = 0;

  // Schema validation (40% weight)
  if (params.schemaValidation) {
    score += 0.4;
  }
  factors++;

  // Field completeness (30% weight)
  score += 0.3 * params.fieldCompleteness;
  factors++;

  // Format compliance (20% weight)
  if (params.formatCompliance) {
    score += 0.2;
  }
  factors++;

  // Signature verification (10% weight if applicable)
  if (params.signatureVerified !== undefined) {
    if (params.signatureVerified) {
      score += 0.1;
    }
    factors++;
  }

  // Normalize if signature wasn't checked
  if (params.signatureVerified === undefined) {
    score = score / 0.9; // Adjust for missing 10%
  }

  return Math.min(1, Math.max(0, score));
}

/**
 * Deep merge objects
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>
): T {
  const output = { ...target };

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (
      sourceValue !== undefined &&
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      output[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T];
    } else if (sourceValue !== undefined) {
      output[key] = sourceValue as T[keyof T];
    }
  }

  return output;
}
