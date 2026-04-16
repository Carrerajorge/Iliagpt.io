import { z } from "zod";

export const RetrievalMetricSchema = z.object({
  timestamp: z.number(),
  queryHash: z.string(),
  totalDurationMs: z.number(),
  searchDurationMs: z.number(),
  fetchDurationMs: z.number(),
  processDurationMs: z.number(),
  sourcesCount: z.number(),
  cacheHitRate: z.number(),
  relevanceScore: z.number(),
  method: z.enum(["cache", "fetch", "browser", "mixed"]),
  success: z.boolean(),
  errorCount: z.number(),
});

export type RetrievalMetric = z.infer<typeof RetrievalMetricSchema>;

export interface SLAThresholds {
  fetchP95Ms: number;
  browserP95Ms: number;
  minCacheHitRate: number;
  minRelevanceScore: number;
  minSourcesCount: number;
}

export interface SLAReport {
  fetchP95Ms: number;
  browserP95Ms: number;
  overallP95Ms: number;
  cacheHitRate: number;
  avgRelevanceScore: number;
  avgSourcesCount: number;
  successRate: number;
  totalRequests: number;
  slaCompliance: {
    fetchP95: boolean;
    browserP95: boolean;
    cacheHitRate: boolean;
    relevanceScore: boolean;
    sourcesCount: boolean;
    overall: boolean;
  };
}

const DEFAULT_SLA_THRESHOLDS: SLAThresholds = {
  fetchP95Ms: 3000,
  browserP95Ms: 8000,
  minCacheHitRate: 0.3,
  minRelevanceScore: 0.3,
  minSourcesCount: 3,
};

export class RetrievalMetricsCollector {
  private metrics: RetrievalMetric[] = [];
  private maxEntries: number;
  private thresholds: SLAThresholds;

  constructor(maxEntries: number = 1000, thresholds: Partial<SLAThresholds> = {}) {
    this.maxEntries = maxEntries;
    this.thresholds = { ...DEFAULT_SLA_THRESHOLDS, ...thresholds };
  }

  record(metric: RetrievalMetric): void {
    this.metrics.push(metric);
    
    if (this.metrics.length > this.maxEntries) {
      this.metrics = this.metrics.slice(-this.maxEntries);
    }
  }

  recordFromResult(
    queryHash: string,
    result: {
      success: boolean;
      metrics: {
        totalDurationMs: number;
        searchDurationMs: number;
        fetchDurationMs: number;
        processDurationMs: number;
        cacheHitRate: number;
        sourcesCount: number;
        averageRelevanceScore: number;
      };
      sources: Array<{ fetchMethod: "cache" | "fetch" | "browser" }>;
      errors: Array<any>;
    }
  ): void {
    const methods = result.sources.map(s => s.fetchMethod);
    const hasCache = methods.includes("cache");
    const hasFetch = methods.includes("fetch");
    const hasBrowser = methods.includes("browser");
    
    let method: RetrievalMetric["method"];
    if (methods.length === 0) {
      method = "fetch";
    } else if (hasCache && !hasFetch && !hasBrowser) {
      method = "cache";
    } else if (hasBrowser) {
      method = hasFetch || hasCache ? "mixed" : "browser";
    } else {
      method = hasFetch ? "fetch" : "cache";
    }
    
    this.record({
      timestamp: Date.now(),
      queryHash,
      totalDurationMs: result.metrics.totalDurationMs,
      searchDurationMs: result.metrics.searchDurationMs,
      fetchDurationMs: result.metrics.fetchDurationMs,
      processDurationMs: result.metrics.processDurationMs,
      sourcesCount: result.metrics.sourcesCount,
      cacheHitRate: result.metrics.cacheHitRate,
      relevanceScore: result.metrics.averageRelevanceScore,
      method,
      success: result.success,
      errorCount: result.errors.length,
    });
  }

  getSLAReport(windowMs: number = 3600000): SLAReport {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    const recentMetrics = this.metrics.filter(m => m.timestamp >= windowStart);
    
    if (recentMetrics.length === 0) {
      return {
        fetchP95Ms: 0,
        browserP95Ms: 0,
        overallP95Ms: 0,
        cacheHitRate: 0,
        avgRelevanceScore: 0,
        avgSourcesCount: 0,
        successRate: 0,
        totalRequests: 0,
        slaCompliance: {
          fetchP95: true,
          browserP95: true,
          cacheHitRate: true,
          relevanceScore: true,
          sourcesCount: true,
          overall: true,
        },
      };
    }
    
    const fetchMetrics = recentMetrics.filter(m => m.method === "fetch" || m.method === "cache");
    const browserMetrics = recentMetrics.filter(m => m.method === "browser" || m.method === "mixed");
    
    const fetchP95Ms = this.percentile(fetchMetrics.map(m => m.totalDurationMs), 95);
    const browserP95Ms = this.percentile(browserMetrics.map(m => m.totalDurationMs), 95);
    const overallP95Ms = this.percentile(recentMetrics.map(m => m.totalDurationMs), 95);
    
    const cacheHitRate = recentMetrics.reduce((sum, m) => sum + m.cacheHitRate, 0) / recentMetrics.length;
    const avgRelevanceScore = recentMetrics.reduce((sum, m) => sum + m.relevanceScore, 0) / recentMetrics.length;
    const avgSourcesCount = recentMetrics.reduce((sum, m) => sum + m.sourcesCount, 0) / recentMetrics.length;
    const successRate = recentMetrics.filter(m => m.success).length / recentMetrics.length;
    
    const slaCompliance = {
      fetchP95: fetchP95Ms <= this.thresholds.fetchP95Ms,
      browserP95: browserP95Ms <= this.thresholds.browserP95Ms,
      cacheHitRate: cacheHitRate >= this.thresholds.minCacheHitRate,
      relevanceScore: avgRelevanceScore >= this.thresholds.minRelevanceScore,
      sourcesCount: avgSourcesCount >= this.thresholds.minSourcesCount,
      overall: false,
    };
    
    slaCompliance.overall = slaCompliance.fetchP95 && 
                            slaCompliance.browserP95 && 
                            slaCompliance.cacheHitRate && 
                            slaCompliance.relevanceScore && 
                            slaCompliance.sourcesCount;
    
    return {
      fetchP95Ms,
      browserP95Ms,
      overallP95Ms,
      cacheHitRate,
      avgRelevanceScore,
      avgSourcesCount,
      successRate,
      totalRequests: recentMetrics.length,
      slaCompliance,
    };
  }

  getLatencyHistogram(buckets: number[] = [100, 500, 1000, 2000, 3000, 5000, 8000, 10000]): Record<string, number> {
    const histogram: Record<string, number> = {};
    
    for (let i = 0; i < buckets.length; i++) {
      const key = i === 0 ? `<${buckets[0]}ms` : `${buckets[i - 1]}-${buckets[i]}ms`;
      histogram[key] = 0;
    }
    histogram[`>${buckets[buckets.length - 1]}ms`] = 0;
    
    for (const metric of this.metrics) {
      let placed = false;
      for (let i = 0; i < buckets.length; i++) {
        if (metric.totalDurationMs < buckets[i]) {
          const key = i === 0 ? `<${buckets[0]}ms` : `${buckets[i - 1]}-${buckets[i]}ms`;
          histogram[key]++;
          placed = true;
          break;
        }
      }
      if (!placed) {
        histogram[`>${buckets[buckets.length - 1]}ms`]++;
      }
    }
    
    return histogram;
  }

  getMethodBreakdown(): Record<string, { count: number; avgDurationMs: number; successRate: number }> {
    const methods: Record<string, { durations: number[]; successes: number }> = {};
    
    for (const metric of this.metrics) {
      if (!methods[metric.method]) {
        methods[metric.method] = { durations: [], successes: 0 };
      }
      methods[metric.method].durations.push(metric.totalDurationMs);
      if (metric.success) {
        methods[metric.method].successes++;
      }
    }
    
    const breakdown: Record<string, { count: number; avgDurationMs: number; successRate: number }> = {};
    
    for (const [method, data] of Object.entries(methods)) {
      breakdown[method] = {
        count: data.durations.length,
        avgDurationMs: data.durations.reduce((a, b) => a + b, 0) / data.durations.length,
        successRate: data.successes / data.durations.length,
      };
    }
    
    return breakdown;
  }

  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  clear(): void {
    this.metrics = [];
  }

  getMetricsCount(): number {
    return this.metrics.length;
  }

  exportMetrics(): RetrievalMetric[] {
    return [...this.metrics];
  }
}

export const retrievalMetrics = new RetrievalMetricsCollector();
