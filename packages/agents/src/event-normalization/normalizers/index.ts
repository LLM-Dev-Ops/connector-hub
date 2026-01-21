/**
 * Normalizers Index
 *
 * Exports all format-specific normalizers and factory function.
 */

export { BaseNormalizer } from './base-normalizer.js';
export {
  OpenAINormalizer,
  AnthropicNormalizer,
  GoogleAINormalizer,
  AzureOpenAINormalizer,
  AWSBedrockNormalizer,
  createLLMNormalizer,
} from './llm-normalizer.js';
export {
  GitHubWebhookNormalizer,
  StripeWebhookNormalizer,
  SlackWebhookNormalizer,
  GenericWebhookNormalizer,
  createWebhookNormalizer,
} from './webhook-normalizer.js';

import type { ExternalFormat, IFormatNormalizer } from '../types.js';
import { createLLMNormalizer } from './llm-normalizer.js';
import { createWebhookNormalizer } from './webhook-normalizer.js';
import { BaseNormalizer } from './base-normalizer.js';

/**
 * Create a normalizer for the given format
 */
export function createNormalizer(format: ExternalFormat): IFormatNormalizer {
  // LLM formats
  const llmFormats: ExternalFormat[] = [
    'openai_api',
    'anthropic_api',
    'google_ai_api',
    'azure_openai_api',
    'aws_bedrock_api',
  ];

  if (llmFormats.includes(format)) {
    return createLLMNormalizer(format);
  }

  // Webhook formats
  const webhookFormats: ExternalFormat[] = [
    'webhook_github',
    'webhook_stripe',
    'webhook_slack',
    'webhook_generic',
  ];

  if (webhookFormats.includes(format)) {
    return createWebhookNormalizer(format);
  }

  // Default to generic normalizer for unsupported formats
  return new GenericNormalizer(format);
}

/**
 * Generic normalizer for unsupported formats
 */
class GenericNormalizer extends BaseNormalizer {
  readonly format: ExternalFormat;

  constructor(format: ExternalFormat) {
    super();
    this.format = format;
  }

  detectEventType(_payload: unknown): 'unknown' {
    return 'unknown';
  }

  getFieldMappings(): Array<{ source_path: string; target_path: string }> {
    return [];
  }

  protected getSystemName(_input: { format: ExternalFormat }): string {
    return `generic-${this.format}`;
  }
}
