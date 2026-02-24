import type { Metrics } from "../types";

export interface MetricValue {
  name: string;
  type: "counter" | "gauge" | "histogram";
  value: number;
  tags?: Record<string, string>;
  timestamp: number;
}

export interface MetricHistogram {
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

export class InMemoryMetrics implements Metrics {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  private maxHistogramSize = 1000;

  private makeKey(name: string, tags?: Record<string, string>): string {
    if (!tags || Object.keys(tags).length === 0) return name;
    const tagStr = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return `${name}{${tagStr}}`;
  }

  inc(name: string, tags?: Record<string, string>): void {
    const key = this.makeKey(name, tags);
    this.counters.set(key, (this.counters.get(key) || 0) + 1);
  }

  timing(name: string, ms: number, tags?: Record<string, string>): void {
    const key = this.makeKey(name, tags);
    const existing = this.histograms.get(key) || [];
    existing.push(ms);
    
    if (existing.length > this.maxHistogramSize) {
      existing.shift();
    }
    
    this.histograms.set(key, existing);
  }

  gauge(name: string, value: number, tags?: Record<string, string>): void {
    const key = this.makeKey(name, tags);
    this.gauges.set(key, value);
  }

  getCounter(name: string, tags?: Record<string, string>): number {
    return this.counters.get(this.makeKey(name, tags)) || 0;
  }

  getGauge(name: string, tags?: Record<string, string>): number | undefined {
    return this.gauges.get(this.makeKey(name, tags));
  }

  getHistogram(name: string, tags?: Record<string, string>): MetricHistogram | undefined {
    const key = this.makeKey(name, tags);
    const values = this.histograms.get(key);
    
    if (!values || values.length === 0) return undefined;

    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      count,
      sum,
      min: sorted[0],
      max: sorted[count - 1],
      avg: sum / count,
      p50: sorted[Math.floor(count * 0.5)],
      p95: sorted[Math.floor(count * 0.95)],
      p99: sorted[Math.floor(count * 0.99)],
    };
  }

  snapshot(): {
    counters: Record<string, number>;
    gauges: Record<string, number>;
    histograms: Record<string, MetricHistogram>;
  } {
    const histogramSnapshots: Record<string, MetricHistogram> = {};
    
    for (const key of Array.from(this.histograms.keys())) {
      const h = this.getHistogram(key);
      if (h) histogramSnapshots[key] = h;
    }

    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: histogramSnapshots,
    };
  }

  clear(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

export const globalMetrics = new InMemoryMetrics();
