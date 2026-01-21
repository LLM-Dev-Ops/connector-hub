/**
 * Base Agent Class for Agentics Platform
 *
 * All agents in the LLM-Connector-Hub MUST extend this base class.
 * This ensures compliance with the Agentics platform architecture.
 */

import {
  DecisionEvent,
  DecisionType,
  Confidence,
  ConstraintsApplied,
  AgentOutputs,
  createDecisionEvent,
} from '@llm-dev-ops/agentics-contracts';
import { hashInput } from '@llm-dev-ops/agentics-contracts';

/**
 * Agent execution context
 */
export interface AgentContext {
  /** Trace ID for distributed tracing */
  traceId: string;

  /** Span ID for this execution */
  spanId?: string;

  /** Parent span ID if nested */
  parentSpanId?: string;

  /** Correlation ID for request tracking */
  correlationId?: string;

  /** Request metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Agent execution result
 */
export interface AgentResult<TOutput> {
  /** The decision event emitted by the agent */
  event: DecisionEvent;

  /** The typed output data */
  output: TOutput;

  /** Execution duration in milliseconds */
  durationMs: number;
}

/**
 * Base configuration for all agents
 */
export interface BaseAgentConfig {
  /** Agent identifier */
  agentId: string;

  /** Agent version */
  version: string;

  /** Decision type this agent emits */
  decisionType: DecisionType;

  /** Enable telemetry emission */
  telemetryEnabled?: boolean;

  /** Telemetry endpoint (for LLM-Observatory) */
  telemetryEndpoint?: string;
}

/**
 * Abstract base class for all Agentics platform agents
 *
 * Agents extending this class:
 * - MUST implement the `execute` method
 * - MUST call `emitDecisionEvent` exactly once per invocation
 * - MUST NOT execute workflows or trigger other agents
 * - MUST NOT modify internal runtime behavior
 * - MUST persist data only via ruvector-service
 */
export abstract class BaseAgent<TInput, TOutput> {
  protected readonly config: BaseAgentConfig;

  constructor(config: BaseAgentConfig) {
    this.config = config;
  }

  /**
   * Get the agent ID
   */
  get agentId(): string {
    return this.config.agentId;
  }

  /**
   * Get the agent version
   */
  get version(): string {
    return this.config.version;
  }

  /**
   * Get the decision type
   */
  get decisionType(): DecisionType {
    return this.config.decisionType;
  }

  /**
   * Execute the agent logic
   *
   * Subclasses MUST implement this method to perform their specific logic.
   * This method should:
   * 1. Validate input against contracts
   * 2. Perform the agent's core logic
   * 3. Return a result with output and confidence
   *
   * @param input - Validated input data
   * @param context - Execution context
   */
  protected abstract executeLogic(
    input: TInput,
    context: AgentContext
  ): Promise<{
    output: TOutput;
    confidence: Confidence;
    constraints: ConstraintsApplied;
    warnings?: string[];
    error?: { code: string; message: string; recoverable: boolean; details?: unknown };
  }>;

  /**
   * Validate input against the agent's input schema
   */
  protected abstract validateInput(input: unknown): TInput;

  /**
   * Validate output against the agent's output schema
   */
  protected abstract validateOutput(output: unknown): TOutput;

  /**
   * Main entry point for agent execution
   *
   * This method:
   * 1. Validates input
   * 2. Executes the agent logic
   * 3. Emits exactly ONE DecisionEvent
   * 4. Returns the result
   */
  async invoke(input: unknown, context: AgentContext): Promise<AgentResult<TOutput>> {
    const startTime = Date.now();

    // Validate input
    const validatedInput = this.validateInput(input);
    const inputsHash = hashInput(validatedInput);

    try {
      // Execute agent logic
      const result = await this.executeLogic(validatedInput, context);

      // Validate output
      const validatedOutput = this.validateOutput(result.output);
      const durationMs = Date.now() - startTime;

      // Create the DecisionEvent
      const event = this.createEvent({
        inputsHash,
        output: validatedOutput,
        confidence: result.confidence,
        constraints: result.constraints,
        context,
        durationMs,
        warnings: result.warnings,
        error: result.error,
      });

      // Emit telemetry if enabled
      if (this.config.telemetryEnabled) {
        await this.emitTelemetry(event);
      }

      return {
        event,
        output: validatedOutput,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      // Create error event
      const event = this.createErrorEvent({
        inputsHash,
        context,
        durationMs,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      // Emit telemetry for error
      if (this.config.telemetryEnabled) {
        await this.emitTelemetry(event);
      }

      throw error;
    }
  }

  /**
   * Create a DecisionEvent for successful execution
   */
  private createEvent(params: {
    inputsHash: string;
    output: TOutput;
    confidence: Confidence;
    constraints: ConstraintsApplied;
    context: AgentContext;
    durationMs: number;
    warnings?: string[];
    error?: { code: string; message: string; recoverable: boolean; details?: unknown };
  }): DecisionEvent {
    const outputs: AgentOutputs = {
      data: params.output,
      format: 'json',
      warnings: params.warnings,
    };

    return createDecisionEvent({
      agent_id: this.config.agentId,
      agent_version: this.config.version,
      decision_type: this.config.decisionType,
      inputs_hash: params.inputsHash,
      outputs,
      confidence: params.confidence,
      constraints_applied: params.constraints,
      execution_ref: {
        trace_id: params.context.traceId,
        span_id: params.context.spanId,
        parent_span_id: params.context.parentSpanId,
        correlation_id: params.context.correlationId,
      },
      duration_ms: params.durationMs,
      error: params.error,
    });
  }

  /**
   * Create a DecisionEvent for failed execution
   */
  private createErrorEvent(params: {
    inputsHash: string;
    context: AgentContext;
    durationMs: number;
    error: Error;
  }): DecisionEvent {
    const outputs: AgentOutputs = {
      data: null,
      format: 'json',
    };

    const confidence: Confidence = {
      score: 0,
      level: 'uncertain',
      reasoning: 'Agent execution failed',
    };

    const constraints: ConstraintsApplied = {
      connector_scope: 'error',
    };

    return createDecisionEvent({
      agent_id: this.config.agentId,
      agent_version: this.config.version,
      decision_type: this.config.decisionType,
      inputs_hash: params.inputsHash,
      outputs,
      confidence,
      constraints_applied: constraints,
      execution_ref: {
        trace_id: params.context.traceId,
        span_id: params.context.spanId,
        parent_span_id: params.context.parentSpanId,
        correlation_id: params.context.correlationId,
      },
      duration_ms: params.durationMs,
      error: {
        code: params.error.name || 'UNKNOWN_ERROR',
        message: params.error.message,
        recoverable: false,
        details: params.error.stack,
      },
    });
  }

  /**
   * Emit telemetry to LLM-Observatory
   */
  private async emitTelemetry(event: DecisionEvent): Promise<void> {
    if (!this.config.telemetryEndpoint) {
      return;
    }

    try {
      // In production, this would send to LLM-Observatory
      // For now, we just log the event
      console.log('[Telemetry]', JSON.stringify({
        agent_id: event.agent_id,
        decision_type: event.decision_type,
        timestamp: event.timestamp,
        duration_ms: event.duration_ms,
        confidence_score: event.confidence.score,
        has_error: !!event.error,
      }));
    } catch (error) {
      // Telemetry failures should not affect agent execution
      console.error('[Telemetry Error]', error);
    }
  }
}
