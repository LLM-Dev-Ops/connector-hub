/**
 * Ruvector Client - Phase 6 Core Infrastructure
 *
 * This client provides the ONLY persistence mechanism for agents.
 * All state MUST be persisted via Ruvector service.
 *
 * ARCHITECTURAL RULES:
 * - Agents MUST NOT persist state locally
 * - All reads/writes go through Ruvector
 * - Secrets come from Google Secret Manager via environment
 */

import { z } from 'zod';

// ============================================================================
// Ruvector Configuration
// ============================================================================

export const RuvectorConfigSchema = z.object({
  serviceUrl: z.string().url(),
  apiKey: z.string().min(1),
  timeout: z.number().min(100).max(30000).default(5000),
  retryAttempts: z.number().min(0).max(5).default(3),
  retryDelayMs: z.number().min(100).max(5000).default(500),
});

export type RuvectorConfig = z.infer<typeof RuvectorConfigSchema>;

// ============================================================================
// Ruvector Data Types
// ============================================================================

export interface RuvectorDocument {
  id: string;
  namespace: string;
  data: Record<string, unknown>;
  metadata: {
    created_at: string;
    updated_at: string;
    version: number;
    ttl_seconds?: number;
  };
}

export interface RuvectorQuery {
  namespace: string;
  filter?: Record<string, unknown>;
  limit?: number;
  offset?: number;
}

export interface RuvectorWriteResult {
  id: string;
  version: number;
  success: boolean;
}

// ============================================================================
// Ruvector Client Implementation
// ============================================================================

export class RuvectorClient {
  private readonly config: RuvectorConfig;
  private readonly baseHeaders: Record<string, string>;

  constructor(config: Partial<RuvectorConfig> = {}) {
    // Load from environment with overrides
    const envConfig = {
      serviceUrl: process.env.RUVECTOR_SERVICE_URL || '',
      apiKey: process.env.RUVECTOR_API_KEY || '',
      timeout: parseInt(process.env.RUVECTOR_TIMEOUT || '5000', 10),
      retryAttempts: parseInt(process.env.RUVECTOR_RETRY_ATTEMPTS || '3', 10),
      retryDelayMs: parseInt(process.env.RUVECTOR_RETRY_DELAY_MS || '500', 10),
      ...config,
    };

    this.config = RuvectorConfigSchema.parse(envConfig);
    this.baseHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
      'X-Client-Version': '1.0.0',
    };
  }

  /**
   * Store a document in Ruvector
   */
  async store(
    namespace: string,
    id: string,
    data: Record<string, unknown>,
    ttlSeconds?: number
  ): Promise<RuvectorWriteResult> {
    const payload = {
      namespace,
      id,
      data,
      ttl_seconds: ttlSeconds,
    };

    const response = await this.request<RuvectorWriteResult>(
      'POST',
      '/v1/documents',
      payload
    );

    return response;
  }

  /**
   * Retrieve a document from Ruvector
   */
  async get(namespace: string, id: string): Promise<RuvectorDocument | null> {
    try {
      const response = await this.request<RuvectorDocument>(
        'GET',
        `/v1/documents/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}`
      );
      return response;
    } catch (error) {
      if (error instanceof RuvectorError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Query documents from Ruvector
   */
  async query(query: RuvectorQuery): Promise<RuvectorDocument[]> {
    const params = new URLSearchParams();
    params.set('namespace', query.namespace);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.offset) params.set('offset', String(query.offset));
    if (query.filter) params.set('filter', JSON.stringify(query.filter));

    const response = await this.request<{ documents: RuvectorDocument[] }>(
      'GET',
      `/v1/documents?${params.toString()}`
    );

    return response.documents;
  }

  /**
   * Delete a document from Ruvector
   */
  async delete(namespace: string, id: string): Promise<boolean> {
    try {
      await this.request<void>(
        'DELETE',
        `/v1/documents/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}`
      );
      return true;
    } catch (error) {
      if (error instanceof RuvectorError && error.statusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Health check for Ruvector service
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    latencyMs: number;
    version?: string;
  }> {
    const startTime = Date.now();
    try {
      const response = await this.request<{ status: string; version: string }>(
        'GET',
        '/health',
        undefined,
        2000 // Quick timeout for health check
      );
      return {
        healthy: response.status === 'ok',
        latencyMs: Date.now() - startTime,
        version: response.version,
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Make HTTP request to Ruvector with retries
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutOverride?: number
  ): Promise<T> {
    const url = `${this.config.serviceUrl}${path}`;
    const timeout = timeoutOverride ?? this.config.timeout;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          method,
          headers: this.baseHeaders,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorBody = await response.text().catch(() => 'Unknown error');
          throw new RuvectorError(
            `Ruvector request failed: ${response.status} ${response.statusText}`,
            response.status,
            errorBody
          );
        }

        // Handle empty responses
        const text = await response.text();
        if (!text) {
          return {} as T;
        }

        return JSON.parse(text) as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on client errors (4xx)
        if (error instanceof RuvectorError && error.statusCode >= 400 && error.statusCode < 500) {
          throw error;
        }

        // Wait before retry (exponential backoff)
        if (attempt < this.config.retryAttempts) {
          const delay = this.config.retryDelayMs * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError ?? new Error('Ruvector request failed after retries');
  }
}

// ============================================================================
// Ruvector Error
// ============================================================================

export class RuvectorError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body?: string
  ) {
    super(message);
    this.name = 'RuvectorError';
  }
}

// ============================================================================
// Singleton Instance (lazy initialization)
// ============================================================================

let ruvectorInstance: RuvectorClient | null = null;

export function getRuvectorClient(config?: Partial<RuvectorConfig>): RuvectorClient {
  if (!ruvectorInstance || config) {
    ruvectorInstance = new RuvectorClient(config);
  }
  return ruvectorInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetRuvectorClient(): void {
  ruvectorInstance = null;
}
