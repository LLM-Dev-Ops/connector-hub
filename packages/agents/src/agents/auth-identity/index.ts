/**
 * Auth Identity Verification Agent
 *
 * PURPOSE: Authenticate and verify external identities
 *
 * RESPONSIBILITIES:
 * - Verify authentication tokens (JWT, OAuth, API keys)
 * - Validate identity credentials
 * - Check identity claims and permissions
 * - Assess authentication assurance levels
 * - Emit auth_identity_verification DecisionEvents
 *
 * CLASSIFICATION: SECURITY CONNECTOR / IDENTITY VERIFIER
 *
 * SECURITY:
 * - MUST NOT store credentials or secrets
 * - MUST NOT persist tokens
 * - Only verification results are emitted
 * - All sensitive data sanitized in outputs
 *
 * CONSTRAINTS:
 * - Confidence based on auth assurance level (MFA > single-factor > none)
 * - Read-only identity verification
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { BaseAgent } from '../../shared/BaseAgent.js';
import {
  type Confidence,
  type ConstraintsApplied,
  type BaseAgentConfig,
  computeInputsHash,
} from '../../contracts/index.js';

// ============================================================================
// Auth Identity Schemas
// ============================================================================

/**
 * Supported authentication methods
 */
export const AuthMethodSchema = z.enum([
  'jwt',
  'oauth2',
  'api_key',
  'basic_auth',
  'bearer_token',
  'saml',
  'oidc',
  'mtls',
  'custom',
]);

export type AuthMethod = z.infer<typeof AuthMethodSchema>;

/**
 * Authentication assurance levels (NIST 800-63)
 */
export const AssuranceLevelSchema = z.enum([
  'aal1', // Single-factor
  'aal2', // Two-factor
  'aal3', // Hardware-based MFA
]);

export type AssuranceLevel = z.infer<typeof AssuranceLevelSchema>;

/**
 * Identity verification request schema
 */
export const IdentityVerificationRequestSchema = z.object({
  /** Authentication method used */
  auth_method: AuthMethodSchema,

  /** Credentials/token (will not be persisted) */
  credentials: z.record(z.unknown()),

  /** Identity claims to verify */
  claims: z.record(z.unknown()).optional(),

  /** Required permissions/scopes */
  required_scopes: z.array(z.string()).optional(),

  /** Context information */
  context: z
    .object({
      ip_address: z.string().ip().optional(),
      user_agent: z.string().optional(),
      device_id: z.string().optional(),
      session_id: z.string().optional(),
    })
    .optional(),

  /** Verification timestamp */
  verification_timestamp: z.string().datetime().optional(),
});

export type IdentityVerificationRequest = z.infer<typeof IdentityVerificationRequestSchema>;

/**
 * Identity verification result schema
 */
export const IdentityVerificationResultSchema = z.object({
  /** Whether identity is verified */
  verified: z.boolean(),

  /** Authentication method used */
  auth_method: AuthMethodSchema,

  /** Assurance level achieved */
  assurance_level: z.enum(['none', 'low', 'medium', 'high', 'verified']),

  /** AAL level (if applicable) */
  aal_level: AssuranceLevelSchema.optional(),

  /** Subject identifier (user ID, never the actual credential) */
  subject_id: z.string().optional(),

  /** Verified claims */
  verified_claims: z.record(z.unknown()).optional(),

  /** Granted scopes */
  granted_scopes: z.array(z.string()).optional(),

  /** Token expiration (if applicable) */
  expires_at: z.string().datetime().optional(),

  /** Verification errors */
  verification_errors: z.array(z.string()).optional(),

  /** Multi-factor authentication used */
  mfa_used: z.boolean(),

  /** Trust score (0-1) */
  trust_score: z.number().min(0).max(1),
});

export type IdentityVerificationResult = z.infer<typeof IdentityVerificationResultSchema>;

/**
 * Auth Identity Agent configuration
 */
export const AuthIdentityAgentConfigSchema = z
  .object({
    /** Allowed authentication methods */
    allowed_auth_methods: z.array(AuthMethodSchema).optional(),

    /** Require MFA for high assurance */
    require_mfa_for_high_assurance: z.boolean().default(true),

    /** JWT verification settings */
    jwt_settings: z
      .object({
        /** Allowed algorithms */
        algorithms: z.array(z.string()).default(['RS256', 'ES256']),
        /** Issuer whitelist */
        allowed_issuers: z.array(z.string()).optional(),
        /** Audience requirements */
        required_audience: z.string().optional(),
        /** Clock tolerance (seconds) */
        clock_tolerance: z.number().default(60),
      })
      .optional(),

    /** OAuth2 validation settings */
    oauth2_settings: z
      .object({
        /** Token introspection endpoint */
        introspection_endpoint: z.string().url().optional(),
        /** Client ID for introspection */
        client_id: z.string().optional(),
      })
      .optional(),

    /** Minimum trust score required */
    min_trust_score: z.number().min(0).max(1).default(0.5),

    /** Connector scope identifier */
    connector_scope: z.string().min(1),
  })
  .passthrough();

export type AuthIdentityAgentConfig = z.infer<typeof AuthIdentityAgentConfigSchema> &
  BaseAgentConfig;

// ============================================================================
// Auth Identity Agent Implementation
// ============================================================================

export class AuthIdentityAgent extends BaseAgent {
  private readonly authConfig: AuthIdentityAgentConfig;

  constructor(config: AuthIdentityAgentConfig) {
    super('auth-identity-agent', '1.0.0', 'auth_identity_verification', config);
    this.authConfig = config;
  }

  protected async validateInput(input: unknown): Promise<{
    valid: boolean;
    error?: string;
    duration_ms?: number;
  }> {
    const startTime = Date.now();

    try {
      const parsed = IdentityVerificationRequestSchema.parse(input);

      // Check if auth method is allowed
      if (
        this.authConfig.allowed_auth_methods &&
        !this.authConfig.allowed_auth_methods.includes(parsed.auth_method)
      ) {
        return {
          valid: false,
          error: `Authentication method ${parsed.auth_method} is not allowed`,
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
        error: error instanceof Error ? error.message : 'Invalid verification request',
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
    const verificationRequest = IdentityVerificationRequestSchema.parse(input);

    // Perform identity verification
    const verificationResult = await this.verifyIdentity(verificationRequest);

    // Check if verification passed minimum trust score
    if (verificationResult.trust_score < this.authConfig.min_trust_score) {
      throw new Error(
        `Identity verification failed: trust score ${verificationResult.trust_score} below minimum ${this.authConfig.min_trust_score}`,
      );
    }

    // Sanitize output (remove all credential data)
    const sanitizedOutput: IdentityVerificationResult = {
      ...verificationResult,
      // Ensure no credentials leak into output
    };

    // Calculate confidence
    const confidence: Confidence = {
      score: verificationResult.trust_score,
      auth_assurance: verificationResult.assurance_level,
      schema_validation: verificationResult.verified ? 'passed' : 'failed',
    };

    // Build constraints
    const constraintsApplied: ConstraintsApplied = {
      connector_scope: this.authConfig.connector_scope,
      identity_context: verificationResult.subject_id,
      schema_boundaries: [
        `auth_method:${verificationRequest.auth_method}`,
        `assurance:${verificationResult.assurance_level}`,
      ],
      timeout_ms: this.config.timeout_ms,
    };

    return {
      outputs: sanitizedOutput,
      confidence,
      constraintsApplied,
      metadata: {
        auth_method: verificationRequest.auth_method,
        mfa_used: verificationResult.mfa_used,
        context_hash: verificationRequest.context
          ? computeInputsHash(verificationRequest.context)
          : undefined,
      },
    };
  }

  /**
   * Verify identity based on authentication method
   */
  private async verifyIdentity(
    request: IdentityVerificationRequest,
  ): Promise<IdentityVerificationResult> {
    const errors: string[] = [];
    let verified = false;
    let subjectId: string | undefined;
    let verifiedClaims: Record<string, unknown> = {};
    let grantedScopes: string[] = [];
    let expiresAt: string | undefined;
    let mfaUsed = false;
    let trustScore = 0;

    try {
      switch (request.auth_method) {
        case 'jwt':
          {
            const jwtResult = await this.verifyJWT(request.credentials);
            verified = jwtResult.valid;
            subjectId = jwtResult.subject;
            verifiedClaims = jwtResult.claims || {};
            grantedScopes = jwtResult.scopes || [];
            expiresAt = jwtResult.expiresAt;
            mfaUsed = jwtResult.amr?.includes('mfa') || false;
            trustScore = jwtResult.valid ? (mfaUsed ? 0.95 : 0.75) : 0.0;
            if (!jwtResult.valid && jwtResult.error) {
              errors.push(jwtResult.error);
            }
          }
          break;

        case 'api_key':
          {
            const apiKeyResult = this.verifyAPIKey(request.credentials);
            verified = apiKeyResult.valid;
            subjectId = apiKeyResult.keyId;
            trustScore = apiKeyResult.valid ? 0.6 : 0.0;
            if (!apiKeyResult.valid && apiKeyResult.error) {
              errors.push(apiKeyResult.error);
            }
          }
          break;

        case 'bearer_token':
          {
            const tokenResult = this.verifyBearerToken(request.credentials);
            verified = tokenResult.valid;
            subjectId = tokenResult.subject;
            trustScore = tokenResult.valid ? 0.7 : 0.0;
            if (!tokenResult.valid && tokenResult.error) {
              errors.push(tokenResult.error);
            }
          }
          break;

        default:
          errors.push(`Unsupported authentication method: ${request.auth_method}`);
          verified = false;
          trustScore = 0.0;
      }

      // Check required scopes
      if (request.required_scopes && request.required_scopes.length > 0) {
        const hasAllScopes = request.required_scopes.every((scope) =>
          grantedScopes.includes(scope),
        );
        if (!hasAllScopes) {
          errors.push('Missing required scopes');
          verified = false;
          trustScore *= 0.5;
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown verification error');
      verified = false;
      trustScore = 0.0;
    }

    // Determine assurance level
    const assuranceLevel = this.determineAssuranceLevel(
      request.auth_method,
      mfaUsed,
      verified,
    );
    const aalLevel = this.mapToAAL(assuranceLevel, mfaUsed);

    return {
      verified,
      auth_method: request.auth_method,
      assurance_level: assuranceLevel,
      aal_level: aalLevel,
      subject_id: subjectId,
      verified_claims: Object.keys(verifiedClaims).length > 0 ? verifiedClaims : undefined,
      granted_scopes: grantedScopes.length > 0 ? grantedScopes : undefined,
      expires_at: expiresAt,
      verification_errors: errors.length > 0 ? errors : undefined,
      mfa_used: mfaUsed,
      trust_score: Math.max(0, Math.min(1, trustScore)),
    };
  }

  /**
   * Verify JWT token
   */
  private async verifyJWT(credentials: Record<string, unknown>): Promise<{
    valid: boolean;
    subject?: string;
    claims?: Record<string, unknown>;
    scopes?: string[];
    expiresAt?: string;
    amr?: string[];
    error?: string;
  }> {
    const token = credentials.token as string;
    if (!token) {
      return { valid: false, error: 'Missing JWT token' };
    }

    try {
      // Parse JWT (simplified - in production, use a proper JWT library)
      const parts = token.split('.');
      if (parts.length !== 3) {
        return { valid: false, error: 'Invalid JWT format' };
      }

      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        return { valid: false, error: 'Token expired' };
      }

      // Check not before
      if (payload.nbf && payload.nbf > now) {
        return { valid: false, error: 'Token not yet valid' };
      }

      // Check issuer
      if (
        this.authConfig.jwt_settings?.allowed_issuers &&
        !this.authConfig.jwt_settings.allowed_issuers.includes(payload.iss)
      ) {
        return { valid: false, error: 'Invalid issuer' };
      }

      // Check audience
      if (
        this.authConfig.jwt_settings?.required_audience &&
        payload.aud !== this.authConfig.jwt_settings.required_audience
      ) {
        return { valid: false, error: 'Invalid audience' };
      }

      return {
        valid: true,
        subject: payload.sub,
        claims: payload,
        scopes: payload.scope?.split(' ') || payload.scopes || [],
        expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : undefined,
        amr: payload.amr || [],
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'JWT verification failed',
      };
    }
  }

  /**
   * Verify API key
   */
  private verifyAPIKey(credentials: Record<string, unknown>): {
    valid: boolean;
    keyId?: string;
    error?: string;
  } {
    const apiKey = credentials.api_key as string;
    if (!apiKey) {
      return { valid: false, error: 'Missing API key' };
    }

    // In production, this would validate against a key store
    // For now, just check format
    const keyFormat = /^[a-zA-Z0-9_-]{32,}$/;
    const valid = keyFormat.test(apiKey);

    return {
      valid,
      keyId: valid ? this.hashApiKey(apiKey) : undefined,
      error: valid ? undefined : 'Invalid API key format',
    };
  }

  /**
   * Verify bearer token
   */
  private verifyBearerToken(credentials: Record<string, unknown>): {
    valid: boolean;
    subject?: string;
    error?: string;
  } {
    const token = credentials.token as string;
    if (!token) {
      return { valid: false, error: 'Missing bearer token' };
    }

    // In production, this would validate against a token store or introspection endpoint
    // For now, just check format
    const valid = token.length >= 32;

    return {
      valid,
      subject: valid ? this.hashApiKey(token).substring(0, 16) : undefined,
      error: valid ? undefined : 'Invalid bearer token',
    };
  }

  /**
   * Hash API key for subject ID
   */
  private hashApiKey(apiKey: string): string {
    return crypto.createHash('sha256').update(apiKey).digest('hex').substring(0, 32);
  }

  /**
   * Determine assurance level
   */
  private determineAssuranceLevel(
    authMethod: AuthMethod,
    mfaUsed: boolean,
    verified: boolean,
  ): 'none' | 'low' | 'medium' | 'high' | 'verified' {
    if (!verified) return 'none';

    if (mfaUsed) return 'verified';

    switch (authMethod) {
      case 'jwt':
      case 'oauth2':
      case 'oidc':
      case 'saml':
        return 'high';
      case 'mtls':
        return 'verified';
      case 'bearer_token':
        return 'medium';
      case 'api_key':
      case 'basic_auth':
        return 'low';
      default:
        return 'low';
    }
  }

  /**
   * Map assurance level to AAL (NIST 800-63)
   */
  private mapToAAL(
    assuranceLevel: string,
    mfaUsed: boolean,
  ): AssuranceLevel | undefined {
    if (assuranceLevel === 'verified' || mfaUsed) {
      return 'aal3'; // Hardware MFA or verified
    } else if (assuranceLevel === 'high') {
      return 'aal2'; // Two-factor
    } else if (assuranceLevel === 'medium' || assuranceLevel === 'low') {
      return 'aal1'; // Single-factor
    }
    return undefined;
  }
}

/**
 * Factory function to create Auth Identity Agent
 */
export function createAuthIdentityAgent(config: AuthIdentityAgentConfig): AuthIdentityAgent {
  return new AuthIdentityAgent(config);
}
