/**
 * API Key Validator
 *
 * Validates API keys against expected patterns and optional verification endpoints.
 */

import * as crypto from 'crypto';
import {
  TokenStatus,
  IdentityClaims,
  AuthConfidenceFactors,
  generateTokenFingerprint,
} from '@llm-dev-ops/agentics-contracts';

export interface APIKeyValidationOptions {
  /** Expected prefix pattern (e.g., 'sk-', 'pk_live_') */
  expectedPrefix?: string;

  /** Expected length (if known) */
  expectedLength?: number;

  /** Minimum length */
  minLength?: number;

  /** Maximum length */
  maxLength?: number;

  /** Expected character set regex */
  characterSet?: RegExp;

  /** Verification callback (for checking against a database/service) */
  verifyCallback?: (key: string) => Promise<{
    valid: boolean;
    identity?: { sub?: string; name?: string; scopes?: string[] };
    expiresAt?: Date;
  }>;

  /** Hash the key before verification (for database lookup) */
  hashForVerification?: boolean;
}

export interface APIKeyValidationResult {
  /** Whether the key is valid */
  valid: boolean;

  /** Validation status */
  status: TokenStatus;

  /** Extracted/verified identity claims */
  claims?: IdentityClaims;

  /** Expiration time if known */
  expiresAt?: string;

  /** Seconds until expiration */
  expiresInSeconds?: number;

  /** Scopes if available */
  scopes?: string[];

  /** Validation warnings */
  warnings: string[];

  /** Key fingerprint (for audit) */
  tokenFingerprint: string;

  /** Confidence factors */
  confidenceFactors: AuthConfidenceFactors;
}

/**
 * Default API key character set (alphanumeric + some special chars)
 */
const DEFAULT_CHARSET = /^[a-zA-Z0-9_\-]+$/;

/**
 * Common API key patterns
 */
const KNOWN_PATTERNS: Record<string, { prefix: string; minLength: number; maxLength: number }> = {
  openai: { prefix: 'sk-', minLength: 40, maxLength: 60 },
  anthropic: { prefix: 'sk-ant-', minLength: 80, maxLength: 120 },
  stripe_live: { prefix: 'sk_live_', minLength: 30, maxLength: 50 },
  stripe_test: { prefix: 'sk_test_', minLength: 30, maxLength: 50 },
  github: { prefix: 'ghp_', minLength: 30, maxLength: 50 },
};

/**
 * Detect API key type based on pattern
 */
export function detectAPIKeyType(key: string): string | null {
  for (const [type, pattern] of Object.entries(KNOWN_PATTERNS)) {
    if (
      key.startsWith(pattern.prefix) &&
      key.length >= pattern.minLength &&
      key.length <= pattern.maxLength
    ) {
      return type;
    }
  }
  return null;
}

/**
 * Validate an API key
 */
export async function validateAPIKey(
  key: string,
  options: APIKeyValidationOptions = {}
): Promise<APIKeyValidationResult> {
  const warnings: string[] = [];
  const fingerprint = generateTokenFingerprint(key);

  // Initialize confidence factors
  const confidenceFactors: AuthConfidenceFactors = {
    signature_verification: 0,
    issuer_trust: 0,
    token_freshness: 0.5, // API keys don't typically have freshness
    claims_completeness: 0,
  };

  // Check minimum length
  const minLength = options.minLength ?? 10;
  if (key.length < minLength) {
    return {
      valid: false,
      status: 'malformed',
      warnings: [`API key too short (minimum ${minLength} characters)`],
      tokenFingerprint: fingerprint,
      confidenceFactors,
    };
  }

  // Check maximum length
  const maxLength = options.maxLength ?? 500;
  if (key.length > maxLength) {
    return {
      valid: false,
      status: 'malformed',
      warnings: [`API key too long (maximum ${maxLength} characters)`],
      tokenFingerprint: fingerprint,
      confidenceFactors,
    };
  }

  // Check expected length
  if (options.expectedLength && key.length !== options.expectedLength) {
    warnings.push(`Expected length ${options.expectedLength}, got ${key.length}`);
  }

  // Check prefix
  if (options.expectedPrefix && !key.startsWith(options.expectedPrefix)) {
    return {
      valid: false,
      status: 'malformed',
      warnings: [`API key should start with "${options.expectedPrefix}"`],
      tokenFingerprint: fingerprint,
      confidenceFactors,
    };
  }

  // Check character set
  const charset = options.characterSet ?? DEFAULT_CHARSET;
  if (!charset.test(key)) {
    return {
      valid: false,
      status: 'malformed',
      warnings: ['API key contains invalid characters'],
      tokenFingerprint: fingerprint,
      confidenceFactors,
    };
  }

  // Detect known patterns
  const detectedType = detectAPIKeyType(key);
  if (detectedType) {
    confidenceFactors.issuer_trust = 0.8;
    const pattern = KNOWN_PATTERNS[detectedType]!;
    if (
      key.length >= pattern.minLength &&
      key.length <= pattern.maxLength
    ) {
      confidenceFactors.claims_completeness = 0.7;
    }
  } else {
    confidenceFactors.issuer_trust = 0.3;
    warnings.push('API key does not match any known provider pattern');
  }

  // Verify against callback if provided
  if (options.verifyCallback) {
    try {
      let keyToVerify = key;
      if (options.hashForVerification) {
        keyToVerify = crypto.createHash('sha256').update(key).digest('hex');
      }

      const result = await options.verifyCallback(keyToVerify);

      if (!result.valid) {
        return {
          valid: false,
          status: 'revoked',
          warnings: ['API key verification failed'],
          tokenFingerprint: fingerprint,
          confidenceFactors: {
            ...confidenceFactors,
            signature_verification: 0,
          },
        };
      }

      // Build claims from verification result
      const claims: IdentityClaims = {};
      if (result.identity) {
        claims.sub = result.identity.sub;
        claims.name = result.identity.name;
        if (result.identity.scopes) {
          claims.scope = result.identity.scopes;
        }
      }

      let expiresAt: string | undefined;
      let expiresInSeconds: number | undefined;

      if (result.expiresAt) {
        expiresAt = result.expiresAt.toISOString();
        expiresInSeconds = Math.max(0, Math.floor((result.expiresAt.getTime() - Date.now()) / 1000));

        if (expiresInSeconds === 0) {
          return {
            valid: false,
            status: 'expired',
            claims,
            expiresAt,
            expiresInSeconds: 0,
            warnings: ['API key has expired'],
            tokenFingerprint: fingerprint,
            confidenceFactors: {
              ...confidenceFactors,
              signature_verification: 1,
              token_freshness: 0,
            },
          };
        }

        confidenceFactors.token_freshness = Math.min(1, expiresInSeconds / 86400); // 24h = full freshness
      }

      confidenceFactors.signature_verification = 1;
      confidenceFactors.claims_completeness = Object.keys(claims).length > 0 ? 0.9 : 0.5;

      return {
        valid: true,
        status: 'valid',
        claims: Object.keys(claims).length > 0 ? claims : undefined,
        expiresAt,
        expiresInSeconds,
        scopes: result.identity?.scopes,
        warnings,
        tokenFingerprint: fingerprint,
        confidenceFactors,
      };
    } catch (error) {
      return {
        valid: false,
        status: 'unknown',
        warnings: [`Verification error: ${error instanceof Error ? error.message : 'Unknown error'}`],
        tokenFingerprint: fingerprint,
        confidenceFactors: {
          ...confidenceFactors,
          signature_verification: 0,
        },
      };
    }
  }

  // No verification callback - return structural validation result
  warnings.push('No verification callback provided - key structure validated only');

  return {
    valid: true,
    status: 'valid',
    warnings,
    tokenFingerprint: fingerprint,
    confidenceFactors: {
      ...confidenceFactors,
      signature_verification: 0.3, // Low confidence without verification
    },
  };
}
