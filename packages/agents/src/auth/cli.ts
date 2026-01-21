/**
 * CLI Command for Auth/Identity Agent
 *
 * Provides command-line interface for the Auth/Identity Agent.
 *
 * Usage:
 *   auth-agent verify <token> [options]
 *   auth-agent inspect <token>
 *   auth-agent validate <token> --method <method>
 */

import { createAuthAgent, AuthAgentConfig } from './auth-agent';
import {
  AuthAgentCLIArgs,
  AuthAgentCLIArgsSchema,
  AuthMethod,
} from '@llm-dev-ops/agentics-contracts';

/**
 * CLI output format
 */
type OutputFormat = 'json' | 'text' | 'minimal';

/**
 * CLI execution result
 */
interface CLIResult {
  exitCode: number;
  output: string;
}

/**
 * Parse CLI arguments
 */
export function parseArgs(args: string[]): AuthAgentCLIArgs {
  const parsed: Record<string, unknown> = {
    command: 'verify',
    credential: '',
    method: 'jwt',
    format: 'json',
    verbose: false,
  };

  // First positional arg is command
  if (args.length > 0 && !args[0]?.startsWith('--')) {
    parsed['command'] = args.shift();
  }

  // Second positional arg is credential
  if (args.length > 0 && !args[0]?.startsWith('--')) {
    parsed['credential'] = args.shift();
  }

  // Parse remaining flags
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--method' || arg === '-m') {
      parsed['method'] = args[++i];
    } else if (arg === '--issuer' || arg === '-i') {
      parsed['issuer'] = args[++i];
    } else if (arg === '--audience' || arg === '-a') {
      parsed['audience'] = args[++i];
    } else if (arg === '--scopes' || arg === '-s') {
      parsed['scopes'] = args[++i];
    } else if (arg === '--jwks') {
      parsed['jwks'] = args[++i];
    } else if (arg === '--format' || arg === '-f') {
      parsed['format'] = args[++i];
    } else if (arg === '--verbose' || arg === '-v') {
      parsed['verbose'] = true;
    }
  }

  return AuthAgentCLIArgsSchema.parse(parsed);
}

/**
 * Format output based on format option
 */
function formatOutput(
  data: Record<string, unknown>,
  format: OutputFormat,
  verbose: boolean
): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, verbose ? 2 : 0);

    case 'minimal':
      return data['authenticated'] ? 'AUTHENTICATED' : 'NOT_AUTHENTICATED';

    case 'text':
      return formatTextOutput(data, verbose);

    default:
      return JSON.stringify(data);
  }
}

/**
 * Format text output
 */
function formatTextOutput(data: Record<string, unknown>, verbose: boolean): string {
  const lines: string[] = [];

  lines.push(`Status: ${data['authenticated'] ? '✓ AUTHENTICATED' : '✗ NOT AUTHENTICATED'}`);
  lines.push(`Token Status: ${data['status']}`);

  if (data['confidence']) {
    const conf = data['confidence'] as Record<string, unknown>;
    lines.push(`Confidence: ${conf['level']} (${Math.round((conf['score'] as number) * 100)}%)`);
  }

  if (data['expires_at']) {
    lines.push(`Expires: ${data['expires_at']}`);
  }

  if (data['scopes'] && Array.isArray(data['scopes'])) {
    lines.push(`Scopes: ${(data['scopes'] as string[]).join(', ')}`);
  }

  if (verbose && data['claims']) {
    lines.push('\nClaims:');
    const claims = data['claims'] as Record<string, unknown>;
    for (const [key, value] of Object.entries(claims)) {
      if (value !== undefined) {
        lines.push(`  ${key}: ${JSON.stringify(value)}`);
      }
    }
  }

  if (data['warnings'] && Array.isArray(data['warnings']) && (data['warnings'] as string[]).length > 0) {
    lines.push('\nWarnings:');
    for (const warning of data['warnings'] as string[]) {
      lines.push(`  ⚠ ${warning}`);
    }
  }

  return lines.join('\n');
}

/**
 * Execute CLI command
 */
export async function execute(args: string[], config?: AuthAgentConfig): Promise<CLIResult> {
  try {
    const parsedArgs = parseArgs(args);
    const agent = createAuthAgent(config);

    // Build input
    const input = {
      credential: parsedArgs.credential,
      method: parsedArgs.method as AuthMethod,
      expected_issuer: parsedArgs.issuer,
      expected_audience: parsedArgs.audience,
      required_scopes: parsedArgs.scopes?.split(',').map((s) => s.trim()),
      jwks_uri: parsedArgs.jwks,
    };

    // Build context
    const context = {
      traceId: `cli-${Date.now()}`,
      metadata: {
        source: 'cli',
        command: parsedArgs.command,
      },
    };

    // Execute based on command
    switch (parsedArgs.command) {
      case 'verify':
      case 'validate': {
        const result = await agent.invoke(input, context);

        const outputData = {
          authenticated: result.output.authenticated,
          status: result.output.status,
          claims: result.output.claims,
          expires_at: result.output.expires_at,
          scopes: result.output.scopes,
          confidence: {
            score: result.event.confidence.score,
            level: result.event.confidence.level,
          },
          warnings: result.output.warnings,
        };

        return {
          exitCode: result.output.authenticated ? 0 : 1,
          output: formatOutput(outputData, parsedArgs.format, parsedArgs.verbose),
        };
      }

      case 'inspect': {
        // For inspect, we just parse without full validation
        const { parseJWTUnsafe } = await import('./validators/jwt-validator');
        const parsed = parseJWTUnsafe(parsedArgs.credential);

        if (!parsed) {
          return {
            exitCode: 1,
            output: formatOutput(
              { error: 'Token is not a valid JWT format' },
              parsedArgs.format,
              parsedArgs.verbose
            ),
          };
        }

        return {
          exitCode: 0,
          output: formatOutput(
            {
              header: parsed.header,
              payload: parsed.payload,
              signature: '[PRESENT]',
            },
            parsedArgs.format,
            parsedArgs.verbose
          ),
        };
      }

      default:
        return {
          exitCode: 1,
          output: `Unknown command: ${parsedArgs.command}`,
        };
    }
  } catch (error) {
    return {
      exitCode: 1,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Print help message
 */
export function printHelp(): string {
  return `
Auth/Identity Agent CLI

Usage:
  auth-agent <command> <credential> [options]

Commands:
  verify <token>     Verify a token and return authentication status
  inspect <token>    Parse and display token contents without verification
  validate <token>   Alias for verify

Options:
  -m, --method <method>    Authentication method (jwt, api_key, oauth2, bearer, basic)
  -i, --issuer <issuer>    Expected token issuer
  -a, --audience <aud>     Expected token audience
  -s, --scopes <scopes>    Required scopes (comma-separated)
  --jwks <uri>             JWKS endpoint for key discovery
  -f, --format <format>    Output format (json, text, minimal)
  -v, --verbose            Verbose output

Examples:
  auth-agent verify eyJhbG... --method jwt --issuer https://auth.example.com
  auth-agent inspect eyJhbG... --format text --verbose
  auth-agent validate sk-xxx --method api_key
`.trim();
}

/**
 * CLI entry point
 */
export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(printHelp());
    process.exit(0);
  }

  const result = await execute(args);
  console.log(result.output);
  process.exit(result.exitCode);
}
