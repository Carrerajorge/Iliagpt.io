/**
 * connectorRetryBudget.ts
 * ---------------------------------------------------------------------------
 * Retry budget management for the connector kernel.
 * Provides per-connector sliding-window budgets, adaptive retry policies with
 * exponential backoff + decorrelated jitter, retryable-operation execution,
 * and real-time retry analytics / anomaly detection.
 *
 * Standalone module — no imports from other kernel files.
 * All Map/Set iterators wrapped with Array.from().
 * ---------------------------------------------------------------------------
 */

/* ========================================================================= */
/*  TYPES & INTERFACES                                                       */
/* ========================================================================= */

export interface RetryBudgetConfig {
  /** Maximum retries for a single operation */
  maxRetries: number;
  /** Base delay in milliseconds before exponential backoff */
  baseDelayMs: number;
  /** Maximum delay cap in milliseconds */
  maxDelayMs: number;
  /** Sliding-window duration in milliseconds for budget tracking */
  budgetWindowMs: number;
  /** Maximum retries allowed within the budget window */
  budgetMaxRetries: number;
  /** Jitter factor (0–1) applied to computed delays */
  jitterFactor: number;
  /** Number of consecutive failures before the circuit breaker trips */
  circuitBreakerThreshold: number;
}

export interface RetryAttempt {
  connectorId: string;
  operationId: string;
  attemptNumber: number;
  timestamp: number;
  delayMs: number;
  error?: string;
  statusCode?: number;
  success: boolean;
}

export interface RetryBudgetStatus {
  connectorId: string;
  windowStartMs: number;
  windowEndMs: number;
  retriesUsed: number;
  retriesRemaining: number;
  budgetExhausted: boolean;
  oldestRetryTs: number | null;
  newestRetryTs: number | null;
}

export interface RetryDecision {
  shouldRetry: boolean;
  delayMs: number;
  reason: string;
  attemptNumber: number;
  budgetRemaining: number;
}

export interface RetryOutcome {
  connectorId: string;
  operationId: string;
  totalAttempts: number;
  success: boolean;
  finalError?: string;
  totalElapsedMs: number;
  attempts: RetryAttempt[];
}

export interface RetryOutcomeWithResult<T> extends RetryOutcome {
  result?: T;
}

export interface RetryProgressEvent {
  connectorId: string;
  operationId: string;
  attemptNumber: number;
  maxAttempts: number;
  delayMs: number;
  error?: string;
  timestamp: number;
}

export interface RetryTrendPoint {
  timestamp: number;
  retryCount: number;
  successCount: number;
  failureCount: number;
  avgDelayMs: number;
}

export interface RetryHeatmapCell {
  connectorId: string;
  hour: number;
  retryCount: number;
  successRate: number;
}

export interface MostRetriedOperation {
  operationId: string;
  connectorId: string;
  totalRetries: number;
  successRate: number;
  avgAttempts: number;
  lastRetryTs: number;
}

export interface RetryAnomaly {
  connectorId: string;
  operationId: string;
  type: 'spike' | 'sustained_high' | 'budget_exhaustion' | 'circuit_break';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  detectedAt: number;
  value: number;
  threshold: number;
}

/* ========================================================================= */
/*  PRESET CONFIGURATIONS                                                    */
/* ========================================================================= */

export const CONSERVATIVE_RETRY: Readonly<RetryBudgetConfig> = Object.freeze({
  maxRetries: 2,
  baseDelayMs: 2000,
  maxDelayMs: 30000,
  budgetWindowMs: 60000,
  budgetMaxRetries: 5,
  jitterFactor: 0.3,
  circuitBreakerThreshold: 5,
});

export const AGGRESSIVE_RETRY: Readonly<RetryBudgetConfig> = Object.freeze({
  maxRetries: 5,
  baseDelayMs: 500,
  maxDelayMs: 15000,
  budgetWindowMs: 60000,
  budgetMaxRetries: 20,
  jitterFactor: 0.5,
  circuitBreakerThreshold: 10,
});

export const INSTANT_RETRY: Readonly<RetryBudgetConfig> = Object.freeze({
  maxRetries: 3,
  baseDelayMs: 50,
  maxDelayMs: 500,
  budgetWindowMs: 60000,
  budgetMaxRetries: 30,
  jitterFactor: 0.1,
  circuitBreakerThreshold: 15,
});

export const NO_RETRY: Readonly<RetryBudgetConfig> = Object.freeze({
  maxRetries: 0,
  baseDelayMs: 0,
  maxDelayMs: 0,
  budgetWindowMs: 60000,
  budgetMaxRetries: 0,
  jitterFactor: 0,
  circuitBreakerThreshold: 1,
});

/* ========================================================================= */
/*  GLOBAL CONFIG DEFAULTS & PER-CONNECTOR OVERRIDES                         */
/* ========================================================================= */

const DEFAULT_CONFIG: RetryBudgetConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 20000,
  budgetWindowMs: 60000,
  budgetMaxRetries: 10,
  jitterFactor: 0.25,
  circuitBreakerThreshold: 8,
};

const connectorOverrides = new Map<string, RetryBudgetConfig>();

/**
 * Set a per-connector retry configuration override.
 */
export function setConnectorRetryOverride(
  connectorId: string,
  config: RetryBudgetConfig,
): void {
  connectorOverrides.set(connectorId, { ...config });
}

/**
 * Clear a previously set per-connector override.
 */
export function clearConnectorRetryOverride(connectorId: string): void {
  connectorOverrides.delete(connectorId);
}

/**
 * Resolve the effective config for a connector (override > default).
 */
export function resolveConfig(connectorId: string): RetryBudgetConfig {
  const override = connectorOverrides.get(connectorId);
  if (override) return { ...override };
  return { ...DEFAULT_CONFIG };
}

/* ========================================================================= */
/*  RETRY BUDGET TRACKER                                                     */
/* ========================================================================= */

/**
 * Tracks per-connector sliding-window retry budgets.
 * Each connector is allowed `budgetMaxRetries` retries within a
 * `budgetWindowMs` sliding window.  Stale entries are pruned lazily.
 */
export class RetryBudgetTracker {
  /** connectorId → sorted list of retry timestamps */
  private readonly windows = new Map<string, number[]>();
  /** connectorId → consecutive failure counter (for circuit-breaker) */
  private readonly consecutiveFailures = new Map<string, number>();
  /** connectorId → true when circuit is open (tripped) */
  private readonly circuitOpen = new Map<string, boolean>();
  /** connectorId → timestamp when circuit was opened */
  private readonly circuitOpenedAt = new Map<string, number>();
  /** Circuit-breaker half-open probe window (ms) */
  private readonly circuitHalfOpenMs = 30000;

  /* ------------------------------------------------------------------- */
  /*  Internal helpers                                                    */
  /* ------------------------------------------------------------------- */

  private pruneWindow(connectorId: string, now: number, windowMs: number): number[] {
    const timestamps = this.windows.get(connectorId) ?? [];
    const cutoff = now - windowMs;
    const pruned = timestamps.filter((ts) => ts > cutoff);
    this.windows.set(connectorId, pruned);
    return pruned;
  }

  private isCircuitOpen(connectorId: string, now: number): boolean {
    if (!this.circuitOpen.get(connectorId)) return false;
    const openedAt = this.circuitOpenedAt.get(connectorId) ?? 0;
    if (now - openedAt > this.circuitHalfOpenMs) {
      // Allow a probe request (half-open)
      return false;
    }
    return true;
  }

  private tripCircuit(connectorId: string, now: number): void {
    this.circuitOpen.set(connectorId, true);
    this.circuitOpenedAt.set(connectorId, now);
  }

  private closeCircuit(connectorId: string): void {
    this.circuitOpen.set(connectorId, false);
    this.circuitOpenedAt.delete(connectorId);
    this.consecutiveFailures.set(connectorId, 0);
  }

  /* ------------------------------------------------------------------- */
  /*  Public API                                                          */
  /* ------------------------------------------------------------------- */

  /**
   * Check whether a retry should be allowed for the given connector.
   * Returns a RetryDecision with delay and remaining budget info.
   */
  checkBudget(connectorId: string, attemptNumber: number): RetryDecision {
    const config = resolveConfig(connectorId);
    const now = Date.now();

    // Circuit-breaker check
    if (this.isCircuitOpen(connectorId, now)) {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'circuit_breaker_open',
        attemptNumber,
        budgetRemaining: 0,
      };
    }

    // Max per-operation retries
    if (attemptNumber > config.maxRetries) {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'max_retries_exceeded',
        attemptNumber,
        budgetRemaining: this.getRemainingBudget(connectorId),
      };
    }

    // Sliding-window budget
    const window = this.pruneWindow(connectorId, now, config.budgetWindowMs);
    const remaining = config.budgetMaxRetries - window.length;
    if (remaining <= 0) {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'budget_exhausted',
        attemptNumber,
        budgetRemaining: 0,
      };
    }

    return {
      shouldRetry: true,
      delayMs: 0, // caller uses AdaptiveRetryPolicy for actual delay
      reason: 'budget_available',
      attemptNumber,
      budgetRemaining: remaining,
    };
  }

  /**
   * Record a retry attempt (success or failure) for a connector.
   */
  recordAttempt(connectorId: string, success: boolean): void {
    const config = resolveConfig(connectorId);
    const now = Date.now();

    // Always record the timestamp in the window
    const window = this.pruneWindow(connectorId, now, config.budgetWindowMs);
    window.push(now);
    this.windows.set(connectorId, window);

    if (success) {
      this.closeCircuit(connectorId);
    } else {
      const failures = (this.consecutiveFailures.get(connectorId) ?? 0) + 1;
      this.consecutiveFailures.set(connectorId, failures);
      if (failures >= config.circuitBreakerThreshold) {
        this.tripCircuit(connectorId, now);
      }
    }
  }

  /**
   * Get the current budget status for one connector.
   */
  getStatus(connectorId: string): RetryBudgetStatus {
    const config = resolveConfig(connectorId);
    const now = Date.now();
    const window = this.pruneWindow(connectorId, now, config.budgetWindowMs);
    const windowStart = now - config.budgetWindowMs;
    const remaining = Math.max(0, config.budgetMaxRetries - window.length);

    return {
      connectorId,
      windowStartMs: windowStart,
      windowEndMs: now,
      retriesUsed: window.length,
      retriesRemaining: remaining,
      budgetExhausted: remaining <= 0,
      oldestRetryTs: window.length > 0 ? window[0] : null,
      newestRetryTs: window.length > 0 ? window[window.length - 1] : null,
    };
  }

  /**
   * Get global budget status across all tracked connectors.
   */
  getGlobalStatus(): RetryBudgetStatus[] {
    const connectorIds = Array.from(this.windows.keys());
    return connectorIds.map((id) => this.getStatus(id));
  }

  /**
   * Reset the budget window for a specific connector.
   */
  resetBudget(connectorId: string): void {
    this.windows.delete(connectorId);
    this.consecutiveFailures.delete(connectorId);
    this.closeCircuit(connectorId);
  }

  /**
   * Reset all budgets globally.
   */
  resetAll(): void {
    this.windows.clear();
    this.consecutiveFailures.clear();
    this.circuitOpen.clear();
    this.circuitOpenedAt.clear();
  }

  /**
   * Get remaining budget count for a connector.
   */
  getRemainingBudget(connectorId: string): number {
    const config = resolveConfig(connectorId);
    const now = Date.now();
    const window = this.pruneWindow(connectorId, now, config.budgetWindowMs);
    return Math.max(0, config.budgetMaxRetries - window.length);
  }

  /**
   * Check if the circuit breaker is currently open for a connector.
   */
  isCircuitBreakerOpen(connectorId: string): boolean {
    return this.isCircuitOpen(connectorId, Date.now());
  }

  /**
   * Get the number of consecutive failures for a connector.
   */
  getConsecutiveFailures(connectorId: string): number {
    return this.consecutiveFailures.get(connectorId) ?? 0;
  }

  /**
   * Get the list of connectors whose circuit breaker is currently tripped.
   */
  getTrippedCircuits(): string[] {
    const now = Date.now();
    return Array.from(this.circuitOpen.entries())
      .filter(([id, open]) => open && this.isCircuitOpen(id, now))
      .map(([id]) => id);
  }

  /**
   * Force-close a circuit breaker for a connector (manual override).
   */
  forceCloseCircuit(connectorId: string): void {
    this.closeCircuit(connectorId);
  }

  /**
   * Return a snapshot of all tracked connector IDs.
   */
  getTrackedConnectors(): string[] {
    return Array.from(this.windows.keys());
  }

  /**
   * Get the total number of retries across all connectors in their current windows.
   */
  getGlobalRetryCount(): number {
    let total = 0;
    for (const [id] of Array.from(this.windows.entries())) {
      const config = resolveConfig(id);
      const now = Date.now();
      const window = this.pruneWindow(id, now, config.budgetWindowMs);
      total += window.length;
    }
    return total;
  }
}

/* ========================================================================= */
/*  ADAPTIVE RETRY POLICY                                                    */
/* ========================================================================= */

/** Status codes / error codes that are retryable. */
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404, 405, 409, 410, 422]);

/**
 * Adaptive retry policy using exponential backoff with decorrelated jitter.
 * Classifies errors as retryable or non-retryable, computes delays, and
 * performs adaptive adjustment based on recent history.
 */
export class AdaptiveRetryPolicy {
  /** connectorId → last computed delay (for decorrelated jitter) */
  private readonly lastDelays = new Map<string, number>();
  /** connectorId → recent delay history for adaptive adjustment */
  private readonly delayHistory = new Map<string, number[]>();
  /** Max history entries per connector */
  private readonly maxHistoryEntries = 50;

  /* ------------------------------------------------------------------- */
  /*  Error Classification                                                */
  /* ------------------------------------------------------------------- */

  /**
   * Determine whether a given error/status is retryable.
   */
  isRetryable(error: unknown): boolean {
    if (error === null || error === undefined) return false;

    // Check status code
    if (typeof error === 'object' && error !== null) {
      const err = error as Record<string, unknown>;

      // Explicit status code
      const status = (err.statusCode ?? err.status ?? err.code) as number | string | undefined;
      if (typeof status === 'number') {
        if (NON_RETRYABLE_STATUS_CODES.has(status)) return false;
        if (RETRYABLE_STATUS_CODES.has(status)) return true;
      }

      // Error code string
      const code = err.code as string | undefined;
      if (typeof code === 'string' && RETRYABLE_ERROR_CODES.has(code)) return true;

      // Timeout / network error messages
      const message = (err.message ?? '') as string;
      if (/timeout/i.test(message)) return true;
      if (/econnreset/i.test(message)) return true;
      if (/econnrefused/i.test(message)) return true;
      if (/socket hang up/i.test(message)) return true;
      if (/network/i.test(message)) return true;
      if (/fetch failed/i.test(message)) return true;
      if (/aborted/i.test(message)) return true;

      // Response object nested inside the error
      const response = err.response as Record<string, unknown> | undefined;
      if (response && typeof response.status === 'number') {
        if (NON_RETRYABLE_STATUS_CODES.has(response.status)) return false;
        if (RETRYABLE_STATUS_CODES.has(response.status)) return true;
      }
    }

    // String errors
    if (typeof error === 'string') {
      if (/timeout|econnreset|econnrefused|network|socket hang up/i.test(error)) return true;
    }

    // Default: not retryable for unknown shapes
    return false;
  }

  /**
   * Classify the error into a human-readable category.
   */
  classifyError(error: unknown): string {
    if (error === null || error === undefined) return 'unknown';
    if (typeof error === 'object' && error !== null) {
      const err = error as Record<string, unknown>;
      const status = (err.statusCode ?? err.status) as number | undefined;
      if (status === 429) return 'rate_limited';
      if (status === 408) return 'timeout';
      if (status === 502) return 'bad_gateway';
      if (status === 503) return 'service_unavailable';
      if (status === 504) return 'gateway_timeout';
      if (status === 401) return 'unauthorized';
      if (status === 403) return 'forbidden';
      if (status === 404) return 'not_found';
      if (status === 400) return 'bad_request';

      const code = err.code as string | undefined;
      if (code === 'ECONNRESET') return 'connection_reset';
      if (code === 'ECONNREFUSED') return 'connection_refused';
      if (code === 'ETIMEDOUT') return 'timeout';

      const message = (err.message ?? '') as string;
      if (/timeout/i.test(message)) return 'timeout';
      if (/rate.?limit/i.test(message)) return 'rate_limited';
    }
    return 'unknown';
  }

  /* ------------------------------------------------------------------- */
  /*  Delay Calculation                                                   */
  /* ------------------------------------------------------------------- */

  /**
   * Calculate the delay for the next retry attempt using decorrelated jitter.
   *
   * Algorithm: delay = min(maxDelay, random_between(baseDelay, lastDelay * 3))
   * Then apply jitter factor on top.
   */
  calculateDelay(connectorId: string, attemptNumber: number, error?: unknown): number {
    const config = resolveConfig(connectorId);
    const { baseDelayMs, maxDelayMs, jitterFactor } = config;

    // Decorrelated jitter: new delay based on previous delay
    const lastDelay = this.lastDelays.get(connectorId) ?? baseDelayMs;
    const upperBound = Math.min(maxDelayMs, lastDelay * 3);
    const lowerBound = baseDelayMs;
    const rawDelay = lowerBound + Math.random() * (upperBound - lowerBound);

    // Apply jitter
    const jitter = rawDelay * jitterFactor * (Math.random() * 2 - 1);
    let delay = Math.max(baseDelayMs, Math.min(maxDelayMs, rawDelay + jitter));

    // Rate-limit back-off: if 429, use Retry-After header or double the delay
    if (error && typeof error === 'object' && error !== null) {
      const err = error as Record<string, unknown>;
      const status = (err.statusCode ?? err.status) as number | undefined;
      if (status === 429) {
        const retryAfter = this.extractRetryAfter(err);
        if (retryAfter > 0) {
          delay = Math.max(delay, retryAfter);
        } else {
          delay = Math.min(maxDelayMs, delay * 2);
        }
      }
    }

    // Adaptive adjustment based on recent history
    delay = this.adaptDelay(connectorId, delay);

    // Store for next decorrelated calculation
    delay = Math.round(delay);
    this.lastDelays.set(connectorId, delay);
    this.recordDelayHistory(connectorId, delay);

    return delay;
  }

  /**
   * Full shouldRetry decision combining retryability check, attempt limit, and delay.
   */
  shouldRetry(
    connectorId: string,
    attemptNumber: number,
    error: unknown,
  ): { retry: boolean; delayMs: number; reason: string } {
    const config = resolveConfig(connectorId);

    if (attemptNumber > config.maxRetries) {
      return { retry: false, delayMs: 0, reason: 'max_retries_exceeded' };
    }

    if (!this.isRetryable(error)) {
      return { retry: false, delayMs: 0, reason: `non_retryable_error: ${this.classifyError(error)}` };
    }

    const delayMs = this.calculateDelay(connectorId, attemptNumber, error);
    return { retry: true, delayMs, reason: 'retryable_error' };
  }

  /**
   * Reset stored delay state for a connector.
   */
  resetConnector(connectorId: string): void {
    this.lastDelays.delete(connectorId);
    this.delayHistory.delete(connectorId);
  }

  /**
   * Reset all state.
   */
  resetAll(): void {
    this.lastDelays.clear();
    this.delayHistory.clear();
  }

  /* ------------------------------------------------------------------- */
  /*  Private Helpers                                                     */
  /* ------------------------------------------------------------------- */

  private extractRetryAfter(err: Record<string, unknown>): number {
    const headers = err.headers as Record<string, string> | undefined;
    if (!headers) return 0;
    const retryAfter = headers['retry-after'] ?? headers['Retry-After'];
    if (!retryAfter) return 0;
    const parsed = Number(retryAfter);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed * 1000; // seconds → ms
    const dateMs = Date.parse(retryAfter);
    if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
    return 0;
  }

  private recordDelayHistory(connectorId: string, delay: number): void {
    const history = this.delayHistory.get(connectorId) ?? [];
    history.push(delay);
    if (history.length > this.maxHistoryEntries) {
      history.splice(0, history.length - this.maxHistoryEntries);
    }
    this.delayHistory.set(connectorId, history);
  }

  /**
   * Adaptive adjustment: if recent retries are clustered (many in short time),
   * increase delay; if they are spread out, allow faster retries.
   */
  private adaptDelay(connectorId: string, baseDelay: number): number {
    const history = this.delayHistory.get(connectorId);
    if (!history || history.length < 3) return baseDelay;

    // Average of recent delays
    const recentSlice = history.slice(-5);
    const avgDelay = recentSlice.reduce((a, b) => a + b, 0) / recentSlice.length;

    // If average delay is significantly lower than base, bump it up
    if (avgDelay < baseDelay * 0.5) {
      return baseDelay * 1.2;
    }
    // If average delay is already high, don't pile on too much
    if (avgDelay > baseDelay * 2) {
      return baseDelay * 0.9;
    }
    return baseDelay;
  }

  /**
   * Get the current delay history for a connector (for diagnostics).
   */
  getDelayHistory(connectorId: string): number[] {
    return [...(this.delayHistory.get(connectorId) ?? [])];
  }

  /**
   * Get all connectors with stored delay state.
   */
  getTrackedConnectors(): string[] {
    return Array.from(this.lastDelays.keys());
  }
}

/* ========================================================================= */
/*  RETRYABLE OPERATION EXECUTOR                                             */
/* ========================================================================= */

export interface RetryExecutionOptions<T> {
  connectorId: string;
  operationId: string;
  fn: (signal?: AbortSignal) => Promise<T>;
  signal?: AbortSignal;
  onRetry?: (event: RetryProgressEvent) => void;
  onExhausted?: (outcome: RetryOutcome) => void;
  configOverride?: Partial<RetryBudgetConfig>;
}

/**
 * Executes an async operation with automatic retry, budget integration,
 * adaptive delay, and abort support.
 */
export class RetryableOperationExecutor {
  private readonly tracker: RetryBudgetTracker;
  private readonly policy: AdaptiveRetryPolicy;
  /** operationKey → active AbortController (to allow external cancellation) */
  private readonly activeOperations = new Map<string, AbortController>();
  /** Total operations executed */
  private executionCount = 0;
  /** Total successful executions */
  private successCount = 0;
  /** Total failed executions (after all retries) */
  private failureCount = 0;

  constructor(tracker: RetryBudgetTracker, policy: AdaptiveRetryPolicy) {
    this.tracker = tracker;
    this.policy = policy;
  }

  /**
   * Execute a function with automatic retry.
   */
  async executeWithRetry<T>(options: RetryExecutionOptions<T>): Promise<RetryOutcomeWithResult<T>> {
    const {
      connectorId,
      operationId,
      fn,
      signal,
      onRetry,
      onExhausted,
      configOverride,
    } = options;

    // Apply temporary override if provided
    if (configOverride) {
      const base = resolveConfig(connectorId);
      setConnectorRetryOverride(connectorId, { ...base, ...configOverride });
    }

    const config = resolveConfig(connectorId);
    const opKey = `${connectorId}:${operationId}`;
    const internalAbort = new AbortController();
    this.activeOperations.set(opKey, internalAbort);

    const attempts: RetryAttempt[] = [];
    const startTime = Date.now();
    let lastError: unknown = undefined;
    let result: T | undefined = undefined;
    let success = false;

    try {
      for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        // Check external abort
        if (signal?.aborted) {
          lastError = new Error('Operation aborted by caller');
          break;
        }
        if (internalAbort.signal.aborted) {
          lastError = new Error('Operation aborted internally');
          break;
        }

        // Budget check (skip for first attempt)
        if (attempt > 0) {
          const decision = this.tracker.checkBudget(connectorId, attempt);
          if (!decision.shouldRetry) {
            lastError = new Error(`Retry denied: ${decision.reason}`);
            break;
          }
        }

        const attemptStart = Date.now();
        let delayMs = 0;

        // Delay before retry
        if (attempt > 0) {
          const policyDecision = this.policy.shouldRetry(connectorId, attempt, lastError);
          if (!policyDecision.retry) {
            break;
          }
          delayMs = policyDecision.delayMs;

          // Emit progress event
          if (onRetry) {
            onRetry({
              connectorId,
              operationId,
              attemptNumber: attempt,
              maxAttempts: config.maxRetries + 1,
              delayMs,
              error: lastError instanceof Error ? lastError.message : String(lastError),
              timestamp: Date.now(),
            });
          }

          // Wait
          await this.sleep(delayMs, signal);
        }

        try {
          result = await fn(signal);
          success = true;
          this.tracker.recordAttempt(connectorId, true);

          attempts.push({
            connectorId,
            operationId,
            attemptNumber: attempt,
            timestamp: attemptStart,
            delayMs,
            success: true,
          });
          break;
        } catch (err: unknown) {
          lastError = err;
          this.tracker.recordAttempt(connectorId, false);

          const errObj = err as Record<string, unknown> | null;
          attempts.push({
            connectorId,
            operationId,
            attemptNumber: attempt,
            timestamp: attemptStart,
            delayMs,
            error: err instanceof Error ? err.message : String(err),
            statusCode: typeof errObj?.statusCode === 'number' ? errObj.statusCode as number : undefined,
            success: false,
          });

          // Non-retryable → break immediately
          if (!this.policy.isRetryable(err)) {
            break;
          }
        }
      }
    } finally {
      this.activeOperations.delete(opKey);
      // Clean up temporary override
      if (configOverride) {
        clearConnectorRetryOverride(connectorId);
      }
    }

    this.executionCount++;
    if (success) {
      this.successCount++;
    } else {
      this.failureCount++;
    }

    const outcome: RetryOutcomeWithResult<T> = {
      connectorId,
      operationId,
      totalAttempts: attempts.length,
      success,
      finalError: !success && lastError ? (lastError instanceof Error ? lastError.message : String(lastError)) : undefined,
      totalElapsedMs: Date.now() - startTime,
      attempts,
      result: success ? result : undefined,
    };

    if (!success && onExhausted) {
      onExhausted(outcome);
    }

    return outcome;
  }

  /**
   * Cancel an in-flight operation.
   */
  cancelOperation(connectorId: string, operationId: string): boolean {
    const opKey = `${connectorId}:${operationId}`;
    const controller = this.activeOperations.get(opKey);
    if (controller) {
      controller.abort();
      this.activeOperations.delete(opKey);
      return true;
    }
    return false;
  }

  /**
   * Get all currently active operation keys.
   */
  getActiveOperations(): string[] {
    return Array.from(this.activeOperations.keys());
  }

  /**
   * Get execution statistics.
   */
  getStats(): { total: number; success: number; failure: number; successRate: number } {
    return {
      total: this.executionCount,
      success: this.successCount,
      failure: this.failureCount,
      successRate: this.executionCount > 0 ? this.successCount / this.executionCount : 0,
    };
  }

  /**
   * Reset statistics counters.
   */
  resetStats(): void {
    this.executionCount = 0;
    this.successCount = 0;
    this.failureCount = 0;
  }

  /* ------------------------------------------------------------------- */
  /*  Private Helpers                                                     */
  /* ------------------------------------------------------------------- */

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Aborted'));
        return;
      }
      const timer = setTimeout(resolve, ms);
      if (signal) {
        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error('Aborted during delay'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }
}

/* ========================================================================= */
/*  RETRY ANALYTICS                                                          */
/* ========================================================================= */

interface AnalyticsRecord {
  connectorId: string;
  operationId: string;
  timestamp: number;
  attempts: number;
  success: boolean;
  totalDelayMs: number;
  errorCategory?: string;
}

/**
 * Sliding-window analytics for retry behaviour.  Tracks retry rates,
 * success rates, heatmaps, trends, and detects anomalies.
 */
export class RetryAnalytics {
  private readonly records: AnalyticsRecord[] = [];
  private readonly maxRecords = 5000;
  private readonly anomalyWindowMs = 300_000; // 5 min
  private readonly anomalyThresholdMultiplier = 3;
  private readonly detectedAnomalies: RetryAnomaly[] = [];
  private readonly maxAnomalies = 200;

  /**
   * Record a completed retry operation outcome.
   */
  record(outcome: RetryOutcome): void {
    const totalDelay = outcome.attempts
      .slice(1) // first attempt has no delay
      .reduce((sum, a) => sum + a.delayMs, 0);

    const rec: AnalyticsRecord = {
      connectorId: outcome.connectorId,
      operationId: outcome.operationId,
      timestamp: Date.now(),
      attempts: outcome.totalAttempts,
      success: outcome.success,
      totalDelayMs: totalDelay,
      errorCategory: outcome.finalError ? this.categorizeError(outcome.finalError) : undefined,
    };

    this.records.push(rec);
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }

    this.detectAnomalies(rec);
  }

  /**
   * Get the retry rate (retried / total) within a given window.
   */
  getRetryRate(windowMs: number = 60_000): number {
    const cutoff = Date.now() - windowMs;
    const recent = this.records.filter((r) => r.timestamp > cutoff);
    if (recent.length === 0) return 0;
    const retried = recent.filter((r) => r.attempts > 1).length;
    return retried / recent.length;
  }

  /**
   * Of operations that were retried, what fraction eventually succeeded?
   */
  getSuccessfulRetryRate(windowMs: number = 60_000): number {
    const cutoff = Date.now() - windowMs;
    const retried = this.records.filter((r) => r.timestamp > cutoff && r.attempts > 1);
    if (retried.length === 0) return 0;
    const succeeded = retried.filter((r) => r.success).length;
    return succeeded / retried.length;
  }

  /**
   * Get operations with the most retries.
   */
  getMostRetriedOperations(topN: number = 10): MostRetriedOperation[] {
    const opMap = new Map<string, { records: AnalyticsRecord[]; connectorId: string }>();

    for (const r of this.records) {
      const key = `${r.connectorId}:${r.operationId}`;
      const existing = opMap.get(key);
      if (existing) {
        existing.records.push(r);
      } else {
        opMap.set(key, { records: [r], connectorId: r.connectorId });
      }
    }

    const entries = Array.from(opMap.entries());
    const results: MostRetriedOperation[] = entries.map(([key, val]) => {
      const totalRetries = val.records.reduce((sum, r) => sum + Math.max(0, r.attempts - 1), 0);
      const successes = val.records.filter((r) => r.success).length;
      const avgAttempts = val.records.reduce((sum, r) => sum + r.attempts, 0) / val.records.length;
      const lastTs = Math.max(...val.records.map((r) => r.timestamp));
      const parts = key.split(':');

      return {
        operationId: parts.slice(1).join(':'),
        connectorId: val.connectorId,
        totalRetries,
        successRate: val.records.length > 0 ? successes / val.records.length : 0,
        avgAttempts,
        lastRetryTs: lastTs,
      };
    });

    results.sort((a, b) => b.totalRetries - a.totalRetries);
    return results.slice(0, topN);
  }

  /**
   * Get a heatmap of retry activity by connector and hour of day.
   */
  getRetryHeatmap(): RetryHeatmapCell[] {
    const buckets = new Map<string, { retries: number; successes: number; total: number }>();

    for (const r of this.records) {
      const hour = new Date(r.timestamp).getHours();
      const key = `${r.connectorId}:${hour}`;
      const bucket = buckets.get(key) ?? { retries: 0, successes: 0, total: 0 };
      bucket.total++;
      if (r.attempts > 1) bucket.retries += r.attempts - 1;
      if (r.success) bucket.successes++;
      buckets.set(key, bucket);
    }

    return Array.from(buckets.entries()).map(([key, val]) => {
      const parts = key.split(':');
      return {
        connectorId: parts[0],
        hour: parseInt(parts[1], 10),
        retryCount: val.retries,
        successRate: val.total > 0 ? val.successes / val.total : 0,
      };
    });
  }

  /**
   * Get retry trends as time-series points.
   */
  getRetryTrend(windowMs: number = 300_000, bucketMs: number = 60_000): RetryTrendPoint[] {
    const now = Date.now();
    const cutoff = now - windowMs;
    const recent = this.records.filter((r) => r.timestamp > cutoff);
    const points: RetryTrendPoint[] = [];

    for (let t = cutoff; t < now; t += bucketMs) {
      const bucketEnd = t + bucketMs;
      const inBucket = recent.filter((r) => r.timestamp >= t && r.timestamp < bucketEnd);
      const retryCount = inBucket.filter((r) => r.attempts > 1).length;
      const successCount = inBucket.filter((r) => r.success).length;
      const failureCount = inBucket.filter((r) => !r.success).length;
      const delays = inBucket.filter((r) => r.totalDelayMs > 0).map((r) => r.totalDelayMs);
      const avgDelay = delays.length > 0 ? delays.reduce((a, b) => a + b, 0) / delays.length : 0;

      points.push({
        timestamp: t,
        retryCount,
        successCount,
        failureCount,
        avgDelayMs: Math.round(avgDelay),
      });
    }

    return points;
  }

  /**
   * Get detected anomalies.
   */
  getAnomalies(sinceMs?: number): RetryAnomaly[] {
    if (sinceMs) {
      const cutoff = Date.now() - sinceMs;
      return this.detectedAnomalies.filter((a) => a.detectedAt > cutoff);
    }
    return [...this.detectedAnomalies];
  }

  /**
   * Get per-connector retry statistics.
   */
  getConnectorStats(windowMs: number = 60_000): Map<string, {
    totalOps: number;
    retriedOps: number;
    successRate: number;
    avgAttempts: number;
    avgDelayMs: number;
  }> {
    const cutoff = Date.now() - windowMs;
    const recent = this.records.filter((r) => r.timestamp > cutoff);
    const grouped = new Map<string, AnalyticsRecord[]>();

    for (const r of recent) {
      const existing = grouped.get(r.connectorId) ?? [];
      existing.push(r);
      grouped.set(r.connectorId, existing);
    }

    const result = new Map<string, {
      totalOps: number;
      retriedOps: number;
      successRate: number;
      avgAttempts: number;
      avgDelayMs: number;
    }>();

    for (const [connectorId, recs] of Array.from(grouped.entries())) {
      const retriedOps = recs.filter((r) => r.attempts > 1).length;
      const successes = recs.filter((r) => r.success).length;
      const avgAttempts = recs.reduce((s, r) => s + r.attempts, 0) / recs.length;
      const avgDelay = recs.reduce((s, r) => s + r.totalDelayMs, 0) / recs.length;

      result.set(connectorId, {
        totalOps: recs.length,
        retriedOps,
        successRate: recs.length > 0 ? successes / recs.length : 0,
        avgAttempts,
        avgDelayMs: Math.round(avgDelay),
      });
    }

    return result;
  }

  /**
   * Clear all stored records and anomalies.
   */
  clear(): void {
    this.records.length = 0;
    this.detectedAnomalies.length = 0;
  }

  /**
   * Get total record count.
   */
  getRecordCount(): number {
    return this.records.length;
  }

  /* ------------------------------------------------------------------- */
  /*  Anomaly Detection                                                   */
  /* ------------------------------------------------------------------- */

  private detectAnomalies(latest: AnalyticsRecord): void {
    const now = latest.timestamp;
    const windowStart = now - this.anomalyWindowMs;

    // Get recent records for the same connector
    const connectorRecent = this.records.filter(
      (r) => r.connectorId === latest.connectorId && r.timestamp > windowStart,
    );

    // Spike detection: retry rate suddenly high
    const retryRate = connectorRecent.filter((r) => r.attempts > 1).length / Math.max(1, connectorRecent.length);

    // Compare with historical rate
    const historicalRecords = this.records.filter(
      (r) =>
        r.connectorId === latest.connectorId &&
        r.timestamp <= windowStart &&
        r.timestamp > windowStart - this.anomalyWindowMs * 3,
    );
    const historicalRetryRate =
      historicalRecords.length > 0
        ? historicalRecords.filter((r) => r.attempts > 1).length / historicalRecords.length
        : 0.1; // default baseline

    if (
      retryRate > historicalRetryRate * this.anomalyThresholdMultiplier &&
      connectorRecent.length >= 5
    ) {
      this.addAnomaly({
        connectorId: latest.connectorId,
        operationId: latest.operationId,
        type: 'spike',
        severity: retryRate > 0.8 ? 'critical' : retryRate > 0.5 ? 'high' : 'medium',
        message: `Retry rate spike: ${(retryRate * 100).toFixed(1)}% vs historical ${(historicalRetryRate * 100).toFixed(1)}%`,
        detectedAt: now,
        value: retryRate,
        threshold: historicalRetryRate * this.anomalyThresholdMultiplier,
      });
    }

    // Sustained high failure rate
    const failureRate = connectorRecent.filter((r) => !r.success).length / Math.max(1, connectorRecent.length);
    if (failureRate > 0.7 && connectorRecent.length >= 10) {
      this.addAnomaly({
        connectorId: latest.connectorId,
        operationId: latest.operationId,
        type: 'sustained_high',
        severity: failureRate > 0.9 ? 'critical' : 'high',
        message: `Sustained high failure rate: ${(failureRate * 100).toFixed(1)}% over ${connectorRecent.length} operations`,
        detectedAt: now,
        value: failureRate,
        threshold: 0.7,
      });
    }
  }

  private addAnomaly(anomaly: RetryAnomaly): void {
    // Deduplicate: don't add if a similar anomaly was detected in the last 60s
    const recent = this.detectedAnomalies.find(
      (a) =>
        a.connectorId === anomaly.connectorId &&
        a.type === anomaly.type &&
        anomaly.detectedAt - a.detectedAt < 60_000,
    );
    if (recent) return;

    this.detectedAnomalies.push(anomaly);
    if (this.detectedAnomalies.length > this.maxAnomalies) {
      this.detectedAnomalies.splice(0, this.detectedAnomalies.length - this.maxAnomalies);
    }
  }

  private categorizeError(errorMsg: string): string {
    if (/timeout/i.test(errorMsg)) return 'timeout';
    if (/rate.?limit|429/i.test(errorMsg)) return 'rate_limited';
    if (/connect|socket|network/i.test(errorMsg)) return 'network';
    if (/auth|401|403/i.test(errorMsg)) return 'auth';
    if (/not.?found|404/i.test(errorMsg)) return 'not_found';
    if (/5\d\d|server/i.test(errorMsg)) return 'server_error';
    return 'other';
  }
}

/* ========================================================================= */
/*  SINGLETON EXPORTS                                                        */
/* ========================================================================= */

export const retryBudgetTracker = new RetryBudgetTracker();
export const adaptiveRetryPolicy = new AdaptiveRetryPolicy();
export const retryableExecutor = new RetryableOperationExecutor(retryBudgetTracker, adaptiveRetryPolicy);
export const retryAnalytics = new RetryAnalytics();
