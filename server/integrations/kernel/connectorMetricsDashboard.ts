/**
 * connectorMetricsDashboard.ts
 * ---------------------------------------------------------------------------
 * Real-time metrics aggregation and dashboard for the connector kernel.
 * Provides sliding-window metrics (1m/5m/15m/1h), percentile latency,
 * circuit-breaker state tracking, latency heatmaps, throughput tracking,
 * error classification with anomaly detection, and a unified dashboard API.
 *
 * Standalone module — no imports from other kernel files.
 * All Map/Set iterators wrapped with Array.from().
 * ---------------------------------------------------------------------------
 */

/* ========================================================================= */
/*  TYPES & INTERFACES                                                       */
/* ========================================================================= */

export type MetricsWindow = '1m' | '5m' | '15m' | '1h';

export type CircuitState = 'closed' | 'open' | 'half_open';

export type ErrorType =
  | 'timeout'
  | 'rate_limited'
  | 'connection'
  | 'auth'
  | 'not_found'
  | 'server_error'
  | 'unknown';

export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface OperationRecord {
  connectorId: string;
  operationId: string;
  timestamp: number;
  durationMs: number;
  success: boolean;
  statusCode?: number;
  errorType?: ErrorType;
  errorMessage?: string;
  requestSizeBytes?: number;
  responseSizeBytes?: number;
}

export interface ConnectorMetricsSnapshot {
  connectorId: string;
  window: MetricsWindow;
  totalOperations: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  throughputPerSec: number;
  errorBreakdown: Record<ErrorType, number>;
  lastActivityTs: number;
}

export interface OperationMetricsSnapshot {
  operationId: string;
  connectorId: string;
  totalCalls: number;
  successRate: number;
  avgDurationMs: number;
  p95DurationMs: number;
  lastCallTs: number;
}

export interface SystemMetricsSnapshot {
  totalOperations: number;
  totalSuccess: number;
  totalFailure: number;
  overallSuccessRate: number;
  activeConnectors: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  throughputPerSec: number;
  uptimeMs: number;
}

export interface CircuitStateSnapshot {
  connectorId: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastTransitionTs: number;
  lastFailureTs: number | null;
  halfOpenProbeAllowed: boolean;
}

export interface CircuitTransition {
  connectorId: string;
  fromState: CircuitState;
  toState: CircuitState;
  timestamp: number;
  reason: string;
  failureCount: number;
}

export interface SystemCircuitStatus {
  totalCircuits: number;
  closedCount: number;
  openCount: number;
  halfOpenCount: number;
  transitions: CircuitTransition[];
}

export interface HeatmapRow {
  connectorId: string;
  buckets: { rangeLabel: string; count: number; percentage: number }[];
  total: number;
}

export interface LatencyPercentiles {
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
}

export interface ThroughputSnapshot {
  connectorId: string;
  currentRps: number;
  peakRps: number;
  avgRps: number;
}

export interface ThroughputHistoryEntry {
  timestamp: number;
  requestCount: number;
  rps: number;
}

export interface ErrorBreakdownEntry {
  errorType: ErrorType;
  count: number;
  percentage: number;
  lastOccurrence: number;
  sampleMessage?: string;
}

export interface ErrorTrendEntry {
  timestamp: number;
  errorType: ErrorType;
  count: number;
}

export interface ErrorRecord {
  connectorId: string;
  operationId: string;
  timestamp: number;
  errorType: ErrorType;
  message: string;
  statusCode?: number;
}

export interface AnomalyEntry {
  connectorId: string;
  type: 'latency_spike' | 'error_spike' | 'throughput_drop' | 'circuit_oscillation';
  severity: AlertSeverity;
  message: string;
  detectedAt: number;
  value: number;
  baseline: number;
}

export interface DashboardAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  connectorId?: string;
  timestamp: number;
  acknowledged: boolean;
}

export interface FullDashboard {
  system: SystemMetricsSnapshot;
  connectors: ConnectorMetricsSnapshot[];
  circuits: SystemCircuitStatus;
  alerts: DashboardAlert[];
  anomalies: AnomalyEntry[];
  healthScore: number;
  generatedAt: number;
}

export interface ConnectorDetail {
  metrics: ConnectorMetricsSnapshot;
  circuit: CircuitStateSnapshot;
  operations: OperationMetricsSnapshot[];
  latencyPercentiles: LatencyPercentiles;
  throughput: ThroughputSnapshot;
  errors: ErrorBreakdownEntry[];
  heatmap: HeatmapRow;
}

/* ========================================================================= */
/*  RING BUFFER                                                              */
/* ========================================================================= */

const WINDOW_MS: Record<MetricsWindow, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
};

/**
 * Fixed-size circular buffer for efficient sliding-window storage.
 */
export class RingBuffer<T> {
  private readonly buffer: (T | undefined)[];
  private head = 0;
  private count = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity).fill(undefined);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  toArray(): T[] {
    if (this.count === 0) return [];
    const result: T[] = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      const item = this.buffer[idx];
      if (item !== undefined) result.push(item);
    }
    return result;
  }

  size(): number {
    return this.count;
  }

  clear(): void {
    this.buffer.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  peek(): T | undefined {
    if (this.count === 0) return undefined;
    const idx = this.count < this.capacity ? this.count - 1 : (this.head - 1 + this.capacity) % this.capacity;
    return this.buffer[idx];
  }

  getCapacity(): number {
    return this.capacity;
  }

  isFull(): boolean {
    return this.count >= this.capacity;
  }

  forEach(fn: (item: T, index: number) => void): void {
    const arr = this.toArray();
    arr.forEach(fn);
  }
}

/* ========================================================================= */
/*  CONNECTOR METRICS COLLECTOR                                              */
/* ========================================================================= */

/**
 * Collects per-connector operation records and provides sliding-window
 * metrics with percentile latency calculations.
 */
export class ConnectorMetricsCollector {
  /** connectorId → ring buffer of operation records */
  private readonly records = new Map<string, RingBuffer<OperationRecord>>();
  /** Maximum records per connector */
  private readonly maxRecordsPerConnector = 10_000;
  /** Global start time (for uptime calculation) */
  private readonly startedAt = Date.now();
  /** Total operations counter */
  private totalOps = 0;

  /**
   * Record a completed operation.
   */
  recordOperation(record: OperationRecord): void {
    const buf = this.getOrCreateBuffer(record.connectorId);
    buf.push(record);
    this.totalOps++;
  }

  /**
   * Get a metrics snapshot for a connector within a given window.
   */
  getSnapshot(connectorId: string, window: MetricsWindow = '1m'): ConnectorMetricsSnapshot {
    const buf = this.records.get(connectorId);
    const windowMs = WINDOW_MS[window];
    const now = Date.now();
    const cutoff = now - windowMs;

    const allRecords = buf ? buf.toArray() : [];
    const filtered = allRecords.filter((r) => r.timestamp > cutoff);

    if (filtered.length === 0) {
      return this.emptySnapshot(connectorId, window);
    }

    const successes = filtered.filter((r) => r.success);
    const failures = filtered.filter((r) => !r.success);
    const durations = filtered.map((r) => r.durationMs).sort((a, b) => a - b);

    const errorBreakdown: Record<ErrorType, number> = {
      timeout: 0,
      rate_limited: 0,
      connection: 0,
      auth: 0,
      not_found: 0,
      server_error: 0,
      unknown: 0,
    };
    for (const f of failures) {
      const et = f.errorType ?? 'unknown';
      errorBreakdown[et]++;
    }

    return {
      connectorId,
      window,
      totalOperations: filtered.length,
      successCount: successes.length,
      failureCount: failures.length,
      successRate: successes.length / filtered.length,
      avgDurationMs: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      p50DurationMs: this.percentile(durations, 50),
      p95DurationMs: this.percentile(durations, 95),
      p99DurationMs: this.percentile(durations, 99),
      minDurationMs: durations[0],
      maxDurationMs: durations[durations.length - 1],
      throughputPerSec: filtered.length / (windowMs / 1000),
      errorBreakdown,
      lastActivityTs: Math.max(...filtered.map((r) => r.timestamp)),
    };
  }

  /**
   * Get metrics snapshots for all tracked connectors.
   */
  getAllSnapshots(window: MetricsWindow = '1m'): ConnectorMetricsSnapshot[] {
    return Array.from(this.records.keys()).map((id) => this.getSnapshot(id, window));
  }

  /**
   * Get per-operation metrics for a connector.
   */
  getOperationMetrics(connectorId: string, windowMs: number = 300_000): OperationMetricsSnapshot[] {
    const buf = this.records.get(connectorId);
    if (!buf) return [];

    const now = Date.now();
    const cutoff = now - windowMs;
    const allRecords = buf.toArray().filter((r) => r.timestamp > cutoff);

    const grouped = new Map<string, OperationRecord[]>();
    for (const r of allRecords) {
      const existing = grouped.get(r.operationId) ?? [];
      existing.push(r);
      grouped.set(r.operationId, existing);
    }

    return Array.from(grouped.entries()).map(([opId, recs]) => {
      const successes = recs.filter((r) => r.success).length;
      const avgDur = recs.reduce((s, r) => s + r.durationMs, 0) / recs.length;
      const sorted = recs.map((r) => r.durationMs).sort((a, b) => a - b);

      return {
        operationId: opId,
        connectorId,
        totalCalls: recs.length,
        successRate: successes / recs.length,
        avgDurationMs: Math.round(avgDur),
        p95DurationMs: this.percentile(sorted, 95),
        lastCallTs: Math.max(...recs.map((r) => r.timestamp)),
      };
    });
  }

  /**
   * Get system-wide metrics.
   */
  getSystemMetrics(window: MetricsWindow = '1m'): SystemMetricsSnapshot {
    const windowMs = WINDOW_MS[window];
    const now = Date.now();
    const cutoff = now - windowMs;

    let totalOps = 0;
    let totalSuccess = 0;
    let totalFailure = 0;
    const allDurations: number[] = [];

    for (const [, buf] of Array.from(this.records.entries())) {
      const recs = buf.toArray().filter((r) => r.timestamp > cutoff);
      totalOps += recs.length;
      totalSuccess += recs.filter((r) => r.success).length;
      totalFailure += recs.filter((r) => !r.success).length;
      for (const r of recs) allDurations.push(r.durationMs);
    }

    allDurations.sort((a, b) => a - b);

    return {
      totalOperations: totalOps,
      totalSuccess,
      totalFailure,
      overallSuccessRate: totalOps > 0 ? totalSuccess / totalOps : 1,
      activeConnectors: Array.from(this.records.keys()).length,
      avgLatencyMs:
        allDurations.length > 0
          ? Math.round(allDurations.reduce((a, b) => a + b, 0) / allDurations.length)
          : 0,
      p95LatencyMs: allDurations.length > 0 ? this.percentile(allDurations, 95) : 0,
      throughputPerSec: totalOps / (windowMs / 1000),
      uptimeMs: now - this.startedAt,
    };
  }

  /**
   * Get latency percentiles for a connector.
   */
  getLatencyPercentiles(connectorId: string, windowMs: number = 300_000): LatencyPercentiles {
    const buf = this.records.get(connectorId);
    if (!buf) return { p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };

    const now = Date.now();
    const cutoff = now - windowMs;
    const durations = buf
      .toArray()
      .filter((r) => r.timestamp > cutoff)
      .map((r) => r.durationMs)
      .sort((a, b) => a - b);

    if (durations.length === 0) {
      return { p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
    }

    return {
      p50: this.percentile(durations, 50),
      p75: this.percentile(durations, 75),
      p90: this.percentile(durations, 90),
      p95: this.percentile(durations, 95),
      p99: this.percentile(durations, 99),
      min: durations[0],
      max: durations[durations.length - 1],
      avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    };
  }

  /**
   * Get all tracked connector IDs.
   */
  getTrackedConnectors(): string[] {
    return Array.from(this.records.keys());
  }

  /**
   * Clear all records for a connector.
   */
  clearConnector(connectorId: string): void {
    this.records.delete(connectorId);
  }

  /**
   * Clear all records.
   */
  clearAll(): void {
    this.records.clear();
    this.totalOps = 0;
  }

  /**
   * Get total recorded operations (lifetime).
   */
  getTotalOps(): number {
    return this.totalOps;
  }

  /* ------------------------------------------------------------------- */
  /*  Private helpers                                                     */
  /* ------------------------------------------------------------------- */

  private getOrCreateBuffer(connectorId: string): RingBuffer<OperationRecord> {
    let buf = this.records.get(connectorId);
    if (!buf) {
      buf = new RingBuffer<OperationRecord>(this.maxRecordsPerConnector);
      this.records.set(connectorId, buf);
    }
    return buf;
  }

  private percentile(sorted: number[], pct: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((pct / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
  }

  private emptySnapshot(connectorId: string, window: MetricsWindow): ConnectorMetricsSnapshot {
    return {
      connectorId,
      window,
      totalOperations: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 1,
      avgDurationMs: 0,
      p50DurationMs: 0,
      p95DurationMs: 0,
      p99DurationMs: 0,
      minDurationMs: 0,
      maxDurationMs: 0,
      throughputPerSec: 0,
      errorBreakdown: {
        timeout: 0,
        rate_limited: 0,
        connection: 0,
        auth: 0,
        not_found: 0,
        server_error: 0,
        unknown: 0,
      },
      lastActivityTs: 0,
    };
  }
}

/* ========================================================================= */
/*  CIRCUIT BREAKER DASHBOARD                                                */
/* ========================================================================= */

interface CircuitRecord {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastTransitionTs: number;
  lastFailureTs: number | null;
}

/**
 * Tracks circuit-breaker state per connector and maintains a transition
 * history for diagnostics and dashboard display.
 */
export class CircuitBreakerDashboard {
  private readonly circuits = new Map<string, CircuitRecord>();
  private readonly transitions = new RingBuffer<CircuitTransition>(100);

  /**
   * Update the circuit state for a connector.
   */
  updateState(
    connectorId: string,
    newState: CircuitState,
    reason: string,
    failureCount: number = 0,
  ): void {
    const existing = this.circuits.get(connectorId);
    const prevState = existing?.state ?? 'closed';

    if (prevState !== newState) {
      this.transitions.push({
        connectorId,
        fromState: prevState,
        toState: newState,
        timestamp: Date.now(),
        reason,
        failureCount,
      });
    }

    this.circuits.set(connectorId, {
      state: newState,
      failureCount: newState === 'closed' ? 0 : failureCount,
      successCount: existing?.successCount ?? 0,
      lastTransitionTs: Date.now(),
      lastFailureTs: newState === 'open' ? Date.now() : (existing?.lastFailureTs ?? null),
    });
  }

  /**
   * Record a success for a connector (useful for half-open → closed transitions).
   */
  recordSuccess(connectorId: string): void {
    const rec = this.circuits.get(connectorId);
    if (!rec) {
      this.circuits.set(connectorId, {
        state: 'closed',
        failureCount: 0,
        successCount: 1,
        lastTransitionTs: Date.now(),
        lastFailureTs: null,
      });
      return;
    }
    rec.successCount++;
    if (rec.state === 'half_open') {
      this.updateState(connectorId, 'closed', 'probe_success');
    }
  }

  /**
   * Record a failure for a connector.
   */
  recordFailure(connectorId: string, threshold: number = 5): void {
    const rec = this.circuits.get(connectorId) ?? {
      state: 'closed' as CircuitState,
      failureCount: 0,
      successCount: 0,
      lastTransitionTs: Date.now(),
      lastFailureTs: null,
    };
    rec.failureCount++;
    rec.lastFailureTs = Date.now();
    this.circuits.set(connectorId, rec);

    if (rec.failureCount >= threshold && rec.state === 'closed') {
      this.updateState(connectorId, 'open', `threshold_reached (${rec.failureCount}/${threshold})`, rec.failureCount);
    } else if (rec.state === 'half_open') {
      this.updateState(connectorId, 'open', 'probe_failed', rec.failureCount);
    }
  }

  /**
   * Attempt to move an open circuit to half-open for probe.
   */
  attemptHalfOpen(connectorId: string, cooldownMs: number = 30_000): boolean {
    const rec = this.circuits.get(connectorId);
    if (!rec || rec.state !== 'open') return false;

    const elapsed = Date.now() - rec.lastTransitionTs;
    if (elapsed >= cooldownMs) {
      this.updateState(connectorId, 'half_open', 'cooldown_expired', rec.failureCount);
      return true;
    }
    return false;
  }

  /**
   * Get the snapshot for a single connector circuit.
   */
  getCircuitSnapshot(connectorId: string): CircuitStateSnapshot {
    const rec = this.circuits.get(connectorId);
    if (!rec) {
      return {
        connectorId,
        state: 'closed',
        failureCount: 0,
        successCount: 0,
        lastTransitionTs: 0,
        lastFailureTs: null,
        halfOpenProbeAllowed: false,
      };
    }

    return {
      connectorId,
      state: rec.state,
      failureCount: rec.failureCount,
      successCount: rec.successCount,
      lastTransitionTs: rec.lastTransitionTs,
      lastFailureTs: rec.lastFailureTs,
      halfOpenProbeAllowed: rec.state === 'half_open',
    };
  }

  /**
   * Get system-wide circuit status.
   */
  getSystemStatus(): SystemCircuitStatus {
    const allCircuits = Array.from(this.circuits.entries());
    const closedCount = allCircuits.filter(([, r]) => r.state === 'closed').length;
    const openCount = allCircuits.filter(([, r]) => r.state === 'open').length;
    const halfOpenCount = allCircuits.filter(([, r]) => r.state === 'half_open').length;

    return {
      totalCircuits: allCircuits.length,
      closedCount,
      openCount,
      halfOpenCount,
      transitions: this.transitions.toArray(),
    };
  }

  /**
   * Force-reset a circuit to closed.
   */
  forceClose(connectorId: string): void {
    this.updateState(connectorId, 'closed', 'manual_reset');
  }

  /**
   * Get all tracked connector IDs.
   */
  getTrackedConnectors(): string[] {
    return Array.from(this.circuits.keys());
  }

  /**
   * Clear all circuit state.
   */
  clearAll(): void {
    this.circuits.clear();
    this.transitions.clear();
  }
}

/* ========================================================================= */
/*  LATENCY HEATMAP                                                          */
/* ========================================================================= */

const LATENCY_BUCKETS = [
  { label: '0-50ms', min: 0, max: 50 },
  { label: '50-100ms', min: 50, max: 100 },
  { label: '100-250ms', min: 100, max: 250 },
  { label: '250-500ms', min: 250, max: 500 },
  { label: '500ms-1s', min: 500, max: 1000 },
  { label: '1s-2s', min: 1000, max: 2000 },
  { label: '2s-5s', min: 2000, max: 5000 },
  { label: '5s+', min: 5000, max: Infinity },
];

/**
 * Distributes latency measurements into fixed buckets per connector.
 */
export class LatencyHeatmap {
  /** connectorId → per-bucket counts */
  private readonly data = new Map<string, number[]>();
  /** connectorId → total count */
  private readonly totals = new Map<string, number>();

  /**
   * Record a latency measurement.
   */
  record(connectorId: string, durationMs: number): void {
    const buckets = this.getOrCreateBuckets(connectorId);
    for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
      const b = LATENCY_BUCKETS[i];
      if (durationMs >= b.min && durationMs < b.max) {
        buckets[i]++;
        break;
      }
    }
    this.totals.set(connectorId, (this.totals.get(connectorId) ?? 0) + 1);
  }

  /**
   * Get heatmap rows for all connectors.
   */
  getHeatmap(): HeatmapRow[] {
    return Array.from(this.data.entries()).map(([connectorId, bucketCounts]) => {
      const total = this.totals.get(connectorId) ?? 1;
      return {
        connectorId,
        buckets: LATENCY_BUCKETS.map((b, i) => ({
          rangeLabel: b.label,
          count: bucketCounts[i],
          percentage: total > 0 ? (bucketCounts[i] / total) * 100 : 0,
        })),
        total,
      };
    });
  }

  /**
   * Get heatmap for a single connector.
   */
  getConnectorHeatmap(connectorId: string): HeatmapRow {
    const bucketCounts = this.data.get(connectorId) ?? new Array(LATENCY_BUCKETS.length).fill(0);
    const total = this.totals.get(connectorId) ?? 0;
    return {
      connectorId,
      buckets: LATENCY_BUCKETS.map((b, i) => ({
        rangeLabel: b.label,
        count: bucketCounts[i],
        percentage: total > 0 ? (bucketCounts[i] / total) * 100 : 0,
      })),
      total,
    };
  }

  /**
   * Clear all heatmap data.
   */
  clear(): void {
    this.data.clear();
    this.totals.clear();
  }

  /* ------------------------------------------------------------------- */
  /*  Private helpers                                                     */
  /* ------------------------------------------------------------------- */

  private getOrCreateBuckets(connectorId: string): number[] {
    let b = this.data.get(connectorId);
    if (!b) {
      b = new Array(LATENCY_BUCKETS.length).fill(0);
      this.data.set(connectorId, b);
    }
    return b;
  }
}

/* ========================================================================= */
/*  THROUGHPUT TRACKER                                                       */
/* ========================================================================= */

/**
 * Tracks request throughput using 1-second tumbling windows, storing
 * up to 360 seconds of history (6 minutes).
 */
export class ThroughputTracker {
  /** connectorId → ring buffer of per-second counts */
  private readonly history = new Map<string, RingBuffer<ThroughputHistoryEntry>>();
  /** connectorId → current-second accumulator */
  private readonly currentSecond = new Map<string, { ts: number; count: number }>();
  /** connectorId → peak RPS */
  private readonly peakRps = new Map<string, number>();
  /** History size: 360 entries = 6 min at 1-second granularity */
  private readonly historySize = 360;

  /**
   * Record a request.
   */
  recordRequest(connectorId: string): void {
    const now = Math.floor(Date.now() / 1000) * 1000; // floor to second
    const current = this.currentSecond.get(connectorId);

    if (current && current.ts === now) {
      current.count++;
    } else {
      // Flush previous second if it exists
      if (current) {
        this.flushSecond(connectorId, current);
      }
      this.currentSecond.set(connectorId, { ts: now, count: 1 });
    }
  }

  /**
   * Get throughput snapshot for a connector.
   */
  getSnapshot(connectorId: string): ThroughputSnapshot {
    this.flushCurrentIfNeeded(connectorId);
    const hist = this.history.get(connectorId);
    const entries = hist ? hist.toArray() : [];
    const peak = this.peakRps.get(connectorId) ?? 0;

    // Current RPS: last entry's count
    const currentRps = entries.length > 0 ? entries[entries.length - 1].rps : 0;

    // Average RPS over history
    const avgRps =
      entries.length > 0
        ? entries.reduce((sum, e) => sum + e.rps, 0) / entries.length
        : 0;

    return {
      connectorId,
      currentRps,
      peakRps: peak,
      avgRps: Math.round(avgRps * 100) / 100,
    };
  }

  /**
   * Get throughput history for a connector.
   */
  getHistory(connectorId: string, lastN?: number): ThroughputHistoryEntry[] {
    this.flushCurrentIfNeeded(connectorId);
    const hist = this.history.get(connectorId);
    const entries = hist ? hist.toArray() : [];
    if (lastN && lastN < entries.length) {
      return entries.slice(-lastN);
    }
    return entries;
  }

  /**
   * Get all tracked connector IDs.
   */
  getTrackedConnectors(): string[] {
    return Array.from(new Set([
      ...Array.from(this.history.keys()),
      ...Array.from(this.currentSecond.keys()),
    ]));
  }

  /**
   * Clear all throughput data.
   */
  clear(): void {
    this.history.clear();
    this.currentSecond.clear();
    this.peakRps.clear();
  }

  /* ------------------------------------------------------------------- */
  /*  Private helpers                                                     */
  /* ------------------------------------------------------------------- */

  private flushSecond(connectorId: string, sec: { ts: number; count: number }): void {
    let hist = this.history.get(connectorId);
    if (!hist) {
      hist = new RingBuffer<ThroughputHistoryEntry>(this.historySize);
      this.history.set(connectorId, hist);
    }
    const rps = sec.count;
    hist.push({ timestamp: sec.ts, requestCount: sec.count, rps });

    const peak = this.peakRps.get(connectorId) ?? 0;
    if (rps > peak) {
      this.peakRps.set(connectorId, rps);
    }
  }

  private flushCurrentIfNeeded(connectorId: string): void {
    const current = this.currentSecond.get(connectorId);
    if (!current) return;
    const now = Math.floor(Date.now() / 1000) * 1000;
    if (current.ts < now) {
      this.flushSecond(connectorId, current);
      this.currentSecond.delete(connectorId);
    }
  }
}

/* ========================================================================= */
/*  ERROR CLASSIFIER                                                         */
/* ========================================================================= */

/**
 * Classifies errors into 7 categories, maintains an error log, and
 * performs anomaly detection on error rate spikes (3x baseline).
 */
export class ErrorClassifier {
  private readonly errorLog = new RingBuffer<ErrorRecord>(5000);
  private readonly anomalies = new RingBuffer<AnomalyEntry>(200);
  private readonly baselineWindowMs = 300_000; // 5 min baseline
  private readonly detectionWindowMs = 60_000; // 1 min detection
  private readonly spikeMultiplier = 3;

  /**
   * Classify an error and record it.
   */
  classifyAndRecord(
    connectorId: string,
    operationId: string,
    error: unknown,
    statusCode?: number,
  ): ErrorType {
    const errorType = this.classify(error, statusCode);
    const message = this.extractMessage(error);

    this.errorLog.push({
      connectorId,
      operationId,
      timestamp: Date.now(),
      errorType,
      message,
      statusCode,
    });

    this.detectSpike(connectorId);

    return errorType;
  }

  /**
   * Classify an error into an ErrorType.
   */
  classify(error: unknown, statusCode?: number): ErrorType {
    if (statusCode) {
      if (statusCode === 408) return 'timeout';
      if (statusCode === 429) return 'rate_limited';
      if (statusCode === 401 || statusCode === 403) return 'auth';
      if (statusCode === 404) return 'not_found';
      if (statusCode >= 500) return 'server_error';
    }

    if (error && typeof error === 'object') {
      const err = error as Record<string, unknown>;
      const code = err.code as string | undefined;
      if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'timeout';
      if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ENOTFOUND') return 'connection';

      const msg = (err.message ?? '') as string;
      if (/timeout/i.test(msg)) return 'timeout';
      if (/rate.?limit/i.test(msg)) return 'rate_limited';
      if (/connect|socket|network/i.test(msg)) return 'connection';
      if (/auth|unauthorized|forbidden/i.test(msg)) return 'auth';
      if (/not.?found/i.test(msg)) return 'not_found';
    }

    return 'unknown';
  }

  /**
   * Get error breakdown for a connector.
   */
  getBreakdown(connectorId: string, windowMs: number = 300_000): ErrorBreakdownEntry[] {
    const cutoff = Date.now() - windowMs;
    const records = this.errorLog.toArray().filter(
      (r) => r.connectorId === connectorId && r.timestamp > cutoff,
    );

    const groups = new Map<ErrorType, ErrorRecord[]>();
    for (const r of records) {
      const existing = groups.get(r.errorType) ?? [];
      existing.push(r);
      groups.set(r.errorType, existing);
    }

    const total = records.length;
    return Array.from(groups.entries()).map(([errorType, recs]) => ({
      errorType,
      count: recs.length,
      percentage: total > 0 ? (recs.length / total) * 100 : 0,
      lastOccurrence: Math.max(...recs.map((r) => r.timestamp)),
      sampleMessage: recs[recs.length - 1]?.message,
    })).sort((a, b) => b.count - a.count);
  }

  /**
   * Get error trend as time-series.
   */
  getErrorTrend(
    connectorId: string,
    windowMs: number = 300_000,
    bucketMs: number = 60_000,
  ): ErrorTrendEntry[] {
    const now = Date.now();
    const cutoff = now - windowMs;
    const records = this.errorLog.toArray().filter(
      (r) => r.connectorId === connectorId && r.timestamp > cutoff,
    );

    const trend: ErrorTrendEntry[] = [];
    for (let t = cutoff; t < now; t += bucketMs) {
      const bucketEnd = t + bucketMs;
      const inBucket = records.filter((r) => r.timestamp >= t && r.timestamp < bucketEnd);

      const byType = new Map<ErrorType, number>();
      for (const r of inBucket) {
        byType.set(r.errorType, (byType.get(r.errorType) ?? 0) + 1);
      }

      for (const [errorType, count] of Array.from(byType.entries())) {
        trend.push({ timestamp: t, errorType, count });
      }
    }

    return trend;
  }

  /**
   * Get detected anomalies.
   */
  getAnomalies(): AnomalyEntry[] {
    return this.anomalies.toArray();
  }

  /**
   * Get recent errors.
   */
  getRecentErrors(limit: number = 50): ErrorRecord[] {
    const all = this.errorLog.toArray();
    return all.slice(-limit);
  }

  /**
   * Clear all data.
   */
  clear(): void {
    this.errorLog.clear();
    this.anomalies.clear();
  }

  /* ------------------------------------------------------------------- */
  /*  Private helpers                                                     */
  /* ------------------------------------------------------------------- */

  private extractMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') {
      const err = error as Record<string, unknown>;
      if (typeof err.message === 'string') return err.message;
    }
    return String(error);
  }

  private detectSpike(connectorId: string): void {
    const now = Date.now();
    const allRecords = this.errorLog.toArray().filter((r) => r.connectorId === connectorId);

    // Baseline: errors in baseline window (excluding detection window)
    const baselineCutoff = now - this.baselineWindowMs;
    const detectionCutoff = now - this.detectionWindowMs;
    const baselineRecords = allRecords.filter(
      (r) => r.timestamp > baselineCutoff && r.timestamp <= detectionCutoff,
    );
    const detectionRecords = allRecords.filter((r) => r.timestamp > detectionCutoff);

    // Normalize to per-minute rates
    const baselineMinutes = (this.baselineWindowMs - this.detectionWindowMs) / 60_000;
    const detectionMinutes = this.detectionWindowMs / 60_000;

    const baselineRate = baselineMinutes > 0 ? baselineRecords.length / baselineMinutes : 0.5;
    const detectionRate = detectionMinutes > 0 ? detectionRecords.length / detectionMinutes : 0;

    if (detectionRate > baselineRate * this.spikeMultiplier && detectionRecords.length >= 3) {
      // Check for recent duplicate anomaly
      const recentAnomalies = this.anomalies.toArray();
      const alreadyDetected = recentAnomalies.some(
        (a) =>
          a.connectorId === connectorId &&
          a.type === 'error_spike' &&
          now - a.detectedAt < 60_000,
      );

      if (!alreadyDetected) {
        this.anomalies.push({
          connectorId,
          type: 'error_spike',
          severity: detectionRate > baselineRate * 10 ? 'critical' : 'warning',
          message: `Error rate spike: ${detectionRate.toFixed(1)}/min vs baseline ${baselineRate.toFixed(1)}/min`,
          detectedAt: now,
          value: detectionRate,
          baseline: baselineRate,
        });
      }
    }
  }
}

/* ========================================================================= */
/*  DASHBOARD DATA PROVIDER                                                  */
/* ========================================================================= */

/**
 * Unified API that aggregates all sub-components into a single dashboard
 * structure.  Computes a 0-100 health score and generates alerts.
 */
export class DashboardDataProvider {
  private readonly collector: ConnectorMetricsCollector;
  private readonly circuitDashboard: CircuitBreakerDashboard;
  private readonly heatmap: LatencyHeatmap;
  private readonly throughput: ThroughputTracker;
  private readonly errorClassifier: ErrorClassifier;
  private readonly alerts: DashboardAlert[] = [];
  private readonly maxAlerts = 500;
  private alertIdCounter = 0;

  constructor(
    collector: ConnectorMetricsCollector,
    circuitDashboard: CircuitBreakerDashboard,
    heatmap: LatencyHeatmap,
    throughput: ThroughputTracker,
    errorClassifier: ErrorClassifier,
  ) {
    this.collector = collector;
    this.circuitDashboard = circuitDashboard;
    this.heatmap = heatmap;
    this.throughput = throughput;
    this.errorClassifier = errorClassifier;
  }

  /**
   * Record an operation and propagate to all sub-components.
   */
  recordOperation(record: OperationRecord): void {
    this.collector.recordOperation(record);
    this.heatmap.record(record.connectorId, record.durationMs);
    this.throughput.recordRequest(record.connectorId);

    if (!record.success) {
      this.errorClassifier.classifyAndRecord(
        record.connectorId,
        record.operationId,
        record.errorMessage ? { message: record.errorMessage, statusCode: record.statusCode } : undefined,
        record.statusCode,
      );
      this.circuitDashboard.recordFailure(record.connectorId);
    } else {
      this.circuitDashboard.recordSuccess(record.connectorId);
    }

    // Auto-generate alerts
    this.checkAndGenerateAlerts(record);
  }

  /**
   * Get the full dashboard snapshot.
   */
  getFullDashboard(window: MetricsWindow = '1m'): FullDashboard {
    const system = this.collector.getSystemMetrics(window);
    const connectors = this.collector.getAllSnapshots(window);
    const circuits = this.circuitDashboard.getSystemStatus();
    const anomalies = this.errorClassifier.getAnomalies();
    const healthScore = this.computeHealthScore(system, circuits);

    return {
      system,
      connectors,
      circuits,
      alerts: this.getActiveAlerts(),
      anomalies,
      healthScore,
      generatedAt: Date.now(),
    };
  }

  /**
   * Get detailed metrics for a specific connector.
   */
  getConnectorDetail(connectorId: string, window: MetricsWindow = '5m'): ConnectorDetail {
    return {
      metrics: this.collector.getSnapshot(connectorId, window),
      circuit: this.circuitDashboard.getCircuitSnapshot(connectorId),
      operations: this.collector.getOperationMetrics(connectorId),
      latencyPercentiles: this.collector.getLatencyPercentiles(connectorId),
      throughput: this.throughput.getSnapshot(connectorId),
      errors: this.errorClassifier.getBreakdown(connectorId),
      heatmap: this.heatmap.getConnectorHeatmap(connectorId),
    };
  }

  /**
   * Get active (unacknowledged) alerts.
   */
  getActiveAlerts(): DashboardAlert[] {
    return this.alerts.filter((a) => !a.acknowledged);
  }

  /**
   * Acknowledge an alert.
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      return true;
    }
    return false;
  }

  /**
   * Acknowledge all alerts.
   */
  acknowledgeAll(): void {
    for (const a of this.alerts) {
      a.acknowledged = true;
    }
  }

  /**
   * Get all sub-component references for direct access.
   */
  getComponents(): {
    collector: ConnectorMetricsCollector;
    circuitDashboard: CircuitBreakerDashboard;
    heatmap: LatencyHeatmap;
    throughput: ThroughputTracker;
    errorClassifier: ErrorClassifier;
  } {
    return {
      collector: this.collector,
      circuitDashboard: this.circuitDashboard,
      heatmap: this.heatmap,
      throughput: this.throughput,
      errorClassifier: this.errorClassifier,
    };
  }

  /**
   * Clear all data across all sub-components.
   */
  clearAll(): void {
    this.collector.clearAll();
    this.circuitDashboard.clearAll();
    this.heatmap.clear();
    this.throughput.clear();
    this.errorClassifier.clear();
    this.alerts.length = 0;
  }

  /* ------------------------------------------------------------------- */
  /*  Health Score & Alerts                                               */
  /* ------------------------------------------------------------------- */

  /**
   * Compute a 0-100 health score.
   *
   * Formula:
   *   base = successRate * 40
   *   latencyPenalty = clamp(p95 / 5000, 0, 1) * 20
   *   circuitPenalty = (openCircuits / totalCircuits) * 20
   *   errorDiversity = (uniqueErrorTypes / 7) * 10
   *   anomalyPenalty = min(anomalies, 5) * 2
   *   score = base - latencyPenalty - circuitPenalty - errorDiversity - anomalyPenalty
   */
  private computeHealthScore(system: SystemMetricsSnapshot, circuits: SystemCircuitStatus): number {
    const successScore = system.overallSuccessRate * 40;
    const latencyPenalty = Math.min(1, system.p95LatencyMs / 5000) * 20;
    const circuitPenalty =
      circuits.totalCircuits > 0
        ? (circuits.openCount / circuits.totalCircuits) * 20
        : 0;

    const anomalies = this.errorClassifier.getAnomalies();
    const recentAnomalies = anomalies.filter((a) => Date.now() - a.detectedAt < 300_000);
    const anomalyPenalty = Math.min(recentAnomalies.length, 5) * 2;

    const score = Math.max(0, Math.min(100, 100 - (40 - successScore) - latencyPenalty - circuitPenalty - anomalyPenalty));
    return Math.round(score);
  }

  private checkAndGenerateAlerts(record: OperationRecord): void {
    // High error rate alert
    if (!record.success) {
      const snapshot = this.collector.getSnapshot(record.connectorId, '1m');
      if (snapshot.totalOperations >= 5 && snapshot.successRate < 0.5) {
        this.addAlert(
          'error',
          `High error rate on ${record.connectorId}`,
          `Success rate dropped to ${(snapshot.successRate * 100).toFixed(1)}% in the last minute`,
          record.connectorId,
        );
      }
    }

    // High latency alert
    if (record.durationMs > 10_000) {
      this.addAlert(
        'warning',
        `High latency on ${record.connectorId}`,
        `Operation ${record.operationId} took ${record.durationMs}ms`,
        record.connectorId,
      );
    }

    // Circuit breaker open alert
    const circuitSnap = this.circuitDashboard.getCircuitSnapshot(record.connectorId);
    if (circuitSnap.state === 'open') {
      this.addAlert(
        'critical',
        `Circuit breaker OPEN for ${record.connectorId}`,
        `${circuitSnap.failureCount} consecutive failures`,
        record.connectorId,
      );
    }
  }

  private addAlert(
    severity: AlertSeverity,
    title: string,
    message: string,
    connectorId?: string,
  ): void {
    // Dedup: don't add if same title exists in last 60s
    const recent = this.alerts.find(
      (a) => a.title === title && Date.now() - a.timestamp < 60_000,
    );
    if (recent) return;

    this.alertIdCounter++;
    this.alerts.push({
      id: `alert_${this.alertIdCounter}`,
      severity,
      title,
      message,
      connectorId,
      timestamp: Date.now(),
      acknowledged: false,
    });

    if (this.alerts.length > this.maxAlerts) {
      this.alerts.splice(0, this.alerts.length - this.maxAlerts);
    }
  }
}

/* ========================================================================= */
/*  SINGLETON EXPORT                                                         */
/* ========================================================================= */

const _collector = new ConnectorMetricsCollector();
const _circuitDashboard = new CircuitBreakerDashboard();
const _heatmap = new LatencyHeatmap();
const _throughput = new ThroughputTracker();
const _errorClassifier = new ErrorClassifier();

export const metricsDashboard = new DashboardDataProvider(
  _collector,
  _circuitDashboard,
  _heatmap,
  _throughput,
  _errorClassifier,
);
