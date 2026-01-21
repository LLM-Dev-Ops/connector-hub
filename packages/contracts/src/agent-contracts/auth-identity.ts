import { z } from 'zod';

/**
 * Authentication method enumeration.
 */
export const AuthMethodSchema = z.enum([
  'jwt',
  'oauth2',
  'api_key',
  'saml',
  'ldap',
  'basic',
  'custom',
]);

export type AuthMethod = z.infer<typeof AuthMethodSchema>;

/**
 * Token verification configuration.
 */
export const TokenVerificationConfigSchema = z.object({
  /**
   * JWT verification settings.
   */
  jwt: z.object({
    algorithm: z.enum(['RS256', 'HS256', 'ES256']).describe('JWT algorithm'),
    public_key_reference: z.string().optional().describe('Public key env reference (for RS256/ES256)'),
    secret_reference: z.string().optional().describe('Secret env reference (for HS256)'),
    issuer: z.string().optional().describe('Expected issuer claim'),
    audience: z.string().optional().describe('Expected audience claim'),
  }).optional().describe('JWT verification settings'),

  /**
   * OAuth2 verification settings.
   */
  oauth2: z.object({
    introspection_endpoint: z.string().url().describe('Token introspection endpoint'),
    client_id: z.string().describe('Client ID'),
    client_secret_reference: z.string().describe('Client secret env reference'),
  }).optional().describe('OAuth2 verification settings'),

  /**
   * API key verification settings.
   */
  api_key: z.object({
    header_name: z.string().default('X-API-Key').describe('API key header name'),
    valid_keys_reference: z.string().describe('Valid API keys env reference'),
  }).optional().describe('API key verification settings'),
});

export type TokenVerificationConfig = z.infer<typeof TokenVerificationConfigSchema>;

/**
 * Input schema for Auth Identity Agent.
 * Defines the contract for authentication and identity verification.
 */
export const AuthIdentityInputSchema = z.object({
  /**
   * Authentication method to use.
   */
  method: AuthMethodSchema
    .describe('Authentication method'),

  /**
   * Authentication credentials or token.
   */
  credentials: z.union([
    z.object({
      type: z.literal('token'),
      value: z.string().describe('Token value (JWT, OAuth2, API key)'),
    }),
    z.object({
      type: z.literal('basic'),
      username: z.string().describe('Username'),
      password: z.string().describe('Password'),
    }),
    z.object({
      type: z.literal('saml'),
      assertion: z.string().describe('SAML assertion'),
    }),
  ]).describe('Authentication credentials'),

  /**
   * Token verification configuration.
   */
  verification_config: TokenVerificationConfigSchema
    .optional()
    .describe('Token verification configuration'),

  /**
   * Additional context for verification.
   */
  context: z.object({
    source_ip: z.string().optional().describe('Source IP address'),
    user_agent: z.string().optional().describe('User agent string'),
    request_id: z.string().optional().describe('Request correlation ID'),
  }).optional().describe('Additional verification context'),

  /**
   * Requested scopes or permissions.
   */
  requested_scopes: z.array(z.string())
    .optional()
    .describe('Requested scopes or permissions'),
});

export type AuthIdentityInput = z.infer<typeof AuthIdentityInputSchema>;

/**
 * Identity claims extracted from authentication.
 */
export const IdentityClaimsSchema = z.object({
  /**
   * Unique user identifier.
   */
  user_id: z.string()
    .describe('Unique user identifier'),

  /**
   * Username or email.
   */
  username: z.string()
    .optional()
    .describe('Username or email'),

  /**
   * Email address.
   */
  email: z.string()
    .email()
    .optional()
    .describe('Email address'),

  /**
   * Display name.
   */
  display_name: z.string()
    .optional()
    .describe('Display name'),

  /**
   * Tenant or organization ID.
   */
  tenant_id: z.string()
    .optional()
    .describe('Tenant or organization ID'),

  /**
   * User roles.
   */
  roles: z.array(z.string())
    .optional()
    .describe('User roles'),

  /**
   * Granted permissions or scopes.
   */
  permissions: z.array(z.string())
    .optional()
    .describe('Granted permissions'),

  /**
   * Token expiration timestamp.
   */
  expires_at: z.string()
    .datetime()
    .optional()
    .describe('Token expiration timestamp'),

  /**
   * Custom claims.
   */
  custom_claims: z.record(z.unknown())
    .optional()
    .describe('Custom identity claims'),
});

export type IdentityClaims = z.infer<typeof IdentityClaimsSchema>;

/**
 * Verification result details.
 */
export const VerificationResultSchema = z.object({
  /**
   * Whether authentication was successful.
   */
  authenticated: z.boolean()
    .describe('Whether authentication succeeded'),

  /**
   * Verification status code.
   */
  status_code: z.enum([
    'valid',
    'invalid_token',
    'expired',
    'insufficient_permissions',
    'rate_limited',
    'internal_error',
  ]).describe('Verification status code'),

  /**
   * Failure reason (if not authenticated).
   */
  failure_reason: z.string()
    .optional()
    .describe('Failure reason'),

  /**
   * Identity claims (if authenticated).
   */
  identity: IdentityClaimsSchema
    .optional()
    .describe('Identity claims'),
});

export type VerificationResult = z.infer<typeof VerificationResultSchema>;

/**
 * Output schema for Auth Identity Agent.
 * Contains verification results and identity claims.
 */
export const AuthIdentityOutputSchema = z.object({
  /**
   * Verification result.
   */
  verification: VerificationResultSchema
    .describe('Verification result'),

  /**
   * Session metadata.
   */
  session_metadata: z.object({
    session_id: z.string().optional().describe('Session identifier'),
    created_at: z.string().datetime().describe('Verification timestamp'),
    ttl_seconds: z.number().int().min(0).optional().describe('Session TTL in seconds'),
  }).describe('Session metadata'),

  /**
   * Audit information.
   */
  audit: z.object({
    verification_method: AuthMethodSchema.describe('Method used for verification'),
    source_ip: z.string().optional().describe('Source IP address'),
    risk_score: z.number().min(0).max(1).optional().describe('Risk score (0-1)'),
  }).describe('Audit information'),
});

export type AuthIdentityOutput = z.infer<typeof AuthIdentityOutputSchema>;

/**
 * Complete Auth Identity Agent contract.
 */
export const AuthIdentityContractSchema = z.object({
  input: AuthIdentityInputSchema,
  output: AuthIdentityOutputSchema,
});

export type AuthIdentityContract = z.infer<typeof AuthIdentityContractSchema>;

/**
 * CLI invocation shape for Auth Identity Agent.
 *
 * @example
 * ```bash
 * auth-identity-agent \
 *   --method jwt \
 *   --credentials '{"type": "token", "value": "eyJ..."}' \
 *   --verification-config '{"jwt": {"algorithm": "RS256", "issuer": "auth.example.com"}}' \
 *   --requested-scopes '["read:users", "write:users"]'
 * ```
 */
export const AuthIdentityCLISchema = z.object({
  method: AuthMethodSchema.describe('Authentication method'),
  credentials: z.string().describe('JSON string of credentials'),
  'verification-config': z.string().optional().describe('JSON string of verification config'),
  context: z.string().optional().describe('JSON string of context'),
  'requested-scopes': z.string().optional().describe('JSON array of requested scopes'),
});

export type AuthIdentityCLI = z.infer<typeof AuthIdentityCLISchema>;

/**
 * Validates auth identity input.
 */
export function validateAuthIdentityInput(data: unknown): AuthIdentityInput {
  return AuthIdentityInputSchema.parse(data);
}

/**
 * Validates auth identity output.
 */
export function validateAuthIdentityOutput(data: unknown): AuthIdentityOutput {
  return AuthIdentityOutputSchema.parse(data);
}

/**
 * Safely validates auth identity input.
 */
export function safeValidateAuthIdentityInput(data: unknown) {
  return AuthIdentityInputSchema.safeParse(data);
}

/**
 * Safely validates auth identity output.
 */
export function safeValidateAuthIdentityOutput(data: unknown) {
  return AuthIdentityOutputSchema.safeParse(data);
}
