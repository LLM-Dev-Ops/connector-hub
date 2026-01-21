/**
 * Telemetry Emitter
 *
 * Emits telemetry compatible with LLM-Observatory.
 * All agents MUST emit telemetry for observability.
 */

import pino from 'pino';

/**
 * Telemetry span types
 */
export type SpanType =
  | 'agent.invocation'
  | 'agent.normalization'
  | 'agent.validation'
  | 'agent.persistence'
  | 'external.request'
  | 'external.response';

/**
 * Telemetry span status
 */
export type SpanStatus = 'ok' | 'error' | 'unset';

/**
 * Telemetry span
 */
export interface TelemetrySpan {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  name: string;
  type: SpanType;
  status: SpanStatus;
  start_time: string;
  end_time?: string;
  duration_ms?: number;
  attributes: Record<string, string | number | boolean>;
  events: Array<{
    name: string;
    timestamp: string;
    attributes?: Record<string, string | number | boolean>;
  }>;
}

/**
 * Telemetry metrics
 */
export interface TelemetryMetrics {
  agent_id: string;
  agent_version: string;
  invocation_count: number;
  success_count: number;
  error_count: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
  timestamp: string;
}

/**
 * Observatory-compatible telemetry emitter
 */
export class TelemetryEmitter {
  private readonly logger: pino.Logger;
  private readonly agentId: string;
  private readonly agentVersion: string;
  private readonly environment: string;

  constructor(config: {
    agentId: string;
    agentVersion: string;
    environment?: string;
    logLevel?: pino.LevelWithSilent;
  }) {
    this.agentId = config.agentId;
    this.agentVersion = config.agentVersion;
    this.environment = config.environment ?? process.env['NODE_ENV'] ?? 'development';

    this.logger = pino({
      level: config.logLevel ?? 'info',
      formatters: {
        level: (label) => ({ level: label }),
      },
      base: {
        agent_id: this.agentId,
        agent_version: this.agentVersion,
        environment: this.environment,
      },
    });
  }

  /**
   * Generate a trace ID
   */
  generateTraceId(): string {
    return crypto.randomUUID().replace(/-/g, '');
  }

  /**
   * Generate a span ID
   */
  generateSpanId(): string {
    return crypto.randomUUID().replace(/-/g, '').substring(0, 16);
  }

  /**
   * Start a new telemetry span
   */
  startSpan(params: {
    name: string;
    type: SpanType;
    traceId?: string;
    parentSpanId?: string;
    attributes?: Record<string, string | number | boolean>;
  }): TelemetrySpan {
    const span: TelemetrySpan = {
      trace_id: params.traceId ?? this.generateTraceId(),
      span_id: this.generateSpanId(),
      parent_span_id: params.parentSpanId,
      name: params.name,
      type: params.type,
      status: 'unset',
      start_time: new Date().toISOString(),
      attributes: {
        'agent.id': this.agentId,
        'agent.version': this.agentVersion,
        'environment': this.environment,
        ...params.attributes,
      },
      events: [],
    };

    this.logger.debug({ span_id: span.span_id, span_name: span.name }, 'Span started');
    return span;
  }

  /**
   * Add an event to a span
   */
  addSpanEvent(
    span: TelemetrySpan,
    name: string,
    attributes?: Record<string, string | number | boolean>
  ): void {
    span.events.push({
      name,
      timestamp: new Date().toISOString(),
      attributes,
    });
  }

  /**
   * End a telemetry span
   */
  endSpan(span: TelemetrySpan, status: SpanStatus = 'ok', error?: Error): void {
    span.end_time = new Date().toISOString();
    span.status = status;
    span.duration_ms = new Date(span.end_time).getTime() - new Date(span.start_time).getTime();

    if (error) {
      span.attributes['error.type'] = error.name;
      span.attributes['error.message'] = error.message;
      this.addSpanEvent(span, 'exception', {
        'exception.type': error.name,
        'exception.message': error.message,
      });
    }

    // Emit to stdout in Observatory-compatible format
    this.emitSpan(span);
  }

  /**
   * Emit a completed span (to stdout for Cloud Functions)
   */
  private emitSpan(span: TelemetrySpan): void {
    const record = {
      type: 'span',
      span,
    };

    if (span.status === 'error') {
      this.logger.error(record, `Span completed with error: ${span.name}`);
    } else {
      this.logger.info(record, `Span completed: ${span.name}`);
    }
  }

  /**
   * Emit metrics
   */
  emitMetrics(metrics: Omit<TelemetryMetrics, 'agent_id' | 'agent_version' | 'timestamp'>): void {
    const fullMetrics: TelemetryMetrics = {
      ...metrics,
      agent_id: this.agentId,
      agent_version: this.agentVersion,
      timestamp: new Date().toISOString(),
    };

    this.logger.info({ type: 'metrics', metrics: fullMetrics }, 'Metrics emitted');
  }

  /**
   * Log an info message
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.logger.info(context, message);
  }

  /**
   * Log a warning message
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.logger.warn(context, message);
  }

  /**
   * Log an error message
   */
  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.logger.error(
      { ...context, error: error ? { name: error.name, message: error.message, stack: error.stack } : undefined },
      message
    );
  }

  /**
   * Create a child emitter for a specific operation
   */
  child(bindings: Record<string, unknown>): TelemetryEmitter {
    const child = new TelemetryEmitter({
      agentId: this.agentId,
      agentVersion: this.agentVersion,
      environment: this.environment,
    });
    // Note: In a full implementation, we'd properly inherit the pino child logger
    return child;
  }
}

/**
 * Create a telemetry emitter for an agent
 */
export function createTelemetryEmitter(agentId: string, agentVersion: string): TelemetryEmitter {
  return new TelemetryEmitter({
    agentId,
    agentVersion,
    environment: process.env['NODE_ENV'],
    logLevel: (process.env['LOG_LEVEL'] as pino.LevelWithSilent) ?? 'info',
  });
}
