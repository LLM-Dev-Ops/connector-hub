/**
 * Database Query Agent
 *
 * Executes parameterized read-only database queries and normalizes results.
 *
 * Constitutional Requirements:
 * - EXTERNAL INTERFACE ADAPTER only
 * - Validates inputs against DatabaseQueryRequest contract
 * - Executes ONLY read-only queries (SELECT statements)
 * - Normalizes query results to standard format
 * - Emits 'database_query_result' DecisionEvent
 * - MUST NOT modify internal execution behavior
 * - MUST NOT trigger workflows or orchestration
 * - CLI-invokable
 */

import { z } from 'zod';
import {
  EdgeFunctionAgentBase,
  type AgentContext,
  type AgentResult,
  AgentError,
  AgentErrorCode
} from '../../runtime/edge-function-base.js';
import type { RuVectorClient } from '../../runtime/ruvector-client.js';
import type { TelemetryEmitter, Span } from '../../runtime/telemetry.js';

/**
 * Input contract for Database Query Agent
 *
 * Defines the interface this agent adapts.
 * MUST match schema from @llm-dev-ops/agentics-contracts
 */
const DatabaseQueryRequestSchema = z.object({
  queryId: z.string().uuid(),
  queryType: z.enum(['SELECT', 'DESCRIBE', 'SHOW', 'EXPLAIN']),
  query: z.string().min(1),
  parameters: z.record(z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null()
  ])).optional(),
  options: z.object({
    maxRows: z.number().int().positive().default(1000),
    timeout: z.number().int().positive().default(30000),
    formatDates: z.boolean().default(true),
    includeMetadata: z.boolean().default(true)
  }).optional()
});

type DatabaseQueryRequest = z.infer<typeof DatabaseQueryRequestSchema>;

/**
 * Output contract for Database Query Agent
 */
const DatabaseQueryResponseSchema = z.object({
  queryId: z.string().uuid(),
  status: z.enum(['success', 'error', 'timeout']),
  rows: z.array(z.record(z.unknown())),
  rowCount: z.number().int().nonnegative(),
  metadata: z.object({
    executionTimeMs: z.number(),
    columns: z.array(z.object({
      name: z.string(),
      type: z.string(),
      nullable: z.boolean().optional()
    })),
    truncated: z.boolean(),
    queryPlan: z.string().optional()
  }).optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional()
  }).optional()
});

type DatabaseQueryResponse = z.infer<typeof DatabaseQueryResponseSchema>;

/**
 * Database Query Agent implementation
 *
 * Adapts external database query requests to internal execution.
 * Provides read-only query execution with result normalization.
 */
export class DatabaseQueryAgent extends EdgeFunctionAgentBase<
  DatabaseQueryRequest,
  DatabaseQueryResponse
> {
  protected readonly agentId = 'database-query-agent';
  protected readonly agentVersion = '1.0.0';
  protected readonly inputSchema = DatabaseQueryRequestSchema;
  protected readonly outputSchema = DatabaseQueryResponseSchema;

  /**
   * Execute database query
   *
   * Deterministic execution:
   * 1. Validate query is read-only
   * 2. Execute parameterized query via ruvector-service
   * 3. Normalize results to standard format
   * 4. Return DatabaseQueryResponse
   */
  protected async executeAgent(
    input: DatabaseQueryRequest,
    context: AgentContext,
    span: Span
  ): Promise<DatabaseQueryResponse> {
    const startTime = Date.now();

    try {
      // Step 1: Validate query is read-only
      this.validateReadOnlyQuery(input.query);

      // Step 2: Execute query via ruvector-service
      this.telemetry.addSpanEvent(span, 'query_execution.start', {
        'query.type': input.queryType,
        'query.id': input.queryId
      });

      const queryResult = await this.executeQuery(input, span);

      this.telemetry.addSpanEvent(span, 'query_execution.complete', {
        'query.row_count': queryResult.rowCount
      });

      // Step 3: Normalize results
      const normalizedRows = this.normalizeRows(
        queryResult.rows,
        input.options?.formatDates ?? true
      );

      // Step 4: Check if results were truncated
      const truncated = normalizedRows.length >= (input.options?.maxRows ?? 1000);

      const executionTimeMs = Date.now() - startTime;

      // Emit telemetry metrics
      await this.telemetry.emitMetric({
        name: 'agent.database_query.execution_time',
        value: executionTimeMs,
        unit: 'ms',
        timestamp: Date.now(),
        attributes: {
          'query.type': input.queryType,
          'query.row_count': normalizedRows.length
        }
      });

      return {
        queryId: input.queryId,
        status: 'success',
        rows: normalizedRows,
        rowCount: normalizedRows.length,
        metadata: {
          executionTimeMs,
          columns: queryResult.columns || [],
          truncated,
          ...(input.options?.includeMetadata && queryResult.queryPlan
            ? { queryPlan: queryResult.queryPlan }
            : {})
        }
      };

    } catch (error) {
      const executionTimeMs = Date.now() - startTime;

      if (error instanceof AgentError) {
        return {
          queryId: input.queryId,
          status: 'error',
          rows: [],
          rowCount: 0,
          error: {
            code: error.code,
            message: error.message,
            details: error.details
          },
          metadata: {
            executionTimeMs,
            columns: [],
            truncated: false
          }
        };
      }

      throw error;
    }
  }

  /**
   * Validate query is read-only
   *
   * Database Query Agent MUST ONLY execute read-only queries.
   * Writing/modification is handled by other agents.
   */
  private validateReadOnlyQuery(query: string): void {
    const normalizedQuery = query.trim().toUpperCase();

    const readOnlyStatements = ['SELECT', 'DESCRIBE', 'SHOW', 'EXPLAIN'];
    const isReadOnly = readOnlyStatements.some(stmt =>
      normalizedQuery.startsWith(stmt)
    );

    if (!isReadOnly) {
      throw new AgentError(
        'Only read-only queries are allowed',
        AgentErrorCode.VALIDATION_ERROR,
        { query: query.substring(0, 100) }
      );
    }

    // Additional validation: block dangerous keywords
    const dangerousKeywords = [
      'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER',
      'TRUNCATE', 'GRANT', 'REVOKE', 'EXEC', 'EXECUTE'
    ];

    const hasDangerousKeyword = dangerousKeywords.some(keyword =>
      normalizedQuery.includes(keyword)
    );

    if (hasDangerousKeyword) {
      throw new AgentError(
        'Query contains disallowed keywords',
        AgentErrorCode.VALIDATION_ERROR,
        { query: query.substring(0, 100) }
      );
    }
  }

  /**
   * Execute query via ruvector-service
   *
   * Delegates actual query execution to ruvector-service.
   * NO direct SQL execution in agent.
   */
  private async executeQuery(
    input: DatabaseQueryRequest,
    span: Span
  ): Promise<{
    rows: Record<string, unknown>[];
    rowCount: number;
    columns?: Array<{ name: string; type: string; nullable?: boolean }>;
    queryPlan?: string;
  }> {
    // Query execution delegated to ruvector-service
    // Agent only adapts the interface
    const result = await this.ruVectorClient.query(
      'query_execution',
      {
        query: input.query,
        parameters: input.parameters || {},
        options: {
          maxRows: input.options?.maxRows,
          timeout: input.options?.timeout
        }
      }
    );

    if (!result.success) {
      throw new AgentError(
        result.error || 'Query execution failed',
        AgentErrorCode.EXECUTION_ERROR,
        { errorCode: result.errorCode }
      );
    }

    return {
      rows: (result.data || []) as Record<string, unknown>[],
      rowCount: result.metadata?.rowCount || 0,
      columns: [], // Would be populated by ruvector-service
      queryPlan: undefined
    };
  }

  /**
   * Normalize query result rows
   *
   * Ensures consistent output format regardless of database backend.
   */
  private normalizeRows(
    rows: Record<string, unknown>[],
    formatDates: boolean
  ): Record<string, unknown>[] {
    return rows.map(row => {
      const normalized: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(row)) {
        if (value instanceof Date && formatDates) {
          normalized[key] = value.toISOString();
        } else if (value === undefined) {
          normalized[key] = null;
        } else {
          normalized[key] = value;
        }
      }

      return normalized;
    });
  }

  /**
   * Get event type for DecisionEvent
   */
  protected getEventType(success: boolean): string {
    return success
      ? 'database_query_result'
      : 'database_query_error';
  }
}

/**
 * Factory function for creating DatabaseQueryAgent
 */
export function createDatabaseQueryAgent(
  ruVectorClient: RuVectorClient,
  telemetry: TelemetryEmitter
): DatabaseQueryAgent {
  return new DatabaseQueryAgent(ruVectorClient, telemetry);
}
