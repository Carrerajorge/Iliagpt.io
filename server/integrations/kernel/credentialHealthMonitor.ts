/**
 * CredentialHealthMonitor -- Per-credential health tracking with
 * sliding-window stats and anomaly detection.
 *
 * Records every operation against a credential and computes rolling
 * success rate, latency percentiles, and anomaly flags.  All data is
 * held in-process memory (no external deps) with a 1-hour TTL and a
 * 100-operation sliding window per credential.
 */

// ─── Types ─────────────────────────────────────────────────────────

export interface AnomalyReport {
  type:
    | "error_rate_spike"
    | "latency_anomaly"
    | "usage_rate_spike"
    | "unauthorized_scope"
    | "geographic_anomaly";
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  detectedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface CredentialHealthReport {
  status: "healthy" | "degraded" | "suspicious" | "expired";
  totalOperations: number;
  successRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  lastUsed: Date;
  lastError?: { code: string; message: string; at: Date };
  anomalies: AnomalyReport[];
}

// ─── Internal data structures ──────────────────────────────────────

interface OperationRecord {
  ts: number;
  success: boolean;
  latencyMs: number;
  operationId: string;
  errorCode?: string;
  errorMessage?: string;
}

interface CredentialEntry {
  connectorId: string;
  userId: string;
  /** Sliding window -- max 100, newest at end */
  operations: OperationRecord[];
  /** Running counters for the lifetime of the entry */
  totalOps: number;
  totalSuccesses: number;
  totalLatencyMs: number;
  /** Baseline average request rate (ops / minute) computed from first 20 ops */
  baselineRatePerMin: number | null;
  /** The granted scopes for scope-check anomaly detection */
  grantedScopes: Set<string> | null;
  /** Last error details */
  lastError: { code: string; message: string; at: Date } | null;
  /** Last used timestamp */
  lastUsed: number;
  /** Token expiry (if known), updated externally */
  expiresAt: number | null;
}

// ─── Constants ─────────────────────────────────────────────────────

const MAX_WINDOW = 100;
const ENTRY_TTL_MS = 60 * 60_000; // 1 hour
const CLEANUP_INTERVAL_MS = 5 * 60_000; // 5 minutes
const BASELINE_SAMPLE_SIZE = 20;

// Thresholds
const DEGRADED_SUCCESS_RATE = 0.80;
const DEGRADED_P95_MS = 5_000;
const ERROR_SPIKE_THRESHOLD = 0.50;
const ERROR_SPIKE_RECENT_WINDOW = 10;
const ERROR_SPIKE_BASELINE_MAX = 0.10;
const LATENCY_ANOMALY_MULTIPLIER = 3;
const USAGE_RATE_SPIKE_MULTIPLIER = 10;

// ─── Structured log helper ─────────────────────────────────────────

function structuredLog(
  level: "info" | "warn" | "error",
  event: string,
  data: Record<string, unknown>,
): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component: "CredentialHealthMonitor",
    event,
    ...data,
  };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else if (level === "warn") {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// ─── Percentile helper ─────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

// ─── CredentialHealthMonitor ───────────────────────────────────────

export class CredentialHealthMonitor {
  /** Key: `${connectorId}::${userId}` */
  private entries = new Map<string, CredentialEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Background cleanup of expired entries
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer && typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
      (this.cleanupTimer as NodeJS.Timeout).unref();
    }
  }

  /** Graceful shutdown -- stop the cleanup timer. */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // ─── Record usage ────────────────────────────────────────────────

  /**
   * Record a single operation against a credential.
   * @param connectorId  The connector (provider) identifier
   * @param userId       The owning user
   * @param operationId  The specific operation invoked (e.g. "gmail_send_email")
   * @param success      Whether the operation succeeded
   * @param latencyMs    Wall-clock latency for the operation
   * @param errorCode    Optional error code on failure
   * @param errorMessage Optional error message on failure
   */
  recordUsage(
    connectorId: string,
    userId: string,
    operationId: string,
    success: boolean,
    latencyMs: number,
    errorCode?: string,
    errorMessage?: string,
  ): void {
    const key = `${connectorId}::${userId}`;
    const now = Date.now();

    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        connectorId,
        userId,
        operations: [],
        totalOps: 0,
        totalSuccesses: 0,
        totalLatencyMs: 0,
        baselineRatePerMin: null,
        grantedScopes: null,
        lastError: null,
        lastUsed: now,
        expiresAt: null,
      };
      this.entries.set(key, entry);
    }

    const record: OperationRecord = {
      ts: now,
      success,
      latencyMs,
      operationId,
      ...(errorCode ? { errorCode } : {}),
      ...(errorMessage ? { errorMessage } : {}),
    };

    // Append to sliding window
    entry.operations.push(record);
    if (entry.operations.length > MAX_WINDOW) {
      entry.operations.shift();
    }

    // Update counters
    entry.totalOps++;
    if (success) entry.totalSuccesses++;
    entry.totalLatencyMs += latencyMs;
    entry.lastUsed = now;

    if (!success && errorCode) {
      entry.lastError = {
        code: errorCode,
        message: errorMessage || "Unknown error",
        at: new Date(now),
      };
    }

    // Compute baseline rate after enough samples
    if (entry.baselineRatePerMin === null && entry.operations.length >= BASELINE_SAMPLE_SIZE) {
      const firstTs = entry.operations[0].ts;
      const lastTs = entry.operations[entry.operations.length - 1].ts;
      const spanMin = (lastTs - firstTs) / 60_000;
      if (spanMin > 0) {
        entry.baselineRatePerMin = entry.operations.length / spanMin;
      }
    }

    // Run anomaly detection inline (lightweight)
    const anomalies = this.detectAnomalies(entry);
    if (anomalies.length > 0) {
      for (const a of anomalies) {
        structuredLog(
          a.severity === "critical" || a.severity === "high" ? "error" : "warn",
          "anomaly_detected",
          {
            connectorId,
            userId,
            anomalyType: a.type,
            severity: a.severity,
            message: a.message,
            ...(a.metadata || {}),
          },
        );
      }
    }
  }

  // ─── External metadata setters ───────────────────────────────────

  /** Set the granted scopes for a credential (used for scope-check anomaly). */
  setGrantedScopes(connectorId: string, userId: string, scopes: string[]): void {
    const entry = this.getOrCreateEntry(connectorId, userId);
    entry.grantedScopes = new Set(scopes);
  }

  /** Set the token expiry (used for expired status). */
  setTokenExpiry(connectorId: string, userId: string, expiresAt: Date | null): void {
    const entry = this.getOrCreateEntry(connectorId, userId);
    entry.expiresAt = expiresAt ? expiresAt.getTime() : null;
  }

  /**
   * Record an unauthorized scope attempt.
   * Call this when a connector operation is rejected because the token
   * does not cover the required scopes.
   */
  recordUnauthorizedScope(
    connectorId: string,
    userId: string,
    attemptedScope: string,
    operationId: string,
  ): void {
    const key = `${connectorId}::${userId}`;
    const entry = this.entries.get(key);
    if (!entry) return;

    structuredLog("error", "unauthorized_scope_attempt", {
      connectorId,
      userId,
      attemptedScope,
      operationId,
    });
  }

  // ─── Health report ───────────────────────────────────────────────

  getCredentialHealth(connectorId: string, userId: string): CredentialHealthReport {
    const key = `${connectorId}::${userId}`;
    const entry = this.entries.get(key);

    if (!entry || entry.operations.length === 0) {
      return {
        status: "healthy",
        totalOperations: 0,
        successRate: 1,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        lastUsed: new Date(0),
        anomalies: [],
      };
    }

    // Expire old records from the window
    this.expireOldRecords(entry);

    const ops = entry.operations;
    const successes = ops.filter((o) => o.success).length;
    const successRate = ops.length > 0 ? successes / ops.length : 1;
    const latencies = ops.map((o) => o.latencyMs);
    const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    const sortedLatencies = [...latencies].sort((a, b) => a - b);
    const p95 = percentile(sortedLatencies, 95);

    const anomalies = this.detectAnomalies(entry);
    const status = this.deriveStatus(entry, successRate, p95, anomalies);

    return {
      status,
      totalOperations: entry.totalOps,
      successRate: Math.round(successRate * 10000) / 10000,
      avgLatencyMs: Math.round(avgLatency),
      p95LatencyMs: Math.round(p95),
      lastUsed: new Date(entry.lastUsed),
      lastError: entry.lastError
        ? { code: entry.lastError.code, message: entry.lastError.message, at: entry.lastError.at }
        : undefined,
      anomalies,
    };
  }

  // ─── Anomaly detection ───────────────────────────────────────────

  private detectAnomalies(entry: CredentialEntry): AnomalyReport[] {
    const anomalies: AnomalyReport[] = [];
    const ops = entry.operations;
    const now = Date.now();

    if (ops.length < 5) return anomalies; // Not enough data

    // 1. Error rate spike
    //    If baseline error rate < 10% but last N requests show >50% failure
    const recentOps = ops.slice(-ERROR_SPIKE_RECENT_WINDOW);
    const recentFailRate = recentOps.filter((o) => !o.success).length / recentOps.length;
    const olderOps = ops.slice(0, Math.max(0, ops.length - ERROR_SPIKE_RECENT_WINDOW));

    if (olderOps.length >= 5) {
      const baselineFailRate = olderOps.filter((o) => !o.success).length / olderOps.length;
      if (baselineFailRate <= ERROR_SPIKE_BASELINE_MAX && recentFailRate >= ERROR_SPIKE_THRESHOLD) {
        anomalies.push({
          type: "error_rate_spike",
          severity: recentFailRate >= 0.8 ? "critical" : "high",
          message: `Error rate spiked from ${(baselineFailRate * 100).toFixed(1)}% to ${(recentFailRate * 100).toFixed(1)}% in last ${recentOps.length} requests`,
          detectedAt: new Date(now),
          metadata: {
            baselineFailRate: Math.round(baselineFailRate * 1000) / 1000,
            recentFailRate: Math.round(recentFailRate * 1000) / 1000,
            recentWindow: recentOps.length,
          },
        });
      }
    }

    // 2. Latency anomaly
    //    P95 of recent window > 3x rolling average
    if (ops.length >= 10) {
      const allLatencies = ops.map((o) => o.latencyMs);
      const rollingAvg = allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length;
      const recentLatencies = recentOps.map((o) => o.latencyMs);
      const sortedRecent = [...recentLatencies].sort((a, b) => a - b);
      const recentP95 = percentile(sortedRecent, 95);

      if (rollingAvg > 0 && recentP95 > rollingAvg * LATENCY_ANOMALY_MULTIPLIER) {
        anomalies.push({
          type: "latency_anomaly",
          severity: recentP95 > rollingAvg * 5 ? "high" : "medium",
          message: `P95 latency (${Math.round(recentP95)}ms) is ${(recentP95 / rollingAvg).toFixed(1)}x the rolling average (${Math.round(rollingAvg)}ms)`,
          detectedAt: new Date(now),
          metadata: {
            recentP95Ms: Math.round(recentP95),
            rollingAvgMs: Math.round(rollingAvg),
            multiplier: Math.round((recentP95 / rollingAvg) * 10) / 10,
          },
        });
      }
    }

    // 3. Usage rate spike
    //    Current request rate > 10x baseline
    if (entry.baselineRatePerMin !== null && ops.length >= 10) {
      // Compute rate over last 2 minutes
      const twoMinAgo = now - 2 * 60_000;
      const recentTimedOps = ops.filter((o) => o.ts >= twoMinAgo);
      const spanMin = (now - twoMinAgo) / 60_000;
      const currentRate = spanMin > 0 ? recentTimedOps.length / spanMin : 0;

      if (
        entry.baselineRatePerMin > 0 &&
        currentRate > entry.baselineRatePerMin * USAGE_RATE_SPIKE_MULTIPLIER
      ) {
        anomalies.push({
          type: "usage_rate_spike",
          severity: "critical",
          message: `Request rate (${currentRate.toFixed(1)}/min) is ${(currentRate / entry.baselineRatePerMin).toFixed(1)}x baseline (${entry.baselineRatePerMin.toFixed(1)}/min). Possible credential leak.`,
          detectedAt: new Date(now),
          metadata: {
            currentRatePerMin: Math.round(currentRate * 10) / 10,
            baselineRatePerMin: Math.round(entry.baselineRatePerMin * 10) / 10,
            multiplier: Math.round((currentRate / entry.baselineRatePerMin) * 10) / 10,
          },
        });
      }
    }

    return anomalies;
  }

  // ─── Status derivation ───────────────────────────────────────────

  private deriveStatus(
    entry: CredentialEntry,
    successRate: number,
    p95: number,
    anomalies: AnomalyReport[],
  ): "healthy" | "degraded" | "suspicious" | "expired" {
    // Expired takes precedence
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      return "expired";
    }

    // Suspicious: usage spike or unauthorized scope
    const hasSuspiciousAnomaly = anomalies.some(
      (a) => a.type === "usage_rate_spike" || a.type === "unauthorized_scope",
    );
    if (hasSuspiciousAnomaly) {
      return "suspicious";
    }

    // Degraded: low success rate or high latency
    if (successRate < DEGRADED_SUCCESS_RATE || p95 > DEGRADED_P95_MS) {
      return "degraded";
    }

    return "healthy";
  }

  // ─── Entry management ────────────────────────────────────────────

  private getOrCreateEntry(connectorId: string, userId: string): CredentialEntry {
    const key = `${connectorId}::${userId}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        connectorId,
        userId,
        operations: [],
        totalOps: 0,
        totalSuccesses: 0,
        totalLatencyMs: 0,
        baselineRatePerMin: null,
        grantedScopes: null,
        lastError: null,
        lastUsed: Date.now(),
        expiresAt: null,
      };
      this.entries.set(key, entry);
    }
    return entry;
  }

  /** Remove operation records older than 1 hour from the sliding window. */
  private expireOldRecords(entry: CredentialEntry): void {
    const cutoff = Date.now() - ENTRY_TTL_MS;
    while (entry.operations.length > 0 && entry.operations[0].ts < cutoff) {
      entry.operations.shift();
    }
  }

  /** Remove entire entries that have had no activity for 1 hour. */
  private cleanup(): void {
    const cutoff = Date.now() - ENTRY_TTL_MS;
    for (const [key, entry] of this.entries.entries()) {
      if (entry.lastUsed < cutoff) {
        this.entries.delete(key);
      }
    }
  }
}

// ─── Singleton ─────────────────────────────────────────────────────

export const credentialHealthMonitor = new CredentialHealthMonitor();
