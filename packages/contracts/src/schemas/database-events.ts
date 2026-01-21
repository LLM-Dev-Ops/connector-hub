import { z } from 'zod';

/**
 * Database types
 */
export const DatabaseTypeSchema = z.enum([
  'postgresql',
  'mysql',
  'mariadb',
  'mongodb',
  'redis',
  'elasticsearch',
  'dynamodb',
  'cosmosdb',
  'bigquery',
  'snowflake',
  'custom',
]);

export type DatabaseType = z.infer<typeof DatabaseTypeSchema>;

/**
 * Query result types
 */
export const QueryResultTypeSchema = z.enum([
  'select',
  'insert',
  'update',
  'delete',
  'aggregate',
  'transaction',
  'ddl',
]);

export type QueryResultType = z.infer<typeof QueryResultTypeSchema>;

/**
 * Database query result event schema (canonical format)
 */
export const DatabaseQueryResultEventSchema = z.object({
  database_type: DatabaseTypeSchema,
  database_name: z.string(),
  schema_name: z.string().optional(),
  result_type: QueryResultTypeSchema,
  query_hash: z.string().describe('Hash of the query for deduplication'),
  rows_affected: z.number().optional(),
  rows_returned: z.number().optional(),
  columns: z.array(z.object({
    name: z.string(),
    type: z.string(),
    nullable: z.boolean().optional(),
  })).optional(),
  execution_time_ms: z.number(),
  executed_at: z.string().datetime(),
  transaction_id: z.string().optional(),
  connection_id: z.string().optional(),
});

export type DatabaseQueryResultEvent = z.infer<typeof DatabaseQueryResultEventSchema>;

/**
 * PostgreSQL-specific result schema
 */
export const PostgreSQLResultSchema = z.object({
  command: z.string(),
  row_count: z.number(),
  fields: z.array(z.object({
    name: z.string(),
    tableID: z.number(),
    columnID: z.number(),
    dataTypeID: z.number(),
    dataTypeSize: z.number(),
    dataTypeModifier: z.number(),
    format: z.string(),
  })).optional(),
  rows: z.array(z.record(z.unknown())).optional(),
});

export type PostgreSQLResult = z.infer<typeof PostgreSQLResultSchema>;

/**
 * MongoDB-specific result schema
 */
export const MongoDBResultSchema = z.object({
  acknowledged: z.boolean(),
  inserted_id: z.string().optional(),
  inserted_ids: z.array(z.string()).optional(),
  matched_count: z.number().optional(),
  modified_count: z.number().optional(),
  deleted_count: z.number().optional(),
  upserted_count: z.number().optional(),
  documents: z.array(z.record(z.unknown())).optional(),
});

export type MongoDBResult = z.infer<typeof MongoDBResultSchema>;

/**
 * Database connection event (for health checks)
 */
export const DatabaseConnectionEventSchema = z.object({
  database_type: DatabaseTypeSchema,
  database_name: z.string(),
  host: z.string(),
  port: z.number(),
  connected: z.boolean(),
  latency_ms: z.number().optional(),
  error: z.string().optional(),
  checked_at: z.string().datetime(),
});

export type DatabaseConnectionEvent = z.infer<typeof DatabaseConnectionEventSchema>;
