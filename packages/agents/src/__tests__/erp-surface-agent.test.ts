/**
 * ERP Surface Agent Tests
 *
 * Tests for the ERP Surface Agent which:
 * - Surfaces ERP data through a read-only interface
 * - Validates ERP entity queries
 * - Enforces access controls and scoping
 * - Emits DecisionEvent with ERP data
 * - Handles ERP-specific authentication
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DecisionEventSchema,
  AgentResponseSchema,
  type AgentResponse,
  type IAgent,
} from '../contracts/types';

/**
 * Mock ERP Surface Agent implementation for testing
 */
class ERPSurfaceAgent implements IAgent {
  readonly agentId = 'erp-surface-agent';
  readonly version = '1.0.0';
  readonly decisionType = 'erp_surface_event' as const;

  private initialized = false;
  private readonly allowedEntities = ['customers', 'orders', 'products', 'invoices'];
  private readonly forbiddenOperations = ['write', 'update', 'delete', 'create'];

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

    const erpInput = input as Record<string, unknown>;

    // Validate required fields
    if (!erpInput.entity || typeof erpInput.entity !== 'string') {
      return this.createErrorResponse('MISSING_ENTITY', 'Entity field is required', false);
    }

    if (!erpInput.operation || typeof erpInput.operation !== 'string') {
      return this.createErrorResponse('MISSING_OPERATION', 'Operation field is required', false);
    }

    const entity = erpInput.entity as string;
    const operation = erpInput.operation as string;

    // Validate entity is allowed
    if (!this.allowedEntities.includes(entity.toLowerCase())) {
      return this.createErrorResponse(
        'INVALID_ENTITY',
        `Entity "${entity}" is not allowed. Allowed entities: ${this.allowedEntities.join(', ')}`,
        false
      );
    }

    // Enforce read-only operations
    if (this.forbiddenOperations.includes(operation.toLowerCase())) {
      return this.createErrorResponse(
        'FORBIDDEN_OPERATION',
        `Operation "${operation}" is not allowed. Only read operations are permitted.`,
        false
      );
    }

    // Validate auth context
    if (!erpInput.auth_context) {
      return {
        status: 'auth_failed',
        error: {
          code: 'MISSING_AUTH_CONTEXT',
          message: 'ERP operations require authentication context',
          retryable: false,
        },
      };
    }

    const authContext = erpInput.auth_context as Record<string, unknown>;
    if (!authContext.tenant_id) {
      return {
        status: 'auth_failed',
        error: {
          code: 'MISSING_TENANT_ID',
          message: 'Tenant ID is required in auth context',
          retryable: false,
        },
      };
    }

    try {
      // Simulate ERP data retrieval
      const mockData = {
        entity,
        operation,
        results: [
          { id: 1, name: `Test ${entity} 1` },
          { id: 2, name: `Test ${entity} 2` },
        ],
        total_count: 2,
      };

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
          entity,
          operation,
          data: mockData.results,
          metadata: {
            total_count: mockData.total_count,
            retrieved_at: new Date().toISOString(),
          },
        },
        confidence: {
          score: 0.98,
          auth_assurance: 'verified' as const,
          schema_validation: 'passed' as const,
        },
        constraints_applied: {
          connector_scope: 'erp-connector',
          identity_context: `tenant-${authContext.tenant_id}`,
          schema_boundaries: [entity, 'read-only'],
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
          validation_time_ms: 4,
        },
      };
    } catch (error) {
      return this.createErrorResponse(
        'ERP_ACCESS_ERROR',
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
      status: code.includes('INVALID') || code.includes('MISSING') || code.includes('FORBIDDEN') ? 'validation_failed' : 'error',
      error: {
        code,
        message,
        retryable,
      },
    };
  }
}

describe('ERPSurfaceAgent', () => {
  let agent: ERPSurfaceAgent;

  beforeEach(async () => {
    agent = new ERPSurfaceAgent();
    await agent.initialize();
  });

  afterEach(async () => {
    await agent.shutdown();
  });

  describe('Successful ERP Data Surfacing', () => {
    it('should surface ERP data successfully', async () => {
      const input = {
        entity: 'customers',
        operation: 'read',
        auth_context: { tenant_id: 'tenant-123' },
      };

      const response = await agent.process(input);

      expect(response.status).toBe('success');
      expect(response.decision_event).toBeDefined();
      expect(response.decision_event?.decision_type).toBe('erp_surface_event');
    });

    it('should return ERP data in outputs', async () => {
      const input = {
        entity: 'orders',
        operation: 'read',
        auth_context: { tenant_id: 'tenant-456' },
      };

      const response = await agent.process(input);

      expect(response.decision_event?.outputs.entity).toBe('orders');
      expect(response.decision_event?.outputs.operation).toBe('read');
      expect(response.decision_event?.outputs.data).toBeDefined();
      expect(Array.isArray(response.decision_event?.outputs.data)).toBe(true);
    });

    it('should include metadata with retrieval timestamp', async () => {
      const input = {
        entity: 'products',
        operation: 'read',
        auth_context: { tenant_id: 'tenant-789' },
      };

      const response = await agent.process(input);

      expect(response.decision_event?.outputs.metadata).toBeDefined();
      expect(response.decision_event?.outputs.metadata.retrieved_at).toBeDefined();
      expect(response.decision_event?.outputs.metadata.total_count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Input Validation', () => {
    it('should reject null input', async () => {
      const response = await agent.process(null);

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('INVALID_INPUT');
    });

    it('should reject input without entity', async () => {
      const response = await agent.process({
        operation: 'read',
        auth_context: { tenant_id: 'tenant-123' },
      });

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('MISSING_ENTITY');
    });

    it('should reject input without operation', async () => {
      const response = await agent.process({
        entity: 'customers',
        auth_context: { tenant_id: 'tenant-123' },
      });

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('MISSING_OPERATION');
    });

    it('should reject invalid entity type', async () => {
      const response = await agent.process({
        entity: 123,
        operation: 'read',
        auth_context: { tenant_id: 'tenant-123' },
      });

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('MISSING_ENTITY');
    });
  });

  describe('Entity Access Control', () => {
    it('should accept all allowed entities', async () => {
      const allowedEntities = ['customers', 'orders', 'products', 'invoices'];

      for (const entity of allowedEntities) {
        const response = await agent.process({
          entity,
          operation: 'read',
          auth_context: { tenant_id: 'tenant-123' },
        });

        expect(response.status).toBe('success');
      }
    });

    it('should reject disallowed entity', async () => {
      const response = await agent.process({
        entity: 'employees',
        operation: 'read',
        auth_context: { tenant_id: 'tenant-123' },
      });

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('INVALID_ENTITY');
      expect(response.error?.message).toContain('employees');
    });

    it('should be case-insensitive for entity names', async () => {
      const response = await agent.process({
        entity: 'CUSTOMERS',
        operation: 'read',
        auth_context: { tenant_id: 'tenant-123' },
      });

      expect(response.status).toBe('success');
    });
  });

  describe('Read-Only Operation Enforcement', () => {
    it('should accept read operation', async () => {
      const response = await agent.process({
        entity: 'customers',
        operation: 'read',
        auth_context: { tenant_id: 'tenant-123' },
      });

      expect(response.status).toBe('success');
    });

    it('should accept query operation', async () => {
      const response = await agent.process({
        entity: 'orders',
        operation: 'query',
        auth_context: { tenant_id: 'tenant-123' },
      });

      expect(response.status).toBe('success');
    });

    it('should reject write operation', async () => {
      const response = await agent.process({
        entity: 'customers',
        operation: 'write',
        auth_context: { tenant_id: 'tenant-123' },
      });

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('FORBIDDEN_OPERATION');
      expect(response.error?.message).toContain('write');
    });

    it('should reject update operation', async () => {
      const response = await agent.process({
        entity: 'orders',
        operation: 'update',
        auth_context: { tenant_id: 'tenant-123' },
      });

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('FORBIDDEN_OPERATION');
    });

    it('should reject delete operation', async () => {
      const response = await agent.process({
        entity: 'products',
        operation: 'delete',
        auth_context: { tenant_id: 'tenant-123' },
      });

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('FORBIDDEN_OPERATION');
    });

    it('should reject create operation', async () => {
      const response = await agent.process({
        entity: 'invoices',
        operation: 'create',
        auth_context: { tenant_id: 'tenant-123' },
      });

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('FORBIDDEN_OPERATION');
    });
  });

  describe('Authentication Handling', () => {
    it('should reject request without auth_context', async () => {
      const response = await agent.process({
        entity: 'customers',
        operation: 'read',
      });

      expect(response.status).toBe('auth_failed');
      expect(response.error?.code).toBe('MISSING_AUTH_CONTEXT');
    });

    it('should reject auth_context without tenant_id', async () => {
      const response = await agent.process({
        entity: 'customers',
        operation: 'read',
        auth_context: { user_id: 'user-123' },
      });

      expect(response.status).toBe('auth_failed');
      expect(response.error?.code).toBe('MISSING_TENANT_ID');
    });

    it('should include tenant in identity_context', async () => {
      const response = await agent.process({
        entity: 'customers',
        operation: 'read',
        auth_context: { tenant_id: 'acme-corp' },
      });

      expect(response.decision_event?.constraints_applied.identity_context).toBe(
        'tenant-acme-corp'
      );
    });

    it('should have verified auth_assurance for valid context', async () => {
      const response = await agent.process({
        entity: 'customers',
        operation: 'read',
        auth_context: { tenant_id: 'tenant-123' },
      });

      expect(response.decision_event?.confidence.auth_assurance).toBe('verified');
    });
  });

  describe('DecisionEvent Emission', () => {
    it('should emit exactly ONE DecisionEvent per successful invocation', async () => {
      const input = {
        entity: 'customers',
        operation: 'read',
        auth_context: { tenant_id: 'tenant-123' },
      };

      const response = await agent.process(input);

      expect(response.decision_event).toBeDefined();

      // Validate schema
      const validationResult = DecisionEventSchema.safeParse(response.decision_event);
      expect(validationResult.success).toBe(true);
    });

    it('should not emit DecisionEvent on validation failure', async () => {
      const response = await agent.process({ entity: 'invalid' });

      expect(response.decision_event).toBeUndefined();
    });

    it('should not emit DecisionEvent on auth failure', async () => {
      const response = await agent.process({
        entity: 'customers',
        operation: 'read',
      });

      expect(response.decision_event).toBeUndefined();
    });

    it('should include entity in schema_boundaries', async () => {
      const response = await agent.process({
        entity: 'products',
        operation: 'read',
        auth_context: { tenant_id: 'tenant-123' },
      });

      expect(response.decision_event?.constraints_applied.schema_boundaries).toContain('products');
      expect(response.decision_event?.constraints_applied.schema_boundaries).toContain('read-only');
    });

    it('should include connector_scope', async () => {
      const response = await agent.process({
        entity: 'orders',
        operation: 'read',
        auth_context: { tenant_id: 'tenant-123' },
      });

      expect(response.decision_event?.constraints_applied.connector_scope).toBe('erp-connector');
    });
  });

  describe('Error Handling', () => {
    it('should validate response against AgentResponse schema', async () => {
      const input = {
        entity: 'customers',
        operation: 'read',
        auth_context: { tenant_id: 'tenant-123' },
      };

      const response = await agent.process(input);

      const validationResult = AgentResponseSchema.safeParse(response);
      expect(validationResult.success).toBe(true);
    });

    it('should return non-retryable error for validation failures', async () => {
      const response = await agent.process({ entity: 'invalid' });

      expect(response.error?.retryable).toBe(false);
    });

    it('should return non-retryable error for auth failures', async () => {
      const response = await agent.process({
        entity: 'customers',
        operation: 'read',
      });

      expect(response.error?.retryable).toBe(false);
    });
  });

  describe('Telemetry', () => {
    it('should include telemetry in successful response', async () => {
      const input = {
        entity: 'customers',
        operation: 'read',
        auth_context: { tenant_id: 'tenant-123' },
      };

      const response = await agent.process(input);

      expect(response.telemetry).toBeDefined();
      expect(response.telemetry?.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should track validation time', async () => {
      const input = {
        entity: 'orders',
        operation: 'read',
        auth_context: { tenant_id: 'tenant-123' },
      };

      const response = await agent.process(input);

      expect(response.telemetry?.validation_time_ms).toBeDefined();
    });
  });

  describe('Agent Metadata', () => {
    it('should have correct agentId', () => {
      expect(agent.agentId).toBe('erp-surface-agent');
    });

    it('should have semantic version', () => {
      expect(agent.version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('should have correct decisionType', () => {
      expect(agent.decisionType).toBe('erp_surface_event');
    });
  });
});
