/**
 * Webhook Listener Agent
 *
 * Receives, authenticates, and validates inbound webhook payloads from third-party systems.
 *
 * CLASSIFICATION: INGRESS CONNECTOR / WEBHOOK RECEIVER
 *
 * SCOPE:
 * - Verify webhook signatures (HMAC, JWT, API Key)
 * - Validate payload structure
 * - Enforce schema correctness
 * - Reject malformed or unauthorized requests
 * - Emit webhook_ingest_event DecisionEvents
 *
 * MUST NOT:
 * - Modify internal execution behavior
 * - Trigger workflows or retries
 * - Enforce governance or business policies
 * - Execute other agents
 * - Apply optimizations
 * - Emit analytical or anomaly signals
 *
 * DEPLOYMENT: Google Cloud Edge Function
 * PERSISTENCE: Via ruvector-service only (no direct SQL)
 */

import * as crypto from 'crypto';
import {
  type IAgent,
  type AgentResponse,
  type DecisionEvent,
  type WebhookRequest,
  type WebhookAgentConfig,
  type WebhookOutput,
  type WebhookValidationResult,
  type PersistedWebhookData,
  WebhookAgentConfigSchema,
  WebhookRequestSchema,
  createDecisionEvent,
  createWebhookConfidence,
  createWebhookConstraints,
  sanitizeHeaders,
} from '../contracts/index.js';
import { SignatureVerifier } from './signature.js';
import { PayloadValidator, computePayloadHash, validateSourceIP } from './validator.js';
import { RuVectorClient, type PersistResult } from '../services/ruvector-client.js';
import { TelemetryService, type SpanContext } from '../services/telemetry.js';

/**
 * Agent version - follows semantic versioning
 */
const AGENT_VERSION = '1.0.0';

/**
 * Webhook Listener Agent
 *
 * Stateless agent that processes webhook requests and emits DecisionEvents.
 * Designed for deployment as a Google Cloud Edge Function.
 */
export class WebhookListenerAgent implements IAgent {
  readonly agentId: string;
  readonly version = AGENT_VERSION;
  readonly decisionType = 'webhook_ingest_event' as const;

  private readonly config: WebhookAgentConfig;
  private readonly signatureVerifier: SignatureVerifier | null;
  private readonly payloadValidator: PayloadValidator;
  private readonly ruvectorClient: RuVectorClient;
  private readonly telemetry: TelemetryService;
  private initialized = false;

  constructor(
    config: WebhookAgentConfig,
    options: {
      ruvectorClient?: RuVectorClient;
      telemetry?: TelemetryService;
    } = {}
  ) {
    // Validate configuration
    const validatedConfig = WebhookAgentConfigSchema.parse(config);
    this.config = validatedConfig;

    // Generate unique agent ID
    this.agentId = `webhook-listener-${validatedConfig.connector_id}`;

    // Initialize signature verifier if configured
    this.signatureVerifier = validatedConfig.signature
      ? new SignatureVerifier(validatedConfig.signature)
      : null;

    // Initialize payload validator
    this.payloadValidator = new PayloadValidator({
      maxPayloadSizeBytes: validatedConfig.max_payload_bytes,
      allowedContentTypes: validatedConfig.allowed_content_types,
      strictMode: false,
    });

    // Initialize services
    this.ruvectorClient = options.ruvectorClient || new RuVectorClient();
    this.telemetry =
      options.telemetry ||
      new TelemetryService({
        serviceName: 'webhook-listener-agent',
        serviceVersion: AGENT_VERSION,
        customAttributes: {
          connector_id: validatedConfig.connector_id,
          connector_scope: validatedConfig.connector_scope,
        },
      });
  }

  /**
   * Initialize the agent
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const span = this.telemetry.startSpan('agent.initialize', {
      agent_id: this.agentId,
    });

    try {
      await this.ruvectorClient.initialize();
      this.initialized = true;
      this.telemetry.endSpan(span, 'ok');
    } catch (error) {
      this.telemetry.endSpan(span, 'error', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Process a webhook request
   *
   * This is the main entry point for the agent. It:
   * 1. Validates the request structure
   * 2. Verifies the signature (if configured)
   * 3. Validates the payload
   * 4. Creates and emits a DecisionEvent
   * 5. Persists the data to ruvector-service
   */
  async process(input: unknown): Promise<AgentResponse> {
    const startTime = Date.now();
    const span = this.telemetry.startSpan('agent.process', {
      agent_id: this.agentId,
    });

    try {
      // Parse and validate the webhook request
      const request = this.parseRequest(input);

      // Record request metrics
      this.telemetry.recordRequest(
        this.agentId,
        this.decisionType,
        Buffer.byteLength(request.body, 'utf8')
      );

      // Validate source IP if configured
      if (
        this.config.allowed_source_ips &&
        this.config.allowed_source_ips.length > 0 &&
        request.source_ip
      ) {
        if (!validateSourceIP(request.source_ip, this.config.allowed_source_ips)) {
          return this.createErrorResponse(
            'auth_failed',
            'SOURCE_IP_NOT_ALLOWED',
            `Source IP ${request.source_ip} is not in the allowed list`,
            false,
            startTime,
            span
          );
        }
      }

      // Verify signature
      const signatureResult = await this.verifySignature(request);
      if (!signatureResult.valid) {
        this.telemetry.recordAuthResult(
          signatureResult.method,
          false,
          signatureResult.error
        );
        return this.createErrorResponse(
          'auth_failed',
          'SIGNATURE_VERIFICATION_FAILED',
          signatureResult.error || 'Signature verification failed',
          false,
          startTime,
          span
        );
      }

      this.telemetry.recordAuthResult(signatureResult.method, true);

      // Validate payload
      const validationResult = await this.payloadValidator.validate(request);
      if (!validationResult.valid) {
        this.telemetry.recordValidationFailure(
          validationResult.errors[0]?.code || 'UNKNOWN',
          { errors: validationResult.errors }
        );
        return this.createErrorResponse(
          'validation_failed',
          'PAYLOAD_VALIDATION_FAILED',
          `Validation failed: ${validationResult.errors.map((e) => e.message).join(', ')}`,
          false,
          startTime,
          span,
          { validation_errors: validationResult.errors }
        );
      }

      // Create normalized output
      const output = this.createNormalizedOutput(request, validationResult);

      // Create DecisionEvent
      const decisionEvent = this.createWebhookDecisionEvent(
        request,
        output,
        signatureResult,
        validationResult
      );

      // Record DecisionEvent emission
      this.telemetry.recordDecisionEvent(decisionEvent);

      // Persist to ruvector-service
      const persistResult = await this.persistData(request, decisionEvent, validationResult);
      if (!persistResult.success) {
        // Log but don't fail - the DecisionEvent is still valid
        this.telemetry.recordPersistenceResult(false, Date.now() - startTime, persistResult.error);
      } else {
        this.telemetry.recordPersistenceResult(true, Date.now() - startTime);
      }

      const response: AgentResponse = {
        status: 'success',
        decision_event: decisionEvent,
        telemetry: {
          duration_ms: Date.now() - startTime,
          validation_time_ms: validationResult.validation_duration_ms,
        },
      };

      this.telemetry.recordResponse(this.agentId, response, Date.now() - startTime);
      this.telemetry.endSpan(span, 'ok');

      return response;
    } catch (error) {
      return this.createErrorResponse(
        'error',
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : 'Unknown error',
        true,
        startTime,
        span
      );
    }
  }

  /**
   * Shutdown the agent
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    await this.ruvectorClient.shutdown();
    this.initialized = false;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      return await this.ruvectorClient.healthCheck();
    } catch {
      return false;
    }
  }

  /**
   * Parse and validate the incoming request
   */
  private parseRequest(input: unknown): WebhookRequest {
    // If input is already a WebhookRequest, validate it
    if (typeof input === 'object' && input !== null) {
      return WebhookRequestSchema.parse(input);
    }

    throw new Error('Invalid input: expected WebhookRequest object');
  }

  /**
   * Verify the webhook signature
   */
  private async verifySignature(request: WebhookRequest): Promise<{
    valid: boolean;
    method: string;
    error?: string;
  }> {
    if (!this.signatureVerifier) {
      return { valid: true, method: 'none' };
    }

    const result = await this.signatureVerifier.verify(request.headers, request.body);
    return {
      valid: result.valid,
      method: result.method,
      error: result.error,
    };
  }

  /**
   * Create normalized output from the request
   */
  private createNormalizedOutput(
    request: WebhookRequest,
    _validationResult: WebhookValidationResult
  ): WebhookOutput {
    // Parse the body if it's JSON
    let parsedPayload: Record<string, unknown>;
    try {
      parsedPayload = request.parsed_body || JSON.parse(request.body);
    } catch {
      parsedPayload = { raw: request.body };
    }

    // Extract common identifiers from the payload
    const identifiers: WebhookOutput['identifiers'] = {};

    if (parsedPayload['correlation_id'] || parsedPayload['correlationId']) {
      identifiers.correlation_id = String(
        parsedPayload['correlation_id'] || parsedPayload['correlationId']
      );
    }

    if (parsedPayload['idempotency_key'] || parsedPayload['idempotencyKey']) {
      identifiers.idempotency_key = String(
        parsedPayload['idempotency_key'] || parsedPayload['idempotencyKey']
      );
    }

    if (parsedPayload['external_id'] || parsedPayload['externalId'] || parsedPayload['id']) {
      identifiers.external_id = String(
        parsedPayload['external_id'] || parsedPayload['externalId'] || parsedPayload['id']
      );
    }

    // Try to detect event type
    let eventType: string | undefined;
    if (parsedPayload['event_type'] || parsedPayload['eventType'] || parsedPayload['type']) {
      eventType = String(
        parsedPayload['event_type'] || parsedPayload['eventType'] || parsedPayload['type']
      );
    } else if (request.headers['x-event-type']) {
      eventType = request.headers['x-event-type'];
    }

    return {
      source_id: this.config.connector_id,
      event_type: eventType,
      payload: parsedPayload,
      original_payload_hash: computePayloadHash(request.body),
      normalization_mapping: 'passthrough',
      identifiers: Object.keys(identifiers).length > 0 ? identifiers : undefined,
    };
  }

  /**
   * Create a DecisionEvent for the webhook
   */
  private createWebhookDecisionEvent(
    request: WebhookRequest,
    output: WebhookOutput,
    signatureResult: { valid: boolean; method: string },
    validationResult: WebhookValidationResult
  ): DecisionEvent {
    // Determine auth assurance level
    let authLevel: 'none' | 'low' | 'medium' | 'high' | 'verified' = 'none';
    if (signatureResult.valid) {
      switch (signatureResult.method) {
        case 'hmac_sha256':
        case 'hmac_sha512':
          authLevel = 'high';
          break;
        case 'jwt_hs256':
        case 'jwt_rs256':
          authLevel = 'verified';
          break;
        case 'api_key':
          authLevel = 'medium';
          break;
        case 'basic_auth':
          authLevel = 'low';
          break;
        default:
          authLevel = 'none';
      }
    }

    // Create confidence metrics
    const confidence = createWebhookConfidence({
      signatureValid: signatureResult.valid,
      schemaValid: validationResult.schema_valid,
      payloadComplete: validationResult.errors.length === 0,
      authLevel,
    });

    // Create constraints
    const constraints = createWebhookConstraints({
      connectorScope: this.config.connector_scope,
      identityContext: output.identifiers?.external_id,
      schemaBoundaries: this.config.allowed_content_types,
      rateLimitApplied: this.config.rate_limit_enabled,
      payloadSizeBytes: Buffer.byteLength(request.body, 'utf8'),
      timeoutMs: this.config.timeout_ms,
    });

    return createDecisionEvent({
      agentId: this.agentId,
      agentVersion: this.version,
      decisionType: this.decisionType,
      input: request,
      outputs: output as unknown as Record<string, unknown>,
      confidence,
      constraintsApplied: constraints,
      metadata: {
        request_path: request.path,
        content_type: request.content_type,
        signature_method: signatureResult.method,
        validation_duration_ms: validationResult.validation_duration_ms,
      },
    });
  }

  /**
   * Persist data to ruvector-service
   */
  private async persistData(
    request: WebhookRequest,
    decisionEvent: DecisionEvent,
    validationResult: WebhookValidationResult
  ): Promise<PersistResult> {
    const persistedData: PersistedWebhookData = {
      decision_event: decisionEvent,
      request_metadata: {
        path: request.path,
        content_type: request.content_type,
        source_ip_hash: request.source_ip
          ? crypto.createHash('sha256').update(request.source_ip).digest('hex')
          : '',
        received_at: request.received_at,
      },
      validation_summary: {
        signature_valid: validationResult.signature.valid,
        schema_valid: validationResult.schema_valid,
        error_count: validationResult.errors.length,
      },
    };

    return this.ruvectorClient.persistWebhookData(persistedData);
  }

  /**
   * Create an error response
   */
  private createErrorResponse(
    status: AgentResponse['status'],
    code: string,
    message: string,
    retryable: boolean,
    startTime: number,
    span: SpanContext,
    details?: Record<string, unknown>
  ): AgentResponse {
    const response: AgentResponse = {
      status,
      error: {
        code,
        message,
        details,
        retryable,
      },
      telemetry: {
        duration_ms: Date.now() - startTime,
      },
    };

    this.telemetry.recordResponse(this.agentId, response, Date.now() - startTime);
    this.telemetry.endSpan(span, 'error', { error_code: code });

    return response;
  }

  /**
   * Get sanitized headers for logging
   */
  getSanitizedHeaders(request: WebhookRequest): Record<string, string> {
    return sanitizeHeaders(request.headers);
  }

  /**
   * Get current metrics
   */
  getMetrics(): ReturnType<TelemetryService['getMetrics']> {
    return this.telemetry.getMetrics();
  }
}

/**
 * Factory function to create a WebhookListenerAgent
 */
export function createWebhookListenerAgent(
  config: WebhookAgentConfig,
  options?: {
    ruvectorClient?: RuVectorClient;
    telemetry?: TelemetryService;
  }
): WebhookListenerAgent {
  return new WebhookListenerAgent(config, options);
}
