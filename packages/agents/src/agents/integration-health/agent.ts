/**
 * IntegrationHealthAgent - Phase 6 Core Infrastructure (Layer 1)
 *
 * EXTERNAL ADAPTER HEALTH SOURCE
 *
 * This agent monitors the health of external integrations.
 * It is DETERMINISTIC - same inputs always produce same outputs
 * (with time-bounded health checks).
 *
 * ARCHITECTURAL RULES:
 * - MUST be deterministic (given same system state)
 * - MUST emit exactly ONE DecisionEvent per invocation (integration_health_signal)
 * - MUST persist via ruvector-service ONLY
 * - MUST respect performance budgets (MAX_TOKENS=800, MAX_LATENCY_MS=1500)
 *
 * @packageDocumentation
 */

import { createHash } from 'crypto';
import { z } from 'zod';
import {
  IntegrationHealthInput,
  IntegrationHealthInputSchema,
  IntegrationHealthOutput,
  IntegrationHealthOutputSchema,
  IntegrationHealthCheck,
  IntegrationType,
  HealthStatus,
  PERFORMANCE_BUDGETS,
} from '@llm-dev-ops/connector-hub-contracts';
import { getRuvectorClient, RuvectorClient } from '../../infrastructure/ruvector-client.js';

// ============================================================================
// Integration Registry
// ============================================================================

interface IntegrationDefinition {
  id: string;
  type: IntegrationType;
  healthEndpoint?: string;
  envVar?: string;
  critical: boolean;
}

/**
 * Registered integrations that can be health-checked
 */
const INTEGRATION_REGISTRY: IntegrationDefinition[] = [
  {
    id: 'ruvector',
    type: 'ruvector',
    healthEndpoint: '/health',
    envVar: 'RUVECTOR_SERVICE_URL',
    critical: true,
  },
  {
    id: 'openai',
    type: 'llm_provider',
    healthEndpoint: '/v1/models',
    envVar: 'OPENAI_API_KEY',
    critical: false,
  },
  {
    id: 'anthropic',
    type: 'llm_provider',
    healthEndpoint: '/v1/messages',
    envVar: 'ANTHROPIC_API_KEY',
    critical: false,
  },
  {
    id: 'google-ai',
    type: 'llm_provider',
    envVar: 'GOOGLE_API_KEY',
    critical: false,
  },
  {
    id: 'secret-manager',
    type: 'secret_manager',
    envVar: 'GOOGLE_CLOUD_PROJECT',
    critical: true,
  },
  {
    id: 'telemetry',
    type: 'telemetry',
    healthEndpoint: '/health',
    envVar: 'TELEMETRY_ENDPOINT',
    critical: false,
  },
  {
    id: 'redis-cache',
    type: 'cache',
    envVar: 'REDIS_URL',
    critical: false,
  },
];

// ============================================================================
// Health Check Cache
// ============================================================================

interface CachedHealthCheck {
  result: IntegrationHealthCheck;
  cachedAt: number;
  ttlMs: number;
}

const healthCache = new Map<string, CachedHealthCheck>();
const CACHE_TTL_MS = 30000; // 30 seconds

// ============================================================================
// Agent Context
// ============================================================================

export interface IntegrationHealthContext {
  traceId: string;
  spanId?: string;
  correlationId?: string;
}

// ============================================================================
// IntegrationHealthAgent
// ============================================================================

export class IntegrationHealthAgent {
  public readonly agentId = 'integration-health-agent';
  public readonly version = '1.0.0';
  public readonly decisionType = 'integration_health_signal' as const;

  private readonly ruvector: RuvectorClient;

  constructor() {
    this.ruvector = getRuvectorClient();
  }

  /**
   * Process integration health check request
   *
   * DETERMINISTIC: Given same system state, produces same output
   */
  async process(
    input: unknown,
    context: IntegrationHealthContext
  ): Promise<{
    event: IntegrationHealthDecisionEvent;
    output: IntegrationHealthOutput;
    durationMs: number;
  }> {
    const startTime = Date.now();

    // Validate input
    const validatedInput = IntegrationHealthInputSchema.parse(input);

    // Determine which integrations to check
    const integrationsToCheck = this.resolveIntegrations(validatedInput.integrations);

    // Perform health checks (with parallelization)
    const healthChecks = await this.checkIntegrations(
      integrationsToCheck,
      validatedInput.timeout_ms,
      validatedInput.include_metadata,
      validatedInput.force_fresh
    );

    const durationMs = Date.now() - startTime;

    // Check performance budget
    if (durationMs > PERFORMANCE_BUDGETS.MAX_LATENCY_MS) {
      console.warn(
        `[${this.agentId}] Performance budget exceeded: ${durationMs}ms > ${PERFORMANCE_BUDGETS.MAX_LATENCY_MS}ms`
      );
    }

    // Compute aggregated statistics
    const stats = this.computeStats(healthChecks);

    // Determine overall status
    const overallStatus = this.computeOverallStatus(healthChecks);

    // Create output
    const output: IntegrationHealthOutput = {
      overall_status: overallStatus,
      integrations: healthChecks,
      stats: {
        total_checked: healthChecks.length,
        healthy_count: stats.healthy,
        degraded_count: stats.degraded,
        unhealthy_count: stats.unhealthy,
        unknown_count: stats.unknown,
        total_latency_ms: stats.totalLatency,
        avg_latency_ms: healthChecks.length > 0 ? Math.round(stats.totalLatency / healthChecks.length) : 0,
      },
      checked_at: new Date().toISOString(),
      token_count: this.estimateTokenCount(validatedInput, healthChecks),
    };

    // Validate output against schema
    IntegrationHealthOutputSchema.parse(output);

    // Create DecisionEvent
    const event = this.createDecisionEvent(validatedInput, output, context, durationMs);

    // Persist to Ruvector (async, non-blocking)
    this.persistHealthResult(output, event).catch(err => {
      console.error(`[${this.agentId}] Failed to persist to Ruvector:`, err);
    });

    return { event, output, durationMs };
  }

  /**
   * Resolve integration IDs to check
   */
  private resolveIntegrations(requested: string[]): IntegrationDefinition[] {
    if (requested.length === 0) {
      // Return all registered integrations
      return INTEGRATION_REGISTRY;
    }

    return INTEGRATION_REGISTRY.filter(i => requested.includes(i.id));
  }

  /**
   * Check health of multiple integrations in parallel
   */
  private async checkIntegrations(
    integrations: IntegrationDefinition[],
    timeoutMs: number,
    includeMetadata: boolean,
    forceFresh: boolean
  ): Promise<IntegrationHealthCheck[]> {
    const results = await Promise.all(
      integrations.map(integration =>
        this.checkSingleIntegration(integration, timeoutMs, includeMetadata, forceFresh)
      )
    );
    return results;
  }

  /**
   * Check health of a single integration
   */
  private async checkSingleIntegration(
    integration: IntegrationDefinition,
    timeoutMs: number,
    includeMetadata: boolean,
    forceFresh: boolean
  ): Promise<IntegrationHealthCheck> {
    // Check cache first (unless force_fresh)
    if (!forceFresh) {
      const cached = healthCache.get(integration.id);
      if (cached && Date.now() - cached.cachedAt < cached.ttlMs) {
        return cached.result;
      }
    }

    const startTime = Date.now();
    let status: HealthStatus = 'unknown';
    let error: string | undefined;
    let metadata: Record<string, unknown> | undefined;
    let lastSuccess: string | undefined;

    try {
      // Special handling for Ruvector (use our client)
      if (integration.type === 'ruvector') {
        const health = await this.ruvector.healthCheck();
        status = health.healthy ? 'healthy' : 'unhealthy';
        if (health.healthy) {
          lastSuccess = new Date().toISOString();
        }
        if (includeMetadata && health.version) {
          metadata = { version: health.version };
        }
      }
      // Check if required environment variable exists
      else if (integration.envVar) {
        const envValue = process.env[integration.envVar];
        if (!envValue) {
          status = 'unhealthy';
          error = `Missing environment variable: ${integration.envVar}`;
        } else {
          // For providers with health endpoints, attempt check
          if (integration.healthEndpoint && integration.id === 'telemetry') {
            const telemetryUrl = process.env.TELEMETRY_ENDPOINT;
            if (telemetryUrl) {
              const healthy = await this.httpHealthCheck(
                `${telemetryUrl}${integration.healthEndpoint}`,
                timeoutMs
              );
              status = healthy ? 'healthy' : 'degraded';
              if (healthy) lastSuccess = new Date().toISOString();
            } else {
              status = 'unknown';
            }
          } else {
            // Env var exists, assume degraded (can't verify without actual call)
            status = 'degraded';
            if (includeMetadata) {
              metadata = { configured: true };
            }
          }
        }
      } else {
        status = 'unknown';
        error = 'No health check mechanism defined';
      }
    } catch (err) {
      status = 'unhealthy';
      error = err instanceof Error ? err.message : String(err);
    }

    const latencyMs = Date.now() - startTime;

    const result: IntegrationHealthCheck = {
      integration_id: integration.id,
      type: integration.type,
      status,
      latency_ms: latencyMs,
      ...(lastSuccess && { last_success: lastSuccess }),
      ...(error && { error }),
      ...(includeMetadata && metadata && { metadata }),
    };

    // Cache result
    healthCache.set(integration.id, {
      result,
      cachedAt: Date.now(),
      ttlMs: CACHE_TTL_MS,
    });

    return result;
  }

  /**
   * Simple HTTP health check
   */
  private async httpHealthCheck(url: string, timeoutMs: number): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Compute aggregated statistics
   */
  private computeStats(checks: IntegrationHealthCheck[]): {
    healthy: number;
    degraded: number;
    unhealthy: number;
    unknown: number;
    totalLatency: number;
  } {
    const stats = {
      healthy: 0,
      degraded: 0,
      unhealthy: 0,
      unknown: 0,
      totalLatency: 0,
    };

    for (const check of checks) {
      stats[check.status]++;
      stats.totalLatency += check.latency_ms;
    }

    return stats;
  }

  /**
   * Compute overall system health status
   */
  private computeOverallStatus(checks: IntegrationHealthCheck[]): HealthStatus {
    // Check critical integrations
    const criticalIntegrations = INTEGRATION_REGISTRY.filter(i => i.critical);
    const criticalChecks = checks.filter(c =>
      criticalIntegrations.some(ci => ci.id === c.integration_id)
    );

    // If any critical integration is unhealthy, overall is unhealthy
    const criticalUnhealthy = criticalChecks.some(c => c.status === 'unhealthy');
    if (criticalUnhealthy) {
      return 'unhealthy';
    }

    // If any critical integration is degraded, overall is degraded
    const criticalDegraded = criticalChecks.some(c => c.status === 'degraded');
    if (criticalDegraded) {
      return 'degraded';
    }

    // Check all integrations
    const unhealthyCount = checks.filter(c => c.status === 'unhealthy').length;
    const degradedCount = checks.filter(c => c.status === 'degraded').length;
    const unknownCount = checks.filter(c => c.status === 'unknown').length;

    if (unhealthyCount > checks.length * 0.5) {
      return 'unhealthy';
    }

    if (degradedCount > 0 || unhealthyCount > 0) {
      return 'degraded';
    }

    if (unknownCount === checks.length) {
      return 'unknown';
    }

    return 'healthy';
  }

  /**
   * Estimate token count for budget tracking
   */
  private estimateTokenCount(
    input: IntegrationHealthInput,
    checks: IntegrationHealthCheck[]
  ): number {
    const inputSize = JSON.stringify(input).length;
    const outputSize = JSON.stringify(checks).length;
    return Math.ceil((inputSize + outputSize) / 4);
  }

  /**
   * Create DecisionEvent for this health check
   */
  private createDecisionEvent(
    input: IntegrationHealthInput,
    output: IntegrationHealthOutput,
    context: IntegrationHealthContext,
    durationMs: number
  ): IntegrationHealthDecisionEvent {
    const inputHash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');

    return {
      agent_id: this.agentId,
      agent_version: this.version,
      decision_type: this.decisionType,
      inputs_hash: inputHash,
      outputs: output as unknown as Record<string, unknown>,
      confidence: {
        score: output.overall_status === 'healthy' ? 1.0 :
               output.overall_status === 'degraded' ? 0.7 :
               output.overall_status === 'unhealthy' ? 0.3 : 0.5,
        health_assessment: output.overall_status,
      },
      constraints_applied: {
        connector_scope: 'integration-health',
        integrations_checked: output.integrations.map(i => i.integration_id),
        timeout_ms: input.timeout_ms,
      },
      execution_ref: context.traceId,
      timestamp: output.checked_at,
      metadata: {
        duration_ms: durationMs,
        token_count: output.token_count,
        correlation_id: context.correlationId,
        total_checked: output.stats.total_checked,
        healthy_count: output.stats.healthy_count,
        unhealthy_count: output.stats.unhealthy_count,
      },
    };
  }

  /**
   * Persist health result to Ruvector
   */
  private async persistHealthResult(
    output: IntegrationHealthOutput,
    event: IntegrationHealthDecisionEvent
  ): Promise<void> {
    const documentId = `integration-health:${Date.now()}`;

    await this.ruvector.store(
      'integration-health',
      documentId,
      {
        overall_status: output.overall_status,
        stats: output.stats,
        event_ref: event.execution_ref,
        timestamp: event.timestamp,
        integrations: output.integrations.map(i => ({
          id: i.integration_id,
          status: i.status,
          latency_ms: i.latency_ms,
        })),
      },
      3600 // 1 hour TTL for health history
    );
  }

  /**
   * Health check (meta - checks if this agent can operate)
   */
  async healthCheck(): Promise<boolean> {
    const ruvectorHealth = await this.ruvector.healthCheck();
    return ruvectorHealth.healthy;
  }

  /**
   * List registered integrations
   */
  listIntegrations(): Array<{ id: string; type: IntegrationType; critical: boolean }> {
    return INTEGRATION_REGISTRY.map(i => ({
      id: i.id,
      type: i.type,
      critical: i.critical,
    }));
  }

  /**
   * Clear health cache (for testing)
   */
  clearCache(): void {
    healthCache.clear();
  }
}

// ============================================================================
// Decision Event Type
// ============================================================================

export interface IntegrationHealthDecisionEvent {
  agent_id: string;
  agent_version: string;
  decision_type: 'integration_health_signal';
  inputs_hash: string;
  outputs: Record<string, unknown>;
  confidence: {
    score: number;
    health_assessment: HealthStatus;
  };
  constraints_applied: {
    connector_scope: string;
    integrations_checked: string[];
    timeout_ms: number;
  };
  execution_ref: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Export singleton factory
// ============================================================================

let agentInstance: IntegrationHealthAgent | null = null;

export function getIntegrationHealthAgent(): IntegrationHealthAgent {
  if (!agentInstance) {
    agentInstance = new IntegrationHealthAgent();
  }
  return agentInstance;
}
