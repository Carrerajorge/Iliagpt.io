import { z } from "zod";
import * as fs from "fs";
import * as v8 from "v8";
import { EventEmitter } from "events";

export const PhaseType = z.enum(["search", "fetch", "browser", "extract", "filter"]);
export type PhaseType = z.infer<typeof PhaseType>;

export const ErrorCategory = z.enum([
  "timeout",
  "rate_limit",
  "network",
  "forbidden",
  "not_found",
  "memory",
  "cancelled",
  "unknown",
]);
export type ErrorCategory = z.infer<typeof ErrorCategory>;

export const PhaseSampleSchema = z.object({
  timestamp: z.number(),
  phase: PhaseType,
  durationMs: z.number(),
  success: z.boolean(),
  errorCategory: ErrorCategory.optional(),
  usedBrowser: z.boolean().default(false),
  cacheHit: z.boolean().default(false),
});
export type PhaseSample = z.infer<typeof PhaseSampleSchema>;

export const PercentilesSchema = z.object({
  p50: z.number(),
  p95: z.number(),
  p99: z.number(),
  avg: z.number(),
  count: z.number(),
  min: z.number(),
  max: z.number(),
});
export type Percentiles = z.infer<typeof PercentilesSchema>;

export const ResourceSampleSchema = z.object({
  timestamp: z.number(),
  heapUsedMb: z.number(),
  heapTotalMb: z.number(),
  externalMb: z.number(),
  rssMb: z.number(),
  fdCount: z.number(),
});
export type ResourceSample = z.infer<typeof ResourceSampleSchema>;

export const ResourceReportSchema = z.object({
  current: ResourceSampleSchema,
  growthRates: z.object({
    heapMbPerMinute: z.number(),
    rssMbPerMinute: z.number(),
    fdPerMinute: z.number(),
  }),
  limits: z.object({
    heapLimitMb: z.number(),
    heapUsagePercent: z.number(),
  }),
  warnings: z.array(z.string()),
  leakDetected: z.boolean(),
  sampleCount: z.number(),
  windowMs: z.number(),
});
export type ResourceReport = z.infer<typeof ResourceReportSchema>;

export const ErrorTaxonomySchema = z.record(ErrorCategory, z.number());
export type ErrorTaxonomy = z.infer<typeof ErrorTaxonomySchema>;

export const V2MetricsExportSchema = z.object({
  exportedAt: z.number(),
  windowMs: z.number(),
  phases: z.record(PhaseType, PercentilesSchema),
  browserRatio: z.number(),
  cacheHitRate: z.number(),
  errorTaxonomy: ErrorTaxonomySchema,
  resourceReport: ResourceReportSchema,
  totalSamples: z.number(),
  successRate: z.number(),
});
export type V2MetricsExport = z.infer<typeof V2MetricsExportSchema>;

export interface V2MetricsCollectorOptions {
  maxSamples: number;
  defaultWindowMs: number;
  resourceSampleIntervalMs: number;
  heapGrowthThresholdMbPerMinute: number;
  heapWarningThresholdPercent: number;
  fdWarningThreshold: number;
}

const DEFAULT_OPTIONS: V2MetricsCollectorOptions = {
  maxSamples: 10000,
  defaultWindowMs: 3600000,
  resourceSampleIntervalMs: 1000,
  heapGrowthThresholdMbPerMinute: 50,
  heapWarningThresholdPercent: 85,
  fdWarningThreshold: 900,
};

export class ResourceSampler extends EventEmitter {
  private samples: ResourceSample[] = [];
  private intervalHandle: NodeJS.Timeout | null = null;
  private maxSamples: number;
  private intervalMs: number;
  private heapGrowthThreshold: number;
  private heapWarningThreshold: number;
  private fdWarningThreshold: number;
  private isLinux: boolean;

  constructor(options: Partial<{
    maxSamples: number;
    intervalMs: number;
    heapGrowthThresholdMbPerMinute: number;
    heapWarningThresholdPercent: number;
    fdWarningThreshold: number;
  }> = {}) {
    super();
    this.maxSamples = options.maxSamples ?? 3600;
    this.intervalMs = options.intervalMs ?? 1000;
    this.heapGrowthThreshold = options.heapGrowthThresholdMbPerMinute ?? 50;
    this.heapWarningThreshold = options.heapWarningThresholdPercent ?? 85;
    this.fdWarningThreshold = options.fdWarningThreshold ?? 900;
    this.isLinux = process.platform === "linux";
  }

  start(): void {
    if (this.intervalHandle) return;
    
    this.sample();
    this.intervalHandle = setInterval(() => this.sample(), this.intervalMs);
    this.intervalHandle.unref();
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  sample(): ResourceSample {
    const memUsage = process.memoryUsage();
    const now = Date.now();
    
    let fdCount = 0;
    if (this.isLinux) {
      try {
        fdCount = fs.readdirSync("/proc/self/fd").length;
      } catch {
        fdCount = -1;
      }
    }

    const sample: ResourceSample = {
      timestamp: now,
      heapUsedMb: memUsage.heapUsed / (1024 * 1024),
      heapTotalMb: memUsage.heapTotal / (1024 * 1024),
      externalMb: memUsage.external / (1024 * 1024),
      rssMb: memUsage.rss / (1024 * 1024),
      fdCount,
    };

    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    this.checkWarnings(sample);
    return sample;
  }

  private checkWarnings(sample: ResourceSample): void {
    const warnings: string[] = [];
    const heapStats = v8.getHeapStatistics();
    const heapLimitMb = heapStats.heap_size_limit / (1024 * 1024);
    const usagePercent = (sample.heapUsedMb / heapLimitMb) * 100;

    if (usagePercent >= this.heapWarningThreshold) {
      const msg = `Heap usage at ${usagePercent.toFixed(1)}% (${sample.heapUsedMb.toFixed(1)}MB / ${heapLimitMb.toFixed(1)}MB)`;
      warnings.push(msg);
      this.emit("warning", { type: "heap_high", message: msg, sample });
    }

    if (sample.fdCount > 0 && sample.fdCount >= this.fdWarningThreshold) {
      const msg = `File descriptor count at ${sample.fdCount}`;
      warnings.push(msg);
      this.emit("warning", { type: "fd_high", message: msg, sample });
    }

    const growthRate = this.calculateGrowthRate("heapUsedMb", 60000);
    if (growthRate > this.heapGrowthThreshold) {
      const msg = `Heap growing at ${growthRate.toFixed(2)}MB/min - potential leak`;
      warnings.push(msg);
      this.emit("warning", { type: "heap_leak", message: msg, sample, growthRate });
    }
  }

  calculateGrowthRate(field: keyof ResourceSample, windowMs: number): number {
    if (this.samples.length < 2) return 0;
    
    const now = Date.now();
    const windowStart = now - windowMs;
    const windowSamples = this.samples.filter(s => s.timestamp >= windowStart);
    
    if (windowSamples.length < 2) return 0;
    
    const first = windowSamples[0];
    const last = windowSamples[windowSamples.length - 1];
    const timeDiffMinutes = (last.timestamp - first.timestamp) / 60000;
    
    if (timeDiffMinutes <= 0) return 0;
    
    const valueDiff = (last[field] as number) - (first[field] as number);
    return valueDiff / timeDiffMinutes;
  }

  getReport(windowMs: number = 60000): ResourceReport {
    const current = this.samples.length > 0 
      ? this.samples[this.samples.length - 1]
      : this.sample();
    
    const heapStats = v8.getHeapStatistics();
    const heapLimitMb = heapStats.heap_size_limit / (1024 * 1024);
    
    const heapGrowth = this.calculateGrowthRate("heapUsedMb", windowMs);
    const rssGrowth = this.calculateGrowthRate("rssMb", windowMs);
    const fdGrowth = this.calculateGrowthRate("fdCount", windowMs);
    
    const warnings: string[] = [];
    const usagePercent = (current.heapUsedMb / heapLimitMb) * 100;
    
    if (usagePercent >= this.heapWarningThreshold) {
      warnings.push(`Heap usage at ${usagePercent.toFixed(1)}%`);
    }
    if (current.fdCount >= this.fdWarningThreshold) {
      warnings.push(`High FD count: ${current.fdCount}`);
    }
    
    const leakDetected = heapGrowth > this.heapGrowthThreshold;
    if (leakDetected) {
      warnings.push(`Potential memory leak: ${heapGrowth.toFixed(2)}MB/min growth`);
    }
    
    return {
      current,
      growthRates: {
        heapMbPerMinute: heapGrowth,
        rssMbPerMinute: rssGrowth,
        fdPerMinute: fdGrowth,
      },
      limits: {
        heapLimitMb,
        heapUsagePercent: usagePercent,
      },
      warnings,
      leakDetected,
      sampleCount: this.samples.length,
      windowMs,
    };
  }

  getSamples(): ResourceSample[] {
    return [...this.samples];
  }

  clear(): void {
    this.samples = [];
  }

  destroy(): void {
    this.stop();
    this.clear();
    this.removeAllListeners();
  }
}

export class V2MetricsCollector {
  private phaseSamples: PhaseSample[] = [];
  private errorCounts: Map<ErrorCategory, number> = new Map();
  private resourceSampler: ResourceSampler;
  private options: V2MetricsCollectorOptions;
  private lock = false;

  constructor(options: Partial<V2MetricsCollectorOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.resourceSampler = new ResourceSampler({
      intervalMs: this.options.resourceSampleIntervalMs,
      heapGrowthThresholdMbPerMinute: this.options.heapGrowthThresholdMbPerMinute,
      heapWarningThresholdPercent: this.options.heapWarningThresholdPercent,
      fdWarningThreshold: this.options.fdWarningThreshold,
    });
    
    for (const cat of ErrorCategory.options) {
      this.errorCounts.set(cat, 0);
    }
  }

  startResourceSampling(): void {
    this.resourceSampler.start();
  }

  stopResourceSampling(): void {
    this.resourceSampler.stop();
  }

  onResourceWarning(handler: (warning: { type: string; message: string; sample: ResourceSample }) => void): void {
    this.resourceSampler.on("warning", handler);
  }

  private async acquireLock(): Promise<void> {
    while (this.lock) {
      await new Promise(resolve => setImmediate(resolve));
    }
    this.lock = true;
  }

  private releaseLock(): void {
    this.lock = false;
  }

  async recordPhase(sample: Omit<PhaseSample, "timestamp">): Promise<void> {
    await this.acquireLock();
    try {
      const fullSample: PhaseSample = {
        ...sample,
        timestamp: Date.now(),
      };
      
      this.phaseSamples.push(fullSample);
      
      if (this.phaseSamples.length > this.options.maxSamples) {
        this.phaseSamples = this.phaseSamples.slice(-this.options.maxSamples);
      }
      
      if (!sample.success && sample.errorCategory) {
        const current = this.errorCounts.get(sample.errorCategory) || 0;
        this.errorCounts.set(sample.errorCategory, current + 1);
      }
    } finally {
      this.releaseLock();
    }
  }

  recordPhaseSync(sample: Omit<PhaseSample, "timestamp">): void {
    const fullSample: PhaseSample = {
      ...sample,
      timestamp: Date.now(),
    };
    
    this.phaseSamples.push(fullSample);
    
    if (this.phaseSamples.length > this.options.maxSamples) {
      this.phaseSamples = this.phaseSamples.slice(-this.options.maxSamples);
    }
    
    if (!sample.success && sample.errorCategory) {
      const current = this.errorCounts.get(sample.errorCategory) || 0;
      this.errorCounts.set(sample.errorCategory, current + 1);
    }
  }

  recordError(category: ErrorCategory): void {
    const current = this.errorCounts.get(category) || 0;
    this.errorCounts.set(category, current + 1);
  }

  getPercentiles(phase: PhaseType, windowMs?: number): Percentiles {
    const window = windowMs ?? this.options.defaultWindowMs;
    const now = Date.now();
    const cutoff = now - window;
    
    const samples = this.phaseSamples.filter(
      s => s.phase === phase && s.timestamp >= cutoff
    );
    
    if (samples.length === 0) {
      return { p50: 0, p95: 0, p99: 0, avg: 0, count: 0, min: 0, max: 0 };
    }
    
    const durations = samples.map(s => s.durationMs).sort((a, b) => a - b);
    const count = durations.length;
    const sum = durations.reduce((a, b) => a + b, 0);
    
    return {
      p50: this.percentile(durations, 50),
      p95: this.percentile(durations, 95),
      p99: this.percentile(durations, 99),
      avg: sum / count,
      count,
      min: durations[0],
      max: durations[count - 1],
    };
  }

  getAllPhasePercentiles(windowMs?: number): Record<PhaseType, Percentiles> {
    const result: Record<string, Percentiles> = {};
    for (const phase of PhaseType.options) {
      result[phase] = this.getPercentiles(phase, windowMs);
    }
    return result as Record<PhaseType, Percentiles>;
  }

  getBrowserRatio(windowMs?: number): number {
    const window = windowMs ?? this.options.defaultWindowMs;
    const now = Date.now();
    const cutoff = now - window;
    
    const samples = this.phaseSamples.filter(
      s => (s.phase === "fetch" || s.phase === "browser") && s.timestamp >= cutoff
    );
    
    if (samples.length === 0) return 0;
    
    const browserCount = samples.filter(s => s.usedBrowser).length;
    return browserCount / samples.length;
  }

  getCacheHitRate(windowMs?: number): number {
    const window = windowMs ?? this.options.defaultWindowMs;
    const now = Date.now();
    const cutoff = now - window;
    
    const samples = this.phaseSamples.filter(
      s => s.phase === "fetch" && s.timestamp >= cutoff
    );
    
    if (samples.length === 0) return 0;
    
    const cacheHits = samples.filter(s => s.cacheHit).length;
    return cacheHits / samples.length;
  }

  getErrorTaxonomy(): ErrorTaxonomy {
    const result: Record<string, number> = {};
    const entries = Array.from(this.errorCounts.entries());
    for (const [cat, count] of entries) {
      result[cat] = count;
    }
    return result as ErrorTaxonomy;
  }

  getResourceReport(windowMs?: number): ResourceReport {
    return this.resourceSampler.getReport(windowMs ?? 60000);
  }

  getSuccessRate(windowMs?: number): number {
    const window = windowMs ?? this.options.defaultWindowMs;
    const now = Date.now();
    const cutoff = now - window;
    
    const samples = this.phaseSamples.filter(s => s.timestamp >= cutoff);
    if (samples.length === 0) return 1;
    
    const successCount = samples.filter(s => s.success).length;
    return successCount / samples.length;
  }

  toJSON(windowMs?: number): V2MetricsExport {
    const window = windowMs ?? this.options.defaultWindowMs;
    
    return {
      exportedAt: Date.now(),
      windowMs: window,
      phases: this.getAllPhasePercentiles(window),
      browserRatio: this.getBrowserRatio(window),
      cacheHitRate: this.getCacheHitRate(window),
      errorTaxonomy: this.getErrorTaxonomy(),
      resourceReport: this.getResourceReport(),
      totalSamples: this.phaseSamples.length,
      successRate: this.getSuccessRate(window),
    };
  }

  toCSV(): string {
    const lines: string[] = [];
    
    lines.push("# Phase Samples");
    lines.push("timestamp,phase,durationMs,success,errorCategory,usedBrowser,cacheHit");
    for (const sample of this.phaseSamples) {
      lines.push([
        sample.timestamp,
        sample.phase,
        sample.durationMs.toFixed(2),
        sample.success ? "true" : "false",
        sample.errorCategory || "",
        sample.usedBrowser ? "true" : "false",
        sample.cacheHit ? "true" : "false",
      ].join(","));
    }
    
    lines.push("");
    lines.push("# Resource Samples");
    lines.push("timestamp,heapUsedMb,heapTotalMb,externalMb,rssMb,fdCount");
    for (const sample of this.resourceSampler.getSamples()) {
      lines.push([
        sample.timestamp,
        sample.heapUsedMb.toFixed(2),
        sample.heapTotalMb.toFixed(2),
        sample.externalMb.toFixed(2),
        sample.rssMb.toFixed(2),
        sample.fdCount,
      ].join(","));
    }
    
    lines.push("");
    lines.push("# Error Taxonomy");
    lines.push("category,count");
    const errorEntries = Array.from(this.errorCounts.entries());
    for (const [cat, count] of errorEntries) {
      lines.push(`${cat},${count}`);
    }
    
    return lines.join("\n");
  }

  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.ceil((p / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
  }

  clear(): void {
    this.phaseSamples = [];
    for (const cat of ErrorCategory.options) {
      this.errorCounts.set(cat, 0);
    }
    this.resourceSampler.clear();
  }

  destroy(): void {
    this.clear();
    this.resourceSampler.destroy();
  }

  getSampleCount(): number {
    return this.phaseSamples.length;
  }

  getResourceSampler(): ResourceSampler {
    return this.resourceSampler;
  }
}

export const v2MetricsCollector = new V2MetricsCollector();

export function categorizeError(error: Error | string): ErrorCategory {
  const message = typeof error === "string" ? error : error.message;
  const lowerMsg = message.toLowerCase();
  
  if (lowerMsg.includes("timeout") || lowerMsg.includes("timed out") || lowerMsg.includes("etimedout")) {
    return "timeout";
  }
  if (lowerMsg.includes("rate limit") || lowerMsg.includes("429") || lowerMsg.includes("too many requests")) {
    return "rate_limit";
  }
  if (lowerMsg.includes("econnrefused") || lowerMsg.includes("enotfound") || lowerMsg.includes("network") || 
      lowerMsg.includes("socket") || lowerMsg.includes("connection")) {
    return "network";
  }
  if (lowerMsg.includes("403") || lowerMsg.includes("forbidden") || lowerMsg.includes("access denied")) {
    return "forbidden";
  }
  if (lowerMsg.includes("404") || lowerMsg.includes("not found")) {
    return "not_found";
  }
  if (lowerMsg.includes("memory") || lowerMsg.includes("heap") || lowerMsg.includes("allocation")) {
    return "memory";
  }
  if (lowerMsg.includes("abort") || lowerMsg.includes("cancel")) {
    return "cancelled";
  }
  
  return "unknown";
}
