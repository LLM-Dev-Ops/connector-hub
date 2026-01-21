/**
 * Google Cloud Function Handler
 *
 * Exposes the Event Normalization Agent as a Google Cloud Edge Function.
 *
 * Endpoints:
 * - POST /normalize - Normalize an external event
 * - POST /inspect - Inspect normalization without persistence
 * - GET /health - Health check
 *
 * DEPLOYMENT MODEL:
 * - Google Cloud Edge Function
 * - Part of unified Connector-Hub service
 * - Stateless execution
 * - NO direct SQL access
 */

import type { HttpFunction, Request, Response } from '@google-cloud/functions-framework';
import { EventNormalizationAgent, createEventNormalizationAgent } from './agent.js';
import { createRuVectorClientFromEnv, RuVectorClient } from '../runtime/ruvector-client.js';
import { createTelemetryEmitterFromEnv, TelemetryEmitter } from '../runtime/telemetry.js';
import { ExternalEventInputSchema, NormalizationConfigSchema } from './types.js';
import { AgentContext } from '../runtime/edge-function-base.js';
import { z } from 'zod';

/**
 * Lazy-initialized dependencies
 */
let agent: EventNormalizationAgent | undefined;
let ruVectorClient: RuVectorClient | undefined;
let telemetry: TelemetryEmitter | undefined;

/**
 * Initialize agent with dependencies
 */
function getAgent(): EventNormalizationAgent {
  if (!agent) {
    ruVectorClient = createRuVectorClientFromEnv();
    telemetry = createTelemetryEmitterFromEnv('event-normalization-agent');
    agent = createEventNormalizationAgent(ruVectorClient, telemetry);
  }
  return agent;
}

/**
 * Extract request context
 */
function extractContext(req: Request): AgentContext {
  const headers = Object.fromEntries(
    Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] ?? '' : v ?? ''])
  );

  return {
    requestId:
      headers['x-request-id'] ??
      headers['x-correlation-id'] ??
      crypto.randomUUID(),
    headers,
    environment: process.env['ENVIRONMENT'] ?? 'production',
  };
}

/**
 * Normalize endpoint request schema
 */
const NormalizeRequestSchema = z.object({
  event: ExternalEventInputSchema,
  config: NormalizationConfigSchema.optional(),
});

/**
 * Inspect endpoint request schema (same as normalize, but no persistence)
 */
const InspectRequestSchema = NormalizeRequestSchema;

/**
 * HTTP Function for Google Cloud Functions
 */
export const eventNormalizationHandler: HttpFunction = async (
  req: Request,
  res: Response
): Promise<void> => {
  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  const path = req.path || '/';

  try {
    switch (path) {
      case '/normalize':
        await handleNormalize(req, res);
        break;

      case '/inspect':
        await handleInspect(req, res);
        break;

      case '/health':
        handleHealth(res);
        break;

      default:
        res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: `Unknown endpoint: ${path}`,
          },
        });
    }
  } catch (error) {
    console.error('[EventNormalizationHandler] Unhandled error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        details: process.env['NODE_ENV'] === 'development'
          ? { message: error instanceof Error ? error.message : String(error) }
          : undefined,
      },
    });
  }
};

/**
 * Handle /normalize endpoint
 */
async function handleNormalize(req: Request, res: Response): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only POST method is allowed for /normalize',
      },
    });
    return;
  }

  // Validate request body
  const parseResult = NormalizeRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        details: parseResult.error.errors,
      },
    });
    return;
  }

  const context = extractContext(req);
  const normalizeAgent = getAgent();

  // Execute normalization
  const result = await normalizeAgent.execute(parseResult.data, context);

  if (result.success) {
    res.status(200).json({
      status: 'success',
      data: result.data,
      decision_event: result.decisionEvent,
    });
  } else {
    res.status(422).json({
      status: 'error',
      error: result.error,
      decision_event: result.decisionEvent,
    });
  }
}

/**
 * Handle /inspect endpoint (normalization without persistence)
 */
async function handleInspect(req: Request, res: Response): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only POST method is allowed for /inspect',
      },
    });
    return;
  }

  // Validate request body
  const parseResult = InspectRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        details: parseResult.error.errors,
      },
    });
    return;
  }

  try {
    const { createNormalizer } = await import('./normalizers/index.js');
    const normalizer = createNormalizer(parseResult.data.event.format);

    const config = {
      strict_validation: false,
      max_payload_bytes: 10 * 1024 * 1024,
      include_dropped_fields: true,
      include_field_mappings: true,
      ...parseResult.data.config,
    };

    const normalizedEvent = await normalizer.normalize(parseResult.data.event, config);

    res.status(200).json({
      status: 'success',
      data: {
        normalized_event: normalizedEvent,
        field_mappings: normalizer.getFieldMappings(),
        detected_type: normalizer.detectEventType(parseResult.data.event.raw_payload),
      },
    });
  } catch (error) {
    res.status(422).json({
      status: 'error',
      error: {
        code: 'INSPECTION_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
}

/**
 * Handle /health endpoint
 */
function handleHealth(res: Response): void {
  res.status(200).json({
    status: 'healthy',
    agent: {
      id: 'event-normalization-agent',
      version: '1.0.0',
    },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Export for Cloud Functions deployment
 */
export { eventNormalizationHandler as handler };

/**
 * Default export for Cloud Functions
 */
export default eventNormalizationHandler;
