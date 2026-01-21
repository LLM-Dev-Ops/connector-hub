/**
 * OAuth2 Token Validator
 *
 * Validates OAuth2 access tokens via introspection endpoint (RFC 7662)
 * or by treating them as JWTs.
 */

import {
  TokenStatus,
  IdentityClaims,
  AuthConfidenceFactors,
  generateTokenFingerprint,
} from '@llm-dev-ops/agentics-contracts';
import { validateJWT, parseJWTUnsafe } from './jwt-validator';

export interface OAuthValidationOptions {
  /** Token introspection endpoint (RFC 7662) */
  introspectionEndpoint?: string;

  /** Client ID for introspection */
  clientId?: string;

  /** Client secret for introspection */
  clientSecret?: string;

  /** Expected issuer */
  expectedIssuer?: string;

  /** Expected audience */
  expectedAudience?: string | string[];

  /** Required scopes */
  requiredScopes?: string[];

  /** JWKS URI for JWT validation */
  jwksUri?: string;

  /** Clock skew tolerance in seconds */
  clockSkewSeconds?: number;

  /** Timeout for introspection request in milliseconds */
  timeoutMs?: number;
}

export interface OAuthValidationResult {
  /** Whether the token is valid */
  valid: boolean;

  /** Validation status */
  status: TokenStatus;

  /** Token type (bearer, etc.) */
  tokenType?: string;

  /** Extracted claims */
  claims?: IdentityClaims;

  /** Expiration time */
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
 * Introspection response per RFC 7662
 */
interface IntrospectionResponse {
  active: boolean;
  scope?: string;
  client_id?: string;
  username?: string;
  token_type?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
  sub?: string;
  aud?: string | string[];
  iss?: string;
  jti?: string;
  [key: string]: unknown;
}

/**
 * Validate OAuth2 token via introspection
 */
async function introspectToken(
  token: string,
  options: OAuthValidationOptions
): Promise<IntrospectionResponse | null> {
  if (!options.introspectionEndpoint) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 5000
  );

  try {
    const body = new URLSearchParams();
    body.append('token', token);
    body.append('token_type_hint', 'access_token');

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    // Add client authentication
    if (options.clientId && options.clientSecret) {
      const credentials = Buffer.from(
        `${options.clientId}:${options.clientSecret}`
      ).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    }

    const response = await fetch(options.introspectionEndpoint, {
      method: 'POST',
      headers,
      body: body.toString(),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as IntrospectionResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Validate an OAuth2 access token
 */
export async function validateOAuth(
  token: string,
  options: OAuthValidationOptions = {}
): Promise<OAuthValidationResult> {
  const warnings: string[] = [];
  const fingerprint = generateTokenFingerprint(token);

  // Initialize confidence factors
  const confidenceFactors: AuthConfidenceFactors = {
    signature_verification: 0,
    issuer_trust: 0,
    token_freshness: 0,
    claims_completeness: 0,
  };

  // Check if this looks like a JWT
  const isJWT = parseJWTUnsafe(token) !== null;

  // Try introspection first if endpoint is configured
  if (options.introspectionEndpoint) {
    const introspectionResult = await introspectToken(token, options);

    if (introspectionResult) {
      if (!introspectionResult.active) {
        return {
          valid: false,
          status: 'revoked',
          warnings: ['Token is not active according to introspection'],
          tokenFingerprint: fingerprint,
          confidenceFactors: {
            ...confidenceFactors,
            signature_verification: 1, // We got a definitive answer
          },
        };
      }

      // Build claims from introspection response
      const claims: IdentityClaims = {
        sub: introspectionResult.sub,
        iss: introspectionResult.iss,
        aud: introspectionResult.aud,
        exp: introspectionResult.exp,
        iat: introspectionResult.iat,
        nbf: introspectionResult.nbf,
        jti: introspectionResult.jti,
      };

      // Parse scopes
      const scopes = introspectionResult.scope?.split(' ').filter(Boolean) ?? [];
      if (scopes.length > 0) {
        claims.scope = scopes;
      }

      // Check expiration
      let expiresAt: string | undefined;
      let expiresInSeconds: number | undefined;

      if (introspectionResult.exp) {
        expiresAt = new Date(introspectionResult.exp * 1000).toISOString();
        const now = Math.floor(Date.now() / 1000);
        expiresInSeconds = Math.max(0, introspectionResult.exp - now);

        if (expiresInSeconds === 0) {
          return {
            valid: false,
            status: 'expired',
            tokenType: introspectionResult.token_type,
            claims,
            expiresAt,
            expiresInSeconds: 0,
            scopes,
            warnings: ['Token has expired'],
            tokenFingerprint: fingerprint,
            confidenceFactors: {
              ...confidenceFactors,
              signature_verification: 1,
              token_freshness: 0,
            },
          };
        }

        confidenceFactors.token_freshness = Math.min(1, expiresInSeconds / 3600);
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

      // Check issuer
      if (options.expectedIssuer && introspectionResult.iss !== options.expectedIssuer) {
        return {
          valid: false,
          status: 'issuer_mismatch',
          tokenType: introspectionResult.token_type,
          claims,
          expiresAt,
          expiresInSeconds,
          scopes,
          warnings: [`Expected issuer ${options.expectedIssuer}, got ${introspectionResult.iss}`],
          tokenFingerprint: fingerprint,
          confidenceFactors: {
            ...confidenceFactors,
            signature_verification: 1,
            issuer_trust: 0,
          },
        };
      }

      confidenceFactors.signature_verification = 1;
      confidenceFactors.issuer_trust = options.expectedIssuer ? 1 : 0.7;
      confidenceFactors.claims_completeness = Object.values(claims).filter(Boolean).length / 7;

      return {
        valid: true,
        status: 'valid',
        tokenType: introspectionResult.token_type ?? 'bearer',
        claims,
        expiresAt,
        expiresInSeconds,
        scopes,
        hasRequiredScopes,
        warnings,
        tokenFingerprint: fingerprint,
        confidenceFactors,
      };
    } else {
      warnings.push('Introspection failed - falling back to JWT validation');
    }
  }

  // Fall back to JWT validation if the token looks like a JWT
  if (isJWT) {
    const jwtResult = await validateJWT(token, {
      expectedIssuer: options.expectedIssuer,
      expectedAudience: options.expectedAudience,
      requiredScopes: options.requiredScopes,
      jwksUri: options.jwksUri,
      clockSkewSeconds: options.clockSkewSeconds,
    });

    return {
      valid: jwtResult.valid,
      status: jwtResult.status,
      tokenType: 'bearer',
      claims: jwtResult.claims,
      expiresAt: jwtResult.expiresAt,
      expiresInSeconds: jwtResult.expiresInSeconds,
      scopes: jwtResult.scopes,
      hasRequiredScopes: jwtResult.hasRequiredScopes,
      warnings: [...warnings, ...jwtResult.warnings],
      tokenFingerprint: fingerprint,
      confidenceFactors: jwtResult.confidenceFactors,
    };
  }

  // Opaque token without introspection endpoint
  warnings.push('Opaque token cannot be validated without introspection endpoint');

  return {
    valid: false,
    status: 'unknown',
    tokenType: 'bearer',
    warnings,
    tokenFingerprint: fingerprint,
    confidenceFactors,
  };
}
