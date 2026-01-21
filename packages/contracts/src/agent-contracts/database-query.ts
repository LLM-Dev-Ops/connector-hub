import { z } from 'zod';

/**
 * Database connection configuration schema.
 * Supports multiple database types with connection pooling.
 *
 * @remarks
 * Credentials MUST be provided via environment variables or secret managers.
 * The connection_string should reference secrets, not contain them directly.
 */
export const DatabaseConnectionConfigSchema = z.object({
  /**
   * Database type identifier.
   */
  type: z.enum(['postgres', 'mysql', 'mssql', 'oracle', 'sqlite'])
    .describe('Database type'),

  /**
   * Connection string referencing environment variables.
   * Example: "${DATABASE_URL}" or "postgres://${DB_HOST}:${DB_PORT}/${DB_NAME}"
   */
  connection_string: z.string()
    .min(1)
    .describe('Connection string with environment variable references'),

  /**
   * Connection pool configuration.
   */
  pool: z.object({
    min: z.number().int().min(0).default(2).describe('Minimum pool connections'),
    max: z.number().int().min(1).default(10).describe('Maximum pool connections'),
    idle_timeout_ms: z.number().int().min(0).default(30000).describe('Idle timeout in milliseconds'),
  }).optional().describe('Connection pool settings'),

  /**
   * Query timeout in milliseconds.
   */
  timeout_ms: z.number()
    .int()
    .min(0)
    .default(30000)
    .describe('Query execution timeout in milliseconds'),

  /**
   * Enable SSL/TLS connection.
   */
  ssl: z.boolean()
    .default(true)
    .describe('Enable SSL/TLS encryption'),
});

export type DatabaseConnectionConfig = z.infer<typeof DatabaseConnectionConfigSchema>;

/**
 * Input schema for Database Query Agent.
 * Defines the contract for executing SQL queries against databases.
 */
export const DatabaseQueryInputSchema = z.object({
  /**
   * SQL query string to execute.
   * Supports parameterized queries to prevent SQL injection.
   */
  query: z.string()
    .min(1)
    .describe('SQL query string (supports parameterized queries)'),

  /**
   * Database connection configuration.
   */
  connection_config: DatabaseConnectionConfigSchema
    .describe('Database connection configuration'),

  /**
   * Query parameters for parameterized queries.
   * Keys should match parameter placeholders in the query.
   */
  parameters: z.record(z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
  ])).optional().describe('Query parameters for parameterized queries'),

  /**
   * Maximum number of rows to return.
   * Acts as a safety limit to prevent unbounded result sets.
   */
  max_rows: z.number()
    .int()
    .min(1)
    .default(1000)
    .describe('Maximum rows to return (safety limit)'),

  /**
   * Enable query result caching.
   */
  enable_cache: z.boolean()
    .default(true)
    .describe('Enable query result caching'),

  /**
   * Cache TTL in seconds (if caching enabled).
   */
  cache_ttl_seconds: z.number()
    .int()
    .min(0)
    .default(300)
    .describe('Cache time-to-live in seconds'),
});

export type DatabaseQueryInput = z.infer<typeof DatabaseQueryInputSchema>;

/**
 * Query execution statistics.
 */
export const QueryStatsSchema = z.object({
  /**
   * Execution time in milliseconds.
   */
  execution_time_ms: z.number()
    .min(0)
    .describe('Query execution time in milliseconds'),

  /**
   * Number of rows returned.
   */
  rows_returned: z.number()
    .int()
    .min(0)
    .describe('Number of rows returned'),

  /**
   * Number of rows affected (for INSERT/UPDATE/DELETE).
   */
  rows_affected: z.number()
    .int()
    .min(0)
    .optional()
    .describe('Number of rows affected (DML operations)'),

  /**
   * Whether result was served from cache.
   */
  cache_hit: z.boolean()
    .describe('Whether result was served from cache'),

  /**
   * Query plan (if available and requested).
   */
  query_plan: z.string()
    .optional()
    .describe('Query execution plan'),
});

export type QueryStats = z.infer<typeof QueryStatsSchema>;

/**
 * Query result metadata.
 */
export const QueryMetadataSchema = z.object({
  /**
   * Column definitions with type information.
   */
  columns: z.array(z.object({
    name: z.string().describe('Column name'),
    type: z.string().describe('Column data type'),
    nullable: z.boolean().optional().describe('Whether column allows NULL'),
  })).describe('Column definitions'),

  /**
   * Total count (if pagination requested).
   */
  total_count: z.number()
    .int()
    .min(0)
    .optional()
    .describe('Total row count (for pagination)'),

  /**
   * Warnings or notices from database.
   */
  warnings: z.array(z.string())
    .optional()
    .describe('Database warnings or notices'),
});

export type QueryMetadata = z.infer<typeof QueryMetadataSchema>;

/**
 * Output schema for Database Query Agent.
 * Contains query results, metadata, and execution statistics.
 */
export const DatabaseQueryOutputSchema = z.object({
  /**
   * Query result rows as array of objects.
   * Each object represents a row with column names as keys.
   */
  rows: z.array(z.record(z.unknown()))
    .describe('Query result rows'),

  /**
   * Result metadata including column definitions.
   */
  metadata: QueryMetadataSchema
    .describe('Query result metadata'),

  /**
   * Query execution statistics.
   */
  query_stats: QueryStatsSchema
    .describe('Query execution statistics'),
});

export type DatabaseQueryOutput = z.infer<typeof DatabaseQueryOutputSchema>;

/**
 * Complete Database Query Agent contract.
 * Combines input and output schemas with validation rules.
 */
export const DatabaseQueryContractSchema = z.object({
  input: DatabaseQueryInputSchema,
  output: DatabaseQueryOutputSchema,
});

export type DatabaseQueryContract = z.infer<typeof DatabaseQueryContractSchema>;

/**
 * CLI invocation shape for Database Query Agent.
 * Defines the command-line interface contract.
 *
 * @example
 * ```bash
 * database-query-agent \
 *   --query "SELECT * FROM users WHERE id = $1" \
 *   --parameters '{"1": "user-123"}' \
 *   --connection-config '{"type": "postgres", "connection_string": "${DATABASE_URL}"}' \
 *   --max-rows 100
 * ```
 */
export const DatabaseQueryCLISchema = z.object({
  query: z.string().describe('SQL query string'),
  parameters: z.string().optional().describe('JSON string of query parameters'),
  'connection-config': z.string().describe('JSON string of connection config'),
  'max-rows': z.number().int().optional().describe('Maximum rows to return'),
  'enable-cache': z.boolean().optional().describe('Enable query caching'),
  'cache-ttl': z.number().int().optional().describe('Cache TTL in seconds'),
});

export type DatabaseQueryCLI = z.infer<typeof DatabaseQueryCLISchema>;

/**
 * Validates database query input.
 *
 * @param data - The data to validate
 * @returns Validated DatabaseQueryInput
 * @throws {ZodError} If validation fails
 */
export function validateDatabaseQueryInput(data: unknown): DatabaseQueryInput {
  return DatabaseQueryInputSchema.parse(data);
}

/**
 * Validates database query output.
 *
 * @param data - The data to validate
 * @returns Validated DatabaseQueryOutput
 * @throws {ZodError} If validation fails
 */
export function validateDatabaseQueryOutput(data: unknown): DatabaseQueryOutput {
  return DatabaseQueryOutputSchema.parse(data);
}

/**
 * Safely validates database query input without throwing.
 *
 * @param data - The data to validate
 * @returns SafeParseReturnType with success flag and data/error
 */
export function safeValidateDatabaseQueryInput(data: unknown) {
  return DatabaseQueryInputSchema.safeParse(data);
}

/**
 * Safely validates database query output without throwing.
 *
 * @param data - The data to validate
 * @returns SafeParseReturnType with success flag and data/error
 */
export function safeValidateDatabaseQueryOutput(data: unknown) {
  return DatabaseQueryOutputSchema.safeParse(data);
}
