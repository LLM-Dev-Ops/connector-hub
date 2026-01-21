/**
 * RuVector Service Client
 *
 * Async persistence layer for agents - NO direct SQL access.
 * All data persistence MUST go through ruvector-service.
 *
 * Constitutional Requirements:
 * - Agents MUST NOT execute direct SQL
 * - All persistence operations are async
 * - Batch operations for efficiency
 * - Proper error handling with codes
 */

export interface RuVectorClientConfig {
  serviceUrl: string;
  apiKey?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface PersistenceResult {
  success: boolean;
  id?: string;
  error?: string;
  errorCode?: string;
}

export interface QueryResult<T = unknown> {
  success: boolean;
  data?: T[];
  error?: string;
  errorCode?: string;
  metadata?: {
    rowCount: number;
    executionTimeMs: number;
  };
}

export interface BatchPersistenceRequest {
  operations: Array<{
    type: 'insert' | 'update' | 'delete';
    collection: string;
    data: Record<string, unknown>;
    id?: string;
  }>;
}

export interface BatchPersistenceResult {
  success: boolean;
  results: PersistenceResult[];
  failedCount: number;
  successCount: number;
}

/**
 * Error codes for ruvector-service operations
 */
export enum RuVectorErrorCode {
  CONNECTION_FAILED = 'RUVECTOR_CONNECTION_FAILED',
  TIMEOUT = 'RUVECTOR_TIMEOUT',
  UNAUTHORIZED = 'RUVECTOR_UNAUTHORIZED',
  NOT_FOUND = 'RUVECTOR_NOT_FOUND',
  VALIDATION_ERROR = 'RUVECTOR_VALIDATION_ERROR',
  INTERNAL_ERROR = 'RUVECTOR_INTERNAL_ERROR',
  BATCH_PARTIAL_FAILURE = 'RUVECTOR_BATCH_PARTIAL_FAILURE'
}

export class RuVectorError extends Error {
  constructor(
    message: string,
    public readonly code: RuVectorErrorCode,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'RuVectorError';
  }
}

/**
 * Client for ruvector-service
 *
 * Provides async persistence API for agents.
 * NO SQL execution - all operations delegated to ruvector-service.
 */
export class RuVectorClient {
  private readonly config: Required<RuVectorClientConfig>;

  constructor(config: RuVectorClientConfig) {
    this.config = {
      timeout: 5000,
      maxRetries: 3,
      ...config
    };
  }

  /**
   * Persist a single entity
   */
  async persist(
    collection: string,
    data: Record<string, unknown>
  ): Promise<PersistenceResult> {
    try {
      const response = await this.request('/api/persist', {
        method: 'POST',
        body: JSON.stringify({ collection, data })
      });

      return await response.json();
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: this.mapErrorCode(error)
      };
    }
  }

  /**
   * Query entities with filters
   * Read-only operation for agent data retrieval
   */
  async query<T = unknown>(
    collection: string,
    filters?: Record<string, unknown>,
    options?: {
      limit?: number;
      offset?: number;
      orderBy?: string;
    }
  ): Promise<QueryResult<T>> {
    try {
      const queryParams = new URLSearchParams();
      if (filters) queryParams.set('filters', JSON.stringify(filters));
      if (options?.limit) queryParams.set('limit', options.limit.toString());
      if (options?.offset) queryParams.set('offset', options.offset.toString());
      if (options?.orderBy) queryParams.set('orderBy', options.orderBy);

      const response = await this.request(
        `/api/query/${collection}?${queryParams.toString()}`,
        { method: 'GET' }
      );

      return await response.json();
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: this.mapErrorCode(error)
      };
    }
  }

  /**
   * Batch persistence operations
   * Efficient for multiple operations in single agent invocation
   */
  async batchPersist(
    request: BatchPersistenceRequest
  ): Promise<BatchPersistenceResult> {
    try {
      const response = await this.request('/api/batch-persist', {
        method: 'POST',
        body: JSON.stringify(request)
      });

      return await response.json();
    } catch (error) {
      return {
        success: false,
        results: [],
        failedCount: request.operations.length,
        successCount: 0
      };
    }
  }

  /**
   * Delete an entity
   */
  async delete(collection: string, id: string): Promise<PersistenceResult> {
    try {
      const response = await this.request(`/api/persist/${collection}/${id}`, {
        method: 'DELETE'
      });

      return await response.json();
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: this.mapErrorCode(error)
      };
    }
  }

  /**
   * Internal HTTP request with retry logic
   */
  private async request(
    path: string,
    options: RequestInit,
    attempt = 1
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`${this.config.serviceUrl}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` }),
          ...options.headers
        },
        signal: controller.signal
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new RuVectorError(
            'Unauthorized access to ruvector-service',
            RuVectorErrorCode.UNAUTHORIZED
          );
        }
        if (response.status === 404) {
          throw new RuVectorError(
            'Resource not found in ruvector-service',
            RuVectorErrorCode.NOT_FOUND
          );
        }
        throw new RuVectorError(
          `HTTP ${response.status}: ${response.statusText}`,
          RuVectorErrorCode.INTERNAL_ERROR
        );
      }

      return response;
    } catch (error) {
      if (error instanceof RuVectorError) {
        throw error;
      }

      // Retry on transient errors
      if (attempt < this.config.maxRetries) {
        await this.delay(Math.pow(2, attempt) * 100); // Exponential backoff
        return this.request(path, options, attempt + 1);
      }

      if ((error as Error).name === 'AbortError') {
        throw new RuVectorError(
          'Request timeout',
          RuVectorErrorCode.TIMEOUT
        );
      }

      throw new RuVectorError(
        'Connection failed to ruvector-service',
        RuVectorErrorCode.CONNECTION_FAILED,
        error
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private mapErrorCode(error: unknown): string {
    if (error instanceof RuVectorError) {
      return error.code;
    }
    if ((error as Error).name === 'AbortError') {
      return RuVectorErrorCode.TIMEOUT;
    }
    return RuVectorErrorCode.INTERNAL_ERROR;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Factory function for creating RuVectorClient from environment
 */
export function createRuVectorClientFromEnv(): RuVectorClient {
  const serviceUrl = process.env.RUVECTOR_SERVICE_URL;
  const apiKey = process.env.RUVECTOR_API_KEY;

  if (!serviceUrl) {
    throw new Error('RUVECTOR_SERVICE_URL environment variable is required');
  }

  return new RuVectorClient({
    serviceUrl,
    apiKey,
    timeout: process.env.RUVECTOR_TIMEOUT
      ? parseInt(process.env.RUVECTOR_TIMEOUT, 10)
      : undefined,
    maxRetries: process.env.RUVECTOR_MAX_RETRIES
      ? parseInt(process.env.RUVECTOR_MAX_RETRIES, 10)
      : undefined
  });
}
