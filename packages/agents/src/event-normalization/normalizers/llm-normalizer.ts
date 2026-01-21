/**
 * LLM Format Normalizer
 *
 * Normalizes LLM API events (OpenAI, Anthropic, Google, etc.) to canonical format.
 */

import type {
  ExternalEventInput,
  CanonicalEventType,
  FieldMapping,
  ExternalFormat,
} from '../types.js';
import { BaseNormalizer } from './base-normalizer.js';

/**
 * OpenAI API normalizer
 */
export class OpenAINormalizer extends BaseNormalizer {
  readonly format: ExternalFormat = 'openai_api';

  detectEventType(payload: unknown): CanonicalEventType {
    if (!payload || typeof payload !== 'object') {
      return 'unknown';
    }

    const p = payload as Record<string, unknown>;

    // Response detection
    if ('choices' in p && 'usage' in p) {
      return 'llm.response';
    }

    // Request detection
    if ('model' in p && 'messages' in p) {
      return 'llm.request';
    }

    // Stream chunk detection
    if ('choices' in p && Array.isArray(p['choices'])) {
      const choices = p['choices'] as Array<Record<string, unknown>>;
      if (choices[0]?.['delta']) {
        return 'llm.stream_chunk';
      }
    }

    // Error detection
    if ('error' in p) {
      return 'llm.error';
    }

    return 'unknown';
  }

  getFieldMappings(): FieldMapping[] {
    return [
      // Request mappings
      { source_path: 'model', target_path: 'model', required: true },
      { source_path: 'messages', target_path: 'messages', required: true },
      { source_path: 'temperature', target_path: 'parameters.temperature' },
      { source_path: 'max_tokens', target_path: 'parameters.max_tokens' },
      { source_path: 'top_p', target_path: 'parameters.top_p' },
      { source_path: 'stop', target_path: 'parameters.stop_sequences' },
      { source_path: 'stream', target_path: 'parameters.stream' },
      { source_path: 'tools', target_path: 'tools' },
      { source_path: 'functions', target_path: 'functions' },

      // Response mappings
      { source_path: 'id', target_path: 'response.id' },
      { source_path: 'object', target_path: 'response.object' },
      { source_path: 'created', target_path: 'response.created', transformation: 'to_iso_date' },
      { source_path: 'choices', target_path: 'response.choices' },
      { source_path: 'usage.prompt_tokens', target_path: 'response.usage.prompt_tokens' },
      { source_path: 'usage.completion_tokens', target_path: 'response.usage.completion_tokens' },
      { source_path: 'usage.total_tokens', target_path: 'response.usage.total_tokens' },

      // Error mappings
      { source_path: 'error.message', target_path: 'error.message' },
      { source_path: 'error.type', target_path: 'error.type' },
      { source_path: 'error.code', target_path: 'error.code' },
    ];
  }

  protected getSystemName(_input: ExternalEventInput): string {
    return 'openai';
  }
}

/**
 * Anthropic API normalizer
 */
export class AnthropicNormalizer extends BaseNormalizer {
  readonly format: ExternalFormat = 'anthropic_api';

  detectEventType(payload: unknown): CanonicalEventType {
    if (!payload || typeof payload !== 'object') {
      return 'unknown';
    }

    const p = payload as Record<string, unknown>;

    // Response detection
    if ('content' in p && 'stop_reason' in p) {
      return 'llm.response';
    }

    // Request detection
    if ('model' in p && 'messages' in p && 'max_tokens' in p) {
      return 'llm.request';
    }

    // Stream chunk detection (content_block_delta)
    if ('type' in p && p['type'] === 'content_block_delta') {
      return 'llm.stream_chunk';
    }

    // Error detection
    if ('type' in p && p['type'] === 'error') {
      return 'llm.error';
    }

    return 'unknown';
  }

  getFieldMappings(): FieldMapping[] {
    return [
      // Request mappings
      { source_path: 'model', target_path: 'model', required: true },
      { source_path: 'messages', target_path: 'messages', required: true },
      { source_path: 'system', target_path: 'system_message' },
      { source_path: 'max_tokens', target_path: 'parameters.max_tokens', required: true },
      { source_path: 'temperature', target_path: 'parameters.temperature' },
      { source_path: 'top_p', target_path: 'parameters.top_p' },
      { source_path: 'top_k', target_path: 'parameters.top_k' },
      { source_path: 'stop_sequences', target_path: 'parameters.stop_sequences' },
      { source_path: 'tools', target_path: 'tools' },

      // Response mappings
      { source_path: 'id', target_path: 'response.id' },
      { source_path: 'type', target_path: 'response.type' },
      { source_path: 'role', target_path: 'response.role' },
      { source_path: 'content', target_path: 'response.content' },
      { source_path: 'stop_reason', target_path: 'response.stop_reason' },
      { source_path: 'usage.input_tokens', target_path: 'response.usage.prompt_tokens' },
      { source_path: 'usage.output_tokens', target_path: 'response.usage.completion_tokens' },

      // Error mappings
      { source_path: 'error.message', target_path: 'error.message' },
      { source_path: 'error.type', target_path: 'error.type' },
    ];
  }

  protected getSystemName(_input: ExternalEventInput): string {
    return 'anthropic';
  }
}

/**
 * Google AI API normalizer
 */
export class GoogleAINormalizer extends BaseNormalizer {
  readonly format: ExternalFormat = 'google_ai_api';

  detectEventType(payload: unknown): CanonicalEventType {
    if (!payload || typeof payload !== 'object') {
      return 'unknown';
    }

    const p = payload as Record<string, unknown>;

    // Response detection
    if ('candidates' in p) {
      return 'llm.response';
    }

    // Request detection
    if ('contents' in p) {
      return 'llm.request';
    }

    // Error detection
    if ('error' in p) {
      return 'llm.error';
    }

    return 'unknown';
  }

  getFieldMappings(): FieldMapping[] {
    return [
      // Request mappings
      { source_path: 'contents', target_path: 'messages', required: true },
      { source_path: 'generationConfig.temperature', target_path: 'parameters.temperature' },
      { source_path: 'generationConfig.maxOutputTokens', target_path: 'parameters.max_tokens' },
      { source_path: 'generationConfig.topP', target_path: 'parameters.top_p' },
      { source_path: 'generationConfig.topK', target_path: 'parameters.top_k' },
      { source_path: 'generationConfig.stopSequences', target_path: 'parameters.stop_sequences' },
      { source_path: 'tools', target_path: 'tools' },

      // Response mappings
      { source_path: 'candidates', target_path: 'response.choices' },
      { source_path: 'usageMetadata.promptTokenCount', target_path: 'response.usage.prompt_tokens' },
      { source_path: 'usageMetadata.candidatesTokenCount', target_path: 'response.usage.completion_tokens' },
      { source_path: 'usageMetadata.totalTokenCount', target_path: 'response.usage.total_tokens' },

      // Error mappings
      { source_path: 'error.message', target_path: 'error.message' },
      { source_path: 'error.code', target_path: 'error.code' },
    ];
  }

  protected getSystemName(_input: ExternalEventInput): string {
    return 'google-ai';
  }
}

/**
 * Azure OpenAI API normalizer
 */
export class AzureOpenAINormalizer extends OpenAINormalizer {
  override readonly format: ExternalFormat = 'azure_openai_api';

  override getFieldMappings(): FieldMapping[] {
    const baseMappings = super.getFieldMappings();
    return [
      ...baseMappings,
      // Azure-specific mappings
      { source_path: 'prompt_filter_results', target_path: 'azure.content_filter.prompt' },
      { source_path: 'choices.0.content_filter_results', target_path: 'azure.content_filter.completion' },
    ];
  }

  protected override getSystemName(_input: ExternalEventInput): string {
    return 'azure-openai';
  }
}

/**
 * AWS Bedrock API normalizer
 */
export class AWSBedrockNormalizer extends BaseNormalizer {
  readonly format: ExternalFormat = 'aws_bedrock_api';

  detectEventType(payload: unknown): CanonicalEventType {
    if (!payload || typeof payload !== 'object') {
      return 'unknown';
    }

    const p = payload as Record<string, unknown>;

    // Anthropic on Bedrock response
    if ('content' in p && 'stop_reason' in p) {
      return 'llm.response';
    }

    // Anthropic on Bedrock request
    if ('anthropic_version' in p && 'messages' in p) {
      return 'llm.request';
    }

    // Titan/Llama response
    if ('results' in p || 'generation' in p) {
      return 'llm.response';
    }

    // Error detection
    if ('message' in p && ('__type' in p || 'error' in p)) {
      return 'llm.error';
    }

    return 'unknown';
  }

  getFieldMappings(): FieldMapping[] {
    return [
      // Anthropic on Bedrock mappings
      { source_path: 'messages', target_path: 'messages' },
      { source_path: 'anthropic_version', target_path: 'parameters.anthropic_version' },
      { source_path: 'max_tokens', target_path: 'parameters.max_tokens' },
      { source_path: 'temperature', target_path: 'parameters.temperature' },
      { source_path: 'system', target_path: 'system_message' },

      // Response mappings
      { source_path: 'id', target_path: 'response.id' },
      { source_path: 'content', target_path: 'response.content' },
      { source_path: 'stop_reason', target_path: 'response.stop_reason' },
      { source_path: 'usage.input_tokens', target_path: 'response.usage.prompt_tokens' },
      { source_path: 'usage.output_tokens', target_path: 'response.usage.completion_tokens' },

      // Titan/Llama mappings
      { source_path: 'results', target_path: 'response.results' },
      { source_path: 'generation', target_path: 'response.generation' },
      { source_path: 'prompt_token_count', target_path: 'response.usage.prompt_tokens' },
      { source_path: 'generation_token_count', target_path: 'response.usage.completion_tokens' },

      // Error mappings
      { source_path: 'message', target_path: 'error.message' },
      { source_path: '__type', target_path: 'error.type' },
    ];
  }

  protected getSystemName(_input: ExternalEventInput): string {
    return 'aws-bedrock';
  }
}

/**
 * Factory for creating LLM normalizers
 */
export function createLLMNormalizer(format: ExternalFormat): BaseNormalizer {
  switch (format) {
    case 'openai_api':
      return new OpenAINormalizer();
    case 'anthropic_api':
      return new AnthropicNormalizer();
    case 'google_ai_api':
      return new GoogleAINormalizer();
    case 'azure_openai_api':
      return new AzureOpenAINormalizer();
    case 'aws_bedrock_api':
      return new AWSBedrockNormalizer();
    default:
      throw new Error(`Unsupported LLM format: ${format}`);
  }
}
