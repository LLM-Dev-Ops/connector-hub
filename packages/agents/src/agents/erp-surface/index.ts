/**
 * ERP Surface Event Agent
 *
 * PURPOSE: Interface with external ERP systems (SAP, Oracle, NetSuite, etc.)
 *
 * RESPONSIBILITIES:
 * - Receive ERP events from external systems
 * - Validate event structure and completeness
 * - Normalize ERP payloads to canonical format
 * - Extract business entity identifiers
 * - Emit erp_surface_event DecisionEvents
 *
 * CLASSIFICATION: INGRESS CONNECTOR / ERP EVENT RECEIVER
 *
 * CONSTRAINTS:
 * - MUST NOT execute ERP transactions or commands
 * - MUST NOT modify ERP system state
 * - MUST NOT trigger workflows or retries
 * - MUST be read-only and event-driven
 * - Confidence based on event completeness and format validity
 */

import { z } from 'zod';
import { BaseAgent } from '../../shared/BaseAgent.js';
import {
  type Confidence,
  type ConstraintsApplied,
  type BaseAgentConfig,
  computeInputsHash,
} from '../../contracts/index.js';

// ============================================================================
// ERP Event Schemas
// ============================================================================

/**
 * Supported ERP systems
 */
export const ERPSystemSchema = z.enum([
  'sap',
  'oracle_ebs',
  'oracle_cloud',
  'netsuite',
  'microsoft_dynamics',
  'workday',
  'infor',
  'epicor',
  'custom',
]);

export type ERPSystem = z.infer<typeof ERPSystemSchema>;

/**
 * ERP event types
 */
export const ERPEventTypeSchema = z.enum([
  'purchase_order_created',
  'purchase_order_updated',
  'invoice_created',
  'invoice_approved',
  'payment_processed',
  'inventory_updated',
  'customer_created',
  'customer_updated',
  'order_created',
  'order_fulfilled',
  'shipment_created',
  'goods_receipt',
  'material_master_updated',
  'accounting_document_posted',
  'journal_entry_created',
  'custom_event',
]);

export type ERPEventType = z.infer<typeof ERPEventTypeSchema>;

/**
 * ERP event input schema
 */
export const ERPEventInputSchema = z.object({
  /** ERP system identifier */
  erp_system: ERPSystemSchema,

  /** Event type */
  event_type: ERPEventTypeSchema,

  /** Event timestamp from ERP system */
  event_timestamp: z.string().datetime(),

  /** Raw ERP event payload */
  payload: z.record(z.unknown()),

  /** ERP system version (optional) */
  system_version: z.string().optional(),

  /** Business entity identifiers */
  identifiers: z
    .object({
      company_code: z.string().optional(),
      plant: z.string().optional(),
      organization_id: z.string().optional(),
      document_number: z.string().optional(),
      transaction_id: z.string().optional(),
    })
    .optional(),

  /** Metadata from ERP system */
  metadata: z.record(z.unknown()).optional(),
});

export type ERPEventInput = z.infer<typeof ERPEventInputSchema>;

/**
 * Normalized ERP event output schema
 */
export const ERPEventOutputSchema = z.object({
  /** Source ERP system */
  source_system: ERPSystemSchema,

  /** Event type */
  event_type: ERPEventTypeSchema,

  /** Normalized payload */
  normalized_payload: z.record(z.unknown()),

  /** Original payload hash for traceability */
  original_payload_hash: z.string(),

  /** Extracted business identifiers */
  business_identifiers: z.object({
    company_code: z.string().optional(),
    plant: z.string().optional(),
    organization_id: z.string().optional(),
    document_number: z.string().optional(),
    transaction_id: z.string().optional(),
    correlation_id: z.string().optional(),
  }),

  /** Event timestamp (original from ERP) */
  event_timestamp: z.string().datetime(),

  /** Normalization mapping applied */
  normalization_mapping: z.string().optional(),

  /** Completeness score (0-1) */
  completeness_score: z.number().min(0).max(1),
});

export type ERPEventOutput = z.infer<typeof ERPEventOutputSchema>;

/**
 * ERP Surface Agent configuration
 */
export const ERPSurfaceAgentConfigSchema = z
  .object({
    /** Allowed ERP systems */
    allowed_erp_systems: z.array(ERPSystemSchema).optional(),

    /** Required fields for completeness validation */
    required_fields: z.array(z.string()).default([
      'event_type',
      'event_timestamp',
      'payload',
    ]),

    /** Field mapping configurations per ERP system */
    field_mappings: z.record(z.record(z.string())).optional(),

    /** Connector scope identifier */
    connector_scope: z.string().min(1),
  })
  .passthrough();

export type ERPSurfaceAgentConfig = z.infer<typeof ERPSurfaceAgentConfigSchema> &
  BaseAgentConfig;

// ============================================================================
// ERP Surface Agent Implementation
// ============================================================================

export class ERPSurfaceAgent extends BaseAgent {
  private readonly erpConfig: ERPSurfaceAgentConfig;

  constructor(config: ERPSurfaceAgentConfig) {
    super('erp-surface-agent', '1.0.0', 'erp_surface_event', config);
    this.erpConfig = config;
  }

  protected async validateInput(input: unknown): Promise<{
    valid: boolean;
    error?: string;
    duration_ms?: number;
  }> {
    const startTime = Date.now();

    try {
      const parsed = ERPEventInputSchema.parse(input);

      // Check if ERP system is allowed
      if (
        this.erpConfig.allowed_erp_systems &&
        !this.erpConfig.allowed_erp_systems.includes(parsed.erp_system)
      ) {
        return {
          valid: false,
          error: `ERP system ${parsed.erp_system} is not allowed`,
          duration_ms: Date.now() - startTime,
        };
      }

      return {
        valid: true,
        duration_ms: Date.now() - startTime,
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown validation error',
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
    const erpEvent = ERPEventInputSchema.parse(input);

    // Normalize the payload
    const normalizedPayload = this.normalizePayload(
      erpEvent.erp_system,
      erpEvent.payload,
    );

    // Extract business identifiers
    const businessIdentifiers = {
      ...erpEvent.identifiers,
      correlation_id: this.generateCorrelationId(erpEvent),
    };

    // Calculate completeness score
    const completenessScore = this.calculateCompleteness(erpEvent);

    // Build output
    const output: ERPEventOutput = {
      source_system: erpEvent.erp_system,
      event_type: erpEvent.event_type,
      normalized_payload: normalizedPayload,
      original_payload_hash: computeInputsHash(erpEvent.payload),
      business_identifiers: businessIdentifiers,
      event_timestamp: erpEvent.event_timestamp,
      normalization_mapping: this.erpConfig.field_mappings
        ? JSON.stringify(this.erpConfig.field_mappings[erpEvent.erp_system] || {})
        : undefined,
      completeness_score: completenessScore,
    };

    // Calculate confidence
    const confidence: Confidence = {
      score: this.computeConfidenceScore(completenessScore, 1.0), // Format is always valid after parsing
      payload_completeness: completenessScore,
      normalization_certainty: this.erpConfig.field_mappings ? 1.0 : 0.7,
      schema_validation: 'passed',
    };

    // Build constraints
    const constraintsApplied: ConstraintsApplied = {
      connector_scope: this.erpConfig.connector_scope,
      schema_boundaries: [`erp_system:${erpEvent.erp_system}`],
      timeout_ms: this.config.timeout_ms,
    };

    return {
      outputs: output,
      confidence,
      constraintsApplied,
      metadata: {
        erp_system: erpEvent.erp_system,
        system_version: erpEvent.system_version,
      },
    };
  }

  /**
   * Normalize ERP payload based on field mappings
   */
  private normalizePayload(
    erpSystem: ERPSystem,
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const mappings = this.erpConfig.field_mappings?.[erpSystem];
    if (!mappings) {
      return payload;
    }

    const normalized: Record<string, unknown> = {};

    for (const [sourceField, targetField] of Object.entries(mappings)) {
      if (sourceField in payload) {
        normalized[targetField] = payload[sourceField];
      }
    }

    // Include unmapped fields
    for (const [key, value] of Object.entries(payload)) {
      if (!(key in normalized)) {
        normalized[key] = value;
      }
    }

    return normalized;
  }

  /**
   * Generate correlation ID for tracing
   */
  private generateCorrelationId(erpEvent: ERPEventInput): string {
    const parts = [
      erpEvent.erp_system,
      erpEvent.event_type,
      erpEvent.identifiers?.transaction_id || '',
      erpEvent.identifiers?.document_number || '',
      erpEvent.event_timestamp,
    ];

    return computeInputsHash(parts.join('::'));
  }

  /**
   * Calculate payload completeness score
   */
  private calculateCompleteness(erpEvent: ERPEventInput): number {
    const requiredFields = this.erpConfig.required_fields;
    let presentCount = 0;

    for (const field of requiredFields) {
      if (field in erpEvent && erpEvent[field as keyof ERPEventInput]) {
        presentCount++;
      }
    }

    const baseScore = requiredFields.length > 0 ? presentCount / requiredFields.length : 1.0;

    // Bonus for identifiers
    const identifierBonus =
      erpEvent.identifiers && Object.keys(erpEvent.identifiers).length > 0 ? 0.1 : 0;

    return Math.min(1.0, baseScore + identifierBonus);
  }
}

/**
 * Factory function to create ERP Surface Agent
 */
export function createERPSurfaceAgent(config: ERPSurfaceAgentConfig): ERPSurfaceAgent {
  return new ERPSurfaceAgent(config);
}
