/**
 * Universal LLM Provider System — Abstract Base Provider
 *
 * All concrete providers extend this class. It supplies:
 *   - Exponential-backoff retry with jitter
 *   - Token-bucket rate limiting (in-process)
 *   - Automatic latency & cost measurement wrappers
 *   - Naïve GPT-2 BPE token approximation (no external dependency)
 */

import {
  IProvider,
  IProviderConfig,
  IChatRequest,
  IChatResponse,
  IStreamChunk,
  IEmbedRequest,
  IEmbedResponse,
  IModelInfo,
  ITokenUsage,
  ProviderStatus,
  ProviderError,
  RateLimitError,
  IModelPricing,
} from './types';

// ─── Rate-limiter token bucket ────────────────────────────────────────────────

interface TokenBucket {
  tokens: number;
  lastRefillMs: number;
  capacityPerMin: number;
}

// ─── Retry helpers ────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(base: number, factor = 0.25): number {
  return base * (1 + (Math.random() * 2 - 1) * factor);
}

export function exponentialBackoffWithJitter(attempt: number, baseMs = 500, maxMs = 30_000): number {
  const delay = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  return jitter(delay);
}

// ─── Abstract base ────────────────────────────────────────────────────────────

export abstract class BaseProvider implements IProvider {
  protected config!: IProviderConfig;
  protected _status: ProviderStatus = ProviderStatus.Initializing;

  // Rolling metrics (last 5 min)
  private _requestCount = 0;
  private _errorCount = 0;
  private _totalLatencyMs = 0;

  // Rate limiting buckets
  private _rpmBucket?: TokenBucket;
  private _tpmBucket?: TokenBucket;

  // ── Abstract hooks ──────────────────────────────────────────────────────────

  abstract get name(): string;

  /** Raw provider chat — implement in each subclass. */
  protected abstract _chat(request: IChatRequest): Promise<IChatResponse>;

  /** Raw provider stream — implement in each subclass. */
  protected abstract _stream(request: IChatRequest): AsyncGenerator<IStreamChunk>;

  /** Raw provider embed — implement in each subclass. */
  protected abstract _embed(request: IEmbedRequest): Promise<IEmbedResponse>;

  /** Return supported models. */
  abstract listModels(): Promise<IModelInfo[]>;

  /** Ping the provider endpoint and return true/false. */
  abstract healthCheck(): Promise<boolean>;

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async initialize(config: IProviderConfig): Promise<void> {
    this.config = {
      timeout: 60_000,
      maxRetries: 3,
      ...config,
    };

    if (config.rateLimitRpm) {
      this._rpmBucket = {
        tokens: config.rateLimitRpm,
        lastRefillMs: Date.now(),
        capacityPerMin: config.rateLimitRpm,
      };
    }

    if (config.rateLimitTpm) {
      this._tpmBucket = {
        tokens: config.rateLimitTpm,
        lastRefillMs: Date.now(),
        capacityPerMin: config.rateLimitTpm,
      };
    }

    this._status = ProviderStatus.Active;
  }

  async dispose(): Promise<void> {
    this._status = ProviderStatus.Unavailable;
  }

  get status(): ProviderStatus {
    return this._status;
  }

  // ── Rate limiting ───────────────────────────────────────────────────────────

  protected async acquireRpmToken(): Promise<void> {
    if (!this._rpmBucket) return;
    this._refillBucket(this._rpmBucket);
    if (this._rpmBucket.tokens < 1) {
      const msToRefill = 60_000 - (Date.now() - this._rpmBucket.lastRefillMs);
      throw new RateLimitError(this.name, msToRefill > 0 ? msToRefill : 1_000);
    }
    this._rpmBucket.tokens -= 1;
  }

  protected async acquireTpmTokens(tokens: number): Promise<void> {
    if (!this._tpmBucket) return;
    this._refillBucket(this._tpmBucket);
    if (this._tpmBucket.tokens < tokens) {
      const msToRefill = 60_000 - (Date.now() - this._tpmBucket.lastRefillMs);
      throw new RateLimitError(this.name, msToRefill > 0 ? msToRefill : 1_000);
    }
    this._tpmBucket.tokens -= tokens;
  }

  private _refillBucket(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefillMs;
    if (elapsed >= 60_000) {
      bucket.tokens = bucket.capacityPerMin;
      bucket.lastRefillMs = now;
    } else {
      // Proportional refill
      const refill = (elapsed / 60_000) * bucket.capacityPerMin;
      bucket.tokens = Math.min(bucket.capacityPerMin, bucket.tokens + refill);
      bucket.lastRefillMs = now;
    }
  }

  // ── Public API with retry wrapper ───────────────────────────────────────────

  async chat(request: IChatRequest): Promise<IChatResponse> {
    await this.acquireRpmToken();
    const t0 = Date.now();
    let lastError: unknown;

    for (let attempt = 0; attempt <= (this.config.maxRetries ?? 3); attempt++) {
      try {
        this._requestCount++;
        const response = await this._chat(request);
        const latencyMs = Date.now() - t0;
        this._totalLatencyMs += latencyMs;
        response.latencyMs = latencyMs;
        response.provider = this.name;

        if (response.usage) {
          await this.acquireTpmTokens(response.usage.totalTokens);
        }

        this._status = ProviderStatus.Active;
        return response;
      } catch (err) {
        lastError = err;
        this._errorCount++;

        const isRetryable = err instanceof ProviderError && err.retryable;
        const isRateLimit = err instanceof RateLimitError;

        if (!isRetryable && !isRateLimit) throw err;

        if (attempt < (this.config.maxRetries ?? 3)) {
          const delay = isRateLimit && (err as RateLimitError).retryAfterMs
            ? (err as RateLimitError).retryAfterMs!
            : exponentialBackoffWithJitter(attempt);
          this._status = ProviderStatus.Degraded;
          await sleep(delay);
        }
      }
    }

    this._status = ProviderStatus.Degraded;
    throw lastError;
  }

  async *stream(request: IChatRequest): AsyncGenerator<IStreamChunk> {
    await this.acquireRpmToken();
    this._requestCount++;

    try {
      yield* this._stream({ ...request, stream: true });
      this._status = ProviderStatus.Active;
    } catch (err) {
      this._errorCount++;
      this._status = ProviderStatus.Degraded;
      throw err;
    }
  }

  async embed(request: IEmbedRequest): Promise<IEmbedResponse> {
    await this.acquireRpmToken();
    let lastError: unknown;

    for (let attempt = 0; attempt <= (this.config.maxRetries ?? 3); attempt++) {
      try {
        this._requestCount++;
        const response = await this._embed(request);
        this._status = ProviderStatus.Active;
        return response;
      } catch (err) {
        lastError = err;
        this._errorCount++;

        const isRetryable = err instanceof ProviderError && err.retryable;
        if (!isRetryable) throw err;

        if (attempt < (this.config.maxRetries ?? 3)) {
          await sleep(exponentialBackoffWithJitter(attempt));
          this._status = ProviderStatus.Degraded;
        }
      }
    }

    this._status = ProviderStatus.Degraded;
    throw lastError;
  }

  // ── Token counting ──────────────────────────────────────────────────────────

  /**
   * Approximation: ~4 chars per token for English prose.
   * Override in subclass for exact tiktoken or model-specific counting.
   */
  getTokenCount(text: string, _model?: string): number {
    if (!text) return 0;
    // Rough BPE approximation without external dep
    const words = text.trim().split(/\s+/).length;
    const chars = text.length;
    // Weighted blend: 75% word-based (1.3 tokens/word), 25% char-based (4 chars/token)
    return Math.ceil(0.75 * words * 1.3 + 0.25 * chars / 4);
  }

  getMessagesTokenCount(messages: IChatRequest['messages'], model?: string): number {
    return messages.reduce((sum, msg) => {
      const content = typeof msg.content === 'string'
        ? msg.content
        : msg.content.map((c) => c.text ?? '').join(' ');
      return sum + this.getTokenCount(content, model) + 4; // overhead per message
    }, 0);
  }

  // ── Cost calculation ────────────────────────────────────────────────────────

  protected calculateCost(usage: ITokenUsage, pricing: IModelPricing): number {
    const inputCost = (usage.promptTokens / 1_000_000) * pricing.inputPerMillion;
    const outputCost = (usage.completionTokens / 1_000_000) * pricing.outputPerMillion;
    const cachedCost = usage.cachedTokens && pricing.cachedInputPerMillion
      ? (usage.cachedTokens / 1_000_000) * pricing.cachedInputPerMillion
      : 0;
    return inputCost + outputCost + cachedCost;
  }

  // ── Metrics ─────────────────────────────────────────────────────────────────

  getMetrics() {
    const total = this._requestCount;
    return {
      provider: this.name,
      requestCount: total,
      errorCount: this._errorCount,
      successRate: total > 0 ? (total - this._errorCount) / total : 1,
      avgLatencyMs: total > 0 ? this._totalLatencyMs / total : 0,
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  protected buildUsage(
    promptTokens: number,
    completionTokens: number,
    extra?: Partial<ITokenUsage>,
  ): ITokenUsage {
    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      ...extra,
    };
  }

  protected generateId(prefix = 'resp'): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /** Normalize finish reason from various provider strings. */
  protected normalizeFinishReason(
    raw: string | null | undefined,
  ): IChatResponse['finishReason'] {
    if (!raw) return null;
    const r = raw.toLowerCase();
    if (r === 'stop' || r === 'end_turn') return 'stop';
    if (r === 'length' || r === 'max_tokens') return 'length';
    if (r.includes('tool')) return 'tool_calls';
    if (r.includes('filter') || r.includes('safety') || r.includes('content')) return 'content_filter';
    return 'stop';
  }
}
