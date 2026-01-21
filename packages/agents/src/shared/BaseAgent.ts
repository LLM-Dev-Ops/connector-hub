/**
 * Base Agent - Abstract base class for all LLM-Connector-Hub agents
 *
 * This class provides common functionality for all connector agents:
 * - Configuration management
 * - Logging
 * - Error handling
 * - Telemetry collection
 * - Input validation
 * - DecisionEvent generation
 *
 * All agents MUST extend this base class to ensure consistent behavior.
 */

import { Logger, pino } from 'pino';
import {
  type IAgent,
  type AgentResponse,
  type DecisionType,
  type DecisionEvent,
  type Confidence,
  type ConstraintsApplied,
  type BaseAgentConfig,
  createDecisionEvent,
} from '../contracts/index.js';

/**
 * Abstract base class for all agents
 */
export abstract class BaseAgent implements IAgent {
  protected logger: Logger;
  protected config: BaseAgentConfig;
  protected initialized = false;
  private startTime = 0;

  constructor(
    public readonly agentId: string,
    public readonly version: string,
    public readonly decisionType: DecisionType,
    config: BaseAgentConfig,
  ) {
    this.config = config;
    this.logger = pino({
      name: agentId,
      level: config.debug ? 'debug' : 'info',
    });
  }

  /**
   * Initialize the agent.
   * Override this method to perform agent-specific initialization.
   */
  async initialize(): Promise<void> {
    this.logger.info({ agentId: this.agentId, version: this.version }, 'Initializing agent');
    this.initialized = true;
  }

  /**
   * Process a request and emit a DecisionEvent.
   * This is the main entry point for all agent operations.
   */
  async process(input: unknown): Promise<AgentResponse> {
    this.startTime = Date.now();

    try {
      // Ensure agent is initialized
      if (!this.initialized) {
        await this.initialize();
      }

      // Validate input size
      const inputSize = JSON.stringify(input).length;
      if (inputSize > this.config.max_payload_bytes) {
        return this.createErrorResponse(
          'PAYLOAD_TOO_LARGE',
          `Payload size ${inputSize} exceeds maximum ${this.config.max_payload_bytes} bytes`,
          false,
        );
      }

      // Validate input schema
      const validationResult = await this.validateInput(input);
      if (!validationResult.valid) {
        return this.createErrorResponse(
          'VALIDATION_FAILED',
          validationResult.error || 'Input validation failed',
          true,
        );
      }

      // Execute agent-specific processing with timeout
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Agent processing timeout')),
          this.config.timeout_ms,
        ),
      );

      const processingPromise = this.executeProcessing(input);

      const result = await Promise.race([processingPromise, timeoutPromise]);

      // Create DecisionEvent
      const decisionEvent = createDecisionEvent({
        agentId: this.agentId,
        agentVersion: this.version,
        decisionType: this.decisionType,
        input,
        outputs: result.outputs,
        confidence: result.confidence,
        constraintsApplied: result.constraintsApplied,
        metadata: result.metadata,
      });

      // Return successful response
      return {
        status: 'success',
        decision_event: decisionEvent,
        telemetry: this.config.telemetry_enabled
          ? {
              duration_ms: Date.now() - this.startTime,
              validation_time_ms: validationResult.duration_ms,
            }
          : undefined,
      };
    } catch (error) {
      this.logger.error({ error, input }, 'Agent processing failed');

      if ((error as Error).message?.includes('timeout')) {
        return this.createErrorResponse('TIMEOUT', 'Agent processing timeout', true);
      }

      return this.createErrorResponse(
        'PROCESSING_ERROR',
        error instanceof Error ? error.message : 'Unknown error',
        true,
      );
    }
  }

  /**
   * Shutdown the agent and cleanup resources.
   * Override this method to perform agent-specific cleanup.
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down agent');
    this.initialized = false;
  }

  /**
   * Health check.
   * Override this method to perform agent-specific health checks.
   */
  async healthCheck(): Promise<boolean> {
    return this.initialized;
  }

  /**
   * Validate input against agent-specific schema.
   * Must be implemented by concrete agents.
   */
  protected abstract validateInput(input: unknown): Promise<{
    valid: boolean;
    error?: string;
    duration_ms?: number;
  }>;

  /**
   * Execute agent-specific processing logic.
   * Must be implemented by concrete agents.
   */
  protected abstract executeProcessing(input: unknown): Promise<{
    outputs: Record<string, unknown>;
    confidence: Confidence;
    constraintsApplied: ConstraintsApplied;
    metadata?: Record<string, unknown>;
  }>;

  /**
   * Create an error response
   */
  protected createErrorResponse(
    code: string,
    message: string,
    retryable: boolean,
  ): AgentResponse {
    return {
      status: 'error',
      error: {
        code,
        message,
        retryable,
      },
      telemetry: this.config.telemetry_enabled
        ? {
            duration_ms: Date.now() - this.startTime,
          }
        : undefined,
    };
  }

  /**
   * Compute confidence score helper
   */
  protected computeConfidenceScore(...factors: number[]): number {
    if (factors.length === 0) return 0;
    const sum = factors.reduce((acc, val) => acc + val, 0);
    return Math.min(1.0, Math.max(0.0, sum / factors.length));
  }
}
