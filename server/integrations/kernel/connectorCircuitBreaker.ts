/* ------------------------------------------------------------------ *
 *  connectorCircuitBreaker.ts — Advanced Circuit Breaker with
 *  state-machine, sliding windows, presets & health polling.
 *  Standalone module — no imports from other kernel files.
 * ------------------------------------------------------------------ */

// ─── Types ──────────────────────────────────────────────────────────

export type CBState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  /** Minimum number of calls before evaluating thresholds */
  minimumCalls: number;
  /** Failure-rate threshold (0–1) to trip the breaker */
  failureRateThreshold: number;
  /** Slow-call-rate threshold (0–1) to trip the breaker */
  slowCallRateThreshold: number;
  /** Duration in ms that classifies a call as "slow" */
  slowCallDurationMs: number;
  /** How long the breaker stays OPEN before probing (ms) */
  waitDurationInOpenMs: number;
  /** Number of permitted probe calls in HALF_OPEN */
  permittedCallsInHalfOpen: number;
  /** Sliding window size (count-based) */
  slidingWindowSize: number;
  /** Sliding window type */
  slidingWindowType: 'COUNT_BASED' | 'TIME_BASED';
  /** For TIME_BASED windows — window length in ms */
  slidingWindowTimeMs: number;
  /** Automatic reset interval (0 = disabled) */
  automaticTransitionFromOpenToHalfOpenEnabled: boolean;
  /** Tags for grouping / filtering */
  tags: string[];
}

export interface CallOutcome {
  success: boolean;
  durationMs: number;
  error?: Error;
  timestamp: number;
}

export interface CircuitBreakerSnapshot {
  connectorId: string;
  state: CBState;
  failureRate: number;
  slowCallRate: number;
  totalCalls: number;
  failedCalls: number;
  slowCalls: number;
  lastStateChange: number;
  lastFailureTime: number;
  config: CircuitBreakerConfig;
}

export interface StateTransition {
  connectorId: string;
  from: CBState;
  to: CBState;
  reason: string;
  failureRate: number;
  slowCallRate: number;
  timestamp: number;
}

export interface CircuitBreakerDecision {
  permitted: boolean;
  state: CBState;
  reason: string;
  waitRemainingMs: number;
}

// ─── Default Config ─────────────────────────────────────────────────

export const DEFAULT_CB_CONFIG: CircuitBreakerConfig = {
  minimumCalls: 10,
  failureRateThreshold: 0.5,
  slowCallRateThreshold: 0.8,
  slowCallDurationMs: 5000,
  waitDurationInOpenMs: 30000,
  permittedCallsInHalfOpen: 5,
  slidingWindowSize: 20,
  slidingWindowType: 'COUNT_BASED',
  slidingWindowTimeMs: 60000,
  automaticTransitionFromOpenToHalfOpenEnabled: true,
  tags: [],
};

// ─── Sliding Windows (internal) ─────────────────────────────────────

class CountBasedSlidingWindow {
  private outcomes: CallOutcome[] = [];
  private readonly size: number;

  constructor(size: number) {
    this.size = Math.max(1, size);
  }

  record(outcome: CallOutcome): void {
    this.outcomes.push(outcome);
    if (this.outcomes.length > this.size) {
      this.outcomes.shift();
    }
  }

  getOutcomes(): CallOutcome[] {
    return this.outcomes.slice();
  }

  getTotalCount(): number {
    return this.outcomes.length;
  }

  getFailureCount(): number {
    let count = 0;
    for (const o of this.outcomes) {
      if (!o.success) count++;
    }
    return count;
  }

  getSlowCount(threshold: number): number {
    let count = 0;
    for (const o of this.outcomes) {
      if (o.durationMs >= threshold) count++;
    }
    return count;
  }

  getFailureRate(): number {
    if (this.outcomes.length === 0) return 0;
    return this.getFailureCount() / this.outcomes.length;
  }

  getSlowCallRate(threshold: number): number {
    if (this.outcomes.length === 0) return 0;
    return this.getSlowCount(threshold) / this.outcomes.length;
  }

  reset(): void {
    this.outcomes = [];
  }
}

class TimeBasedSlidingWindow {
  private outcomes: CallOutcome[] = [];
  private readonly windowMs: number;

  constructor(windowMs: number) {
    this.windowMs = Math.max(1000, windowMs);
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.outcomes.length > 0 && this.outcomes[0].timestamp < cutoff) {
      this.outcomes.shift();
    }
  }

  record(outcome: CallOutcome): void {
    this.outcomes.push(outcome);
    this.prune();
  }

  getOutcomes(): CallOutcome[] {
    this.prune();
    return this.outcomes.slice();
  }

  getTotalCount(): number {
    this.prune();
    return this.outcomes.length;
  }

  getFailureCount(): number {
    this.prune();
    let count = 0;
    for (const o of this.outcomes) {
      if (!o.success) count++;
    }
    return count;
  }

  getSlowCount(threshold: number): number {
    this.prune();
    let count = 0;
    for (const o of this.outcomes) {
      if (o.durationMs >= threshold) count++;
    }
    return count;
  }

  getFailureRate(): number {
    this.prune();
    if (this.outcomes.length === 0) return 0;
    return this.getFailureCount() / this.outcomes.length;
  }

  getSlowCallRate(threshold: number): number {
    this.prune();
    if (this.outcomes.length === 0) return 0;
    return this.getSlowCount(threshold) / this.outcomes.length;
  }

  reset(): void {
    this.outcomes = [];
  }
}

// ─── Circuit Breaker Instance (internal) ────────────────────────────

type TransitionListener = (t: StateTransition) => void;

class CircuitBreakerInstance {
  readonly connectorId: string;
  private config: CircuitBreakerConfig;
  private state: CBState = 'CLOSED';
  private countWindow: CountBasedSlidingWindow;
  private timeWindow: TimeBasedSlidingWindow;
  private lastStateChange: number = Date.now();
  private lastFailureTime: number = 0;
  private halfOpenCallCount: number = 0;
  private halfOpenSuccessCount: number = 0;
  private halfOpenFailureCount: number = 0;
  private transitionListeners: TransitionListener[] = [];

  constructor(connectorId: string, config: CircuitBreakerConfig) {
    this.connectorId = connectorId;
    this.config = { ...config };
    this.countWindow = new CountBasedSlidingWindow(config.slidingWindowSize);
    this.timeWindow = new TimeBasedSlidingWindow(config.slidingWindowTimeMs);
  }

  /* ── public getters ───────────────────────────────────────────── */

  getState(): CBState {
    this.evaluateAutoTransition();
    return this.state;
  }

  getConfig(): CircuitBreakerConfig {
    return { ...this.config };
  }

  onTransition(fn: TransitionListener): void {
    this.transitionListeners.push(fn);
  }

  /* ── tryAcquire ───────────────────────────────────────────────── */

  tryAcquire(): CircuitBreakerDecision {
    this.evaluateAutoTransition();

    switch (this.state) {
      case 'CLOSED':
        return {
          permitted: true,
          state: 'CLOSED',
          reason: 'Circuit is closed',
          waitRemainingMs: 0,
        };

      case 'OPEN': {
        const elapsed = Date.now() - this.lastStateChange;
        const remaining = Math.max(0, this.config.waitDurationInOpenMs - elapsed);
        if (remaining > 0) {
          return {
            permitted: false,
            state: 'OPEN',
            reason: `Circuit open — wait ${remaining}ms`,
            waitRemainingMs: remaining,
          };
        }
        // wait has elapsed but auto-transition hasn't run yet
        this.transitionTo('HALF_OPEN', 'Wait duration elapsed');
        return {
          permitted: true,
          state: 'HALF_OPEN',
          reason: 'Transitioned to HALF_OPEN — probe call permitted',
          waitRemainingMs: 0,
        };
      }

      case 'HALF_OPEN': {
        if (this.halfOpenCallCount < this.config.permittedCallsInHalfOpen) {
          this.halfOpenCallCount++;
          return {
            permitted: true,
            state: 'HALF_OPEN',
            reason: `Probe call ${this.halfOpenCallCount}/${this.config.permittedCallsInHalfOpen}`,
            waitRemainingMs: 0,
          };
        }
        return {
          permitted: false,
          state: 'HALF_OPEN',
          reason: 'Max probe calls reached — awaiting outcomes',
          waitRemainingMs: 0,
        };
      }

      default:
        return { permitted: false, state: this.state, reason: 'Unknown state', waitRemainingMs: 0 };
    }
  }

  /* ── recordOutcome ────────────────────────────────────────────── */

  recordOutcome(outcome: CallOutcome): void {
    const window = this.activeWindow();
    window.record(outcome);

    if (!outcome.success) {
      this.lastFailureTime = outcome.timestamp;
    }

    switch (this.state) {
      case 'CLOSED':
        this.evaluateClosed(window);
        break;
      case 'HALF_OPEN':
        this.evaluateHalfOpen(outcome);
        break;
      case 'OPEN':
        // should not normally happen
        break;
    }
  }

  /* ── getSnapshot ──────────────────────────────────────────────── */

  getSnapshot(): CircuitBreakerSnapshot {
    this.evaluateAutoTransition();
    const window = this.activeWindow();
    return {
      connectorId: this.connectorId,
      state: this.state,
      failureRate: window.getFailureRate(),
      slowCallRate: window.getSlowCallRate(this.config.slowCallDurationMs),
      totalCalls: window.getTotalCount(),
      failedCalls: window.getFailureCount(),
      slowCalls: window.getSlowCount(this.config.slowCallDurationMs),
      lastStateChange: this.lastStateChange,
      lastFailureTime: this.lastFailureTime,
      config: { ...this.config },
    };
  }

  /* ── forceState ───────────────────────────────────────────────── */

  forceState(newState: CBState, reason: string): void {
    if (this.state === newState) return;
    this.transitionTo(newState, `Forced: ${reason}`);
    if (newState === 'CLOSED') {
      this.resetWindows();
    }
  }

  /* ── reset ────────────────────────────────────────────────────── */

  reset(): void {
    this.transitionTo('CLOSED', 'Manual reset');
    this.resetWindows();
  }

  /* ── internals ────────────────────────────────────────────────── */

  private activeWindow(): CountBasedSlidingWindow | TimeBasedSlidingWindow {
    return this.config.slidingWindowType === 'TIME_BASED'
      ? this.timeWindow
      : this.countWindow;
  }

  private evaluateClosed(
    window: CountBasedSlidingWindow | TimeBasedSlidingWindow,
  ): void {
    if (window.getTotalCount() < this.config.minimumCalls) return;

    const failureRate = window.getFailureRate();
    const slowRate = window.getSlowCallRate(this.config.slowCallDurationMs);

    if (failureRate >= this.config.failureRateThreshold) {
      this.transitionTo(
        'OPEN',
        `Failure rate ${(failureRate * 100).toFixed(1)}% >= ${(this.config.failureRateThreshold * 100).toFixed(1)}%`,
      );
    } else if (slowRate >= this.config.slowCallRateThreshold) {
      this.transitionTo(
        'OPEN',
        `Slow call rate ${(slowRate * 100).toFixed(1)}% >= ${(this.config.slowCallRateThreshold * 100).toFixed(1)}%`,
      );
    }
  }

  private evaluateHalfOpen(outcome: CallOutcome): void {
    if (outcome.success) {
      this.halfOpenSuccessCount++;
    } else {
      this.halfOpenFailureCount++;
    }

    const totalProbes = this.halfOpenSuccessCount + this.halfOpenFailureCount;

    // Any failure trips back to OPEN
    if (this.halfOpenFailureCount > 0) {
      this.transitionTo(
        'OPEN',
        `Probe failure in HALF_OPEN (${this.halfOpenFailureCount} failure(s) out of ${totalProbes} probes)`,
      );
      return;
    }

    // All probes succeeded → close
    if (this.halfOpenSuccessCount >= this.config.permittedCallsInHalfOpen) {
      this.transitionTo(
        'CLOSED',
        `All ${this.config.permittedCallsInHalfOpen} probe calls succeeded`,
      );
      this.resetWindows();
    }
  }

  private evaluateAutoTransition(): void {
    if (
      this.state === 'OPEN' &&
      this.config.automaticTransitionFromOpenToHalfOpenEnabled
    ) {
      const elapsed = Date.now() - this.lastStateChange;
      if (elapsed >= this.config.waitDurationInOpenMs) {
        this.transitionTo('HALF_OPEN', 'Wait duration elapsed (auto)');
      }
    }
  }

  private transitionTo(newState: CBState, reason: string): void {
    const from = this.state;
    if (from === newState) return;
    const window = this.activeWindow();
    const transition: StateTransition = {
      connectorId: this.connectorId,
      from,
      to: newState,
      reason,
      failureRate: window.getFailureRate(),
      slowCallRate: window.getSlowCallRate(this.config.slowCallDurationMs),
      timestamp: Date.now(),
    };
    this.state = newState;
    this.lastStateChange = Date.now();

    if (newState === 'HALF_OPEN') {
      this.halfOpenCallCount = 0;
      this.halfOpenSuccessCount = 0;
      this.halfOpenFailureCount = 0;
    }

    for (const fn of this.transitionListeners) {
      try {
        fn(transition);
      } catch {
        /* listener errors are swallowed */
      }
    }
  }

  private resetWindows(): void {
    this.countWindow.reset();
    this.timeWindow.reset();
    this.halfOpenCallCount = 0;
    this.halfOpenSuccessCount = 0;
    this.halfOpenFailureCount = 0;
  }
}

// ─── Registry ───────────────────────────────────────────────────────

export class ConnectorCircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreakerInstance> = new Map();
  private globalListeners: TransitionListener[] = [];
  private healthInterval: ReturnType<typeof setInterval> | null = null;
  private healthListeners: Array<(snapshots: CircuitBreakerSnapshot[]) => void> = [];

  /* ── getBreaker ───────────────────────────────────────────────── */

  getBreaker(
    connectorId: string,
    config?: Partial<CircuitBreakerConfig>,
  ): CircuitBreakerInstance {
    let inst = this.breakers.get(connectorId);
    if (!inst) {
      const merged: CircuitBreakerConfig = { ...DEFAULT_CB_CONFIG, ...config };
      inst = new CircuitBreakerInstance(connectorId, merged);
      inst.onTransition((t) => {
        for (const fn of this.globalListeners) {
          try { fn(t); } catch { /* swallow */ }
        }
      });
      this.breakers.set(connectorId, inst);
    }
    return inst;
  }

  /* ── tryAcquire ───────────────────────────────────────────────── */

  tryAcquire(
    connectorId: string,
    config?: Partial<CircuitBreakerConfig>,
  ): CircuitBreakerDecision {
    return this.getBreaker(connectorId, config).tryAcquire();
  }

  /* ── recordOutcome ────────────────────────────────────────────── */

  recordOutcome(connectorId: string, outcome: CallOutcome): void {
    const inst = this.breakers.get(connectorId);
    if (inst) {
      inst.recordOutcome(outcome);
    }
  }

  /* ── execute<T> ───────────────────────────────────────────────── */

  async execute<T>(
    connectorId: string,
    fn: () => Promise<T>,
    config?: Partial<CircuitBreakerConfig>,
  ): Promise<T> {
    const decision = this.tryAcquire(connectorId, config);
    if (!decision.permitted) {
      throw new CircuitBreakerOpenError(connectorId, decision);
    }
    const start = Date.now();
    try {
      const result = await fn();
      this.recordOutcome(connectorId, {
        success: true,
        durationMs: Date.now() - start,
        timestamp: Date.now(),
      });
      return result;
    } catch (err: unknown) {
      this.recordOutcome(connectorId, {
        success: false,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err : new Error(String(err)),
        timestamp: Date.now(),
      });
      throw err;
    }
  }

  /* ── onTransition ─────────────────────────────────────────────── */

  onTransition(fn: TransitionListener): () => void {
    this.globalListeners.push(fn);
    return () => {
      const idx = this.globalListeners.indexOf(fn);
      if (idx >= 0) this.globalListeners.splice(idx, 1);
    };
  }

  /* ── getAllSnapshots ───────────────────────────────────────────── */

  getAllSnapshots(): CircuitBreakerSnapshot[] {
    return Array.from(this.breakers.values()).map((b) => b.getSnapshot());
  }

  /* ── getOpenBreakers ──────────────────────────────────────────── */

  getOpenBreakers(): CircuitBreakerSnapshot[] {
    return Array.from(this.breakers.values())
      .map((b) => b.getSnapshot())
      .filter((s) => s.state === 'OPEN');
  }

  /* ── forceState ───────────────────────────────────────────────── */

  forceState(connectorId: string, state: CBState, reason: string): void {
    const inst = this.breakers.get(connectorId);
    if (inst) inst.forceState(state, reason);
  }

  /* ── resetBreaker ─────────────────────────────────────────────── */

  resetBreaker(connectorId: string): void {
    const inst = this.breakers.get(connectorId);
    if (inst) inst.reset();
  }

  /* ── getAggregateHealth ───────────────────────────────────────── */

  getAggregateHealth(): {
    total: number;
    closed: number;
    open: number;
    halfOpen: number;
    healthRatio: number;
  } {
    const snapshots = this.getAllSnapshots();
    const total = snapshots.length;
    let closed = 0;
    let open = 0;
    let halfOpen = 0;
    for (const s of snapshots) {
      switch (s.state) {
        case 'CLOSED': closed++; break;
        case 'OPEN': open++; break;
        case 'HALF_OPEN': halfOpen++; break;
      }
    }
    return {
      total,
      closed,
      open,
      halfOpen,
      healthRatio: total > 0 ? closed / total : 1,
    };
  }

  /* ── health polling ───────────────────────────────────────────── */

  startHealthPolling(intervalMs: number = 10000): void {
    this.stopHealthPolling();
    this.healthInterval = setInterval(() => {
      const snapshots = this.getAllSnapshots();
      for (const fn of this.healthListeners) {
        try { fn(snapshots); } catch { /* swallow */ }
      }
    }, intervalMs);
    if (this.healthInterval && typeof this.healthInterval === 'object' && 'unref' in this.healthInterval) {
      (this.healthInterval as NodeJS.Timeout).unref();
    }
  }

  stopHealthPolling(): void {
    if (this.healthInterval !== null) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  onHealthPoll(fn: (snapshots: CircuitBreakerSnapshot[]) => void): () => void {
    this.healthListeners.push(fn);
    return () => {
      const idx = this.healthListeners.indexOf(fn);
      if (idx >= 0) this.healthListeners.splice(idx, 1);
    };
  }

  /* ── misc ─────────────────────────────────────────────────────── */

  getRegisteredConnectors(): string[] {
    return Array.from(this.breakers.keys());
  }

  removeBreaker(connectorId: string): boolean {
    return this.breakers.delete(connectorId);
  }

  clear(): void {
    this.breakers.clear();
    this.stopHealthPolling();
  }
}

// ─── CircuitBreakerOpenError ────────────────────────────────────────

export class CircuitBreakerOpenError extends Error {
  readonly connectorId: string;
  readonly decision: CircuitBreakerDecision;

  constructor(connectorId: string, decision: CircuitBreakerDecision) {
    super(
      `Circuit breaker OPEN for connector "${connectorId}": ${decision.reason}`,
    );
    this.name = 'CircuitBreakerOpenError';
    this.connectorId = connectorId;
    this.decision = decision;
  }
}

// ─── withCircuitBreaker utility ─────────────────────────────────────

export async function withCircuitBreaker<T>(
  connectorId: string,
  fn: () => Promise<T>,
  options?: {
    config?: Partial<CircuitBreakerConfig>;
    fallback?: () => Promise<T>;
    registry?: ConnectorCircuitBreakerRegistry;
  },
): Promise<T> {
  const registry = options?.registry ?? circuitBreakerRegistry;
  const decision = registry.tryAcquire(connectorId, options?.config);

  if (!decision.permitted) {
    if (options?.fallback) {
      return options.fallback();
    }
    throw new CircuitBreakerOpenError(connectorId, decision);
  }

  const start = Date.now();
  try {
    const result = await fn();
    registry.recordOutcome(connectorId, {
      success: true,
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    });
    return result;
  } catch (err: unknown) {
    registry.recordOutcome(connectorId, {
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err : new Error(String(err)),
      timestamp: Date.now(),
    });
    if (options?.fallback) {
      return options.fallback();
    }
    throw err;
  }
}

// ─── Presets ────────────────────────────────────────────────────────

export const CB_PRESETS: Record<string, Partial<CircuitBreakerConfig>> = {
  conservative: {
    minimumCalls: 20,
    failureRateThreshold: 0.6,
    slowCallRateThreshold: 0.9,
    slowCallDurationMs: 10000,
    waitDurationInOpenMs: 60000,
    permittedCallsInHalfOpen: 3,
    slidingWindowSize: 50,
    slidingWindowType: 'COUNT_BASED',
    tags: ['conservative'],
  },
  aggressive: {
    minimumCalls: 5,
    failureRateThreshold: 0.25,
    slowCallRateThreshold: 0.5,
    slowCallDurationMs: 2000,
    waitDurationInOpenMs: 15000,
    permittedCallsInHalfOpen: 2,
    slidingWindowSize: 10,
    slidingWindowType: 'COUNT_BASED',
    tags: ['aggressive'],
  },
  balanced: {
    minimumCalls: 10,
    failureRateThreshold: 0.5,
    slowCallRateThreshold: 0.75,
    slowCallDurationMs: 5000,
    waitDurationInOpenMs: 30000,
    permittedCallsInHalfOpen: 5,
    slidingWindowSize: 20,
    slidingWindowType: 'COUNT_BASED',
    tags: ['balanced'],
  },
  sensitive: {
    minimumCalls: 3,
    failureRateThreshold: 0.15,
    slowCallRateThreshold: 0.3,
    slowCallDurationMs: 1500,
    waitDurationInOpenMs: 45000,
    permittedCallsInHalfOpen: 1,
    slidingWindowSize: 10,
    slidingWindowType: 'TIME_BASED',
    slidingWindowTimeMs: 30000,
    tags: ['sensitive'],
  },
  lenient: {
    minimumCalls: 30,
    failureRateThreshold: 0.75,
    slowCallRateThreshold: 0.95,
    slowCallDurationMs: 15000,
    waitDurationInOpenMs: 120000,
    permittedCallsInHalfOpen: 10,
    slidingWindowSize: 100,
    slidingWindowType: 'COUNT_BASED',
    tags: ['lenient'],
  },
};

// ─── Singleton ──────────────────────────────────────────────────────

export const circuitBreakerRegistry = new ConnectorCircuitBreakerRegistry();
