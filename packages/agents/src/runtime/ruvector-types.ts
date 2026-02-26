/**
 * RuVector Service Integration Types
 *
 * Comprehensive TypeScript interfaces and types for RuVector Service integration.
 * All agents MUST use these types for data persistence via ruvector-service.
 *
 * CRITICAL: Agents NEVER connect directly to the database. ALL persistence flows through RuVector Service.
 */

import { z } from 'zod';
import type { DecisionEvent } from '../contracts/types';

// ============================================================================
// Data Classification & Sensitivity
// ============================================================================

/**
 * Data classification levels for persistence
 * - public: No sensitive info (7 year retention)
 * - internal: Internal use only (2 year retention)
 * - confidential: Contains PII or sensitive data (1 year retention, redacted)
 * - restricted: Secrets and credentials (90 day retention, encrypted)
 */
export type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted';

/**
 * Schema for data classification
 */
export const DataClassificationSchema = z.enum(['public', 'internal', 'confidential', 'restricted']);

/**
 * Redaction level for sensitive fields
 */
export type RedactionLevel = 'NONE' | 'PARTIAL' | 'FULL';

/**
 * Schema for redaction levels
 */
export const RedactionLevelSchema = z.enum(['NONE', 'PARTIAL', 'FULL']);

// ============================================================================
// RuVector Request/Response Types
// ============================================================================

/**
 * Options for writing a DecisionEvent to RuVector
 */
export interface WriteDecisionEventOptions {
  /** Data classification level */
  dataClassification: DataClassification;

  /** Idempotency key for deduplication (optional, UUID format) */
  idempotencyKey?: string;

  /** Custom redaction rules (path -> redaction level) */
  redactionRules?: Record<string, RedactionLevel>;

  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** Custom trace ID for distributed tracing */
  traceId?: string;

  /** Custom correlation ID for request tracking */
  correlationId?: string;

  /** Request ID for idempotency (auto-generated if not provided) */
  requestId?: string;
}

/**
 * Zod schema for write options
 */
export const WriteDecisionEventOptionsSchema = z.object({
  dataClassification: DataClassificationSchema,
  idempotencyKey: z.string().uuid().optional(),
  redactionRules: z.record(z.string(), RedactionLevelSchema).optional(),
  timeout: z.number().positive().optional(),
  traceId: z.string().optional(),
  correlationId: z.string().optional(),
  requestId: z.string().optional(),
});

// Type inferred from schema matches interface above

/**
 * Batch write options
 */
export interface BatchWriteDecisionEventsOptions {
  /** Data classification for all events in batch */
  dataClassification: DataClassification;

  /** Request ID for the batch (auto-generated if not provided) */
  requestId?: string;

  /** Batch timeout in milliseconds (default: 60000) */
  timeout?: number;

  /** Stop on first error, or continue processing */
  failFast?: boolean;
}

/**
 * Response from writing a DecisionEvent
 */
export interface WriteDecisionEventResponse {
  /** Request status (accepted, rejected, failed) */
  status: 'accepted' | 'rejected' | 'failed';

  /** Unique event ID assigned by RuVector */
  event_id: string;

  /** Echo of request ID for correlation */
  request_id: string;

  /** Persistence status (queued, processing, persisted, failed) */
  persistence_status: 'queued' | 'processing' | 'persisted' | 'failed';

  /** Estimated time to persist (milliseconds) */
  estimated_completion_ms?: number;

  /** Trace ID for distributed tracing */
  trace_id: string;

  /** Error details if status is rejected or failed */
  error?: WriteDecisionEventError;
}

/**
 * Error response from RuVector
 */
export interface WriteDecisionEventError {
  /** Error code (VALIDATION_FAILED, UNAUTHORIZED, DUPLICATE_EVENT, etc.) */
  code: string;

  /** Human-readable error message */
  message: string;

  /** Error details object */
  details?: Record<string, unknown>;

  /** Whether this error is retryable */
  retryable: boolean;

  /** For rate limit errors, suggested retry delay (milliseconds) */
  retry_after_ms?: number;
}

/**
 * Response from batch writing DecisionEvents
 */
export interface BatchWriteDecisionEventsResponse {
  /** Batch status */
  status: 'accepted' | 'partial' | 'failed';

  /** Unique batch ID */
  batch_id: string;

  /** Echo of request ID */
  request_id: string;

  /** Number of events accepted */
  events_accepted: number;

  /** Number of events that failed */
  events_failed: number;

  /** Per-event results */
  results: BatchEventResult[];

  /** Trace ID for distributed tracing */
  trace_id: string;
}

/**
 * Per-event result in batch response
 */
export interface BatchEventResult {
  /** Event ID (if accepted) or undefined */
  event_id?: string;

  /** Status for this event */
  status: 'accepted' | 'rejected' | 'failed';

  /** Error details if status is not accepted */
  error?: WriteDecisionEventError;
}

// ============================================================================
// Artifact Writing Types
// ============================================================================

/**
 * Types of artifacts that can be persisted
 */
export type ArtifactType =
  | 'webhook_payload'
  | 'api_response'
  | 'database_result'
  | 'erp_event'
  | 'raw_event'
  | 'normalized_payload';

/**
 * Schema for artifact types
 */
export const ArtifactTypeSchema = z.enum([
  'webhook_payload',
  'api_response',
  'database_result',
  'erp_event',
  'raw_event',
  'normalized_payload',
]);

/**
 * Ingress artifact to persist
 */
export interface IngressArtifact {
  /** Type of artifact */
  artifact_type: ArtifactType;

  /** Source connector (e.g., "shopify", "salesforce") */
  source_connector: string;

  /** Raw payload (JSON string or base64 encoded) */
  raw_payload: string;

  /** When the artifact was received */
  received_at: string; // ISO 8601 timestamp

  /** Content type of the payload */
  content_type: string;

  /** Whether the signature was verified (for webhooks) */
  signature_verified?: boolean;

  /** Source IP address (if from webhook) */
  source_ip?: string;

  /** HTTP headers from the source */
  headers?: Record<string, string>;
}

/**
 * Zod schema for ingress artifact
 */
export const IngressArtifactSchema = z.object({
  artifact_type: ArtifactTypeSchema,
  source_connector: z.string(),
  raw_payload: z.string(),
  received_at: z.string().datetime(),
  content_type: z.string(),
  signature_verified: z.boolean().optional(),
  source_ip: z.string().optional(),
  headers: z.record(z.string()).optional(),
});

/**
 * Options for writing an ingress artifact
 */
export interface WriteIngressArtifactOptions {
  /** Data classification */
  dataClassification: DataClassification;

  /** Time to live in seconds (default: 86400 = 24 hours) */
  ttl_seconds?: number;

  /** Request ID for idempotency */
  requestId?: string;
}

/**
 * Response from writing an ingress artifact
 */
export interface WriteIngressArtifactResponse {
  /** Request status */
  status: 'accepted' | 'rejected' | 'failed';

  /** Unique artifact ID assigned by RuVector */
  artifact_id: string;

  /** Echo of request ID */
  request_id: string;

  /** Persistence status */
  persistence_status: 'queued' | 'processing' | 'persisted' | 'failed';

  /** When the artifact will expire (ISO 8601) */
  retention_expires_at: string;

  /** Trace ID */
  trace_id: string;

  /** Error if status is not accepted */
  error?: WriteDecisionEventError;
}

// ============================================================================
// Query Result Types
// ============================================================================

/**
 * Database types supported
 */
export type DatabaseType =
  | 'postgresql'
  | 'mysql'
  | 'mariadb'
  | 'mongodb'
  | 'redis'
  | 'elasticsearch'
  | 'dynamodb'
  | 'cosmosdb'
  | 'bigquery'
  | 'snowflake'
  | 'custom';

/**
 * Query result types
 */
export type QueryResultType = 'select' | 'insert' | 'update' | 'delete' | 'aggregate' | 'transaction' | 'ddl';

/**
 * Column metadata
 */
export interface ColumnMetadata {
  /** Column name */
  name: string;

  /** Data type */
  type: string;

  /** Whether column is nullable */
  nullable?: boolean;

  /** PII type if this column contains PII (email, phone, ssn, etc.) */
  pii_type?: string;
}

/**
 * Zod schema for column metadata
 */
export const ColumnMetadataSchema = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.boolean().optional(),
  pii_type: z.string().optional(),
});

/**
 * Query result to persist
 */
export interface DatabaseQueryResult {
  /** Database type */
  database_type: DatabaseType;

  /** Database name */
  database_name: string;

  /** Schema name (optional) */
  schema_name?: string;

  /** Type of query result */
  result_type: QueryResultType;

  /** Hash of the query for deduplication */
  query_hash: string;

  /** Number of rows affected */
  rows_affected?: number;

  /** Number of rows returned */
  rows_returned?: number;

  /** Column definitions */
  columns?: ColumnMetadata[];

  /** Sample rows (PII should be redacted) */
  sample_rows?: Record<string, unknown>[];

  /** Query execution time in milliseconds */
  execution_time_ms: number;

  /** When the query was executed */
  executed_at: string; // ISO 8601 timestamp

  /** Transaction ID if part of a transaction */
  transaction_id?: string;

  /** Connection ID for tracing */
  connection_id?: string;
}

/**
 * Zod schema for query result
 */
export const DatabaseQueryResultSchema = z.object({
  database_type: z.string(),
  database_name: z.string(),
  schema_name: z.string().optional(),
  result_type: z.enum(['select', 'insert', 'update', 'delete', 'aggregate', 'transaction', 'ddl']),
  query_hash: z.string(),
  rows_affected: z.number().optional(),
  rows_returned: z.number().optional(),
  columns: z.array(ColumnMetadataSchema).optional(),
  sample_rows: z.array(z.record(z.unknown())).optional(),
  execution_time_ms: z.number(),
  executed_at: z.string().datetime(),
  transaction_id: z.string().optional(),
  connection_id: z.string().optional(),
});

// Type inferred from schema matches interface above

/**
 * Options for writing a query result
 */
export interface WriteQueryResultOptions {
  /** Data classification */
  dataClassification: DataClassification;

  /** Whether PII redaction was applied */
  redaction_applied: boolean;

  /** Request ID for idempotency */
  requestId?: string;
}

/**
 * Response from writing a query result
 */
export interface WriteQueryResultResponse {
  /** Request status */
  status: 'accepted' | 'rejected' | 'failed';

  /** Unique result ID assigned by RuVector */
  result_id: string;

  /** Echo of request ID */
  request_id: string;

  /** Persistence status */
  persistence_status: 'queued' | 'processing' | 'persisted' | 'failed';

  /** Row count that was persisted */
  row_count: number;

  /** Trace ID */
  trace_id: string;

  /** Error if status is not accepted */
  error?: WriteDecisionEventError;
}

// ============================================================================
// RuVector Client Configuration
// ============================================================================

/**
 * Authentication options for RuVector
 */
export type RuVectorAuth = RuVectorMTLSAuth | RuVectorBearerTokenAuth;

/**
 * mTLS authentication
 */
export interface RuVectorMTLSAuth {
  type: 'mtls';
  keyPath: string;
  certPath: string;
  caPath: string;
}

/**
 * Bearer token authentication
 */
export interface RuVectorBearerTokenAuth {
  type: 'bearer';
  token: string;
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Enable circuit breaker */
  enabled: boolean;

  /** Failure threshold (percentage) */
  failureThreshold?: number; // 0-100, default 50

  /** Time window for failure calculation (seconds) */
  failureWindow?: number; // default 60

  /** Success threshold to close circuit */
  successThreshold?: number; // default 2

  /** Timeout before testing recovery (seconds) */
  timeout?: number; // default 30

  /** Minimum sample size before triggering */
  sampleSize?: number; // default 100
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Enable retries */
  enabled: boolean;

  /** Maximum retry attempts */
  maxAttempts?: number; // default 5

  /** Base backoff delay (milliseconds) */
  backoffBase?: number; // default 100

  /** Maximum backoff delay (milliseconds) */
  backoffMax?: number; // default 30000

  /** Error-specific overrides */
  errorSpecific?: Record<number, { maxAttempts?: number }>;
}

/**
 * Local queue configuration
 */
export interface LocalQueueConfig {
  /** Enable local queue when RuVector is unavailable */
  enabled: boolean;

  /** Maximum queue size */
  maxSize?: number; // default 1000

  /** Maximum age before discarding (seconds) */
  maxAge?: number; // default 3600

  /** Flush interval (milliseconds) */
  flushInterval?: number; // default 5000

  /** Use disk-backed queue for durability */
  useDiskQueue?: boolean;

  /** Disk queue directory */
  diskQueueDir?: string;
}

/**
 * RuVector client configuration
 */
export interface RuVectorClientConfig {
  /** Base URL of RuVector service */
  baseUrl: string;

  /** Authentication configuration */
  auth: RuVectorAuth;

  /** Circuit breaker configuration */
  circuitBreaker?: Partial<CircuitBreakerConfig>;

  /** Retry configuration */
  retry?: Partial<RetryConfig>;

  /** Local queue configuration */
  localQueue?: Partial<LocalQueueConfig>;

  /** Default timeout for requests (milliseconds) */
  timeout?: number;

  /** Enable debug logging */
  debug?: boolean;

  /** Custom headers to include with all requests */
  customHeaders?: Record<string, string>;
}

// ============================================================================
// RuVector Client Health & Status
// ============================================================================

/**
 * Circuit breaker state
 */
export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Health status
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * RuVector service health
 */
export interface RuVectorHealth {
  /** Overall health status */
  status: HealthStatus;

  /** Whether service is healthy */
  healthy: boolean;

  /** Database health */
  database: HealthStatus;

  /** Circuit breaker state */
  circuitBreaker: CircuitBreakerState;

  /** Response time (milliseconds) */
  responseTime?: number;

  /** Detailed errors (if unhealthy) */
  errors?: string[];
}

/**
 * Metrics snapshot
 */
export interface RuVectorMetrics {
  /** Total requests */
  requests_total: number;

  /** Successful requests */
  requests_success: number;

  /** Failed requests */
  requests_failed: number;

  /** Current circuit breaker state */
  circuit_breaker_state: CircuitBreakerState;

  /** Circuit breaker failures */
  circuit_breaker_failures: number;

  /** Total retries */
  retries_total: number;

  /** Exhausted retries */
  retries_exhausted: number;

  /** Current queue size */
  queue_size: number;

  /** Idempotency cache hits */
  idempotency_cache_hits: number;

  /** Idempotency cache misses */
  idempotency_cache_misses: number;

  /** Average request latency (milliseconds) */
  avg_latency_ms: number;
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Base error class for RuVector client
 */
export class RuVectorClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
    public readonly statusCode?: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'RuVectorClientError';
  }
}

/**
 * Validation error (400)
 */
export class RuVectorValidationError extends RuVectorClientError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_FAILED', false, 400, details);
    this.name = 'RuVectorValidationError';
  }
}

/**
 * Authentication error (401)
 */
export class RuVectorAuthenticationError extends RuVectorClientError {
  constructor(message: string, details?: unknown) {
    super(message, 'UNAUTHORIZED', false, 401, details);
    this.name = 'RuVectorAuthenticationError';
  }
}

/**
 * Conflict error (409) - duplicate event
 */
export class RuVectorConflictError extends RuVectorClientError {
  constructor(message: string, details?: unknown) {
    super(message, 'DUPLICATE_EVENT', false, 409, details);
    this.name = 'RuVectorConflictError';
  }
}

/**
 * Rate limit error (429)
 */
export class RuVectorRateLimitError extends RuVectorClientError {
  constructor(message: string, public retryAfterMs?: number, details?: unknown) {
    super(message, 'RATE_LIMIT', true, 429, details);
    this.name = 'RuVectorRateLimitError';
  }
}

/**
 * Service unavailable error (503)
 */
export class RuVectorUnavailableError extends RuVectorClientError {
  constructor(message: string, details?: unknown) {
    super(message, 'SERVICE_UNAVAILABLE', true, 503, details);
    this.name = 'RuVectorUnavailableError';
  }
}

/**
 * Timeout error (504)
 */
export class RuVectorTimeoutError extends RuVectorClientError {
  constructor(message: string, details?: unknown) {
    super(message, 'GATEWAY_TIMEOUT', true, 504, details);
    this.name = 'RuVectorTimeoutError';
  }
}

/**
 * Circuit breaker error
 */
export class RuVectorCircuitBreakerError extends RuVectorClientError {
  constructor(message: string, details?: unknown) {
    super(message, 'CIRCUIT_BREAKER_OPEN', true, undefined, details);
    this.name = 'RuVectorCircuitBreakerError';
  }
}

/**
 * Network error
 */
export class RuVectorNetworkError extends RuVectorClientError {
  constructor(message: string, details?: unknown) {
    super(message, 'NETWORK_ERROR', true, undefined, details);
    this.name = 'RuVectorNetworkError';
  }
}

// ============================================================================
// RuVector Client Interface
// ============================================================================

/**
 * RuVector client interface
 * All agents should use this for data persistence
 */
export interface IRuVectorClient {
  /**
   * Write a single DecisionEvent
   */
  writeDecisionEvent(event: DecisionEvent, options: WriteDecisionEventOptions): Promise<WriteDecisionEventResponse>;

  /**
   * Write a DecisionEvent asynchronously (fire-and-forget with timeout)
   */
  writeDecisionEventAsync(event: DecisionEvent, options: WriteDecisionEventOptions & { timeout?: number }): Promise<void>;

  /**
   * Write multiple DecisionEvents in a batch
   */
  batchWriteDecisionEvents(
    events: DecisionEvent[],
    options: BatchWriteDecisionEventsOptions
  ): Promise<BatchWriteDecisionEventsResponse>;

  /**
   * Write an ingress artifact
   */
  writeIngressArtifact(artifact: IngressArtifact, options: WriteIngressArtifactOptions): Promise<WriteIngressArtifactResponse>;

  /**
   * Write a database query result
   */
  writeQueryResult(result: DatabaseQueryResult, options: WriteQueryResultOptions): Promise<WriteQueryResultResponse>;

  /**
   * Check health of RuVector service
   */
  health(): Promise<RuVectorHealth>;

  /**
   * Get current metrics
   */
  metrics(): Promise<RuVectorMetrics>;

  /**
   * Initialize client
   */
  initialize(): Promise<void>;

  /**
   * Cleanup and shutdown
   */
  shutdown(): Promise<void>;
}

// ============================================================================
// PII Detection & Redaction
// ============================================================================

/**
 * PII detection result
 */
export interface PIIDetectionResult {
  /** Whether PII was detected */
  pii_detected: boolean;

  /** List of PII types found */
  pii_types: string[];

  /** List of field paths containing PII */
  fields: string[];

  /** Redaction suggestions */
  redaction_suggestions: Record<string, RedactionLevel>;
}

/**
 * Validator for detecting credentials in payloads
 */
export interface ISecretsValidator {
  /**
   * Check if payload contains secrets
   */
  hasSecrets(payload: unknown): boolean;

  /**
   * Get detailed secret detection results
   */
  detectSecrets(payload: unknown): PIIDetectionResult;
}

// ============================================================================
// Batch Processing
// ============================================================================

/**
 * Configuration for batch processing
 */
export interface BatchConfig {
  /** Maximum events per batch */
  maxBatchSize?: number; // default 100

  /** Maximum time to wait before flushing (milliseconds) */
  maxWaitMs?: number; // default 5000

  /** Enable batching */
  enabled?: boolean; // default true
}

/**
 * Batched write result
 */
export interface BatchedWriteResult {
  /** Whether the write was successfully batched */
  batched: boolean;

  /** Batch ID if batched */
  batchId?: string;

  /** Promise that resolves when batch is persisted */
  persisted: Promise<BatchWriteDecisionEventsResponse>;
}

// ============================================================================
// Observability
// ============================================================================

/**
 * Structured log entry for RuVector operations
 */
export interface RuVectorLogEntry {
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
  message: string;
  event_id?: string;
  request_id?: string;
  trace_id?: string;
  correlation_id?: string;
  agent_id?: string;
  execution_ref?: string;
  status_code?: number;
  duration_ms?: number;
  data_classification?: DataClassification;
  payload_size_bytes?: number;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  [key: string]: unknown;
}

/**
 * Observability callback
 */
export type ObservabilityCallback = (entry: RuVectorLogEntry) => void;

// All types are exported inline above
