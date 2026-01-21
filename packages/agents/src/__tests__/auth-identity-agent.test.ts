/**
 * Auth Identity Agent Tests
 *
 * Tests for the Auth Identity Agent which:
 * - Verifies user identity and credentials
 * - Validates authentication tokens
 * - Emits DecisionEvent with identity verification results
 * - Handles various auth methods (JWT, API key, OAuth)
 * - Enforces identity boundaries
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DecisionEventSchema,
  AgentResponseSchema,
  type AgentResponse,
  type IAgent,
} from '../contracts/types';

/**
 * Mock Auth Identity Agent implementation for testing
 */
class AuthIdentityAgent implements IAgent {
  readonly agentId = 'auth-identity-agent';
  readonly version = '1.0.0';
  readonly decisionType = 'auth_identity_verification' as const;

  private initialized = false;
  private readonly validApiKeys = new Set(['api-key-valid-123', 'api-key-admin-456']);
  private readonly validJwtPrefix = 'jwt-valid-';

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async process(input: unknown): Promise<AgentResponse> {
    const startTime = Date.now();

    if (!this.initialized) {
      return this.createErrorResponse('NOT_INITIALIZED', 'Agent not initialized', false);
    }

    // Input validation
    if (typeof input !== 'object' || input === null) {
      return this.createErrorResponse('INVALID_INPUT', 'Input must be an object', false);
    }

    const authInput = input as Record<string, unknown>;

    // Validate auth_type
    if (!authInput.auth_type || typeof authInput.auth_type !== 'string') {
      return this.createErrorResponse('MISSING_AUTH_TYPE', 'auth_type field is required', false);
    }

    const authType = authInput.auth_type as string;
    const validAuthTypes = ['api_key', 'jwt', 'oauth', 'basic'];

    if (!validAuthTypes.includes(authType)) {
      return this.createErrorResponse(
        'INVALID_AUTH_TYPE',
        `auth_type must be one of: ${validAuthTypes.join(', ')}`,
        false
      );
    }

    // Validate credentials field exists
    if (!authInput.credentials) {
      return {
        status: 'auth_failed',
        error: {
          code: 'MISSING_CREDENTIALS',
          message: 'Credentials are required',
          retryable: false,
        },
      };
    }

    try {
      let verified = false;
      let userId: string | undefined;
      let authAssurance: 'none' | 'low' | 'medium' | 'high' | 'verified' = 'none';
      let scope: string[] = [];

      // Verify credentials based on auth_type
      if (authType === 'api_key') {
        const apiKey = authInput.credentials as string;
        if (this.validApiKeys.has(apiKey)) {
          verified = true;
          userId = `user-${apiKey.substring(8)}`;
          authAssurance = 'verified';
          scope = apiKey.includes('admin') ? ['read', 'write', 'admin'] : ['read'];
        }
      } else if (authType === 'jwt') {
        const jwt = authInput.credentials as string;
        if (typeof jwt === 'string' && jwt.startsWith(this.validJwtPrefix)) {
          verified = true;
          userId = `user-${jwt.substring(this.validJwtPrefix.length)}`;
          authAssurance = 'high';
          scope = ['read', 'write'];
        }
      } else if (authType === 'oauth') {
        const oauth = authInput.credentials as Record<string, unknown>;
        if (oauth && oauth.access_token) {
          verified = true;
          userId = 'user-oauth';
          authAssurance = 'medium';
          scope = ['read'];
        }
      } else if (authType === 'basic') {
        const basic = authInput.credentials as Record<string, unknown>;
        if (basic && basic.username === 'admin' && basic.password === 'password') {
          verified = true;
          userId = 'user-admin';
          authAssurance = 'low';
          scope = ['read', 'write'];
        }
      }

      if (!verified) {
        return {
          status: 'auth_failed',
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Credentials verification failed',
            retryable: false,
          },
        };
      }

      // Create DecisionEvent
      const crypto = require('crypto');
      const inputsHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(input))
        .digest('hex');

      const decisionEvent = {
        agent_id: this.agentId,
        agent_version: this.version,
        decision_type: this.decisionType,
        inputs_hash: inputsHash,
        outputs: {
          verified,
          user_id: userId,
          auth_type: authType,
          scope,
          verified_at: new Date().toISOString(),
        },
        confidence: {
          score: verified ? 1.0 : 0.0,
          auth_assurance: authAssurance,
        },
        constraints_applied: {
          connector_scope: 'auth-connector',
          identity_context: userId,
          schema_boundaries: [authType, 'identity-verification'],
        },
        execution_ref: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      };

      const duration = Date.now() - startTime;

      return {
        status: 'success',
        decision_event: decisionEvent,
        telemetry: {
          duration_ms: duration,
          validation_time_ms: 2,
        },
      };
    } catch (error) {
      return this.createErrorResponse(
        'VERIFICATION_ERROR',
        error instanceof Error ? error.message : 'Unknown error',
        true
      );
    }
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  async healthCheck(): Promise<boolean> {
    return this.initialized;
  }

  private createErrorResponse(
    code: string,
    message: string,
    retryable: boolean
  ): AgentResponse {
    return {
      status: code.includes('INVALID') || code.includes('MISSING') ? 'validation_failed' : 'error',
      error: {
        code,
        message,
        retryable,
      },
    };
  }
}

describe('AuthIdentityAgent', () => {
  let agent: AuthIdentityAgent;

  beforeEach(async () => {
    agent = new AuthIdentityAgent();
    await agent.initialize();
  });

  afterEach(async () => {
    await agent.shutdown();
  });

  describe('Successful Identity Verification', () => {
    it('should verify valid API key successfully', async () => {
      const input = {
        auth_type: 'api_key',
        credentials: 'api-key-valid-123',
      };

      const response = await agent.process(input);

      expect(response.status).toBe('success');
      expect(response.decision_event).toBeDefined();
      expect(response.decision_event?.decision_type).toBe('auth_identity_verification');
      expect(response.decision_event?.outputs.verified).toBe(true);
    });

    it('should verify valid JWT successfully', async () => {
      const input = {
        auth_type: 'jwt',
        credentials: 'jwt-valid-user789',
      };

      const response = await agent.process(input);

      expect(response.status).toBe('success');
      expect(response.decision_event?.outputs.verified).toBe(true);
      expect(response.decision_event?.outputs.user_id).toBe('user-user789');
    });

    it('should verify OAuth token successfully', async () => {
      const input = {
        auth_type: 'oauth',
        credentials: { access_token: 'oauth-token-123' },
      };

      const response = await agent.process(input);

      expect(response.status).toBe('success');
      expect(response.decision_event?.outputs.verified).toBe(true);
    });

    it('should verify basic auth successfully', async () => {
      const input = {
        auth_type: 'basic',
        credentials: { username: 'admin', password: 'password' },
      };

      const response = await agent.process(input);

      expect(response.status).toBe('success');
      expect(response.decision_event?.outputs.verified).toBe(true);
    });
  });

  describe('Input Validation', () => {
    it('should reject null input', async () => {
      const response = await agent.process(null);

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('INVALID_INPUT');
    });

    it('should reject input without auth_type', async () => {
      const response = await agent.process({
        credentials: 'api-key-valid-123',
      });

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('MISSING_AUTH_TYPE');
    });

    it('should reject input with invalid auth_type', async () => {
      const response = await agent.process({
        auth_type: 'invalid-type',
        credentials: 'test',
      });

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('INVALID_AUTH_TYPE');
    });

    it('should reject input without credentials', async () => {
      const response = await agent.process({
        auth_type: 'api_key',
      });

      expect(response.status).toBe('auth_failed');
      expect(response.error?.code).toBe('MISSING_CREDENTIALS');
    });
  });

  describe('Auth Type Validation', () => {
    it('should accept api_key auth type', async () => {
      const response = await agent.process({
        auth_type: 'api_key',
        credentials: 'api-key-valid-123',
      });

      expect(response.status).toBe('success');
    });

    it('should accept jwt auth type', async () => {
      const response = await agent.process({
        auth_type: 'jwt',
        credentials: 'jwt-valid-test',
      });

      expect(response.status).toBe('success');
    });

    it('should accept oauth auth type', async () => {
      const response = await agent.process({
        auth_type: 'oauth',
        credentials: { access_token: 'token' },
      });

      expect(response.status).toBe('success');
    });

    it('should accept basic auth type', async () => {
      const response = await agent.process({
        auth_type: 'basic',
        credentials: { username: 'admin', password: 'password' },
      });

      expect(response.status).toBe('success');
    });
  });

  describe('Credential Verification', () => {
    it('should reject invalid API key', async () => {
      const response = await agent.process({
        auth_type: 'api_key',
        credentials: 'api-key-invalid-999',
      });

      expect(response.status).toBe('auth_failed');
      expect(response.error?.code).toBe('INVALID_CREDENTIALS');
    });

    it('should reject invalid JWT', async () => {
      const response = await agent.process({
        auth_type: 'jwt',
        credentials: 'jwt-invalid-token',
      });

      expect(response.status).toBe('auth_failed');
      expect(response.error?.code).toBe('INVALID_CREDENTIALS');
    });

    it('should reject OAuth without access_token', async () => {
      const response = await agent.process({
        auth_type: 'oauth',
        credentials: { refresh_token: 'token' },
      });

      expect(response.status).toBe('auth_failed');
      expect(response.error?.code).toBe('INVALID_CREDENTIALS');
    });

    it('should reject invalid basic auth credentials', async () => {
      const response = await agent.process({
        auth_type: 'basic',
        credentials: { username: 'wrong', password: 'wrong' },
      });

      expect(response.status).toBe('auth_failed');
      expect(response.error?.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('Auth Assurance Levels', () => {
    it('should return "verified" assurance for valid API key', async () => {
      const response = await agent.process({
        auth_type: 'api_key',
        credentials: 'api-key-valid-123',
      });

      expect(response.decision_event?.confidence.auth_assurance).toBe('verified');
    });

    it('should return "high" assurance for valid JWT', async () => {
      const response = await agent.process({
        auth_type: 'jwt',
        credentials: 'jwt-valid-user',
      });

      expect(response.decision_event?.confidence.auth_assurance).toBe('high');
    });

    it('should return "medium" assurance for OAuth', async () => {
      const response = await agent.process({
        auth_type: 'oauth',
        credentials: { access_token: 'token' },
      });

      expect(response.decision_event?.confidence.auth_assurance).toBe('medium');
    });

    it('should return "low" assurance for basic auth', async () => {
      const response = await agent.process({
        auth_type: 'basic',
        credentials: { username: 'admin', password: 'password' },
      });

      expect(response.decision_event?.confidence.auth_assurance).toBe('low');
    });
  });

  describe('Scope Assignment', () => {
    it('should assign admin scope for admin API key', async () => {
      const response = await agent.process({
        auth_type: 'api_key',
        credentials: 'api-key-admin-456',
      });

      expect(response.decision_event?.outputs.scope).toContain('admin');
      expect(response.decision_event?.outputs.scope).toContain('read');
      expect(response.decision_event?.outputs.scope).toContain('write');
    });

    it('should assign read-only scope for non-admin API key', async () => {
      const response = await agent.process({
        auth_type: 'api_key',
        credentials: 'api-key-valid-123',
      });

      expect(response.decision_event?.outputs.scope).toContain('read');
      expect(response.decision_event?.outputs.scope).not.toContain('admin');
    });

    it('should assign read/write scope for JWT', async () => {
      const response = await agent.process({
        auth_type: 'jwt',
        credentials: 'jwt-valid-user',
      });

      expect(response.decision_event?.outputs.scope).toContain('read');
      expect(response.decision_event?.outputs.scope).toContain('write');
    });

    it('should assign read scope for OAuth', async () => {
      const response = await agent.process({
        auth_type: 'oauth',
        credentials: { access_token: 'token' },
      });

      expect(response.decision_event?.outputs.scope).toContain('read');
    });
  });

  describe('DecisionEvent Emission', () => {
    it('should emit exactly ONE DecisionEvent per successful verification', async () => {
      const input = {
        auth_type: 'api_key',
        credentials: 'api-key-valid-123',
      };

      const response = await agent.process(input);

      expect(response.decision_event).toBeDefined();

      // Validate schema
      const validationResult = DecisionEventSchema.safeParse(response.decision_event);
      expect(validationResult.success).toBe(true);
    });

    it('should not emit DecisionEvent on validation failure', async () => {
      const response = await agent.process({ auth_type: 'invalid' });

      expect(response.decision_event).toBeUndefined();
    });

    it('should not emit DecisionEvent on auth failure', async () => {
      const response = await agent.process({
        auth_type: 'api_key',
        credentials: 'invalid-key',
      });

      expect(response.decision_event).toBeUndefined();
    });

    it('should include user_id in outputs', async () => {
      const response = await agent.process({
        auth_type: 'api_key',
        credentials: 'api-key-valid-123',
      });

      expect(response.decision_event?.outputs.user_id).toBeDefined();
      expect(typeof response.decision_event?.outputs.user_id).toBe('string');
    });

    it('should include verification timestamp', async () => {
      const response = await agent.process({
        auth_type: 'jwt',
        credentials: 'jwt-valid-test',
      });

      expect(response.decision_event?.outputs.verified_at).toBeDefined();
      expect(() => new Date(response.decision_event!.outputs.verified_at as string)).not.toThrow();
    });

    it('should have confidence score of 1.0 for successful verification', async () => {
      const response = await agent.process({
        auth_type: 'api_key',
        credentials: 'api-key-valid-123',
      });

      expect(response.decision_event?.confidence.score).toBe(1.0);
    });

    it('should include auth_type in schema_boundaries', async () => {
      const response = await agent.process({
        auth_type: 'jwt',
        credentials: 'jwt-valid-user',
      });

      expect(response.decision_event?.constraints_applied.schema_boundaries).toContain('jwt');
      expect(response.decision_event?.constraints_applied.schema_boundaries).toContain(
        'identity-verification'
      );
    });

    it('should include identity_context with user_id', async () => {
      const response = await agent.process({
        auth_type: 'api_key',
        credentials: 'api-key-valid-123',
      });

      expect(response.decision_event?.constraints_applied.identity_context).toBeDefined();
      expect(response.decision_event?.constraints_applied.identity_context).toContain('user-');
    });
  });

  describe('Error Handling', () => {
    it('should validate response against AgentResponse schema', async () => {
      const input = {
        auth_type: 'api_key',
        credentials: 'api-key-valid-123',
      };

      const response = await agent.process(input);

      const validationResult = AgentResponseSchema.safeParse(response);
      expect(validationResult.success).toBe(true);
    });

    it('should return non-retryable error for validation failures', async () => {
      const response = await agent.process({ auth_type: 'invalid' });

      expect(response.error?.retryable).toBe(false);
    });

    it('should return non-retryable error for auth failures', async () => {
      const response = await agent.process({
        auth_type: 'api_key',
        credentials: 'invalid',
      });

      expect(response.error?.retryable).toBe(false);
    });
  });

  describe('Telemetry', () => {
    it('should include telemetry in successful response', async () => {
      const input = {
        auth_type: 'api_key',
        credentials: 'api-key-valid-123',
      };

      const response = await agent.process(input);

      expect(response.telemetry).toBeDefined();
      expect(response.telemetry?.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should track validation time', async () => {
      const input = {
        auth_type: 'jwt',
        credentials: 'jwt-valid-user',
      };

      const response = await agent.process(input);

      expect(response.telemetry?.validation_time_ms).toBeDefined();
    });
  });

  describe('Agent Metadata', () => {
    it('should have correct agentId', () => {
      expect(agent.agentId).toBe('auth-identity-agent');
    });

    it('should have semantic version', () => {
      expect(agent.version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('should have correct decisionType', () => {
      expect(agent.decisionType).toBe('auth_identity_verification');
    });
  });
});
