import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { Logger } from '../lib/logger';

export interface LatencyBucket {
  p50: number;
  p75: number;
  p95: number;
  p99: number;
  max: number;
  min: number;
  mean: number;
}

export interface ModelMetrics {
  modelId: string;
  provider: string;
  requestCount: number;
  errorCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  latency: LatencyBucket;
  lastUsedAt: Date;
}

export interface OperationMetrics {
  operation: string;
  count: number;
  errors: number;
  latency: LatencyBucket;
  avgTokens: number;
}

export interface UserMetrics {
  userId: string;
  requestCount: number;
  tokensConsumed: number;
  estimatedCostUsd: number;
  lastActiveAt: Date;
  topModels: string[];
}

export interface AnomalyAlert {
  id: string;
  type: 'latency_spike' | 'error_surge' | 'cost_spike' | 'token_surge';
  severity: 'low' | 'medium' | 'high';
  modelId?: string;
  userId?: string;
  value: number;
  threshold: number;
  detectedAt: Date;
  message: string;
}

export interface DashboardData {
  timestamp: Date;
  models: ModelMetrics[];
  operations: OperationMetrics[];
  topUsers: UserMetrics[];
  anomalies: AnomalyAlert[];
  summary: {
    totalRequests: number;
    totalErrors: number;
    totalCostUsd: number;
    avgLatencyMs: number;
    activeModels: number;
  };
}

export interface PrometheusMetric {
  name: string;
  help: string;
  type: 'counter' | 'gauge' | 'histogram';
  labels: Record<string, string>;
  value: number;
}

interface RecordRequestParams {
  modelId: string;
  provider: string;
  operation: string;
  userId: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number;
  error?: boolean;
}

interface AnomalyDedupeKey {
  type: AnomalyAlert['type'];
  modelId?: string;
  userId?: string;
  lastEmittedAt: Date;
}

const MAX_LATENCY_SAMPLES = 1000;
const MAX_ANOMALY_ALERTS = 500;
const ANOMALY_DEDUP_WINDOW_MS = 5 * 60 * 1000;

export class PerformanceMonitor extends EventEmitter {
  private modelMetrics: Map<string, ModelMetrics> = new Map();
  private operationMetrics: Map<string, OperationMetrics> = new Map();
  private userMetrics: Map<string, UserMetrics> = new Map();
  private latencySamples: Map<string, number[]> = new Map();
  private anomalyAlerts: AnomalyAlert[] = [];
  private anomalyThresholds = {
    latencyP99Ms: 5000,
    errorRatePct: 10,
    hourlyCostUsd: 50,
  };
  private anomalyDedupeMap: Map<string, AnomalyDedupeKey> = new Map();
  private userModelUsage: Map<string, Map<string, number>> = new Map();
  private recentErrors: Map<string, boolean[]> = new Map();
  private recentCosts: Map<string, Array<{ costUsd: number; ts: number }>> = new Map();

  constructor() {
    super();
  }

  recordRequest(params: RecordRequestParams): void {
    const {
      modelId, provider, operation, userId,
      inputTokens, outputTokens, latencyMs, costUsd, error = false,
    } = params;

    this._updateModelMetrics(modelId, provider, inputTokens, outputTokens, latencyMs, costUsd, error);
    this._updateOperationMetrics(operation, inputTokens + outputTokens, latencyMs, error);
    this._updateUserMetrics(userId, modelId, inputTokens + outputTokens, costUsd);
    this._addLatencySample(modelId, latencyMs);
    this._trackRecentError(modelId, error);
    this._trackRecentCost(modelId, costUsd);

    this._detectAnomalies(modelId, userId, latencyMs, costUsd, error);

    this.emit('metrics:recorded', { modelId, userId, operation, latencyMs, costUsd, error });
    Logger.debug('Metrics recorded', { modelId, userId, operation, latencyMs });
  }

  private _updateModelMetrics(
    modelId: string, provider: string,
    inputTokens: number, outputTokens: number,
    latencyMs: number, costUsd: number, error: boolean,
  ): void {
    const existing = this.modelMetrics.get(modelId);
    const samples = this.latencySamples.get(modelId) ?? [];
    const allSamples = [...samples, latencyMs];

    const base: ModelMetrics = existing ?? {
      modelId, provider,
      requestCount: 0, errorCount: 0,
      totalInputTokens: 0, totalOutputTokens: 0,
      totalCostUsd: 0,
      latency: this._computeLatencyBucket([latencyMs]),
      lastUsedAt: new Date(),
    };

    this.modelMetrics.set(modelId, {
      ...base,
      provider,
      requestCount: base.requestCount + 1,
      errorCount: base.errorCount + (error ? 1 : 0),
      totalInputTokens: base.totalInputTokens + inputTokens,
      totalOutputTokens: base.totalOutputTokens + outputTokens,
      totalCostUsd: base.totalCostUsd + costUsd,
      latency: this._computeLatencyBucket(allSamples),
      lastUsedAt: new Date(),
    });
  }

  private _updateOperationMetrics(
    operation: string, totalTokens: number, latencyMs: number, error: boolean,
  ): void {
    const existing = this.operationMetrics.get(operation);
    if (!existing) {
      this.operationMetrics.set(operation, {
        operation,
        count: 1,
        errors: error ? 1 : 0,
        latency: this._computeLatencyBucket([latencyMs]),
        avgTokens: totalTokens,
      });
      return;
    }
    const newCount = existing.count + 1;
    const allSamples = this.latencySamples.get(`op:${operation}`) ?? [];
    allSamples.push(latencyMs);
    if (allSamples.length > MAX_LATENCY_SAMPLES) allSamples.shift();
    this.latencySamples.set(`op:${operation}`, allSamples);

    this.operationMetrics.set(operation, {
      operation,
      count: newCount,
      errors: existing.errors + (error ? 1 : 0),
      latency: this._computeLatencyBucket(allSamples),
      avgTokens: (existing.avgTokens * existing.count + totalTokens) / newCount,
    });
  }

  private _updateUserMetrics(userId: string, modelId: string, tokens: number, costUsd: number): void {
    const existing = this.userMetrics.get(userId);

    const modelUsage = this.userModelUsage.get(userId) ?? new Map<string, number>();
    modelUsage.set(modelId, (modelUsage.get(modelId) ?? 0) + 1);
    this.userModelUsage.set(userId, modelUsage);

    const topModels = [...modelUsage.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([m]) => m);

    if (!existing) {
      this.userMetrics.set(userId, {
        userId,
        requestCount: 1,
        tokensConsumed: tokens,
        estimatedCostUsd: costUsd,
        lastActiveAt: new Date(),
        topModels,
      });
      return;
    }

    this.userMetrics.set(userId, {
      ...existing,
      requestCount: existing.requestCount + 1,
      tokensConsumed: existing.tokensConsumed + tokens,
      estimatedCostUsd: existing.estimatedCostUsd + costUsd,
      lastActiveAt: new Date(),
      topModels,
    });
  }

  private _addLatencySample(modelId: string, latencyMs: number): void {
    const samples = this.latencySamples.get(modelId) ?? [];
    samples.push(latencyMs);
    if (samples.length > MAX_LATENCY_SAMPLES) samples.shift();
    this.latencySamples.set(modelId, samples);
  }

  private _trackRecentError(modelId: string, error: boolean): void {
    const errors = this.recentErrors.get(modelId) ?? [];
    errors.push(error);
    if (errors.length > 100) errors.shift();
    this.recentErrors.set(modelId, errors);
  }

  private _trackRecentCost(modelId: string, costUsd: number): void {
    const costs = this.recentCosts.get(modelId) ?? [];
    costs.push({ costUsd, ts: Date.now() });
    const oneHourAgo = Date.now() - 3_600_000;
    const filtered = costs.filter(c => c.ts > oneHourAgo);
    this.recentCosts.set(modelId, filtered);
  }

  private _detectAnomalies(
    modelId: string, userId: string, latencyMs: number, costUsd: number, isError: boolean,
  ): void {
    const now = new Date();

    // Latency spike
    const samples = this.latencySamples.get(modelId) ?? [];
    if (samples.length >= 10) {
      const bucket = this._computeLatencyBucket(samples);
      if (latencyMs > this.anomalyThresholds.latencyP99Ms && bucket.p99 > this.anomalyThresholds.latencyP99Ms) {
        this._emitAnomaly({
          type: 'latency_spike',
          severity: bucket.p99 > this.anomalyThresholds.latencyP99Ms * 2 ? 'high' : 'medium',
          modelId,
          value: bucket.p99,
          threshold: this.anomalyThresholds.latencyP99Ms,
          detectedAt: now,
          message: `Model ${modelId} p99 latency ${Math.round(bucket.p99)}ms exceeds threshold ${this.anomalyThresholds.latencyP99Ms}ms`,
        });
      }
    }

    // Error surge
    if (isError) {
      const errors = this.recentErrors.get(modelId) ?? [];
      if (errors.length >= 20) {
        const errorCount = errors.filter(Boolean).length;
        const errorRatePct = (errorCount / errors.length) * 100;
        if (errorRatePct > this.anomalyThresholds.errorRatePct) {
          this._emitAnomaly({
            type: 'error_surge',
            severity: errorRatePct > 50 ? 'high' : errorRatePct > 25 ? 'medium' : 'low',
            modelId,
            value: errorRatePct,
            threshold: this.anomalyThresholds.errorRatePct,
            detectedAt: now,
            message: `Model ${modelId} error rate ${errorRatePct.toFixed(1)}% exceeds threshold ${this.anomalyThresholds.errorRatePct}%`,
          });
        }
      }
    }

    // Cost spike
    const costs = this.recentCosts.get(modelId) ?? [];
    const hourlyTotal = costs.reduce((sum, c) => sum + c.costUsd, 0);
    if (hourlyTotal > this.anomalyThresholds.hourlyCostUsd) {
      this._emitAnomaly({
        type: 'cost_spike',
        severity: hourlyTotal > this.anomalyThresholds.hourlyCostUsd * 2 ? 'high' : 'medium',
        modelId,
        userId,
        value: hourlyTotal,
        threshold: this.anomalyThresholds.hourlyCostUsd,
        detectedAt: now,
        message: `Model ${modelId} estimated hourly cost $${hourlyTotal.toFixed(2)} exceeds threshold $${this.anomalyThresholds.hourlyCostUsd}`,
      });
    }
  }

  private _emitAnomaly(alert: Omit<AnomalyAlert, 'id'>): void {
    const dedupeKey = `${alert.type}:${alert.modelId ?? ''}:${alert.userId ?? ''}`;
    const existing = this.anomalyDedupeMap.get(dedupeKey);
    const now = Date.now();

    if (existing && (now - existing.lastEmittedAt.getTime()) < ANOMALY_DEDUP_WINDOW_MS) {
      return;
    }

    const full: AnomalyAlert = { id: randomUUID(), ...alert };

    this.anomalyDedupeMap.set(dedupeKey, {
      type: alert.type,
      modelId: alert.modelId,
      userId: alert.userId,
      lastEmittedAt: new Date(),
    });

    this.anomalyAlerts.push(full);
    if (this.anomalyAlerts.length > MAX_ANOMALY_ALERTS) {
      this.anomalyAlerts.shift();
    }

    this.emit('anomaly:detected', full);
    Logger.warn('Anomaly detected', { type: full.type, severity: full.severity, modelId: full.modelId });
  }

  getModelMetrics(modelId: string): ModelMetrics | undefined {
    return this.modelMetrics.get(modelId);
  }

  getAllModelMetrics(): ModelMetrics[] {
    return Array.from(this.modelMetrics.values());
  }

  getUserMetrics(userId: string): UserMetrics | undefined {
    return this.userMetrics.get(userId);
  }

  getTopUsers(limit = 10): UserMetrics[] {
    return Array.from(this.userMetrics.values())
      .sort((a, b) => b.requestCount - a.requestCount)
      .slice(0, limit);
  }

  getDashboardData(): DashboardData {
    const models = this.getAllModelMetrics();
    const operations = Array.from(this.operationMetrics.values());
    const topUsers = this.getTopUsers(10);

    const totalRequests = models.reduce((s, m) => s + m.requestCount, 0);
    const totalErrors = models.reduce((s, m) => s + m.errorCount, 0);
    const totalCostUsd = models.reduce((s, m) => s + m.totalCostUsd, 0);
    const allLatencies = models.map(m => m.latency.mean).filter(v => !isNaN(v));
    const avgLatencyMs = allLatencies.length > 0
      ? allLatencies.reduce((s, v) => s + v, 0) / allLatencies.length
      : 0;

    return {
      timestamp: new Date(),
      models,
      operations,
      topUsers,
      anomalies: this.anomalyAlerts.slice(-50),
      summary: {
        totalRequests,
        totalErrors,
        totalCostUsd,
        avgLatencyMs,
        activeModels: models.length,
      },
    };
  }

  exportPrometheus(): string {
    const lines: string[] = [];

    const emit = (
      name: string, help: string, type: string,
      labelPairs: Record<string, string>, value: number,
    ): void => {
      const labelStr = Object.entries(labelPairs)
        .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
        .join(',');
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} ${type}`);
      lines.push(`${name}{${labelStr}} ${value}`);
    };

    for (const m of this.modelMetrics.values()) {
      const labels = { model: m.modelId, provider: m.provider };
      emit('rag_requests_total', 'Total AI requests', 'counter', labels, m.requestCount);
      emit('rag_errors_total', 'Total AI errors', 'counter', labels, m.errorCount);
      emit('rag_input_tokens_total', 'Total input tokens', 'counter', labels, m.totalInputTokens);
      emit('rag_output_tokens_total', 'Total output tokens', 'counter', labels, m.totalOutputTokens);
      emit('rag_cost_usd_total', 'Total cost in USD', 'counter', labels, m.totalCostUsd);

      for (const [quantile, value] of [
        ['0.5', m.latency.p50],
        ['0.95', m.latency.p95],
        ['0.99', m.latency.p99],
      ] as [string, number][]) {
        emit(
          'rag_latency_ms',
          'Request latency in milliseconds',
          'histogram',
          { ...labels, quantile },
          value,
        );
      }
    }

    return lines.join('\n');
  }

  private _computeLatencyBucket(samples: number[]): LatencyBucket {
    if (samples.length === 0) {
      return { p50: 0, p75: 0, p95: 0, p99: 0, max: 0, min: 0, mean: 0 };
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const n = sorted.length;
    const percentile = (p: number): number => {
      const idx = Math.ceil((p / 100) * n) - 1;
      return sorted[Math.max(0, Math.min(idx, n - 1))];
    };
    const mean = sorted.reduce((s, v) => s + v, 0) / n;
    return {
      p50: percentile(50),
      p75: percentile(75),
      p95: percentile(95),
      p99: percentile(99),
      max: sorted[n - 1],
      min: sorted[0],
      mean,
    };
  }

  getAnomalyAlerts(filter?: { type?: string; severity?: string; since?: Date }): AnomalyAlert[] {
    let alerts = [...this.anomalyAlerts];
    if (filter?.type) alerts = alerts.filter(a => a.type === filter.type);
    if (filter?.severity) alerts = alerts.filter(a => a.severity === filter.severity);
    if (filter?.since) alerts = alerts.filter(a => a.detectedAt >= filter.since!);
    return alerts;
  }

  clearMetrics(): void {
    this.modelMetrics.clear();
    this.operationMetrics.clear();
    this.userMetrics.clear();
    this.latencySamples.clear();
    this.anomalyAlerts.length = 0;
    this.anomalyDedupeMap.clear();
    this.userModelUsage.clear();
    this.recentErrors.clear();
    this.recentCosts.clear();
    Logger.info('PerformanceMonitor metrics cleared');
  }
}
