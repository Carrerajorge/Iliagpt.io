/**
 * PROVIDER HEALTH MONITOR
 *
 * Advanced health monitoring with circuit breakers, intelligent routing,
 * and automatic failover for all LLM providers.
 *
 * Features:
 * - Per-provider circuit breakers with configurable thresholds
 * - Rolling window health metrics (1min, 5min, 15min, 1hr)
 * - Automatic failover with weighted routing
 * - Latency-based routing optimization
 * - Provider availability scoring
 * - Degradation detection and alerting
 * - Self-healing: automatic recovery testing
 */

import { EventEmitter } from "events";
import { providerRegistry } from "../../lib/providers/ProviderRegistry";
import type { ProviderHealthStatus } from "../../lib/providers/BaseProvider";

// ============================================================================
// Types
// ============================================================================

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number; // Successes needed to close from half-open
  resetTimeoutMs: number;
  halfOpenMaxRequests: number;
  rollingWindowMs: number;
  errorRateThreshold: number; // 0-1
}

export interface ProviderCircuitBreaker {
  provider: string;
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure?: number;
  lastSuccess?: number;
  lastStateChange: number;
  halfOpenRequests: number;
  config: CircuitBreakerConfig;
}

export interface HealthMetric {
  timestamp: number;
  provider: string;
  latencyMs: number;
  success: boolean;
  statusCode?: number;
  errorType?: string;
  model?: string;
  tokensProcessed?: number;
}

export interface HealthWindow {
  period: string;
  windowMs: number;
  metrics: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    errorRate: number;
    tokensProcessed: number;
    availability: number;
  };
}

export interface ProviderScore {
  provider: string;
  overallScore: number; // 0-100
  latencyScore: number;
  reliabilityScore: number;
  costScore: number;
  availabilityScore: number;
  trend: "improving" | "stable" | "degrading";
}

// ============================================================================
// Health Monitor
// ============================================================================

export class ProviderHealthMonitor extends EventEmitter {
  private circuitBreakers: Map<string, ProviderCircuitBreaker> = new Map();
  private metrics: HealthMetric[] = [];
  private readonly MAX_METRICS = 50000;
  private readonly DEFAULT_CB_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 5,
    successThreshold: 3,
    resetTimeoutMs: 30000,
    halfOpenMaxRequests: 3,
    rollingWindowMs: 60000,
    errorRateThreshold: 0.5,
  };
  private monitorInterval: ReturnType<typeof setInterval> | null = null;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    super();
    this.setMaxListeners(50);
    this.cleanupInterval = setInterval(() => this.cleanupOldMetrics(), 300000);
  }

  // ===== Circuit Breaker =====

  getOrCreateBreaker(provider: string, config?: Partial<CircuitBreakerConfig>): ProviderCircuitBreaker {
    if (!this.circuitBreakers.has(provider)) {
      this.circuitBreakers.set(provider, {
        provider,
        state: "closed",
        failures: 0,
        successes: 0,
        lastStateChange: Date.now(),
        halfOpenRequests: 0,
        config: { ...this.DEFAULT_CB_CONFIG, ...config },
      });
    }
    return this.circuitBreakers.get(provider)!;
  }

  canRequest(provider: string): boolean {
    const cb = this.getOrCreateBreaker(provider);

    switch (cb.state) {
      case "closed":
        return true;
      case "open": {
        if (Date.now() - cb.lastStateChange >= cb.config.resetTimeoutMs) {
          this.transitionState(cb, "half-open");
          return true;
        }
        return false;
      }
      case "half-open":
        return cb.halfOpenRequests < cb.config.halfOpenMaxRequests;
    }
  }

  recordSuccess(provider: string, latencyMs: number, model?: string, tokens?: number): void {
    const cb = this.getOrCreateBreaker(provider);
    cb.lastSuccess = Date.now();

    this.metrics.push({
      timestamp: Date.now(),
      provider,
      latencyMs,
      success: true,
      model,
      tokensProcessed: tokens,
    });

    switch (cb.state) {
      case "half-open":
        cb.successes++;
        if (cb.successes >= cb.config.successThreshold) {
          this.transitionState(cb, "closed");
        }
        break;
      case "closed":
        cb.failures = Math.max(0, cb.failures - 1); // Decay failures on success
        break;
    }

    this.emit("requestSuccess", { provider, latencyMs, model });
  }

  recordFailure(provider: string, latencyMs: number, errorType?: string, statusCode?: number, model?: string): void {
    const cb = this.getOrCreateBreaker(provider);
    cb.failures++;
    cb.lastFailure = Date.now();

    this.metrics.push({
      timestamp: Date.now(),
      provider,
      latencyMs,
      success: false,
      statusCode,
      errorType,
      model,
    });

    switch (cb.state) {
      case "closed": {
        // Check rolling window error rate
        const windowMetrics = this.getWindowMetrics(provider, cb.config.rollingWindowMs);
        if (cb.failures >= cb.config.failureThreshold || windowMetrics.errorRate >= cb.config.errorRateThreshold) {
          this.transitionState(cb, "open");
        }
        break;
      }
      case "half-open":
        this.transitionState(cb, "open");
        break;
    }

    this.emit("requestFailure", { provider, latencyMs, errorType, statusCode, model });
  }

  private transitionState(cb: ProviderCircuitBreaker, newState: CircuitState): void {
    const oldState = cb.state;
    cb.state = newState;
    cb.lastStateChange = Date.now();

    if (newState === "closed") {
      cb.failures = 0;
      cb.successes = 0;
      cb.halfOpenRequests = 0;
    } else if (newState === "half-open") {
      cb.successes = 0;
      cb.halfOpenRequests = 0;
    }

    console.log(`[HealthMonitor] Circuit breaker ${cb.provider}: ${oldState} -> ${newState}`);
    this.emit("circuitStateChange", { provider: cb.provider, from: oldState, to: newState });
  }

  // ===== Health Windows =====

  private getWindowMetrics(provider: string, windowMs: number): HealthWindow["metrics"] {
    const cutoff = Date.now() - windowMs;
    const windowMetrics = this.metrics.filter((m) => m.provider === provider && m.timestamp >= cutoff);

    if (windowMetrics.length === 0) {
      return {
        totalRequests: 0, successfulRequests: 0, failedRequests: 0,
        averageLatencyMs: 0, p50LatencyMs: 0, p95LatencyMs: 0, p99LatencyMs: 0,
        errorRate: 0, tokensProcessed: 0, availability: 100,
      };
    }

    const successful = windowMetrics.filter((m) => m.success);
    const latencies = windowMetrics.map((m) => m.latencyMs).sort((a, b) => a - b);

    return {
      totalRequests: windowMetrics.length,
      successfulRequests: successful.length,
      failedRequests: windowMetrics.length - successful.length,
      averageLatencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
      p50LatencyMs: latencies[Math.floor(latencies.length * 0.5)] || 0,
      p95LatencyMs: latencies[Math.floor(latencies.length * 0.95)] || 0,
      p99LatencyMs: latencies[Math.floor(latencies.length * 0.99)] || 0,
      errorRate: (windowMetrics.length - successful.length) / windowMetrics.length,
      tokensProcessed: windowMetrics.reduce((sum, m) => sum + (m.tokensProcessed || 0), 0),
      availability: (successful.length / windowMetrics.length) * 100,
    };
  }

  getHealthWindows(provider: string): HealthWindow[] {
    const windows = [
      { period: "1m", windowMs: 60000 },
      { period: "5m", windowMs: 300000 },
      { period: "15m", windowMs: 900000 },
      { period: "1h", windowMs: 3600000 },
      { period: "24h", windowMs: 86400000 },
    ];

    return windows.map((w) => ({
      ...w,
      metrics: this.getWindowMetrics(provider, w.windowMs),
    }));
  }

  // ===== Provider Scoring =====

  getProviderScores(): ProviderScore[] {
    const providers = providerRegistry.getEnabled();
    return providers.map((name) => this.scoreProvider(name));
  }

  private scoreProvider(provider: string): ProviderScore {
    const windows = this.getHealthWindows(provider);
    const recent = windows.find((w) => w.period === "5m")?.metrics;
    const hourly = windows.find((w) => w.period === "1h")?.metrics;

    const latencyScore = recent ? Math.max(0, 100 - (recent.averageLatencyMs / 50)) : 50;
    const reliabilityScore = recent ? recent.availability : 100;
    const availabilityScore = this.canRequest(provider) ? 100 : 0;
    const costScore = 50; // Neutral until integrated with cost engine

    const overallScore = Math.round(
      latencyScore * 0.25 +
      reliabilityScore * 0.35 +
      availabilityScore * 0.25 +
      costScore * 0.15
    );

    // Trend detection
    let trend: "improving" | "stable" | "degrading" = "stable";
    if (recent && hourly) {
      if (recent.errorRate < hourly.errorRate * 0.5) trend = "improving";
      else if (recent.errorRate > hourly.errorRate * 1.5) trend = "degrading";
    }

    return { provider, overallScore, latencyScore, reliabilityScore, costScore, availabilityScore, trend };
  }

  /**
   * Get the best available provider based on health scores.
   */
  getBestProvider(exclude?: string[]): string | null {
    const scores = this.getProviderScores()
      .filter((s) => s.availabilityScore > 0 && (!exclude || !exclude.includes(s.provider)))
      .sort((a, b) => b.overallScore - a.overallScore);

    return scores[0]?.provider || null;
  }

  // ===== Monitoring =====

  startMonitoring(intervalMs: number = 30000): void {
    this.stopMonitoring();
    this.monitorInterval = setInterval(async () => {
      const health = await providerRegistry.healthCheckAll();
      for (const [name, status] of health) {
        if (status.status === "unavailable") {
          this.recordFailure(name, 0, "health_check_failed");
        } else {
          this.recordSuccess(name, status.latencyMs);
        }
      }
      this.emit("healthCheckComplete", Object.fromEntries(health));
    }, intervalMs);
  }

  stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
  }

  // ===== Dashboard Data =====

  getDashboard(): {
    providers: Array<{
      name: string;
      circuitState: CircuitState;
      score: ProviderScore;
      windows: HealthWindow[];
      configured: boolean;
    }>;
    globalMetrics: {
      totalRequests: number;
      overallErrorRate: number;
      averageLatencyMs: number;
      activeProviders: number;
    };
  } {
    const providers = providerRegistry.getEnabled().map((name) => ({
      name,
      circuitState: this.getOrCreateBreaker(name).state,
      score: this.scoreProvider(name),
      windows: this.getHealthWindows(name),
      configured: providerRegistry.isAvailable(name),
    }));

    const recent = this.metrics.filter((m) => m.timestamp > Date.now() - 3600000);
    const failed = recent.filter((m) => !m.success);

    return {
      providers,
      globalMetrics: {
        totalRequests: recent.length,
        overallErrorRate: recent.length > 0 ? failed.length / recent.length : 0,
        averageLatencyMs: recent.length > 0 ? Math.round(recent.reduce((s, m) => s + m.latencyMs, 0) / recent.length) : 0,
        activeProviders: providers.filter((p) => p.circuitState !== "open").length,
      },
    };
  }

  private cleanupOldMetrics(): void {
    if (this.metrics.length > this.MAX_METRICS) {
      this.metrics = this.metrics.slice(-Math.floor(this.MAX_METRICS * 0.8));
    }
  }

  destroy(): void {
    this.stopMonitoring();
    clearInterval(this.cleanupInterval);
    this.circuitBreakers.clear();
    this.metrics = [];
    this.removeAllListeners();
  }
}

// Singleton
export const healthMonitor = new ProviderHealthMonitor();
