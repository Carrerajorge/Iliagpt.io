/**
 * Cognitive Middleware — rate limit + quota layer (Turn E).
 *
 * A single small contract, `RateLimiter`, abstracts every kind of
 * "this request should be throttled" decision the middleware has
 * to make: per-user rate limits, per-provider quotas, per-IP DoS
 * guards, burst caps, daily budgets. The contract is minimal on
 * purpose so production can swap the in-memory token-bucket impl
 * below for a Redis-backed, multi-node-aware one without touching
 * the middleware.
 *
 * The in-memory token-bucket impl is enough for:
 *
 *   • Tests — deterministic, no wall-clock races beyond what the
 *     caller controls.
 *   • Dev / local deployments — zero external dependencies.
 *   • Single-process production shards where rate limits are
 *     "per process" and multi-instance coordination is not
 *     required.
 *
 * Algorithm:
 *
 *   Each key ("alice", "alice:qa", "provider:claude") gets its
 *   own bucket with fixed `capacity` and a refill rate of
 *   `refillPerSecond` tokens/second. A call of `cost` tokens:
 *
 *     1. Lazy-refills the bucket based on elapsed wall time
 *        since the last refill (no background timers).
 *     2. If `tokens >= cost`, subtract and return `allowed: true`.
 *     3. Otherwise compute `retryAfterMs = (cost - tokens) /
 *        refillPerSecond * 1000`, return `allowed: false`.
 *
 * The lazy-refill pattern matters: a bucket that hasn't been
 * checked in a week should behave as "full" when next called,
 * without us running a timer to fill it every 100 ms.
 *
 * Hard guarantees:
 *
 *   • `check` NEVER throws. Bad inputs (negative cost, NaN key)
 *     return `allowed: false` with a diagnostic code so the
 *     middleware can encode them into the response.
 *
 *   • `check` is async because production impls will be I/O-bound.
 *     The in-memory version resolves synchronously for low
 *     latency.
 *
 *   • Stateless across instances is NOT a goal here. Callers that
 *     need cross-node rate limits should use a Redis-backed impl.
 */

// ---------------------------------------------------------------------------
// Shape contracts
// ---------------------------------------------------------------------------

/**
 * What `RateLimiter.check` returns. Always has a structural result
 * — even denials carry enough info for the middleware to set a
 * meaningful `Retry-After` header or tell the user how long to
 * wait.
 */
export interface RateLimitCheckResult {
  /** True iff the request is allowed to proceed. */
  allowed: boolean;
  /**
   * Tokens left in the bucket AFTER this call. Useful for
   * progressive UI messaging ("3 of 10 requests remaining today").
   * For denials this is the count BEFORE the call (we don't
   * subtract when we deny).
   */
  remaining: number;
  /**
   * Bucket capacity for observability. Same value every call per
   * key — lets dashboards render "8 / 10" style indicators.
   */
  capacity: number;
  /**
   * If denied, how long to wait (ms) before the bucket will have
   * enough tokens to satisfy this cost. Undefined when allowed.
   */
  retryAfterMs?: number;
  /**
   * The key the limiter used to make the decision. Useful when
   * the caller routes through a tiered limiter that may pick
   * different keys for different requests.
   */
  limiterKey: string;
  /**
   * Stable error code when allowed=false. Codes:
   *   • "rate_limited"     — bucket empty, refill pending
   *   • "invalid_cost"     — caller passed an invalid cost
   *   • "limiter_error"    — internal impl failure (only from
   *     production-grade impls backed by I/O)
   */
  code?: "rate_limited" | "invalid_cost" | "limiter_error";
}

/**
 * The single seam between the cognitive pipeline and any throttle
 * backend. Implementations MUST:
 *
 *   • Treat `check` as a fire-once decision. Each call should
 *     either consume tokens OR be a no-op (on denials) — nothing
 *     in between.
 *   • Be safe for concurrent invocations from different requests.
 *     The in-memory impl below is single-process safe because
 *     Node executes one microtask at a time and the check-then-
 *     mutate sequence is atomic within a single tick.
 *   • Never throw. Bad inputs or internal errors become
 *     `allowed: false` with a diagnostic code.
 */
export interface RateLimiter {
  readonly name: string;
  check(key: string, cost?: number): Promise<RateLimitCheckResult>;
}

// ---------------------------------------------------------------------------
// In-memory token bucket
// ---------------------------------------------------------------------------

export interface TokenBucketOptions {
  /** Adapter name override. Default "token-bucket". */
  name?: string;
  /** Max tokens a bucket can hold. Must be > 0. */
  capacity: number;
  /** Refill rate in tokens per second. Must be ≥ 0. */
  refillPerSecond: number;
  /**
   * Initial tokens in a fresh bucket. Defaults to `capacity`
   * (a user's very first request is never limited).
   */
  initialTokens?: number;
  /**
   * Optional clock for deterministic tests. When supplied, the
   * limiter reads time from this function instead of `Date.now`.
   */
  now?: () => number;
}

interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

export class InMemoryTokenBucketLimiter implements RateLimiter {
  readonly name: string;
  private readonly buckets: Map<string, BucketState> = new Map();
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly initialTokens: number;
  private readonly now: () => number;

  constructor(options: TokenBucketOptions) {
    if (!(options.capacity > 0)) {
      throw new Error(
        "InMemoryTokenBucketLimiter: capacity must be a positive number",
      );
    }
    if (!(options.refillPerSecond >= 0)) {
      throw new Error(
        "InMemoryTokenBucketLimiter: refillPerSecond must be ≥ 0",
      );
    }
    this.name = options.name ?? "token-bucket";
    this.capacity = options.capacity;
    this.refillPerSecond = options.refillPerSecond;
    this.initialTokens = options.initialTokens ?? options.capacity;
    this.now = options.now ?? Date.now;
  }

  async check(key: string, cost: number = 1): Promise<RateLimitCheckResult> {
    if (typeof cost !== "number" || Number.isNaN(cost) || cost < 0) {
      return {
        allowed: false,
        remaining: 0,
        capacity: this.capacity,
        limiterKey: key,
        code: "invalid_cost",
      };
    }

    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        tokens: this.initialTokens,
        lastRefillMs: now,
      };
      this.buckets.set(key, bucket);
    } else {
      // Lazy refill: add (elapsed * rate) tokens capped at capacity.
      const elapsedSec = Math.max(0, (now - bucket.lastRefillMs) / 1000);
      bucket.tokens = Math.min(
        this.capacity,
        bucket.tokens + elapsedSec * this.refillPerSecond,
      );
      bucket.lastRefillMs = now;
    }

    // A cost of 0 is a read-only "how's my bucket doing" call.
    // Always allowed, never mutates.
    if (cost === 0) {
      return {
        allowed: true,
        remaining: bucket.tokens,
        capacity: this.capacity,
        limiterKey: key,
      };
    }

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return {
        allowed: true,
        remaining: bucket.tokens,
        capacity: this.capacity,
        limiterKey: key,
      };
    }

    // Denied. Compute how long until the bucket would hold `cost`
    // tokens. refillPerSecond === 0 → "never", capped at a huge
    // sentinel so the caller can surface "retry after N minutes".
    const deficit = cost - bucket.tokens;
    const retryAfterMs =
      this.refillPerSecond > 0
        ? Math.ceil((deficit / this.refillPerSecond) * 1000)
        : Number.MAX_SAFE_INTEGER;

    return {
      allowed: false,
      remaining: bucket.tokens,
      capacity: this.capacity,
      retryAfterMs,
      limiterKey: key,
      code: "rate_limited",
    };
  }

  /**
   * Snapshot the current state of a bucket. Read-only, does NOT
   * refill. Useful for tests + dashboards.
   */
  peek(key: string): BucketState | null {
    const bucket = this.buckets.get(key);
    return bucket ? { ...bucket } : null;
  }

  /** Delete a specific bucket. */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Delete every bucket. */
  resetAll(): void {
    this.buckets.clear();
  }

  /** How many distinct keys currently have buckets. */
  get size(): number {
    return this.buckets.size;
  }
}

// ---------------------------------------------------------------------------
// Always-allow limiter (for opt-out / tests)
// ---------------------------------------------------------------------------

/**
 * Limiter that allows every call. Useful as a default when the
 * middleware has no rate limiter configured and we want to call
 * through a uniform path without special-casing `if (!limiter)`.
 */
export class UnboundedRateLimiter implements RateLimiter {
  readonly name = "unbounded";

  async check(key: string): Promise<RateLimitCheckResult> {
    return {
      allowed: true,
      remaining: Number.POSITIVE_INFINITY,
      capacity: Number.POSITIVE_INFINITY,
      limiterKey: key,
    };
  }
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

/**
 * Canonical key builder the middleware uses when the caller doesn't
 * supply `rateLimitKeyFn`. Pattern: `user:${userId}:intent:${intent}`.
 *
 * Exported so tests + route code can derive the same key without
 * duplicating the format string.
 */
export function defaultRateLimitKey(userId: string, intent: string): string {
  return `user:${userId}:intent:${intent}`;
}
