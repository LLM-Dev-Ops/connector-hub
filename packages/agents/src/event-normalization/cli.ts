/**
 * CLI Interface for Event Normalization Agent
 *
 * Provides CLI-invokable endpoints for the Event Normalization Agent.
 *
 * Commands:
 * - normalize - Normalize an external event
 * - inspect - Inspect normalization without persistence
 *
 * USAGE:
 *   connector-hub-agents event-normalization normalize --format openai_api --input payload.json
 *   connector-hub-agents event-normalization inspect --format webhook_github --input event.json
 *   cat event.json | connector-hub-agents event-normalization normalize --format anthropic_api
 */

import { createNormalizer } from './normalizers/index.js';
import { ExternalEventInputSchema, NormalizationConfigSchema } from './types.js';
import type { ExternalFormat, NormalizationConfig } from './types.js';
import { z } from 'zod';
import * as fs from 'fs';

/**
 * CLI command definition
 */
export interface CLICommand {
  name: string;
  description: string;
  options: Array<{
    flag: string;
    description: string;
    required?: boolean;
    default?: string;
  }>;
  action: (args: Record<string, string | undefined>) => Promise<void>;
}

/**
 * CLI output format
 */
export type OutputFormat = 'json' | 'yaml' | 'table';

/**
 * Parse CLI arguments
 */
export function parseArgs(argv: string[]): Record<string, string | undefined> {
  const args: Record<string, string | undefined> = {};
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];
    if (arg?.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = argv[i + 1];
      if (nextArg && !nextArg.startsWith('--')) {
        args[key] = nextArg;
        i += 2;
      } else {
        args[key] = 'true';
        i += 1;
      }
    } else if (arg?.startsWith('-')) {
      const key = arg.slice(1);
      const nextArg = argv[i + 1];
      if (nextArg && !nextArg.startsWith('-')) {
        args[key] = nextArg;
        i += 2;
      } else {
        args[key] = 'true';
        i += 1;
      }
    } else {
      // Positional argument
      args['_'] = arg;
      i += 1;
    }
  }

  return args;
}

/**
 * Read input from file or stdin
 */
async function readInput(inputPath: string | undefined): Promise<unknown> {
  if (inputPath && inputPath !== '-') {
    const content = fs.readFileSync(inputPath, 'utf-8');
    return JSON.parse(content);
  }

  // Read from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  const content = Buffer.concat(chunks).toString('utf-8');
  return JSON.parse(content);
}

/**
 * Format output
 */
function formatOutput(data: unknown, format: OutputFormat): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2);
    case 'yaml':
      // Simple YAML serialization (basic implementation)
      return toYAML(data);
    case 'table':
      return toTable(data);
    default:
      return JSON.stringify(data, null, 2);
  }
}

/**
 * Simple YAML conversion
 */
function toYAML(data: unknown, indent = 0): string {
  const spaces = '  '.repeat(indent);

  if (data === null || data === undefined) {
    return 'null';
  }

  if (typeof data === 'string') {
    return data.includes('\n') ? `|\n${spaces}  ${data.split('\n').join(`\n${spaces}  `)}` : data;
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return String(data);
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return '[]';
    return data.map(item => `${spaces}- ${toYAML(item, indent + 1).trimStart()}`).join('\n');
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data);
    if (entries.length === 0) return '{}';
    return entries
      .map(([key, value]) => {
        const valueStr = toYAML(value, indent + 1);
        if (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 0) {
          return `${spaces}${key}:\n${valueStr}`;
        }
        return `${spaces}${key}: ${valueStr}`;
      })
      .join('\n');
  }

  return String(data);
}

/**
 * Simple table conversion for metrics
 */
function toTable(data: unknown): string {
  if (typeof data !== 'object' || data === null) {
    return String(data);
  }

  const lines: string[] = [];
  const d = data as Record<string, unknown>;

  if ('metrics' in d && typeof d['metrics'] === 'object' && d['metrics'] !== null) {
    const metrics = d['metrics'] as Record<string, unknown>;
    lines.push('Metrics:');
    lines.push('--------');
    for (const [key, value] of Object.entries(metrics)) {
      lines.push(`  ${key}: ${value}`);
    }
  }

  if ('normalized_event' in d && typeof d['normalized_event'] === 'object') {
    const event = d['normalized_event'] as Record<string, unknown>;
    lines.push('');
    lines.push('Normalized Event:');
    lines.push('-----------------');
    lines.push(`  ID: ${event['id']}`);
    lines.push(`  Type: ${event['type']}`);
    lines.push(`  Timestamp: ${event['timestamp']}`);
    if (event['validation'] && typeof event['validation'] === 'object') {
      const validation = event['validation'] as Record<string, unknown>;
      lines.push(`  Validated: ${validation['validated']}`);
    }
  }

  return lines.join('\n');
}

/**
 * Normalize command
 */
export const normalizeCommand: CLICommand = {
  name: 'normalize',
  description: 'Normalize an external event to canonical format',
  options: [
    { flag: '--format', description: 'Source format (e.g., openai_api, webhook_github)', required: true },
    { flag: '--input', description: 'Input file path (use - for stdin)', default: '-' },
    { flag: '--output', description: 'Output format (json, yaml, table)', default: 'json' },
    { flag: '--strict', description: 'Enable strict validation' },
    { flag: '--no-mappings', description: 'Exclude field mappings from output' },
    { flag: '--no-dropped', description: 'Exclude dropped fields from output' },
  ],
  action: async (args) => {
    const format = args['format'];
    if (!format) {
      console.error('Error: --format is required');
      process.exit(1);
    }

    // Validate format
    const formatResult = z.enum([
      'openai_api',
      'anthropic_api',
      'google_ai_api',
      'azure_openai_api',
      'aws_bedrock_api',
      'webhook_github',
      'webhook_stripe',
      'webhook_slack',
      'webhook_generic',
      'erp_salesforce',
      'erp_sap',
      'erp_dynamics',
      'database_postgres',
      'database_mysql',
      'database_mongodb',
      'auth_oauth2',
      'auth_saml',
      'auth_oidc',
      'custom',
    ]).safeParse(format);

    if (!formatResult.success) {
      console.error(`Error: Invalid format '${format}'`);
      console.error('Valid formats:', formatResult.error.errors);
      process.exit(1);
    }

    try {
      // Read input
      const rawPayload = await readInput(args['input']);

      // Build event input
      const eventInput = {
        format: formatResult.data as ExternalFormat,
        raw_payload: rawPayload,
        received_at: new Date().toISOString(),
      };

      // Build config
      const config: NormalizationConfig = {
        strict_validation: args['strict'] === 'true',
        max_payload_bytes: 10 * 1024 * 1024,
        include_dropped_fields: args['no-dropped'] !== 'true',
        include_field_mappings: args['no-mappings'] !== 'true',
      };

      // Create normalizer and normalize
      const normalizer = createNormalizer(formatResult.data as ExternalFormat);
      const normalizedEvent = await normalizer.normalize(eventInput, config);

      // Output result
      const outputFormat = (args['output'] ?? 'json') as OutputFormat;
      const output = formatOutput(
        {
          status: 'success',
          normalized_event: normalizedEvent,
          metrics: {
            processing_time_ms: normalizedEvent.normalization.processing_time_ms,
            field_mappings_applied: normalizedEvent.normalization.field_mappings.length,
            fields_dropped: normalizedEvent.normalization.dropped_fields?.length ?? 0,
            warnings_count: normalizedEvent.normalization.warnings?.length ?? 0,
          },
        },
        outputFormat
      );

      console.log(output);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
};

/**
 * Inspect command
 */
export const inspectCommand: CLICommand = {
  name: 'inspect',
  description: 'Inspect normalization without persistence',
  options: [
    { flag: '--format', description: 'Source format', required: true },
    { flag: '--input', description: 'Input file path (use - for stdin)', default: '-' },
    { flag: '--output', description: 'Output format (json, yaml, table)', default: 'json' },
    { flag: '--show-mappings', description: 'Show available field mappings' },
  ],
  action: async (args) => {
    const format = args['format'];
    if (!format) {
      console.error('Error: --format is required');
      process.exit(1);
    }

    try {
      const normalizer = createNormalizer(format as ExternalFormat);

      if (args['show-mappings'] === 'true') {
        // Just show field mappings
        const mappings = normalizer.getFieldMappings();
        console.log(formatOutput({ format, field_mappings: mappings }, (args['output'] ?? 'json') as OutputFormat));
        return;
      }

      // Read and inspect input
      const rawPayload = await readInput(args['input']);

      const eventInput = {
        format: format as ExternalFormat,
        raw_payload: rawPayload,
        received_at: new Date().toISOString(),
      };

      const config: NormalizationConfig = {
        strict_validation: false,
        max_payload_bytes: 10 * 1024 * 1024,
        include_dropped_fields: true,
        include_field_mappings: true,
      };

      const normalizedEvent = await normalizer.normalize(eventInput, config);
      const detectedType = normalizer.detectEventType(rawPayload);

      const output = formatOutput(
        {
          status: 'success',
          detected_type: detectedType,
          normalized_event: normalizedEvent,
          field_mappings: normalizer.getFieldMappings(),
        },
        (args['output'] ?? 'json') as OutputFormat
      );

      console.log(output);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
};

/**
 * Help command
 */
export const helpCommand: CLICommand = {
  name: 'help',
  description: 'Show help information',
  options: [],
  action: async () => {
    console.log(`
Event Normalization Agent CLI

USAGE:
  connector-hub-agents event-normalization <command> [options]

COMMANDS:
  normalize   Normalize an external event to canonical format
  inspect     Inspect normalization without persistence
  help        Show this help message

EXAMPLES:
  # Normalize an OpenAI API response
  connector-hub-agents event-normalization normalize --format openai_api --input response.json

  # Normalize from stdin
  cat webhook.json | connector-hub-agents event-normalization normalize --format webhook_github

  # Inspect without persistence
  connector-hub-agents event-normalization inspect --format anthropic_api --input payload.json

  # Show available field mappings for a format
  connector-hub-agents event-normalization inspect --format openai_api --show-mappings

SUPPORTED FORMATS:
  LLM APIs:
    - openai_api
    - anthropic_api
    - google_ai_api
    - azure_openai_api
    - aws_bedrock_api

  Webhooks:
    - webhook_github
    - webhook_stripe
    - webhook_slack
    - webhook_generic

  ERP:
    - erp_salesforce
    - erp_sap
    - erp_dynamics

  Databases:
    - database_postgres
    - database_mysql
    - database_mongodb

  Auth:
    - auth_oauth2
    - auth_saml
    - auth_oidc

  Other:
    - custom
`);
  },
};

/**
 * CLI entry point
 */
export async function runCLI(argv: string[]): Promise<void> {
  const args = parseArgs(argv.slice(2)); // Skip node and script name
  const command = args['_'] ?? 'help';

  const commands: Record<string, CLICommand> = {
    normalize: normalizeCommand,
    inspect: inspectCommand,
    help: helpCommand,
  };

  const cmd = commands[command];
  if (!cmd) {
    console.error(`Unknown command: ${command}`);
    console.error('Run "connector-hub-agents event-normalization help" for usage');
    process.exit(1);
  }

  await cmd.action(args);
}

// Run CLI if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI(process.argv).catch(console.error);
}
