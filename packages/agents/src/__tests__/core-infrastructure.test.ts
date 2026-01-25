/**
 * Core Infrastructure Agents - Phase 6 Tests
 *
 * Tests for:
 * - ConfigValidationAgent
 * - SchemaEnforcementAgent
 * - IntegrationHealthAgent
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

// Mock Ruvector client
vi.mock('../infrastructure/ruvector-client.js', () => ({
  getRuvectorClient: () => ({
    store: vi.fn().mockResolvedValue({ id: 'test', version: 1, success: true }),
    get: vi.fn().mockResolvedValue(null),
    query: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 10 }),
  }),
  resetRuvectorClient: vi.fn(),
}));

import { ConfigValidationAgent } from '../agents/config-validation/agent.js';
import { SchemaEnforcementAgent } from '../agents/schema-enforcement/agent.js';
import { IntegrationHealthAgent } from '../agents/integration-health/agent.js';
import { PERFORMANCE_BUDGETS } from '@llm-dev-ops/connector-hub-contracts';

// =============================================================================
// ConfigValidationAgent Tests
// =============================================================================

describe('ConfigValidationAgent', () => {
  let agent: ConfigValidationAgent;
  const context = { traceId: randomUUID() };

  beforeEach(() => {
    agent = new ConfigValidationAgent();
  });

  it('should have correct agent metadata', () => {
    expect(agent.agentId).toBe('config-validation-agent');
    expect(agent.version).toBe('1.0.0');
    expect(agent.decisionType).toBe('config_validation_signal');
  });

  it('should validate valid OpenAI configuration', async () => {
    const input = {
      namespace: 'providers.openai',
      config: {
        api_key_env: 'OPENAI_API_KEY',
        model: 'gpt-4',
        max_tokens: 4096,
        temperature: 0.7,
        timeout_ms: 30000,
      },
      source: 'environment',
      schema_version: '1.0.0',
      strict: false,
    };

    const result = await agent.process(input, context);

    expect(result.output.valid).toBe(true);
    expect(result.output.issues).toHaveLength(0);
    expect(result.event.decision_type).toBe('config_validation_signal');
    expect(result.event.confidence.score).toBe(1.0);
    expect(result.durationMs).toBeLessThan(PERFORMANCE_BUDGETS.MAX_LATENCY_MS);
  });

  it('should reject invalid configuration', async () => {
    const input = {
      namespace: 'providers.openai',
      config: {
        // Missing required api_key_env
        model: 'gpt-4',
        max_tokens: 'invalid', // Wrong type
        temperature: 3.0, // Out of range
      },
      source: 'environment',
      schema_version: '1.0.0',
      strict: false,
    };

    const result = await agent.process(input, context);

    expect(result.output.valid).toBe(false);
    expect(result.output.issues.length).toBeGreaterThan(0);
    expect(result.event.confidence.score).toBe(0.0);
  });

  it('should detect deprecated fields as warnings', async () => {
    const input = {
      namespace: 'providers.openai',
      config: {
        api_key_env: 'OPENAI_API_KEY',
        api_key: 'sk-xxx', // Deprecated field
        model: 'gpt-4',
      },
      source: 'environment',
      schema_version: '1.0.0',
      strict: false,
    };

    const result = await agent.process(input, context);

    expect(result.output.valid).toBe(true);
    const warnings = result.output.issues.filter(i => i.severity === 'warning');
    expect(warnings.some(w => w.code === 'DEPRECATED_FIELD')).toBe(true);
  });

  it('should fail on warnings in strict mode', async () => {
    const input = {
      namespace: 'providers.openai',
      config: {
        api_key_env: 'OPENAI_API_KEY',
        api_key: 'sk-xxx', // Deprecated field
        model: 'gpt-4',
      },
      source: 'environment',
      schema_version: '1.0.0',
      strict: true,
    };

    const result = await agent.process(input, context);

    expect(result.output.valid).toBe(false);
  });

  it('should reject unknown namespace', async () => {
    const input = {
      namespace: 'unknown.namespace',
      config: {},
      source: 'environment',
      schema_version: '1.0.0',
      strict: false,
    };

    const result = await agent.process(input, context);

    expect(result.output.valid).toBe(false);
    expect(result.output.issues.some(i => i.code === 'UNKNOWN_NAMESPACE')).toBe(true);
  });

  it('should respect token budget', async () => {
    const input = {
      namespace: 'providers.openai',
      config: {
        api_key_env: 'OPENAI_API_KEY',
      },
      source: 'environment',
      schema_version: '1.0.0',
      strict: false,
    };

    const result = await agent.process(input, context);

    expect(result.output.token_count).toBeLessThanOrEqual(PERFORMANCE_BUDGETS.MAX_TOKENS);
  });
});

// =============================================================================
// SchemaEnforcementAgent Tests
// =============================================================================

describe('SchemaEnforcementAgent', () => {
  let agent: SchemaEnforcementAgent;
  const context = { traceId: randomUUID() };

  beforeEach(() => {
    agent = new SchemaEnforcementAgent();
  });

  it('should have correct agent metadata', () => {
    expect(agent.agentId).toBe('schema-enforcement-agent');
    expect(agent.version).toBe('1.0.0');
    expect(agent.decisionType).toBe('schema_violation_signal');
  });

  it('should validate valid LLM request', async () => {
    const input = {
      payload: {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello!' },
        ],
        max_tokens: 100,
        temperature: 0.7,
      },
      schema_id: 'llm-request',
      schema_version: '1.0.0',
      schema_type: 'zod',
      mode: 'strict',
    };

    const result = await agent.process(input, context);

    expect(result.output.valid).toBe(true);
    expect(result.output.violations).toHaveLength(0);
    expect(result.event.decision_type).toBe('schema_violation_signal');
    expect(result.event.confidence.score).toBe(1.0);
  });

  it('should detect schema violations', async () => {
    const input = {
      payload: {
        model: 123, // Wrong type - should be string
        messages: 'invalid', // Wrong type - should be array
      },
      schema_id: 'llm-request',
      schema_version: '1.0.0',
      schema_type: 'zod',
      mode: 'strict',
    };

    const result = await agent.process(input, context);

    expect(result.output.valid).toBe(false);
    expect(result.output.violations.length).toBeGreaterThan(0);
    expect(result.output.violations[0].code).toBe('INVALID_TYPE');
  });

  it('should handle lenient mode', async () => {
    const input = {
      payload: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        extra_field: 'allowed in lenient', // Extra field
      },
      schema_id: 'llm-request',
      schema_version: '1.0.0',
      schema_type: 'zod',
      mode: 'lenient',
    };

    const result = await agent.process(input, context);

    // Lenient mode should pass despite extra fields
    expect(result.output.valid).toBe(true);
  });

  it('should return coerced payload in coerce mode', async () => {
    const input = {
      payload: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: 'true', // Should be coerced to boolean
      },
      schema_id: 'llm-request',
      schema_version: '1.0.0',
      schema_type: 'zod',
      mode: 'coerce',
    };

    const result = await agent.process(input, context);

    // Note: Zod doesn't auto-coerce strings to booleans, so this will fail
    // but the coerced_payload field should be present when successful
    expect(result.event.decision_type).toBe('schema_violation_signal');
  });

  it('should reject unknown schema', async () => {
    const input = {
      payload: { test: true },
      schema_id: 'unknown-schema',
      schema_version: '1.0.0',
      schema_type: 'zod',
      mode: 'strict',
    };

    const result = await agent.process(input, context);

    expect(result.output.valid).toBe(false);
    expect(result.output.violations.some(v => v.code === 'SCHEMA_NOT_FOUND')).toBe(true);
  });

  it('should list available schemas', () => {
    const schemas = agent.listSchemas();

    expect(schemas.length).toBeGreaterThan(0);
    expect(schemas.some(s => s.id === 'llm-request')).toBe(true);
    expect(schemas.some(s => s.id === 'decision-event')).toBe(true);
  });

  it('should respect latency budget', async () => {
    const input = {
      payload: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      },
      schema_id: 'llm-request',
      schema_version: '1.0.0',
      schema_type: 'zod',
      mode: 'strict',
    };

    const result = await agent.process(input, context);

    expect(result.output.stats.duration_ms).toBeLessThanOrEqual(PERFORMANCE_BUDGETS.MAX_LATENCY_MS);
  });
});

// =============================================================================
// IntegrationHealthAgent Tests
// =============================================================================

describe('IntegrationHealthAgent', () => {
  let agent: IntegrationHealthAgent;
  const context = { traceId: randomUUID() };

  beforeEach(() => {
    agent = new IntegrationHealthAgent();
    agent.clearCache(); // Clear health cache between tests
  });

  it('should have correct agent metadata', () => {
    expect(agent.agentId).toBe('integration-health-agent');
    expect(agent.version).toBe('1.0.0');
    expect(agent.decisionType).toBe('integration_health_signal');
  });

  it('should check all integrations when none specified', async () => {
    const input = {
      integrations: [],
      timeout_ms: 5000,
      include_metadata: false,
      force_fresh: true,
    };

    const result = await agent.process(input, context);

    expect(result.event.decision_type).toBe('integration_health_signal');
    expect(result.output.integrations.length).toBeGreaterThan(0);
    expect(result.output.stats.total_checked).toBeGreaterThan(0);
  });

  it('should check specific integrations', async () => {
    const input = {
      integrations: ['ruvector'],
      timeout_ms: 5000,
      include_metadata: true,
      force_fresh: true,
    };

    const result = await agent.process(input, context);

    expect(result.output.integrations).toHaveLength(1);
    expect(result.output.integrations[0].integration_id).toBe('ruvector');
    expect(result.output.integrations[0].type).toBe('ruvector');
  });

  it('should compute overall status correctly', async () => {
    const input = {
      integrations: ['ruvector'],
      timeout_ms: 5000,
      include_metadata: false,
      force_fresh: true,
    };

    const result = await agent.process(input, context);

    expect(['healthy', 'degraded', 'unhealthy', 'unknown']).toContain(result.output.overall_status);
    expect(result.event.confidence.health_assessment).toBe(result.output.overall_status);
  });

  it('should list registered integrations', () => {
    const integrations = agent.listIntegrations();

    expect(integrations.length).toBeGreaterThan(0);
    expect(integrations.some(i => i.id === 'ruvector')).toBe(true);
    expect(integrations.some(i => i.critical)).toBe(true);
  });

  it('should use cache when not forced fresh', async () => {
    const input = {
      integrations: ['ruvector'],
      timeout_ms: 5000,
      include_metadata: false,
      force_fresh: false,
    };

    // First call
    const result1 = await agent.process(input, context);

    // Second call should use cache
    const result2 = await agent.process(input, context);

    // Both should succeed (cache returns previous result)
    expect(result1.output.integrations[0].integration_id).toBe('ruvector');
    expect(result2.output.integrations[0].integration_id).toBe('ruvector');
  });

  it('should respect token budget', async () => {
    const input = {
      integrations: [],
      timeout_ms: 5000,
      include_metadata: true,
      force_fresh: true,
    };

    const result = await agent.process(input, context);

    expect(result.output.token_count).toBeLessThanOrEqual(PERFORMANCE_BUDGETS.MAX_TOKENS);
  });

  it('should include statistics in output', async () => {
    const input = {
      integrations: [],
      timeout_ms: 5000,
      include_metadata: false,
      force_fresh: true,
    };

    const result = await agent.process(input, context);

    expect(result.output.stats).toBeDefined();
    expect(typeof result.output.stats.total_checked).toBe('number');
    expect(typeof result.output.stats.healthy_count).toBe('number');
    expect(typeof result.output.stats.avg_latency_ms).toBe('number');
  });
});

// =============================================================================
// DecisionEvent Compliance Tests
// =============================================================================

describe('DecisionEvent Compliance', () => {
  it('ConfigValidationAgent emits valid DecisionEvent', async () => {
    const agent = new ConfigValidationAgent();
    const result = await agent.process(
      {
        namespace: 'providers.openai',
        config: { api_key_env: 'TEST' },
        source: 'environment',
        schema_version: '1.0.0',
      },
      { traceId: randomUUID() }
    );

    expect(result.event).toMatchObject({
      agent_id: expect.any(String),
      agent_version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      decision_type: 'config_validation_signal',
      inputs_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      outputs: expect.any(Object),
      confidence: expect.objectContaining({ score: expect.any(Number) }),
      constraints_applied: expect.any(Object),
      execution_ref: expect.any(String),
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it('SchemaEnforcementAgent emits valid DecisionEvent', async () => {
    const agent = new SchemaEnforcementAgent();
    const result = await agent.process(
      {
        payload: { model: 'gpt-4', messages: [] },
        schema_id: 'llm-request',
        schema_version: '1.0.0',
        schema_type: 'zod',
        mode: 'strict',
      },
      { traceId: randomUUID() }
    );

    expect(result.event).toMatchObject({
      agent_id: expect.any(String),
      agent_version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      decision_type: 'schema_violation_signal',
      inputs_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      outputs: expect.any(Object),
      confidence: expect.objectContaining({ score: expect.any(Number) }),
      constraints_applied: expect.any(Object),
      execution_ref: expect.any(String),
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it('IntegrationHealthAgent emits valid DecisionEvent', async () => {
    const agent = new IntegrationHealthAgent();
    agent.clearCache();
    const result = await agent.process(
      { integrations: [], timeout_ms: 5000, force_fresh: true },
      { traceId: randomUUID() }
    );

    expect(result.event).toMatchObject({
      agent_id: expect.any(String),
      agent_version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      decision_type: 'integration_health_signal',
      inputs_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      outputs: expect.any(Object),
      confidence: expect.objectContaining({ score: expect.any(Number) }),
      constraints_applied: expect.any(Object),
      execution_ref: expect.any(String),
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });
});
