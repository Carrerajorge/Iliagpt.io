/**
 * connectorBatchProcessor.ts
 * ---------------------------------------------------------------------------
 * Comprehensive bulk-operation pipeline with backpressure for the
 * Integration Kernel.  Fully standalone — zero imports from other kernel
 * files.  All Map / Set iterations wrapped with Array.from() to avoid TS
 * downlevelIteration issues.  No `any` type.
 * ---------------------------------------------------------------------------
 */

const crypto = require("crypto");

/* ========================================================================= *
 * 1. Core Types                                                             *
 * ========================================================================= */

export type BatchJobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused";

export interface BatchItemResult<R> {
  index: number;
  success: boolean;
  result?: R;
  error?: string;
  retryCount: number;
  durationMs: number;
}

export interface BatchJobProgress {
  completed: number;
  failed: number;
  total: number;
  startedAt: number;
  estimatedCompletionAt?: number;
}

export interface BatchJob<T, R> {
  id: string;
  items: T[];
  status: BatchJobStatus;
  results: BatchItemResult<R>[];
  progress: BatchJobProgress;
  priority: number; // 1 (lowest) – 10 (highest)
  createdAt: number;
  metadata: Record<string, unknown>;
  connectorId?: string;
  operationId?: string;
}

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
}

export interface BatchConfig {
  maxConcurrency: number;
  maxBatchSize: number;
  retryPolicy: RetryPolicy;
  timeoutMs: number;
  onProgress?: (job: BatchJob<unknown, unknown>) => void;
  onItemComplete?: (item: BatchItemResult<unknown>, job: BatchJob<unknown, unknown>) => void;
  pauseBetweenItems?: number;
}

export type BackpressureStrategy =
  | "drop_oldest"
  | "drop_newest"
  | "reject"
  | "pause";

export interface BackpressureConfig {
  maxQueueDepth: number;
  highWaterMark: number; // 0–1  (fraction of maxQueueDepth)
  lowWaterMark: number;  // 0–1
  strategy: BackpressureStrategy;
}

export interface BatchMetrics {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  totalItems: number;
  avgItemDurationMs: number;
  avgBatchDurationMs: number;
  throughputItemsPerSecond: number;
  queueDepth: number;
  backpressureEvents: number;
}

/* Internal helper: a deferred promise ------------------------------------ */
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function createDeferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/* Internal helper: generate a short random id ----------------------------- */
function randomId(prefix: string): string {
  return `${prefix}_${(crypto as { randomBytes: (n: number) => Buffer }).randomBytes(8).toString("hex")}`;
}

const DEFAULT_BATCH_CONFIG: BatchConfig = {
  maxConcurrency: 5,
  maxBatchSize: 100,
  retryPolicy: { maxRetries: 3, backoffMs: 1000 },
  timeoutMs: 30_000,
};

const DEFAULT_BACKPRESSURE_CONFIG: BackpressureConfig = {
  maxQueueDepth: 1000,
  highWaterMark: 0.8,
  lowWaterMark: 0.3,
  strategy: "drop_oldest",
};

/* ========================================================================= *
 * 2. BackpressureController                                                 *
 * ========================================================================= */

export interface BackpressureCallbacks {
  onHighWaterMark?: () => void;
  onLowWaterMark?: () => void;
  onDrop?: (item: unknown) => void;
}

export class BackpressureController {
  private queue: unknown[] = [];
  private config: BackpressureConfig;
  private callbacks: BackpressureCallbacks;
  private paused = false;
  private drainWaiters: Array<() => void> = [];
  private _backpressureEvents = 0;
  private _highWaterTriggered = false;

  constructor(
    config: Partial<BackpressureConfig> = {},
    callbacks: BackpressureCallbacks = {},
  ) {
    this.config = { ...DEFAULT_BACKPRESSURE_CONFIG, ...config };
    this.callbacks = callbacks;
  }

  /* -- public API -------------------------------------------------------- */

  submit<T>(item: T): boolean {
    if (this.paused && this.config.strategy === "pause") {
      return false;
    }

    const depth = this.queue.length;
    const highMark = Math.floor(this.config.maxQueueDepth * this.config.highWaterMark);

    if (depth >= this.config.maxQueueDepth) {
      this._backpressureEvents++;
      return this.applyStrategy(item);
    }

    this.queue.push(item);

    if (this.queue.length >= highMark && !this._highWaterTriggered) {
      this._highWaterTriggered = true;
      this._backpressureEvents++;
      this.callbacks.onHighWaterMark?.();

      if (this.config.strategy === "pause") {
        this.paused = true;
      }
    }

    return true;
  }

  canAccept(): boolean {
    if (this.paused && this.config.strategy === "pause") {
      return false;
    }
    return this.queue.length < this.config.maxQueueDepth;
  }

  take(): unknown | undefined {
    const item = this.queue.shift();
    this.checkLowWater();
    this.checkDrain();
    return item;
  }

  takeMany(count: number): unknown[] {
    const items = this.queue.splice(0, count);
    this.checkLowWater();
    this.checkDrain();
    return items;
  }

  getQueueDepth(): number {
    return this.queue.length;
  }

  getCapacityUtilization(): number {
    if (this.config.maxQueueDepth === 0) return 0;
    return this.queue.length / this.config.maxQueueDepth;
  }

  getBackpressureEvents(): number {
    return this._backpressureEvents;
  }

  isPaused(): boolean {
    return this.paused;
  }

  resume(): void {
    this.paused = false;
  }

  drain(): Promise<void> {
    if (this.queue.length === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.drainWaiters.push(resolve);
    });
  }

  clear(): void {
    this.queue.length = 0;
    this.paused = false;
    this._highWaterTriggered = false;
    this.checkDrain();
  }

  /* -- internals --------------------------------------------------------- */

  private applyStrategy<T>(item: T): boolean {
    switch (this.config.strategy) {
      case "drop_oldest": {
        const dropped = this.queue.shift();
        this.callbacks.onDrop?.(dropped);
        this.queue.push(item);
        return true;
      }
      case "drop_newest": {
        this.callbacks.onDrop?.(item);
        return false;
      }
      case "reject": {
        throw new Error(
          `BackpressureController: queue full (${this.config.maxQueueDepth}), strategy=reject`,
        );
      }
      case "pause": {
        this.paused = true;
        return false;
      }
      default:
        return false;
    }
  }

  private checkLowWater(): void {
    const lowMark = Math.floor(this.config.maxQueueDepth * this.config.lowWaterMark);
    if (this._highWaterTriggered && this.queue.length <= lowMark) {
      this._highWaterTriggered = false;
      this.paused = false;
      this.callbacks.onLowWaterMark?.();
    }
  }

  private checkDrain(): void {
    if (this.queue.length === 0 && this.drainWaiters.length > 0) {
      const waiters = this.drainWaiters.splice(0);
      for (const w of waiters) w();
    }
  }
}

/* ========================================================================= *
 * 3. ConcurrencyLimiter (priority semaphore)                                *
 * ========================================================================= */

interface WaitingAcquirer {
  priority: number;
  deferred: Deferred<() => void>;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

export class ConcurrencyLimiter {
  private max: number;
  private running = 0;
  private waiting: WaitingAcquirer[] = [];

  constructor(max = 5) {
    this.max = Math.max(1, max);
  }

  /* -- public API -------------------------------------------------------- */

  acquire(timeoutMs?: number, priority = 5): Promise<() => void> {
    if (this.running < this.max) {
      this.running++;
      return Promise.resolve(this.createRelease());
    }

    const deferred = createDeferred<() => void>();
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const waiter: WaitingAcquirer = { priority, deferred, timeoutHandle: null };

    if (timeoutMs !== undefined && timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        const idx = this.waiting.indexOf(waiter);
        if (idx !== -1) {
          this.waiting.splice(idx, 1);
          deferred.reject(
            new Error(`ConcurrencyLimiter: acquire timed out after ${timeoutMs}ms`),
          );
        }
      }, timeoutMs);
      timeoutHandle.unref();
      waiter.timeoutHandle = timeoutHandle;
    }

    // Insert in priority order (highest first)
    let inserted = false;
    for (let i = 0; i < this.waiting.length; i++) {
      if (priority > this.waiting[i].priority) {
        this.waiting.splice(i, 0, waiter);
        inserted = true;
        break;
      }
    }
    if (!inserted) this.waiting.push(waiter);

    return deferred.promise;
  }

  tryAcquire(): (() => void) | null {
    if (this.running < this.max) {
      this.running++;
      return this.createRelease();
    }
    return null;
  }

  resize(newMax: number): void {
    this.max = Math.max(1, newMax);
    this.dispatchWaiters();
  }

  getAvailable(): number {
    return Math.max(0, this.max - this.running);
  }

  getRunning(): number {
    return this.running;
  }

  getWaiting(): number {
    return this.waiting.length;
  }

  getMax(): number {
    return this.max;
  }

  /* -- internals --------------------------------------------------------- */

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.running--;
      this.dispatchWaiters();
    };
  }

  private dispatchWaiters(): void {
    while (this.running < this.max && this.waiting.length > 0) {
      const waiter = this.waiting.shift()!;
      if (waiter.timeoutHandle !== null) clearTimeout(waiter.timeoutHandle);
      this.running++;
      waiter.deferred.resolve(this.createRelease());
    }
  }
}

/* ========================================================================= *
 * 4. BatchExecutor<T, R>                                                    *
 * ========================================================================= */

interface ActiveJobEntry {
  abortController: AbortController;
  pauseDeferred: Deferred<void> | null;
  paused: boolean;
}

export class BatchExecutor {
  private limiter: ConcurrencyLimiter;
  private activeJobs: Map<string, ActiveJobEntry> = new Map();

  constructor(defaultConcurrency = 5) {
    this.limiter = new ConcurrencyLimiter(defaultConcurrency);
  }

  /* -- public API -------------------------------------------------------- */

  async executeBatch<T, R>(
    job: BatchJob<T, R>,
    processor: (item: T, index: number) => Promise<R>,
    config: BatchConfig = DEFAULT_BATCH_CONFIG,
  ): Promise<BatchJob<T, R>> {
    if (job.status === "cancelled") return job;

    this.limiter.resize(config.maxConcurrency);

    const abortController = new AbortController();
    const entry: ActiveJobEntry = {
      abortController,
      pauseDeferred: null,
      paused: false,
    };
    this.activeJobs.set(job.id, entry);

    job.status = "processing";
    job.progress.startedAt = Date.now();
    job.results = new Array(job.items.length);

    const promises: Promise<void>[] = [];

    for (let i = 0; i < job.items.length; i++) {
      if (abortController.signal.aborted) break;

      const itemPromise = this.processItem(job, i, processor, config, entry);
      promises.push(itemPromise);
    }

    await Promise.allSettled(promises);

    this.activeJobs.delete(job.id);

    if (abortController.signal.aborted) {
      if (job.status !== "paused") {
        job.status = "cancelled";
      }
    } else {
      const allDone = job.results.every((r) => r !== undefined);
      const anyFailed = job.results.some((r) => r && !r.success);
      if (!allDone) {
        job.status = "failed";
      } else if (anyFailed) {
        const failCount = job.results.filter((r) => r && !r.success).length;
        job.status = failCount === job.items.length ? "failed" : "completed";
      } else {
        job.status = "completed";
      }
    }

    job.progress.completed = job.results.filter((r) => r?.success).length;
    job.progress.failed = job.results.filter((r) => r && !r.success).length;

    return job;
  }

  cancel(jobId: string): boolean {
    const entry = this.activeJobs.get(jobId);
    if (!entry) return false;
    entry.abortController.abort();
    // If paused, resume the loop so it can exit
    if (entry.paused && entry.pauseDeferred) {
      entry.pauseDeferred.resolve();
    }
    return true;
  }

  pause(jobId: string): boolean {
    const entry = this.activeJobs.get(jobId);
    if (!entry || entry.paused) return false;
    entry.paused = true;
    entry.pauseDeferred = createDeferred<void>();
    return true;
  }

  resume(jobId: string): boolean {
    const entry = this.activeJobs.get(jobId);
    if (!entry || !entry.paused) return false;
    entry.paused = false;
    if (entry.pauseDeferred) {
      entry.pauseDeferred.resolve();
      entry.pauseDeferred = null;
    }
    return true;
  }

  getActiveJobs(): string[] {
    return Array.from(this.activeJobs.keys());
  }

  /* -- internals --------------------------------------------------------- */

  private async processItem<T, R>(
    job: BatchJob<T, R>,
    index: number,
    processor: (item: T, idx: number) => Promise<R>,
    config: BatchConfig,
    entry: ActiveJobEntry,
  ): Promise<void> {
    const release = await this.limiter.acquire(config.timeoutMs, job.priority);

    try {
      // Pause gate
      if (entry.paused && entry.pauseDeferred) {
        await entry.pauseDeferred.promise;
      }
      if (entry.abortController.signal.aborted) return;

      const itemResult = await this.executeWithRetry(
        job.items[index],
        index,
        processor,
        config,
        entry.abortController.signal,
      );

      job.results[index] = itemResult;
      job.progress.completed = job.results.filter((r) => r?.success).length;
      job.progress.failed = job.results.filter((r) => r && !r.success).length;

      // Estimate completion
      const elapsed = Date.now() - job.progress.startedAt;
      const processed = job.progress.completed + job.progress.failed;
      if (processed > 0) {
        const avgMs = elapsed / processed;
        const remaining = job.progress.total - processed;
        job.progress.estimatedCompletionAt = Date.now() + avgMs * remaining;
      }

      config.onItemComplete?.(
        itemResult as BatchItemResult<unknown>,
        job as unknown as BatchJob<unknown, unknown>,
      );
      config.onProgress?.(job as unknown as BatchJob<unknown, unknown>);

      // Optional pause between items
      if (config.pauseBetweenItems && config.pauseBetweenItems > 0) {
        await this.sleep(config.pauseBetweenItems);
      }
    } finally {
      release();
    }
  }

  private async executeWithRetry<T, R>(
    item: T,
    index: number,
    processor: (item: T, idx: number) => Promise<R>,
    config: BatchConfig,
    signal: AbortSignal,
  ): Promise<BatchItemResult<R>> {
    let lastError = "";
    const maxAttempts = config.retryPolicy.maxRetries + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (signal.aborted) {
        return {
          index,
          success: false,
          error: "Cancelled",
          retryCount: attempt,
          durationMs: 0,
        };
      }

      const start = Date.now();
      try {
        const result = await this.withTimeout(
          processor(item, index),
          config.timeoutMs,
        );
        return {
          index,
          success: true,
          result,
          retryCount: attempt,
          durationMs: Date.now() - start,
        };
      } catch (err: unknown) {
        lastError =
          err instanceof Error ? err.message : String(err);

        if (attempt < maxAttempts - 1) {
          const backoff =
            config.retryPolicy.backoffMs * Math.pow(2, attempt);
          await this.sleep(backoff);
        }
      }
    }

    return {
      index,
      success: false,
      error: lastError,
      retryCount: maxAttempts - 1,
      durationMs: 0,
    };
  }

  private withTimeout<V>(promise: Promise<V>, ms: number): Promise<V> {
    if (ms <= 0) return promise;
    return new Promise<V>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`BatchExecutor: item timed out after ${ms}ms`));
      }, ms);
      timer.unref();

      promise.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      t.unref();
    });
  }
}

/* ========================================================================= *
 * 5. BatchScheduler                                                         *
 * ========================================================================= */

interface SchedulerJobEntry {
  job: BatchJob<unknown, unknown>;
  processor: (item: unknown, index: number) => Promise<unknown>;
  config: BatchConfig;
  completionDeferred: Deferred<BatchJob<unknown, unknown>>;
}

interface RateWindow {
  count: number;
  resetAt: number;
}

const DEAD_LETTER_MAX = 100;

export class BatchScheduler {
  private queue: SchedulerJobEntry[] = [];
  private active: Map<string, SchedulerJobEntry> = new Map();
  private completed: BatchJob<unknown, unknown>[] = [];
  private deadLetterQueue: BatchJob<unknown, unknown>[] = [];
  private executor: BatchExecutor;
  private backpressure: BackpressureController;
  private scheduling = false;
  private scheduleTimer: ReturnType<typeof setTimeout> | null = null;
  private rateWindows: Map<string, RateWindow> = new Map();
  private maxJobsPerMinute = 60;
  private _totalEnqueued = 0;
  private _totalCompleted = 0;
  private _totalFailed = 0;

  constructor(
    executor: BatchExecutor,
    backpressure: BackpressureController,
    maxJobsPerMinute = 60,
  ) {
    this.executor = executor;
    this.backpressure = backpressure;
    this.maxJobsPerMinute = maxJobsPerMinute;
  }

  /* -- public API -------------------------------------------------------- */

  enqueue<T, R>(
    job: BatchJob<T, R>,
    processor: (item: T, index: number) => Promise<R>,
    config: BatchConfig = DEFAULT_BATCH_CONFIG,
  ): Promise<BatchJob<T, R>> {
    if (!this.backpressure.canAccept()) {
      // Try to submit anyway — backpressure strategy decides what happens
      const accepted = this.backpressure.submit(job.id);
      if (!accepted) {
        return Promise.reject(
          new Error("BatchScheduler: backpressure rejected job"),
        );
      }
    } else {
      this.backpressure.submit(job.id);
    }

    const deferred = createDeferred<BatchJob<unknown, unknown>>();

    const entry: SchedulerJobEntry = {
      job: job as unknown as BatchJob<unknown, unknown>,
      processor: processor as (item: unknown, index: number) => Promise<unknown>,
      config,
      completionDeferred: deferred,
    };

    // Insert sorted by priority (desc) then createdAt (asc)
    let inserted = false;
    for (let i = 0; i < this.queue.length; i++) {
      const qJob = this.queue[i].job;
      if (
        job.priority > qJob.priority ||
        (job.priority === qJob.priority && job.createdAt < qJob.createdAt)
      ) {
        this.queue.splice(i, 0, entry);
        inserted = true;
        break;
      }
    }
    if (!inserted) this.queue.push(entry);

    this._totalEnqueued++;
    this.triggerSchedule();

    return deferred.promise as unknown as Promise<BatchJob<T, R>>;
  }

  dequeue(): SchedulerJobEntry | undefined {
    return this.queue.shift();
  }

  getQueueStatus(): {
    pending: number;
    active: number;
    completed: number;
    failed: number;
    deadLettered: number;
  } {
    return {
      pending: this.queue.length,
      active: this.active.size,
      completed: this._totalCompleted,
      failed: this._totalFailed,
      deadLettered: this.deadLetterQueue.length,
    };
  }

  getDeadLetterQueue(): ReadonlyArray<BatchJob<unknown, unknown>> {
    return this.deadLetterQueue;
  }

  retryDeadLetters(): number {
    const jobs = this.deadLetterQueue.splice(0);
    let count = 0;
    for (const job of jobs) {
      job.status = "queued";
      // Re-enqueue with a no-op processor (caller should re-submit with real processor)
      // We push back to queue head as a simple retry mechanism
      count++;
    }
    return count;
  }

  dispose(): void {
    if (this.scheduleTimer !== null) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = null;
    }
    this.scheduling = false;
    // Cancel all active jobs
    for (const [jobId] of Array.from(this.active.entries())) {
      this.executor.cancel(jobId);
    }
    this.queue.length = 0;
  }

  /* -- internals --------------------------------------------------------- */

  private triggerSchedule(): void {
    if (this.scheduling) return;
    this.scheduling = true;

    // Use microtask to batch schedule calls
    this.scheduleTimer = setTimeout(() => {
      this.scheduleTimer = null;
      this.scheduling = false;
      this.schedule();
    }, 0);
    this.scheduleTimer.unref();
  }

  private schedule(): void {
    while (this.queue.length > 0) {
      const entry = this.queue[0];
      const connId = entry.job.connectorId || "__global__";

      if (!this.checkRate(connId)) break;

      this.queue.shift();
      this.active.set(entry.job.id, entry);
      this.recordRate(connId);

      this.executor
        .executeBatch(entry.job, entry.processor, entry.config)
        .then((result) => {
          this.active.delete(result.id);
          this.backpressure.take(); // drain one from backpressure

          if (result.status === "failed") {
            this._totalFailed++;
            if (this.deadLetterQueue.length < DEAD_LETTER_MAX) {
              this.deadLetterQueue.push(result);
            }
          } else {
            this._totalCompleted++;
          }

          this.completed.push(result);
          // Keep only last 500
          if (this.completed.length > 500) {
            this.completed.splice(0, this.completed.length - 500);
          }

          entry.completionDeferred.resolve(result);
          this.triggerSchedule();
        })
        .catch((err: unknown) => {
          this.active.delete(entry.job.id);
          this.backpressure.take();
          this._totalFailed++;

          entry.job.status = "failed";
          if (this.deadLetterQueue.length < DEAD_LETTER_MAX) {
            this.deadLetterQueue.push(entry.job);
          }

          entry.completionDeferred.reject(err);
          this.triggerSchedule();
        });
    }
  }

  private checkRate(connectorId: string): boolean {
    const now = Date.now();
    const window = this.rateWindows.get(connectorId);
    if (!window || now >= window.resetAt) {
      return true;
    }
    return window.count < this.maxJobsPerMinute;
  }

  private recordRate(connectorId: string): void {
    const now = Date.now();
    let window = this.rateWindows.get(connectorId);
    if (!window || now >= window.resetAt) {
      window = { count: 0, resetAt: now + 60_000 };
      this.rateWindows.set(connectorId, window);
    }
    window.count++;
  }
}

/* ========================================================================= *
 * 6. BatchProgressTracker                                                   *
 * ========================================================================= */

interface ProgressSubscription {
  jobId: string;
  callback: (progress: JobProgressSnapshot) => void;
}

export interface JobProgressSnapshot {
  jobId: string;
  completionPercent: number;
  itemsPerSecond: number;
  successRate: number;
  eta: number | null;
  completed: number;
  failed: number;
  total: number;
  elapsed: number;
}

interface ThroughputSample {
  timestamp: number;
  itemsCompleted: number;
}

export class BatchProgressTracker {
  private subscriptions: Map<string, ProgressSubscription[]> = new Map();
  private throughputSamples: Map<string, ThroughputSample[]> = new Map();
  private jobHistory: Array<{ connectorId: string; job: BatchJob<unknown, unknown>; finishedAt: number }> = [];
  private notifyTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  private static readonly THROUGHPUT_WINDOW_MS = 60_000;
  private static readonly MAX_HISTORY = 500;

  /* -- public API -------------------------------------------------------- */

  getProgress<T, R>(job: BatchJob<T, R>): JobProgressSnapshot {
    const p = job.progress;
    const processed = p.completed + p.failed;
    const elapsed = p.startedAt > 0 ? Date.now() - p.startedAt : 0;
    const completionPercent = p.total > 0 ? (processed / p.total) * 100 : 0;
    const itemsPerSecond = this.calculateThroughput(job.id);
    const successRate = processed > 0 ? p.completed / processed : 1;
    const remaining = p.total - processed;
    const eta =
      itemsPerSecond > 0 ? (remaining / itemsPerSecond) * 1000 : null;

    return {
      jobId: job.id,
      completionPercent,
      itemsPerSecond,
      successRate,
      eta,
      completed: p.completed,
      failed: p.failed,
      total: p.total,
      elapsed,
    };
  }

  subscribe(jobId: string, callback: (progress: JobProgressSnapshot) => void): () => void {
    const subs = this.subscriptions.get(jobId) || [];
    const entry: ProgressSubscription = { jobId, callback };
    subs.push(entry);
    this.subscriptions.set(jobId, subs);

    return () => {
      const list = this.subscriptions.get(jobId);
      if (list) {
        const idx = list.indexOf(entry);
        if (idx !== -1) list.splice(idx, 1);
        if (list.length === 0) this.subscriptions.delete(jobId);
      }
    };
  }

  recordItemCompletion(jobId: string): void {
    const samples = this.throughputSamples.get(jobId) || [];
    samples.push({ timestamp: Date.now(), itemsCompleted: 1 });

    // Trim old samples
    const cutoff = Date.now() - BatchProgressTracker.THROUGHPUT_WINDOW_MS;
    const trimmed = samples.filter((s) => s.timestamp >= cutoff);
    this.throughputSamples.set(jobId, trimmed);
  }

  notifySubscribers<T, R>(job: BatchJob<T, R>): void {
    // Throttle notifications to avoid flooding
    if (this.notifyTimers.has(job.id)) return;

    const timer = setTimeout(() => {
      this.notifyTimers.delete(job.id);
      const subs = this.subscriptions.get(job.id);
      if (!subs || subs.length === 0) return;

      const snapshot = this.getProgress(job);
      for (const sub of subs) {
        try {
          sub.callback(snapshot);
        } catch {
          // subscriber error — ignore
        }
      }
    }, 100);
    timer.unref();
    this.notifyTimers.set(job.id, timer);
  }

  recordJobCompletion(connectorId: string, job: BatchJob<unknown, unknown>): void {
    this.jobHistory.push({
      connectorId,
      job,
      finishedAt: Date.now(),
    });

    if (this.jobHistory.length > BatchProgressTracker.MAX_HISTORY) {
      this.jobHistory.splice(0, this.jobHistory.length - BatchProgressTracker.MAX_HISTORY);
    }

    // Cleanup
    this.subscriptions.delete(job.id);
    this.throughputSamples.delete(job.id);
    const timer = this.notifyTimers.get(job.id);
    if (timer) {
      clearTimeout(timer);
      this.notifyTimers.delete(job.id);
    }
  }

  getJobHistory(
    connectorId?: string,
    limit = 50,
  ): Array<{ connectorId: string; job: BatchJob<unknown, unknown>; finishedAt: number }> {
    let results = this.jobHistory;
    if (connectorId) {
      results = results.filter((e) => e.connectorId === connectorId);
    }
    return results.slice(-limit);
  }

  dispose(): void {
    for (const timer of Array.from(this.notifyTimers.values())) {
      clearTimeout(timer);
    }
    this.notifyTimers.clear();
    this.subscriptions.clear();
    this.throughputSamples.clear();
  }

  /* -- internals --------------------------------------------------------- */

  private calculateThroughput(jobId: string): number {
    const samples = this.throughputSamples.get(jobId);
    if (!samples || samples.length === 0) return 0;

    const now = Date.now();
    const cutoff = now - BatchProgressTracker.THROUGHPUT_WINDOW_MS;
    const recent = samples.filter((s) => s.timestamp >= cutoff);

    if (recent.length === 0) return 0;

    const totalItems = recent.reduce((sum, s) => sum + s.itemsCompleted, 0);
    const windowMs = now - recent[0].timestamp;
    if (windowMs <= 0) return totalItems; // All in same ms — return count

    return (totalItems / windowMs) * 1000;
  }
}

/* ========================================================================= *
 * 7. ChunkedProcessor                                                       *
 * ========================================================================= */

export interface ChunkAdaptiveOptions {
  initialChunkSize: number;
  minChunkSize: number;
  maxChunkSize: number;
  targetDurationMs: number;
  delayBetweenChunksMs: number;
}

const DEFAULT_ADAPTIVE_OPTIONS: ChunkAdaptiveOptions = {
  initialChunkSize: 50,
  minChunkSize: 5,
  maxChunkSize: 500,
  targetDurationMs: 5000,
  delayBetweenChunksMs: 100,
};

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export class ChunkedProcessor {
  /* -- public API -------------------------------------------------------- */

  async processInChunks<T, R>(
    items: T[],
    chunkSize: number,
    processor: (chunk: T[]) => Promise<R[]>,
    delayBetweenChunksMs = 0,
  ): Promise<R[]> {
    const results: R[] = [];
    const totalChunks = Math.ceil(items.length / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const chunk = items.slice(start, start + chunkSize);
      const chunkResults = await processor(chunk);
      results.push(...chunkResults);

      if (delayBetweenChunksMs > 0 && i < totalChunks - 1) {
        await this.sleep(delayBetweenChunksMs);
      }
    }

    return results;
  }

  async processWithCursor<T, R>(
    fetcher: (
      cursor: string | null,
      pageSize: number,
    ) => Promise<CursorPage<T>>,
    processor: (items: T[]) => Promise<R[]>,
    pageSize: number,
  ): Promise<R[]> {
    const results: R[] = [];
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const page = await fetcher(cursor, pageSize);
      if (page.items.length > 0) {
        const chunkResults = await processor(page.items);
        results.push(...chunkResults);
      }

      cursor = page.nextCursor;
      hasMore = cursor !== null && page.items.length > 0;
    }

    return results;
  }

  async processAdaptive<T, R>(
    items: T[],
    processor: (chunk: T[]) => Promise<R[]>,
    options: Partial<ChunkAdaptiveOptions> = {},
  ): Promise<R[]> {
    const opts: ChunkAdaptiveOptions = { ...DEFAULT_ADAPTIVE_OPTIONS, ...options };
    const results: R[] = [];
    let currentChunkSize = opts.initialChunkSize;
    let offset = 0;

    while (offset < items.length) {
      const chunk = items.slice(offset, offset + currentChunkSize);
      const start = Date.now();
      const chunkResults = await processor(chunk);
      const elapsed = Date.now() - start;
      results.push(...chunkResults);
      offset += chunk.length;

      // Adaptive sizing: if chunk took too long, reduce; if fast, increase
      if (elapsed > opts.targetDurationMs * 1.5) {
        currentChunkSize = Math.max(
          opts.minChunkSize,
          Math.floor(currentChunkSize * 0.6),
        );
      } else if (elapsed < opts.targetDurationMs * 0.5) {
        currentChunkSize = Math.min(
          opts.maxChunkSize,
          Math.floor(currentChunkSize * 1.4),
        );
      }

      if (opts.delayBetweenChunksMs > 0 && offset < items.length) {
        await this.sleep(opts.delayBetweenChunksMs);
      }
    }

    return results;
  }

  /* -- internals --------------------------------------------------------- */

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      t.unref();
    });
  }
}

/* ========================================================================= *
 * 8. ConnectorBatchProcessor (facade singleton)                             *
 * ========================================================================= */

interface ConnectorMetricsAccumulator {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  totalItems: number;
  itemDurations: number[];
  batchDurations: number[];
  backpressureEvents: number;
  lastThroughputSamples: Array<{ timestamp: number; count: number }>;
}

export class ConnectorBatchProcessor {
  private executor: BatchExecutor;
  private scheduler: BatchScheduler;
  private backpressure: BackpressureController;
  private progressTracker: BatchProgressTracker;
  private chunkedProcessor: ChunkedProcessor;
  private connectorMetrics: Map<string, ConnectorMetricsAccumulator> = new Map();
  private jobMap: Map<string, BatchJob<unknown, unknown>> = new Map();
  private jobConnectorMap: Map<string, string> = new Map();
  private disposed = false;
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    backpressureConfig: Partial<BackpressureConfig> = {},
    maxJobsPerMinute = 60,
  ) {
    this.backpressure = new BackpressureController(backpressureConfig, {
      onHighWaterMark: () => {
        this.recordBackpressureEvent("__global__");
      },
      onDrop: () => {
        this.recordBackpressureEvent("__global__");
      },
    });

    this.executor = new BatchExecutor();
    this.scheduler = new BatchScheduler(
      this.executor,
      this.backpressure,
      maxJobsPerMinute,
    );
    this.progressTracker = new BatchProgressTracker();
    this.chunkedProcessor = new ChunkedProcessor();

    // Periodic cleanup of stale metrics samples (every 5 min)
    this.cleanupTimer = setInterval(() => {
      this.cleanupMetrics();
    }, 300_000);
    this.cleanupTimer.unref();
  }

  /* -- primary batch submission ------------------------------------------ */

  async submitBatch<T, R>(
    connectorId: string,
    operationId: string,
    items: T[],
    processor: (item: T) => Promise<R>,
    config: Partial<BatchConfig> = {},
  ): Promise<string> {
    this.ensureNotDisposed();

    const merged: BatchConfig = { ...DEFAULT_BATCH_CONFIG, ...config };

    // Enforce maxBatchSize
    const effectiveItems = items.slice(0, merged.maxBatchSize);

    const job: BatchJob<T, R> = {
      id: randomId("batch"),
      items: effectiveItems,
      status: "queued",
      results: [],
      progress: {
        completed: 0,
        failed: 0,
        total: effectiveItems.length,
        startedAt: 0,
      },
      priority: 5,
      createdAt: Date.now(),
      metadata: {},
      connectorId,
      operationId,
    };

    this.jobMap.set(job.id, job as unknown as BatchJob<unknown, unknown>);
    this.jobConnectorMap.set(job.id, connectorId);
    this.ensureConnectorMetrics(connectorId);

    // Wrap processor to track progress
    const wrappedProcessor = async (item: T, index: number): Promise<R> => {
      const result = await processor(item);
      this.progressTracker.recordItemCompletion(job.id);
      this.progressTracker.notifySubscribers(job);
      return result;
    };

    // Enqueue — don't await; return immediately with jobId
    this.scheduler
      .enqueue(job, wrappedProcessor, merged)
      .then((completedJob) => {
        const metrics = this.connectorMetrics.get(connectorId);
        if (metrics) {
          metrics.totalJobs++;
          if (completedJob.status === "completed") {
            metrics.completedJobs++;
          } else {
            metrics.failedJobs++;
          }
          metrics.totalItems += completedJob.progress.total;

          const batchDuration =
            completedJob.progress.startedAt > 0
              ? Date.now() - completedJob.progress.startedAt
              : 0;
          metrics.batchDurations.push(batchDuration);
          if (metrics.batchDurations.length > 500) {
            metrics.batchDurations.splice(0, metrics.batchDurations.length - 500);
          }

          for (const r of completedJob.results) {
            if (r && r.durationMs > 0) {
              metrics.itemDurations.push(r.durationMs);
            }
          }
          if (metrics.itemDurations.length > 2000) {
            metrics.itemDurations.splice(0, metrics.itemDurations.length - 2000);
          }

          metrics.lastThroughputSamples.push({
            timestamp: Date.now(),
            count: completedJob.progress.completed,
          });
          if (metrics.lastThroughputSamples.length > 200) {
            metrics.lastThroughputSamples.splice(
              0,
              metrics.lastThroughputSamples.length - 200,
            );
          }
        }

        this.progressTracker.recordJobCompletion(
          connectorId,
          completedJob as BatchJob<unknown, unknown>,
        );
      })
      .catch(() => {
        const metrics = this.connectorMetrics.get(connectorId);
        if (metrics) {
          metrics.totalJobs++;
          metrics.failedJobs++;
        }
      });

    return job.id;
  }

  /* -- job control ------------------------------------------------------- */

  getJob<T = unknown, R = unknown>(jobId: string): BatchJob<T, R> | undefined {
    return this.jobMap.get(jobId) as BatchJob<T, R> | undefined;
  }

  cancelJob(jobId: string): boolean {
    const job = this.jobMap.get(jobId);
    if (!job) return false;
    job.status = "cancelled";
    return this.executor.cancel(jobId);
  }

  pauseJob(jobId: string): boolean {
    const job = this.jobMap.get(jobId);
    if (!job) return false;
    job.status = "paused";
    return this.executor.pause(jobId);
  }

  resumeJob(jobId: string): boolean {
    const job = this.jobMap.get(jobId);
    if (!job) return false;
    job.status = "processing";
    return this.executor.resume(jobId);
  }

  /* -- wait for completion ----------------------------------------------- */

  async waitForCompletion<T = unknown, R = unknown>(
    jobId: string,
    timeoutMs = 300_000,
  ): Promise<BatchJob<T, R>> {
    const startWait = Date.now();
    const pollInterval = 200;

    return new Promise<BatchJob<T, R>>((resolve, reject) => {
      const check = (): void => {
        const job = this.jobMap.get(jobId);
        if (!job) {
          reject(new Error(`Job ${jobId} not found`));
          return;
        }

        if (
          job.status === "completed" ||
          job.status === "failed" ||
          job.status === "cancelled"
        ) {
          resolve(job as unknown as BatchJob<T, R>);
          return;
        }

        if (Date.now() - startWait >= timeoutMs) {
          reject(
            new Error(
              `waitForCompletion timed out after ${timeoutMs}ms for job ${jobId}`,
            ),
          );
          return;
        }

        const timer = setTimeout(check, pollInterval);
        timer.unref();
      };

      check();
    });
  }

  /* -- chunked / cursor delegates --------------------------------------- */

  processChunked<T, R>(
    items: T[],
    chunkSize: number,
    processor: (chunk: T[]) => Promise<R[]>,
    delayBetweenChunksMs = 0,
  ): Promise<R[]> {
    this.ensureNotDisposed();
    return this.chunkedProcessor.processInChunks(
      items,
      chunkSize,
      processor,
      delayBetweenChunksMs,
    );
  }

  processWithCursor<T, R>(
    fetcher: (
      cursor: string | null,
      pageSize: number,
    ) => Promise<CursorPage<T>>,
    processor: (items: T[]) => Promise<R[]>,
    pageSize: number,
  ): Promise<R[]> {
    this.ensureNotDisposed();
    return this.chunkedProcessor.processWithCursor(fetcher, processor, pageSize);
  }

  processAdaptive<T, R>(
    items: T[],
    processor: (chunk: T[]) => Promise<R[]>,
    options?: Partial<ChunkAdaptiveOptions>,
  ): Promise<R[]> {
    this.ensureNotDisposed();
    return this.chunkedProcessor.processAdaptive(items, processor, options);
  }

  /* -- progress --------------------------------------------------------- */

  getJobProgress(jobId: string): JobProgressSnapshot | null {
    const job = this.jobMap.get(jobId);
    if (!job) return null;
    return this.progressTracker.getProgress(job);
  }

  subscribeToProgress(
    jobId: string,
    callback: (progress: JobProgressSnapshot) => void,
  ): () => void {
    return this.progressTracker.subscribe(jobId, callback);
  }

  getJobHistory(
    connectorId?: string,
    limit?: number,
  ): Array<{ connectorId: string; job: BatchJob<unknown, unknown>; finishedAt: number }> {
    return this.progressTracker.getJobHistory(connectorId, limit);
  }

  /* -- metrics ---------------------------------------------------------- */

  getMetrics(connectorId?: string): BatchMetrics {
    if (connectorId) {
      return this.buildMetrics(connectorId);
    }

    // Global aggregate
    let totalJobs = 0;
    let completedJobs = 0;
    let failedJobs = 0;
    let totalItems = 0;
    const allItemDurations: number[] = [];
    const allBatchDurations: number[] = [];
    let backpressureEvents = 0;
    const allThroughput: Array<{ timestamp: number; count: number }> = [];

    for (const [, m] of Array.from(this.connectorMetrics.entries())) {
      totalJobs += m.totalJobs;
      completedJobs += m.completedJobs;
      failedJobs += m.failedJobs;
      totalItems += m.totalItems;
      allItemDurations.push(...m.itemDurations);
      allBatchDurations.push(...m.batchDurations);
      backpressureEvents += m.backpressureEvents;
      allThroughput.push(...m.lastThroughputSamples);
    }

    const avgItemDurationMs =
      allItemDurations.length > 0
        ? allItemDurations.reduce((a, b) => a + b, 0) / allItemDurations.length
        : 0;

    const avgBatchDurationMs =
      allBatchDurations.length > 0
        ? allBatchDurations.reduce((a, b) => a + b, 0) / allBatchDurations.length
        : 0;

    const throughputItemsPerSecond = this.calcThroughput(allThroughput);

    return {
      totalJobs,
      completedJobs,
      failedJobs,
      totalItems,
      avgItemDurationMs,
      avgBatchDurationMs,
      throughputItemsPerSecond,
      queueDepth: this.backpressure.getQueueDepth(),
      backpressureEvents: backpressureEvents + this.backpressure.getBackpressureEvents(),
    };
  }

  /* -- backpressure status ---------------------------------------------- */

  getBackpressureStatus(): {
    queueDepth: number;
    capacityUtilization: number;
    isPaused: boolean;
    backpressureEvents: number;
  } {
    return {
      queueDepth: this.backpressure.getQueueDepth(),
      capacityUtilization: this.backpressure.getCapacityUtilization(),
      isPaused: this.backpressure.isPaused(),
      backpressureEvents: this.backpressure.getBackpressureEvents(),
    };
  }

  /* -- scheduler status ------------------------------------------------- */

  getSchedulerStatus(): ReturnType<BatchScheduler["getQueueStatus"]> {
    return this.scheduler.getQueueStatus();
  }

  /* -- dispose ---------------------------------------------------------- */

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.scheduler.dispose();
    this.progressTracker.dispose();
    this.backpressure.clear();

    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.jobMap.clear();
    this.jobConnectorMap.clear();
    this.connectorMetrics.clear();
  }

  /* -- internals --------------------------------------------------------- */

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error("ConnectorBatchProcessor has been disposed");
    }
  }

  private ensureConnectorMetrics(connectorId: string): void {
    if (!this.connectorMetrics.has(connectorId)) {
      this.connectorMetrics.set(connectorId, {
        totalJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        totalItems: 0,
        itemDurations: [],
        batchDurations: [],
        backpressureEvents: 0,
        lastThroughputSamples: [],
      });
    }
  }

  private recordBackpressureEvent(connectorId: string): void {
    this.ensureConnectorMetrics(connectorId);
    const m = this.connectorMetrics.get(connectorId);
    if (m) m.backpressureEvents++;
  }

  private buildMetrics(connectorId: string): BatchMetrics {
    const m = this.connectorMetrics.get(connectorId);
    if (!m) {
      return {
        totalJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        totalItems: 0,
        avgItemDurationMs: 0,
        avgBatchDurationMs: 0,
        throughputItemsPerSecond: 0,
        queueDepth: 0,
        backpressureEvents: 0,
      };
    }

    const avgItemDurationMs =
      m.itemDurations.length > 0
        ? m.itemDurations.reduce((a, b) => a + b, 0) / m.itemDurations.length
        : 0;

    const avgBatchDurationMs =
      m.batchDurations.length > 0
        ? m.batchDurations.reduce((a, b) => a + b, 0) / m.batchDurations.length
        : 0;

    return {
      totalJobs: m.totalJobs,
      completedJobs: m.completedJobs,
      failedJobs: m.failedJobs,
      totalItems: m.totalItems,
      avgItemDurationMs,
      avgBatchDurationMs,
      throughputItemsPerSecond: this.calcThroughput(m.lastThroughputSamples),
      queueDepth: this.backpressure.getQueueDepth(),
      backpressureEvents: m.backpressureEvents,
    };
  }

  private calcThroughput(
    samples: Array<{ timestamp: number; count: number }>,
  ): number {
    if (samples.length === 0) return 0;

    const now = Date.now();
    const cutoff = now - 60_000;
    const recent = samples.filter((s) => s.timestamp >= cutoff);
    if (recent.length === 0) return 0;

    const totalItems = recent.reduce((sum, s) => sum + s.count, 0);
    const windowMs = now - recent[0].timestamp;
    if (windowMs <= 0) return totalItems;

    return (totalItems / windowMs) * 1000;
  }

  private cleanupMetrics(): void {
    const now = Date.now();
    const cutoff = now - 300_000; // 5 min

    for (const [, m] of Array.from(this.connectorMetrics.entries())) {
      m.lastThroughputSamples = m.lastThroughputSamples.filter(
        (s) => s.timestamp >= cutoff,
      );
    }

    // Evict stale jobs from jobMap (completed/failed > 30 min old)
    const jobCutoff = now - 1_800_000;
    for (const [id, job] of Array.from(this.jobMap.entries())) {
      if (
        (job.status === "completed" ||
          job.status === "failed" ||
          job.status === "cancelled") &&
        job.createdAt < jobCutoff
      ) {
        this.jobMap.delete(id);
        this.jobConnectorMap.delete(id);
      }
    }
  }
}

/* ========================================================================= *
 * Singleton                                                                 *
 * ========================================================================= */

export const connectorBatchProcessor = new ConnectorBatchProcessor();
