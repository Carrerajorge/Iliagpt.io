import { EventEmitter } from 'events';

export type TaskComplexity = 'simple' | 'moderate' | 'complex' | 'expert';

export interface ToolPerformance {
  toolName: string;
  totalUses: number;
  successes: number;
  failures: number;
  successRate: number;
  avgDurationMs: number;
  lastUsed: number;
  errorPatterns: Map<string, number>;
}

export interface TaskTypePerformance {
  taskType: string;
  totalAttempts: number;
  successes: number;
  failures: number;
  successRate: number;
  avgDurationMs: number;
  avgTokensUsed: number;
  complexityBreakdown: Record<TaskComplexity, { attempts: number; successes: number }>;
}

export interface PerformanceMetric {
  id: string;
  toolName: string;
  taskType: string;
  complexity: TaskComplexity;
  success: boolean;
  durationMs: number;
  tokensUsed: number;
  errorMessage?: string;
  timestamp: number;
}

export interface WeakArea {
  area: string;
  type: 'tool' | 'taskType';
  successRate: number;
  sampleSize: number;
  commonErrors: string[];
  recommendation: string;
}

export interface PerformanceSummary {
  overallSuccessRate: number;
  totalTasks: number;
  toolPerformance: ToolPerformance[];
  taskTypePerformance: TaskTypePerformance[];
  weakAreas: WeakArea[];
  trends: {
    last24h: { tasks: number; successRate: number };
    last7d: { tasks: number; successRate: number };
    last30d: { tasks: number; successRate: number };
  };
  topTools: string[];
  improvingAreas: string[];
  decliningAreas: string[];
}

export class PerformanceTracker extends EventEmitter {
  private metrics: PerformanceMetric[] = [];
  private toolStats: Map<string, ToolPerformance> = new Map();
  private taskTypeStats: Map<string, TaskTypePerformance> = new Map();
  private maxMetricsRetained = 10000;

  recordMetric(metric: Omit<PerformanceMetric, 'id' | 'timestamp'>): PerformanceMetric {
    const full: PerformanceMetric = {
      ...metric,
      id: `perf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };

    this.metrics.push(full);
    if (this.metrics.length > this.maxMetricsRetained) {
      this.metrics = this.metrics.slice(-this.maxMetricsRetained);
    }

    this.updateToolStats(full);
    this.updateTaskTypeStats(full);

    this.emit('metric:recorded', full);
    return full;
  }

  private updateToolStats(metric: PerformanceMetric): void {
    const existing = this.toolStats.get(metric.toolName) || {
      toolName: metric.toolName,
      totalUses: 0,
      successes: 0,
      failures: 0,
      successRate: 0,
      avgDurationMs: 0,
      lastUsed: 0,
      errorPatterns: new Map<string, number>(),
    };

    existing.totalUses++;
    if (metric.success) {
      existing.successes++;
    } else {
      existing.failures++;
      if (metric.errorMessage) {
        const key = this.normalizeError(metric.errorMessage);
        existing.errorPatterns.set(key, (existing.errorPatterns.get(key) || 0) + 1);
      }
    }
    existing.successRate = existing.successes / existing.totalUses;
    existing.avgDurationMs =
      (existing.avgDurationMs * (existing.totalUses - 1) + metric.durationMs) / existing.totalUses;
    existing.lastUsed = metric.timestamp;

    this.toolStats.set(metric.toolName, existing);
  }

  private updateTaskTypeStats(metric: PerformanceMetric): void {
    const existing = this.taskTypeStats.get(metric.taskType) || {
      taskType: metric.taskType,
      totalAttempts: 0,
      successes: 0,
      failures: 0,
      successRate: 0,
      avgDurationMs: 0,
      avgTokensUsed: 0,
      complexityBreakdown: {
        simple: { attempts: 0, successes: 0 },
        moderate: { attempts: 0, successes: 0 },
        complex: { attempts: 0, successes: 0 },
        expert: { attempts: 0, successes: 0 },
      },
    };

    existing.totalAttempts++;
    if (metric.success) existing.successes++;
    else existing.failures++;
    existing.successRate = existing.successes / existing.totalAttempts;
    existing.avgDurationMs =
      (existing.avgDurationMs * (existing.totalAttempts - 1) + metric.durationMs) / existing.totalAttempts;
    existing.avgTokensUsed =
      (existing.avgTokensUsed * (existing.totalAttempts - 1) + metric.tokensUsed) / existing.totalAttempts;

    const cb = existing.complexityBreakdown[metric.complexity];
    cb.attempts++;
    if (metric.success) cb.successes++;

    this.taskTypeStats.set(metric.taskType, existing);
  }

  private normalizeError(msg: string): string {
    return msg
      .replace(/\d+/g, 'N')
      .replace(/".+?"/g, '"..."')
      .substring(0, 120);
  }

  identifyWeakAreas(minSampleSize = 5): WeakArea[] {
    const areas: WeakArea[] = [];

    for (const [, stats] of this.toolStats) {
      if (stats.totalUses >= minSampleSize && stats.successRate < 0.7) {
        const topErrors = [...stats.errorPatterns.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([e]) => e);

        areas.push({
          area: stats.toolName,
          type: 'tool',
          successRate: stats.successRate,
          sampleSize: stats.totalUses,
          commonErrors: topErrors,
          recommendation: this.generateToolRecommendation(stats),
        });
      }
    }

    for (const [, stats] of this.taskTypeStats) {
      if (stats.totalAttempts >= minSampleSize && stats.successRate < 0.7) {
        areas.push({
          area: stats.taskType,
          type: 'taskType',
          successRate: stats.successRate,
          sampleSize: stats.totalAttempts,
          commonErrors: [],
          recommendation: this.generateTaskRecommendation(stats),
        });
      }
    }

    return areas.sort((a, b) => a.successRate - b.successRate);
  }

  private generateToolRecommendation(stats: ToolPerformance): string {
    if (stats.successRate < 0.3) {
      return `Tool "${stats.toolName}" has very low success (${(stats.successRate * 100).toFixed(0)}%). Consider alternative approaches or fixing recurring errors.`;
    }
    if (stats.avgDurationMs > 30000) {
      return `Tool "${stats.toolName}" is slow (avg ${(stats.avgDurationMs / 1000).toFixed(1)}s). Consider optimizing or caching.`;
    }
    return `Tool "${stats.toolName}" needs improvement (${(stats.successRate * 100).toFixed(0)}% success). Review error patterns for fixes.`;
  }

  private generateTaskRecommendation(stats: TaskTypePerformance): string {
    const weakComplexities = (['simple', 'moderate', 'complex', 'expert'] as TaskComplexity[])
      .filter(c => {
        const cb = stats.complexityBreakdown[c];
        return cb.attempts >= 3 && cb.successes / cb.attempts < 0.5;
      });

    if (weakComplexities.length > 0) {
      return `Task type "${stats.taskType}" struggles at ${weakComplexities.join(', ')} complexity. Focus practice on these levels.`;
    }
    return `Task type "${stats.taskType}" has ${(stats.successRate * 100).toFixed(0)}% success. Consider decomposing into smaller sub-tasks.`;
  }

  private getMetricsInRange(startMs: number): PerformanceMetric[] {
    return this.metrics.filter(m => m.timestamp >= startMs);
  }

  private computeRangeStats(startMs: number): { tasks: number; successRate: number } {
    const subset = this.getMetricsInRange(startMs);
    if (subset.length === 0) return { tasks: 0, successRate: 0 };
    const successes = subset.filter(m => m.success).length;
    return { tasks: subset.length, successRate: successes / subset.length };
  }

  private detectTrends(): { improving: string[]; declining: string[] } {
    const improving: string[] = [];
    const declining: string[] = [];
    const now = Date.now();
    const recentCutoff = now - 7 * 24 * 3600_000;
    const olderCutoff = now - 30 * 24 * 3600_000;

    for (const [name] of this.toolStats) {
      const recent = this.metrics.filter(m => m.toolName === name && m.timestamp >= recentCutoff);
      const older = this.metrics.filter(m => m.toolName === name && m.timestamp >= olderCutoff && m.timestamp < recentCutoff);

      if (recent.length >= 3 && older.length >= 3) {
        const recentRate = recent.filter(m => m.success).length / recent.length;
        const olderRate = older.filter(m => m.success).length / older.length;
        if (recentRate - olderRate > 0.1) improving.push(name);
        else if (olderRate - recentRate > 0.1) declining.push(name);
      }
    }

    return { improving, declining };
  }

  getSummary(): PerformanceSummary {
    const now = Date.now();
    const allSuccesses = this.metrics.filter(m => m.success).length;
    const trends = this.detectTrends();

    const toolPerf = [...this.toolStats.values()].map(t => ({
      ...t,
      errorPatterns: new Map(t.errorPatterns),
    }));
    const topTools = [...this.toolStats.entries()]
      .sort((a, b) => b[1].totalUses - a[1].totalUses)
      .slice(0, 5)
      .map(([name]) => name);

    return {
      overallSuccessRate: this.metrics.length > 0 ? allSuccesses / this.metrics.length : 0,
      totalTasks: this.metrics.length,
      toolPerformance: toolPerf,
      taskTypePerformance: [...this.taskTypeStats.values()],
      weakAreas: this.identifyWeakAreas(),
      trends: {
        last24h: this.computeRangeStats(now - 24 * 3600_000),
        last7d: this.computeRangeStats(now - 7 * 24 * 3600_000),
        last30d: this.computeRangeStats(now - 30 * 24 * 3600_000),
      },
      topTools,
      improvingAreas: trends.improving,
      decliningAreas: trends.declining,
    };
  }

  getToolStats(toolName: string): ToolPerformance | undefined {
    return this.toolStats.get(toolName);
  }

  getTaskTypeStats(taskType: string): TaskTypePerformance | undefined {
    return this.taskTypeStats.get(taskType);
  }

  getRecentMetrics(count = 50): PerformanceMetric[] {
    return this.metrics.slice(-count);
  }
}

export const performanceTracker = new PerformanceTracker();
