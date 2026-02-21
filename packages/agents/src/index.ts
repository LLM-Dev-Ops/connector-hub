/**
 * Connector Hub Agents Package
 *
 * This package provides agents for the Agentics platform that operate
 * as external interface adapters and ingestion agents.
 *
 * All agents in this package:
 * - Are stateless at runtime
 * - Deploy as Google Cloud Edge Functions
 * - Emit exactly ONE DecisionEvent per invocation
 * - Do NOT orchestrate internal agents
 * - Do NOT execute workflows
 * - Persist data only via ruvector-service
 */

export const VERSION = '0.1.0';

// Base agent infrastructure
export * from './base/index.js';

// Runtime infrastructure
export * from './runtime/index.js';

// Contracts (explicit exports to avoid conflicts with base module)
export {
  // Types
  type DecisionType,
  type Confidence,
  type ConstraintsApplied,
  type DecisionEvent,
  type AgentStatus,
  type AgentResponse,
  type IAgent,
  // Schemas
  DecisionTypeSchema,
  ConfidenceSchema,
  ConstraintsAppliedSchema,
  DecisionEventSchema,
  AgentStatusSchema,
  AgentResponseSchema,
  // Helpers
  computeInputsHash,
  generateExecutionRef,
  getCurrentTimestamp,
  createDecisionEvent,
} from './contracts/index.js';

// Webhook contracts
export {
  type SignatureMethod,
  type SignatureConfig,
  type WebhookRequest,
  type ValidationError,
  type SignatureVerificationResult,
  type WebhookValidationResult,
  type WebhookAgentConfig,
  type WebhookOutput,
  type WebhookDecisionEvent,
  type PersistedWebhookData,
  SignatureMethodSchema,
  SignatureConfigSchema,
  WebhookRequestSchema,
  ValidationErrorSchema,
  SignatureVerificationResultSchema,
  WebhookValidationResultSchema,
  WebhookAgentConfigSchema,
  WebhookOutputSchema,
  PersistedWebhookDataSchema,
  createWebhookConfidence,
  createWebhookConstraints,
  sanitizeHeaders,
  SensitiveDataFields,
} from './contracts/index.js';

// ============================================================================
// Agent Exports
// ============================================================================

// ERP Surface Agent - External ERP system interface
export {
  ERPSurfaceAgent,
  createERPSurfaceAgent,
  ERPEventInputSchema,
  ERPEventOutputSchema,
  ERPSystemSchema,
  ERPEventTypeSchema,
  type ERPSurfaceAgentConfig,
  type ERPEventInput,
  type ERPEventOutput,
  type ERPSystem,
  type ERPEventType,
} from './agents/erp-surface/index.js';

// ERP Surface Handler - Google Cloud Edge Function
export {
  erpSurfaceHandler,
  erpSurfaceHealthCheck,
  ERPSurfaceHandler,
  ERPSurfaceRequestSchema,
  type ERPSurfaceRequest,
} from './agents/erp-surface/handler.js';

// Auth/Identity Agent
export * from './auth/index.js';

// Webhook Agent
export * from './webhook/index.js';

// Event Normalization Agent - External event normalization
export {
  EventNormalizationAgent,
  createEventNormalizationAgent,
  EVENT_NORMALIZATION_AGENT_METADATA,
} from './event-normalization/agent.js';

// Event Normalization Handler - Google Cloud Edge Function
export {
  eventNormalizationHandler,
  handler as eventNormalizationCloudHandler,
} from './event-normalization/handler.js';

// Event Normalization CLI
export {
  runCLI as runEventNormalizationCLI,
  normalizeCommand,
  inspectCommand,
  type CLICommand,
  type OutputFormat,
} from './event-normalization/cli.js';

// Event Normalization Types
export {
  ExternalFormatSchema,
  CanonicalEventTypeSchema,
  ExternalEventInputSchema,
  CanonicalEventOutputSchema,
  NormalizationConfigSchema,
  type ExternalFormat,
  type CanonicalEventType,
  type ExternalEventInput,
  type CanonicalEventOutput,
  type NormalizationConfig,
  type FieldMapping,
  type TransformFn,
  type TransformContext,
  type IFormatNormalizer,
} from './event-normalization/types.js';

// Event Normalization - Format Normalizers
export {
  BaseNormalizer,
  OpenAINormalizer,
  AnthropicNormalizer,
  GoogleAINormalizer,
  AzureOpenAINormalizer,
  AWSBedrockNormalizer,
  GitHubWebhookNormalizer,
  StripeWebhookNormalizer,
  SlackWebhookNormalizer,
  GenericWebhookNormalizer,
  createNormalizer,
  createLLMNormalizer,
  createWebhookNormalizer,
} from './event-normalization/normalizers/index.js';

// ============================================================================
// Cloud Function Entry Point
// ============================================================================

export { handler } from './functions/index.js';
