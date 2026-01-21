/**
 * Tests for Auth/Identity Agent
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAuthAgent, AuthAgent, AuthAgentConfig } from '../auth/auth-agent';
import { AgentContext } from '../base/agent';
import * as jose from 'jose';

// Test fixtures
const createTestContext = (): AgentContext => ({
  traceId: `test-trace-${Date.now()}`,
  spanId: 'test-span-123',
  correlationId: 'test-correlation-456',
});

// Create a valid JWT for testing
async function createTestJWT(
  payload: jose.JWTPayload = {},
  expiresIn: string = '1h'
): Promise<{ token: string; secret: Uint8Array }> {
  const secret = new TextEncoder().encode('test-secret-key-that-is-long-enough-32');

  const token = await new jose.SignJWT({
    sub: 'test-user',
    iss: 'https://test-issuer.com',
    aud: 'test-audience',
    email: 'test@example.com',
    ...payload,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);

  return { token, secret };
}

describe('AuthAgent', () => {
  let agent: AuthAgent;
  let context: AgentContext;

  beforeEach(() => {
    agent = createAuthAgent();
    context = createTestContext();
  });

  describe('agent properties', () => {
    it('should have correct agent ID', () => {
      expect(agent.agentId).toBe('auth-identity-agent');
    });

    it('should have correct version', () => {
      expect(agent.version).toBe('0.1.0');
    });

    it('should have correct decision type', () => {
      expect(agent.decisionType).toBe('auth_identity_verification');
    });
  });

  describe('JWT validation', () => {
    it('should validate a valid JWT token', async () => {
      const { token, secret } = await createTestJWT();

      const result = await agent.invoke(
        {
          credential: token,
          method: 'jwt',
          verification_key: Buffer.from(secret).toString('utf-8'),
        },
        context
      );

      expect(result.output.authenticated).toBe(true);
      expect(result.output.status).toBe('valid');
      expect(result.output.claims?.sub).toBe('test-user');
      expect(result.output.claims?.iss).toBe('https://test-issuer.com');
      expect(result.output.claims?.email).toBe('test@example.com');
      expect(result.event.decision_type).toBe('auth_identity_verification');
      expect(result.event.confidence.score).toBeGreaterThan(0);
    });

    it('should reject an expired JWT token', async () => {
      const { token, secret } = await createTestJWT({}, '-1h');

      const result = await agent.invoke(
        {
          credential: token,
          method: 'jwt',
          verification_key: Buffer.from(secret).toString('utf-8'),
        },
        context
      );

      expect(result.output.authenticated).toBe(false);
      expect(result.output.status).toBe('expired');
    });

    it('should allow expired tokens when allow_expired is true', async () => {
      const { token } = await createTestJWT({}, '-1h');

      const result = await agent.invoke(
        {
          credential: token,
          method: 'jwt',
          allow_expired: true,
        },
        context
      );

      // Without verification key, it validates structure but not signature
      expect(result.output.status).toBe('valid');
    });

    it('should reject malformed JWT', async () => {
      const result = await agent.invoke(
        {
          credential: 'not-a-valid-jwt',
          method: 'jwt',
        },
        context
      );

      expect(result.output.authenticated).toBe(false);
      expect(result.output.status).toBe('malformed');
    });

    it('should check issuer mismatch', async () => {
      const { token, secret } = await createTestJWT({ iss: 'https://wrong-issuer.com' });

      const result = await agent.invoke(
        {
          credential: token,
          method: 'jwt',
          expected_issuer: 'https://test-issuer.com',
          verification_key: Buffer.from(secret).toString('utf-8'),
        },
        context
      );

      expect(result.output.authenticated).toBe(false);
      expect(result.output.status).toBe('issuer_mismatch');
    });

    it('should validate required scopes', async () => {
      const { token } = await createTestJWT({ scope: 'read write' });

      const result = await agent.invoke(
        {
          credential: token,
          method: 'jwt',
          required_scopes: ['read', 'write'],
        },
        context
      );

      expect(result.output.scopes).toEqual(['read', 'write']);
      expect(result.output.has_required_scopes).toBe(true);
    });

    it('should flag missing scopes', async () => {
      const { token } = await createTestJWT({ scope: 'read' });

      const result = await agent.invoke(
        {
          credential: token,
          method: 'jwt',
          required_scopes: ['read', 'write', 'admin'],
        },
        context
      );

      expect(result.output.has_required_scopes).toBe(false);
      expect(result.output.warnings).toContain('Missing required scopes: write, admin');
    });
  });

  describe('API key validation', () => {
    it('should validate OpenAI-style API key', async () => {
      const result = await agent.invoke(
        {
          credential: 'sk-abcdefghijklmnopqrstuvwxyz12345678901234',
          method: 'api_key',
        },
        context
      );

      expect(result.output.authenticated).toBe(true);
      expect(result.output.status).toBe('valid');
      expect(result.output.warnings).toContain(
        'No verification callback provided - key structure validated only'
      );
    });

    it('should reject too short API key', async () => {
      const result = await agent.invoke(
        {
          credential: 'short',
          method: 'api_key',
        },
        context
      );

      expect(result.output.authenticated).toBe(false);
      expect(result.output.status).toBe('malformed');
    });

    it('should use verification callback when provided', async () => {
      const verifyCallback = vi.fn().mockResolvedValue({
        valid: true,
        identity: { sub: 'api-user', name: 'API User', scopes: ['read', 'write'] },
        expiresAt: new Date(Date.now() + 3600000),
      });

      const configWithCallback: AuthAgentConfig = {
        apiKeyVerifyCallback: verifyCallback,
      };

      const agentWithCallback = createAuthAgent(configWithCallback);

      const result = await agentWithCallback.invoke(
        {
          credential: 'test-api-key-12345678901234567890',
          method: 'api_key',
        },
        context
      );

      expect(verifyCallback).toHaveBeenCalled();
      expect(result.output.authenticated).toBe(true);
      expect(result.output.claims?.sub).toBe('api-user');
      expect(result.output.scopes).toEqual(['read', 'write']);
    });

    it('should handle verification callback returning invalid', async () => {
      const verifyCallback = vi.fn().mockResolvedValue({ valid: false });

      const agentWithCallback = createAuthAgent({
        apiKeyVerifyCallback: verifyCallback,
      });

      const result = await agentWithCallback.invoke(
        {
          credential: 'test-api-key-12345678901234567890',
          method: 'api_key',
        },
        context
      );

      expect(result.output.authenticated).toBe(false);
      expect(result.output.status).toBe('revoked');
    });
  });

  describe('Basic auth validation', () => {
    it('should validate basic auth format', async () => {
      const credentials = Buffer.from('user:password').toString('base64');

      const result = await agent.invoke(
        {
          credential: credentials,
          method: 'basic',
        },
        context
      );

      expect(result.output.authenticated).toBe(true);
      expect(result.output.claims?.sub).toBe('user');
    });

    it('should reject invalid basic auth format', async () => {
      const invalidCredentials = Buffer.from('no-colon').toString('base64');

      const result = await agent.invoke(
        {
          credential: invalidCredentials,
          method: 'basic',
        },
        context
      );

      expect(result.output.authenticated).toBe(false);
      expect(result.output.status).toBe('malformed');
    });
  });

  describe('DecisionEvent emission', () => {
    it('should emit exactly one DecisionEvent per invocation', async () => {
      const { token } = await createTestJWT();

      const result = await agent.invoke(
        {
          credential: token,
          method: 'jwt',
        },
        context
      );

      // Check DecisionEvent structure
      expect(result.event.agent_id).toBe('auth-identity-agent');
      expect(result.event.agent_version).toBe('0.1.0');
      expect(result.event.decision_type).toBe('auth_identity_verification');
      expect(result.event.inputs_hash).toHaveLength(64); // SHA-256 hex
      expect(result.event.timestamp).toBeDefined();
      expect(result.event.execution_ref.trace_id).toBe(context.traceId);
    });

    it('should include confidence assessment', async () => {
      const { token, secret } = await createTestJWT();

      const result = await agent.invoke(
        {
          credential: token,
          method: 'jwt',
          verification_key: Buffer.from(secret).toString('utf-8'),
        },
        context
      );

      expect(result.event.confidence.score).toBeGreaterThan(0);
      expect(result.event.confidence.level).toBeDefined();
      expect(['high', 'medium', 'low', 'uncertain']).toContain(result.event.confidence.level);
      expect(result.event.confidence.factors).toBeDefined();
    });

    it('should include constraints applied', async () => {
      const { token } = await createTestJWT();

      const result = await agent.invoke(
        {
          credential: token,
          method: 'jwt',
        },
        context
      );

      expect(result.event.constraints_applied.connector_scope).toBe('auth');
      expect(result.event.constraints_applied.auth_context).toBeDefined();
      expect(result.event.constraints_applied.auth_context?.method).toBe('jwt');
      expect(result.event.constraints_applied.schema_boundaries).toContain('AuthAgentInputSchema');
    });

    it('should include duration', async () => {
      const { token } = await createTestJWT();

      const result = await agent.invoke(
        {
          credential: token,
          method: 'jwt',
        },
        context
      );

      expect(result.event.duration_ms).toBeDefined();
      expect(result.event.duration_ms).toBeGreaterThanOrEqual(0);
      expect(result.durationMs).toBe(result.event.duration_ms);
    });
  });

  describe('error handling', () => {
    it('should include error details for failed authentication', async () => {
      const result = await agent.invoke(
        {
          credential: 'invalid-token',
          method: 'jwt',
        },
        context
      );

      expect(result.output.authenticated).toBe(false);
      expect(result.event.error).toBeDefined();
      expect(result.event.error?.code).toBe('AUTH_MALFORMED');
      expect(result.event.error?.recoverable).toBe(false);
    });

    it('should mark expired tokens as recoverable', async () => {
      const { token, secret } = await createTestJWT({}, '-1h');

      const result = await agent.invoke(
        {
          credential: token,
          method: 'jwt',
          verification_key: Buffer.from(secret).toString('utf-8'),
        },
        context
      );

      expect(result.event.error?.code).toBe('AUTH_EXPIRED');
      expect(result.event.error?.recoverable).toBe(true);
    });
  });

  describe('token fingerprinting', () => {
    it('should generate token fingerprint', async () => {
      const { token } = await createTestJWT();

      const result = await agent.invoke(
        {
          credential: token,
          method: 'jwt',
        },
        context
      );

      expect(result.output.token_fingerprint).toBeDefined();
      expect(result.output.token_fingerprint).toHaveLength(16);
    });

    it('should produce consistent fingerprints', async () => {
      const { token } = await createTestJWT();

      const result1 = await agent.invoke(
        {
          credential: token,
          method: 'jwt',
        },
        context
      );

      const result2 = await agent.invoke(
        {
          credential: token,
          method: 'jwt',
        },
        context
      );

      expect(result1.output.token_fingerprint).toBe(result2.output.token_fingerprint);
    });
  });
});
