/**
 * Google Cloud Edge Function Handler
 *
 * Provides the runtime entry point for deploying agents as Google Cloud Edge Functions.
 * Implements stateless, deterministic execution with proper error handling.
 *
 * DEPLOYMENT REQUIREMENTS:
 * - Stateless execution (no local persistence)
 * - Deterministic behavior
 * - Non-blocking async writes via ruvector-service
 * - Proper error handling and response codes
 */

import type { Request as GCFRequest, Response as GCFResponse } from '@google-cloud/functions-framework';
import type { WebhookRequest, AgentResponse, WebhookAgentConfig } from '../contracts/index.js';
import { WebhookListenerAgent } from '../webhook/index.js';
import { RuVectorClient } from '../services/ruvector-client.js';
import { TelemetryService } from '../services/telemetry.js';

/**
 * Edge function configuration
 */
export interface EdgeFunctionConfig {
  /** Agent configuration */
  agentConfig: WebhookAgentConfig;

  /** CORS configuration */
  cors?: {
    allowedOrigins: string[];
    allowedMethods: string[];
    allowedHeaders: string[];
    maxAge: number;
  };

  /** Health check path */
  healthCheckPath?: string;

  /** Metrics path */
  metricsPath?: string;
}

/**
 * Default CORS configuration
 */
const DEFAULT_CORS = {
  allowedOrigins: ['*'],
  allowedMethods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Webhook-Signature', 'X-API-Key'],
  maxAge: 86400,
};

/**
 * Agent instance cache (for warm starts)
 */
let cachedAgent: WebhookListenerAgent | null = null;
let cachedConfig: string | null = null;

/**
 * Create the Edge Function handler
 *
 * This is the main entry point for Google Cloud Functions.
 */
export function createEdgeFunctionHandler(
  config: EdgeFunctionConfig
): (req: GCFRequest, res: GCFResponse) => Promise<void> {
  const corsConfig = { ...DEFAULT_CORS, ...config.cors };
  const healthCheckPath = config.healthCheckPath || '/health';
  const metricsPath = config.metricsPath || '/metrics';

  return async (req: GCFRequest, res: GCFResponse): Promise<void> => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      handleCors(res, corsConfig);
      res.status(204).send('');
      return;
    }

    // Apply CORS headers
    handleCors(res, corsConfig);

    // Handle health check
    if (req.path === healthCheckPath && req.method === 'GET') {
      await handleHealthCheck(config, res);
      return;
    }

    // Handle metrics
    if (req.path === metricsPath && req.method === 'GET') {
      await handleMetrics(res);
      return;
    }

    // Only accept POST requests for webhook processing
    if (req.method !== 'POST') {
      res.status(405).json({
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: `Method ${req.method} not allowed. Use POST.`,
        },
      });
      return;
    }

    // Process the webhook
    try {
      const agent = await getOrCreateAgent(config);
      const webhookRequest = createWebhookRequest(req);
      const response = await agent.process(webhookRequest);

      sendAgentResponse(res, response);
    } catch (error) {
      console.error('Edge function error:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Internal server error',
          retryable: true,
        },
      });
    }
  };
}

/**
 * Get or create the agent instance (supports warm starts)
 */
async function getOrCreateAgent(config: EdgeFunctionConfig): Promise<WebhookListenerAgent> {
  const configHash = JSON.stringify(config.agentConfig);

  // Reuse cached agent if config hasn't changed
  if (cachedAgent && cachedConfig === configHash) {
    return cachedAgent;
  }

  // Create new agent
  const ruvectorClient = new RuVectorClient();
  const telemetry = new TelemetryService({
    serviceName: 'webhook-edge-function',
    serviceVersion: '1.0.0',
  });

  const agent = new WebhookListenerAgent(config.agentConfig, {
    ruvectorClient,
    telemetry,
  });

  await agent.initialize();

  // Cache for warm starts
  cachedAgent = agent;
  cachedConfig = configHash;

  return agent;
}

/**
 * Create a WebhookRequest from the GCF request
 */
function createWebhookRequest(req: GCFRequest): WebhookRequest {
  // Get raw body
  let rawBody: string;
  if (typeof req.body === 'string') {
    rawBody = req.body;
  } else if (Buffer.isBuffer(req.body)) {
    rawBody = req.body.toString('utf8');
  } else if (typeof req.body === 'object') {
    rawBody = JSON.stringify(req.body);
  } else {
    rawBody = '';
  }

  // Extract headers (lowercase keys)
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') {
      headers[key.toLowerCase()] = value;
    } else if (Array.isArray(value)) {
      headers[key.toLowerCase()] = value.join(', ');
    }
  }

  // Extract query parameters
  const queryParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.query || {})) {
    if (typeof value === 'string') {
      queryParams[key] = value;
    }
  }

  // Get source IP
  const sourceIp =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.ip ||
    req.socket?.remoteAddress;

  return {
    method: req.method as 'POST' | 'PUT' | 'PATCH',
    path: req.path,
    headers,
    body: rawBody,
    parsed_body: typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : undefined,
    query_params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
    source_ip: sourceIp,
    received_at: new Date().toISOString(),
    content_type: headers['content-type'] || 'application/json',
  };
}

/**
 * Send the agent response
 */
function sendAgentResponse(res: GCFResponse, response: AgentResponse): void {
  // Map status to HTTP status code
  let statusCode: number;
  switch (response.status) {
    case 'success':
      statusCode = 200;
      break;
    case 'validation_failed':
      statusCode = 400;
      break;
    case 'auth_failed':
      statusCode = 401;
      break;
    case 'rate_limited':
      statusCode = 429;
      break;
    case 'timeout':
      statusCode = 408;
      break;
    case 'error':
    default:
      statusCode = 500;
  }

  // Include execution_ref in response header for tracing
  if (response.decision_event?.execution_ref) {
    res.setHeader('X-Execution-Ref', response.decision_event.execution_ref);
  }

  res.status(statusCode).json(response);
}

/**
 * Handle CORS headers
 */
function handleCors(
  res: GCFResponse,
  config: NonNullable<EdgeFunctionConfig['cors']>
): void {
  res.setHeader('Access-Control-Allow-Origin', config.allowedOrigins.join(', '));
  res.setHeader('Access-Control-Allow-Methods', config.allowedMethods.join(', '));
  res.setHeader('Access-Control-Allow-Headers', config.allowedHeaders.join(', '));
  res.setHeader('Access-Control-Max-Age', config.maxAge.toString());
}

/**
 * Handle health check request
 */
async function handleHealthCheck(
  config: EdgeFunctionConfig,
  res: GCFResponse
): Promise<void> {
  try {
    const agent = await getOrCreateAgent(config);
    const healthy = await agent.healthCheck();

    if (healthy) {
      res.status(200).json({
        status: 'healthy',
        agent_id: agent.agentId,
        version: agent.version,
      });
    } else {
      res.status(503).json({
        status: 'unhealthy',
        agent_id: agent.agentId,
        version: agent.version,
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Health check failed',
    });
  }
}

/**
 * Handle metrics request
 */
async function handleMetrics(res: GCFResponse): Promise<void> {
  if (!cachedAgent) {
    res.status(200).json({ message: 'No metrics available (agent not initialized)' });
    return;
  }

  const metrics = cachedAgent.getMetrics();
  res.status(200).json(metrics);
}

/**
 * Express/Connect-style middleware adapter
 */
export function createExpressMiddleware(
  config: EdgeFunctionConfig
): (req: unknown, res: unknown, next?: () => void) => Promise<void> {
  const handler = createEdgeFunctionHandler(config);

  return async (req: unknown, res: unknown, next?: () => void): Promise<void> => {
    try {
      await handler(req as GCFRequest, res as GCFResponse);
    } catch (error) {
      if (next) {
        next();
      } else {
        throw error;
      }
    }
  };
}

/**
 * Cloud Functions entry point type definition
 */
export type CloudFunctionHandler = (req: GCFRequest, res: GCFResponse) => Promise<void>;

/**
 * Create a configured handler from environment variables
 */
export function createHandlerFromEnv(): CloudFunctionHandler {
  const env = process.env;
  const config: EdgeFunctionConfig = {
    agentConfig: {
      connector_id: env['CONNECTOR_ID'] || 'default',
      connector_scope: env['CONNECTOR_SCOPE'] || 'webhook',
      timeout_ms: parseInt(env['TIMEOUT_MS'] || '30000', 10),
      max_payload_bytes: parseInt(env['MAX_PAYLOAD_BYTES'] || '10485760', 10),
      telemetry_enabled: env['TELEMETRY_ENABLED'] !== 'false',
      debug: env['DEBUG'] === 'true',
      signature: env['SIGNATURE_METHOD']
        ? {
            method: env['SIGNATURE_METHOD'] as 'hmac_sha256' | 'api_key' | 'none',
            header_name: env['SIGNATURE_HEADER'] || 'X-Webhook-Signature',
            secret_key: env['SIGNATURE_SECRET'],
            timestamp_tolerance_seconds: parseInt(
              env['TIMESTAMP_TOLERANCE'] || '300',
              10
            ),
            timestamp_header: env['TIMESTAMP_HEADER'] || 'X-Webhook-Timestamp',
            api_key_header: env['API_KEY_HEADER'] || 'X-API-Key',
          }
        : undefined,
      allowed_content_types: (
        env['ALLOWED_CONTENT_TYPES'] || 'application/json'
      ).split(','),
      replay_protection: env['REPLAY_PROTECTION'] !== 'false',
      rate_limit_enabled: env['RATE_LIMIT_ENABLED'] !== 'false',
      rate_limit_rpm: parseInt(env['RATE_LIMIT_RPM'] || '100', 10),
    },
    cors: {
      allowedOrigins: (env['CORS_ORIGINS'] || '*').split(','),
      allowedMethods: ['POST', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Webhook-Signature',
        'X-API-Key',
      ],
      maxAge: 86400,
    },
  };

  return createEdgeFunctionHandler(config);
}

/**
 * Default export for Google Cloud Functions
 */
export const webhookHandler = createHandlerFromEnv();
