/**
 * Telemetry Service - LLM-Observatory Integration
 *
 * Provides OpenTelemetry-compliant telemetry for agent operations.
 * Emits spans, metrics, and events compatible with LLM-Observatory.
 *
 * FEATURES:
 * - OpenTelemetry span tracking
 * - Structured logging with pino
 * - Metric collection (counters, histograms)
 * - Event emission for decision tracking
 */

import pino, { Logger } from 'pino';
import type { DecisionEvent, AgentResponse } from '../contracts/index.js';

/**
 * Telemetry configuration
 */
export interface TelemetryConfig {
  /** Service name for tracing */
  serviceName: string;

  /** Service version */
  serviceVersion: string;

  /** Enable detailed logging */
  debug: boolean;

  /** Log level */
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

  /** Enable metrics collection */
  metricsEnabled: boolean;

  /** Metrics export interval in milliseconds */
  metricsIntervalMs: number;

  /** Custom attributes to include in all spans */
  customAttributes: Record<string, string>;
}

/**
 * Default telemetry configuration
 */
const DEFAULT_CONFIG: TelemetryConfig = {
  serviceName: 'connector-hub-agents',
  serviceVersion: '0.1.0',
  debug: false,
  logLevel: 'info',
  metricsEnabled: true,
  metricsIntervalMs: 60000,
  customAttributes: {},
};

/**
 * Span context for tracing
 */
export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startTime: number;
  attributes: Record<string, unknown>;
}

/**
 * Metric types
 */
export interface Metrics {
  /** Request counter */
  requestCount: number;

  /** Error counter */
  errorCount: number;

  /** Success counter */
  successCount: number;

  /** Request latencies (ms) */
  latencies: number[];

  /** Payload sizes (bytes) */
  payloadSizes: number[];

  /** Validation failures by type */
  validationFailures: Map<string, number>;
}

/**
 * Telemetry Service
 *
 * Provides comprehensive telemetry for agent operations.
 */
export class TelemetryService {
  private readonly config: TelemetryConfig;
  private readonly logger: Logger;
  private readonly metrics: Metrics;
  private activeSpans: Map<string, SpanContext> = new Map();

  constructor(config: Partial<TelemetryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize pino logger
    this.logger = pino({
      name: this.config.serviceName,
      level: this.config.logLevel,
      formatters: {
        level: (label) => ({ level: label }),
      },
      base: {
        service: this.config.serviceName,
        version: this.config.serviceVersion,
        ...this.config.customAttributes,
      },
    });

    // Initialize metrics
    this.metrics = {
      requestCount: 0,
      errorCount: 0,
      successCount: 0,
      latencies: [],
      payloadSizes: [],
      validationFailures: new Map(),
    };
  }

  /**
   * Start a new span
   */
  startSpan(name: string, attributes: Record<string, unknown> = {}): SpanContext {
    const spanId = this.generateSpanId();
    const traceId = this.generateTraceId();

    const span: SpanContext = {
      traceId,
      spanId,
      startTime: Date.now(),
      attributes: {
        'span.name': name,
        ...this.config.customAttributes,
        ...attributes,
      },
    };

    this.activeSpans.set(spanId, span);

    this.logger.debug({ span_id: spanId, trace_id: traceId, name }, 'Span started');

    return span;
  }

  /**
   * End a span and record its duration
   */
  endSpan(
    span: SpanContext,
    status: 'ok' | 'error' = 'ok',
    attributes: Record<string, unknown> = {}
  ): void {
    const endTime = Date.now();
    const duration = endTime - span.startTime;

    this.activeSpans.delete(span.spanId);

    // Record latency metric
    this.metrics.latencies.push(duration);

    // Trim latencies array to last 1000 samples
    if (this.metrics.latencies.length > 1000) {
      this.metrics.latencies = this.metrics.latencies.slice(-1000);
    }

    this.logger.info(
      {
        span_id: span.spanId,
        trace_id: span.traceId,
        duration_ms: duration,
        status,
        ...span.attributes,
        ...attributes,
      },
      'Span ended'
    );
  }

  /**
   * Record agent request
   */
  recordRequest(agentId: string, decisionType: string, payloadSizeBytes: number): void {
    this.metrics.requestCount++;
    this.metrics.payloadSizes.push(payloadSizeBytes);

    // Trim payload sizes array
    if (this.metrics.payloadSizes.length > 1000) {
      this.metrics.payloadSizes = this.metrics.payloadSizes.slice(-1000);
    }

    this.logger.info(
      {
        event: 'agent_request',
        agent_id: agentId,
        decision_type: decisionType,
        payload_size_bytes: payloadSizeBytes,
      },
      'Agent request received'
    );
  }

  /**
   * Record agent response
   */
  recordResponse(agentId: string, response: AgentResponse, durationMs: number): void {
    if (response.status === 'success') {
      this.metrics.successCount++;
    } else {
      this.metrics.errorCount++;
    }

    const logData = {
      event: 'agent_response',
      agent_id: agentId,
      status: response.status,
      duration_ms: durationMs,
      has_decision_event: !!response.decision_event,
      error_code: response.error?.code,
    };

    if (response.status === 'success') {
      this.logger.info(logData, 'Agent request completed');
    } else {
      this.logger.warn({ ...logData, error: response.error }, 'Agent request failed');
    }
  }

  /**
   * Record DecisionEvent emission
   */
  recordDecisionEvent(event: DecisionEvent): void {
    this.logger.info(
      {
        event: 'decision_event_emitted',
        agent_id: event.agent_id,
        agent_version: event.agent_version,
        decision_type: event.decision_type,
        execution_ref: event.execution_ref,
        inputs_hash: event.inputs_hash,
        confidence_score: event.confidence.score,
        connector_scope: event.constraints_applied.connector_scope,
      },
      'DecisionEvent emitted'
    );
  }

  /**
   * Record validation failure
   */
  recordValidationFailure(failureType: string, details?: Record<string, unknown>): void {
    const count = this.metrics.validationFailures.get(failureType) || 0;
    this.metrics.validationFailures.set(failureType, count + 1);

    this.logger.warn(
      {
        event: 'validation_failure',
        failure_type: failureType,
        ...details,
      },
      'Validation failure recorded'
    );
  }

  /**
   * Record authentication result
   */
  recordAuthResult(method: string, success: boolean, error?: string): void {
    const logData = {
      event: 'auth_result',
      method,
      success,
      error,
    };

    if (success) {
      this.logger.debug(logData, 'Authentication succeeded');
    } else {
      this.logger.warn(logData, 'Authentication failed');
    }
  }

  /**
   * Record persistence result
   */
  recordPersistenceResult(success: boolean, durationMs: number, error?: string): void {
    const logData = {
      event: 'persistence_result',
      success,
      duration_ms: durationMs,
      error,
    };

    if (success) {
      this.logger.debug(logData, 'Persistence succeeded');
    } else {
      this.logger.error(logData, 'Persistence failed');
    }
  }

  /**
   * Get current metrics snapshot
   */
  getMetrics(): {
    requestCount: number;
    errorCount: number;
    successCount: number;
    errorRate: number;
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    avgPayloadSizeBytes: number;
    validationFailures: Record<string, number>;
  } {
    const sortedLatencies = [...this.metrics.latencies].sort((a, b) => a - b);

    return {
      requestCount: this.metrics.requestCount,
      errorCount: this.metrics.errorCount,
      successCount: this.metrics.successCount,
      errorRate:
        this.metrics.requestCount > 0
          ? this.metrics.errorCount / this.metrics.requestCount
          : 0,
      avgLatencyMs: this.calculateAverage(this.metrics.latencies),
      p50LatencyMs: this.calculatePercentile(sortedLatencies, 0.5),
      p95LatencyMs: this.calculatePercentile(sortedLatencies, 0.95),
      p99LatencyMs: this.calculatePercentile(sortedLatencies, 0.99),
      avgPayloadSizeBytes: this.calculateAverage(this.metrics.payloadSizes),
      validationFailures: Object.fromEntries(this.metrics.validationFailures),
    };
  }

  /**
   * Reset metrics (for testing)
   */
  resetMetrics(): void {
    this.metrics.requestCount = 0;
    this.metrics.errorCount = 0;
    this.metrics.successCount = 0;
    this.metrics.latencies = [];
    this.metrics.payloadSizes = [];
    this.metrics.validationFailures.clear();
  }

  /**
   * Get the underlying logger
   */
  getLogger(): Logger {
    return this.logger;
  }

  /**
   * Create a child logger with additional context
   */
  createChildLogger(bindings: Record<string, unknown>): Logger {
    return this.logger.child(bindings);
  }

  /**
   * Calculate average of array
   */
  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
   * Calculate percentile of sorted array
   */
  private calculatePercentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.ceil(percentile * sortedValues.length) - 1;
    return sortedValues[Math.max(0, index)] ?? 0;
  }

  /**
   * Generate a span ID (16 hex characters)
   */
  private generateSpanId(): string {
    return this.generateRandomHex(8);
  }

  /**
   * Generate a trace ID (32 hex characters)
   */
  private generateTraceId(): string {
    return this.generateRandomHex(16);
  }

  /**
   * Generate random hex string
   */
  private generateRandomHex(bytes: number): string {
    // Use Node.js crypto if available, otherwise use Math.random
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodeCrypto = require('crypto');
      return nodeCrypto.randomBytes(bytes).toString('hex');
    } catch {
      // Fallback for environments without crypto
      let hex = '';
      for (let i = 0; i < bytes * 2; i++) {
        hex += Math.floor(Math.random() * 16).toString(16);
      }
      return hex;
    }
  }
}

/**
 * Create a singleton telemetry service
 */
let defaultTelemetry: TelemetryService | null = null;

export function getDefaultTelemetryService(): TelemetryService {
  if (!defaultTelemetry) {
    defaultTelemetry = new TelemetryService();
  }
  return defaultTelemetry;
}

/**
 * Export telemetry metrics in Prometheus format
 */
export function exportPrometheusMetrics(telemetry: TelemetryService): string {
  const metrics = telemetry.getMetrics();

  const lines: string[] = [
    '# HELP connector_hub_agent_requests_total Total number of agent requests',
    '# TYPE connector_hub_agent_requests_total counter',
    `connector_hub_agent_requests_total ${metrics.requestCount}`,
    '',
    '# HELP connector_hub_agent_errors_total Total number of agent errors',
    '# TYPE connector_hub_agent_errors_total counter',
    `connector_hub_agent_errors_total ${metrics.errorCount}`,
    '',
    '# HELP connector_hub_agent_latency_seconds Agent request latency',
    '# TYPE connector_hub_agent_latency_seconds histogram',
    `connector_hub_agent_latency_seconds{quantile="0.5"} ${metrics.p50LatencyMs / 1000}`,
    `connector_hub_agent_latency_seconds{quantile="0.95"} ${metrics.p95LatencyMs / 1000}`,
    `connector_hub_agent_latency_seconds{quantile="0.99"} ${metrics.p99LatencyMs / 1000}`,
    '',
    '# HELP connector_hub_agent_payload_size_bytes Agent payload size',
    '# TYPE connector_hub_agent_payload_size_bytes gauge',
    `connector_hub_agent_payload_size_bytes_avg ${metrics.avgPayloadSizeBytes}`,
  ];

  // Add validation failure metrics
  for (const [type, count] of Object.entries(metrics.validationFailures)) {
    lines.push(`connector_hub_validation_failures{type="${type}"} ${count}`);
  }

  return lines.join('\n');
}
