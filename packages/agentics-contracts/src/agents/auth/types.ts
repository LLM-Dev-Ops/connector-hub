/**
 * Auth/Identity Agent Contract Types
 *
 * Purpose: Authenticate and verify external identities, tokens, and credentials for connector access.
 * Classification: AUTHENTICATION / IDENTITY VERIFICATION
 * decision_type: "auth_identity_verification"
 *
 * This agent MUST:
 * - Validate tokens and signatures
 * - Verify identity claims
 * - Assess authentication confidence
 * - Emit identity verification DecisionEvents
 *
 * This agent MUST NOT:
 * - Enforce authorization policy
 * - Execute workflows or retries
 * - Modify internal runtime behavior
 * - Trigger other agents
 * - Apply optimizations
 */

import { z } from 'zod';

/**
 * Supported authentication methods
 */
export const AuthMethodSchema = z.enum([
  'jwt',
  'api_key',
  'oauth2',
  'basic',
  'bearer',
  'hmac',
  'mtls',
  'saml',
]);

export type AuthMethod = z.infer<typeof AuthMethodSchema>;

/**
 * Token validation status
 */
export const TokenStatusSchema = z.enum([
  'valid',
  'expired',
  'invalid_signature',
  'malformed',
  'revoked',
  'not_yet_valid',
  'issuer_mismatch',
  'audience_mismatch',
  'scope_insufficient',
  'unknown',
]);

export type TokenStatus = z.infer<typeof TokenStatusSchema>;

/**
 * Identity claims extracted from token
 */
export const IdentityClaimsSchema = z.object({
  /** Subject identifier */
  sub: z.string().optional(),

  /** Issuer identifier */
  iss: z.string().optional(),

  /** Audience */
  aud: z.union([z.string(), z.array(z.string())]).optional(),

  /** Expiration time (Unix timestamp) */
  exp: z.number().optional(),

  /** Issued at time (Unix timestamp) */
  iat: z.number().optional(),

  /** Not before time (Unix timestamp) */
  nbf: z.number().optional(),

  /** JWT ID */
  jti: z.string().optional(),

  /** Email address */
  email: z.string().email().optional(),

  /** Email verified flag */
  email_verified: z.boolean().optional(),

  /** Full name */
  name: z.string().optional(),

  /** Scopes/permissions */
  scope: z.union([z.string(), z.array(z.string())]).optional(),

  /** Roles */
  roles: z.array(z.string()).optional(),

  /** Custom claims */
  custom: z.record(z.string(), z.unknown()).optional(),
});

export type IdentityClaims = z.infer<typeof IdentityClaimsSchema>;

/**
 * Auth/Identity Agent input schema
 */
export const AuthAgentInputSchema = z.object({
  /** The credential to validate (token, API key, etc.) */
  credential: z.string().min(1),

  /** Authentication method */
  method: AuthMethodSchema,

  /** Expected issuer for JWT validation */
  expected_issuer: z.string().optional(),

  /** Expected audience for JWT validation */
  expected_audience: z.union([z.string(), z.array(z.string())]).optional(),

  /** Required scopes for authorization check */
  required_scopes: z.array(z.string()).optional(),

  /** Public key or secret for signature verification */
  verification_key: z.string().optional(),

  /** JWKS endpoint for key discovery */
  jwks_uri: z.string().url().optional(),

  /** Allow expired tokens (for refresh flows) */
  allow_expired: z.boolean().default(false),

  /** Maximum clock skew in seconds */
  clock_skew_seconds: z.number().nonnegative().default(60),

  /** Request context for audit */
  request_context: z.object({
    ip_address: z.string().optional(),
    user_agent: z.string().optional(),
    request_id: z.string().optional(),
    resource: z.string().optional(),
  }).optional(),
});

export type AuthAgentInput = z.infer<typeof AuthAgentInputSchema>;

/**
 * Auth/Identity Agent output schema
 */
export const AuthAgentOutputSchema = z.object({
  /** Whether authentication succeeded */
  authenticated: z.boolean(),

  /** Token validation status */
  status: TokenStatusSchema,

  /** Extracted identity claims */
  claims: IdentityClaimsSchema.optional(),

  /** Authentication method used */
  method: AuthMethodSchema,

  /** Token expiration time (ISO 8601) */
  expires_at: z.string().datetime().optional(),

  /** Time until token expires in seconds */
  expires_in_seconds: z.number().optional(),

  /** Scopes present in the token */
  scopes: z.array(z.string()).optional(),

  /** Whether all required scopes are present */
  has_required_scopes: z.boolean().optional(),

  /** Validation warnings */
  warnings: z.array(z.string()).optional(),

  /** Token fingerprint (for audit, not the actual token) */
  token_fingerprint: z.string().optional(),
});

export type AuthAgentOutput = z.infer<typeof AuthAgentOutputSchema>;

/**
 * Confidence factors for auth verification
 */
export const AuthConfidenceFactorsSchema = z.object({
  /** Confidence in signature verification */
  signature_verification: z.number().min(0).max(1),

  /** Confidence in issuer trust */
  issuer_trust: z.number().min(0).max(1),

  /** Confidence in token freshness */
  token_freshness: z.number().min(0).max(1),

  /** Confidence in claims completeness */
  claims_completeness: z.number().min(0).max(1),

  /** Confidence in scope sufficiency */
  scope_sufficiency: z.number().min(0).max(1).optional(),
});

export type AuthConfidenceFactors = z.infer<typeof AuthConfidenceFactorsSchema>;

/**
 * Auth agent-specific constraints
 */
export const AuthConstraintsSchema = z.object({
  /** Connector scope (always 'auth' for this agent) */
  connector_scope: z.literal('auth'),

  /** Authentication context */
  auth_context: z.object({
    method: AuthMethodSchema,
    identity_verified: z.boolean(),
    permissions: z.array(z.string()).optional(),
  }),

  /** Schema boundaries applied */
  schema_boundaries: z.array(z.string()),

  /** Trusted issuers list */
  trusted_issuers: z.array(z.string()).optional(),

  /** Key rotation policy */
  key_rotation_policy: z.enum(['strict', 'lenient']).optional(),
});

export type AuthConstraints = z.infer<typeof AuthConstraintsSchema>;

/**
 * CLI invocation shape for Auth Agent
 */
export const AuthAgentCLIArgsSchema = z.object({
  /** Subcommand: verify | inspect | validate */
  command: z.enum(['verify', 'inspect', 'validate']),

  /** Token or credential to process */
  credential: z.string(),

  /** Authentication method */
  method: AuthMethodSchema.default('jwt'),

  /** Expected issuer */
  issuer: z.string().optional(),

  /** Expected audience */
  audience: z.string().optional(),

  /** Required scopes (comma-separated) */
  scopes: z.string().optional(),

  /** JWKS URI for key discovery */
  jwks: z.string().optional(),

  /** Output format */
  format: z.enum(['json', 'text', 'minimal']).default('json'),

  /** Verbose output */
  verbose: z.boolean().default(false),
});

export type AuthAgentCLIArgs = z.infer<typeof AuthAgentCLIArgsSchema>;
