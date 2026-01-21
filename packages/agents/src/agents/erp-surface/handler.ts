/**
 * ERP Surface Agent - Google Cloud Edge Function Handler
 *
 * Deploys the ERP Surface Agent as a Google Cloud Edge Function.
 *
 * Constitutional Requirements:
 * - Stateless execution
 * - NO direct SQL access - all persistence via ruvector-service
 * - MUST emit exactly ONE DecisionEvent per invocation
 * - Read-only ERP interface - NO write operations
 * - Deterministic behavior
 *
 * CLI Invokable Endpoint: POST /erp-surface
 *
 * @see https://cloud.google.com/functions/docs/writing
 */

import { z } from 'zod';
import type { Request, Response } from 'express';
import { RuVectorClient, createRuVectorClientFromEnv } from '../../runtime/ruvector-client.js';
import {
  TelemetryEmitter,
  createTelemetryEmitterFromEnv,
  type Span,
  type SpanContext,
} from '../../runtime/telemetry.js';
import {
  ERPSurfaceAgent,
  createERPSurfaceAgent,
  ERPEventInputSchema,
  type ERPSurfaceAgentConfig,
} from './index.js';
import {
  getCurrentTimestamp,
} from '../../contracts/index.js';

// Use generic type to avoid conflicts between multiple DecisionEvent definitions
type AgentDecisionEvent = Record<string, unknown> & {
  outputs: Record<string, unknown>;
  constraints_applied: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

// ============================================================================
// Request/Response Schemas (ERP-specific, minimal duplication)
// ============================================================================

/**
 * HTTP Request body schema for ERP Surface Agent
 */
export const ERPSurfaceRequestSchema = z.object({
  event: ERPEventInputSchema,
  auth_context: z.object({
    tenant_id: z.string().min(1),
    user_id: z.string().optional(),
  }),
  metadata: z
    .object({
      correlation_id: z.string().optional(),
      idempotency_key: z.string().optional(),
    })
    .optional(),
});

export type ERPSurfaceRequest = z.infer<typeof ERPSurfaceRequestSchema>;

// ============================================================================
// Edge Function Handler (Minimal, delegates to agent)
// ============================================================================

const AGENT_ID = 'erp-surface-agent';
const AGENT_VERSION = '1.0.0';

/**
 * ERP Surface Agent Edge Function Handler
 * Thin wrapper - delegates processing to the agent
 */
export class ERPSurfaceHandler {
  private readonly agent: ERPSurfaceAgent;
  private readonly ruVectorClient: RuVectorClient;
  private readonly telemetry: TelemetryEmitter;

  constructor(
    config: ERPSurfaceAgentConfig,
    ruVectorClient?: RuVectorClient,
    telemetry?: TelemetryEmitter
  ) {
    this.agent = createERPSurfaceAgent(config);
    this.ruVectorClient = ruVectorClient || createRuVectorClientFromEnv();
    this.telemetry = telemetry || createTelemetryEmitterFromEnv(AGENT_ID);
  }

  async handle(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    const spanContext = this.telemetry.extractContext(req.headers as Record<string, string>);
    const span = this.telemetry.startSpan('erp-surface.handle', spanContext, {
      'http.method': req.method,
      'agent.id': AGENT_ID,
    });

    try {
      if (req.method !== 'POST') {
        return this.sendError(res, span, startTime, 'METHOD_NOT_ALLOWED', 405);
      }

      const parseResult = ERPSurfaceRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return this.sendError(res, span, startTime, 'VALIDATION_ERROR', 400, parseResult.error.flatten());
      }

      const request = parseResult.data;

      // Idempotency check
      if (request.metadata?.idempotency_key) {
        const existing = await this.checkIdempotency(request.metadata.idempotency_key);
        if (existing) {
          await this.telemetry.endSpan(span, { code: 'OK' });
          return res.status(200).json({ success: true, decision_event: existing }) as unknown as void;
        }
      }

      // Process through agent
      const agentResponse = await this.agent.process(request.event);

      if (agentResponse.status !== 'success' || !agentResponse.decision_event) {
        return this.sendError(
          res, span, startTime,
          agentResponse.error?.code || 'PROCESSING_ERROR',
          agentResponse.error?.retryable ? 500 : 400
        );
      }

      // Enrich and persist
      const event = this.enrichEvent(agentResponse.decision_event as AgentDecisionEvent, request, span.context);
      await this.persist(event, request.metadata?.idempotency_key);

      await this.telemetry.endSpan(span, { code: 'OK' });
      res.status(200).json({
        success: true,
        decision_event: event,
        data: event.outputs,
        telemetry: { duration_ms: Date.now() - startTime, trace_id: span.context.traceId },
      });
    } catch (error) {
      this.telemetry.recordError(span, error as Error);
      await this.telemetry.endSpan(span, { code: 'ERROR', message: (error as Error).message });
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error', retryable: true } });
    }
  }

  async healthCheck(_req: Request, res: Response): Promise<void> {
    const healthy = await this.agent.healthCheck();
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'unhealthy',
      agent_id: AGENT_ID,
      agent_version: AGENT_VERSION,
      timestamp: getCurrentTimestamp(),
    });
  }

  private enrichEvent(event: AgentDecisionEvent, request: ERPSurfaceRequest, spanContext: SpanContext): AgentDecisionEvent {
    return {
      ...event,
      constraints_applied: {
        ...event.constraints_applied,
        identity_context: `tenant:${request.auth_context.tenant_id}`,
      },
      metadata: {
        ...event.metadata,
        trace_id: spanContext.traceId,
        correlation_id: request.metadata?.correlation_id,
      },
    };
  }

  private async persist(event: AgentDecisionEvent, idempotencyKey?: string): Promise<void> {
    const result = await this.ruVectorClient.persist('erp_surface_events', {
      ...event,
      idempotency_key: idempotencyKey,
      persisted_at: getCurrentTimestamp(),
    });
    if (!result.success) {
      console.error('[ERP-Surface] Persistence failed:', result.error);
    }
  }

  private async checkIdempotency(key: string): Promise<AgentDecisionEvent | null> {
    const result = await this.ruVectorClient.query<AgentDecisionEvent>('erp_surface_events', { idempotency_key: key });
    if (result.success && result.data && result.data.length > 0) {
      return result.data[0] ?? null;
    }
    return null;
  }

  private async sendError(res: Response, span: Span, startTime: number, code: string, status: number, details?: unknown): Promise<void> {
    await this.telemetry.endSpan(span, { code: 'ERROR', message: code });
    res.status(status).json({
      success: false,
      error: { code, message: code, retryable: status >= 500, details },
      telemetry: { duration_ms: Date.now() - startTime, trace_id: span.context.traceId },
    });
  }
}

// ============================================================================
// Google Cloud Functions Entry Points
// ============================================================================

let handler: ERPSurfaceHandler | null = null;

function getHandler(): ERPSurfaceHandler {
  if (!handler) {
    const env = process.env;
    handler = new ERPSurfaceHandler({
      connector_scope: env['ERP_CONNECTOR_SCOPE'] || 'erp-connector',
      allowed_erp_systems: env['ERP_ALLOWED_SYSTEMS']?.split(',') as any,
      required_fields: ['event_type', 'event_timestamp', 'payload', 'erp_system'],
      debug: env['DEBUG'] === 'true',
      timeout_ms: parseInt(env['AGENT_TIMEOUT_MS'] || '30000', 10),
      max_payload_bytes: parseInt(env['MAX_PAYLOAD_BYTES'] || '10485760', 10),
      telemetry_enabled: env['TELEMETRY_ENABLED'] !== 'false',
    });
  }
  return handler;
}

/** Google Cloud Functions HTTP entry point */
export async function erpSurfaceHandler(req: Request, res: Response): Promise<void> {
  await getHandler().handle(req, res);
}

/** Health check entry point */
export async function erpSurfaceHealthCheck(req: Request, res: Response): Promise<void> {
  await getHandler().healthCheck(req, res);
}

export { ERPSurfaceHandler as Handler };
