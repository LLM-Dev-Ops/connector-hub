import { z } from 'zod';

/**
 * Authentication provider types
 */
export const AuthProviderTypeSchema = z.enum([
  'oauth2',
  'oidc',
  'saml',
  'api_key',
  'jwt',
  'basic',
  'mtls',
  'custom',
]);

export type AuthProviderType = z.infer<typeof AuthProviderTypeSchema>;

/**
 * Identity verification result schema
 */
export const AuthIdentityVerificationSchema = z.object({
  provider_type: AuthProviderTypeSchema,
  verified: z.boolean(),
  identity: z.object({
    subject: z.string().describe('Unique identifier for the authenticated entity'),
    issuer: z.string().optional(),
    email: z.string().email().optional(),
    name: z.string().optional(),
    groups: z.array(z.string()).optional(),
    roles: z.array(z.string()).optional(),
    scopes: z.array(z.string()).optional(),
    claims: z.record(z.unknown()).optional(),
  }).optional(),
  token_info: z.object({
    type: z.enum(['access_token', 'id_token', 'refresh_token', 'api_key']),
    issued_at: z.string().datetime().optional(),
    expires_at: z.string().datetime().optional(),
    not_before: z.string().datetime().optional(),
    audience: z.union([z.string(), z.array(z.string())]).optional(),
  }).optional(),
  verification_error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }).optional(),
  verified_at: z.string().datetime(),
  assurance_level: z.enum(['low', 'medium', 'high', 'very_high']).optional(),
});

export type AuthIdentityVerification = z.infer<typeof AuthIdentityVerificationSchema>;

/**
 * OAuth2 token response schema
 */
export const OAuth2TokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
});

export type OAuth2TokenResponse = z.infer<typeof OAuth2TokenResponseSchema>;

/**
 * JWT claims schema (for validation)
 */
export const JWTClaimsSchema = z.object({
  iss: z.string().optional(),
  sub: z.string().optional(),
  aud: z.union([z.string(), z.array(z.string())]).optional(),
  exp: z.number().optional(),
  nbf: z.number().optional(),
  iat: z.number().optional(),
  jti: z.string().optional(),
}).passthrough();

export type JWTClaims = z.infer<typeof JWTClaimsSchema>;

/**
 * API Key validation result
 */
export const APIKeyValidationSchema = z.object({
  valid: z.boolean(),
  key_id: z.string().optional(),
  key_prefix: z.string().optional(),
  permissions: z.array(z.string()).optional(),
  rate_limit: z.object({
    limit: z.number(),
    remaining: z.number(),
    reset_at: z.string().datetime(),
  }).optional(),
  owner: z.object({
    id: z.string(),
    type: z.enum(['user', 'service', 'application']),
    name: z.string().optional(),
  }).optional(),
  expires_at: z.string().datetime().optional(),
  validated_at: z.string().datetime(),
});

export type APIKeyValidation = z.infer<typeof APIKeyValidationSchema>;

/**
 * SAML assertion schema
 */
export const SAMLAssertionSchema = z.object({
  assertion_id: z.string(),
  issuer: z.string(),
  subject: z.object({
    name_id: z.string(),
    name_id_format: z.string(),
  }),
  conditions: z.object({
    not_before: z.string().datetime(),
    not_on_or_after: z.string().datetime(),
    audience_restriction: z.array(z.string()).optional(),
  }),
  authn_statement: z.object({
    authn_instant: z.string().datetime(),
    session_index: z.string().optional(),
    authn_context: z.string().optional(),
  }).optional(),
  attributes: z.record(z.union([z.string(), z.array(z.string())])).optional(),
});

export type SAMLAssertion = z.infer<typeof SAMLAssertionSchema>;
