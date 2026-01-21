/**
 * Event Normalization Agent
 *
 * PURPOSE:
 * Convert heterogeneous external events into canonical internal event formats.
 *
 * CLASSIFICATION:
 * EVENT NORMALIZATION / TRANSLATION
 *
 * SCOPE:
 * - Accept connector-level events
 * - Normalize fields and semantics
 * - Enforce schema alignment
 * - Produce deterministic normalized outputs
 * - Emit normalized DecisionEvents
 *
 * DECISION_TYPE: "normalized_event"
 *
 * ARCHITECTURAL CONSTRAINTS (CONSTITUTIONAL):
 * - Agent is an EXTERNAL INTERFACE ADAPTER only
 * - MUST NOT orchestrate internal agents
 * - MUST NOT execute workflows
 * - MUST NOT enforce platform policies
 * - MUST NOT apply optimizations
 * - MUST NOT perform analytics
 * - All persistence via ruvector-service ONLY
 * - MUST emit exactly ONE DecisionEvent per invocation
 * - Execution MUST be deterministic
 */

import { z } from 'zod';
import type { RuVectorClient } from '../runtime/ruvector-client.js';
import type { TelemetryEmitter, Span } from '../runtime/telemetry.js';
import { EdgeFunctionAgentBase, AgentContext, AgentError, AgentErrorCode } from '../runtime/edge-function-base.js';
import { createDecisionEvent, computeInputsHash } from '../contracts/types.js';
import type {
  ExternalEventInput,
  CanonicalEventOutput,
  NormalizationConfig,
} from './types.js';
import {
  ExternalEventInputSchema,
  CanonicalEventOutputSchema,
  NormalizationConfigSchema,
} from './types.js';
import { createNormalizer } from './normalizers/index.js';

/**
 * Agent input schema
 */
const EventNormalizationInputSchema = z.object({
  event: ExternalEventInputSchema,
  config: NormalizationConfigSchema.optional(),
});

type EventNormalizationInput = z.infer<typeof EventNormalizationInputSchema>;

/**
 * Agent output schema
 */
const EventNormalizationOutputSchema = z.object({
  normalized_event: CanonicalEventOutputSchema,
  metrics: z.object({
    processing_time_ms: z.number(),
    field_mappings_applied: z.number(),
    fields_dropped: z.number(),
    warnings_count: z.number(),
  }),
});

type EventNormalizationOutput = z.infer<typeof EventNormalizationOutputSchema>;

/**
 * Event Normalization Agent
 *
 * Converts external events from various formats (LLM APIs, webhooks, ERP, etc.)
 * into canonical internal event format for downstream processing.
 *
 * This agent:
 * - DOES accept connector-level events
 * - DOES normalize fields and semantics
 * - DOES enforce schema alignment
 * - DOES produce deterministic outputs
 * - DOES emit DecisionEvents
 *
 * This agent MUST NOT:
 * - Orchestrate other agents
 * - Execute workflows
 * - Enforce business policies
 * - Apply optimizations
 * - Perform analytics
 * - Connect directly to databases
 */
export class EventNormalizationAgent extends EdgeFunctionAgentBase<
  EventNormalizationInput,
  EventNormalizationOutput
> {
  protected readonly agentId = 'event-normalization-agent';
  protected readonly agentVersion = '1.0.0';
  protected readonly inputSchema = EventNormalizationInputSchema;
  protected readonly outputSchema = EventNormalizationOutputSchema;

  private readonly defaultConfig: NormalizationConfig = {
    strict_validation: false,
    max_payload_bytes: 10 * 1024 * 1024,
    include_dropped_fields: true,
    include_field_mappings: true,
  };

  constructor(
    ruVectorClient: RuVectorClient,
    telemetry: TelemetryEmitter
  ) {
    super(ruVectorClient, telemetry);
  }

  /**
   * Execute the normalization
   *
   * DETERMINISTIC: Same input always produces same output
   * NO SIDE EFFECTS: Only reads input, produces output
   * SINGLE RESPONSIBILITY: Normalize events only
   */
  protected async executeAgent(
    input: EventNormalizationInput,
    context: AgentContext,
    span: Span
  ): Promise<EventNormalizationOutput> {
    const startTime = Date.now();
    const config = { ...this.defaultConfig, ...input.config };

    // Log normalization start
    this.telemetry.addSpanEvent(span, 'normalization.start', {
      'event.format': input.event.format,
    });

    try {
      // Create format-specific normalizer
      const normalizer = createNormalizer(input.event.format);

      // Normalize the event
      const normalizedEvent = await normalizer.normalize(input.event, config);

      // Calculate metrics
      const processingTimeMs = Date.now() - startTime;
      const fieldMappingsApplied = normalizedEvent.normalization.field_mappings.length;
      const fieldsDropped = normalizedEvent.normalization.dropped_fields?.length ?? 0;
      const warningsCount = normalizedEvent.normalization.warnings?.length ?? 0;

      // Log normalization complete
      this.telemetry.addSpanEvent(span, 'normalization.complete', {
        'event.type': normalizedEvent.type,
        'processing_time_ms': processingTimeMs,
        'field_mappings_applied': fieldMappingsApplied,
        'fields_dropped': fieldsDropped,
      });

      // Persist the normalized event to ruvector-service
      await this.persistNormalizedEvent(normalizedEvent, context, span);

      return {
        normalized_event: normalizedEvent,
        metrics: {
          processing_time_ms: processingTimeMs,
          field_mappings_applied: fieldMappingsApplied,
          fields_dropped: fieldsDropped,
          warnings_count: warningsCount,
        },
      };
    } catch (error) {
      this.telemetry.addSpanEvent(span, 'normalization.error', {
        'error.message': error instanceof Error ? error.message : 'Unknown error',
      });

      throw new AgentError(
        `Normalization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        AgentErrorCode.EXECUTION_ERROR,
        { format: input.event.format, error }
      );
    }
  }

  /**
   * Get event type for DecisionEvent
   */
  protected override getEventType(success: boolean): string {
    return success ? 'normalized_event' : 'normalization_error';
  }

  /**
   * Persist normalized event via ruvector-service
   */
  private async persistNormalizedEvent(
    event: CanonicalEventOutput,
    context: AgentContext,
    span: Span
  ): Promise<void> {
    this.telemetry.addSpanEvent(span, 'persistence.start');

    const result = await this.ruVectorClient.persist('normalized_events', {
      ...event,
      // Add searchable fields
      event_id: event.id,
      event_type: event.type,
      source_format: event.source.format,
      source_system: event.source.system,
      validated: event.validation.validated,
      request_id: context.requestId,
      timestamp_epoch: Date.parse(event.timestamp),
    });

    if (result.success) {
      this.telemetry.addSpanEvent(span, 'persistence.complete', {
        'document_id': result.id ?? 'unknown',
      });
    } else {
      this.telemetry.addSpanEvent(span, 'persistence.failed', {
        'error': result.error ?? 'Unknown error',
      });
      // Non-blocking - log but don't fail
      console.error('[EventNormalizationAgent] Persistence failed:', result.error);
    }
  }
}

/**
 * Create Event Normalization Agent with dependencies from environment
 */
export function createEventNormalizationAgent(
  ruVectorClient: RuVectorClient,
  telemetry: TelemetryEmitter
): EventNormalizationAgent {
  return new EventNormalizationAgent(ruVectorClient, telemetry);
}

/**
 * Agent metadata for registration
 */
export const EVENT_NORMALIZATION_AGENT_METADATA = {
  id: 'event-normalization-agent',
  version: '1.0.0',
  decisionType: 'normalized_event' as const,
  description: 'Convert heterogeneous external events into canonical internal event formats',
  classification: 'EVENT_NORMALIZATION',
  supportedFormats: [
    'openai_api',
    'anthropic_api',
    'google_ai_api',
    'azure_openai_api',
    'aws_bedrock_api',
    'webhook_github',
    'webhook_stripe',
    'webhook_slack',
    'webhook_generic',
    'erp_salesforce',
    'erp_sap',
    'erp_dynamics',
    'database_postgres',
    'database_mysql',
    'database_mongodb',
    'auth_oauth2',
    'auth_saml',
    'auth_oidc',
    'custom',
  ],
  endpoints: ['normalize', 'inspect'],
};
