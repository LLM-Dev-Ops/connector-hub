/**
 * Instrumented Agent Wrapper Tests
 *
 * Tests for runAgentInContext and runProcessAgentInContext:
 * - Agent span creation and lifecycle
 * - Context threading (traceId, spanId, correlationId)
 * - Artifact attachment
 * - Error propagation
 * - End-to-end hierarchy
 */

import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { ExecutionContext } from '../execution/execution-context';
import {
  runAgentInContext,
  runProcessAgentInContext,
  type ProcessAgent,
} from '../execution/instrumented-agent';
import type { BaseAgent, AgentContext, AgentResult } from '../base/agent';
import type { DecisionEvent } from '@llm-dev-ops/agentics-contracts';

function validInput() {
  return {
    execution_id: randomUUID(),
    parent_span_id: randomUUID(),
  };
}

// =============================================================================
// Mock BaseAgent
// =============================================================================

function createMockBaseAgent(options?: {
  shouldThrow?: boolean;
  errorMessage?: string;
}): BaseAgent<unknown, unknown> {
  const mockEvent = {
    agent_id: 'mock-agent',
    agent_version: '1.0.0',
    decision_type: 'webhook_ingest_event',
    inputs_hash: 'a'.repeat(64),
    outputs: { data: { result: 'ok' }, format: 'json' },
    confidence: { score: 0.9, level: 'high' },
    constraints_applied: {},
    execution_ref: {
      trace_id: randomUUID(),
    },
    timestamp: new Date().toISOString(),
  } as unknown as DecisionEvent;

  return {
    agentId: 'mock-agent',
    version: '1.0.0',
    decisionType: 'webhook_ingest_event',
    invoke: vi.fn(async (_input: unknown, _context: AgentContext): Promise<AgentResult<unknown>> => {
      if (options?.shouldThrow) {
        throw new Error(options.errorMessage || 'Mock agent error');
      }
      return {
        event: mockEvent,
        output: { result: 'ok' },
        durationMs: 42,
      };
    }),
  } as unknown as BaseAgent<unknown, unknown>;
}

// =============================================================================
// Mock Phase-6 Agent
// =============================================================================

function createMockProcessAgent(options?: {
  shouldThrow?: boolean;
}): ProcessAgent<{ valid: boolean }> {
  return {
    agentId: 'config-validation-agent',
    version: '1.0.0',
    process: vi.fn(async (
      _input: unknown,
      _context: { traceId: string; spanId?: string; correlationId?: string }
    ) => {
      if (options?.shouldThrow) {
        throw new Error('Process agent error');
      }
      return {
        event: {
          execution_ref: randomUUID(),
          decision_type: 'config_validation_signal',
          agent_id: 'config-validation-agent',
        },
        output: { valid: true },
        durationMs: 10,
      };
    }),
  };
}

// =============================================================================
// runAgentInContext - BaseAgent wrapper
// =============================================================================

describe('runAgentInContext', () => {
  it('should create an agent span and return the result', async () => {
    const ctx = ExecutionContext.create(validInput());
    const agent = createMockBaseAgent();

    const result = await runAgentInContext(ctx, agent, { test: true });

    expect(result.output).toEqual({ result: 'ok' });
    expect(result.durationMs).toBe(42);
    expect(result.event).toBeDefined();
  });

  it('should thread execution IDs into AgentContext', async () => {
    const input = validInput();
    const ctx = ExecutionContext.create(input);
    const agent = createMockBaseAgent();

    await runAgentInContext(ctx, agent, {});

    const invokeCall = (agent.invoke as ReturnType<typeof vi.fn>).mock.calls[0];
    const agentContext: AgentContext = invokeCall[1];

    expect(agentContext.traceId).toBe(input.execution_id);
    expect(agentContext.spanId).toBeDefined();
    expect(agentContext.parentSpanId).toBe(ctx.repoSpanId);
    expect(agentContext.correlationId).toBe(input.execution_id);
  });

  it('should attach DecisionEvent as artifact', async () => {
    const ctx = ExecutionContext.create(validInput());
    const agent = createMockBaseAgent();

    await runAgentInContext(ctx, agent, {});

    const output = ctx.finalize();
    const agentSpan = output.repo_span.agent_spans[0];

    expect(agentSpan.artifacts).toHaveLength(1);
    expect(agentSpan.artifacts[0].artifact_type).toBe('decision_event');
  });

  it('should mark span as OK on success', async () => {
    const ctx = ExecutionContext.create(validInput());
    const agent = createMockBaseAgent();

    await runAgentInContext(ctx, agent, {});

    const output = ctx.finalize();
    expect(output.repo_span.agent_spans[0].status).toBe('OK');
  });

  it('should mark span as FAILED on agent error and re-throw', async () => {
    const ctx = ExecutionContext.create(validInput());
    const agent = createMockBaseAgent({ shouldThrow: true, errorMessage: 'boom' });

    await expect(
      runAgentInContext(ctx, agent, {})
    ).rejects.toThrow('boom');

    const output = ctx.finalize();
    expect(output.success).toBe(false);
    expect(output.repo_span.agent_spans[0].status).toBe('FAILED');
    expect(output.repo_span.agent_spans[0].error?.message).toBe('boom');
  });
});

// =============================================================================
// runProcessAgentInContext - Phase-6 agent wrapper
// =============================================================================

describe('runProcessAgentInContext', () => {
  it('should create an agent span and return the result', async () => {
    const ctx = ExecutionContext.create(validInput());
    const agent = createMockProcessAgent();

    const result = await runProcessAgentInContext(ctx, agent, { config: {} });

    expect(result.output).toEqual({ valid: true });
    expect(result.durationMs).toBe(10);
  });

  it('should thread context into process call', async () => {
    const input = validInput();
    const ctx = ExecutionContext.create(input);
    const agent = createMockProcessAgent();

    await runProcessAgentInContext(ctx, agent, {});

    const processCall = (agent.process as ReturnType<typeof vi.fn>).mock.calls[0];
    const context = processCall[1];

    expect(context.traceId).toBe(input.execution_id);
    expect(context.spanId).toBeDefined();
    expect(context.correlationId).toBe(input.execution_id);
  });

  it('should attach execution_ref as artifact', async () => {
    const ctx = ExecutionContext.create(validInput());
    const agent = createMockProcessAgent();

    await runProcessAgentInContext(ctx, agent, {});

    const output = ctx.finalize();
    const agentSpan = output.repo_span.agent_spans[0];

    expect(agentSpan.artifacts).toHaveLength(1);
    expect(agentSpan.artifacts[0].artifact_type).toBe('decision_event');
  });

  it('should mark span as FAILED on error and re-throw', async () => {
    const ctx = ExecutionContext.create(validInput());
    const agent = createMockProcessAgent({ shouldThrow: true });

    await expect(
      runProcessAgentInContext(ctx, agent, {})
    ).rejects.toThrow('Process agent error');

    const output = ctx.finalize();
    expect(output.success).toBe(false);
    expect(output.repo_span.agent_spans[0].status).toBe('FAILED');
  });
});

// =============================================================================
// End-to-end hierarchy
// =============================================================================

describe('End-to-end execution graph', () => {
  it('should produce correct hierarchy with multiple agents', async () => {
    const input = validInput();
    const ctx = ExecutionContext.create(input);

    // Run two agents
    const agent1 = createMockBaseAgent();
    const agent2 = createMockProcessAgent();

    await runAgentInContext(ctx, agent1, {});
    await runProcessAgentInContext(ctx, agent2, {});

    const output = ctx.finalize();

    // Verify hierarchy: Core -> Repo -> Agent(s)
    expect(output.success).toBe(true);
    expect(output.execution_id).toBe(input.execution_id);

    // Repo span
    expect(output.repo_span.type).toBe('repo');
    expect(output.repo_span.parent_span_id).toBe(input.parent_span_id);
    expect(output.repo_span.repo_name).toBe('connector-hub');
    expect(output.repo_span.status).toBe('OK');

    // Two agent spans nested under repo
    expect(output.repo_span.agent_spans).toHaveLength(2);

    const [span1, span2] = output.repo_span.agent_spans;

    expect(span1.type).toBe('agent');
    expect(span1.parent_span_id).toBe(output.repo_span.span_id);
    expect(span1.agent_name).toBe('mock-agent');
    expect(span1.status).toBe('OK');
    expect(span1.artifacts).toHaveLength(1);

    expect(span2.type).toBe('agent');
    expect(span2.parent_span_id).toBe(output.repo_span.span_id);
    expect(span2.agent_name).toBe('config-validation-agent');
    expect(span2.status).toBe('OK');
    expect(span2.artifacts).toHaveLength(1);
  });

  it('should handle mixed success and failure', async () => {
    const ctx = ExecutionContext.create(validInput());

    const okAgent = createMockBaseAgent();
    const failAgent = createMockBaseAgent({ shouldThrow: true });

    await runAgentInContext(ctx, okAgent, {});

    // Catch the error so we can continue
    try {
      await runAgentInContext(ctx, failAgent, {});
    } catch {
      // Expected
    }

    const output = ctx.finalize();

    expect(output.success).toBe(false);
    expect(output.error?.code).toBe('AGENT_FAILURE');
    expect(output.repo_span.agent_spans).toHaveLength(2);
    expect(output.repo_span.agent_spans[0].status).toBe('OK');
    expect(output.repo_span.agent_spans[1].status).toBe('FAILED');
  });

  it('should produce fully JSON-serializable output', async () => {
    const ctx = ExecutionContext.create(validInput());
    const agent = createMockBaseAgent();

    await runAgentInContext(ctx, agent, {});

    const output = ctx.finalize();
    const json = JSON.stringify(output);
    const parsed = JSON.parse(json);

    expect(parsed.repo_span.agent_spans).toHaveLength(1);
    expect(parsed.repo_span.type).toBe('repo');
    expect(parsed.repo_span.agent_spans[0].type).toBe('agent');
  });
});
