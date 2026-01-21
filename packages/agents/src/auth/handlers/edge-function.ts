/**
 * Google Cloud Edge Function Handler for Auth/Identity Agent
 *
 * This handler is designed to be deployed as a Google Cloud Edge Function.
 * It provides an HTTP interface to the Auth/Identity Agent.
 *
 * Deployment: Google Cloud Edge Functions
 * Runtime: Node.js 20+
 * Stateless: Yes
 * Persistence: None (uses ruvector-service for data storage)
 */

import { AuthAgent, AuthAgentConfig, createAuthAgent } from '../auth-agent';
import {
  AuthAgentInput,
  AuthMethod,
  DecisionEvent,
  sanitizeForLogging,
} from '@llm-dev-ops/agentics-contracts';
import { AgentContext } from '../../base/agent';
import * as crypto from 'crypto';

/**
 * HTTP Request interface (compatible with Cloud Functions)
 */
export interface EdgeFunctionRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  query?: Record<string, string>;
  path?: string;
}

/**
 * HTTP Response interface (compatible with Cloud Functions)
 */
export interface EdgeFunctionResponse {
  status: (code: number) => EdgeFunctionResponse;
  json: (body: unknown) => void;
  set: (header: string, value: string) => EdgeFunctionResponse;
  send: (body: string) => void;
}

/**
 * Edge Function result
 */
export interface EdgeFunctionResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Error response structure
 */
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  request_id: string;
  timestamp: string;
}

/**
 * Success response structure
 */
interface SuccessResponse {
  authenticated: boolean;
  status: string;
  claims?: unknown;
  expires_at?: string;
  scopes?: string[];
  confidence: {
    score: number;
    level: string;
  };
  request_id: string;
  decision_event_id: string;
  timestamp: string;
}

/**
 * Auth Agent Edge Function Handler
 */
export class AuthAgentEdgeHandler {
  private readonly agent: AuthAgent;

  constructor(config: AuthAgentConfig = {}) {
    this.agent = createAuthAgent(config);
  }

  /**
   * Main handler for HTTP requests
   */
  async handle(req: EdgeFunctionRequest): Promise<EdgeFunctionResult> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();

    // CORS headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
      'X-Agent-ID': this.agent.agentId,
      'X-Agent-Version': this.agent.version,
    };

    // Handle OPTIONS for CORS
    if (req.method === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: {
          ...headers,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
        body: '',
      };
    }

    // Only accept POST
    if (req.method !== 'POST') {
      return this.errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only POST method is allowed', requestId, headers);
    }

    try {
      // Parse and validate input
      const input = await this.parseInput(req);

      // Build execution context
      const context = this.buildContext(req, requestId);

      // Log request (sanitized)
      this.logRequest(input, context);

      // Execute the agent
      const result = await this.agent.invoke(input, context);

      // Log completion
      const duration = Date.now() - startTime;
      this.logCompletion(result.event, duration);

      // Build success response
      const response: SuccessResponse = {
        authenticated: result.output.authenticated,
        status: result.output.status,
        claims: result.output.claims,
        expires_at: result.output.expires_at,
        scopes: result.output.scopes,
        confidence: {
          score: result.event.confidence.score,
          level: result.event.confidence.level,
        },
        request_id: requestId,
        decision_event_id: `${result.event.agent_id}:${result.event.timestamp}`,
        timestamp: result.event.timestamp,
      };

      // Determine status code based on result
      const statusCode = result.output.authenticated ? 200 : 401;

      return {
        statusCode,
        headers: {
          ...headers,
          'X-Auth-Status': result.output.status,
          'X-Confidence-Level': result.event.confidence.level,
        },
        body: JSON.stringify(response),
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logError(error, requestId, duration);

      if (error instanceof ValidationError) {
        return this.errorResponse(400, 'VALIDATION_ERROR', error.message, requestId, headers, error.details);
      }

      return this.errorResponse(500, 'INTERNAL_ERROR', 'Internal server error', requestId, headers);
    }
  }

  /**
   * Parse input from request
   */
  private async parseInput(req: EdgeFunctionRequest): Promise<AuthAgentInput> {
    const body = req.body as Record<string, unknown> | undefined;

    if (!body) {
      throw new ValidationError('Request body is required', { field: 'body' });
    }

    // Extract credential from body or Authorization header
    let credential = body['credential'] as string | undefined;
    let method = body['method'] as AuthMethod | undefined;

    // Try to extract from Authorization header if not in body
    if (!credential) {
      const authHeader = this.getHeader(req.headers, 'authorization');
      if (authHeader) {
        const [authType, authValue] = authHeader.split(' ', 2);
        if (authType && authValue) {
          credential = authValue;
          if (!method) {
            method = this.inferMethodFromHeader(authType);
          }
        }
      }
    }

    if (!credential) {
      throw new ValidationError('Credential is required', { field: 'credential' });
    }

    if (!method) {
      method = 'jwt'; // Default to JWT
    }

    // Build input object
    const input: AuthAgentInput = {
      credential,
      method,
      expected_issuer: body['expected_issuer'] as string | undefined,
      expected_audience: body['expected_audience'] as string | string[] | undefined,
      required_scopes: body['required_scopes'] as string[] | undefined,
      verification_key: body['verification_key'] as string | undefined,
      jwks_uri: body['jwks_uri'] as string | undefined,
      allow_expired: body['allow_expired'] as boolean | undefined ?? false,
      clock_skew_seconds: body['clock_skew_seconds'] as number | undefined ?? 60,
      request_context: {
        ip_address: this.getHeader(req.headers, 'x-forwarded-for')?.split(',')[0]?.trim(),
        user_agent: this.getHeader(req.headers, 'user-agent'),
        request_id: this.getHeader(req.headers, 'x-request-id'),
        resource: req.path,
      },
    };

    return input;
  }

  /**
   * Build execution context
   */
  private buildContext(req: EdgeFunctionRequest, requestId: string): AgentContext {
    return {
      traceId: this.getHeader(req.headers, 'x-trace-id') ?? requestId,
      spanId: this.generateSpanId(),
      parentSpanId: this.getHeader(req.headers, 'x-parent-span-id'),
      correlationId: this.getHeader(req.headers, 'x-correlation-id') ?? requestId,
      metadata: {
        source: 'edge-function',
        path: req.path,
        method: req.method,
      },
    };
  }

  /**
   * Infer authentication method from header type
   */
  private inferMethodFromHeader(authType: string): AuthMethod {
    const type = authType.toLowerCase();
    switch (type) {
      case 'bearer':
        return 'bearer';
      case 'basic':
        return 'basic';
      default:
        return 'jwt';
    }
  }

  /**
   * Get header value (case-insensitive)
   */
  private getHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
    if (!key) return undefined;
    const value = headers[key];
    return Array.isArray(value) ? value[0] : value;
  }

  /**
   * Generate request ID
   */
  private generateRequestId(): string {
    return `auth-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Generate span ID
   */
  private generateSpanId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Build error response
   */
  private errorResponse(
    statusCode: number,
    code: string,
    message: string,
    requestId: string,
    headers: Record<string, string>,
    details?: unknown
  ): EdgeFunctionResult {
    const response: ErrorResponse = {
      error: {
        code,
        message,
        details,
      },
      request_id: requestId,
      timestamp: new Date().toISOString(),
    };

    return {
      statusCode,
      headers,
      body: JSON.stringify(response),
    };
  }

  /**
   * Log request (sanitized)
   */
  private logRequest(input: AuthAgentInput, context: AgentContext): void {
    const sanitized = sanitizeForLogging(input as Record<string, unknown>);
    console.log('[AuthAgent] Request', JSON.stringify({
      trace_id: context.traceId,
      method: input.method,
      input: sanitized,
    }));
  }

  /**
   * Log completion
   */
  private logCompletion(event: DecisionEvent, duration: number): void {
    console.log('[AuthAgent] Completed', JSON.stringify({
      trace_id: event.execution_ref.trace_id,
      decision_type: event.decision_type,
      confidence_score: event.confidence.score,
      confidence_level: event.confidence.level,
      duration_ms: duration,
      has_error: !!event.error,
    }));
  }

  /**
   * Log error
   */
  private logError(error: unknown, requestId: string, duration: number): void {
    console.error('[AuthAgent] Error', JSON.stringify({
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      duration_ms: duration,
    }));
  }
}

/**
 * Validation error class
 */
class ValidationError extends Error {
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

/**
 * Create Edge Function handler
 */
export function createEdgeHandler(config?: AuthAgentConfig): AuthAgentEdgeHandler {
  return new AuthAgentEdgeHandler(config);
}

/**
 * Google Cloud Functions entry point
 *
 * Deploy with:
 * gcloud functions deploy auth-agent \
 *   --runtime nodejs20 \
 *   --trigger-http \
 *   --entry-point handleAuthRequest
 */
export async function handleAuthRequest(
  req: EdgeFunctionRequest,
  res: EdgeFunctionResponse
): Promise<void> {
  const handler = createEdgeHandler({
    telemetryEnabled: process.env['TELEMETRY_ENABLED'] === 'true',
    telemetryEndpoint: process.env['TELEMETRY_ENDPOINT'],
  });

  const result = await handler.handle(req);

  res.status(result.statusCode);
  for (const [key, value] of Object.entries(result.headers)) {
    res.set(key, value);
  }
  res.send(result.body);
}
