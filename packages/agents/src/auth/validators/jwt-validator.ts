/**
 * JWT Token Validator
 *
 * Validates JSON Web Tokens according to RFC 7519.
 * Supports HS256, RS256, ES256 algorithms.
 */

import * as jose from 'jose';
import {
  TokenStatus,
  IdentityClaims,
  AuthConfidenceFactors,
  generateTokenFingerprint,
  isTokenExpired,
} from '@llm-dev-ops/agentics-contracts';

export interface JWTValidationOptions {
  /** Expected issuer */
  expectedIssuer?: string;

  /** Expected audience */
  expectedAudience?: string | string[];

  /** Verification key (for symmetric algorithms) */
  verificationKey?: string;

  /** JWKS URI for key discovery */
  jwksUri?: string;

  /** Maximum clock skew in seconds */
  clockSkewSeconds?: number;

  /** Allow expired tokens */
  allowExpired?: boolean;

  /** Required scopes */
  requiredScopes?: string[];
}

export interface JWTValidationResult {
  /** Whether the token is valid */
  valid: boolean;

  /** Token status */
  status: TokenStatus;

  /** Extracted claims */
  claims?: IdentityClaims;

  /** Expiration time (ISO 8601) */
  expiresAt?: string;

  /** Seconds until expiration */
  expiresInSeconds?: number;

  /** Scopes in the token */
  scopes?: string[];

  /** Whether required scopes are present */
  hasRequiredScopes?: boolean;

  /** Validation warnings */
  warnings: string[];

  /** Token fingerprint */
  tokenFingerprint: string;

  /** Confidence factors */
  confidenceFactors: AuthConfidenceFactors;
}

/**
 * Parse JWT without verification (for inspection)
 */
export function parseJWTUnsafe(token: string): {
  header: jose.ProtectedHeaderParameters;
  payload: jose.JWTPayload;
} | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const header = JSON.parse(
      Buffer.from(parts[0]!, 'base64url').toString('utf-8')
    ) as jose.ProtectedHeaderParameters;

    const payload = JSON.parse(
      Buffer.from(parts[1]!, 'base64url').toString('utf-8')
    ) as jose.JWTPayload;

    return { header, payload };
  } catch {
    return null;
  }
}

/**
 * Validate a JWT token
 */
export async function validateJWT(
  token: string,
  options: JWTValidationOptions = {}
): Promise<JWTValidationResult> {
  const warnings: string[] = [];
  const fingerprint = generateTokenFingerprint(token);
  const clockSkew = options.clockSkewSeconds ?? 60;

  // Initialize confidence factors
  const confidenceFactors: AuthConfidenceFactors = {
    signature_verification: 0,
    issuer_trust: 0,
    token_freshness: 0,
    claims_completeness: 0,
  };

  // Try to parse the token first
  const parsed = parseJWTUnsafe(token);
  if (!parsed) {
    return {
      valid: false,
      status: 'malformed',
      warnings: ['Token is not a valid JWT format'],
      tokenFingerprint: fingerprint,
      confidenceFactors,
    };
  }

  const { payload } = parsed;

  // Build claims from payload
  const claims: IdentityClaims = {
    sub: payload.sub,
    iss: payload.iss,
    aud: payload.aud,
    exp: payload.exp,
    iat: payload.iat,
    nbf: payload.nbf,
    jti: payload.jti,
  };

  // Handle email claims
  if (typeof payload['email'] === 'string') {
    claims.email = payload['email'];
    claims.email_verified = payload['email_verified'] === true;
  }

  // Handle name
  if (typeof payload['name'] === 'string') {
    claims.name = payload['name'];
  }

  // Handle scopes
  let scopes: string[] = [];
  if (typeof payload['scope'] === 'string') {
    scopes = payload['scope'].split(' ').filter(Boolean);
    claims.scope = scopes;
  } else if (Array.isArray(payload['scope'])) {
    scopes = payload['scope'] as string[];
    claims.scope = scopes;
  }

  // Handle roles
  if (Array.isArray(payload['roles'])) {
    claims.roles = payload['roles'] as string[];
  }

  // Check expiration
  let expiresAt: string | undefined;
  let expiresInSeconds: number | undefined;

  if (payload.exp) {
    const expCheck = isTokenExpired(payload.exp, clockSkew, options.allowExpired);
    expiresAt = new Date(payload.exp * 1000).toISOString();
    expiresInSeconds = expCheck.expiresInSeconds;

    if (expCheck.expired) {
      return {
        valid: false,
        status: 'expired',
        claims,
        expiresAt,
        expiresInSeconds: 0,
        scopes,
        warnings: ['Token has expired'],
        tokenFingerprint: fingerprint,
        confidenceFactors: {
          ...confidenceFactors,
          token_freshness: 0,
          claims_completeness: 0.7,
        },
      };
    }

    // Calculate freshness confidence
    const maxAge = 3600; // 1 hour is considered fully fresh
    confidenceFactors.token_freshness = Math.min(1, expiresInSeconds / maxAge);
  } else {
    warnings.push('Token has no expiration claim');
    confidenceFactors.token_freshness = 0.5;
  }

  // Check not-before
  if (payload.nbf) {
    const now = Math.floor(Date.now() / 1000);
    if (payload.nbf > now + clockSkew) {
      return {
        valid: false,
        status: 'not_yet_valid',
        claims,
        expiresAt,
        expiresInSeconds,
        scopes,
        warnings: ['Token is not yet valid'],
        tokenFingerprint: fingerprint,
        confidenceFactors: {
          ...confidenceFactors,
          token_freshness: 0,
        },
      };
    }
  }

  // Check issuer
  if (options.expectedIssuer && payload.iss !== options.expectedIssuer) {
    return {
      valid: false,
      status: 'issuer_mismatch',
      claims,
      expiresAt,
      expiresInSeconds,
      scopes,
      warnings: [`Expected issuer ${options.expectedIssuer}, got ${payload.iss}`],
      tokenFingerprint: fingerprint,
      confidenceFactors: {
        ...confidenceFactors,
        issuer_trust: 0,
      },
    };
  }
  confidenceFactors.issuer_trust = options.expectedIssuer ? 1 : 0.5;

  // Check audience
  if (options.expectedAudience) {
    const expectedAuds = Array.isArray(options.expectedAudience)
      ? options.expectedAudience
      : [options.expectedAudience];
    const tokenAuds = Array.isArray(payload.aud)
      ? payload.aud
      : payload.aud
        ? [payload.aud]
        : [];

    const hasValidAudience = expectedAuds.some((aud) => tokenAuds.includes(aud));
    if (!hasValidAudience) {
      return {
        valid: false,
        status: 'audience_mismatch',
        claims,
        expiresAt,
        expiresInSeconds,
        scopes,
        warnings: [`Token audience ${tokenAuds.join(', ')} does not match expected ${expectedAuds.join(', ')}`],
        tokenFingerprint: fingerprint,
        confidenceFactors: {
          ...confidenceFactors,
          issuer_trust: 0.5,
        },
      };
    }
  }

  // Check required scopes
  let hasRequiredScopes = true;
  if (options.requiredScopes && options.requiredScopes.length > 0) {
    const missingScopes = options.requiredScopes.filter((s) => !scopes.includes(s));
    hasRequiredScopes = missingScopes.length === 0;

    if (!hasRequiredScopes) {
      warnings.push(`Missing required scopes: ${missingScopes.join(', ')}`);
      confidenceFactors.scope_sufficiency = scopes.length / (scopes.length + missingScopes.length);
    } else {
      confidenceFactors.scope_sufficiency = 1;
    }
  }

  // Calculate claims completeness
  const essentialClaims = ['sub', 'iss', 'exp', 'iat'];
  const presentClaims = essentialClaims.filter((c) => payload[c] !== undefined);
  confidenceFactors.claims_completeness = presentClaims.length / essentialClaims.length;

  // Verify signature if key is provided
  if (options.verificationKey || options.jwksUri) {
    try {
      if (options.jwksUri) {
        const JWKS = jose.createRemoteJWKSet(new URL(options.jwksUri));
        await jose.jwtVerify(token, JWKS, {
          issuer: options.expectedIssuer,
          audience: options.expectedAudience,
          clockTolerance: clockSkew,
        });
      } else if (options.verificationKey) {
        const key = new TextEncoder().encode(options.verificationKey);
        await jose.jwtVerify(token, key, {
          issuer: options.expectedIssuer,
          audience: options.expectedAudience,
          clockTolerance: clockSkew,
        });
      } else {
        throw new Error('No verification key provided');
      }

      confidenceFactors.signature_verification = 1;

      return {
        valid: true,
        status: 'valid',
        claims,
        expiresAt,
        expiresInSeconds,
        scopes,
        hasRequiredScopes,
        warnings,
        tokenFingerprint: fingerprint,
        confidenceFactors,
      };
    } catch (error) {
      if (error instanceof jose.errors.JWTExpired) {
        return {
          valid: false,
          status: 'expired',
          claims,
          expiresAt,
          expiresInSeconds: 0,
          scopes,
          warnings: ['Token has expired during verification'],
          tokenFingerprint: fingerprint,
          confidenceFactors: {
            ...confidenceFactors,
            signature_verification: 0.8, // Signature was likely valid, just expired
            token_freshness: 0,
          },
        };
      }

      if (error instanceof jose.errors.JWTClaimValidationFailed) {
        return {
          valid: false,
          status: 'invalid_signature',
          claims,
          expiresAt,
          expiresInSeconds,
          scopes,
          warnings: [`Claim validation failed: ${error.message}`],
          tokenFingerprint: fingerprint,
          confidenceFactors: {
            ...confidenceFactors,
            signature_verification: 0,
          },
        };
      }

      return {
        valid: false,
        status: 'invalid_signature',
        claims,
        expiresAt,
        expiresInSeconds,
        scopes,
        warnings: [`Signature verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
        tokenFingerprint: fingerprint,
        confidenceFactors: {
          ...confidenceFactors,
          signature_verification: 0,
        },
      };
    }
  }

  // No verification key provided - warn but consider valid for structure
  warnings.push('No verification key provided - signature not verified');
  confidenceFactors.signature_verification = 0.3; // Low confidence without verification

  return {
    valid: true,
    status: 'valid',
    claims,
    expiresAt,
    expiresInSeconds,
    scopes,
    hasRequiredScopes,
    warnings,
    tokenFingerprint: fingerprint,
    confidenceFactors,
  };
}
