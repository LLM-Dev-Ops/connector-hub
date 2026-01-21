#!/usr/bin/env node
/**
 * Connector Hub Agent CLI
 *
 * CLI interface for invoking agents directly.
 * Supports commands: ingest, connect, normalize, inspect
 *
 * DEPLOYMENT: CLI-invokable endpoint
 * EXECUTION: Deterministic, machine-readable output
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { WebhookListenerAgent } from '../webhook/index.js';
import { MockRuVectorClient } from '../services/ruvector-client.js';
import { TelemetryService } from '../services/telemetry.js';
import type { WebhookAgentConfig, WebhookRequest } from '../contracts/index.js';

const VERSION = '1.0.0';

/**
 * CLI output format
 */
interface CLIOutput {
  success: boolean;
  command: string;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
  timestamp: string;
}

/**
 * Print CLI output in JSON format
 */
function printOutput(output: CLIOutput): void {
  console.log(JSON.stringify(output, null, 2));
}

/**
 * Create the CLI program
 */
function createProgram(): Command {
  const program = new Command();

  program
    .name('connector-hub-agent')
    .description('LLM Connector Hub Agent CLI')
    .version(VERSION);

  // Ingest command - process a webhook payload
  program
    .command('ingest')
    .description('Process an inbound webhook payload')
    .requiredOption('-c, --config <path>', 'Path to agent configuration file')
    .option('-p, --payload <path>', 'Path to payload file (or use stdin)')
    .option('-H, --header <header...>', 'Add request header (format: "Name: Value")')
    .option('--method <method>', 'HTTP method', 'POST')
    .option('--path <path>', 'Request path', '/webhook')
    .option('--source-ip <ip>', 'Source IP address')
    .option('--dry-run', 'Do not persist to ruvector-service', false)
    .action(async (options) => {
      try {
        // Load configuration
        const configPath = path.resolve(options.config);
        const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const config: WebhookAgentConfig = configData;

        // Load payload
        let payload: string;
        if (options.payload) {
          payload = fs.readFileSync(path.resolve(options.payload), 'utf8');
        } else {
          // Read from stdin
          payload = fs.readFileSync(0, 'utf8');
        }

        // Parse headers
        const headers: Record<string, string> = {
          'content-type': 'application/json',
        };
        if (options.header) {
          for (const h of options.header as string[]) {
            const [name, ...valueParts] = h.split(':');
            if (name && valueParts.length > 0) {
              headers[name.trim().toLowerCase()] = valueParts.join(':').trim();
            }
          }
        }

        // Create webhook request
        const request: WebhookRequest = {
          method: options.method as 'POST' | 'PUT' | 'PATCH',
          path: options.path,
          headers,
          body: payload,
          source_ip: options.sourceIp,
          received_at: new Date().toISOString(),
          content_type: headers['content-type'] || 'application/json',
        };

        // Create agent
        const ruvectorClient = options.dryRun ? new MockRuVectorClient() : undefined;
        const telemetry = new TelemetryService({
          serviceName: 'cli',
          logLevel: 'error', // Suppress logs in CLI mode
        });

        const agent = new WebhookListenerAgent(config, {
          ruvectorClient,
          telemetry,
        });

        await agent.initialize();
        const response = await agent.process(request);
        await agent.shutdown();

        printOutput({
          success: response.status === 'success',
          command: 'ingest',
          result: response,
          timestamp: new Date().toISOString(),
        });

        process.exit(response.status === 'success' ? 0 : 1);
      } catch (error) {
        printOutput({
          success: false,
          command: 'ingest',
          error: {
            code: 'CLI_ERROR',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
          timestamp: new Date().toISOString(),
        });
        process.exit(1);
      }
    });

  // Inspect command - inspect agent configuration
  program
    .command('inspect')
    .description('Inspect agent configuration and capabilities')
    .requiredOption('-c, --config <path>', 'Path to agent configuration file')
    .action(async (options) => {
      try {
        const configPath = path.resolve(options.config);
        const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        const inspection = {
          agent_id: `webhook-listener-${configData.connector_id}`,
          version: VERSION,
          decision_type: 'webhook_ingest_event',
          config: {
            connector_id: configData.connector_id,
            connector_scope: configData.connector_scope,
            signature_method: configData.signature?.method || 'none',
            allowed_content_types: configData.allowed_content_types || ['application/json'],
            rate_limit_enabled: configData.rate_limit_enabled ?? true,
            rate_limit_rpm: configData.rate_limit_rpm || 100,
            max_payload_bytes: configData.max_payload_bytes || 10485760,
            timeout_ms: configData.timeout_ms || 30000,
          },
          capabilities: {
            signature_verification: ['hmac_sha256', 'hmac_sha512', 'jwt_hs256', 'jwt_rs256', 'api_key', 'basic_auth', 'none'],
            content_types: configData.allowed_content_types || ['application/json'],
            replay_protection: configData.replay_protection ?? true,
          },
          non_responsibilities: [
            'Does NOT modify internal execution behavior',
            'Does NOT trigger workflows or retries',
            'Does NOT enforce governance or business policies',
            'Does NOT execute other agents',
            'Does NOT apply optimizations',
            'Does NOT emit analytical or anomaly signals',
          ],
        };

        printOutput({
          success: true,
          command: 'inspect',
          result: inspection,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        printOutput({
          success: false,
          command: 'inspect',
          error: {
            code: 'CLI_ERROR',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
          timestamp: new Date().toISOString(),
        });
        process.exit(1);
      }
    });

  // Normalize command - normalize a payload without full processing
  program
    .command('normalize')
    .description('Normalize a payload without signature verification or persistence')
    .option('-p, --payload <path>', 'Path to payload file (or use stdin)')
    .option('--connector-id <id>', 'Connector identifier', 'cli')
    .action(async (options) => {
      try {
        let payload: string;
        if (options.payload) {
          payload = fs.readFileSync(path.resolve(options.payload), 'utf8');
        } else {
          payload = fs.readFileSync(0, 'utf8');
        }

        let parsedPayload: Record<string, unknown>;
        try {
          parsedPayload = JSON.parse(payload);
        } catch {
          parsedPayload = { raw: payload };
        }

        // Extract common identifiers
        const identifiers: Record<string, string> = {};
        if (parsedPayload['correlation_id'] || parsedPayload['correlationId']) {
          identifiers['correlation_id'] = String(parsedPayload['correlation_id'] || parsedPayload['correlationId']);
        }
        if (parsedPayload['idempotency_key'] || parsedPayload['idempotencyKey']) {
          identifiers['idempotency_key'] = String(parsedPayload['idempotency_key'] || parsedPayload['idempotencyKey']);
        }
        if (parsedPayload['external_id'] || parsedPayload['externalId'] || parsedPayload['id']) {
          identifiers['external_id'] = String(parsedPayload['external_id'] || parsedPayload['externalId'] || parsedPayload['id']);
        }

        // Detect event type
        let eventType: string | undefined;
        if (parsedPayload['event_type'] || parsedPayload['eventType'] || parsedPayload['type']) {
          eventType = String(parsedPayload['event_type'] || parsedPayload['eventType'] || parsedPayload['type']);
        }

        const normalized = {
          source_id: options.connectorId,
          event_type: eventType,
          payload: parsedPayload,
          identifiers: Object.keys(identifiers).length > 0 ? identifiers : undefined,
        };

        printOutput({
          success: true,
          command: 'normalize',
          result: normalized,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        printOutput({
          success: false,
          command: 'normalize',
          error: {
            code: 'CLI_ERROR',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
          timestamp: new Date().toISOString(),
        });
        process.exit(1);
      }
    });

  // Connect command - test connectivity to ruvector-service
  program
    .command('connect')
    .description('Test connectivity to ruvector-service')
    .option('--endpoint <url>', 'RuVector service endpoint', process.env['RUVECTOR_SERVICE_URL'] || 'http://localhost:8080')
    .option('--timeout <ms>', 'Connection timeout in milliseconds', '5000')
    .action(async (options) => {
      try {
        const { RuVectorClient } = await import('../services/ruvector-client.js');
        const client = new RuVectorClient({
          endpoint: options.endpoint,
          timeoutMs: parseInt(options.timeout, 10),
        });

        const healthy = await client.healthCheck();

        printOutput({
          success: healthy,
          command: 'connect',
          result: {
            endpoint: options.endpoint,
            healthy,
          },
          timestamp: new Date().toISOString(),
        });

        process.exit(healthy ? 0 : 1);
      } catch (error) {
        printOutput({
          success: false,
          command: 'connect',
          error: {
            code: 'CONNECTION_ERROR',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
          timestamp: new Date().toISOString(),
        });
        process.exit(1);
      }
    });

  // Generate config command
  program
    .command('generate-config')
    .description('Generate a sample agent configuration file')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--connector-id <id>', 'Connector identifier', 'my-connector')
    .option('--connector-scope <scope>', 'Connector scope', 'webhook')
    .option('--signature-method <method>', 'Signature verification method', 'hmac_sha256')
    .action(async (options) => {
      const config: WebhookAgentConfig = {
        connector_id: options.connectorId,
        connector_scope: options.connectorScope,
        debug: false,
        timeout_ms: 30000,
        max_payload_bytes: 10485760,
        telemetry_enabled: true,
        signature: {
          method: options.signatureMethod as 'hmac_sha256',
          header_name: 'X-Webhook-Signature',
          secret_key: 'YOUR_SECRET_KEY_HERE',
          timestamp_tolerance_seconds: 300,
          timestamp_header: 'X-Webhook-Timestamp',
          api_key_header: 'X-API-Key',
        },
        allowed_content_types: ['application/json'],
        replay_protection: true,
        rate_limit_enabled: true,
        rate_limit_rpm: 100,
      };

      const output = JSON.stringify(config, null, 2);

      if (options.output) {
        fs.writeFileSync(path.resolve(options.output), output);
        console.error(`Configuration written to ${options.output}`);
      } else {
        console.log(output);
      }
    });

  return program;
}

// Main entry point
const program = createProgram();
program.parse();
