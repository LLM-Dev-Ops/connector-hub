/**
 * Core Infrastructure HTTP Handler - Phase 6 (Layer 1)
 *
 * Cloud Run entry point for core infrastructure agents:
 * - ConfigValidationAgent (/validate/config)
 * - SchemaEnforcementAgent (/validate/schema)
 * - IntegrationHealthAgent (/health/integrations)
 *
 * DEPLOYMENT:
 * - Google Cloud Run (managed)
 * - Secrets via Google Secret Manager
 * - Ruvector for persistence
 *
 * @packageDocumentation
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { getConfigValidationAgent } from '../config-validation/index.js';
import { getSchemaEnforcementAgent } from '../schema-enforcement/index.js';
import { getIntegrationHealthAgent } from '../integration-health/index.js';
import { PERFORMANCE_BUDGETS } from '@llm-dev-ops/connector-hub-contracts';

// ============================================================================
// Configuration
// ============================================================================

const PORT = parseInt(process.env.PORT || '8080', 10);
const SERVICE_NAME = process.env.SERVICE_NAME || 'core-infrastructure';
const SERVICE_VERSION = process.env.SERVICE_VERSION || '1.0.0';

// ============================================================================
// Request/Response Types
// ============================================================================

interface APIRequest {
  body: unknown;
  traceId: string;
  correlationId?: string;
}

interface APIResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

// ============================================================================
// Request Parsing
// ============================================================================

async function parseRequest(req: IncomingMessage): Promise<APIRequest> {
  const traceId = req.headers['x-trace-id'] as string || randomUUID();
  const correlationId = req.headers['x-correlation-id'] as string || undefined;

  // Parse body
  const body = await new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });

  return { body, traceId, correlationId };
}

// ============================================================================
// Response Helpers
// ============================================================================

function sendResponse(res: ServerResponse, response: APIResponse): void {
  res.writeHead(response.status, {
    'Content-Type': 'application/json',
    'X-Service-Name': SERVICE_NAME,
    'X-Service-Version': SERVICE_VERSION,
    ...response.headers,
  });
  res.end(JSON.stringify(response.body));
}

function errorResponse(message: string, code: string, status: number): APIResponse {
  return {
    status,
    body: {
      error: {
        code,
        message,
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
      },
    },
  };
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * POST /validate/config - Configuration validation
 */
async function handleConfigValidation(request: APIRequest): Promise<APIResponse> {
  const agent = getConfigValidationAgent();

  try {
    const result = await agent.process(request.body, {
      traceId: request.traceId,
      correlationId: request.correlationId,
    });

    return {
      status: 200,
      body: {
        decision_event: result.event,
        output: result.output,
        metadata: {
          agent_id: agent.agentId,
          version: agent.version,
          duration_ms: result.durationMs,
          performance_budget: {
            max_latency_ms: PERFORMANCE_BUDGETS.MAX_LATENCY_MS,
            max_tokens: PERFORMANCE_BUDGETS.MAX_TOKENS,
          },
        },
      },
      headers: {
        'X-Trace-Id': request.traceId,
        'X-Agent-Id': agent.agentId,
        'X-Duration-Ms': String(result.durationMs),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(message, 'CONFIG_VALIDATION_ERROR', 400);
  }
}

/**
 * POST /validate/schema - Schema enforcement
 */
async function handleSchemaEnforcement(request: APIRequest): Promise<APIResponse> {
  const agent = getSchemaEnforcementAgent();

  try {
    const result = await agent.process(request.body, {
      traceId: request.traceId,
      correlationId: request.correlationId,
    });

    return {
      status: 200,
      body: {
        decision_event: result.event,
        output: result.output,
        metadata: {
          agent_id: agent.agentId,
          version: agent.version,
          duration_ms: result.durationMs,
          performance_budget: {
            max_latency_ms: PERFORMANCE_BUDGETS.MAX_LATENCY_MS,
            max_tokens: PERFORMANCE_BUDGETS.MAX_TOKENS,
          },
        },
      },
      headers: {
        'X-Trace-Id': request.traceId,
        'X-Agent-Id': agent.agentId,
        'X-Duration-Ms': String(result.durationMs),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(message, 'SCHEMA_ENFORCEMENT_ERROR', 400);
  }
}

/**
 * GET/POST /health/integrations - Integration health check
 */
async function handleIntegrationHealth(request: APIRequest): Promise<APIResponse> {
  const agent = getIntegrationHealthAgent();

  try {
    const result = await agent.process(request.body, {
      traceId: request.traceId,
      correlationId: request.correlationId,
    });

    return {
      status: 200,
      body: {
        decision_event: result.event,
        output: result.output,
        metadata: {
          agent_id: agent.agentId,
          version: agent.version,
          duration_ms: result.durationMs,
          performance_budget: {
            max_latency_ms: PERFORMANCE_BUDGETS.MAX_LATENCY_MS,
            max_tokens: PERFORMANCE_BUDGETS.MAX_TOKENS,
          },
        },
      },
      headers: {
        'X-Trace-Id': request.traceId,
        'X-Agent-Id': agent.agentId,
        'X-Duration-Ms': String(result.durationMs),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(message, 'INTEGRATION_HEALTH_ERROR', 500);
  }
}

/**
 * GET /health - Service health check
 */
async function handleHealth(): Promise<APIResponse> {
  const configAgent = getConfigValidationAgent();
  const schemaAgent = getSchemaEnforcementAgent();
  const healthAgent = getIntegrationHealthAgent();

  const checks = await Promise.all([
    configAgent.healthCheck().catch(() => false),
    schemaAgent.healthCheck().catch(() => false),
    healthAgent.healthCheck().catch(() => false),
  ]);

  const allHealthy = checks.every(c => c);

  return {
    status: allHealthy ? 200 : 503,
    body: {
      status: allHealthy ? 'ok' : 'degraded',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      timestamp: new Date().toISOString(),
      agents: {
        config_validation: checks[0] ? 'healthy' : 'unhealthy',
        schema_enforcement: checks[1] ? 'healthy' : 'unhealthy',
        integration_health: checks[2] ? 'healthy' : 'unhealthy',
      },
    },
  };
}

/**
 * GET /ready - Readiness check
 */
async function handleReady(): Promise<APIResponse> {
  // Check Ruvector connectivity
  const healthAgent = getIntegrationHealthAgent();
  const ready = await healthAgent.healthCheck().catch(() => false);

  return {
    status: ready ? 200 : 503,
    body: {
      ready,
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * GET /schemas - List available schemas
 */
async function handleListSchemas(): Promise<APIResponse> {
  const schemaAgent = getSchemaEnforcementAgent();
  const schemas = schemaAgent.listSchemas();

  return {
    status: 200,
    body: {
      schemas,
      count: schemas.length,
    },
  };
}

/**
 * GET /integrations - List registered integrations
 */
async function handleListIntegrations(): Promise<APIResponse> {
  const healthAgent = getIntegrationHealthAgent();
  const integrations = healthAgent.listIntegrations();

  return {
    status: 200,
    body: {
      integrations,
      count: integrations.length,
    },
  };
}

// ============================================================================
// Router
// ============================================================================

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const method = req.method || 'GET';
  const path = url.pathname;

  console.log(`[${new Date().toISOString()}] ${method} ${path}`);

  try {
    let response: APIResponse;

    // Route handling
    if (path === '/health' && method === 'GET') {
      response = await handleHealth();
    } else if (path === '/ready' && method === 'GET') {
      response = await handleReady();
    } else if (path === '/validate/config' && method === 'POST') {
      const request = await parseRequest(req);
      response = await handleConfigValidation(request);
    } else if (path === '/validate/schema' && method === 'POST') {
      const request = await parseRequest(req);
      response = await handleSchemaEnforcement(request);
    } else if (path === '/health/integrations' && (method === 'GET' || method === 'POST')) {
      const request = await parseRequest(req);
      response = await handleIntegrationHealth(request);
    } else if (path === '/schemas' && method === 'GET') {
      response = await handleListSchemas();
    } else if (path === '/integrations' && method === 'GET') {
      response = await handleListIntegrations();
    } else {
      response = errorResponse(`Route not found: ${method} ${path}`, 'NOT_FOUND', 404);
    }

    sendResponse(res, response);
  } catch (err) {
    console.error('Request handler error:', err);
    sendResponse(res, errorResponse('Internal server error', 'INTERNAL_ERROR', 500));
  }
}

// ============================================================================
// Server Startup
// ============================================================================

export function startServer(): void {
  const server = createServer(handleRequest);

  server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  Core Infrastructure Service - Phase 6 (Layer 1)              ║
╠═══════════════════════════════════════════════════════════════╣
║  Service:    ${SERVICE_NAME.padEnd(45)} ║
║  Version:    ${SERVICE_VERSION.padEnd(45)} ║
║  Port:       ${String(PORT).padEnd(45)} ║
╠═══════════════════════════════════════════════════════════════╣
║  Endpoints:                                                   ║
║    POST /validate/config       - Configuration validation     ║
║    POST /validate/schema       - Schema enforcement           ║
║    GET  /health/integrations   - Integration health           ║
║    GET  /health                - Service health               ║
║    GET  /ready                 - Readiness check              ║
║    GET  /schemas               - List available schemas       ║
║    GET  /integrations          - List integrations            ║
╠═══════════════════════════════════════════════════════════════╣
║  Performance Budgets:                                         ║
║    MAX_TOKENS:     ${String(PERFORMANCE_BUDGETS.MAX_TOKENS).padEnd(37)} ║
║    MAX_LATENCY_MS: ${String(PERFORMANCE_BUDGETS.MAX_LATENCY_MS).padEnd(37)} ║
╚═══════════════════════════════════════════════════════════════╝
`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down gracefully...');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Run if executed directly
if (process.argv[1]?.endsWith('handler.ts') || process.argv[1]?.endsWith('handler.js')) {
  startServer();
}
