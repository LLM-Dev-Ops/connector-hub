/**
 * Agentics Contracts - Public API
 *
 * Exports all contract schemas and types for LLM-Connector-Hub agents.
 */

// Core types and schemas
export {
  // Types
  type DecisionType,
  type Confidence,
  type ConstraintsApplied,
  type DecisionEvent,
  type AgentStatus,
  type AgentResponse,
  type IAgent,
  type BaseAgentConfig,
  // Schemas
  DecisionTypeSchema,
  ConfidenceSchema,
  ConstraintsAppliedSchema,
  DecisionEventSchema,
  AgentStatusSchema,
  AgentResponseSchema,
  BaseAgentConfigSchema,
  // Helpers
  computeInputsHash,
  generateExecutionRef,
  getCurrentTimestamp,
  createDecisionEvent,
} from './types.js';

// Webhook-specific contracts
export {
  // Types
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
  // Schemas
  SignatureMethodSchema,
  SignatureConfigSchema,
  WebhookRequestSchema,
  ValidationErrorSchema,
  SignatureVerificationResultSchema,
  WebhookValidationResultSchema,
  WebhookAgentConfigSchema,
  WebhookOutputSchema,
  PersistedWebhookDataSchema,
  // Helpers
  createWebhookConfidence,
  createWebhookConstraints,
  sanitizeHeaders,
  SensitiveDataFields,
} from './webhook.js';
