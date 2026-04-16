import { z } from "zod";
import { EventEmitter } from "events";
import * as fs from "fs";
import { browserWorker } from "../../browser-worker";

export const LeakThresholdsSchema = z.object({
  heapGrowthRateMbPerMin: z.number().default(10),
  maxFdCount: z.number().default(1024),
  maxBrowserContexts: z.number().default(5),
  maxBrowserPages: z.number().default(20),
});
export type LeakThresholds = z.infer<typeof LeakThresholdsSchema>;

export const LeakMetricsSchema = z.object({
  timestamp: z.number(),
  heapUsedMb: z.number(),
  heapTotalMb: z.number(),
  heapGrowthRateMbPerMin: z.number(),
  fdCount: z.number(),
  browserContextCount: z.number(),
  browserPageCount: z.number(),
  isLeaking: z.boolean(),
  warnings: z.array(z.string()),
});
export type LeakMetrics = z.infer<typeof LeakMetricsSchema>;

export const LeakEventTypeSchema = z.enum(["leak_detected", "warning", "recovered"]);
export type LeakEventType = z.infer<typeof LeakEventTypeSchema>;

export const LeakEventSchema = z.object({
  type: LeakEventTypeSchema,
  timestamp: z.number(),
  metrics: LeakMetricsSchema,
  message: z.string(),
});
export type LeakEvent = z.infer<typeof LeakEventSchema>;

export interface LeakDetectorOptions {
  thresholds: Partial<LeakThresholds>;
  sampleWindowMs: number;
  minSamplesForDetection: number;
}

const DEFAULT_LEAK_DETECTOR_OPTIONS: LeakDetectorOptions = {
  thresholds: {},
  sampleWindowMs: 60000,
  minSamplesForDetection: 5,
};

interface HeapSample {
  timestamp: number;
  heapUsedMb: number;
}

export class LeakDetector extends EventEmitter {
  private thresholds: LeakThresholds;
  private intervalHandle: NodeJS.Timeout | null = null;
  private heapSamples: HeapSample[] = [];
  private sampleWindowMs: number;
  private minSamplesForDetection: number;
  private wasLeaking: boolean = false;
  private isLinux: boolean;

  constructor(options: Partial<LeakDetectorOptions> = {}) {
    super();
    const opts = { ...DEFAULT_LEAK_DETECTOR_OPTIONS, ...options };
    this.thresholds = LeakThresholdsSchema.parse(opts.thresholds);
    this.sampleWindowMs = opts.sampleWindowMs;
    this.minSamplesForDetection = opts.minSamplesForDetection;
    this.isLinux = process.platform === "linux";
  }

  start(intervalMs: number = 1000): void {
    if (this.intervalHandle) return;
    
    this.sample();
    this.intervalHandle = setInterval(() => {
      this.sample();
      this.checkForLeaks();
    }, intervalMs);
    this.intervalHandle.unref();
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private sample(): void {
    const memUsage = process.memoryUsage();
    const now = Date.now();
    
    this.heapSamples.push({
      timestamp: now,
      heapUsedMb: memUsage.heapUsed / (1024 * 1024),
    });

    const cutoff = now - this.sampleWindowMs;
    this.heapSamples = this.heapSamples.filter(s => s.timestamp >= cutoff);
  }

  private calculateHeapGrowthRate(): number {
    if (this.heapSamples.length < 2) return 0;
    
    const first = this.heapSamples[0];
    const last = this.heapSamples[this.heapSamples.length - 1];
    const timeDiffMinutes = (last.timestamp - first.timestamp) / 60000;
    
    if (timeDiffMinutes <= 0) return 0;
    
    return (last.heapUsedMb - first.heapUsedMb) / timeDiffMinutes;
  }

  private getFdCount(): number {
    if (!this.isLinux) return -1;
    
    try {
      return fs.readdirSync("/proc/self/fd").length;
    } catch {
      return -1;
    }
  }

  private getBrowserCounts(): { contexts: number; pages: number } {
    try {
      const sessionCount = browserWorker.getSessionCount();
      return {
        contexts: sessionCount,
        pages: sessionCount,
      };
    } catch {
      return { contexts: 0, pages: 0 };
    }
  }

  getCurrentMetrics(): LeakMetrics {
    const memUsage = process.memoryUsage();
    const heapGrowthRate = this.calculateHeapGrowthRate();
    const fdCount = this.getFdCount();
    const browserCounts = this.getBrowserCounts();
    
    const warnings: string[] = [];
    let isLeaking = false;

    if (this.heapSamples.length >= this.minSamplesForDetection) {
      if (heapGrowthRate > this.thresholds.heapGrowthRateMbPerMin) {
        warnings.push(`Heap growing at ${heapGrowthRate.toFixed(2)}MB/min (threshold: ${this.thresholds.heapGrowthRateMbPerMin})`);
        isLeaking = true;
      }
    }

    if (fdCount >= 0 && fdCount > this.thresholds.maxFdCount) {
      warnings.push(`FD count ${fdCount} exceeds threshold ${this.thresholds.maxFdCount}`);
      isLeaking = true;
    }

    if (browserCounts.contexts > this.thresholds.maxBrowserContexts) {
      warnings.push(`Browser contexts ${browserCounts.contexts} exceeds threshold ${this.thresholds.maxBrowserContexts}`);
      isLeaking = true;
    }

    if (browserCounts.pages > this.thresholds.maxBrowserPages) {
      warnings.push(`Browser pages ${browserCounts.pages} exceeds threshold ${this.thresholds.maxBrowserPages}`);
      isLeaking = true;
    }

    return {
      timestamp: Date.now(),
      heapUsedMb: memUsage.heapUsed / (1024 * 1024),
      heapTotalMb: memUsage.heapTotal / (1024 * 1024),
      heapGrowthRateMbPerMin: heapGrowthRate,
      fdCount,
      browserContextCount: browserCounts.contexts,
      browserPageCount: browserCounts.pages,
      isLeaking,
      warnings,
    };
  }

  isLeaking(): boolean {
    return this.getCurrentMetrics().isLeaking;
  }

  private checkForLeaks(): void {
    const metrics = this.getCurrentMetrics();
    
    if (metrics.isLeaking && !this.wasLeaking) {
      const event: LeakEvent = {
        type: "leak_detected",
        timestamp: Date.now(),
        metrics,
        message: `Leak detected: ${metrics.warnings.join("; ")}`,
      };
      this.emit("leak_detected", event);
      this.wasLeaking = true;
    } else if (!metrics.isLeaking && this.wasLeaking) {
      const event: LeakEvent = {
        type: "recovered",
        timestamp: Date.now(),
        metrics,
        message: "System recovered from leak state",
      };
      this.emit("recovered", event);
      this.wasLeaking = false;
    } else if (metrics.warnings.length > 0 && !metrics.isLeaking) {
      const event: LeakEvent = {
        type: "warning",
        timestamp: Date.now(),
        metrics,
        message: `Warning: ${metrics.warnings.join("; ")}`,
      };
      this.emit("warning", event);
    }
  }

  destroy(): void {
    this.stop();
    this.heapSamples = [];
    this.removeAllListeners();
  }
}

export const WatchdogContextStateSchema = z.enum(["active", "stale", "closing"]);
export type WatchdogContextState = z.infer<typeof WatchdogContextStateSchema>;

export const WatchdogContextInfoSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  lastActivityAt: z.number(),
  state: WatchdogContextStateSchema,
  memoryMb: z.number().optional(),
});
export type WatchdogContextInfo = z.infer<typeof WatchdogContextInfoSchema>;

export const BrowserWatchdogConfigSchema = z.object({
  staleTimeoutMs: z.number().default(60000),
  memoryThresholdMb: z.number().default(512),
  checkIntervalMs: z.number().default(5000),
  maxContexts: z.number().default(10),
});
export type BrowserWatchdogConfig = z.infer<typeof BrowserWatchdogConfigSchema>;

export const WatchdogEventTypeSchema = z.enum(["context_closed", "context_restarted"]);
export type WatchdogEventType = z.infer<typeof WatchdogEventTypeSchema>;

export const WatchdogEventSchema = z.object({
  type: WatchdogEventTypeSchema,
  contextId: z.string(),
  reason: z.string(),
  timestamp: z.number(),
});
export type WatchdogEvent = z.infer<typeof WatchdogEventSchema>;

interface ManagedContext {
  id: string;
  context: unknown;
  createdAt: number;
  lastActivityAt: number;
  state: WatchdogContextState;
}

export class BrowserWatchdog extends EventEmitter {
  private contexts: Map<string, ManagedContext> = new Map();
  private config: BrowserWatchdogConfig;
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(config: Partial<BrowserWatchdogConfig> = {}) {
    super();
    this.config = BrowserWatchdogConfigSchema.parse(config);
  }

  start(): void {
    if (this.intervalHandle) return;
    
    this.intervalHandle = setInterval(() => {
      this.checkContextHealth();
    }, this.config.checkIntervalMs);
    this.intervalHandle.unref();
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  registerContext(id: string, context: unknown): void {
    const now = Date.now();
    this.contexts.set(id, {
      id,
      context,
      createdAt: now,
      lastActivityAt: now,
      state: "active",
    });
  }

  deregisterContext(id: string): void {
    this.contexts.delete(id);
  }

  recordActivity(id: string): void {
    const ctx = this.contexts.get(id);
    if (ctx) {
      ctx.lastActivityAt = Date.now();
      ctx.state = "active";
    }
  }

  getActiveContextCount(): number {
    return Array.from(this.contexts.values())
      .filter(c => c.state === "active")
      .length;
  }

  getContextInfo(id: string): WatchdogContextInfo | null {
    const ctx = this.contexts.get(id);
    if (!ctx) return null;
    
    return {
      id: ctx.id,
      createdAt: ctx.createdAt,
      lastActivityAt: ctx.lastActivityAt,
      state: ctx.state,
    };
  }

  getAllContextInfo(): WatchdogContextInfo[] {
    return Array.from(this.contexts.values()).map(ctx => ({
      id: ctx.id,
      createdAt: ctx.createdAt,
      lastActivityAt: ctx.lastActivityAt,
      state: ctx.state,
    }));
  }

  private async checkContextHealth(): Promise<void> {
    const now = Date.now();
    const staleThreshold = now - this.config.staleTimeoutMs;
    
    const entries = Array.from(this.contexts.entries());
    for (const [id, ctx] of entries) {
      if (ctx.state === "closing") continue;
      
      if (ctx.lastActivityAt < staleThreshold) {
        ctx.state = "stale";
        await this.closeContext(id, "stale timeout exceeded");
      }
    }

    if (this.contexts.size > this.config.maxContexts) {
      const sorted = Array.from(this.contexts.entries())
        .filter(([, c]) => c.state !== "closing")
        .sort((a, b) => a[1].lastActivityAt - b[1].lastActivityAt);
      
      const toClose = sorted.slice(0, this.contexts.size - this.config.maxContexts);
      for (const [id] of toClose) {
        await this.closeContext(id, "max contexts exceeded");
      }
    }
  }

  private async closeContext(id: string, reason: string): Promise<void> {
    const ctx = this.contexts.get(id);
    if (!ctx || ctx.state === "closing") return;
    
    ctx.state = "closing";
    
    try {
      const context = ctx.context as { close?: () => Promise<void> };
      if (context && typeof context.close === "function") {
        await context.close();
      }
    } catch (error) {
      console.warn(`[BrowserWatchdog] Error closing context ${id}:`, error);
    }
    
    this.contexts.delete(id);
    
    const event: WatchdogEvent = {
      type: "context_closed",
      contextId: id,
      reason,
      timestamp: Date.now(),
    };
    this.emit("context_closed", event);
  }

  async forceCleanup(): Promise<void> {
    const contextIds = Array.from(this.contexts.keys());
    await Promise.all(
      contextIds.map(id => this.closeContext(id, "force cleanup"))
    );
  }

  async restartContext(id: string, newContext: unknown): Promise<void> {
    const oldCtx = this.contexts.get(id);
    if (oldCtx) {
      await this.closeContext(id, "restart requested");
    }
    
    this.registerContext(id, newContext);
    
    const event: WatchdogEvent = {
      type: "context_restarted",
      contextId: id,
      reason: "manual restart",
      timestamp: Date.now(),
    };
    this.emit("context_restarted", event);
  }

  destroy(): void {
    this.stop();
    this.contexts.clear();
    this.removeAllListeners();
  }
}

export const HungWorkerSchema = z.object({
  id: z.string(),
  lastHeartbeatAt: z.number(),
  hungDurationMs: z.number(),
  retryCount: z.number(),
});
export type HungWorker = z.infer<typeof HungWorkerSchema>;

export const WorkerStateSchema = z.enum(["healthy", "hung", "recovering", "dropped"]);
export type WorkerState = z.infer<typeof WorkerStateSchema>;

export const WorkerRecoveryConfigSchema = z.object({
  hungTimeoutMs: z.number().default(30000),
  maxRetries: z.number().default(3),
  checkIntervalMs: z.number().default(5000),
  backoffBaseMs: z.number().default(1000),
  backoffMultiplier: z.number().default(2),
  backoffMaxMs: z.number().default(30000),
});
export type WorkerRecoveryConfig = z.infer<typeof WorkerRecoveryConfigSchema>;

export const WorkerInfoSchema = z.object({
  id: z.string(),
  registeredAt: z.number(),
  lastHeartbeatAt: z.number(),
  state: WorkerStateSchema,
  retryCount: z.number(),
  pendingRequests: z.number(),
});
export type WorkerInfo = z.infer<typeof WorkerInfoSchema>;

interface ManagedWorker {
  id: string;
  registeredAt: number;
  lastHeartbeatAt: number;
  state: WorkerState;
  retryCount: number;
  pendingRequests: Set<string>;
  onRecover?: () => Promise<void>;
}

interface QueuedRequest {
  id: string;
  workerId: string;
  queuedAt: number;
  retryCount: number;
  execute: () => Promise<void>;
}

export class WorkerRecovery extends EventEmitter {
  private workers: Map<string, ManagedWorker> = new Map();
  private requestQueue: QueuedRequest[] = [];
  private config: WorkerRecoveryConfig;
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(config: Partial<WorkerRecoveryConfig> = {}) {
    super();
    this.config = WorkerRecoveryConfigSchema.parse(config);
  }

  start(): void {
    if (this.intervalHandle) return;
    
    this.intervalHandle = setInterval(() => {
      this.checkWorkerHealth();
      this.processQueue();
    }, this.config.checkIntervalMs);
    this.intervalHandle.unref();
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  registerWorker(id: string, onRecover?: () => Promise<void>): void {
    const now = Date.now();
    this.workers.set(id, {
      id,
      registeredAt: now,
      lastHeartbeatAt: now,
      state: "healthy",
      retryCount: 0,
      pendingRequests: new Set(),
      onRecover,
    });
  }

  deregisterWorker(id: string): void {
    this.workers.delete(id);
    this.requestQueue = this.requestQueue.filter(r => r.workerId !== id);
  }

  workerHeartbeat(id: string): void {
    const worker = this.workers.get(id);
    if (worker) {
      worker.lastHeartbeatAt = Date.now();
      if (worker.state === "hung" || worker.state === "recovering") {
        worker.state = "healthy";
        worker.retryCount = 0;
        this.emit("worker_recovered", { id, timestamp: Date.now() });
      }
    }
  }

  addPendingRequest(workerId: string, requestId: string): void {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.pendingRequests.add(requestId);
    }
  }

  removePendingRequest(workerId: string, requestId: string): void {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.pendingRequests.delete(requestId);
    }
  }

  checkWorkerHealth(): HungWorker[] {
    const now = Date.now();
    const hungWorkers: HungWorker[] = [];
    
    const workerEntries = Array.from(this.workers.entries());
    for (const [id, worker] of workerEntries) {
      if (worker.state === "dropped") continue;
      
      const hungDuration = now - worker.lastHeartbeatAt;
      if (hungDuration > this.config.hungTimeoutMs) {
        if (worker.state !== "hung" && worker.state !== "recovering") {
          worker.state = "hung";
          this.emit("worker_hung", { id, hungDurationMs: hungDuration });
        }
        
        hungWorkers.push({
          id: worker.id,
          lastHeartbeatAt: worker.lastHeartbeatAt,
          hungDurationMs: hungDuration,
          retryCount: worker.retryCount,
        });
      }
    }
    
    return hungWorkers;
  }

  async recoverHungWorker(id: string): Promise<void> {
    const worker = this.workers.get(id);
    if (!worker) return;
    
    if (worker.retryCount >= this.config.maxRetries) {
      worker.state = "dropped";
      this.emit("worker_dropped", { 
        id, 
        reason: "max retries exceeded",
        retryCount: worker.retryCount 
      });
      return;
    }
    
    worker.state = "recovering";
    worker.retryCount++;
    
    const backoffMs = Math.min(
      this.config.backoffBaseMs * Math.pow(this.config.backoffMultiplier, worker.retryCount - 1),
      this.config.backoffMaxMs
    );
    
    await this.sleep(backoffMs);
    
    if (worker.onRecover) {
      try {
        await worker.onRecover();
        worker.lastHeartbeatAt = Date.now();
        worker.state = "healthy";
        this.emit("worker_recovered", { id, timestamp: Date.now() });
      } catch (error) {
        this.emit("recovery_failed", { id, error, retryCount: worker.retryCount });
      }
    }
  }

  queueRequest(
    workerId: string, 
    requestId: string, 
    execute: () => Promise<void>
  ): void {
    this.requestQueue.push({
      id: requestId,
      workerId,
      queuedAt: Date.now(),
      retryCount: 0,
      execute,
    });
  }

  private async processQueue(): Promise<void> {
    const toProcess = [...this.requestQueue];
    this.requestQueue = [];
    
    for (const request of toProcess) {
      const worker = this.workers.get(request.workerId);
      
      if (!worker || worker.state === "dropped") {
        this.emit("request_dropped", { 
          requestId: request.id, 
          workerId: request.workerId,
          reason: worker ? "worker dropped" : "worker not found"
        });
        continue;
      }
      
      if (worker.state !== "healthy") {
        if (request.retryCount < this.config.maxRetries) {
          request.retryCount++;
          this.requestQueue.push(request);
        } else {
          this.emit("request_dropped", {
            requestId: request.id,
            workerId: request.workerId,
            reason: "max retries exceeded"
          });
        }
        continue;
      }
      
      try {
        await request.execute();
      } catch (error) {
        if (request.retryCount < this.config.maxRetries) {
          request.retryCount++;
          this.requestQueue.push(request);
        } else {
          this.emit("request_failed", {
            requestId: request.id,
            workerId: request.workerId,
            error
          });
        }
      }
    }
  }

  getWorkerInfo(id: string): WorkerInfo | null {
    const worker = this.workers.get(id);
    if (!worker) return null;
    
    return {
      id: worker.id,
      registeredAt: worker.registeredAt,
      lastHeartbeatAt: worker.lastHeartbeatAt,
      state: worker.state,
      retryCount: worker.retryCount,
      pendingRequests: worker.pendingRequests.size,
    };
  }

  getAllWorkerInfo(): WorkerInfo[] {
    return Array.from(this.workers.values()).map(w => ({
      id: w.id,
      registeredAt: w.registeredAt,
      lastHeartbeatAt: w.lastHeartbeatAt,
      state: w.state,
      retryCount: w.retryCount,
      pendingRequests: w.pendingRequests.size,
    }));
  }

  getPendingRequestCount(): number {
    return this.requestQueue.length;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  destroy(): void {
    this.stop();
    this.workers.clear();
    this.requestQueue = [];
    this.removeAllListeners();
  }
}

export const CleanupEntrySchema = z.object({
  correlationId: z.string(),
  registeredAt: z.number(),
  description: z.string().optional(),
});
export type CleanupEntry = z.infer<typeof CleanupEntrySchema>;

export const CleanupResultSchema = z.object({
  correlationId: z.string(),
  success: z.boolean(),
  durationMs: z.number(),
  error: z.string().optional(),
});
export type CleanupResult = z.infer<typeof CleanupResultSchema>;

type CleanupFn = () => Promise<void> | void;

interface RegisteredCleanup {
  correlationId: string;
  fn: CleanupFn;
  registeredAt: number;
  description?: string;
}

export class CleanupRegistry {
  private static instance: CleanupRegistry | null = null;
  private cleanups: Map<string, RegisteredCleanup[]> = new Map();
  private running: Set<string> = new Set();

  private constructor() {}

  static getInstance(): CleanupRegistry {
    if (!CleanupRegistry.instance) {
      CleanupRegistry.instance = new CleanupRegistry();
    }
    return CleanupRegistry.instance;
  }

  static resetInstance(): void {
    if (CleanupRegistry.instance) {
      CleanupRegistry.instance.cleanups.clear();
      CleanupRegistry.instance.running.clear();
    }
    CleanupRegistry.instance = null;
  }

  register(correlationId: string, cleanupFn: CleanupFn, description?: string): void {
    const existing = this.cleanups.get(correlationId) || [];
    existing.push({
      correlationId,
      fn: cleanupFn,
      registeredAt: Date.now(),
      description,
    });
    this.cleanups.set(correlationId, existing);
  }

  async cleanup(correlationId: string): Promise<CleanupResult[]> {
    const entries = this.cleanups.get(correlationId);
    if (!entries || entries.length === 0) {
      return [];
    }

    if (this.running.has(correlationId)) {
      return [];
    }

    this.running.add(correlationId);
    const results: CleanupResult[] = [];

    try {
      for (const entry of entries.reverse()) {
        const startTime = Date.now();
        try {
          await entry.fn();
          results.push({
            correlationId: entry.correlationId,
            success: true,
            durationMs: Date.now() - startTime,
          });
        } catch (error) {
          results.push({
            correlationId: entry.correlationId,
            success: false,
            durationMs: Date.now() - startTime,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      this.cleanups.delete(correlationId);
      this.running.delete(correlationId);
    }

    return results;
  }

  async cleanupAll(): Promise<CleanupResult[]> {
    const allCorrelationIds = Array.from(this.cleanups.keys());
    const allResults: CleanupResult[] = [];

    for (const correlationId of allCorrelationIds) {
      const results = await this.cleanup(correlationId);
      allResults.push(...results);
    }

    return allResults;
  }

  getPendingCleanups(): number {
    let count = 0;
    const values = Array.from(this.cleanups.values());
    for (const entries of values) {
      count += entries.length;
    }
    return count;
  }

  getCorrelationIds(): string[] {
    return Array.from(this.cleanups.keys());
  }

  getCleanupInfo(): CleanupEntry[] {
    const entries: CleanupEntry[] = [];
    const cleanupEntries = Array.from(this.cleanups.entries());
    for (const [correlationId, cleanupList] of cleanupEntries) {
      for (const cleanup of cleanupList) {
        entries.push({
          correlationId,
          registeredAt: cleanup.registeredAt,
          description: cleanup.description,
        });
      }
    }
    return entries;
  }

  has(correlationId: string): boolean {
    return this.cleanups.has(correlationId);
  }

  isRunning(correlationId: string): boolean {
    return this.running.has(correlationId);
  }

  clear(): void {
    this.cleanups.clear();
    this.running.clear();
  }
}

export const leakDetector = new LeakDetector();
export const browserWatchdog = new BrowserWatchdog();
export const workerRecovery = new WorkerRecovery();
export const cleanupRegistry = CleanupRegistry.getInstance();
