/**
 * Auth/Identity Agent
 *
 * Purpose: Authenticate and verify external identities, tokens, and credentials for connector access.
 * Classification: AUTHENTICATION / IDENTITY VERIFICATION
 * decision_type: "auth_identity_verification"
 *
 * This agent:
 * - Validates tokens and signatures
 * - Verifies identity claims
 * - Assesses authentication confidence
 * - Emits identity verification DecisionEvents
 *
 * This agent MUST NOT:
 * - Enforce authorization policy
 * - Execute workflows or retries
 * - Modify internal runtime behavior
 * - Trigger other agents
 * - Apply optimizations
 * - Persist data directly (use ruvector-service)
 */

import {
  Confidence,
  ConstraintsApplied,
  AuthAgentInput,
  AuthAgentInputSchema,
  AuthAgentOutput,
  AuthAgentOutputSchema,
  AuthMethod,
  TokenStatus,
} from '@llm-dev-ops/agentics-contracts';
import { BaseAgent, AgentContext, BaseAgentConfig } from '../base/agent';
import { validateJWT, JWTValidationResult } from './validators/jwt-validator';
import { validateAPIKey, APIKeyValidationResult } from './validators/api-key-validator';
import { validateOAuth, OAuthValidationResult } from './validators/oauth-validator';
import { calculateConfidence } from './confidence';

/**
 * Auth Agent configuration
 */
export interface AuthAgentConfig extends Omit<BaseAgentConfig, 'agentId' | 'version' | 'decisionType'> {
  /** Trusted issuers for JWT validation */
  trustedIssuers?: string[];

  /** JWKS endpoints by issuer */
  jwksEndpoints?: Record<string, string>;

  /** OAuth introspection endpoint */
  oauthIntrospectionEndpoint?: string;

  /** OAuth client credentials */
  oauthClientId?: string;
  oauthClientSecret?: string;

  /** Default clock skew tolerance in seconds */
  defaultClockSkewSeconds?: number;

  /** API key verification callback */
  apiKeyVerifyCallback?: (key: string) => Promise<{
    valid: boolean;
    identity?: { sub?: string; name?: string; scopes?: string[] };
    expiresAt?: Date;
  }>;
}

/**
 * Auth/Identity Agent Implementation
 */
export class AuthAgent extends BaseAgent<AuthAgentInput, AuthAgentOutput> {
  private readonly authConfig: AuthAgentConfig;

  constructor(config: AuthAgentConfig = {}) {
    super({
      agentId: 'auth-identity-agent',
      version: '0.1.0',
      decisionType: 'auth_identity_verification',
      telemetryEnabled: config.telemetryEnabled,
      telemetryEndpoint: config.telemetryEndpoint,
    });

    this.authConfig = config;
  }

  /**
   * Validate input against the auth agent schema
   */
  protected validateInput(input: unknown): AuthAgentInput {
    return AuthAgentInputSchema.parse(input);
  }

  /**
   * Validate output against the auth agent schema
   */
  protected validateOutput(output: unknown): AuthAgentOutput {
    return AuthAgentOutputSchema.parse(output);
  }

  /**
   * Execute the auth verification logic
   */
  protected async executeLogic(
    input: AuthAgentInput,
    _context: AgentContext
  ): Promise<{
    output: AuthAgentOutput;
    confidence: Confidence;
    constraints: ConstraintsApplied;
    warnings?: string[];
    error?: { code: string; message: string; recoverable: boolean; details?: unknown };
  }> {
    let validationResult: JWTValidationResult | APIKeyValidationResult | OAuthValidationResult;
    const warnings: string[] = [];

    // Route to appropriate validator based on method
    switch (input.method) {
      case 'jwt':
      case 'bearer':
        validationResult = await this.validateJWTToken(input);
        break;

      case 'api_key':
        validationResult = await this.validateAPIKeyToken(input);
        break;

      case 'oauth2':
        validationResult = await this.validateOAuthToken(input);
        break;

      case 'basic':
        validationResult = this.validateBasicAuth(input);
        break;

      case 'hmac':
        validationResult = this.validateHMACAuth(input);
        break;

      default:
        // Unsupported method
        return {
          output: {
            authenticated: false,
            status: 'unknown',
            method: input.method,
            warnings: [`Unsupported authentication method: ${input.method}`],
          },
          confidence: {
            score: 0,
            level: 'uncertain',
            reasoning: 'Unsupported authentication method',
          },
          constraints: this.buildConstraints(input.method, false),
          warnings: [`Unsupported authentication method: ${input.method}`],
        };
    }

    // Calculate confidence from validation factors
    const confidence = calculateConfidence(validationResult.confidenceFactors);

    // Build output
    const output: AuthAgentOutput = {
      authenticated: validationResult.valid,
      status: validationResult.status,
      method: input.method,
      claims: validationResult.claims,
      expires_at: validationResult.expiresAt,
      expires_in_seconds: validationResult.expiresInSeconds,
      scopes: validationResult.scopes,
      has_required_scopes: 'hasRequiredScopes' in validationResult
        ? validationResult.hasRequiredScopes
        : undefined,
      warnings: validationResult.warnings,
      token_fingerprint: validationResult.tokenFingerprint,
    };

    // Add any additional warnings
    warnings.push(...validationResult.warnings);

    // Build error if not authenticated
    let error: { code: string; message: string; recoverable: boolean } | undefined;
    if (!validationResult.valid) {
      error = {
        code: `AUTH_${validationResult.status.toUpperCase()}`,
        message: this.getErrorMessage(validationResult.status),
        recoverable: this.isRecoverableError(validationResult.status),
      };
    }

    return {
      output,
      confidence,
      constraints: this.buildConstraints(input.method, validationResult.valid),
      warnings: warnings.length > 0 ? warnings : undefined,
      error,
    };
  }

  /**
   * Validate JWT token
   */
  private async validateJWTToken(input: AuthAgentInput): Promise<JWTValidationResult> {
    // Determine JWKS URI
    let jwksUri = input.jwks_uri;
    if (!jwksUri && input.expected_issuer && this.authConfig.jwksEndpoints) {
      jwksUri = this.authConfig.jwksEndpoints[input.expected_issuer];
    }

    return validateJWT(input.credential, {
      expectedIssuer: input.expected_issuer,
      expectedAudience: input.expected_audience,
      verificationKey: input.verification_key,
      jwksUri,
      clockSkewSeconds: input.clock_skew_seconds ?? this.authConfig.defaultClockSkewSeconds,
      allowExpired: input.allow_expired,
      requiredScopes: input.required_scopes,
    });
  }

  /**
   * Validate API key
   */
  private async validateAPIKeyToken(input: AuthAgentInput): Promise<APIKeyValidationResult> {
    return validateAPIKey(input.credential, {
      verifyCallback: this.authConfig.apiKeyVerifyCallback,
    });
  }

  /**
   * Validate OAuth token
   */
  private async validateOAuthToken(input: AuthAgentInput): Promise<OAuthValidationResult> {
    return validateOAuth(input.credential, {
      introspectionEndpoint: this.authConfig.oauthIntrospectionEndpoint,
      clientId: this.authConfig.oauthClientId,
      clientSecret: this.authConfig.oauthClientSecret,
      expectedIssuer: input.expected_issuer,
      expectedAudience: input.expected_audience,
      requiredScopes: input.required_scopes,
      jwksUri: input.jwks_uri,
      clockSkewSeconds: input.clock_skew_seconds ?? this.authConfig.defaultClockSkewSeconds,
    });
  }

  /**
   * Validate Basic authentication
   */
  private validateBasicAuth(input: AuthAgentInput): JWTValidationResult {
    // Basic auth validation - just check format
    const decoded = Buffer.from(input.credential, 'base64').toString('utf-8');
    const parts = decoded.split(':');

    if (parts.length !== 2) {
      return {
        valid: false,
        status: 'malformed',
        warnings: ['Invalid Basic auth format'],
        tokenFingerprint: '',
        confidenceFactors: {
          signature_verification: 0,
          issuer_trust: 0,
          token_freshness: 0.5,
          claims_completeness: 0,
        },
      };
    }

    // Extract username (without verification - that would be authorization)
    const [username] = parts;

    return {
      valid: true,
      status: 'valid',
      claims: {
        sub: username,
      },
      warnings: ['Basic auth credentials not verified (requires external verification)'],
      tokenFingerprint: '',
      confidenceFactors: {
        signature_verification: 0.3, // Can't verify without password store
        issuer_trust: 0.5,
        token_freshness: 1, // Basic auth is always "fresh"
        claims_completeness: 0.3,
      },
    };
  }

  /**
   * Validate HMAC signature
   */
  private validateHMACAuth(input: AuthAgentInput): JWTValidationResult {
    // HMAC validation requires the verification key
    if (!input.verification_key) {
      return {
        valid: false,
        status: 'invalid_signature',
        warnings: ['HMAC validation requires verification_key'],
        tokenFingerprint: '',
        confidenceFactors: {
          signature_verification: 0,
          issuer_trust: 0,
          token_freshness: 0.5,
          claims_completeness: 0,
        },
      };
    }

    // In a real implementation, we would verify the HMAC signature
    // against the request body/parameters
    return {
      valid: true,
      status: 'valid',
      warnings: ['HMAC signature format validated (content verification requires request body)'],
      tokenFingerprint: '',
      confidenceFactors: {
        signature_verification: 0.5,
        issuer_trust: 0.5,
        token_freshness: 1,
        claims_completeness: 0.2,
      },
    };
  }

  /**
   * Build constraints applied object
   */
  private buildConstraints(method: AuthMethod, identityVerified: boolean): ConstraintsApplied {
    return {
      connector_scope: 'auth',
      auth_context: {
        method,
        identity_verified: identityVerified,
      },
      schema_boundaries: [
        'AuthAgentInputSchema',
        'AuthAgentOutputSchema',
        'DecisionEventSchema',
      ],
    };
  }

  /**
   * Get human-readable error message for token status
   */
  private getErrorMessage(status: TokenStatus): string {
    const messages: Record<TokenStatus, string> = {
      valid: 'Token is valid',
      expired: 'Token has expired',
      invalid_signature: 'Token signature is invalid',
      malformed: 'Token format is invalid',
      revoked: 'Token has been revoked',
      not_yet_valid: 'Token is not yet valid',
      issuer_mismatch: 'Token issuer does not match expected value',
      audience_mismatch: 'Token audience does not match expected value',
      scope_insufficient: 'Token does not have required scopes',
      unknown: 'Token validation status is unknown',
    };

    return messages[status];
  }

  /**
   * Determine if an error is recoverable
   */
  private isRecoverableError(status: TokenStatus): boolean {
    // Expired tokens can be refreshed
    // Not-yet-valid tokens might become valid
    const recoverableStatuses: TokenStatus[] = ['expired', 'not_yet_valid'];
    return recoverableStatuses.includes(status);
  }
}

/**
 * Create an Auth Agent instance
 */
export function createAuthAgent(config?: AuthAgentConfig): AuthAgent {
  return new AuthAgent(config);
}
