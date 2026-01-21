/**
 * Event Normalization Agent - Module Exports
 *
 * Purpose: Convert heterogeneous external events into canonical internal event formats.
 * Classification: EVENT NORMALIZATION / TRANSLATION
 * Decision Type: "normalized_event"
 */

// Agent
export {
  EventNormalizationAgent,
  createEventNormalizationAgent,
  EVENT_NORMALIZATION_AGENT_METADATA,
} from './agent.js';

// Handler (Google Cloud Function)
export {
  eventNormalizationHandler,
  handler,
} from './handler.js';

// CLI
export {
  runCLI,
  normalizeCommand,
  inspectCommand,
  helpCommand,
  parseArgs,
  type CLICommand,
  type OutputFormat,
} from './cli.js';

// Types
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
} from './types.js';

// Normalizers
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
} from './normalizers/index.js';
