/**
 * connectorHealthAggregator.ts
 *
 * Sophisticated health aggregation and SLA enforcement engine for the
 * Integration Kernel.  Provides periodic health-checking with a per-connector
 * state machine, sliding-window metric aggregation, SLA evaluation with
 * error-budget / burn-rate tracking, incident reporting, and Express-ready
 * health endpoint builders.
 *
 * Standalone module -- does NOT import from other kernel files.
 */

/* ------------------------------------------------------------------ */
/*  Core Types                                                        */
/* ------------------------------------------------------------------ */

export type CheckType = 'ping' | 'functional' | 'deep';
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
export type HealthTrend = 'improving' | 'stable' | 'degrading';

export type HealthEventType =
  | 'check_completed'
  | 'state_changed'
  | 'sla_violation'
  | 'sla_recovered';

export interface HealthCheck {
  connectorId: string;
  operationId?: string;
  checkType: CheckType;
  status: HealthStatus;
  latencyMs: number;
  timestamp: number;
  error?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface HealthPolicy {
  connectorId: string;
  interval: number;       // ms between checks
  timeout: number;        // max ms per check
  consecutiveFailuresBeforeUnhealthy: number;
  consecutiveSuccessesBeforeHealthy: number;
  checkFn?: string;       // optional named function reference
}

export interface AggregatedHealth {
  connectorId: string;
  status: HealthStatus;
  uptimePercent: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  checkCount: number;
  failureCount: number;
  lastCheck: number;
  lastStateChange: number;
  trend: HealthTrend;
}

export interface SlaDefinition {
  id: string;
  name: string;
  connectorId: string;
  targets: {
    availability: number;    // e.g. 99.9
    p95LatencyMs: number;
    p99LatencyMs: number;
    errorRatePercent: number;
  };
  windowMs: number;
  violationCallbackId?: string;
}

export interface SlaStatus {
  definitionId: string;
  connectorId: string;
  currentAvailability: number;
  currentP95: number;
  currentP99: number;
  currentErrorRate: number;
  inViolation: boolean;
  violationStart?: number;
  violationDuration?: number;
  errorBudgetRemaining: number;
  burnRate: number;
}

export interface SlaViolation {
  id: string;
  definitionId: string;
  connectorId: string;
  metric: string;
  threshold: number;
  actual: number;
  startTime: number;
  endTime?: number;
  acknowledged: boolean;
  acknowledgedBy?: string;
}

export interface HealthEvent {
  type: HealthEventType;
  connectorId: string;
  timestamp: number;
  details: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

type EventListener = (event: HealthEvent) => void;

let _violationCounter = 0;
function nextViolationId(): string {
  _violationCounter += 1;
  return `viol_${Date.now()}_${_violationCounter}`;
}

/** Percentile from a sorted array (0-based index interpolation). */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/** Simple ring-buffer backed by a plain array. */
class RingBuffer<T> {
  private buf: (T | undefined)[];
  private head = 0;
  private _size = 0;
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buf = new Array(capacity);
  }

  push(item: T): void {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this._size < this.capacity) this._size += 1;
  }

  size(): number {
    return this._size;
  }

  /** Return all items oldest-first. */
  toArray(): T[] {
    if (this._size === 0) return [];
    const out: T[] = [];
    const start = this._size < this.capacity ? 0 : this.head;
    for (let i = 0; i < this._size; i++) {
      const idx = (start + i) % this.capacity;
      out.push(this.buf[idx] as T);
    }
    return out;
  }

  /** Return items within a time range (items must expose `timestamp`). */
  since(timestampMs: number): T[] {
    return this.toArray().filter(
      (item) => (item as unknown as { timestamp: number }).timestamp >= timestampMs,
    );
  }

  clear(): void {
    this.buf = new Array(this.capacity);
    this.head = 0;
    this._size = 0;
  }
}

/* ------------------------------------------------------------------ */
/*  HealthCheckScheduler                                              */
/* ------------------------------------------------------------------ */

interface ConnectorState {
  status: HealthStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastCheck: number;
  lastStateChange: number;
}

/**
 * Manages periodic health checks for every registered connector, maintaining
 * a per-connector finite state machine (unknown -> healthy -> degraded -> unhealthy).
 */
export class HealthCheckScheduler {
  private policies: Map<string, HealthPolicy> = new Map();
  private states: Map<string, ConnectorState> = new Map();
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private running = false;
  private listeners: EventListener[] = [];
  private concurrencyLimit = 5;

  /* -- check function registry ------------------------------------ */
  private checkFunctions: Map<string, (connectorId: string) => Promise<HealthCheck>> = new Map();

  registerCheckFunction(
    name: string,
    fn: (connectorId: string) => Promise<HealthCheck>,
  ): void {
    this.checkFunctions.set(name, fn);
  }

  unregisterCheckFunction(name: string): void {
    this.checkFunctions.delete(name);
  }

  /* -- event handling --------------------------------------------- */

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  private emit(event: HealthEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* listener errors must not break scheduler */
      }
    }
  }

  /* -- policy management ------------------------------------------ */

  registerPolicy(policy: HealthPolicy): void {
    this.policies.set(policy.connectorId, policy);
    if (!this.states.has(policy.connectorId)) {
      this.states.set(policy.connectorId, {
        status: 'unknown',
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        lastCheck: 0,
        lastStateChange: Date.now(),
      });
    }
    if (this.running) {
      this.startTimerForConnector(policy.connectorId);
    }
  }

  unregisterPolicy(connectorId: string): void {
    this.policies.delete(connectorId);
    this.stopTimerForConnector(connectorId);
    this.states.delete(connectorId);
  }

  getPolicy(connectorId: string): HealthPolicy | undefined {
    return this.policies.get(connectorId);
  }

  getAllPolicies(): HealthPolicy[] {
    return Array.from(this.policies.values());
  }

  /* -- state queries ---------------------------------------------- */

  getState(connectorId: string): ConnectorState | undefined {
    return this.states.get(connectorId);
  }

  getAllStates(): Map<string, ConnectorState> {
    return new Map(this.states);
  }

  /* -- lifecycle -------------------------------------------------- */

  start(): void {
    if (this.running) return;
    this.running = true;
    const ids = Array.from(this.policies.keys());
    for (const id of ids) {
      this.startTimerForConnector(id);
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    const ids = Array.from(this.timers.keys());
    for (const id of ids) {
      this.stopTimerForConnector(id);
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  /* -- single check execution ------------------------------------- */

  async runCheck(connectorId: string): Promise<HealthCheck> {
    const policy = this.policies.get(connectorId);
    if (!policy) {
      throw new Error(`No health policy registered for connector "${connectorId}"`);
    }

    const startMs = Date.now();
    let check: HealthCheck;

    try {
      const checkFn = policy.checkFn
        ? this.checkFunctions.get(policy.checkFn)
        : undefined;

      if (checkFn) {
        const result = await Promise.race([
          checkFn(connectorId),
          this.timeoutPromise<HealthCheck>(policy.timeout, connectorId),
        ]);
        check = result;
      } else {
        /* Default synthetic ping check */
        check = {
          connectorId,
          checkType: 'ping',
          status: 'healthy',
          latencyMs: Date.now() - startMs,
          timestamp: Date.now(),
        };
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      check = {
        connectorId,
        checkType: policy.checkFn ? 'functional' : 'ping',
        status: 'unhealthy',
        latencyMs: Date.now() - startMs,
        timestamp: Date.now(),
        error: errorMsg,
      };
    }

    this.processCheckResult(connectorId, check);
    return check;
  }

  /** Run all registered checks in parallel, bounded by concurrencyLimit. */
  async runAllChecks(): Promise<HealthCheck[]> {
    const ids = Array.from(this.policies.keys());
    const results: HealthCheck[] = [];
    let i = 0;

    while (i < ids.length) {
      const batch = ids.slice(i, i + this.concurrencyLimit);
      const batchResults = await Promise.allSettled(
        batch.map((id) => this.runCheck(id)),
      );
      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          results.push(r.value);
        }
      }
      i += this.concurrencyLimit;
    }

    return results;
  }

  /* -- internals -------------------------------------------------- */

  private startTimerForConnector(connectorId: string): void {
    this.stopTimerForConnector(connectorId);
    const policy = this.policies.get(connectorId);
    if (!policy) return;
    const timer = setInterval(() => {
      void this.runCheck(connectorId);
    }, policy.interval);
    this.timers.set(connectorId, timer);
  }

  private stopTimerForConnector(connectorId: string): void {
    const timer = this.timers.get(connectorId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(connectorId);
    }
  }

  private timeoutPromise<T>(ms: number, connectorId: string): Promise<T> {
    return new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Health check timeout (${ms}ms) for "${connectorId}"`)), ms);
    });
  }

  /**
   * State machine: processes a check result and transitions the connector
   * status accordingly (unknown -> healthy/degraded/unhealthy).
   *
   * healthy    -> degraded   after 1 failure
   * degraded   -> unhealthy  after consecutiveFailuresBeforeUnhealthy failures
   * unhealthy  -> degraded   after 1 success
   * degraded   -> healthy    after consecutiveSuccessesBeforeHealthy successes
   * unknown    -> healthy    after 1 success
   * unknown    -> degraded   after 1 failure
   */
  private processCheckResult(connectorId: string, check: HealthCheck): void {
    const policy = this.policies.get(connectorId);
    if (!policy) return;

    let state = this.states.get(connectorId);
    if (!state) {
      state = {
        status: 'unknown',
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        lastCheck: 0,
        lastStateChange: Date.now(),
      };
      this.states.set(connectorId, state);
    }

    const isSuccess = check.status === 'healthy';
    const previousStatus = state.status;

    if (isSuccess) {
      state.consecutiveSuccesses += 1;
      state.consecutiveFailures = 0;
    } else {
      state.consecutiveFailures += 1;
      state.consecutiveSuccesses = 0;
    }

    state.lastCheck = check.timestamp;

    /* Transition logic */
    let newStatus: HealthStatus = state.status;

    switch (state.status) {
      case 'unknown':
        newStatus = isSuccess ? 'healthy' : 'degraded';
        break;

      case 'healthy':
        if (!isSuccess) {
          newStatus = 'degraded';
        }
        break;

      case 'degraded':
        if (isSuccess && state.consecutiveSuccesses >= policy.consecutiveSuccessesBeforeHealthy) {
          newStatus = 'healthy';
        } else if (!isSuccess && state.consecutiveFailures >= policy.consecutiveFailuresBeforeUnhealthy) {
          newStatus = 'unhealthy';
        }
        break;

      case 'unhealthy':
        if (isSuccess) {
          newStatus = 'degraded';
        }
        break;
    }

    state.status = newStatus;

    if (newStatus !== previousStatus) {
      state.lastStateChange = Date.now();
      this.emit({
        type: 'state_changed',
        connectorId,
        timestamp: Date.now(),
        details: {
          previousStatus,
          newStatus,
          consecutiveFailures: state.consecutiveFailures,
          consecutiveSuccesses: state.consecutiveSuccesses,
        },
      });
    }

    this.emit({
      type: 'check_completed',
      connectorId,
      timestamp: check.timestamp,
      details: {
        checkType: check.checkType,
        status: check.status,
        latencyMs: check.latencyMs,
        error: check.error ?? null,
      },
    });
  }

  setConcurrencyLimit(limit: number): void {
    if (limit < 1) throw new Error('Concurrency limit must be >= 1');
    this.concurrencyLimit = limit;
  }

  getConcurrencyLimit(): number {
    return this.concurrencyLimit;
  }

  reset(): void {
    this.stop();
    this.policies.clear();
    this.states.clear();
    this.timers.clear();
    this.listeners = [];
  }
}

/* ------------------------------------------------------------------ */
/*  HealthAggregator                                                  */
/* ------------------------------------------------------------------ */

/** Standard aggregation windows. */
const WINDOW_1H  = 60 * 60 * 1000;
const WINDOW_6H  = 6 * WINDOW_1H;
const WINDOW_24H = 24 * WINDOW_1H;
const WINDOW_7D  = 7 * WINDOW_24H;

const MAX_CHECKS_PER_CONNECTOR = 10_000;

export interface SystemHealth {
  overallStatus: HealthStatus;
  healthyCount: number;
  degradedCount: number;
  unhealthyCount: number;
  unknownCount: number;
  systemUptime: number;
}

/**
 * Sliding-window metric aggregation with ring-buffer storage, percentile
 * calculation, and trend detection.
 */
export class HealthAggregator {
  private buffers: Map<string, RingBuffer<HealthCheck>> = new Map();
  private stateSnapshots: Map<string, { status: HealthStatus; lastStateChange: number }> = new Map();
  private listeners: EventListener[] = [];
  private startTime: number = Date.now();

  /* -- event handling --------------------------------------------- */

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  private emit(event: HealthEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* swallow */ }
    }
  }

  /* -- recording -------------------------------------------------- */

  recordCheck(check: HealthCheck): void {
    let buf = this.buffers.get(check.connectorId);
    if (!buf) {
      buf = new RingBuffer<HealthCheck>(MAX_CHECKS_PER_CONNECTOR);
      this.buffers.set(check.connectorId, buf);
    }
    buf.push(check);

    /* Maintain state snapshot */
    const existing = this.stateSnapshots.get(check.connectorId);
    if (!existing || existing.status !== check.status) {
      this.stateSnapshots.set(check.connectorId, {
        status: check.status,
        lastStateChange: check.timestamp,
      });
    }
  }

  /* -- queries ---------------------------------------------------- */

  getHealth(connectorId: string, windowMs: number = WINDOW_1H): AggregatedHealth {
    const buf = this.buffers.get(connectorId);
    const snap = this.stateSnapshots.get(connectorId);

    if (!buf || buf.size() === 0) {
      return {
        connectorId,
        status: 'unknown',
        uptimePercent: 0,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        checkCount: 0,
        failureCount: 0,
        lastCheck: 0,
        lastStateChange: 0,
        trend: 'stable',
      };
    }

    const cutoff = Date.now() - windowMs;
    const checks = buf.since(cutoff);

    if (checks.length === 0) {
      return {
        connectorId,
        status: snap?.status ?? 'unknown',
        uptimePercent: 0,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        checkCount: 0,
        failureCount: 0,
        lastCheck: snap?.lastStateChange ?? 0,
        lastStateChange: snap?.lastStateChange ?? 0,
        trend: 'stable',
      };
    }

    const healthyCount = checks.filter((c) => c.status === 'healthy').length;
    const failureCount = checks.length - healthyCount;
    const uptimePercent = (healthyCount / checks.length) * 100;

    const latencies = checks.map((c) => c.latencyMs);
    const avgLatencyMs = latencies.reduce((s, v) => s + v, 0) / latencies.length;
    const sorted = latencies.slice().sort((a, b) => a - b);
    const p95LatencyMs = percentile(sorted, 95);
    const p99LatencyMs = percentile(sorted, 99);

    const lastCheckTs = checks[checks.length - 1].timestamp;

    const trend = this.computeTrend(connectorId, windowMs);

    return {
      connectorId,
      status: snap?.status ?? checks[checks.length - 1].status,
      uptimePercent: Math.round(uptimePercent * 100) / 100,
      avgLatencyMs: Math.round(avgLatencyMs * 100) / 100,
      p95LatencyMs: Math.round(p95LatencyMs * 100) / 100,
      p99LatencyMs: Math.round(p99LatencyMs * 100) / 100,
      checkCount: checks.length,
      failureCount,
      lastCheck: lastCheckTs,
      lastStateChange: snap?.lastStateChange ?? lastCheckTs,
      trend,
    };
  }

  getAllHealth(windowMs: number = WINDOW_1H): AggregatedHealth[] {
    const ids = Array.from(this.buffers.keys());
    return ids.map((id) => this.getHealth(id, windowMs));
  }

  getSystemHealth(): SystemHealth {
    const allHealth = this.getAllHealth();
    let healthyCount = 0;
    let degradedCount = 0;
    let unhealthyCount = 0;
    let unknownCount = 0;

    for (const h of allHealth) {
      switch (h.status) {
        case 'healthy':   healthyCount++;   break;
        case 'degraded':  degradedCount++;  break;
        case 'unhealthy': unhealthyCount++; break;
        case 'unknown':   unknownCount++;   break;
      }
    }

    let overallStatus: HealthStatus = 'healthy';
    if (unhealthyCount > 0) {
      overallStatus = 'unhealthy';
    } else if (degradedCount > 0) {
      overallStatus = 'degraded';
    } else if (allHealth.length === 0 || unknownCount === allHealth.length) {
      overallStatus = 'unknown';
    }

    return {
      overallStatus,
      healthyCount,
      degradedCount,
      unhealthyCount,
      unknownCount,
      systemUptime: Date.now() - this.startTime,
    };
  }

  /** Retrieve raw checks for a connector within a window. */
  getChecks(connectorId: string, windowMs: number = WINDOW_1H): HealthCheck[] {
    const buf = this.buffers.get(connectorId);
    if (!buf) return [];
    return buf.since(Date.now() - windowMs);
  }

  /** All checks for a connector (full ring buffer). */
  getAllChecks(connectorId: string): HealthCheck[] {
    const buf = this.buffers.get(connectorId);
    if (!buf) return [];
    return buf.toArray();
  }

  getConnectorIds(): string[] {
    return Array.from(this.buffers.keys());
  }

  /* -- aggregation windows ---------------------------------------- */

  getHealthMultiWindow(connectorId: string): Record<string, AggregatedHealth> {
    return {
      '1h':  this.getHealth(connectorId, WINDOW_1H),
      '6h':  this.getHealth(connectorId, WINDOW_6H),
      '24h': this.getHealth(connectorId, WINDOW_24H),
      '7d':  this.getHealth(connectorId, WINDOW_7D),
    };
  }

  /* -- trend detection -------------------------------------------- */

  /**
   * Compare the current window's average latency and failure rate with
   * the previous equivalent window.  Returns 'improving', 'stable', or
   * 'degrading'.
   */
  private computeTrend(connectorId: string, windowMs: number): HealthTrend {
    const buf = this.buffers.get(connectorId);
    if (!buf) return 'stable';

    const now = Date.now();
    const currentCutoff = now - windowMs;
    const previousCutoff = currentCutoff - windowMs;

    const allChecks = buf.toArray();
    const currentChecks = allChecks.filter((c) => c.timestamp >= currentCutoff);
    const previousChecks = allChecks.filter(
      (c) => c.timestamp >= previousCutoff && c.timestamp < currentCutoff,
    );

    if (currentChecks.length < 2 || previousChecks.length < 2) return 'stable';

    const currentFailRate = currentChecks.filter((c) => c.status !== 'healthy').length / currentChecks.length;
    const previousFailRate = previousChecks.filter((c) => c.status !== 'healthy').length / previousChecks.length;

    const currentAvgLatency = currentChecks.reduce((s, c) => s + c.latencyMs, 0) / currentChecks.length;
    const previousAvgLatency = previousChecks.reduce((s, c) => s + c.latencyMs, 0) / previousChecks.length;

    /* A 10% relative threshold determines direction */
    const failRateDelta = currentFailRate - previousFailRate;
    const latencyRatio = previousAvgLatency > 0 ? currentAvgLatency / previousAvgLatency : 1;

    if (failRateDelta < -0.05 || latencyRatio < 0.9) return 'improving';
    if (failRateDelta > 0.05 || latencyRatio > 1.1) return 'degrading';
    return 'stable';
  }

  /* -- housekeeping ----------------------------------------------- */

  clearConnector(connectorId: string): void {
    this.buffers.delete(connectorId);
    this.stateSnapshots.delete(connectorId);
  }

  reset(): void {
    this.buffers.clear();
    this.stateSnapshots.clear();
    this.listeners = [];
    this.startTime = Date.now();
  }
}

/* ------------------------------------------------------------------ */
/*  SlaEngine                                                         */
/* ------------------------------------------------------------------ */

/**
 * Evaluates SLA definitions against live health data, tracks error budgets,
 * burn rates, and violation lifecycle (open / acknowledged / closed).
 */
export class SlaEngine {
  private definitions: Map<string, SlaDefinition> = new Map();
  private violations: Map<string, SlaViolation> = new Map();
  private openViolationsByConnector: Map<string, Set<string>> = new Map();
  private aggregator: HealthAggregator;
  private listeners: EventListener[] = [];

  constructor(aggregator: HealthAggregator) {
    this.aggregator = aggregator;
  }

  /* -- event handling --------------------------------------------- */

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  private emit(event: HealthEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* swallow */ }
    }
  }

  /* -- definition management -------------------------------------- */

  registerDefinition(def: SlaDefinition): void {
    this.definitions.set(def.id, def);
  }

  unregisterDefinition(definitionId: string): void {
    this.definitions.delete(definitionId);
    /* Close any open violations for this definition */
    const violIds = Array.from(this.violations.keys());
    for (const vid of violIds) {
      const v = this.violations.get(vid);
      if (v && v.definitionId === definitionId) {
        this.violations.delete(vid);
      }
    }
  }

  getDefinition(definitionId: string): SlaDefinition | undefined {
    return this.definitions.get(definitionId);
  }

  getAllDefinitions(): SlaDefinition[] {
    return Array.from(this.definitions.values());
  }

  getDefinitionsForConnector(connectorId: string): SlaDefinition[] {
    return Array.from(this.definitions.values()).filter((d) => d.connectorId === connectorId);
  }

  /* -- evaluation ------------------------------------------------- */

  evaluate(connectorId: string): SlaStatus[] {
    const defs = this.getDefinitionsForConnector(connectorId);
    return defs.map((def) => this.evaluateDefinition(def));
  }

  evaluateAll(): SlaStatus[] {
    const defs = Array.from(this.definitions.values());
    return defs.map((def) => this.evaluateDefinition(def));
  }

  private evaluateDefinition(def: SlaDefinition): SlaStatus {
    const health = this.aggregator.getHealth(def.connectorId, def.windowMs);

    const currentAvailability = health.checkCount > 0 ? health.uptimePercent : 100;
    const currentP95 = health.p95LatencyMs;
    const currentP99 = health.p99LatencyMs;
    const currentErrorRate = health.checkCount > 0
      ? (health.failureCount / health.checkCount) * 100
      : 0;

    /* Check each target */
    const availabilityViolation = currentAvailability < def.targets.availability;
    const p95Violation = currentP95 > def.targets.p95LatencyMs;
    const p99Violation = currentP99 > def.targets.p99LatencyMs;
    const errorRateViolation = currentErrorRate > def.targets.errorRatePercent;

    const inViolation = availabilityViolation || p95Violation || p99Violation || errorRateViolation;

    /* Error budget calculation */
    const totalBudgetMs = ((100 - def.targets.availability) / 100) * def.windowMs;
    const consumedMs = health.checkCount > 0
      ? (health.failureCount / health.checkCount) * def.windowMs
      : 0;
    const errorBudgetRemaining = Math.max(0, totalBudgetMs - consumedMs);

    /* Burn rate: how fast are we consuming error budget relative to ideal */
    const idealBurnRate = 1.0;  // consume 100% of budget exactly over the window
    const elapsedFraction = Math.min(1, (Date.now() - (Date.now() - def.windowMs)) / def.windowMs);
    const burnRate = totalBudgetMs > 0 && elapsedFraction > 0
      ? (consumedMs / totalBudgetMs) / elapsedFraction
      : 0;

    /* Violation lifecycle */
    this.manageViolations(def, {
      availabilityViolation,
      p95Violation,
      p99Violation,
      errorRateViolation,
      currentAvailability,
      currentP95,
      currentP99,
      currentErrorRate,
    });

    /* Find open violation for duration tracking */
    const openSet = this.openViolationsByConnector.get(def.connectorId);
    let violationStart: number | undefined;
    let violationDuration: number | undefined;

    if (openSet) {
      const openViolIds = Array.from(openSet);
      for (const vid of openViolIds) {
        const v = this.violations.get(vid);
        if (v && v.definitionId === def.id && !v.endTime) {
          violationStart = v.startTime;
          violationDuration = Date.now() - v.startTime;
          break;
        }
      }
    }

    return {
      definitionId: def.id,
      connectorId: def.connectorId,
      currentAvailability: Math.round(currentAvailability * 100) / 100,
      currentP95: Math.round(currentP95 * 100) / 100,
      currentP99: Math.round(currentP99 * 100) / 100,
      currentErrorRate: Math.round(currentErrorRate * 1000) / 1000,
      inViolation,
      violationStart,
      violationDuration,
      errorBudgetRemaining: Math.round(errorBudgetRemaining),
      burnRate: Math.round(burnRate * 1000) / 1000,
    };
  }

  private manageViolations(
    def: SlaDefinition,
    metrics: {
      availabilityViolation: boolean;
      p95Violation: boolean;
      p99Violation: boolean;
      errorRateViolation: boolean;
      currentAvailability: number;
      currentP95: number;
      currentP99: number;
      currentErrorRate: number;
    },
  ): void {
    const violationMetrics: Array<{ metric: string; threshold: number; actual: number; violated: boolean }> = [
      { metric: 'availability', threshold: def.targets.availability, actual: metrics.currentAvailability, violated: metrics.availabilityViolation },
      { metric: 'p95_latency', threshold: def.targets.p95LatencyMs, actual: metrics.currentP95, violated: metrics.p95Violation },
      { metric: 'p99_latency', threshold: def.targets.p99LatencyMs, actual: metrics.currentP99, violated: metrics.p99Violation },
      { metric: 'error_rate', threshold: def.targets.errorRatePercent, actual: metrics.currentErrorRate, violated: metrics.errorRateViolation },
    ];

    for (const vm of violationMetrics) {
      const existingOpen = this.findOpenViolation(def.id, vm.metric);

      if (vm.violated && !existingOpen) {
        /* Open new violation */
        const violation: SlaViolation = {
          id: nextViolationId(),
          definitionId: def.id,
          connectorId: def.connectorId,
          metric: vm.metric,
          threshold: vm.threshold,
          actual: vm.actual,
          startTime: Date.now(),
          acknowledged: false,
        };
        this.violations.set(violation.id, violation);

        let openSet = this.openViolationsByConnector.get(def.connectorId);
        if (!openSet) {
          openSet = new Set();
          this.openViolationsByConnector.set(def.connectorId, openSet);
        }
        openSet.add(violation.id);

        this.emit({
          type: 'sla_violation',
          connectorId: def.connectorId,
          timestamp: Date.now(),
          details: {
            definitionId: def.id,
            violationId: violation.id,
            metric: vm.metric,
            threshold: vm.threshold,
            actual: vm.actual,
          },
        });
      } else if (!vm.violated && existingOpen) {
        /* Close existing violation */
        existingOpen.endTime = Date.now();

        const openSet = this.openViolationsByConnector.get(def.connectorId);
        if (openSet) {
          openSet.delete(existingOpen.id);
          if (openSet.size === 0) {
            this.openViolationsByConnector.delete(def.connectorId);
          }
        }

        this.emit({
          type: 'sla_recovered',
          connectorId: def.connectorId,
          timestamp: Date.now(),
          details: {
            definitionId: def.id,
            violationId: existingOpen.id,
            metric: vm.metric,
            duration: existingOpen.endTime - existingOpen.startTime,
          },
        });
      } else if (vm.violated && existingOpen) {
        /* Update actual value on ongoing violation */
        existingOpen.actual = vm.actual;
      }
    }
  }

  private findOpenViolation(definitionId: string, metric: string): SlaViolation | undefined {
    const allViols = Array.from(this.violations.values());
    return allViols.find(
      (v) => v.definitionId === definitionId && v.metric === metric && !v.endTime,
    );
  }

  /* -- violation queries ------------------------------------------ */

  getViolations(filters?: {
    connectorId?: string;
    definitionId?: string;
    metric?: string;
    open?: boolean;
    acknowledged?: boolean;
    since?: number;
  }): SlaViolation[] {
    let result = Array.from(this.violations.values());

    if (filters) {
      if (filters.connectorId) {
        result = result.filter((v) => v.connectorId === filters.connectorId);
      }
      if (filters.definitionId) {
        result = result.filter((v) => v.definitionId === filters.definitionId);
      }
      if (filters.metric) {
        result = result.filter((v) => v.metric === filters.metric);
      }
      if (filters.open !== undefined) {
        result = filters.open
          ? result.filter((v) => !v.endTime)
          : result.filter((v) => !!v.endTime);
      }
      if (filters.acknowledged !== undefined) {
        result = result.filter((v) => v.acknowledged === filters.acknowledged);
      }
      if (filters.since !== undefined) {
        const since = filters.since;
        result = result.filter((v) => v.startTime >= since);
      }
    }

    return result.sort((a, b) => b.startTime - a.startTime);
  }

  getOpenViolationCount(connectorId: string): number {
    const openSet = this.openViolationsByConnector.get(connectorId);
    return openSet ? openSet.size : 0;
  }

  acknowledgeViolation(violationId: string, userId: string): void {
    const violation = this.violations.get(violationId);
    if (!violation) {
      throw new Error(`Violation "${violationId}" not found`);
    }
    if (violation.acknowledged) {
      throw new Error(`Violation "${violationId}" is already acknowledged`);
    }
    violation.acknowledged = true;
    violation.acknowledgedBy = userId;
  }

  /* -- housekeeping ----------------------------------------------- */

  /** Purge closed violations older than the given age. */
  purgeOldViolations(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const ids = Array.from(this.violations.keys());
    let purged = 0;

    for (const id of ids) {
      const v = this.violations.get(id);
      if (v && v.endTime && v.endTime < cutoff) {
        this.violations.delete(id);
        purged += 1;
      }
    }

    return purged;
  }

  reset(): void {
    this.definitions.clear();
    this.violations.clear();
    this.openViolationsByConnector.clear();
    this.listeners = [];
  }
}

/* ------------------------------------------------------------------ */
/*  HealthReporter                                                    */
/* ------------------------------------------------------------------ */

export interface HealthReport {
  generatedAt: number;
  windowMs: number;
  system: SystemHealth;
  connectors: AggregatedHealth[];
  slaStatuses: SlaStatus[];
  openViolations: SlaViolation[];
  topOffenders: Array<{ connectorId: string; downtimePercent: number; failureCount: number }>;
  recommendations: HealthRecommendation[];
}

export interface IncidentEntry {
  timestamp: number;
  connectorId: string;
  type: 'degraded' | 'unhealthy' | 'recovered' | 'sla_violation' | 'sla_recovered';
  description: string;
  details: Record<string, unknown>;
}

export interface HealthRecommendation {
  connectorId: string;
  severity: 'info' | 'warning' | 'critical';
  category: string;
  message: string;
  suggestedAction: string;
}

export interface DependencyImpact {
  connectorId: string;
  status: HealthStatus;
  dependents: string[];
  impactedSlas: string[];
}

/**
 * Generates structured reports, incident timelines, top-offender rankings,
 * dependency impact analysis, and automated recommendations.
 */
export class HealthReporter {
  private aggregator: HealthAggregator;
  private slaEngine: SlaEngine;
  private dependencyMap: Map<string, Set<string>> = new Map();

  constructor(aggregator: HealthAggregator, slaEngine: SlaEngine) {
    this.aggregator = aggregator;
    this.slaEngine = slaEngine;
  }

  /* -- dependency registration ------------------------------------ */

  /**
   * Register that `downstream` depends on `upstream`.  When `upstream` is
   * unhealthy the impact analysis will flag `downstream` as affected.
   */
  registerDependency(upstream: string, downstream: string): void {
    let set = this.dependencyMap.get(upstream);
    if (!set) {
      set = new Set();
      this.dependencyMap.set(upstream, set);
    }
    set.add(downstream);
  }

  unregisterDependency(upstream: string, downstream: string): void {
    const set = this.dependencyMap.get(upstream);
    if (set) {
      set.delete(downstream);
      if (set.size === 0) this.dependencyMap.delete(upstream);
    }
  }

  getDependents(upstream: string): string[] {
    const set = this.dependencyMap.get(upstream);
    return set ? Array.from(set) : [];
  }

  /* -- report generation ------------------------------------------ */

  generateReport(windowMs: number = WINDOW_1H): HealthReport {
    const system = this.aggregator.getSystemHealth();
    const connectors = this.aggregator.getAllHealth(windowMs);
    const slaStatuses = this.slaEngine.evaluateAll();
    const openViolations = this.slaEngine.getViolations({ open: true });
    const topOffenders = this.getTopOffenders(10, windowMs);
    const recommendations = this.getRecommendations(windowMs);

    return {
      generatedAt: Date.now(),
      windowMs,
      system,
      connectors,
      slaStatuses,
      openViolations,
      topOffenders,
      recommendations,
    };
  }

  /* -- incident timeline ------------------------------------------ */

  generateIncidentTimeline(
    connectorId: string,
    since: number = Date.now() - WINDOW_24H,
  ): IncidentEntry[] {
    const entries: IncidentEntry[] = [];
    const checks = this.aggregator.getChecks(connectorId, Date.now() - since);

    /* Detect state transitions within the check history */
    let previousStatus: HealthStatus | null = null;

    for (const check of checks) {
      if (previousStatus !== null && check.status !== previousStatus) {
        if (check.status === 'healthy' && (previousStatus === 'degraded' || previousStatus === 'unhealthy')) {
          entries.push({
            timestamp: check.timestamp,
            connectorId,
            type: 'recovered',
            description: `Connector recovered from ${previousStatus} to healthy`,
            details: { latencyMs: check.latencyMs, previousStatus },
          });
        } else if (check.status === 'degraded') {
          entries.push({
            timestamp: check.timestamp,
            connectorId,
            type: 'degraded',
            description: `Connector entered degraded state${check.error ? ': ' + check.error : ''}`,
            details: { latencyMs: check.latencyMs, error: check.error ?? null },
          });
        } else if (check.status === 'unhealthy') {
          entries.push({
            timestamp: check.timestamp,
            connectorId,
            type: 'unhealthy',
            description: `Connector became unhealthy${check.error ? ': ' + check.error : ''}`,
            details: { latencyMs: check.latencyMs, error: check.error ?? null },
          });
        }
      }
      previousStatus = check.status;
    }

    /* Add SLA violations */
    const violations = this.slaEngine.getViolations({ connectorId, since });
    for (const v of violations) {
      entries.push({
        timestamp: v.startTime,
        connectorId,
        type: 'sla_violation',
        description: `SLA violation on ${v.metric}: ${v.actual} (threshold: ${v.threshold})`,
        details: { definitionId: v.definitionId, metric: v.metric, threshold: v.threshold, actual: v.actual },
      });
      if (v.endTime) {
        entries.push({
          timestamp: v.endTime,
          connectorId,
          type: 'sla_recovered',
          description: `SLA ${v.metric} recovered after ${Math.round((v.endTime - v.startTime) / 1000)}s`,
          details: { definitionId: v.definitionId, metric: v.metric, duration: v.endTime - v.startTime },
        });
      }
    }

    return entries.sort((a, b) => a.timestamp - b.timestamp);
  }

  /* -- top offenders ---------------------------------------------- */

  getTopOffenders(
    limit: number = 10,
    windowMs: number = WINDOW_1H,
  ): Array<{ connectorId: string; downtimePercent: number; failureCount: number }> {
    const allHealth = this.aggregator.getAllHealth(windowMs);

    const offenders = allHealth
      .filter((h) => h.failureCount > 0)
      .map((h) => ({
        connectorId: h.connectorId,
        downtimePercent: Math.round((100 - h.uptimePercent) * 100) / 100,
        failureCount: h.failureCount,
      }))
      .sort((a, b) => b.downtimePercent - a.downtimePercent);

    return offenders.slice(0, limit);
  }

  /* -- dependency impact ------------------------------------------ */

  getDependencyImpact(connectorId: string): DependencyImpact {
    const health = this.aggregator.getHealth(connectorId);
    const dependents = this.getDependents(connectorId);

    /* Find SLAs that reference this connector */
    const allDefs = this.slaEngine.getAllDefinitions();
    const impactedSlas = allDefs
      .filter((d) => d.connectorId === connectorId)
      .map((d) => d.id);

    /* Also find SLAs on dependent connectors */
    for (const dep of dependents) {
      const depDefs = allDefs.filter((d) => d.connectorId === dep);
      for (const dd of depDefs) {
        if (!impactedSlas.includes(dd.id)) {
          impactedSlas.push(dd.id);
        }
      }
    }

    return {
      connectorId,
      status: health.status,
      dependents,
      impactedSlas,
    };
  }

  /* -- recommendations -------------------------------------------- */

  getRecommendations(windowMs: number = WINDOW_1H): HealthRecommendation[] {
    const recommendations: HealthRecommendation[] = [];
    const allHealth = this.aggregator.getAllHealth(windowMs);

    for (const health of allHealth) {
      const cid = health.connectorId;

      /* High failure rate */
      if (health.checkCount > 0 && health.failureCount / health.checkCount > 0.5) {
        recommendations.push({
          connectorId: cid,
          severity: 'critical',
          category: 'reliability',
          message: `Connector "${cid}" has a failure rate above 50% (${Math.round((health.failureCount / health.checkCount) * 100)}%)`,
          suggestedAction: 'Consider disabling this connector or investigating the root cause immediately.',
        });
      } else if (health.checkCount > 0 && health.failureCount / health.checkCount > 0.1) {
        recommendations.push({
          connectorId: cid,
          severity: 'warning',
          category: 'reliability',
          message: `Connector "${cid}" has a failure rate above 10% (${Math.round((health.failureCount / health.checkCount) * 100)}%)`,
          suggestedAction: 'Add retry logic or increase timeout values for this connector.',
        });
      }

      /* High latency */
      if (health.p95LatencyMs > 5000) {
        recommendations.push({
          connectorId: cid,
          severity: 'warning',
          category: 'performance',
          message: `Connector "${cid}" P95 latency is ${Math.round(health.p95LatencyMs)}ms (> 5000ms)`,
          suggestedAction: 'Increase timeout, add caching, or consider using a faster endpoint.',
        });
      }

      if (health.p99LatencyMs > 10000) {
        recommendations.push({
          connectorId: cid,
          severity: 'critical',
          category: 'performance',
          message: `Connector "${cid}" P99 latency is ${Math.round(health.p99LatencyMs)}ms (> 10000ms)`,
          suggestedAction: 'Investigate outlier requests. Consider circuit-breaking or load shedding.',
        });
      }

      /* Degrading trend */
      if (health.trend === 'degrading') {
        recommendations.push({
          connectorId: cid,
          severity: 'info',
          category: 'trend',
          message: `Connector "${cid}" health is trending downward compared to the previous window`,
          suggestedAction: 'Monitor closely. If trend continues, investigate recent changes.',
        });
      }

      /* No recent checks */
      if (health.checkCount === 0) {
        recommendations.push({
          connectorId: cid,
          severity: 'info',
          category: 'observability',
          message: `Connector "${cid}" has no health checks in the current window`,
          suggestedAction: 'Register a health policy to enable periodic monitoring.',
        });
      }

      /* Status-based recommendations */
      if (health.status === 'unhealthy') {
        const dependents = this.getDependents(cid);
        if (dependents.length > 0) {
          recommendations.push({
            connectorId: cid,
            severity: 'critical',
            category: 'dependency',
            message: `Unhealthy connector "${cid}" has ${dependents.length} dependent connector(s): ${dependents.join(', ')}`,
            suggestedAction: 'Fix this connector urgently as it impacts downstream services.',
          });
        }
      }

      /* SLA burn rate */
      const slaStatuses = this.slaEngine.evaluate(cid);
      for (const sla of slaStatuses) {
        if (sla.burnRate > 2.0) {
          recommendations.push({
            connectorId: cid,
            severity: 'critical',
            category: 'sla',
            message: `Connector "${cid}" SLA "${sla.definitionId}" burn rate is ${sla.burnRate}x (consuming error budget 2x faster than sustainable)`,
            suggestedAction: 'Immediate action required. Error budget will be exhausted before the SLA window ends.',
          });
        } else if (sla.burnRate > 1.0) {
          recommendations.push({
            connectorId: cid,
            severity: 'warning',
            category: 'sla',
            message: `Connector "${cid}" SLA "${sla.definitionId}" burn rate is ${sla.burnRate}x (above sustainable rate)`,
            suggestedAction: 'Investigate and remediate before error budget is exhausted.',
          });
        }

        if (sla.errorBudgetRemaining <= 0 && sla.inViolation) {
          recommendations.push({
            connectorId: cid,
            severity: 'critical',
            category: 'sla',
            message: `Connector "${cid}" SLA "${sla.definitionId}" error budget is fully exhausted`,
            suggestedAction: 'SLA is in violation. Consider an incident response process.',
          });
        }
      }
    }

    /* Sort by severity: critical > warning > info */
    const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    return recommendations.sort(
      (a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3),
    );
  }

  reset(): void {
    this.dependencyMap.clear();
  }
}

/* ------------------------------------------------------------------ */
/*  HealthEndpointBuilder                                             */
/* ------------------------------------------------------------------ */

export interface LivenessResponse {
  status: 'ok';
  timestamp: number;
}

export interface ReadinessResponse {
  status: 'ok' | 'degraded' | 'not_ready';
  timestamp: number;
  connectors: Record<string, { status: HealthStatus; latencyMs: number }>;
  details: {
    healthyCount: number;
    totalCount: number;
  };
}

export interface DetailedHealthResponse {
  status: HealthStatus;
  timestamp: number;
  uptime: number;
  system: SystemHealth;
  connectors: AggregatedHealth[];
  sla: {
    statuses: SlaStatus[];
    openViolations: SlaViolation[];
    totalViolations: number;
  };
  recommendations: HealthRecommendation[];
}

/**
 * Builds Express-compatible JSON responses for standard health endpoints.
 */
export class HealthEndpointBuilder {
  private aggregator: HealthAggregator;
  private slaEngine: SlaEngine;
  private reporter: HealthReporter;
  private startTime: number = Date.now();

  constructor(
    aggregator: HealthAggregator,
    slaEngine: SlaEngine,
    reporter: HealthReporter,
  ) {
    this.aggregator = aggregator;
    this.slaEngine = slaEngine;
    this.reporter = reporter;
  }

  /**
   * /health/live — lightweight liveness probe.
   * Always returns { status: 'ok' } if the process is alive.
   */
  buildLivenessCheck(): LivenessResponse {
    return {
      status: 'ok',
      timestamp: Date.now(),
    };
  }

  /**
   * /health/ready — readiness probe.
   * Returns 'ok' if all connectors are healthy, 'degraded' if at least one
   * is degraded but none unhealthy, 'not_ready' if any are unhealthy.
   */
  buildReadinessCheck(): ReadinessResponse {
    const allHealth = this.aggregator.getAllHealth();
    const connectors: Record<string, { status: HealthStatus; latencyMs: number }> = {};

    let hasUnhealthy = false;
    let hasDegraded = false;
    let healthyCount = 0;

    for (const h of allHealth) {
      connectors[h.connectorId] = {
        status: h.status,
        latencyMs: h.avgLatencyMs,
      };
      if (h.status === 'unhealthy') hasUnhealthy = true;
      else if (h.status === 'degraded') hasDegraded = true;
      else if (h.status === 'healthy') healthyCount += 1;
    }

    let status: 'ok' | 'degraded' | 'not_ready' = 'ok';
    if (hasUnhealthy) {
      status = 'not_ready';
    } else if (hasDegraded) {
      status = 'degraded';
    }

    return {
      status,
      timestamp: Date.now(),
      connectors,
      details: {
        healthyCount,
        totalCount: allHealth.length,
      },
    };
  }

  /**
   * /health — detailed health check with full SLA statuses.
   */
  buildDetailedCheck(windowMs: number = WINDOW_1H): DetailedHealthResponse {
    const system = this.aggregator.getSystemHealth();
    const connectors = this.aggregator.getAllHealth(windowMs);
    const slaStatuses = this.slaEngine.evaluateAll();
    const openViolations = this.slaEngine.getViolations({ open: true });
    const allViolations = this.slaEngine.getViolations();
    const recommendations = this.reporter.getRecommendations(windowMs);

    return {
      status: system.overallStatus,
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      system,
      connectors,
      sla: {
        statuses: slaStatuses,
        openViolations,
        totalViolations: allViolations.length,
      },
      recommendations,
    };
  }

  /**
   * Utility: determine HTTP status code from a readiness response.
   */
  httpStatusFromReadiness(response: ReadinessResponse): number {
    switch (response.status) {
      case 'ok':        return 200;
      case 'degraded':  return 200;
      case 'not_ready': return 503;
      default:          return 500;
    }
  }

  /**
   * Utility: determine HTTP status code from a detailed response.
   */
  httpStatusFromDetailed(response: DetailedHealthResponse): number {
    switch (response.status) {
      case 'healthy':   return 200;
      case 'degraded':  return 200;
      case 'unhealthy': return 503;
      case 'unknown':   return 200;
      default:          return 500;
    }
  }

  /**
   * Build a compact summary suitable for dashboard embedding.
   */
  buildDashboardSummary(): {
    status: HealthStatus;
    connectorCount: number;
    healthyPercent: number;
    openViolations: number;
    topIssue: string | null;
  } {
    const system = this.aggregator.getSystemHealth();
    const total = system.healthyCount + system.degradedCount + system.unhealthyCount + system.unknownCount;
    const healthyPercent = total > 0 ? Math.round((system.healthyCount / total) * 100) : 100;
    const openViolations = this.slaEngine.getViolations({ open: true }).length;

    const recommendations = this.reporter.getRecommendations();
    const topIssue = recommendations.length > 0 ? recommendations[0].message : null;

    return {
      status: system.overallStatus,
      connectorCount: total,
      healthyPercent,
      openViolations,
      topIssue,
    };
  }

  reset(): void {
    this.startTime = Date.now();
  }
}

/* ------------------------------------------------------------------ */
/*  Wire everything together and export singletons                    */
/* ------------------------------------------------------------------ */

export const healthAggregator = new HealthAggregator();

export const healthCheckScheduler = new HealthCheckScheduler();

/* Connect scheduler events to aggregator */
healthCheckScheduler.onEvent((event) => {
  if (event.type === 'check_completed') {
    const details = event.details as {
      checkType: CheckType;
      status: HealthStatus;
      latencyMs: number;
      error: string | null;
    };
    healthAggregator.recordCheck({
      connectorId: event.connectorId,
      checkType: details.checkType,
      status: details.status,
      latencyMs: details.latencyMs,
      timestamp: event.timestamp,
      error: details.error ?? undefined,
    });
  }
});

export const slaEngine = new SlaEngine(healthAggregator);

/* Connect aggregator recordings to SLA evaluation */
healthCheckScheduler.onEvent((event) => {
  if (event.type === 'check_completed') {
    /* Re-evaluate SLAs after every check */
    try {
      slaEngine.evaluate(event.connectorId);
    } catch {
      /* SLA evaluation errors must not break health pipeline */
    }
  }
});

export const healthReporter = new HealthReporter(healthAggregator, slaEngine);

export const healthEndpointBuilder = new HealthEndpointBuilder(
  healthAggregator,
  slaEngine,
  healthReporter,
);
