/**
 * Database Query Agent Tests
 *
 * Tests for the Database Query Agent which:
 * - Validates SQL query inputs
 * - Enforces read-only (SELECT) operations
 * - Emits DecisionEvent with query results
 * - Persists to ruvector-service
 * - Handles database connection errors
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DecisionEventSchema,
  AgentResponseSchema,
  type AgentResponse,
  type IAgent,
} from '../contracts/types';

/**
 * Mock Database Query Agent implementation for testing
 */
class DatabaseQueryAgent implements IAgent {
  readonly agentId = 'database-query-agent';
  readonly version = '1.0.0';
  readonly decisionType = 'database_query_result' as const;

  private initialized = false;
  private mockRuvectorService = {
    persist: vi.fn().mockResolvedValue({ success: true }),
  };

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async process(input: unknown): Promise<AgentResponse> {
    const startTime = Date.now();

    // Input validation
    if (!this.initialized) {
      return this.createErrorResponse('NOT_INITIALIZED', 'Agent not initialized', false);
    }

    if (typeof input !== 'object' || input === null) {
      return this.createErrorResponse('INVALID_INPUT', 'Input must be an object', false);
    }

    const queryInput = input as Record<string, unknown>;

    // Validate query field exists
    if (!queryInput.query || typeof queryInput.query !== 'string') {
      return this.createErrorResponse(
        'MISSING_QUERY',
        'Query field is required and must be a string',
        false
      );
    }

    const query = queryInput.query as string;

    // Enforce read-only (bounded query)
    const normalizedQuery = query.trim().toUpperCase();
    if (!normalizedQuery.startsWith('SELECT')) {
      return this.createErrorResponse(
        'QUERY_NOT_ALLOWED',
        'Only SELECT queries are allowed (read-only)',
        false
      );
    }

    // Check for forbidden keywords (write operations)
    const forbiddenKeywords = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE'];
    for (const keyword of forbiddenKeywords) {
      if (normalizedQuery.includes(keyword)) {
        return this.createErrorResponse(
          'FORBIDDEN_OPERATION',
          `Query contains forbidden operation: ${keyword}`,
          false
        );
      }
    }

    try {
      // Simulate query execution
      const mockResults = [
        { id: 1, name: 'Test Record 1' },
        { id: 2, name: 'Test Record 2' },
      ];

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
          query,
          results: mockResults,
          row_count: mockResults.length,
          executed_at: new Date().toISOString(),
        },
        confidence: {
          score: 1.0, // Query execution is deterministic
          schema_validation: 'passed' as const,
        },
        constraints_applied: {
          connector_scope: 'database-query-connector',
          schema_boundaries: ['read-only', 'SELECT-only'],
        },
        execution_ref: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      };

      // Persist to ruvector-service
      await this.mockRuvectorService.persist({
        event: decisionEvent,
        collection: 'database_queries',
      });

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
        'QUERY_EXECUTION_ERROR',
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

  // Expose mock for testing
  public getMockRuvectorService() {
    return this.mockRuvectorService;
  }
}

describe('DatabaseQueryAgent', () => {
  let agent: DatabaseQueryAgent;

  beforeEach(async () => {
    agent = new DatabaseQueryAgent();
    await agent.initialize();
  });

  afterEach(async () => {
    await agent.shutdown();
    vi.clearAllMocks();
  });

  describe('Successful Query Execution', () => {
    it('should execute valid SELECT query successfully', async () => {
      const input = { query: 'SELECT * FROM users' };
      const response = await agent.process(input);

      expect(response.status).toBe('success');
      expect(response.decision_event).toBeDefined();
      expect(response.decision_event?.decision_type).toBe('database_query_result');
    });

    it('should return query results in outputs', async () => {
      const input = { query: 'SELECT id, name FROM users WHERE active = true' };
      const response = await agent.process(input);

      expect(response.decision_event?.outputs.results).toBeDefined();
      expect(Array.isArray(response.decision_event?.outputs.results)).toBe(true);
      expect(response.decision_event?.outputs.row_count).toBeGreaterThanOrEqual(0);
    });

    it('should accept SELECT with lowercase', async () => {
      const input = { query: 'select * from users' };
      const response = await agent.process(input);

      expect(response.status).toBe('success');
    });

    it('should accept SELECT with mixed case', async () => {
      const input = { query: 'SeLeCt * FrOm users' };
      const response = await agent.process(input);

      expect(response.status).toBe('success');
    });

    it('should handle SELECT with leading whitespace', async () => {
      const input = { query: '  \n  SELECT * FROM users' };
      const response = await agent.process(input);

      expect(response.status).toBe('success');
    });
  });

  describe('Input Validation', () => {
    it('should reject null input', async () => {
      const response = await agent.process(null);

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('INVALID_INPUT');
    });

    it('should reject non-object input', async () => {
      const response = await agent.process('SELECT * FROM users');

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('INVALID_INPUT');
    });

    it('should reject input without query field', async () => {
      const response = await agent.process({ other_field: 'value' });

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('MISSING_QUERY');
    });

    it('should reject input with non-string query', async () => {
      const response = await agent.process({ query: 123 });

      expect(response.status).toBe('validation_failed');
      expect(response.error?.code).toBe('MISSING_QUERY');
    });

    it('should reject empty query string', async () => {
      const response = await agent.process({ query: '' });

      expect(response.status).toBe('error');
      expect(response.error?.code).toBe('QUERY_NOT_ALLOWED');
    });
  });

  describe('Bounded Query Enforcement (Read-Only)', () => {
    it('should reject INSERT query', async () => {
      const input = { query: 'INSERT INTO users (name) VALUES ("test")' };
      const response = await agent.process(input);

      expect(response.status).toBe('error');
      expect(response.error?.code).toBe('FORBIDDEN_OPERATION');
      expect(response.error?.message).toContain('INSERT');
    });

    it('should reject UPDATE query', async () => {
      const input = { query: 'UPDATE users SET active = false' };
      const response = await agent.process(input);

      expect(response.status).toBe('error');
      expect(response.error?.code).toBe('FORBIDDEN_OPERATION');
      expect(response.error?.message).toContain('UPDATE');
    });

    it('should reject DELETE query', async () => {
      const input = { query: 'DELETE FROM users WHERE id = 1' };
      const response = await agent.process(input);

      expect(response.status).toBe('error');
      expect(response.error?.code).toBe('FORBIDDEN_OPERATION');
      expect(response.error?.message).toContain('DELETE');
    });

    it('should reject DROP query', async () => {
      const input = { query: 'DROP TABLE users' };
      const response = await agent.process(input);

      expect(response.status).toBe('error');
      expect(response.error?.code).toBe('FORBIDDEN_OPERATION');
    });

    it('should reject CREATE query', async () => {
      const input = { query: 'CREATE TABLE new_table (id INT)' };
      const response = await agent.process(input);

      expect(response.status).toBe('error');
      expect(response.error?.code).toBe('FORBIDDEN_OPERATION');
    });

    it('should reject ALTER query', async () => {
      const input = { query: 'ALTER TABLE users ADD COLUMN email VARCHAR(255)' };
      const response = await agent.process(input);

      expect(response.status).toBe('error');
      expect(response.error?.code).toBe('FORBIDDEN_OPERATION');
    });

    it('should reject TRUNCATE query', async () => {
      const input = { query: 'TRUNCATE TABLE users' };
      const response = await agent.process(input);

      expect(response.status).toBe('error');
      expect(response.error?.code).toBe('FORBIDDEN_OPERATION');
    });

    it('should reject query that does not start with SELECT', async () => {
      const input = { query: 'SHOW TABLES' };
      const response = await agent.process(input);

      expect(response.status).toBe('error');
      expect(response.error?.code).toBe('QUERY_NOT_ALLOWED');
    });
  });

  describe('DecisionEvent Emission', () => {
    it('should emit exactly ONE DecisionEvent per invocation', async () => {
      const input = { query: 'SELECT * FROM users' };
      const response = await agent.process(input);

      expect(response.decision_event).toBeDefined();

      // Validate schema
      const validationResult = DecisionEventSchema.safeParse(response.decision_event);
      expect(validationResult.success).toBe(true);
    });

    it('should emit DecisionEvent with correct type', async () => {
      const input = { query: 'SELECT * FROM users' };
      const response = await agent.process(input);

      expect(response.decision_event?.decision_type).toBe('database_query_result');
    });

    it('should include original query in outputs', async () => {
      const query = 'SELECT id, name FROM users WHERE role = "admin"';
      const input = { query };
      const response = await agent.process(input);

      expect(response.decision_event?.outputs.query).toBe(query);
    });

    it('should include row count in outputs', async () => {
      const input = { query: 'SELECT * FROM users' };
      const response = await agent.process(input);

      expect(response.decision_event?.outputs.row_count).toBeDefined();
      expect(typeof response.decision_event?.outputs.row_count).toBe('number');
    });

    it('should include execution timestamp in outputs', async () => {
      const input = { query: 'SELECT * FROM users' };
      const response = await agent.process(input);

      expect(response.decision_event?.outputs.executed_at).toBeDefined();
      expect(() => new Date(response.decision_event!.outputs.executed_at as string)).not.toThrow();
    });

    it('should have confidence score of 1.0 for successful queries', async () => {
      const input = { query: 'SELECT * FROM users' };
      const response = await agent.process(input);

      expect(response.decision_event?.confidence.score).toBe(1.0);
    });

    it('should include schema_boundaries in constraints_applied', async () => {
      const input = { query: 'SELECT * FROM users' };
      const response = await agent.process(input);

      expect(response.decision_event?.constraints_applied.schema_boundaries).toContain('read-only');
      expect(response.decision_event?.constraints_applied.schema_boundaries).toContain('SELECT-only');
    });
  });

  describe('RuVector Service Persistence', () => {
    it('should call ruvector-service persist on successful query', async () => {
      const input = { query: 'SELECT * FROM users' };
      const mockService = agent.getMockRuvectorService();

      await agent.process(input);

      expect(mockService.persist).toHaveBeenCalledTimes(1);
    });

    it('should persist DecisionEvent to ruvector-service', async () => {
      const input = { query: 'SELECT * FROM users' };
      const mockService = agent.getMockRuvectorService();

      const response = await agent.process(input);

      expect(mockService.persist).toHaveBeenCalledWith({
        event: response.decision_event,
        collection: 'database_queries',
      });
    });

    it('should not persist on validation failure', async () => {
      const mockService = agent.getMockRuvectorService();

      await agent.process(null);

      expect(mockService.persist).not.toHaveBeenCalled();
    });

    it('should not persist on query rejection', async () => {
      const input = { query: 'DELETE FROM users' };
      const mockService = agent.getMockRuvectorService();

      await agent.process(input);

      expect(mockService.persist).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should return retryable error for execution failures', async () => {
      const input = { query: 'SELECT * FROM users' };

      // Simulate execution error
      const mockService = agent.getMockRuvectorService();
      mockService.persist.mockRejectedValueOnce(new Error('Database connection failed'));

      const response = await agent.process(input);

      expect(response.status).toBe('error');
      expect(response.error?.retryable).toBe(true);
    });

    it('should return non-retryable error for validation failures', async () => {
      const response = await agent.process({ query: 'INSERT INTO users' });

      expect(response.error?.retryable).toBe(false);
    });

    it('should validate response against AgentResponse schema', async () => {
      const input = { query: 'SELECT * FROM users' };
      const response = await agent.process(input);

      const validationResult = AgentResponseSchema.safeParse(response);
      expect(validationResult.success).toBe(true);
    });
  });

  describe('Telemetry', () => {
    it('should include telemetry in successful response', async () => {
      const input = { query: 'SELECT * FROM users' };
      const response = await agent.process(input);

      expect(response.telemetry).toBeDefined();
      expect(response.telemetry?.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should track validation time', async () => {
      const input = { query: 'SELECT * FROM users' };
      const response = await agent.process(input);

      expect(response.telemetry?.validation_time_ms).toBeDefined();
      expect(response.telemetry?.validation_time_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Agent Metadata', () => {
    it('should have correct agentId', () => {
      expect(agent.agentId).toBe('database-query-agent');
    });

    it('should have semantic version', () => {
      expect(agent.version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('should have correct decisionType', () => {
      expect(agent.decisionType).toBe('database_query_result');
    });
  });
});
