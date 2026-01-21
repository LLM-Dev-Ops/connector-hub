/**
 * Webhook Ingest Agent
 *
 * PURPOSE: Receive and validate inbound webhooks from external systems
 *
 * RESPONSIBILITIES:
 * - Authenticate webhook requests (signature verification)
 * - Validate webhook payloads against schemas
 * - Extract relevant data from webhooks
 * - Prevent replay attacks
 * - Emit webhook_ingest_event DecisionEvents
 *
 * CLASSIFICATION: INGRESS CONNECTOR / WEBHOOK RECEIVER
 *
 * SECURITY:
 * - Verify webhook signatures (HMAC, JWT, API Key)
 * - Reject invalid or expired signatures
 * - Protect against replay attacks
 * - Sanitize all sensitive headers
 * - Rate limiting enforcement
 *
 * CONSTRAINTS:
 * - Confidence based on signature verification and payload completeness
 */

import * as crypto from 'crypto';
import { BaseAgent } from '../../shared/BaseAgent.js';
import {
  type Confidence,
  type ConstraintsApplied,
  type WebhookRequest,
  type WebhookValidationResult,
  type ValidationError,
  type SignatureVerificationResult,
  type WebhookAgentConfig,
  type WebhookOutput,
  WebhookRequestSchema,
  createWebhookConfidence,
  createWebhookConstraints,
  sanitizeHeaders,
  computeInputsHash,
} from '../../contracts/index.js';

// ============================================================================
// Webhook Ingest Agent Implementation
// ============================================================================

export class WebhookIngestAgent extends BaseAgent {
  private readonly webhookConfig: WebhookAgentConfig;
  private readonly requestTimestamps: Map<string, number> = new Map();

  constructor(config: WebhookAgentConfig) {
    super('webhook-ingest-agent', '1.0.0', 'webhook_ingest_event', config);
    this.webhookConfig = config;
  }

  async initialize(): Promise<void> {
    await super.initialize();

    // Start cleanup interval for replay protection
    if (this.webhookConfig.replay_protection) {
      setInterval(() => this.cleanupOldTimestamps(), 60000); // Every minute
    }
  }

  protected async validateInput(input: unknown): Promise<{
    valid: boolean;
    error?: string;
    duration_ms?: number;
  }> {
    const startTime = Date.now();

    try {
      WebhookRequestSchema.parse(input);
      return {
        valid: true,
        duration_ms: Date.now() - startTime,
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Invalid webhook request',
        duration_ms: Date.now() - startTime,
      };
    }
  }

  protected async executeProcessing(input: unknown): Promise<{
    outputs: Record<string, unknown>;
    confidence: Confidence;
    constraintsApplied: ConstraintsApplied;
    metadata?: Record<string, unknown>;
  }> {
    const webhookRequest = WebhookRequestSchema.parse(input);

    // Perform validation
    const validationResult = await this.validateWebhook(webhookRequest);

    // Check if validation passed
    if (!validationResult.valid) {
      throw new Error(
        `Webhook validation failed: ${validationResult.errors.map((e) => e.message).join(', ')}`,
      );
    }

    // Parse body
    const parsedBody =
      webhookRequest.parsed_body ||
      (webhookRequest.content_type === 'application/json'
        ? JSON.parse(webhookRequest.body)
        : { raw: webhookRequest.body });

    // Extract identifiers
    const identifiers = this.extractIdentifiers(parsedBody);

    // Build output
    const output: WebhookOutput = {
      source_id: this.webhookConfig.connector_id,
      event_type: this.detectEventType(webhookRequest.path, parsedBody),
      payload: parsedBody,
      original_payload_hash: computeInputsHash(webhookRequest.body),
      identifiers,
    };

    // Calculate confidence
    const confidence = createWebhookConfidence({
      signatureValid: validationResult.signature.valid,
      schemaValid: validationResult.schema_valid,
      payloadComplete: this.calculatePayloadCompleteness(parsedBody) > 0.8,
      authLevel: this.getAuthLevel(validationResult.signature),
    });

    // Build constraints
    const constraintsApplied = createWebhookConstraints({
      connectorScope: this.webhookConfig.connector_scope,
      identityContext: identifiers.external_id,
      schemaBoundaries: [
        `webhook:${this.webhookConfig.connector_id}`,
        `content-type:${webhookRequest.content_type}`,
      ],
      rateLimitApplied: this.webhookConfig.rate_limit_enabled,
      payloadSizeBytes: Buffer.byteLength(webhookRequest.body),
      timeoutMs: this.config.timeout_ms,
    });

    return {
      outputs: output,
      confidence,
      constraintsApplied,
      metadata: {
        validation_result: validationResult,
        sanitized_headers: sanitizeHeaders(webhookRequest.headers),
      },
    };
  }

  /**
   * Validate webhook request
   */
  private async validateWebhook(
    request: WebhookRequest,
  ): Promise<WebhookValidationResult> {
    const startTime = Date.now();
    const errors: ValidationError[] = [];

    // Verify signature
    const signatureResult = this.verifySignature(request);
    if (!signatureResult.valid) {
      errors.push({
        path: 'signature',
        code: 'INVALID_SIGNATURE',
        message: signatureResult.error || 'Signature verification failed',
      });
    }

    // Check content type
    if (!this.webhookConfig.allowed_content_types.includes(request.content_type)) {
      errors.push({
        path: 'content_type',
        code: 'INVALID_CONTENT_TYPE',
        message: `Content type ${request.content_type} not allowed`,
        expected: this.webhookConfig.allowed_content_types.join(', '),
        actual: request.content_type,
      });
    }

    // Check source IP if configured
    if (request.source_ip && this.webhookConfig.allowed_source_ips) {
      const ipAllowed = this.webhookConfig.allowed_source_ips.some((allowed) =>
        this.ipMatches(request.source_ip!, allowed),
      );

      if (!ipAllowed) {
        errors.push({
          path: 'source_ip',
          code: 'UNAUTHORIZED_IP',
          message: `Source IP ${request.source_ip} not allowed`,
        });
      }
    }

    // Validate replay protection
    if (this.webhookConfig.replay_protection && !this.checkReplayProtection(request)) {
      errors.push({
        path: 'timestamp',
        code: 'REPLAY_ATTACK',
        message: 'Request timestamp indicates possible replay attack',
      });
    }

    // Schema validation
    const schemaValid = this.validatePayloadSchema(request);

    return {
      valid: errors.length === 0 && schemaValid,
      signature: signatureResult,
      schema_valid: schemaValid,
      errors,
      validation_duration_ms: Date.now() - startTime,
    };
  }

  /**
   * Verify webhook signature
   */
  private verifySignature(request: WebhookRequest): SignatureVerificationResult {
    const config = this.webhookConfig.signature;
    if (!config || config.method === 'none') {
      return { valid: true, method: 'none' };
    }

    const signature = request.headers[config.header_name.toLowerCase()];
    if (!signature) {
      return {
        valid: false,
        method: config.method,
        error: 'Missing signature header',
      };
    }

    try {
      switch (config.method) {
        case 'hmac_sha256':
        case 'hmac_sha512': {
          const algorithm = config.method === 'hmac_sha256' ? 'sha256' : 'sha512';
          const hmac = crypto.createHmac(algorithm, config.secret_key || '');
          const expectedSignature = hmac.update(request.body).digest('hex');
          const valid = crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature),
          );
          return { valid, method: config.method };
        }

        case 'api_key': {
          const apiKey = request.headers[config.api_key_header.toLowerCase()];
          const valid = apiKey === config.secret_key;
          return { valid, method: config.method };
        }

        default:
          return {
            valid: false,
            method: config.method,
            error: 'Unsupported signature method',
          };
      }
    } catch (error) {
      return {
        valid: false,
        method: config.method,
        error: error instanceof Error ? error.message : 'Signature verification error',
      };
    }
  }

  /**
   * Check replay protection
   */
  private checkReplayProtection(request: WebhookRequest): boolean {
    const config = this.webhookConfig.signature;
    if (!config) return true;

    const timestampHeader = request.headers[config.timestamp_header.toLowerCase()];
    if (!timestampHeader) return false;

    const requestTime = parseInt(timestampHeader, 10);
    const currentTime = Math.floor(Date.now() / 1000);
    const timeDiff = Math.abs(currentTime - requestTime);

    // Check if timestamp is within tolerance
    if (timeDiff > config.timestamp_tolerance_seconds) {
      return false;
    }

    // Check if we've seen this exact request before
    const requestHash = computeInputsHash(request.body + timestampHeader);
    if (this.requestTimestamps.has(requestHash)) {
      return false;
    }

    // Store timestamp
    this.requestTimestamps.set(requestHash, currentTime);
    return true;
  }

  /**
   * Validate payload against schema
   */
  private validatePayloadSchema(request: WebhookRequest): boolean {
    // If custom schema is configured, validate against it
    // For now, just check if body can be parsed as JSON
    if (request.content_type === 'application/json') {
      try {
        JSON.parse(request.body);
        return true;
      } catch {
        return false;
      }
    }
    return true;
  }

  /**
   * Extract identifiers from payload
   */
  private extractIdentifiers(payload: Record<string, unknown>): {
    correlation_id?: string;
    idempotency_key?: string;
    external_id?: string;
  } {
    return {
      correlation_id: this.extractField(payload, ['correlation_id', 'correlationId', 'id']),
      idempotency_key: this.extractField(payload, [
        'idempotency_key',
        'idempotencyKey',
        'requestId',
      ]),
      external_id: this.extractField(payload, ['external_id', 'externalId', 'sourceId']),
    };
  }

  /**
   * Extract field from payload using multiple possible keys
   */
  private extractField(payload: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      if (key in payload && typeof payload[key] === 'string') {
        return payload[key] as string;
      }
    }
    return undefined;
  }

  /**
   * Detect event type from path and payload
   */
  private detectEventType(path: string, payload: Record<string, unknown>): string | undefined {
    // Try to extract from payload
    const eventType = this.extractField(payload, ['event', 'event_type', 'type', 'action']);
    if (eventType) return eventType;

    // Try to infer from path
    const pathParts = path.split('/').filter(Boolean);
    return pathParts[pathParts.length - 1];
  }

  /**
   * Calculate payload completeness
   */
  private calculatePayloadCompleteness(payload: Record<string, unknown>): number {
    const keys = Object.keys(payload);
    if (keys.length === 0) return 0;

    const nonEmptyValues = keys.filter((key) => {
      const value = payload[key];
      return value !== null && value !== undefined && value !== '';
    });

    return nonEmptyValues.length / keys.length;
  }

  /**
   * Get authentication assurance level
   */
  private getAuthLevel(
    signature: SignatureVerificationResult,
  ): 'none' | 'low' | 'medium' | 'high' | 'verified' {
    if (!signature.valid) return 'none';

    switch (signature.method) {
      case 'hmac_sha256':
      case 'hmac_sha512':
        return 'high';
      case 'jwt_rs256':
        return 'verified';
      case 'jwt_hs256':
        return 'medium';
      case 'api_key':
        return 'low';
      default:
        return 'none';
    }
  }

  /**
   * Check if IP matches CIDR notation
   */
  private ipMatches(ip: string, cidr: string): boolean {
    // Simple equality check for now
    // TODO: Implement proper CIDR matching
    return ip === cidr || cidr.includes(ip);
  }

  /**
   * Cleanup old timestamps for replay protection
   */
  private cleanupOldTimestamps(): void {
    const config = this.webhookConfig.signature;
    if (!config) return;

    const currentTime = Math.floor(Date.now() / 1000);
    const expireTime = config.timestamp_tolerance_seconds;

    for (const [hash, timestamp] of this.requestTimestamps.entries()) {
      if (currentTime - timestamp > expireTime) {
        this.requestTimestamps.delete(hash);
      }
    }
  }
}

/**
 * Factory function to create Webhook Ingest Agent
 */
export function createWebhookIngestAgent(config: WebhookAgentConfig): WebhookIngestAgent {
  return new WebhookIngestAgent(config);
}
