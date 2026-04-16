/**
 * Cognitive Middleware — per-provider circuit breakers (Turn E).
 *
 * A classic three-state breaker per provider adapter, used by the
 * orchestrator to filter out known-sick providers BEFORE spending
 * request time on them. The pipeline already has retry-with-backoff
 * inside `callProviderWithRetry`, but that protects against
 * transient hiccups on the HAPPY path. A circuit breaker protects
 * the UNHAPPY path: when a provider is fully down for minutes at a
 * time, retrying every request wastes budget and makes latency
 * worse. The breaker lets the orchestrator fail fast on that
 * provider and try the next capable one instead.
 *
 * States:
 *
 *   closed     (normal) — every request goes through. On `N`
 *                         consecutive failures, transition to `open`.
 *
 *   open       (broken) — every request is rejected without calling
 *                         the provider. After `cooldownMs` elapses,
 *                         the next check transitions to `half-open`
 *                         and returns "available" — a single probe
 *                         request goes through.
 *
 *   half-open  (probe)  — one probe request is in flight. On
 *                         success, transition to `closed` and reset
 *                         the failure counter. On failure,
 *                         transition back to `open` and restart
 *                         the cooldown clock.
 *
 * Transitions are lazy: state is only refreshed when `isAvailable`
 * or `getStatus` is called. No background timers. This keeps the
 * registry cheap to instantiate and leaves tests free to control
 * wall time via an injected clock.
 *
 * Hard guarantees:
 *
 *   • Never throws.
 *   • Safe for concurrent use across requests — each method is a
 *     single atomic mutation on a per-breaker state object and
 *     Node executes one microtask at a time.
 *   • Snapshot-only reads via `getStatus()` never mutate state.
 *
 * Integration:
 *
 *   The middleware owns a `CircuitBreakerRegistry`. `selectProvider`
 *   filters its adapter list to only those whose breakers report
 *   `isAvailable()`. After each provider call, the middleware
 *   calls `recordSuccess` or `recordFailure` based on the
 *   response's finishReason.
 */

// ---------------------------------------------------------------------------
// State + options
// ---------------------------------------------------------------------------

export type CircuitBreakerState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /**
   * Consecutive failures required to trip the breaker from closed
   * to open. Default 3. Higher values tolerate more transient
   * errors before giving up; lower values fail faster.
   */
  failureThreshold?: number;
  /**
   * Milliseconds the breaker stays open before allowing a probe.
   * Default 5000. Production values are typically 30_000 to
   * 300_000 depending on provider stability.
   */
  cooldownMs?: number;
  /**
   * Optional clock override for deterministic tests.
   */
  now?: () => number;
}

export interface CircuitBreakerStatus {
  name: string;
  state: CircuitBreakerState;
  consecutiveFailures: number;
  /** Unix ms when the breaker last transitioned to `open`. */
  openedAt: number | null;
  /** Unix ms when the breaker will consider a probe (open only). */
  cooldownUntil: number | null;
}

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------

export class CircuitBreaker {
  readonly name: string;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly nowFn: () => number;

  private state: CircuitBreakerState = "closed";
  private consecutiveFailures = 0;
  private openedAt: number = 0;

  constructor(name: string, options: CircuitBreakerOptions = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold ?? 3;
    if (this.failureThreshold < 1) {
      throw new Error(
        "CircuitBreaker: failureThreshold must be ≥ 1",
      );
    }
    this.cooldownMs = options.cooldownMs ?? 5_000;
    if (this.cooldownMs < 0) {
      throw new Error("CircuitBreaker: cooldownMs must be ≥ 0");
    }
    this.nowFn = options.now ?? Date.now;
  }

  /**
   * Ask whether a caller may attempt to use the protected resource.
   * Refreshes state lazily: an `open` breaker whose cooldown has
   * elapsed transitions to `half-open` inside this call and returns
   * `true` so the caller can send a probe.
   */
  isAvailable(): boolean {
    if (this.state === "closed" || this.state === "half-open") return true;
    // open
    const now = this.nowFn();
    if (now - this.openedAt >= this.cooldownMs) {
      this.state = "half-open";
      return true;
    }
    return false;
  }

  /**
   * Record a successful call against the protected resource.
   *
   *   half-open → closed (probe succeeded; resume normal traffic)
   *   closed    → closed (reset consecutive-failures counter)
   *   open      → open   (should not happen; opens don't get calls)
   */
  recordSuccess(): void {
    if (this.state === "half-open") {
      this.state = "closed";
      this.consecutiveFailures = 0;
      this.openedAt = 0;
      return;
    }
    if (this.state === "closed") {
      this.consecutiveFailures = 0;
    }
  }

  /**
   * Record a failed call.
   *
   *   half-open → open   (probe failed; restart cooldown clock)
   *   closed    → closed (until failures hit threshold)
   *   closed    → open   (threshold reached)
   */
  recordFailure(): void {
    this.consecutiveFailures++;
    if (this.state === "half-open") {
      this.state = "open";
      this.openedAt = this.nowFn();
      return;
    }
    if (
      this.state === "closed" &&
      this.consecutiveFailures >= this.failureThreshold
    ) {
      this.state = "open";
      this.openedAt = this.nowFn();
    }
  }

  /**
   * Read-only snapshot. Does NOT refresh the state — call
   * `isAvailable()` first if you want the lazy "open → half-open"
   * transition to happen.
   */
  getStatus(): CircuitBreakerStatus {
    return {
      name: this.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.state === "open" ? this.openedAt : null,
      cooldownUntil:
        this.state === "open" ? this.openedAt + this.cooldownMs : null,
    };
  }

  /** Force-reset to closed. Useful between tests. */
  reset(): void {
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.openedAt = 0;
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface CircuitBreakerRegistryOptions {
  /** Default options for every breaker the registry creates. */
  defaults?: CircuitBreakerOptions;
  /**
   * Per-name overrides keyed by adapter name. Useful when one
   * provider needs a longer cooldown than the rest.
   */
  overrides?: Record<string, CircuitBreakerOptions>;
}

/**
 * A provider-name → breaker map that lazily creates breakers on
 * first access. The lazy creation pattern means the middleware
 * doesn't need to know the full adapter list ahead of time: new
 * adapters registered later still get breakers automatically.
 */
export class CircuitBreakerRegistry {
  private readonly breakers: Map<string, CircuitBreaker> = new Map();
  private readonly defaults: CircuitBreakerOptions;
  private readonly overrides: Record<string, CircuitBreakerOptions>;

  constructor(options: CircuitBreakerRegistryOptions = {}) {
    this.defaults = options.defaults ?? {};
    this.overrides = options.overrides ?? {};
  }

  /**
   * Get (or create) the breaker for a provider name.
   */
  get(name: string): CircuitBreaker {
    let breaker = this.breakers.get(name);
    if (!breaker) {
      const merged: CircuitBreakerOptions = {
        ...this.defaults,
        ...(this.overrides[name] ?? {}),
      };
      breaker = new CircuitBreaker(name, merged);
      this.breakers.set(name, breaker);
    }
    return breaker;
  }

  /** Read-only snapshot of every known breaker's status. */
  snapshot(): CircuitBreakerStatus[] {
    const out: CircuitBreakerStatus[] = [];
    for (const breaker of this.breakers.values()) {
      out.push(breaker.getStatus());
    }
    return out;
  }

  /** Reset every breaker. Useful between tests. */
  resetAll(): void {
    for (const b of this.breakers.values()) b.reset();
  }

  /** Number of breakers currently tracked. */
  get size(): number {
    return this.breakers.size;
  }
}
