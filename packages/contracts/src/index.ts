/**
 * @llm-dev-ops/connector-hub-contracts
 *
 * Agent contract schemas and validation for LLM Connector Hub.
 * Provides Zod schemas and TypeScript types for all agent contracts.
 *
 * @packageDocumentation
 */

// Core DecisionEvent schema
export {
  DecisionEventSchema,
  DecisionTypeSchema,
  ConstraintsAppliedSchema,
  validateDecisionEvent,
  safeValidateDecisionEvent,
  type DecisionEvent,
  type DecisionType,
  type ConstraintsApplied,
} from './decision-event.js';

// Database Query Agent contract
export {
  DatabaseQueryInputSchema,
  DatabaseQueryOutputSchema,
  DatabaseQueryContractSchema,
  DatabaseQueryCLISchema,
  DatabaseConnectionConfigSchema,
  QueryStatsSchema,
  QueryMetadataSchema,
  validateDatabaseQueryInput,
  validateDatabaseQueryOutput,
  safeValidateDatabaseQueryInput,
  safeValidateDatabaseQueryOutput,
  type DatabaseQueryInput,
  type DatabaseQueryOutput,
  type DatabaseQueryContract,
  type DatabaseQueryCLI,
  type DatabaseConnectionConfig,
  type QueryStats,
  type QueryMetadata,
} from './agent-contracts/database-query.js';

// ERP Surface Agent contract
export {
  ERPSurfaceInputSchema,
  ERPSurfaceOutputSchema,
  ERPSurfaceContractSchema,
  ERPSurfaceCLISchema,
  ERPConnectionConfigSchema,
  ERPEventRecordSchema,
  ERPSystemTypeSchema,
  ERPEventTypeSchema,
  validateERPSurfaceInput,
  validateERPSurfaceOutput,
  safeValidateERPSurfaceInput,
  safeValidateERPSurfaceOutput,
  type ERPSurfaceInput,
  type ERPSurfaceOutput,
  type ERPSurfaceContract,
  type ERPSurfaceCLI,
  type ERPConnectionConfig,
  type ERPEventRecord,
  type ERPSystemType,
  type ERPEventType,
} from './agent-contracts/erp-surface.js';

// Webhook Ingest Agent contract
export {
  WebhookIngestInputSchema,
  WebhookIngestOutputSchema,
  WebhookIngestContractSchema,
  WebhookIngestCLISchema,
  SignatureVerificationSchema,
  WebhookValidationSchema,
  ParsedWebhookEventSchema,
  HTTPMethodSchema,
  validateWebhookIngestInput,
  validateWebhookIngestOutput,
  safeValidateWebhookIngestInput,
  safeValidateWebhookIngestOutput,
  type WebhookIngestInput,
  type WebhookIngestOutput,
  type WebhookIngestContract,
  type WebhookIngestCLI,
  type SignatureVerification,
  type WebhookValidation,
  type ParsedWebhookEvent,
  type HTTPMethod,
} from './agent-contracts/webhook-ingest.js';

// Auth Identity Agent contract
export {
  AuthIdentityInputSchema,
  AuthIdentityOutputSchema,
  AuthIdentityContractSchema,
  AuthIdentityCLISchema,
  AuthMethodSchema,
  TokenVerificationConfigSchema,
  IdentityClaimsSchema,
  VerificationResultSchema,
  validateAuthIdentityInput,
  validateAuthIdentityOutput,
  safeValidateAuthIdentityInput,
  safeValidateAuthIdentityOutput,
  type AuthIdentityInput,
  type AuthIdentityOutput,
  type AuthIdentityContract,
  type AuthIdentityCLI,
  type AuthMethod,
  type TokenVerificationConfig,
  type IdentityClaims,
  type VerificationResult,
} from './agent-contracts/auth-identity.js';

// Normalizer Agent contract
export {
  NormalizerInputSchema,
  NormalizerOutputSchema,
  NormalizerContractSchema,
  NormalizerCLISchema,
  SourceEventTypeSchema,
  NormalizationStrategySchema,
  SchemaMappingSchema,
  NormalizedEventSchema,
  NormalizationStatsSchema,
  validateNormalizerInput,
  validateNormalizerOutput,
  safeValidateNormalizerInput,
  safeValidateNormalizerOutput,
  type NormalizerInput,
  type NormalizerOutput,
  type NormalizerContract,
  type NormalizerCLI,
  type SourceEventType,
  type NormalizationStrategy,
  type SchemaMapping,
  type NormalizedEvent,
  type NormalizationStats,
} from './agent-contracts/normalizer.js';

// =============================================================================
// Phase 6 - Core Infrastructure Contracts (Layer 1)
// =============================================================================

// Core Infrastructure Agent contracts
export {
  // Performance budgets
  PERFORMANCE_BUDGETS,
  // Decision types
  CoreInfraDecisionTypeSchema,
  type CoreInfraDecisionType,
  // ConfigValidation contracts
  ConfigSourceSchema,
  ConfigSeveritySchema,
  ConfigValidationIssueSchema,
  ConfigValidationInputSchema,
  ConfigValidationOutputSchema,
  ConfigValidationContractSchema,
  validateConfigValidationInput,
  validateConfigValidationOutput,
  safeValidateConfigValidationInput,
  safeValidateConfigValidationOutput,
  type ConfigSource,
  type ConfigSeverity,
  type ConfigValidationIssue,
  type ConfigValidationInput,
  type ConfigValidationOutput,
  type ConfigValidationContract,
  // SchemaEnforcement contracts
  SchemaTypeSchema,
  SchemaViolationSchema,
  SchemaEnforcementInputSchema,
  SchemaEnforcementOutputSchema,
  SchemaEnforcementContractSchema,
  validateSchemaEnforcementInput,
  validateSchemaEnforcementOutput,
  safeValidateSchemaEnforcementInput,
  safeValidateSchemaEnforcementOutput,
  type SchemaType,
  type SchemaViolation,
  type SchemaEnforcementInput,
  type SchemaEnforcementOutput,
  type SchemaEnforcementContract,
  // IntegrationHealth contracts
  IntegrationTypeSchema,
  HealthStatusSchema,
  IntegrationHealthCheckSchema,
  IntegrationHealthInputSchema,
  IntegrationHealthOutputSchema,
  IntegrationHealthContractSchema,
  validateIntegrationHealthInput,
  validateIntegrationHealthOutput,
  safeValidateIntegrationHealthInput,
  safeValidateIntegrationHealthOutput,
  type IntegrationType,
  type HealthStatus,
  type IntegrationHealthCheck,
  type IntegrationHealthInput,
  type IntegrationHealthOutput,
  type IntegrationHealthContract,
} from './agent-contracts/core-infrastructure.js';
