/**
 * Telemetry Emission for Agents
 *
 * Compatible with llm-observatory-core for distributed tracing.
 * All agents MUST emit telemetry for observability.
 *
 * Constitutional Requirements:
 * - Emit span data for every agent invocation
 * - Emit metrics (latency, errors, token usage)
 * - Correlate traces across agent boundaries
 * - Support async emission (non-blocking)
 */

export interface TelemetryConfig {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  observatoryEndpoint?: string;
  sampleRate?: number;
  enabled?: boolean;
}

export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceFlags?: number;
}

export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

export interface Span {
  name: string;
  startTime: number;
  endTime?: number;
  context: SpanContext;
  attributes: SpanAttributes;
  events: SpanEvent[];
  status: SpanStatus;
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: SpanAttributes;
}

export interface SpanStatus {
  code: 'OK' | 'ERROR' | 'UNSET';
  message?: string;
}

export interface Metric {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
  attributes?: SpanAttributes;
}

export enum MetricType {
  LATENCY = 'agent.latency',
  TOKEN_USAGE = 'agent.token_usage',
  ERROR_COUNT = 'agent.error_count',
  DECISION_COUNT = 'agent.decision_count',
  PERSISTENCE_LATENCY = 'agent.persistence_latency'
}

/**
 * Telemetry emitter for agents
 *
 * Provides span creation, metric emission, and trace correlation.
 * Compatible with llm-observatory-core.
 */
export class TelemetryEmitter {
  private readonly config: Required<TelemetryConfig>;
  private readonly spans: Map<string, Span> = new Map();

  constructor(config: TelemetryConfig) {
    this.config = {
      sampleRate: 1.0,
      enabled: true,
      observatoryEndpoint: process.env.LLM_OBSERVATORY_ENDPOINT || '',
      ...config
    };
  }

  /**
   * Start a new span for agent operation
   */
  startSpan(
    name: string,
    parentContext?: SpanContext,
    attributes?: SpanAttributes
  ): Span {
    if (!this.config.enabled || Math.random() > this.config.sampleRate) {
      return this.createNoOpSpan(name);
    }

    const span: Span = {
      name,
      startTime: Date.now(),
      context: {
        traceId: parentContext?.traceId || this.generateTraceId(),
        spanId: this.generateSpanId(),
        parentSpanId: parentContext?.spanId,
        traceFlags: 1 // Sampled
      },
      attributes: {
        'service.name': this.config.serviceName,
        'service.version': this.config.serviceVersion,
        'deployment.environment': this.config.environment,
        ...attributes
      },
      events: [],
      status: { code: 'UNSET' }
    };

    this.spans.set(span.context.spanId, span);
    return span;
  }

  /**
   * End a span and emit telemetry
   */
  async endSpan(span: Span, status?: SpanStatus): Promise<void> {
    if (!this.config.enabled) return;

    span.endTime = Date.now();
    span.status = status || { code: 'OK' };

    // Emit span data
    await this.emit({
      type: 'span',
      data: span
    });

    // Emit latency metric
    const duration = span.endTime - span.startTime;
    await this.emitMetric({
      name: MetricType.LATENCY,
      value: duration,
      unit: 'ms',
      timestamp: span.endTime,
      attributes: {
        'span.name': span.name,
        'span.status': span.status.code
      }
    });

    this.spans.delete(span.context.spanId);
  }

  /**
   * Add event to span
   */
  addSpanEvent(span: Span, name: string, attributes?: SpanAttributes): void {
    if (!this.config.enabled) return;

    span.events.push({
      name,
      timestamp: Date.now(),
      attributes
    });
  }

  /**
   * Emit a metric
   */
  async emitMetric(metric: Metric): Promise<void> {
    if (!this.config.enabled) return;

    await this.emit({
      type: 'metric',
      data: metric
    });
  }

  /**
   * Record error on span
   */
  recordError(span: Span, error: Error): void {
    if (!this.config.enabled) return;

    span.status = {
      code: 'ERROR',
      message: error.message
    };

    this.addSpanEvent(span, 'exception', {
      'exception.type': error.name,
      'exception.message': error.message,
      'exception.stacktrace': error.stack
    });
  }

  /**
   * Create span context from incoming headers
   * For trace propagation across agent boundaries
   */
  extractContext(headers: Record<string, string>): SpanContext | undefined {
    const traceParent = headers['traceparent'];
    if (!traceParent) return undefined;

    // W3C Trace Context format: version-traceId-spanId-traceFlags
    const parts = traceParent.split('-');
    if (parts.length !== 4) return undefined;

    return {
      traceId: parts[1],
      spanId: parts[2],
      traceFlags: parseInt(parts[3], 16)
    };
  }

  /**
   * Inject span context into headers
   * For trace propagation to downstream services
   */
  injectContext(span: Span, headers: Record<string, string>): void {
    headers['traceparent'] =
      `00-${span.context.traceId}-${span.context.spanId}-01`;
  }

  /**
   * Emit telemetry data to observatory
   */
  private async emit(payload: { type: string; data: unknown }): Promise<void> {
    if (!this.config.observatoryEndpoint) {
      // Fallback to console logging in development
      if (this.config.environment === 'development') {
        console.log('[TELEMETRY]', JSON.stringify(payload, null, 2));
      }
      return;
    }

    try {
      await fetch(`${this.config.observatoryEndpoint}/v1/traces`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      // Non-blocking - telemetry failures should not fail agent execution
      console.error('[TELEMETRY] Failed to emit:', error);
    }
  }

  private generateTraceId(): string {
    return this.generateHex(32);
  }

  private generateSpanId(): string {
    return this.generateHex(16);
  }

  private generateHex(length: number): string {
    const bytes = new Uint8Array(length / 2);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private createNoOpSpan(name: string): Span {
    return {
      name,
      startTime: Date.now(),
      context: {
        traceId: '00000000000000000000000000000000',
        spanId: '0000000000000000'
      },
      attributes: {},
      events: [],
      status: { code: 'UNSET' }
    };
  }
}

/**
 * Factory function for creating TelemetryEmitter from environment
 */
export function createTelemetryEmitterFromEnv(serviceName: string): TelemetryEmitter {
  return new TelemetryEmitter({
    serviceName,
    serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
    environment: process.env.ENVIRONMENT || 'production',
    observatoryEndpoint: process.env.LLM_OBSERVATORY_ENDPOINT,
    sampleRate: process.env.TELEMETRY_SAMPLE_RATE
      ? parseFloat(process.env.TELEMETRY_SAMPLE_RATE)
      : undefined,
    enabled: process.env.TELEMETRY_ENABLED !== 'false'
  });
}
