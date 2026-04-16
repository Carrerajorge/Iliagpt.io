/**
 * BaseProvider — Abstract base class for all LLM provider implementations
 *
 * Provides: retry with exponential backoff, rate limiting, cost tracking,
 * token counting, health tracking, and a standardized request lifecycle.
 */

import EventEmitter from "events";
import {
  type IChatMessage,
  type IChatOptions,
  type IChatResponse,
  type IEmbeddingOptions,
  type IEmbeddingResponse,
  type IModelInfo,
  type IProvider,
  type IProviderConfig,
  type IProviderHealth,
  type IStreamChunk,
  ModelCapability,
  ProviderError,
  ProviderStatus,
  RateLimitError,
} from "./types.js";

// ─────────────────────────────────────────────
// Rate Limiter (token bucket)
// ─────────────────────────────────────────────

class TokenBucket {
  private tokens: number;
  private lastRefillAt: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    this.tokens = capacity;
    this.lastRefillAt = Date.now();
  }

  consume(count = 1): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  waitTime(count = 1): number {
    this.refill();
    if (this.tokens >= count) return 0;
    const needed = count - this.tokens;
    return Math.ceil((needed / this.refillPerSecond) * 1000);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefillAt) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    this.lastRefillAt = now;
  }
}

// ─────────────────────────────────────────────
// Retry Configuration
// ─────────────────────────────────────────────

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  jitter: true,
};

// ─────────────────────────────────────────────
// BaseProvider
// ─────────────────────────────────────────────

export abstract class BaseProvider extends EventEmitter implements IProvider {
  abstract readonly id: string;
  abstract readonly name: string;

  protected _health: IProviderHealth;
  protected _models: IModelInfo[] = [];
  protected _rateLimiter?: TokenBucket;
  protected readonly retryConfig: RetryConfig;

  constructor(
    public readonly config: IProviderConfig,
    retryConfig: Partial<RetryConfig> = {},
  ) {
    super();
    this.retryConfig = { ...DEFAULT_RETRY, ...retryConfig };

    this._health = {
      providerId: config.id,
      status: ProviderStatus.INITIALIZING,
      consecutiveErrors: 0,
      requestCount: 0,
      successCount: 0,
      lastCheckedAt: new Date(),
    };

    // Set up rate limiter if configured (requests per minute → per second)
    if (config.rateLimitRpm) {
      this._rateLimiter = new TokenBucket(config.rateLimitRpm, config.rateLimitRpm / 60);
    }
  }

  get health(): IProviderHealth {
    return { ...this._health };
  }

  // ─── Abstract methods each provider must implement ───

  protected abstract _chat(
    messages: IChatMessage[],
    options: IChatOptions,
  ): Promise<IChatResponse>;

  protected abstract _stream(
    messages: IChatMessage[],
    options: IChatOptions,
  ): AsyncIterable<IStreamChunk>;

  protected abstract _embed(
    texts: string[],
    options: IEmbeddingOptions,
  ): Promise<IEmbeddingResponse>;

  protected abstract _listModels(): Promise<IModelInfo[]>;

  abstract isCapable(capability: ModelCapability): boolean;

  // ─── Public API (wraps abstract methods with cross-cutting concerns) ───

  async chat(messages: IChatMessage[], options: IChatOptions = {}): Promise<IChatResponse> {
    await this.enforceRateLimit();
    this._health.requestCount++;

    const start = Date.now();
    try {
      const response = await this.withRetry(
        () => this._chat(messages, this.mergeDefaults(options)),
        `${this.id}.chat`,
      );
      this.recordSuccess(Date.now() - start);
      return response;
    } catch (err) {
      this.recordError(err);
      throw err;
    }
  }

  async *stream(
    messages: IChatMessage[],
    options: IChatOptions = {},
  ): AsyncIterable<IStreamChunk> {
    await this.enforceRateLimit();
    this._health.requestCount++;

    try {
      yield* this._stream(messages, this.mergeDefaults(options));
      this.recordSuccess();
    } catch (err) {
      this.recordError(err);
      throw err;
    }
  }

  async embed(texts: string[], options: IEmbeddingOptions = {}): Promise<IEmbeddingResponse> {
    await this.enforceRateLimit();
    this._health.requestCount++;

    const start = Date.now();
    try {
      const response = await this.withRetry(
        () => this._embed(texts, options),
        `${this.id}.embed`,
      );
      this.recordSuccess(Date.now() - start);
      return response;
    } catch (err) {
      this.recordError(err);
      throw err;
    }
  }

  async listModels(): Promise<IModelInfo[]> {
    if (this._models.length > 0) return this._models;
    this._models = await this._listModels();
    return this._models;
  }

  async checkHealth(): Promise<IProviderHealth> {
    const start = Date.now();
    try {
      // Minimal health probe — subclasses can override for a real ping
      await this._listModels();
      this._health.status = ProviderStatus.HEALTHY;
      this._health.latencyMs = Date.now() - start;
      this._health.lastCheckedAt = new Date();
      this._health.lastSuccessAt = new Date();
      this._health.consecutiveErrors = 0;
    } catch (err) {
      this._health.status = ProviderStatus.UNAVAILABLE;
      this._health.lastCheckedAt = new Date();
      this._health.lastErrorAt = new Date();
      this._health.lastError = err instanceof Error ? err.message : String(err);
      this._health.consecutiveErrors++;
      this.emit("health_changed", { providerId: this.id, status: this._health.status });
    }
    return { ...this._health };
  }

  // ─── Retry Logic ───

  protected async withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;

        // Don't retry non-retryable errors
        if (err instanceof ProviderError && !err.retryable) throw err;

        if (attempt === this.retryConfig.maxAttempts) break;

        // Handle rate-limit retry-after
        if (err instanceof RateLimitError && err.retryAfterMs) {
          await this.sleep(err.retryAfterMs);
          continue;
        }

        const delay = this.backoffDelay(attempt);
        console.warn(`[${label}] Attempt ${attempt} failed, retrying in ${delay}ms:`, err);
        await this.sleep(delay);
      }
    }
    throw lastError;
  }

  protected backoffDelay(attempt: number): number {
    const base = this.retryConfig.baseDelayMs * Math.pow(2, attempt - 1);
    const capped = Math.min(base, this.retryConfig.maxDelayMs);
    if (!this.retryConfig.jitter) return capped;
    return capped * (0.5 + Math.random() * 0.5);
  }

  // ─── Rate Limiting ───

  protected async enforceRateLimit(): Promise<void> {
    if (!this._rateLimiter) return;
    const waitMs = this._rateLimiter.waitTime(1);
    if (waitMs > 0) {
      if (waitMs > 60_000) {
        throw new RateLimitError(this.id, waitMs);
      }
      await this.sleep(waitMs);
    }
    this._rateLimiter.consume(1);
  }

  // ─── Health Tracking ───

  protected recordSuccess(latencyMs?: number): void {
    this._health.successCount++;
    this._health.consecutiveErrors = 0;
    this._health.lastSuccessAt = new Date();
    if (latencyMs !== undefined) this._health.latencyMs = latencyMs;

    const errorRate = 1 - this._health.successCount / this._health.requestCount;
    this._health.errorRate = errorRate;

    const prevStatus = this._health.status;
    if (errorRate < 0.1) {
      this._health.status = ProviderStatus.HEALTHY;
    } else if (errorRate < 0.5) {
      this._health.status = ProviderStatus.DEGRADED;
    }

    if (prevStatus !== this._health.status) {
      this.emit("health_changed", { providerId: this.id, status: this._health.status });
    }
  }

  protected recordError(err: unknown): void {
    this._health.consecutiveErrors++;
    this._health.lastErrorAt = new Date();
    this._health.lastError = err instanceof Error ? err.message : String(err);

    const errorRate = 1 - this._health.successCount / this._health.requestCount;
    this._health.errorRate = errorRate;

    const prevStatus = this._health.status;
    if (this._health.consecutiveErrors >= 5 || errorRate > 0.5) {
      this._health.status = ProviderStatus.UNAVAILABLE;
    } else if (this._health.consecutiveErrors >= 2 || errorRate > 0.1) {
      this._health.status = ProviderStatus.DEGRADED;
    }

    if (err instanceof RateLimitError) {
      this._health.status = ProviderStatus.RATE_LIMITED;
    }

    if (prevStatus !== this._health.status) {
      this.emit("health_changed", { providerId: this.id, status: this._health.status });
    }
  }

  // ─── Utilities ───

  protected mergeDefaults(options: IChatOptions): IChatOptions {
    return {
      model: this.config.defaultModel,
      temperature: 0.7,
      maxTokens: 4096,
      timeout: this.config.timeout ?? 60_000,
      ...options,
    };
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected generateRequestId(): string {
    return `${this.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Rough token count estimate: ~4 chars per token for English.
   * Subclasses can override with provider-specific tiktoken implementations.
   */
  protected estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  protected calculateCost(
    model: string,
    promptTokens: number,
    completionTokens: number,
  ): number {
    const info = this._models.find((m) => m.id === model);
    if (!info?.pricing) return 0;

    const inputCost = (promptTokens / 1_000_000) * info.pricing.inputPerMillion;
    const outputCost = (completionTokens / 1_000_000) * info.pricing.outputPerMillion;
    return inputCost + outputCost;
  }

  /**
   * Normalize a raw content string — strips extraneous whitespace
   * and handles null/undefined gracefully.
   */
  protected normalizeContent(raw: unknown): string {
    if (typeof raw === "string") return raw.trim();
    if (Array.isArray(raw)) {
      return raw
        .map((part) => (typeof part === "object" && part !== null && "text" in part ? (part as {text: string}).text : ""))
        .join("");
    }
    return "";
  }
}
