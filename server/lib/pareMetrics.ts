export interface HistogramBucket {
  values: number[];
  sum: number;
  count: number;
  min: number;
  max: number;
}

export interface ParserMetrics {
  successCount: number;
  failureCount: number;
  totalDurationMs: number;
  durations: number[];
}

export interface MetricsSummary {
  uptime_ms: number;
  request_duration_ms: {
    p50: number;
    p95: number;
    p99: number;
    count: number;
    avg: number;
  };
  parse_duration_ms: {
    p50: number;
    p95: number;
    p99: number;
    count: number;
    avg: number;
  };
  tokens_extracted: {
    total: number;
    avg: number;
    max: number;
  };
  files_processed: {
    total: number;
    success: number;
    failed: number;
  };
  parsers: Record<string, {
    success_count: number;
    failure_count: number;
    avg_duration_ms: number;
    p50_duration_ms: number;
    p95_duration_ms: number;
  }>;
  memory_usage_mb: number;
}

class Histogram {
  private values: number[] = [];
  private sum = 0;
  private min = Infinity;
  private max = -Infinity;
  private maxSize: number;

  constructor(maxSize = 10000) {
    this.maxSize = maxSize;
  }

  record(value: number): void {
    this.values.push(value);
    this.sum += value;
    if (value < this.min) this.min = value;
    if (value > this.max) this.max = value;

    if (this.values.length > this.maxSize) {
      const removed = this.values.shift();
      if (removed !== undefined) {
        this.sum -= removed;
      }
    }
  }

  getPercentile(p: number): number {
    if (this.values.length === 0) return 0;
    
    const sorted = [...this.values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  getStats(): { p50: number; p95: number; p99: number; count: number; avg: number; min: number; max: number } {
    const count = this.values.length;
    return {
      p50: this.getPercentile(50),
      p95: this.getPercentile(95),
      p99: this.getPercentile(99),
      count,
      avg: count > 0 ? this.sum / count : 0,
      min: this.min === Infinity ? 0 : this.min,
      max: this.max === -Infinity ? 0 : this.max,
    };
  }

  reset(): void {
    this.values = [];
    this.sum = 0;
    this.min = Infinity;
    this.max = -Infinity;
  }
}

class Counter {
  private value = 0;

  increment(amount = 1): void {
    this.value += amount;
  }

  get(): number {
    return this.value;
  }

  reset(): void {
    this.value = 0;
  }
}

class PareMetricsCollector {
  private startTime: number;
  private requestDuration: Histogram;
  private parseDuration: Histogram;
  private tokensExtracted: Histogram;
  private filesProcessed: Counter;
  private filesSuccess: Counter;
  private filesFailed: Counter;
  private parserMetrics: Map<string, ParserMetrics>;

  constructor() {
    this.startTime = Date.now();
    this.requestDuration = new Histogram();
    this.parseDuration = new Histogram();
    this.tokensExtracted = new Histogram();
    this.filesProcessed = new Counter();
    this.filesSuccess = new Counter();
    this.filesFailed = new Counter();
    this.parserMetrics = new Map();
  }

  recordRequestDuration(durationMs: number): void {
    this.requestDuration.record(durationMs);
  }

  recordParseDuration(durationMs: number): void {
    this.parseDuration.record(durationMs);
  }

  recordTokensExtracted(tokens: number): void {
    this.tokensExtracted.record(tokens);
  }

  recordFileProcessed(success: boolean): void {
    this.filesProcessed.increment();
    if (success) {
      this.filesSuccess.increment();
    } else {
      this.filesFailed.increment();
    }
  }

  recordParserExecution(parserName: string, durationMs: number, success: boolean): void {
    let metrics = this.parserMetrics.get(parserName);
    if (!metrics) {
      metrics = {
        successCount: 0,
        failureCount: 0,
        totalDurationMs: 0,
        durations: [],
      };
      this.parserMetrics.set(parserName, metrics);
    }

    if (success) {
      metrics.successCount++;
    } else {
      metrics.failureCount++;
    }
    metrics.totalDurationMs += durationMs;
    metrics.durations.push(durationMs);

    if (metrics.durations.length > 1000) {
      metrics.durations.shift();
    }
  }

  getMetricsSummary(): MetricsSummary {
    const requestStats = this.requestDuration.getStats();
    const parseStats = this.parseDuration.getStats();
    const tokenStats = this.tokensExtracted.getStats();

    const parsersObj: MetricsSummary["parsers"] = {};
    for (const [name, metrics] of this.parserMetrics.entries()) {
      const totalCalls = metrics.successCount + metrics.failureCount;
      const avgDuration = totalCalls > 0 ? metrics.totalDurationMs / totalCalls : 0;
      
      const sorted = [...metrics.durations].sort((a, b) => a - b);
      const p50Idx = Math.max(0, Math.ceil(0.5 * sorted.length) - 1);
      const p95Idx = Math.max(0, Math.ceil(0.95 * sorted.length) - 1);
      
      parsersObj[name] = {
        success_count: metrics.successCount,
        failure_count: metrics.failureCount,
        avg_duration_ms: Math.round(avgDuration * 100) / 100,
        p50_duration_ms: sorted[p50Idx] || 0,
        p95_duration_ms: sorted[p95Idx] || 0,
      };
    }

    const memUsage = process.memoryUsage();

    return {
      uptime_ms: Date.now() - this.startTime,
      request_duration_ms: {
        p50: requestStats.p50,
        p95: requestStats.p95,
        p99: requestStats.p99,
        count: requestStats.count,
        avg: Math.round(requestStats.avg * 100) / 100,
      },
      parse_duration_ms: {
        p50: parseStats.p50,
        p95: parseStats.p95,
        p99: parseStats.p99,
        count: parseStats.count,
        avg: Math.round(parseStats.avg * 100) / 100,
      },
      tokens_extracted: {
        total: tokenStats.count > 0 ? Math.round(tokenStats.avg * tokenStats.count) : 0,
        avg: Math.round(tokenStats.avg),
        max: tokenStats.max,
      },
      files_processed: {
        total: this.filesProcessed.get(),
        success: this.filesSuccess.get(),
        failed: this.filesFailed.get(),
      },
      parsers: parsersObj,
      memory_usage_mb: Math.round((memUsage.heapUsed / 1024 / 1024) * 100) / 100,
    };
  }

  reset(): void {
    this.startTime = Date.now();
    this.requestDuration.reset();
    this.parseDuration.reset();
    this.tokensExtracted.reset();
    this.filesProcessed.reset();
    this.filesSuccess.reset();
    this.filesFailed.reset();
    this.parserMetrics.clear();
  }
}

export const pareMetrics = new PareMetricsCollector();

export function getMetricsSummary(): MetricsSummary {
  return pareMetrics.getMetricsSummary();
}

export { Histogram, Counter, PareMetricsCollector };
