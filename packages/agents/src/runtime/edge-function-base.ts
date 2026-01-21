/**
 * Edge Function Base Class for Agents
 *
 * Base class for all LLM Connector Hub agents deployed as Google Cloud Edge Functions.
 *
 * Constitutional Requirements:
 * - Agents are EXTERNAL INTERFACE ADAPTERS only
 * - NO orchestration, workflow execution, or policy enforcement
 * - All persistence via ruvector-service (NO direct SQL)
 * - Stateless execution
 * - MUST emit exactly ONE DecisionEvent per invocation
 * - CLI-invokable endpoints
 * - Contract-based validation
 * - Deterministic execution
 */

import { z } from 'zod';
import type { RuVectorClient } from './ruvector-client.js';
import type { TelemetryEmitter, Span, SpanContext } from './telemetry.js';

/**
 * Standard DecisionEvent schema
 * Every agent MUST emit exactly ONE DecisionEvent
 */
export const DecisionEventSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string(),
  agentVersion: z.string(),
  timestamp: z.string().datetime(),
  traceId: z.string(),
  eventType: z.string(),
  payload: z.record(z.unknown()),
  metadata: z.object({
    executionTimeMs: z.number(),
    success: z.boolean(),
    errorCode: z.string().optional(),
    errorMessage: z.string().optional()
  })
});

export type DecisionEvent = z.infer<typeof DecisionEventSchema>;

/**
 * Agent execution context
 */
export interface AgentContext {
  requestId: string;
  traceContext?: SpanContext;
  headers: Record<string, string>;
  environment: string;
}

/**
 * Agent execution result
 */
export interface AgentResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  decisionEvent: DecisionEvent;
}

/**
 * Agent error codes
 */
export enum AgentErrorCode {
  VALIDATION_ERROR = 'AGENT_VALIDATION_ERROR',
  EXECUTION_ERROR = 'AGENT_EXECUTION_ERROR',
  PERSISTENCE_ERROR = 'AGENT_PERSISTENCE_ERROR',
  TIMEOUT = 'AGENT_TIMEOUT',
  INTERNAL_ERROR = 'AGENT_INTERNAL_ERROR'
}

export class AgentError extends Error {
  constructor(
    message: string,
    public readonly code: AgentErrorCode,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

/**
 * Base class for Edge Function agents
 *
 * Provides:
 * - Request validation using contracts (Zod schemas)
 * - DecisionEvent emission
 * - Telemetry hooks
 * - Error handling
 * - RuVector client integration
 * - Deterministic execution pattern
 */
export abstract class EdgeFunctionAgentBase<TInput, TOutput> {
  protected abstract readonly agentId: string;
  protected abstract readonly agentVersion: string;
  protected abstract readonly inputSchema: z.ZodSchema<TInput>;
  protected abstract readonly outputSchema: z.ZodSchema<TOutput>;

  constructor(
    protected readonly ruVectorClient: RuVectorClient,
    protected readonly telemetry: TelemetryEmitter
  ) {}

  /**
   * Main entry point for agent execution
   *
   * Handles:
   * 1. Input validation against contract
   * 2. Telemetry span creation
   * 3. Agent-specific execution
   * 4. Output validation
   * 5. DecisionEvent emission
   * 6. Error handling
   */
  async execute(
    input: unknown,
    context: AgentContext
  ): Promise<AgentResult<TOutput>> {
    const span = this.telemetry.startSpan(
      `agent.${this.agentId}.execute`,
      context.traceContext,
      {
        'agent.id': this.agentId,
        'agent.version': this.agentVersion,
        'request.id': context.requestId
      }
    );

    const startTime = Date.now();

    try {
      // Step 1: Validate input against contract
      this.telemetry.addSpanEvent(span, 'input_validation.start');
      const validatedInput = await this.validateInput(input);
      this.telemetry.addSpanEvent(span, 'input_validation.complete');

      // Step 2: Execute agent-specific logic
      this.telemetry.addSpanEvent(span, 'agent_execution.start');
      const output = await this.executeAgent(validatedInput, context, span);
      this.telemetry.addSpanEvent(span, 'agent_execution.complete');

      // Step 3: Validate output against contract
      this.telemetry.addSpanEvent(span, 'output_validation.start');
      const validatedOutput = await this.validateOutput(output);
      this.telemetry.addSpanEvent(span, 'output_validation.complete');

      // Step 4: Create DecisionEvent
      const decisionEvent = this.createDecisionEvent(
        validatedOutput,
        context,
        startTime,
        true
      );

      // Step 5: Persist DecisionEvent asynchronously
      this.telemetry.addSpanEvent(span, 'decision_event.persist.start');
      await this.persistDecisionEvent(decisionEvent);
      this.telemetry.addSpanEvent(span, 'decision_event.persist.complete');

      await this.telemetry.endSpan(span, { code: 'OK' });

      return {
        success: true,
        data: validatedOutput,
        decisionEvent
      };

    } catch (error) {
      this.telemetry.recordError(span, error as Error);
      await this.telemetry.endSpan(span, {
        code: 'ERROR',
        message: (error as Error).message
      });

      const agentError = this.normalizeError(error);
      const decisionEvent = this.createDecisionEvent(
        undefined,
        context,
        startTime,
        false,
        agentError
      );

      // Still persist failed decision events for auditability
      await this.persistDecisionEvent(decisionEvent);

      return {
        success: false,
        error: {
          code: agentError.code,
          message: agentError.message,
          details: agentError.details
        },
        decisionEvent
      };
    }
  }

  /**
   * Agent-specific execution logic
   *
   * MUST be implemented by concrete agents.
   * MUST be deterministic (same input = same output).
   * MUST NOT perform orchestration or workflow execution.
   * MUST NOT enforce policy - only adapt external interfaces.
   */
  protected abstract executeAgent(
    input: TInput,
    context: AgentContext,
    span: Span
  ): Promise<TOutput>;

  /**
   * Validate input against contract schema
   */
  private async validateInput(input: unknown): Promise<TInput> {
    try {
      return await this.inputSchema.parseAsync(input);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new AgentError(
          'Input validation failed',
          AgentErrorCode.VALIDATION_ERROR,
          error.errors
        );
      }
      throw error;
    }
  }

  /**
   * Validate output against contract schema
   */
  private async validateOutput(output: TOutput): Promise<TOutput> {
    try {
      return await this.outputSchema.parseAsync(output);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new AgentError(
          'Output validation failed',
          AgentErrorCode.VALIDATION_ERROR,
          error.errors
        );
      }
      throw error;
    }
  }

  /**
   * Create DecisionEvent
   *
   * Every agent invocation MUST emit exactly ONE DecisionEvent.
   */
  private createDecisionEvent(
    output: TOutput | undefined,
    context: AgentContext,
    startTime: number,
    success: boolean,
    error?: AgentError
  ): DecisionEvent {
    return {
      id: crypto.randomUUID(),
      agentId: this.agentId,
      agentVersion: this.agentVersion,
      timestamp: new Date().toISOString(),
      traceId: context.traceContext?.traceId || context.requestId,
      eventType: this.getEventType(success),
      payload: {
        input: undefined, // Do not include input in event for security
        output: output || null,
        context: {
          requestId: context.requestId,
          environment: context.environment
        }
      },
      metadata: {
        executionTimeMs: Date.now() - startTime,
        success,
        errorCode: error?.code,
        errorMessage: error?.message
      }
    };
  }

  /**
   * Get event type for DecisionEvent
   * Override in concrete agents for specific event types
   */
  protected getEventType(success: boolean): string {
    return success
      ? `${this.agentId}_success`
      : `${this.agentId}_error`;
  }

  /**
   * Persist DecisionEvent via ruvector-service
   */
  private async persistDecisionEvent(event: DecisionEvent): Promise<void> {
    const result = await this.ruVectorClient.persist('decision_events', {
      ...event,
      // Add searchable fields for querying
      agent_id: event.agentId,
      event_type: event.eventType,
      success: event.metadata.success,
      timestamp_epoch: Date.parse(event.timestamp)
    });

    if (!result.success) {
      // Non-blocking - persistence failures should not fail agent execution
      console.error('[AGENT] Failed to persist DecisionEvent:', result.error);

      await this.telemetry.emitMetric({
        name: 'agent.decision_event.persistence_error',
        value: 1,
        unit: 'count',
        timestamp: Date.now(),
        attributes: {
          'agent.id': this.agentId,
          'error.code': result.errorCode || 'UNKNOWN'
        }
      });
    }
  }

  /**
   * Normalize errors to AgentError
   */
  private normalizeError(error: unknown): AgentError {
    if (error instanceof AgentError) {
      return error;
    }

    if (error instanceof Error) {
      return new AgentError(
        error.message,
        AgentErrorCode.EXECUTION_ERROR,
        { originalError: error.name }
      );
    }

    return new AgentError(
      'Unknown error occurred',
      AgentErrorCode.INTERNAL_ERROR,
      error
    );
  }
}
