/**
 * Universal LLM Provider System — BaseProvider
 *
 * Abstract base class that every concrete provider (OpenAI, Anthropic, xAI,
 * Gemini, …) must extend.  It wires together:
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  public chat() / stream() / embed()                     │
 *   │    ↓  rate-limiter (token bucket)                       │
 *   │    ↓  circuit breaker (closed → open → half-open)       │
 *   │    ↓  timeout wrapper                                   │
 *   │    ↓  exponential back-off retry loop                   │
 *   │    ↓  _chat() / _stream() / _embed()  ← subclass impl  │
 *   │    ↓  telemetry / event emission                        │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Concrete providers only implement the private `_chat`, `_stream`, `_embed`,
 * and `_listModels` methods; all cross-cutting concerns live here.
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import { Logger } from '../../logger';
import {
  type IProvider,
  type IProviderConfig,
  type IChatMessage,
  type IChatOptions,
  type IChatResponse,
  type IStreamChunk,
  type StreamHandler,
  type IEmbedOptions,
  type IEmbedResponse,
  type IModelInfo,
  type IHealthCheckResult,
  type ITokenUsage,
  type RequestEventPayload,
  type StatusChangedPayload,
  ProviderStatus,
  ProviderEvents,
  ProviderError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  ProviderAuthError,
  ProviderContentFilterError,
  classifyProviderError,
  estimateMessagesTokenCount,
} from './types';

// ============================================================================
// Internal circuit-breaker state
// ============================================================================

const enum CircuitState {
  CLOSED    = 'closed',
  OPEN      = 'open',
  HALF_OPEN = 'half_open',
}

interface CircuitBreakerState {
  state          : CircuitState;
  failures       : number;
  successes      : number;
  lastFailureAt  : number;
  /** Monotonic ms timestamp when the circuit will enter HALF_OPEN. */
  openUntil      : number;
}

// ============================================================================
// Internal token-bucket rate limiter
// ============================================================================

interface TokenBucket {
  /** Remaining requests in the current window. */
  requestTokens : number;
  /** Remaining token (LLM) budget in the current window. */
  llmTokens     : number;
  /** Epoch ms when the buckets were last refilled. */
  lastRefillAt  : number;
  /** Semaphore tracking current in-flight requests. */
  inflight      : number;
}

// ============================================================================
// Abstract BaseProvider
// ============================================================================

export abstract class BaseProvider extends EventEmitter implements IProvider {
  public readonly name  : string;
  public readonly config: IProviderConfig;
  public status         : ProviderStatus = ProviderStatus.INITIALIZING;

  // Circuit breaker
  private readonly _cb: CircuitBreakerState = {
    state         : CircuitState.CLOSED,
    failures      : 0,
    successes     : 0,
    lastFailureAt : 0,
    openUntil     : 0,
  };
  private readonly CB_FAILURE_THRESHOLD  = 5;   // trips after N consecutive failures
  private readonly CB_SUCCESS_THRESHOLD  = 2;   // heals after N successes in HALF_OPEN
  private readonly CB_HALF_OPEN_DELAY_MS = 30_000; // 30 s before trying again

  // Token bucket
  private readonly _bucket: TokenBucket;

  // HealthCheck history (last 10 results drive reliabilityScore)
  private readonly _healthHistory: Array<{ ok: boolean; latencyMs: number }> = [];
  private readonly _HEALTH_HISTORY_MAX = 10;

  // Whether dispose() has been called.
  private _disposed = false;

  constructor(config: IProviderConfig) {
    super();
    this.name   = config.name;
    this.config = config;

    this._bucket = {
      requestTokens : config.rateLimit.requestsPerMinute,
      llmTokens     : config.rateLimit.tokensPerMinute,
      lastRefillAt  : Date.now(),
      inflight      : 0,
    };
  }

  // ==========================================================================
  // Public API — Template Method implementations
  // ==========================================================================

  /**
   * Blocking chat completion with full retry / circuit-breaker / rate-limit
   * pipeline.  Delegates to abstract `_chat()` for the actual HTTP call.
   */
  async chat(messages: IChatMessage[], options?: IChatOptions): Promise<IChatResponse> {
    const requestId = options?.requestId ?? this._newRequestId();
    const opts      = { ...options, requestId };

    await this._checkCircuit(requestId);
    await this._acquireRateLimit(estimateMessagesTokenCount(messages), requestId);

    const start = Date.now();
    try {
      const response = await this._withRetry(
        () => this._withTimeout(() => this._chat(messages, opts), opts.timeoutMs ?? this.config.timeoutMs, requestId),
        requestId,
      );
      this._onSuccess(response.usage, Date.now() - start, requestId, response.model);
      return response;
    } catch (err) {
      const typed = classifyProviderError(err, this.name, requestId);
      this._onFailure(typed, Date.now() - start, requestId);
      throw typed;
    } finally {
      this._releaseRateLimit();
    }
  }

  /**
   * Streaming chat completion.  Each token chunk is delivered to `onChunk`;
   * the method resolves with a full `IChatResponse` when the stream finishes.
   */
  async stream(
    messages : IChatMessage[],
    onChunk  : StreamHandler,
    options? : IChatOptions,
  ): Promise<IChatResponse> {
    const requestId = options?.requestId ?? this._newRequestId();
    const opts      = { ...options, requestId };

    await this._checkCircuit(requestId);
    await this._acquireRateLimit(estimateMessagesTokenCount(messages), requestId);

    const start = Date.now();
    try {
      const response = await this._withRetry(
        () => this._withTimeout(
          () => this._stream(messages, onChunk, opts),
          opts.timeoutMs ?? this.config.timeoutMs,
          requestId,
        ),
        requestId,
      );
      this._onSuccess(response.usage, Date.now() - start, requestId, response.model);
      return response;
    } catch (err) {
      const typed = classifyProviderError(err, this.name, requestId);
      this._onFailure(typed, Date.now() - start, requestId);
      throw typed;
    } finally {
      this._releaseRateLimit();
    }
  }

  /** Text embedding with full retry / circuit / rate-limit pipeline. */
  async embed(texts: string[], options?: IEmbedOptions): Promise<IEmbedResponse> {
    const requestId = options?.requestId ?? this._newRequestId();
    const opts      = { ...options, requestId };

    await this._checkCircuit(requestId);
    // Rough token estimate for rate-limit accounting.
    const approxTokens = texts.reduce((s, t) => s + Math.ceil(t.length / 4), 0);
    await this._acquireRateLimit(approxTokens, requestId);

    const start = Date.now();
    try {
      const response = await this._withRetry(
        () => this._withTimeout(() => this._embed(texts, opts), this.config.timeoutMs, requestId),
        requestId,
      );
      this._onSuccess(
        { promptTokens: response.usage.promptTokens, completionTokens: 0, totalTokens: response.usage.totalTokens },
        Date.now() - start,
        requestId,
        response.model,
      );
      return response;
    } catch (err) {
      const typed = classifyProviderError(err, this.name, requestId);
      this._onFailure(typed, Date.now() - start, requestId);
      throw typed;
    } finally {
      this._releaseRateLimit();
    }
  }

  /** Returns model catalogue; delegates to abstract `_listModels()`. */
  async listModels(): Promise<IModelInfo[]> {
    try {
      return await this._listModels();
    } catch (err) {
      Logger.warn(`[${this.name}] listModels() failed`, err);
      return [];
    }
  }

  /**
   * Lightweight liveness probe used by the registry health-check loop.
   * Subclasses may override `_healthProbe()` to send a minimal real request.
   * The default implementation sends a single-token completion.
   */
  async healthCheck(): Promise<IHealthCheckResult> {
    const start = Date.now();
    try {
      await this._healthProbe();
      const latencyMs = Date.now() - start;
      this._recordHealthOutcome(true, latencyMs);
      this._setStatus(ProviderStatus.ACTIVE);
      return {
        provider   : this.name,
        status     : ProviderStatus.ACTIVE,
        latencyMs,
        checkedAt  : new Date(),
        configValid: true,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      this._recordHealthOutcome(false, latencyMs);

      const typed = classifyProviderError(err, this.name, 'health-check');
      let nextStatus = ProviderStatus.UNAVAILABLE;

      if (typed instanceof ProviderRateLimitError) {
        nextStatus = ProviderStatus.RATE_LIMITED;
      } else if (typed instanceof ProviderAuthError) {
        nextStatus = ProviderStatus.UNAVAILABLE;
      } else {
        // Use recent history to decide degraded vs unavailable.
        nextStatus = this._computeStatusFromHistory();
      }

      this._setStatus(nextStatus);

      return {
        provider   : this.name,
        status     : nextStatus,
        latencyMs,
        checkedAt  : new Date(),
        message    : typed.message,
        configValid: !(typed instanceof ProviderAuthError),
      };
    }
  }

  /** Release resources. Should be idempotent. */
  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    await this._dispose();
    this._setStatus(ProviderStatus.UNAVAILABLE);
    this.removeAllListeners();
    Logger.info(`[${this.name}] Disposed.`);
  }

  // ==========================================================================
  // Token counting (overridable for providers with native tiktoken bindings)
  // ==========================================================================

  /**
   * Estimate token count for a string.  Subclasses that have access to a
   * proper tokenizer should override this for accuracy.
   */
  countTokens(text: string): number {
    return Math.ceil(text.length / 4) + 3;
  }

  countMessagesTokens(messages: IChatMessage[]): number {
    return estimateMessagesTokenCount(messages);
  }

  /**
   * Compute the estimated USD cost for a completed response.
   */
  computeCost(usage: ITokenUsage, model: IModelInfo): number {
    const inputCost  = (usage.promptTokens     / 1_000_000) * model.pricing.inputPer1M;
    const outputCost = (usage.completionTokens / 1_000_000) * model.pricing.outputPer1M;
    return inputCost + outputCost;
  }

  // ==========================================================================
  // Abstract methods — concrete providers implement these
  // ==========================================================================

  /** Actual HTTP call for a blocking chat completion. */
  protected abstract _chat(messages: IChatMessage[], options: IChatOptions): Promise<IChatResponse>;

  /** Actual HTTP call for a streaming chat completion. */
  protected abstract _stream(
    messages : IChatMessage[],
    onChunk  : StreamHandler,
    options  : IChatOptions,
  ): Promise<IChatResponse>;

  /** Actual HTTP call for text embedding. */
  protected abstract _embed(texts: string[], options: IEmbedOptions): Promise<IEmbedResponse>;

  /** Fetch available models from the provider's API (or return a static list). */
  protected abstract _listModels(): Promise<IModelInfo[]>;

  /**
   * Override to send a real but minimal API call for liveness checking.
   * Default sends a 1-token completion — override if the provider has a
   * dedicated /health or /ping endpoint.
   */
  protected async _healthProbe(): Promise<void> {
    await this._chat(
      [{ role: 'user', content: 'ping' }],
      { maxTokens: 1, requestId: 'health-probe' },
    );
  }

  /** Override to clean up provider-specific resources (HTTP clients, etc.). */
  protected async _dispose(): Promise<void> {
    // Default: nothing to clean up.
  }

  // ==========================================================================
  // Circuit Breaker
  // ==========================================================================

  private async _checkCircuit(requestId: string): Promise<void> {
    const cb  = this._cb;
    const now = Date.now();

    if (cb.state === CircuitState.OPEN) {
      if (now < cb.openUntil) {
        throw new ProviderError({
          message  : `[${this.name}] Circuit breaker is OPEN — requests blocked until ${new Date(cb.openUntil).toISOString()}`,
          provider : this.name,
          requestId,
          retryable: true,
          statusCode: 503,
        });
      }
      // Transition to HALF_OPEN to probe recovery.
      Logger.info(`[${this.name}] Circuit transitioning OPEN → HALF_OPEN`);
      cb.state    = CircuitState.HALF_OPEN;
      cb.successes = 0;
    }
  }

  private _recordCircuitSuccess(): void {
    const cb = this._cb;
    cb.failures = 0;

    if (cb.state === CircuitState.HALF_OPEN) {
      cb.successes++;
      if (cb.successes >= this.CB_SUCCESS_THRESHOLD) {
        Logger.info(`[${this.name}] Circuit healed HALF_OPEN → CLOSED`);
        cb.state    = CircuitState.CLOSED;
        cb.successes = 0;
      }
    }
  }

  private _recordCircuitFailure(err: ProviderError): void {
    const cb = this._cb;

    // Non-retryable errors (auth, content filter) don't contribute to the
    // circuit — they reflect configuration issues, not availability.
    if (!err.retryable) return;

    cb.failures++;
    cb.lastFailureAt = Date.now();

    if (cb.state === CircuitState.HALF_OPEN || cb.failures >= this.CB_FAILURE_THRESHOLD) {
      const openUntil = Date.now() + this.CB_HALF_OPEN_DELAY_MS;
      Logger.warn(
        `[${this.name}] Circuit tripped → OPEN (${cb.failures} failures). ` +
        `Resumes at ${new Date(openUntil).toISOString()}`,
      );
      cb.state    = CircuitState.OPEN;
      cb.openUntil = openUntil;
      cb.successes = 0;
      this._setStatus(ProviderStatus.UNAVAILABLE);
    }
  }

  // ==========================================================================
  // Token Bucket Rate Limiter
  // ==========================================================================

  private _refillBucket(): void {
    const cfg    = this.config.rateLimit;
    const now    = Date.now();
    const bucket = this._bucket;
    const elapsedMs = now - bucket.lastRefillAt;

    if (elapsedMs <= 0) return;

    // Refill request tokens proportionally to time elapsed.
    if (cfg.requestsPerMinute > 0) {
      const refillRate = cfg.requestsPerMinute / 60_000; // tokens per ms
      bucket.requestTokens = Math.min(
        cfg.requestsPerMinute,
        bucket.requestTokens + elapsedMs * refillRate,
      );
    }

    // Refill LLM token budget.
    if (cfg.tokensPerMinute > 0) {
      const refillRate = cfg.tokensPerMinute / 60_000;
      bucket.llmTokens = Math.min(
        cfg.tokensPerMinute,
        bucket.llmTokens + elapsedMs * refillRate,
      );
    }

    bucket.lastRefillAt = now;
  }

  private async _acquireRateLimit(estimatedTokens: number, requestId: string): Promise<void> {
    const cfg    = this.config.rateLimit;
    const bucket = this._bucket;

    // Poll with back-off until we can acquire both limits.
    let waited = 0;
    const maxWaitMs = 10_000;

    while (true) {
      this._refillBucket();

      const requestOk = cfg.requestsPerMinute <= 0 || bucket.requestTokens >= 1;
      const llmOk     = cfg.tokensPerMinute   <= 0 || bucket.llmTokens     >= estimatedTokens;
      const inflightOk= cfg.maxConcurrent     <= 0 || bucket.inflight       < cfg.maxConcurrent;

      if (requestOk && llmOk && inflightOk) {
        if (cfg.requestsPerMinute > 0) bucket.requestTokens -= 1;
        if (cfg.tokensPerMinute   > 0) bucket.llmTokens     -= estimatedTokens;
        bucket.inflight++;
        return;
      }

      if (waited >= maxWaitMs) {
        throw new ProviderRateLimitError({
          message  : `[${this.name}] Client-side rate limit exceeded after ${maxWaitMs}ms`,
          provider : this.name,
          requestId,
          statusCode: 429,
        });
      }

      // Log once when we first start waiting.
      if (waited === 0) {
        Logger.warn(`[${this.name}] Rate-limit backpressure on request ${requestId} — queuing`);
        this._setStatus(ProviderStatus.RATE_LIMITED);
      }

      const delay = Math.min(200, maxWaitMs - waited);
      await this._sleep(delay);
      waited += delay;
    }
  }

  private _releaseRateLimit(): void {
    this._bucket.inflight = Math.max(0, this._bucket.inflight - 1);
  }

  // ==========================================================================
  // Retry with exponential back-off
  // ==========================================================================

  private async _withRetry<T>(fn: () => Promise<T>, requestId: string): Promise<T> {
    const policy = this.config.retry;
    let   lastErr: ProviderError | undefined;

    for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
      try {
        const result = await fn();
        return result;
      } catch (err) {
        const typed = classifyProviderError(err, this.name, requestId);

        // Non-retryable errors propagate immediately.
        if (!typed.retryable || attempt === policy.maxRetries) {
          throw typed;
        }

        // 429 with a Retry-After header — honour it.
        let delayMs: number;
        if (typed instanceof ProviderRateLimitError && typed.retryAfterMs) {
          delayMs = typed.retryAfterMs;
        } else {
          delayMs = Math.min(
            policy.baseDelayMs * Math.pow(policy.backoffFactor, attempt),
            policy.maxDelayMs,
          );
          // Jitter ±10% to spread thundering-herd retries.
          delayMs = delayMs * (0.9 + Math.random() * 0.2);
        }

        Logger.warn(
          `[${this.name}] Attempt ${attempt + 1}/${policy.maxRetries + 1} failed ` +
          `(${typed.message}) — retrying in ${Math.round(delayMs)}ms`,
        );

        lastErr = typed;
        await this._sleep(delayMs);
      }
    }

    throw lastErr!;
  }

  // ==========================================================================
  // Timeout wrapper
  // ==========================================================================

  private async _withTimeout<T>(fn: () => Promise<T>, timeoutMs: number, requestId: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new ProviderTimeoutError({
          message  : `[${this.name}] Request ${requestId} timed out after ${timeoutMs}ms`,
          provider : this.name,
          requestId,
        }));
      }, timeoutMs);

      fn().then(
        (result) => { clearTimeout(timer); resolve(result); },
        (err)    => { clearTimeout(timer); reject(err); },
      );
    });
  }

  // ==========================================================================
  // Success / Failure hooks
  // ==========================================================================

  private _onSuccess(
    usage    : ITokenUsage,
    latencyMs: number,
    requestId: string,
    model    : string,
  ): void {
    this._recordCircuitSuccess();

    // Recover status if we were degraded/rate-limited and requests are succeeding again.
    if (this.status !== ProviderStatus.ACTIVE) {
      this._setStatus(ProviderStatus.ACTIVE);
    }

    const payload: RequestEventPayload = {
      provider  : this.name,
      model,
      requestId,
      latencyMs,
      tokenUsage: usage,
    };
    this.emit(ProviderEvents.REQUEST_SUCCESS, payload);
    Logger.debug(`[${this.name}] ✓ ${requestId} ${latencyMs}ms ${usage.totalTokens} tokens`);
  }

  private _onFailure(err: ProviderError, latencyMs: number, requestId: string): void {
    this._recordCircuitFailure(err);

    const payload: RequestEventPayload = {
      provider : this.name,
      model    : 'unknown',
      requestId,
      latencyMs,
      error    : err,
    };
    this.emit(ProviderEvents.REQUEST_FAILURE, payload);
    Logger.error(`[${this.name}] ✗ ${requestId} — ${err.message}`);
  }

  // ==========================================================================
  // Status management
  // ==========================================================================

  private _setStatus(next: ProviderStatus): void {
    if (this.status === next) return;
    const previous = this.status;
    this.status    = next;

    const payload: StatusChangedPayload = {
      provider : this.name,
      previous,
      current  : next,
      timestamp: new Date(),
    };
    this.emit(ProviderEvents.STATUS_CHANGED, payload);
    Logger.info(`[${this.name}] Status: ${previous} → ${next}`);
  }

  // ==========================================================================
  // Health history helpers
  // ==========================================================================

  private _recordHealthOutcome(ok: boolean, latencyMs: number): void {
    this._healthHistory.push({ ok, latencyMs });
    if (this._healthHistory.length > this._HEALTH_HISTORY_MAX) {
      this._healthHistory.shift();
    }
  }

  /**
   * Derive ProviderStatus from the last N health-check outcomes.
   * - ≥80% success → ACTIVE
   * - 50–79% success → DEGRADED
   * - <50% success → UNAVAILABLE
   */
  private _computeStatusFromHistory(): ProviderStatus {
    if (this._healthHistory.length === 0) return ProviderStatus.UNAVAILABLE;
    const successRate = this._healthHistory.filter(h => h.ok).length / this._healthHistory.length;
    if (successRate >= 0.8) return ProviderStatus.ACTIVE;
    if (successRate >= 0.5) return ProviderStatus.DEGRADED;
    return ProviderStatus.UNAVAILABLE;
  }

  /**
   * Compute a reliability score (0–1) based on recent health-check history.
   * Exposed so the registry can use it for model selection scoring.
   */
  get reliabilityScore(): number {
    if (this._healthHistory.length === 0) return 0.5; // assume average until we have data
    return this._healthHistory.filter(h => h.ok).length / this._healthHistory.length;
  }

  /**
   * Compute the average observed latency from health-check history (ms).
   */
  get averageLatencyMs(): number {
    if (this._healthHistory.length === 0) return 9999;
    const sum = this._healthHistory.reduce((s, h) => s + h.latencyMs, 0);
    return sum / this._healthHistory.length;
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  protected _newRequestId(): string {
    return `${this.name}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** Returns true if the provider is currently able to accept requests. */
  get isAvailable(): boolean {
    return (
      this.status === ProviderStatus.ACTIVE ||
      this.status === ProviderStatus.DEGRADED
    ) && this._cb.state !== CircuitState.OPEN;
  }

  /** Human-readable summary for logging / admin dashboards. */
  describe(): string {
    return (
      `[${this.name}] status=${this.status} ` +
      `circuit=${this._cb.state} ` +
      `reliability=${(this.reliabilityScore * 100).toFixed(0)}% ` +
      `p50Latency=${Math.round(this.averageLatencyMs)}ms`
    );
  }
}
