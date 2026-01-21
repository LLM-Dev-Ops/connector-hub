/**
 * Webhook Format Normalizer
 *
 * Normalizes webhook events (GitHub, Stripe, Slack, etc.) to canonical format.
 */

import type {
  ExternalEventInput,
  CanonicalEventType,
  FieldMapping,
  ExternalFormat,
} from '../types.js';
import { BaseNormalizer } from './base-normalizer.js';

/**
 * GitHub webhook normalizer
 */
export class GitHubWebhookNormalizer extends BaseNormalizer {
  readonly format: ExternalFormat = 'webhook_github';

  detectEventType(payload: unknown): CanonicalEventType {
    if (!payload || typeof payload !== 'object') {
      return 'unknown';
    }

    // GitHub webhooks always come with X-GitHub-Event header
    // But for payload analysis:
    const p = payload as Record<string, unknown>;

    if ('repository' in p || 'sender' in p || 'action' in p) {
      return 'webhook.validated';
    }

    return 'webhook.received';
  }

  getFieldMappings(): FieldMapping[] {
    return [
      { source_path: 'action', target_path: 'event.action' },
      { source_path: 'repository.id', target_path: 'repository.id' },
      { source_path: 'repository.name', target_path: 'repository.name' },
      { source_path: 'repository.full_name', target_path: 'repository.full_name' },
      { source_path: 'repository.owner.login', target_path: 'repository.owner' },
      { source_path: 'sender.id', target_path: 'sender.id' },
      { source_path: 'sender.login', target_path: 'sender.login' },
      { source_path: 'sender.type', target_path: 'sender.type' },
      { source_path: 'installation.id', target_path: 'installation.id' },

      // Pull request events
      { source_path: 'pull_request.id', target_path: 'pull_request.id' },
      { source_path: 'pull_request.number', target_path: 'pull_request.number' },
      { source_path: 'pull_request.title', target_path: 'pull_request.title' },
      { source_path: 'pull_request.state', target_path: 'pull_request.state' },
      { source_path: 'pull_request.merged', target_path: 'pull_request.merged' },

      // Push events
      { source_path: 'ref', target_path: 'push.ref' },
      { source_path: 'before', target_path: 'push.before' },
      { source_path: 'after', target_path: 'push.after' },
      { source_path: 'commits', target_path: 'push.commits' },

      // Issue events
      { source_path: 'issue.id', target_path: 'issue.id' },
      { source_path: 'issue.number', target_path: 'issue.number' },
      { source_path: 'issue.title', target_path: 'issue.title' },
      { source_path: 'issue.state', target_path: 'issue.state' },
    ];
  }

  protected getSystemName(input: ExternalEventInput): string {
    const eventType = input.headers?.['x-github-event'] ?? 'unknown';
    return `github-${eventType}`;
  }
}

/**
 * Stripe webhook normalizer
 */
export class StripeWebhookNormalizer extends BaseNormalizer {
  readonly format: ExternalFormat = 'webhook_stripe';

  detectEventType(payload: unknown): CanonicalEventType {
    if (!payload || typeof payload !== 'object') {
      return 'unknown';
    }

    const p = payload as Record<string, unknown>;

    if (p['object'] === 'event' && 'type' in p && 'data' in p) {
      return 'webhook.validated';
    }

    return 'webhook.received';
  }

  getFieldMappings(): FieldMapping[] {
    return [
      { source_path: 'id', target_path: 'event.id', required: true },
      { source_path: 'object', target_path: 'event.object' },
      { source_path: 'type', target_path: 'event.type', required: true },
      { source_path: 'created', target_path: 'event.created', transformation: 'to_iso_date' },
      { source_path: 'livemode', target_path: 'event.livemode' },
      { source_path: 'api_version', target_path: 'event.api_version' },
      { source_path: 'data.object', target_path: 'resource' },
      { source_path: 'data.previous_attributes', target_path: 'previous_attributes' },

      // Common resource fields
      { source_path: 'data.object.id', target_path: 'resource.id' },
      { source_path: 'data.object.object', target_path: 'resource.type' },
      { source_path: 'data.object.amount', target_path: 'resource.amount' },
      { source_path: 'data.object.currency', target_path: 'resource.currency' },
      { source_path: 'data.object.status', target_path: 'resource.status' },
      { source_path: 'data.object.customer', target_path: 'resource.customer_id' },
    ];
  }

  protected getSystemName(input: ExternalEventInput): string {
    const payload = input.raw_payload as Record<string, unknown>;
    const eventType = payload['type'] as string ?? 'unknown';
    return `stripe-${eventType.replace(/\./g, '-')}`;
  }
}

/**
 * Slack webhook normalizer
 */
export class SlackWebhookNormalizer extends BaseNormalizer {
  readonly format: ExternalFormat = 'webhook_slack';

  detectEventType(payload: unknown): CanonicalEventType {
    if (!payload || typeof payload !== 'object') {
      return 'unknown';
    }

    const p = payload as Record<string, unknown>;

    // URL verification challenge
    if ('challenge' in p && p['type'] === 'url_verification') {
      return 'webhook.received';
    }

    // Event callback
    if (p['type'] === 'event_callback' && 'event' in p) {
      return 'webhook.validated';
    }

    // Slash command or interaction
    if ('command' in p || 'payload' in p) {
      return 'webhook.validated';
    }

    return 'webhook.received';
  }

  getFieldMappings(): FieldMapping[] {
    return [
      { source_path: 'type', target_path: 'event.type' },
      { source_path: 'token', target_path: 'event.token' },
      { source_path: 'team_id', target_path: 'team.id' },
      { source_path: 'api_app_id', target_path: 'app.id' },
      { source_path: 'event.type', target_path: 'event.event_type' },
      { source_path: 'event.user', target_path: 'event.user_id' },
      { source_path: 'event.channel', target_path: 'event.channel_id' },
      { source_path: 'event.text', target_path: 'event.text' },
      { source_path: 'event.ts', target_path: 'event.timestamp' },
      { source_path: 'event_id', target_path: 'event.id' },
      { source_path: 'event_time', target_path: 'event.time', transformation: 'to_iso_date' },

      // Slash command fields
      { source_path: 'command', target_path: 'command.name' },
      { source_path: 'text', target_path: 'command.text' },
      { source_path: 'user_id', target_path: 'user.id' },
      { source_path: 'user_name', target_path: 'user.name' },
      { source_path: 'channel_id', target_path: 'channel.id' },
      { source_path: 'channel_name', target_path: 'channel.name' },
    ];
  }

  protected getSystemName(input: ExternalEventInput): string {
    const payload = input.raw_payload as Record<string, unknown>;
    const event = payload['event'] as Record<string, unknown> | undefined;
    const eventType = event?.['type'] ?? payload['type'] ?? 'unknown';
    return `slack-${eventType}`;
  }
}

/**
 * Generic webhook normalizer
 */
export class GenericWebhookNormalizer extends BaseNormalizer {
  readonly format: ExternalFormat = 'webhook_generic';

  detectEventType(_payload: unknown): CanonicalEventType {
    return 'webhook.received';
  }

  getFieldMappings(): FieldMapping[] {
    // Generic mappings for common webhook patterns
    return [
      { source_path: 'id', target_path: 'event.id' },
      { source_path: 'event_id', target_path: 'event.id' },
      { source_path: 'type', target_path: 'event.type' },
      { source_path: 'event_type', target_path: 'event.type' },
      { source_path: 'event', target_path: 'event.type' },
      { source_path: 'action', target_path: 'event.action' },
      { source_path: 'timestamp', target_path: 'event.timestamp' },
      { source_path: 'created_at', target_path: 'event.created_at' },
      { source_path: 'data', target_path: 'data' },
      { source_path: 'payload', target_path: 'data' },
      { source_path: 'source', target_path: 'source' },
      { source_path: 'user_id', target_path: 'user.id' },
      { source_path: 'account_id', target_path: 'account.id' },
    ];
  }

  protected getSystemName(_input: ExternalEventInput): string {
    return 'generic-webhook';
  }
}

/**
 * Factory for creating webhook normalizers
 */
export function createWebhookNormalizer(format: ExternalFormat): BaseNormalizer {
  switch (format) {
    case 'webhook_github':
      return new GitHubWebhookNormalizer();
    case 'webhook_stripe':
      return new StripeWebhookNormalizer();
    case 'webhook_slack':
      return new SlackWebhookNormalizer();
    case 'webhook_generic':
      return new GenericWebhookNormalizer();
    default:
      throw new Error(`Unsupported webhook format: ${format}`);
  }
}
