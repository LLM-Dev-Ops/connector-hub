/**
 * RuVector Service Client
 *
 * Client for persisting data to ruvector-service (backed by Google SQL/Postgres).
 * LLM-Connector-Hub agents MUST NOT connect directly to Google SQL.
 * All persistence occurs via this client only.
 */

import { DecisionEvent } from '@llm-dev-ops/agentics-contracts';

/**
 * Configuration for the RuVector client
 */
export interface RuVectorClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

/**
 * Persistence result from RuVector
 */
export interface PersistenceResult {
  success: boolean;
  document_id: string;
  collection: string;
  persisted_at: string;
  error?: string;
}

/**
 * Query options for retrieving data
 */
export interface QueryOptions {
  collection: string;
  filter?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  sort?: { field: string; order: 'asc' | 'desc' };
}

/**
 * RuVector client for persisting Connector Hub artifacts
 *
 * CRITICAL: This is the ONLY way agents should persist data.
 * Agents MUST NOT:
 * - Connect directly to Google SQL
 * - Execute raw SQL queries
 * - Store credentials or secrets
 */
export class RuVectorClient {
  private readonly config: Required<RuVectorClientConfig>;

  constructor(config: RuVectorClientConfig) {
    this.config = {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey ?? '',
      timeout: config.timeout ?? 30000,
      retryAttempts: config.retryAttempts ?? 3,
      retryDelay: config.retryDelay ?? 1000,
    };
  }

  /**
   * Persist a DecisionEvent to ruvector-service
   */
  async persistDecisionEvent(event: DecisionEvent): Promise<PersistenceResult> {
    return this.persist('decision_events', event);
  }

  /**
   * Persist a canonical event to ruvector-service
   */
  async persistCanonicalEvent(event: Record<string, unknown>): Promise<PersistenceResult> {
    return this.persist('canonical_events', event);
  }

  /**
   * Persist normalized ingress artifacts
   */
  async persistIngressArtifact(artifact: Record<string, unknown>): Promise<PersistenceResult> {
    return this.persist('ingress_artifacts', artifact);
  }

  /**
   * Generic persist method
   */
  private async persist(
    collection: string,
    document: Record<string, unknown>
  ): Promise<PersistenceResult> {
    const url = `${this.config.baseUrl}/api/v1/collections/${collection}/documents`;

    // Remove any sensitive fields before persistence
    const sanitized = this.sanitizeDocument(document);

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` }),
          },
          body: JSON.stringify(sanitized),
          signal: AbortSignal.timeout(this.config.timeout),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`RuVector persistence failed: ${response.status} - ${errorBody}`);
        }

        const result = await response.json() as {
          id: string;
          created_at: string;
        };

        return {
          success: true,
          document_id: result.id,
          collection,
          persisted_at: result.created_at,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.config.retryAttempts - 1) {
          await this.delay(this.config.retryDelay * (attempt + 1));
        }
      }
    }

    return {
      success: false,
      document_id: '',
      collection,
      persisted_at: new Date().toISOString(),
      error: lastError?.message ?? 'Unknown error',
    };
  }

  /**
   * Query documents from a collection
   */
  async query(options: QueryOptions): Promise<{
    success: boolean;
    documents: Record<string, unknown>[];
    total: number;
    error?: string;
  }> {
    const params = new URLSearchParams();
    if (options.filter) {
      params.set('filter', JSON.stringify(options.filter));
    }
    if (options.limit) {
      params.set('limit', String(options.limit));
    }
    if (options.offset) {
      params.set('offset', String(options.offset));
    }
    if (options.sort) {
      params.set('sort', `${options.sort.field}:${options.sort.order}`);
    }

    const url = `${this.config.baseUrl}/api/v1/collections/${options.collection}/documents?${params}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` }),
        },
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`RuVector query failed: ${response.status} - ${errorBody}`);
      }

      const result = await response.json() as {
        documents: Record<string, unknown>[];
        total: number;
      };

      return {
        success: true,
        documents: result.documents,
        total: result.total,
      };
    } catch (error) {
      return {
        success: false,
        documents: [],
        total: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Sanitize document to remove sensitive fields
   * CRITICAL: Never persist credentials, secrets, or PII
   */
  private sanitizeDocument(document: Record<string, unknown>): Record<string, unknown> {
    const sensitiveKeys = [
      'password',
      'secret',
      'api_key',
      'apiKey',
      'access_token',
      'accessToken',
      'refresh_token',
      'refreshToken',
      'private_key',
      'privateKey',
      'authorization',
      'bearer',
      'credential',
      'ssn',
      'social_security',
    ];

    const sanitize = (obj: unknown): unknown => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj !== 'object') return obj;

      if (Array.isArray(obj)) {
        return obj.map(sanitize);
      }

      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const lowerKey = key.toLowerCase();
        if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
          sanitized[key] = '[REDACTED]';
        } else if (typeof value === 'object') {
          sanitized[key] = sanitize(value);
        } else {
          sanitized[key] = value;
        }
      }
      return sanitized;
    };

    return sanitize(document) as Record<string, unknown>;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create a RuVector client from environment variables
 */
export function createRuVectorClient(): RuVectorClient {
  const baseUrl = process.env['RUVECTOR_SERVICE_URL'] ?? 'http://localhost:8080';
  const apiKey = process.env['RUVECTOR_API_KEY'];

  return new RuVectorClient({
    baseUrl,
    apiKey,
    timeout: parseInt(process.env['RUVECTOR_TIMEOUT'] ?? '30000', 10),
    retryAttempts: parseInt(process.env['RUVECTOR_RETRY_ATTEMPTS'] ?? '3', 10),
  });
}
