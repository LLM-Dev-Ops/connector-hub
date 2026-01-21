/**
 * Event Normalization Agent - Normalizer Tests
 *
 * Tests for format-specific normalizers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createNormalizer,
  OpenAINormalizer,
  AnthropicNormalizer,
  GitHubWebhookNormalizer,
  StripeWebhookNormalizer,
} from '../normalizers/index.js';
import type { ExternalEventInput, NormalizationConfig } from '../types.js';

const defaultConfig: NormalizationConfig = {
  strict_validation: false,
  max_payload_bytes: 10 * 1024 * 1024,
  include_dropped_fields: true,
  include_field_mappings: true,
};

describe('OpenAI Normalizer', () => {
  let normalizer: OpenAINormalizer;

  beforeEach(() => {
    normalizer = new OpenAINormalizer();
  });

  it('should detect LLM request event type', () => {
    const payload = {
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'Hello' },
      ],
    };

    expect(normalizer.detectEventType(payload)).toBe('llm.request');
  });

  it('should detect LLM response event type', () => {
    const payload = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: 1677652288,
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello!' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    };

    expect(normalizer.detectEventType(payload)).toBe('llm.response');
  });

  it('should detect LLM error event type', () => {
    const payload = {
      error: {
        message: 'Invalid API key',
        type: 'authentication_error',
        code: 'invalid_api_key',
      },
    };

    expect(normalizer.detectEventType(payload)).toBe('llm.error');
  });

  it('should normalize OpenAI request', async () => {
    const input: ExternalEventInput = {
      format: 'openai_api',
      raw_payload: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
        max_tokens: 100,
      },
      received_at: new Date().toISOString(),
    };

    const result = await normalizer.normalize(input, defaultConfig);

    expect(result.type).toBe('llm.request');
    expect(result.source.format).toBe('openai_api');
    expect(result.source.system).toBe('openai');
    expect(result.data['model']).toBe('gpt-4');
    expect(result.data['messages']).toEqual([{ role: 'user', content: 'Hello' }]);
    expect((result.data['parameters'] as Record<string, unknown>)?.['temperature']).toBe(0.7);
  });

  it('should normalize OpenAI response', async () => {
    const input: ExternalEventInput = {
      format: 'openai_api',
      raw_payload: {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      },
      received_at: new Date().toISOString(),
    };

    const result = await normalizer.normalize(input, defaultConfig);

    expect(result.type).toBe('llm.response');
    expect(result.validation.validated).toBe(true);
    expect(result.normalization.field_mappings.length).toBeGreaterThan(0);
  });
});

describe('Anthropic Normalizer', () => {
  let normalizer: AnthropicNormalizer;

  beforeEach(() => {
    normalizer = new AnthropicNormalizer();
  });

  it('should detect LLM request event type', () => {
    const payload = {
      model: 'claude-3-opus-20240229',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
    };

    expect(normalizer.detectEventType(payload)).toBe('llm.request');
  });

  it('should detect LLM response event type', () => {
    const payload = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello!' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
      },
    };

    expect(normalizer.detectEventType(payload)).toBe('llm.response');
  });

  it('should normalize Anthropic request', async () => {
    const input: ExternalEventInput = {
      format: 'anthropic_api',
      raw_payload: {
        model: 'claude-3-opus-20240229',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
        system: 'You are a helpful assistant',
      },
      received_at: new Date().toISOString(),
    };

    const result = await normalizer.normalize(input, defaultConfig);

    expect(result.type).toBe('llm.request');
    expect(result.source.format).toBe('anthropic_api');
    expect(result.source.system).toBe('anthropic');
    expect(result.data['model']).toBe('claude-3-opus-20240229');
    expect(result.data['system_message']).toBe('You are a helpful assistant');
  });
});

describe('GitHub Webhook Normalizer', () => {
  let normalizer: GitHubWebhookNormalizer;

  beforeEach(() => {
    normalizer = new GitHubWebhookNormalizer();
  });

  it('should detect webhook event type', () => {
    const payload = {
      action: 'opened',
      repository: {
        id: 123,
        name: 'test-repo',
        full_name: 'owner/test-repo',
        owner: { login: 'owner', id: 1 },
      },
      sender: { login: 'user', id: 2 },
    };

    expect(normalizer.detectEventType(payload)).toBe('webhook.validated');
  });

  it('should normalize GitHub push event', async () => {
    const input: ExternalEventInput = {
      format: 'webhook_github',
      raw_payload: {
        ref: 'refs/heads/main',
        before: 'abc123',
        after: 'def456',
        repository: {
          id: 123,
          name: 'test-repo',
          full_name: 'owner/test-repo',
          owner: { login: 'owner', id: 1 },
        },
        sender: { login: 'user', id: 2 },
        commits: [
          { id: 'def456', message: 'Update README' },
        ],
      },
      headers: {
        'x-github-event': 'push',
      },
      received_at: new Date().toISOString(),
    };

    const result = await normalizer.normalize(input, defaultConfig);

    expect(result.type).toBe('webhook.validated');
    expect(result.source.format).toBe('webhook_github');
    expect(result.source.system).toBe('github-push');
    expect(result.data['push']?.['ref']).toBe('refs/heads/main');
  });

  it('should normalize GitHub pull request event', async () => {
    const input: ExternalEventInput = {
      format: 'webhook_github',
      raw_payload: {
        action: 'opened',
        pull_request: {
          id: 456,
          number: 1,
          title: 'Add feature',
          state: 'open',
          merged: false,
        },
        repository: {
          id: 123,
          name: 'test-repo',
          full_name: 'owner/test-repo',
          owner: { login: 'owner', id: 1 },
        },
        sender: { login: 'user', id: 2 },
      },
      headers: {
        'x-github-event': 'pull_request',
      },
      received_at: new Date().toISOString(),
    };

    const result = await normalizer.normalize(input, defaultConfig);

    expect(result.type).toBe('webhook.validated');
    expect(result.data['event']?.['action']).toBe('opened');
    expect(result.data['pull_request']?.['title']).toBe('Add feature');
  });
});

describe('Stripe Webhook Normalizer', () => {
  let normalizer: StripeWebhookNormalizer;

  beforeEach(() => {
    normalizer = new StripeWebhookNormalizer();
  });

  it('should detect Stripe event', () => {
    const payload = {
      id: 'evt_123',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_123',
          amount: 2000,
          currency: 'usd',
        },
      },
      livemode: false,
      created: 1677652288,
    };

    expect(normalizer.detectEventType(payload)).toBe('webhook.validated');
  });

  it('should normalize Stripe payment event', async () => {
    const input: ExternalEventInput = {
      format: 'webhook_stripe',
      raw_payload: {
        id: 'evt_123',
        object: 'event',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_123',
            object: 'payment_intent',
            amount: 2000,
            currency: 'usd',
            status: 'succeeded',
            customer: 'cus_123',
          },
        },
        livemode: false,
        created: 1677652288,
        api_version: '2023-10-16',
      },
      received_at: new Date().toISOString(),
    };

    const result = await normalizer.normalize(input, defaultConfig);

    expect(result.type).toBe('webhook.validated');
    expect(result.source.format).toBe('webhook_stripe');
    expect(result.data['event']?.['id']).toBe('evt_123');
    expect(result.data['event']?.['type']).toBe('payment_intent.succeeded');
    expect(result.data['resource']?.['amount']).toBe(2000);
  });
});

describe('createNormalizer factory', () => {
  it('should create OpenAI normalizer', () => {
    const normalizer = createNormalizer('openai_api');
    expect(normalizer.format).toBe('openai_api');
  });

  it('should create Anthropic normalizer', () => {
    const normalizer = createNormalizer('anthropic_api');
    expect(normalizer.format).toBe('anthropic_api');
  });

  it('should create GitHub webhook normalizer', () => {
    const normalizer = createNormalizer('webhook_github');
    expect(normalizer.format).toBe('webhook_github');
  });

  it('should create Stripe webhook normalizer', () => {
    const normalizer = createNormalizer('webhook_stripe');
    expect(normalizer.format).toBe('webhook_stripe');
  });

  it('should create generic normalizer for custom format', () => {
    const normalizer = createNormalizer('custom');
    expect(normalizer.format).toBe('custom');
  });
});

describe('Field Mapping', () => {
  it('should track applied field mappings', async () => {
    const normalizer = new OpenAINormalizer();
    const input: ExternalEventInput = {
      format: 'openai_api',
      raw_payload: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
      },
      received_at: new Date().toISOString(),
    };

    const result = await normalizer.normalize(input, defaultConfig);

    expect(result.normalization.field_mappings.length).toBeGreaterThan(0);
    expect(result.normalization.field_mappings.some(m => m.source_path === 'model')).toBe(true);
  });

  it('should track dropped fields', async () => {
    const normalizer = new OpenAINormalizer();
    const input: ExternalEventInput = {
      format: 'openai_api',
      raw_payload: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        custom_field: 'should be dropped',
        another_custom: 'also dropped',
      },
      received_at: new Date().toISOString(),
    };

    const result = await normalizer.normalize(input, defaultConfig);

    expect(result.normalization.dropped_fields).toBeDefined();
    expect(result.normalization.dropped_fields?.length).toBeGreaterThan(0);
    expect(result.normalization.dropped_fields?.includes('custom_field')).toBe(true);
  });

  it('should exclude dropped fields when configured', async () => {
    const normalizer = new OpenAINormalizer();
    const input: ExternalEventInput = {
      format: 'openai_api',
      raw_payload: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        custom_field: 'should be dropped',
      },
      received_at: new Date().toISOString(),
    };

    const config: NormalizationConfig = {
      ...defaultConfig,
      include_dropped_fields: false,
    };

    const result = await normalizer.normalize(input, config);

    expect(result.normalization.dropped_fields).toBeUndefined();
  });
});

describe('Validation', () => {
  it('should validate normalized events', async () => {
    const normalizer = new OpenAINormalizer();
    const input: ExternalEventInput = {
      format: 'openai_api',
      raw_payload: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      },
      received_at: new Date().toISOString(),
    };

    const result = await normalizer.normalize(input, defaultConfig);

    expect(result.validation.validated).toBe(true);
    expect(result.validation.validator_version).toBeDefined();
  });

  it('should fail validation for oversized payloads', async () => {
    const normalizer = new OpenAINormalizer();
    const largeContent = 'x'.repeat(100);
    const input: ExternalEventInput = {
      format: 'openai_api',
      raw_payload: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: largeContent }],
      },
      received_at: new Date().toISOString(),
    };

    const config: NormalizationConfig = {
      ...defaultConfig,
      max_payload_bytes: 50, // Very small limit for testing
    };

    const result = await normalizer.normalize(input, config);

    expect(result.validation.validated).toBe(false);
    expect(result.validation.errors?.some(e => e.code === 'PAYLOAD_TOO_LARGE')).toBe(true);
  });
});
