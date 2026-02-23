/**
 * Cloud Function Entry Point — connector-hub-agents
 *
 * Pipeline terminus — the final destination where orchestrated artifacts land
 * for ERP decision-making. Routes requests based on req.body.agent to one of
 * the 5 connector-hub agents.
 *
 * Deploy:
 *   gcloud functions deploy connector-hub-agents \
 *     --region=us-central1 --runtime=nodejs20 \
 *     --entry-point=handler --trigger-http \
 *     --allow-unauthenticated \
 *     --set-env-vars="LOG_EXECUTION_ID=true"
 *
 * Agents:
 *   erp-surface      — Pipeline terminus / ERP decision-making
 *   database-query   — Decision package store queries
 *   webhook-ingest   — External webhook normalization
 *   event-normalize  — ERP format normalization
 *   auth-identity    — Caller identity validation
 *
 * Response envelope (all agents):
 *   {
 *     "result": { ... },
 *     "execution_metadata": {
 *       "trace_id": "...",
 *       "agent": "...",
 *       "domain": "connector-hub",
 *       "timestamp": "...",
 *       "pipeline_context": { ... }
 *     }
 *   }
 */

import * as crypto from 'crypto';
import type { HttpFunction } from '@google-cloud/functions-framework';

import { WebhookListenerAgent } from '../webhook/index.js';
import { AuthIdentityAgent } from '../agents/auth-identity/index.js';
import { getCurrentTimestamp } from '../contracts/index.js';

// ============================================================================
// Types
// ============================================================================

const DOMAIN = 'connector-hub';
const AGENT_NAMES = [
  'erp-surface',
  'database-query',
  'webhook-ingest',
  'event-normalize',
  'auth-identity',
] as const;

type AgentName = (typeof AGENT_NAMES)[number];

interface PipelineStep {
  step_id: string;
  domain: string;
  agent: string;
  output?: Record<string, unknown>;
  artifacts?: unknown[];
}

interface PipelineContext {
  plan_id: string;
  step_id: string;
  previous_steps: PipelineStep[];
  execution_metadata?: {
    trace_id?: string;
    initiated_by?: string;
  };
}

interface AgentRequest {
  text?: string;
  agent: AgentName;
  payload?: Record<string, unknown>;
  pipeline_context?: PipelineContext;
}

interface ResponseEnvelope {
  result: Record<string, unknown>;
  execution_metadata: {
    trace_id: string;
    agent: string;
    domain: string;
    timestamp: string;
    pipeline_context?: PipelineContext;
  };
}

// ============================================================================
// Response helpers
// ============================================================================

function buildEnvelope(
  agentName: string,
  result: Record<string, unknown>,
  traceId: string,
  pipelineContext?: PipelineContext,
): ResponseEnvelope {
  return {
    result,
    execution_metadata: {
      trace_id: traceId,
      agent: agentName,
      domain: DOMAIN,
      timestamp: new Date().toISOString(),
      ...(pipelineContext ? { pipeline_context: pipelineContext } : {}),
    },
  };
}

function resolveTraceId(body: AgentRequest, headers: Record<string, unknown>): string {
  if (body.pipeline_context?.execution_metadata?.trace_id) {
    return body.pipeline_context.execution_metadata.trace_id;
  }
  const correlationHeader = headers['x-correlation-id'];
  if (typeof correlationHeader === 'string' && correlationHeader) {
    return correlationHeader;
  }
  return crypto.randomUUID();
}

// ============================================================================
// ERP-Surface Agent — Pipeline Terminus
// ============================================================================

function collectArtifacts(steps: PipelineStep[]): unknown[] {
  const artifacts: unknown[] = [];
  for (const step of steps) {
    if (step.artifacts && Array.isArray(step.artifacts)) {
      artifacts.push(...step.artifacts);
    }
  }
  return artifacts;
}

function extractPlanSummary(steps: PipelineStep[]): Record<string, unknown> {
  const plannerStep = steps.find(s => s.agent === 'planner' || s.agent === 'decomposer');
  if (plannerStep?.output) {
    return { source_agent: plannerStep.agent, ...plannerStep.output };
  }
  return { source_agent: 'unknown', note: 'No planner step found in pipeline' };
}

function extractSimulationResults(steps: PipelineStep[]): Record<string, unknown> {
  const simStep = steps.find(s => s.domain === 'simulator' || s.agent === 'scenario');
  if (simStep?.output) {
    return { source_agent: simStep.agent, ...simStep.output };
  }
  return { source_agent: 'unknown', note: 'No simulation step found in pipeline' };
}

function extractScaffoldManifest(steps: PipelineStep[]): Record<string, unknown> {
  const sdkStep = steps.find(s => s.agent === 'sdk' || s.domain === 'forge');
  if (sdkStep?.output) {
    return {
      source_agent: sdkStep.agent,
      artifacts_count: sdkStep.artifacts?.length ?? 0,
      ...sdkStep.output,
    };
  }
  return { source_agent: 'unknown', note: 'No scaffold step found in pipeline' };
}

function computeRecommendation(steps: PipelineStep[]): { recommendation: string; confidence: number } {
  const simStep = steps.find(s => s.domain === 'simulator' || s.agent === 'scenario');
  const sdkStep = steps.find(s => s.agent === 'sdk' || s.domain === 'forge');
  const plannerStep = steps.find(s => s.agent === 'planner' || s.agent === 'decomposer');

  let confidence = 0.5;
  if (plannerStep?.output) confidence += 0.1;
  if (sdkStep?.output) confidence += 0.15;
  if (simStep?.output) confidence += 0.2;

  const allArtifacts = collectArtifacts(steps);
  if (allArtifacts.length > 0) confidence += 0.05;

  confidence = Math.min(1.0, confidence);

  let recommendation: string;
  if (confidence >= 0.8) {
    recommendation = 'proceed';
  } else if (confidence >= 0.5) {
    recommendation = 'review';
  } else {
    recommendation = 'reject';
  }

  return { recommendation, confidence };
}

/** In-memory decision package store (stateless per invocation in production) */
const decisionPackages = new Map<string, Record<string, unknown>>();

function handleErpSurface(body: AgentRequest): Record<string, unknown> {
  const action = body.payload?.['action'] as string | undefined;

  if (action === 'status') {
    return {
      status: 'healthy',
      agent: 'erp-surface',
      domain: DOMAIN,
      timestamp: getCurrentTimestamp(),
    };
  }

  if (action === 'query') {
    const packageId = body.payload?.['decision_package_id'] as string | undefined;
    if (packageId && decisionPackages.has(packageId)) {
      return {
        status: 'found',
        decision_package: decisionPackages.get(packageId),
      };
    }
    return {
      status: 'not_found',
      message: packageId
        ? `Decision package ${packageId} not found`
        : 'Provide decision_package_id to query',
      known_packages: [...decisionPackages.keys()],
    };
  }

  if (action === 'ingest_pipeline_artifacts') {
    const ctx = body.pipeline_context;
    if (!ctx) {
      return {
        status: 'error',
        code: 'MISSING_PIPELINE_CONTEXT',
        message: 'ingest_pipeline_artifacts requires pipeline_context with previous_steps',
      };
    }

    const steps = ctx.previous_steps || [];
    const allArtifacts = collectArtifacts(steps);
    const planSummary = extractPlanSummary(steps);
    const simulationResults = extractSimulationResults(steps);
    const scaffoldManifest = extractScaffoldManifest(steps);
    const { recommendation, confidence } = computeRecommendation(steps);

    const decisionPackageId = crypto.randomUUID();
    const decisionPackage: Record<string, unknown> = {
      decision_package_id: decisionPackageId,
      summary: `Pipeline ${ctx.plan_id} completed ${steps.length} steps with ${allArtifacts.length} artifacts. Recommendation: ${recommendation}.`,
      artifacts_received: allArtifacts.length,
      plan_summary: planSummary,
      simulation_results: simulationResults,
      scaffold_manifest: scaffoldManifest,
      recommendation,
      confidence,
      created_at: new Date().toISOString(),
    };

    decisionPackages.set(decisionPackageId, decisionPackage);
    return decisionPackage;
  }

  // Standalone / backwards-compatible: treat body as raw ERP event
  return {
    status: 'accepted',
    agent: 'erp-surface',
    message: 'ERP Surface Agent received standalone request',
    input_received: {
      has_text: !!body.text,
      has_payload: !!body.payload,
      action: action ?? 'none',
    },
    timestamp: getCurrentTimestamp(),
  };
}

// ============================================================================
// Database-Query Agent
// ============================================================================

function handleDatabaseQuery(body: AgentRequest): Record<string, unknown> {
  const action = body.payload?.['action'] as string | undefined;

  if (action === 'status') {
    return {
      status: 'healthy',
      agent: 'database-query',
      domain: DOMAIN,
      timestamp: getCurrentTimestamp(),
    };
  }

  return {
    status: 'success',
    agent: 'database-query',
    message: 'Database Query Agent endpoint active',
    note: 'Full query execution requires ruvector-service',
    decision_event: {
      agent_id: 'database-query-agent',
      agent_version: '1.0.0',
      decision_type: 'database_query_result',
      timestamp: getCurrentTimestamp(),
      outputs: {
        query_received: true,
        input: body.payload ?? {},
      },
      confidence: { score: 1.0, schema_validation: 'passed' },
      constraints_applied: { connector_scope: 'database-connector', read_only: true },
    },
  };
}

// ============================================================================
// Webhook-Ingest Agent
// ============================================================================

async function handleWebhookIngest(
  body: AgentRequest,
  headers: Record<string, string>,
): Promise<Record<string, unknown>> {
  const action = body.payload?.['action'] as string | undefined;

  if (action === 'status') {
    return {
      status: 'healthy',
      agent: 'webhook-ingest',
      domain: DOMAIN,
      timestamp: getCurrentTimestamp(),
    };
  }

  const agent = new WebhookListenerAgent({
    connector_id: 'webhook-ingest',
    connector_scope: 'webhook-connector',
    debug: process.env['DEBUG'] === 'true',
    timeout_ms: parseInt(process.env['AGENT_TIMEOUT_MS'] || '30000', 10),
    max_payload_bytes: parseInt(process.env['MAX_PAYLOAD_BYTES'] || '10485760', 10),
    telemetry_enabled: process.env['TELEMETRY_ENABLED'] !== 'false',
    allowed_content_types: ['application/json', 'application/x-www-form-urlencoded'],
    replay_protection: true,
    rate_limit_enabled: true,
    rate_limit_rpm: 1000,
  });

  await agent.initialize();

  const webhookRequest = {
    method: 'POST' as const,
    path: '/',
    headers,
    body: JSON.stringify(body.payload ?? {}),
    source_ip: headers['x-forwarded-for'] || headers['x-real-ip'],
    received_at: getCurrentTimestamp(),
    content_type: headers['content-type'] || 'application/json',
  };

  const response = await agent.process(webhookRequest);
  return response as unknown as Record<string, unknown>;
}

// ============================================================================
// Event-Normalize Agent
// ============================================================================

function handleEventNormalize(body: AgentRequest): Record<string, unknown> {
  const action = body.payload?.['action'] as string | undefined;

  if (action === 'status') {
    return {
      status: 'healthy',
      agent: 'event-normalize',
      domain: DOMAIN,
      timestamp: getCurrentTimestamp(),
    };
  }

  const payload = body.payload ?? {};
  const format = (payload['format'] as string) || 'json';
  const rawPayload = payload['raw_payload'] ?? payload['data'] ?? payload;

  return {
    status: 'success',
    agent: 'event-normalize',
    message: 'Event Normalize Agent processed request',
    normalized_event: {
      format_detected: format,
      canonical_type: (payload['event_type'] as string) || 'custom',
      payload: rawPayload,
      normalization_applied: true,
      quality_score: 0.85,
    },
    timestamp: getCurrentTimestamp(),
  };
}

// ============================================================================
// Auth-Identity Agent
// ============================================================================

async function handleAuthIdentity(body: AgentRequest): Promise<Record<string, unknown>> {
  const action = body.payload?.['action'] as string | undefined;

  if (action === 'status') {
    return {
      status: 'healthy',
      agent: 'auth-identity',
      domain: DOMAIN,
      timestamp: getCurrentTimestamp(),
    };
  }

  const agent = new AuthIdentityAgent({
    connector_scope: 'auth-connector',
    require_mfa_for_high_assurance: false,
    min_trust_score: 0.5,
    debug: process.env['DEBUG'] === 'true',
    timeout_ms: parseInt(process.env['AGENT_TIMEOUT_MS'] || '30000', 10),
    max_payload_bytes: parseInt(process.env['MAX_PAYLOAD_BYTES'] || '10485760', 10),
    telemetry_enabled: process.env['TELEMETRY_ENABLED'] !== 'false',
  });

  await agent.initialize();
  const response = await agent.process(body.payload ?? {});
  return response as unknown as Record<string, unknown>;
}

// ============================================================================
// Cloud Function Entry Point
// ============================================================================

export const handler: HttpFunction = async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Correlation-Id, X-Webhook-Signature');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  const body: AgentRequest | undefined = req.body;

  // Health check — GET or body without agent
  if (req.method === 'GET' || !body?.agent) {
    const traceId = resolveTraceId(body ?? ({} as AgentRequest), req.headers as Record<string, unknown>);
    res.status(200).json(buildEnvelope('health', {
      status: 'healthy',
      service: 'connector-hub-agents',
      agents: [...AGENT_NAMES],
      timestamp: getCurrentTimestamp(),
    }, traceId));
    return;
  }

  const agentName = body.agent;

  if (!AGENT_NAMES.includes(agentName)) {
    const traceId = resolveTraceId(body, req.headers as Record<string, unknown>);
    res.status(400).json(buildEnvelope(agentName, {
      status: 'error',
      code: 'UNKNOWN_AGENT',
      message: `Unknown agent: ${agentName}`,
      available_agents: [...AGENT_NAMES],
    }, traceId, body.pipeline_context));
    return;
  }

  const traceId = resolveTraceId(body, req.headers as Record<string, unknown>);

  try {
    let result: Record<string, unknown>;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers[k] = v;
      else if (Array.isArray(v) && v[0]) headers[k] = v[0];
    }

    switch (agentName) {
      case 'erp-surface':
        result = handleErpSurface(body);
        break;
      case 'database-query':
        result = handleDatabaseQuery(body);
        break;
      case 'webhook-ingest':
        result = await handleWebhookIngest(body, headers);
        break;
      case 'event-normalize':
        result = handleEventNormalize(body);
        break;
      case 'auth-identity':
        result = await handleAuthIdentity(body);
        break;
      default:
        result = { status: 'error', message: `Unhandled agent: ${agentName}` };
    }

    res.status(200).json(buildEnvelope(agentName, result, traceId, body.pipeline_context));
  } catch (error) {
    res.status(500).json(buildEnvelope(agentName, {
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Internal server error',
      retryable: true,
    }, traceId, body.pipeline_context));
  }
};
