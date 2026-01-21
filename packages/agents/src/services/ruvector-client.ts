/**
 * RuVector Service Client
 *
 * Client for persisting normalized payloads, ingress artifacts, and DecisionEvents
 * to the ruvector-service (backed by Google SQL/Postgres).
 *
 * ARCHITECTURAL RULES:
 * - LLM-Connector-Hub does NOT own persistence
 * - ALL persistence occurs via ruvector-service client calls only
 * - LLM-Connector-Hub NEVER connects directly to Google SQL
 * - LLM-Connector-Hub NEVER executes SQL
 * - Async, non-blocking writes
 */

import type { DecisionEvent, PersistedWebhookData } from '../contracts/index.js';

/**
 * RuVector service configuration
 */
export interface RuVectorConfig {
  /** Service endpoint URL */
  endpoint: string;

  /** API key for authentication */
  apiKey: string;

  /** Request timeout in milliseconds */
  timeoutMs: number;

  /** Enable retry on failure */
  retryEnabled: boolean;

  /** Maximum retry attempts */
  maxRetries: number;

  /** Retry delay in milliseconds */
  retryDelayMs: number;

  /** Enable request batching */
  batchingEnabled: boolean;

  /** Batch size threshold */
  batchSize: number;

  /** Batch flush interval in milliseconds */
  batchFlushIntervalMs: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: RuVectorConfig = {
  endpoint: process.env['RUVECTOR_SERVICE_URL'] || 'http://localhost:8080',
  apiKey: process.env['RUVECTOR_API_KEY'] || '',
  timeoutMs: 5000,
  retryEnabled: true,
  maxRetries: 3,
  retryDelayMs: 100,
  batchingEnabled: false,
  batchSize: 100,
  batchFlushIntervalMs: 1000,
};

/**
 * Persistence result
 */
export interface PersistResult {
  success: boolean;
  id?: string;
  error?: string;
  retryable: boolean;
}

/**
 * Batch item for batched writes
 */
interface BatchItem {
  data: PersistedWebhookData;
  resolve: (result: PersistResult) => void;
  reject: (error: Error) => void;
}

/**
 * RuVector Service Client
 *
 * Provides async, non-blocking persistence to ruvector-service.
 * Supports batching for high-throughput scenarios.
 */
export class RuVectorClient {
  private readonly config: RuVectorConfig;
  private batch: BatchItem[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private initialized = false;

  constructor(config: Partial<RuVectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the client
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Verify connectivity
    try {
      await this.healthCheck();
      this.initialized = true;

      // Start batch timer if batching enabled
      if (this.config.batchingEnabled) {
        this.startBatchTimer();
      }
    } catch (error) {
      throw new Error(
        `Failed to initialize RuVector client: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Shutdown the client
   */
  async shutdown(): Promise<void> {
    // Flush any pending batched items
    if (this.batch.length > 0) {
      await this.flushBatch();
    }

    // Clear batch timer
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }

    this.initialized = false;
  }

  /**
   * Persist a DecisionEvent
   */
  async persistDecisionEvent(event: DecisionEvent): Promise<PersistResult> {
    return this.persist('/api/v1/decision-events', event);
  }

  /**
   * Persist webhook data with full metadata
   */
  async persistWebhookData(data: PersistedWebhookData): Promise<PersistResult> {
    if (this.config.batchingEnabled) {
      return this.addToBatch(data);
    }

    return this.persist('/api/v1/webhook-data', data);
  }

  /**
   * Add item to batch for batched writes
   */
  private addToBatch(data: PersistedWebhookData): Promise<PersistResult> {
    return new Promise((resolve, reject) => {
      this.batch.push({ data, resolve, reject });

      // Flush if batch is full
      if (this.batch.length >= this.config.batchSize) {
        this.flushBatch().catch(reject);
      }
    });
  }

  /**
   * Flush the current batch
   */
  private async flushBatch(): Promise<void> {
    if (this.batch.length === 0) {
      return;
    }

    const items = this.batch;
    this.batch = [];

    try {
      const results = await this.persistBatch(
        '/api/v1/webhook-data/batch',
        items.map((item) => item.data)
      );

      // Resolve each item
      for (let i = 0; i < items.length; i++) {
        const batchResult = results[i];
        if (batchResult) {
          items[i]!.resolve(batchResult);
        } else {
          items[i]!.resolve({
            success: false,
            error: 'Unknown batch error',
            retryable: true,
          });
        }
      }
    } catch (error) {
      // Reject all items
      const errorMessage = error instanceof Error ? error.message : 'Batch persist failed';
      for (const item of items) {
        item.resolve({
          success: false,
          error: errorMessage,
          retryable: true,
        });
      }
    }
  }

  /**
   * Start batch flush timer
   */
  private startBatchTimer(): void {
    this.batchTimer = setInterval(async () => {
      await this.flushBatch();
    }, this.config.batchFlushIntervalMs);
  }

  /**
   * Generic persist method with retry logic
   */
  private async persist(path: string, data: unknown): Promise<PersistResult> {
    let lastError: Error | null = null;
    let attempts = 0;

    while (attempts <= this.config.maxRetries) {
      try {
        const response = await this.makeRequest('POST', path, data);

        if (response.ok) {
          const result = (await response.json()) as { id?: string };
          return {
            success: true,
            id: result.id,
            retryable: false,
          };
        }

        // Handle error responses
        const errorBody = await response.text();
        const isRetryable = response.status >= 500 || response.status === 429;

        if (!isRetryable || !this.config.retryEnabled) {
          return {
            success: false,
            error: `HTTP ${response.status}: ${errorBody}`,
            retryable: isRetryable,
          };
        }

        lastError = new Error(`HTTP ${response.status}: ${errorBody}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');

        if (!this.config.retryEnabled) {
          return {
            success: false,
            error: lastError.message,
            retryable: true,
          };
        }
      }

      attempts++;

      if (attempts <= this.config.maxRetries) {
        // Exponential backoff
        const delay = this.config.retryDelayMs * Math.pow(2, attempts - 1);
        await this.sleep(delay);
      }
    }

    return {
      success: false,
      error: lastError?.message || 'Max retries exceeded',
      retryable: true,
    };
  }

  /**
   * Persist a batch of items
   */
  private async persistBatch(path: string, items: unknown[]): Promise<PersistResult[]> {
    try {
      const response = await this.makeRequest('POST', path, { items });

      if (response.ok) {
        const result = (await response.json()) as { results?: PersistResult[] };
        return (
          result.results ||
          items.map(() => ({
            success: true,
            retryable: false,
          }))
        );
      }

      const errorBody = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorBody}`);
    } catch (error) {
      // Return failure for all items
      return items.map(() => ({
        success: false,
        error: error instanceof Error ? error.message : 'Batch persist failed',
        retryable: true,
      }));
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.makeRequest('GET', '/health');
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Make HTTP request to ruvector-service
   */
  private async makeRequest(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<Response> {
    const url = `${this.config.endpoint}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a singleton client instance
 */
let defaultClient: RuVectorClient | null = null;

export function getDefaultRuVectorClient(): RuVectorClient {
  if (!defaultClient) {
    defaultClient = new RuVectorClient();
  }
  return defaultClient;
}

/**
 * Mock client for testing (no actual persistence)
 */
export class MockRuVectorClient extends RuVectorClient {
  public persistedItems: Array<{ path: string; data: unknown }> = [];

  override async persistDecisionEvent(event: DecisionEvent): Promise<PersistResult> {
    this.persistedItems.push({ path: '/api/v1/decision-events', data: event });
    return { success: true, id: `mock-${Date.now()}`, retryable: false };
  }

  override async persistWebhookData(data: PersistedWebhookData): Promise<PersistResult> {
    this.persistedItems.push({ path: '/api/v1/webhook-data', data });
    return { success: true, id: `mock-${Date.now()}`, retryable: false };
  }

  override async healthCheck(): Promise<boolean> {
    return true;
  }

  clear(): void {
    this.persistedItems = [];
  }
}
