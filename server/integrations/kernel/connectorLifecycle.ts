/**
 * ConnectorLifecycleManager — Health monitoring and auto-recovery for connectors.
 *
 * Responsibilities:
 *  1. Periodic health checks for all registered connectors
 *  2. Latency tracking with sliding-window percentile computation (P50/P95/P99)
 *  3. Automatic health state transitions with event emission
 *  4. Credential expiry monitoring with proactive refresh
 *  5. Graceful shutdown with pending-operation drain
 *
 * Uses the ConnectorEventBus for all event emission.  Types are imported
 * via `import type` to avoid circular dependency issues at module load time.
 *
 * Zero external dependencies.
 */

import type {
  ConnectorEvent,
  ConnectorEventType,
} from "./connectorEventBus";

// ─── Health Snapshot ───────────────────────────────────────────────

export type ConnectorHealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";
export type CircuitState = "closed" | "open" | "half_open";

export interface ConnectorHealthSnapshot {
  connectorId: string;
  status: ConnectorHealthStatus;
  latencyMs: number;
  lastChecked: number;
  consecutiveFailures: number;
  circuitState: CircuitState;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
}

// ─── Internal tracking structures ──────────────────────────────────

interface ConnectorHealthState {
  connectorId: string;
  status: ConnectorHealthStatus;
  consecutiveFailures: number;
  circuitState: CircuitState;
  lastChecked: number;
  lastLatencyMs: number;
  /** Sliding window of the last N latency samples */
  latencyWindow: number[];
  /** Baseline latency (first successful P50) for degradation detection */
  baselineLatencyMs: number;
  /** Timestamp when the circuit was opened (for recovery time calc) */
  circuitOpenedAt: number;
}

interface TrackedCredential {
  connectorId: string;
  userId: string;
  providerId: string;
  expiresAt: number; // epoch ms
  lastRefreshAttempt: number;
}

type HealthChangeCallback = (
  connectorId: string,
  oldStatus: ConnectorHealthStatus,
  newStatus: ConnectorHealthStatus,
  snapshot: ConnectorHealthSnapshot,
) => void;

// ─── Constants ─────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 60_000;
const LATENCY_WINDOW_SIZE = 20;
const CONSECUTIVE_FAILURE_THRESHOLD = 3;
const P95_DEGRADATION_MULTIPLIER = 2;
const CREDENTIAL_REFRESH_BUFFER_MS = 5 * 60_000; // 5 minutes before expiry
const CREDENTIAL_REFRESH_COOLDOWN_MS = 60_000;    // Don't retry refresh within 60s

// ─── Percentile computation ────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function computePercentiles(window: number[]): { p50: number; p95: number; p99: number } {
  if (window.length === 0) return { p50: 0, p95: 0, p99: 0 };
  const sorted = [...window].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

// ─── ConnectorLifecycleManager ─────────────────────────────────────

export class ConnectorLifecycleManager {
  private readonly _health = new Map<string, ConnectorHealthState>();
  private readonly _credentials: TrackedCredential[] = [];
  private readonly _healthChangeCallbacks: HealthChangeCallback[] = [];
  private _monitorTimer: ReturnType<typeof setInterval> | null = null;
  private _credentialTimer: ReturnType<typeof setInterval> | null = null;
  private _running = false;
  private _shuttingDown = false;
  private _pendingOperations = 0;

  // Lazily-resolved references — avoids circular imports at module load time
  private _eventBus: any = null;
  private _registry: any = null;
  private _vault: any = null;

  private async _getEventBus() {
    if (!this._eventBus) {
      const mod = await import("./connectorEventBus");
      this._eventBus = mod.connectorEventBus;
    }
    return this._eventBus;
  }

  private async _getRegistry() {
    if (!this._registry) {
      const mod = await import("./connectorRegistry");
      this._registry = mod.connectorRegistry;
    }
    return this._registry;
  }

  private async _getVault() {
    if (!this._vault) {
      const mod = await import("./credentialVault");
      this._vault = mod.credentialVault;
    }
    return this._vault;
  }

  // ── Monitoring lifecycle ─────────────────────────────────────────

  /**
   * Start periodic health check loop for all registered connectors.
   * Also starts credential expiry monitoring at half the health interval.
   */
  startMonitoring(intervalMs: number = DEFAULT_INTERVAL_MS): void {
    if (this._running) {
      console.warn("[ConnectorLifecycle] Monitoring already running, ignoring duplicate start");
      return;
    }
    this._running = true;
    this._shuttingDown = false;

    console.log(
      `[ConnectorLifecycle] Starting health monitoring (interval: ${intervalMs}ms)`,
    );

    // Run first check immediately
    this._runHealthCheckCycle().catch((err) => {
      console.error("[ConnectorLifecycle] Initial health check cycle failed:", err);
    });

    // Schedule recurring health checks
    this._monitorTimer = setInterval(() => {
      if (this._shuttingDown) return;
      this._runHealthCheckCycle().catch((err) => {
        console.error("[ConnectorLifecycle] Health check cycle failed:", err);
      });
    }, intervalMs);

    // Credential check runs at half the interval (more responsive to expiry)
    this._credentialTimer = setInterval(() => {
      if (this._shuttingDown) return;
      this._runCredentialCheckCycle().catch((err) => {
        console.error("[ConnectorLifecycle] Credential check cycle failed:", err);
      });
    }, Math.max(intervalMs / 2, 10_000));
  }

  /**
   * Stop monitoring gracefully.  In-flight checks complete but no new
   * cycles are started.
   */
  stopMonitoring(): void {
    this._running = false;
    if (this._monitorTimer !== null) {
      clearInterval(this._monitorTimer);
      this._monitorTimer = null;
    }
    if (this._credentialTimer !== null) {
      clearInterval(this._credentialTimer);
      this._credentialTimer = null;
    }
    console.log("[ConnectorLifecycle] Monitoring stopped");
  }

  // ── Health queries ───────────────────────────────────────────────

  /**
   * Get a point-in-time health snapshot for a single connector.
   */
  getConnectorHealth(connectorId: string): ConnectorHealthSnapshot {
    const state = this._health.get(connectorId);
    if (!state) {
      return {
        connectorId,
        status: "unknown",
        latencyMs: 0,
        lastChecked: 0,
        consecutiveFailures: 0,
        circuitState: "closed",
        latencyP50: 0,
        latencyP95: 0,
        latencyP99: 0,
      };
    }
    return this._stateToSnapshot(state);
  }

  /**
   * Get health snapshots for all tracked connectors.
   */
  getAllHealth(): Map<string, ConnectorHealthSnapshot> {
    const result = new Map<string, ConnectorHealthSnapshot>();
    for (const [id, state] of this._health) {
      result.set(id, this._stateToSnapshot(state));
    }
    return result;
  }

  /**
   * Trigger an immediate health check for a specific connector
   * (outside the regular interval).
   */
  async forceHealthCheck(connectorId: string): Promise<ConnectorHealthSnapshot> {
    await this._checkConnectorHealth(connectorId);
    return this.getConnectorHealth(connectorId);
  }

  /**
   * Subscribe to health state transitions.
   */
  onHealthChange(callback: HealthChangeCallback): void {
    this._healthChangeCallbacks.push(callback);
  }

  /**
   * Remove a health change callback.
   */
  offHealthChange(callback: HealthChangeCallback): void {
    const idx = this._healthChangeCallbacks.indexOf(callback);
    if (idx !== -1) this._healthChangeCallbacks.splice(idx, 1);
  }

  // ── Credential tracking ──────────────────────────────────────────

  /**
   * Register a user credential pair for expiry monitoring.
   * Call this after a successful OAuth connection.
   */
  trackCredential(
    connectorId: string,
    userId: string,
    providerId: string,
    expiresAt: Date | number,
  ): void {
    const expiresMs = typeof expiresAt === "number" ? expiresAt : expiresAt.getTime();

    // Update existing or add new
    const existing = this._credentials.find(
      (c) => c.connectorId === connectorId && c.userId === userId,
    );
    if (existing) {
      existing.expiresAt = expiresMs;
      existing.providerId = providerId;
      existing.lastRefreshAttempt = 0;
    } else {
      this._credentials.push({
        connectorId,
        userId,
        providerId,
        expiresAt: expiresMs,
        lastRefreshAttempt: 0,
      });
    }
  }

  /**
   * Remove a tracked credential (after disconnect/revoke).
   */
  untrackCredential(connectorId: string, userId: string): void {
    const idx = this._credentials.findIndex(
      (c) => c.connectorId === connectorId && c.userId === userId,
    );
    if (idx !== -1) this._credentials.splice(idx, 1);
  }

  // ── Pending operation tracking ───────────────────────────────────

  /**
   * Increment the pending operation counter (call before starting work).
   */
  operationStarted(): void {
    this._pendingOperations++;
  }

  /**
   * Decrement the pending operation counter (call after work completes).
   */
  operationCompleted(): void {
    this._pendingOperations = Math.max(0, this._pendingOperations - 1);
  }

  /**
   * Current number of in-flight operations.
   */
  get pendingOperations(): number {
    return this._pendingOperations;
  }

  // ── Graceful Shutdown ────────────────────────────────────────────

  /**
   * Full graceful shutdown:
   *  1. Stop monitoring timers
   *  2. Wait for pending operations to drain (up to drainTimeoutMs)
   *  3. Clear all state
   */
  async shutdown(drainTimeoutMs: number = 10_000): Promise<void> {
    console.log("[ConnectorLifecycle] Shutting down...");
    this._shuttingDown = true;
    this.stopMonitoring();

    // Wait for pending operations to drain
    if (this._pendingOperations > 0) {
      console.log(
        `[ConnectorLifecycle] Draining ${this._pendingOperations} pending operation(s)...`,
      );

      const drainStart = Date.now();
      while (this._pendingOperations > 0 && Date.now() - drainStart < drainTimeoutMs) {
        await new Promise((r) => setTimeout(r, 100));
      }

      if (this._pendingOperations > 0) {
        console.warn(
          `[ConnectorLifecycle] Drain timeout: ${this._pendingOperations} operations still pending after ${drainTimeoutMs}ms`,
        );
      }
    }

    // Clear all tracked state
    this._health.clear();
    this._credentials.length = 0;
    this._healthChangeCallbacks.length = 0;
    this._pendingOperations = 0;

    console.log("[ConnectorLifecycle] Shutdown complete");
  }

  // ── Private: Health check cycle ──────────────────────────────────

  private async _runHealthCheckCycle(): Promise<void> {
    let registry: any;
    try {
      registry = await this._getRegistry();
    } catch {
      return; // Registry not available yet
    }

    const connectorIds: string[] = registry.listIds();
    if (connectorIds.length === 0) return;

    // Check all connectors in parallel (bounded to avoid thundering herd)
    const BATCH_SIZE = 10;
    for (let i = 0; i < connectorIds.length; i += BATCH_SIZE) {
      const batch = connectorIds.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map((id) => this._checkConnectorHealth(id)),
      );
    }
  }

  private async _checkConnectorHealth(connectorId: string): Promise<void> {
    let registry: any;
    try {
      registry = await this._getRegistry();
    } catch {
      return;
    }

    const handler = registry.getHandler(connectorId);
    const manifest = registry.get(connectorId);

    // Initialize state if first check
    let state = this._health.get(connectorId);
    if (!state) {
      state = {
        connectorId,
        status: "unknown",
        consecutiveFailures: 0,
        circuitState: "closed",
        lastChecked: 0,
        lastLatencyMs: 0,
        latencyWindow: [],
        baselineLatencyMs: 0,
        circuitOpenedAt: 0,
      };
      this._health.set(connectorId, state);
    }

    const previousStatus = state.status;

    // If no handler or no healthCheck method, mark as unknown and skip
    if (!handler || typeof handler.healthCheck !== "function") {
      state.lastChecked = Date.now();
      // Don't transition status — leave as whatever it was
      return;
    }

    try {
      const checkStart = Date.now();
      const result = await Promise.race([
        handler.healthCheck(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Health check timeout")),
            manifest?.sla?.maxLatencyMs ?? 10_000,
          ),
        ),
      ]) as { healthy: boolean; latencyMs: number };

      const latencyMs = result.latencyMs ?? (Date.now() - checkStart);
      state.lastChecked = Date.now();
      state.lastLatencyMs = latencyMs;

      // Push to sliding window
      state.latencyWindow.push(latencyMs);
      if (state.latencyWindow.length > LATENCY_WINDOW_SIZE) {
        state.latencyWindow.shift();
      }

      if (result.healthy) {
        state.consecutiveFailures = 0;

        // Set baseline from first stable P50
        if (state.baselineLatencyMs === 0 && state.latencyWindow.length >= 5) {
          const { p50 } = computePercentiles(state.latencyWindow);
          state.baselineLatencyMs = p50;
        }

        // Check for latency-based degradation
        const { p95 } = computePercentiles(state.latencyWindow);
        const threshold = state.baselineLatencyMs > 0
          ? state.baselineLatencyMs * P95_DEGRADATION_MULTIPLIER
          : (manifest?.sla?.expectedLatencyMs ?? 5000) * P95_DEGRADATION_MULTIPLIER;

        if (state.baselineLatencyMs > 0 && p95 > threshold) {
          this._transitionStatus(state, "degraded");
          this._emitEvent({
            type: "connector.health.degraded",
            connectorId,
            latencyMs,
            threshold,
            timestamp: Date.now(),
          });
        } else {
          // Healthy — check if recovering from degraded/unhealthy
          if (state.status === "degraded" || state.status === "unhealthy") {
            this._emitEvent({
              type: "connector.health.recovered",
              connectorId,
              latencyMs,
              timestamp: Date.now(),
            });
          }
          this._transitionStatus(state, "healthy");
        }

        // Circuit recovery
        if (state.circuitState === "open" || state.circuitState === "half_open") {
          const recoveryTimeMs = state.circuitOpenedAt > 0
            ? Date.now() - state.circuitOpenedAt
            : 0;
          state.circuitState = "closed";
          this._emitEvent({
            type: "connector.circuit.closed",
            connectorId,
            recoveryTimeMs,
            timestamp: Date.now(),
          });
        }
      } else {
        // Health check returned unhealthy
        this._recordFailure(state, connectorId, "Health check returned unhealthy");
      }
    } catch (err: unknown) {
      state.lastChecked = Date.now();
      const message = err instanceof Error ? err.message : String(err);
      this._recordFailure(state, connectorId, message);
    }

    // Notify callbacks if status changed
    if (previousStatus !== state.status) {
      const snapshot = this._stateToSnapshot(state);
      for (const cb of this._healthChangeCallbacks) {
        try {
          cb(connectorId, previousStatus, state.status, snapshot);
        } catch (cbErr: unknown) {
          console.error(
            "[ConnectorLifecycle] Health change callback error:",
            cbErr instanceof Error ? cbErr.message : cbErr,
          );
        }
      }
    }
  }

  private _recordFailure(state: ConnectorHealthState, connectorId: string, errorMsg: string): void {
    state.consecutiveFailures++;

    if (state.consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
      // Transition to degraded first, then unhealthy at 2x threshold
      if (state.consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD * 2) {
        this._transitionStatus(state, "unhealthy");

        // Open circuit breaker
        if (state.circuitState !== "open") {
          state.circuitState = "open";
          state.circuitOpenedAt = Date.now();
          this._emitEvent({
            type: "connector.circuit.opened",
            connectorId,
            failureCount: state.consecutiveFailures,
            lastError: errorMsg,
            timestamp: Date.now(),
          });
        }
      } else {
        if (state.status !== "degraded") {
          this._transitionStatus(state, "degraded");
          this._emitEvent({
            type: "connector.health.degraded",
            connectorId,
            latencyMs: state.lastLatencyMs,
            threshold: CONSECUTIVE_FAILURE_THRESHOLD,
            timestamp: Date.now(),
          });
        }
      }
    }
  }

  // ── Private: Credential check cycle ──────────────────────────────

  private async _runCredentialCheckCycle(): Promise<void> {
    const now = Date.now();
    let vault: any;
    try {
      vault = await this._getVault();
    } catch {
      return; // Vault not available yet
    }

    for (const cred of this._credentials) {
      // Skip if not near expiry
      if (cred.expiresAt - now > CREDENTIAL_REFRESH_BUFFER_MS) continue;

      // Skip if already expired (handled separately)
      if (cred.expiresAt <= now) {
        this._emitEvent({
          type: "connector.credential.expired",
          connectorId: cred.connectorId,
          userId: cred.userId,
          timestamp: now,
        });
        continue;
      }

      // Skip if recently attempted refresh (cooldown)
      if (now - cred.lastRefreshAttempt < CREDENTIAL_REFRESH_COOLDOWN_MS) continue;

      cred.lastRefreshAttempt = now;

      // Attempt refresh via vault
      try {
        const resolved = await vault.resolve(cred.userId, cred.providerId);
        if (resolved && resolved.expiresAt) {
          const newExpiresAt =
            resolved.expiresAt instanceof Date
              ? resolved.expiresAt
              : new Date(resolved.expiresAt);

          // Vault.resolve() auto-refreshes if near expiry — check if token was actually refreshed
          if (newExpiresAt.getTime() > cred.expiresAt) {
            cred.expiresAt = newExpiresAt.getTime();
            this._emitEvent({
              type: "connector.credential.refreshed",
              connectorId: cred.connectorId,
              userId: cred.userId,
              newExpiresAt,
              timestamp: now,
            });
          } else {
            // Refresh didn't extend the token — treat as failed
            this._emitEvent({
              type: "connector.credential.expired",
              connectorId: cred.connectorId,
              userId: cred.userId,
              timestamp: now,
            });
          }
        } else {
          // No credential found — expired or revoked
          this._emitEvent({
            type: "connector.credential.expired",
            connectorId: cred.connectorId,
            userId: cred.userId,
            timestamp: now,
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[ConnectorLifecycle] Credential refresh failed for ${cred.connectorId}/${cred.userId}: ${message}`,
        );
        this._emitEvent({
          type: "connector.credential.expired",
          connectorId: cred.connectorId,
          userId: cred.userId,
          timestamp: now,
        });
      }
    }
  }

  // ── Private: Helpers ─────────────────────────────────────────────

  private _transitionStatus(state: ConnectorHealthState, newStatus: ConnectorHealthStatus): void {
    state.status = newStatus;
  }

  private _stateToSnapshot(state: ConnectorHealthState): ConnectorHealthSnapshot {
    const { p50, p95, p99 } = computePercentiles(state.latencyWindow);
    return {
      connectorId: state.connectorId,
      status: state.status,
      latencyMs: state.lastLatencyMs,
      lastChecked: state.lastChecked,
      consecutiveFailures: state.consecutiveFailures,
      circuitState: state.circuitState,
      latencyP50: p50,
      latencyP95: p95,
      latencyP99: p99,
    };
  }

  /**
   * Emit a connector event through the event bus.
   * Fire-and-forget — errors logged but never propagated.
   */
  private _emitEvent(event: ConnectorEvent): void {
    // Use void + async to avoid blocking the caller
    void (async () => {
      try {
        const bus = await this._getEventBus();
        bus.emit(event);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[ConnectorLifecycle] Failed to emit event "${event.type}": ${message}`,
        );
      }
    })();
  }
}

// ─── Singleton ─────────────────────────────────────────────────────

export const connectorLifecycle = new ConnectorLifecycleManager();
