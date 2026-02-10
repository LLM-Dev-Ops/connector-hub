/**
 * Instrumented Agent Wrappers
 *
 * Wraps existing agent execution patterns to integrate with the ExecutionContext
 * span hierarchy. These wrappers create agent-level spans, attach artifacts,
 * and handle error propagation without modifying agent internals.
 *
 * Supports two agent patterns:
 * - BaseAgent (via runAgentInContext) - uses invoke(input, AgentContext)
 * - Phase-6 agents (via runProcessAgentInContext) - uses process(input, context)
 */

import type { ExecutionContext } from './execution-context.js';
import type { AgentContext, AgentResult, BaseAgent } from '../base/agent.js';

/**
 * Run a BaseAgent within an ExecutionContext, creating the proper agent span.
 *
 * Creates an agent-level span, threads the execution IDs into AgentContext,
 * calls agent.invoke(), and attaches the resulting DecisionEvent as an artifact.
 */
export async function runAgentInContext<TInput, TOutput>(
  executionCtx: ExecutionContext,
  agent: BaseAgent<TInput, TOutput>,
  input: unknown
): Promise<AgentResult<TOutput>> {
  const agentSpanId = executionCtx.startAgentSpan(agent.agentId, agent.version);

  const agentContext: AgentContext = {
    traceId: executionCtx.executionId,
    spanId: agentSpanId,
    parentSpanId: executionCtx.repoSpanId,
    correlationId: executionCtx.executionId,
  };

  try {
    const result = await agent.invoke(input, agentContext);

    // Attach the DecisionEvent as an artifact using execution_ref as the stable ID
    const eventRef = result.event.execution_ref?.trace_id ?? result.event.execution_ref;
    executionCtx.attachArtifact(
      agentSpanId,
      'decision_event',
      typeof eventRef === 'string' ? eventRef : undefined,
    );

    executionCtx.endAgentSpan(agentSpanId, 'OK');
    return result;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    executionCtx.endAgentSpan(agentSpanId, 'FAILED', {
      code: err.name || 'UNKNOWN_ERROR',
      message: err.message,
    });
    throw error;
  }
}

/**
 * Minimal interface for Phase-6 style agents that use .process().
 * This avoids importing concrete agent classes.
 */
export interface ProcessAgent<TOutput = unknown> {
  readonly agentId: string;
  readonly version: string;
  process(
    input: unknown,
    context: { traceId: string; spanId?: string; correlationId?: string }
  ): Promise<{
    event: { execution_ref: string; [key: string]: unknown };
    output: TOutput;
    durationMs: number;
  }>;
}

/**
 * Run a Phase-6 agent (with .process()) within an ExecutionContext.
 *
 * Works with ConfigValidationAgent, SchemaEnforcementAgent, IntegrationHealthAgent,
 * and any other agent that follows the Phase-6 process() pattern.
 */
export async function runProcessAgentInContext<TOutput>(
  executionCtx: ExecutionContext,
  agent: ProcessAgent<TOutput>,
  input: unknown
): Promise<{ event: Record<string, unknown>; output: TOutput; durationMs: number }> {
  const agentSpanId = executionCtx.startAgentSpan(agent.agentId, agent.version);

  try {
    const result = await agent.process(input, {
      traceId: executionCtx.executionId,
      spanId: agentSpanId,
      correlationId: executionCtx.executionId,
    });

    executionCtx.attachArtifact(
      agentSpanId,
      'decision_event',
      result.event.execution_ref,
    );

    executionCtx.endAgentSpan(agentSpanId, 'OK');
    return result;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    executionCtx.endAgentSpan(agentSpanId, 'FAILED', {
      code: err.name || 'UNKNOWN_ERROR',
      message: err.message,
    });
    throw error;
  }
}
