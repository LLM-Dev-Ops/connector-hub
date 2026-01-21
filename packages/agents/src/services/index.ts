/**
 * Services - Public API
 *
 * Exports service clients for agent infrastructure.
 */

export {
  RuVectorClient,
  MockRuVectorClient,
  getDefaultRuVectorClient,
  type RuVectorConfig,
  type PersistResult,
} from './ruvector-client.js';

export {
  TelemetryService,
  getDefaultTelemetryService,
  exportPrometheusMetrics,
  type TelemetryConfig,
  type SpanContext,
  type Metrics,
} from './telemetry.js';
