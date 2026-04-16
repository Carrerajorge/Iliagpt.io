/**
 * Worker Queue and Backpressure System
 * Task 11: Sistema de backpressure para workers de cola
 * Task 15: Pool de workers para operaciones CPU-intensive
 * Task 22: Dead letter queues para jobs fallidos
 */

import { EventEmitter } from 'events';
import { Logger } from './logger';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

interface Job<T = any> {
    id: string;
    type: string;
    payload: T;
    priority: number;
    createdAt: Date;
    attempts: number;
    maxAttempts: number;
    timeout: number;
    metadata?: Record<string, any>;
}

interface JobResult<R = any> {
    jobId: string;
    success: boolean;
    result?: R;
    error?: string;
    duration: number;
}

interface QueueStats {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    deadLettered: number;
    averageProcessingTime: number;
}

type JobHandler<T, R> = (payload: T) => Promise<R>;

// ============================================================================
// Task 11: Backpressure Controller
// ============================================================================

interface BackpressureConfig {
    maxQueueSize: number;
    highWaterMark: number;      // 80% - start applying pressure
    lowWaterMark: number;       // 50% - release pressure
    pauseThresholdMs: number;   // Time to wait when at capacity
}

class BackpressureController extends EventEmitter {
    private config: BackpressureConfig;
    private currentSize = 0;
    private isPaused = false;

    constructor(config: Partial<BackpressureConfig> = {}) {
        super();
        this.config = {
            maxQueueSize: config.maxQueueSize ?? 10000,
            highWaterMark: config.highWaterMark ?? 0.8,
            lowWaterMark: config.lowWaterMark ?? 0.5,
            pauseThresholdMs: config.pauseThresholdMs ?? 100,
        };
    }

    canAccept(): boolean {
        return this.currentSize < this.config.maxQueueSize;
    }

    async waitForCapacity(): Promise<void> {
        if (this.canAccept()) return;

        return new Promise((resolve) => {
            const check = () => {
                if (this.canAccept()) {
                    resolve();
                } else {
                    setTimeout(check, this.config.pauseThresholdMs);
                }
            };
            check();
        });
    }

    increment(): void {
        this.currentSize++;
        this.checkWatermarks();
    }

    decrement(): void {
        this.currentSize = Math.max(0, this.currentSize - 1);
        this.checkWatermarks();
    }

    private checkWatermarks(): void {
        const ratio = this.currentSize / this.config.maxQueueSize;

        if (ratio >= this.config.highWaterMark && !this.isPaused) {
            this.isPaused = true;
            this.emit('pause');
            Logger.warn(`[Backpressure] High water mark reached (${Math.round(ratio * 100)}%), pausing intake`);
        } else if (ratio <= this.config.lowWaterMark && this.isPaused) {
            this.isPaused = false;
            this.emit('resume');
            Logger.info(`[Backpressure] Low water mark reached (${Math.round(ratio * 100)}%), resuming intake`);
        }
    }

    getStats(): { currentSize: number; maxSize: number; utilizationPercent: number; isPaused: boolean } {
        return {
            currentSize: this.currentSize,
            maxSize: this.config.maxQueueSize,
            utilizationPercent: Math.round((this.currentSize / this.config.maxQueueSize) * 100),
            isPaused: this.isPaused,
        };
    }
}

// ============================================================================
// Task 22: Dead Letter Queue
// ============================================================================

class DeadLetterQueue<T> {
    private items: Array<Job<T> & { failedAt: Date; errorMessage: string }> = [];
    private maxSize: number;

    constructor(maxSize: number = 1000) {
        this.maxSize = maxSize;
    }

    add(job: Job<T>, errorMessage: string): void {
        // Remove oldest if at capacity
        if (this.items.length >= this.maxSize) {
            this.items.shift();
        }

        this.items.push({
            ...job,
            failedAt: new Date(),
            errorMessage,
        });

        Logger.warn(`[DLQ] Job ${job.id} moved to dead letter queue: ${errorMessage}`);
    }

    getAll(): Array<Job<T> & { failedAt: Date; errorMessage: string }> {
        return [...this.items];
    }

    retry(jobId: string): Job<T> | null {
        const index = this.items.findIndex(item => item.id === jobId);
        if (index === -1) return null;

        const [item] = this.items.splice(index, 1);
        return {
            ...item,
            attempts: 0, // Reset attempts
            createdAt: new Date(),
        };
    }

    retryAll(): Job<T>[] {
        const items = this.items.map(item => ({
            ...item,
            attempts: 0,
            createdAt: new Date(),
        }));
        this.items = [];
        return items;
    }

    purge(): number {
        const count = this.items.length;
        this.items = [];
        return count;
    }

    size(): number {
        return this.items.length;
    }
}

// ============================================================================
// Task 21: Retry with Exponential Backoff and Jitter
// ============================================================================

interface RetryConfig {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    jitterFactor: number;
}

function calculateRetryDelay(attempt: number, config: RetryConfig): number {
    // Exponential backoff
    const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

    // Add jitter (random variance)
    const jitter = cappedDelay * config.jitterFactor * Math.random();

    return Math.floor(cappedDelay + jitter);
}

async function withRetry<T>(
    fn: () => Promise<T>,
    config: Partial<RetryConfig> = {}
): Promise<T> {
    const fullConfig: RetryConfig = {
        maxAttempts: config.maxAttempts ?? 3,
        baseDelayMs: config.baseDelayMs ?? 1000,
        maxDelayMs: config.maxDelayMs ?? 30000,
        jitterFactor: config.jitterFactor ?? 0.1,
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < fullConfig.maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            if (attempt < fullConfig.maxAttempts - 1) {
                const delay = calculateRetryDelay(attempt, fullConfig);
                Logger.debug(`[Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    throw lastError;
}

// ============================================================================
// Task 15: Worker Pool for CPU-Intensive Operations
// ============================================================================

interface WorkerTask<T, R> {
    id: string;
    handler: string;
    payload: T;
    resolve: (result: R) => void;
    reject: (error: Error) => void;
}

class WorkerPool {
    private workers: Worker[] = [];
    private availableWorkers: Worker[] = [];
    private taskQueue: WorkerTask<any, any>[] = [];
    private activeTaskCount = 0;
    private poolSize: number;

    constructor(poolSize: number = Math.max(1, require('os').cpus().length - 1)) {
        this.poolSize = poolSize;
        Logger.info(`[WorkerPool] Initializing with ${poolSize} workers`);
    }

    private async getWorker(): Promise<Worker> {
        if (this.availableWorkers.length > 0) {
            return this.availableWorkers.pop()!;
        }

        if (this.workers.length < this.poolSize) {
            const worker = new Worker(path.join(__dirname, 'workerExecutor.js'), {
                workerData: { initialized: true }
            });

            worker.on('error', (error) => {
                Logger.error(`[WorkerPool] Worker error: ${error.message}`);
            });

            this.workers.push(worker);
            return worker;
        }

        // Wait for a worker to become available
        return new Promise((resolve) => {
            const check = () => {
                if (this.availableWorkers.length > 0) {
                    resolve(this.availableWorkers.pop()!);
                } else {
                    setTimeout(check, 10);
                }
            };
            check();
        });
    }

    private releaseWorker(worker: Worker): void {
        this.availableWorkers.push(worker);
        this.processQueue();
    }

    private processQueue(): void {
        if (this.taskQueue.length === 0) return;
        if (this.availableWorkers.length === 0 && this.workers.length >= this.poolSize) return;

        const task = this.taskQueue.shift()!;
        this.executeTask(task);
    }

    private async executeTask<T, R>(task: WorkerTask<T, R>): Promise<void> {
        const worker = await this.getWorker();
        this.activeTaskCount++;

        const timeout = setTimeout(() => {
            task.reject(new Error('Worker task timeout'));
            this.releaseWorker(worker);
            this.activeTaskCount--;
        }, 60000); // 60s timeout

        worker.once('message', (result: { success: boolean; data?: R; error?: string }) => {
            clearTimeout(timeout);
            this.activeTaskCount--;

            if (result.success) {
                task.resolve(result.data!);
            } else {
                task.reject(new Error(result.error || 'Worker task failed'));
            }

            this.releaseWorker(worker);
        });

        worker.postMessage({
            id: task.id,
            handler: task.handler,
            payload: task.payload,
        });
    }

    async execute<T, R>(handler: string, payload: T): Promise<R> {
        return new Promise((resolve, reject) => {
            const task: WorkerTask<T, R> = {
                id: `task-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                handler,
                payload,
                resolve,
                reject,
            };

            if (this.availableWorkers.length > 0 || this.workers.length < this.poolSize) {
                this.executeTask(task);
            } else {
                this.taskQueue.push(task);
            }
        });
    }

    getStats(): { poolSize: number; activeWorkers: number; availableWorkers: number; queuedTasks: number } {
        return {
            poolSize: this.poolSize,
            activeWorkers: this.workers.length - this.availableWorkers.length,
            availableWorkers: this.availableWorkers.length,
            queuedTasks: this.taskQueue.length,
        };
    }

    async shutdown(): Promise<void> {
        Logger.info(`[WorkerPool] Shutting down ${this.workers.length} workers`);
        await Promise.all(this.workers.map(worker => worker.terminate()));
        this.workers = [];
        this.availableWorkers = [];
    }
}

// ============================================================================
// Priority Job Queue with All Features
// ============================================================================

class PriorityJobQueue<T, R> extends EventEmitter {
    private handlers: Map<string, JobHandler<T, R>> = new Map();
    private pendingJobs: Job<T>[] = [];
    private processingJobs: Map<string, Job<T>> = new Map();
    private backpressure: BackpressureController;
    private deadLetterQueue: DeadLetterQueue<T>;
    private stats = { completed: 0, failed: 0, totalProcessingTime: 0 };
    private concurrency: number;
    private isProcessing = false;
    private retryConfig: RetryConfig;

    constructor(options: {
        concurrency?: number;
        maxQueueSize?: number;
        retryConfig?: Partial<RetryConfig>;
    } = {}) {
        super();
        this.concurrency = options.concurrency ?? 10;
        this.backpressure = new BackpressureController({ maxQueueSize: options.maxQueueSize });
        this.deadLetterQueue = new DeadLetterQueue();
        this.retryConfig = {
            maxAttempts: options.retryConfig?.maxAttempts ?? 2,
            baseDelayMs: options.retryConfig?.baseDelayMs ?? 300,
            maxDelayMs: options.retryConfig?.maxDelayMs ?? 5000,
            jitterFactor: options.retryConfig?.jitterFactor ?? 0.1,
        };
    }

    registerHandler(type: string, handler: JobHandler<T, R>): void {
        this.handlers.set(type, handler);
        Logger.info(`[Queue] Registered handler for job type: ${type}`);
    }

    async enqueue(job: Omit<Job<T>, 'id' | 'createdAt' | 'attempts'>): Promise<string> {
        await this.backpressure.waitForCapacity();

        const fullJob: Job<T> = {
            ...job,
            id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
            createdAt: new Date(),
            attempts: 0,
            maxAttempts: job.maxAttempts ?? this.retryConfig.maxAttempts,
            timeout: job.timeout ?? 30000,
        };

        this.pendingJobs.push(fullJob);
        this.pendingJobs.sort((a, b) => b.priority - a.priority); // Higher priority first
        this.backpressure.increment();

        this.emit('enqueued', fullJob);
        this.processNext();

        return fullJob.id;
    }

    private async processNext(): Promise<void> {
        if (this.isProcessing) return;
        if (this.pendingJobs.length === 0) return;
        if (this.processingJobs.size >= this.concurrency) return;

        this.isProcessing = true;

        while (this.pendingJobs.length > 0 && this.processingJobs.size < this.concurrency) {
            const job = this.pendingJobs.shift()!;
            this.processingJobs.set(job.id, job);
            this.processJob(job); // Don't await - process concurrently
        }

        this.isProcessing = false;
    }

    private async processJob(job: Job<T>): Promise<void> {
        const handler = this.handlers.get(job.type);
        if (!handler) {
            Logger.error(`[Queue] No handler for job type: ${job.type}`);
            this.failJob(job, `No handler for job type: ${job.type}`);
            return;
        }

        const startTime = Date.now();
        job.attempts++;

        try {
            // Timeout wrapper
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Job timeout')), job.timeout);
            });

            const result = await Promise.race([handler(job.payload), timeoutPromise]);

            const duration = Date.now() - startTime;
            this.stats.completed++;
            this.stats.totalProcessingTime += duration;

            this.emit('completed', { jobId: job.id, success: true, result, duration } as JobResult<R>);
        } catch (error: any) {
            const duration = Date.now() - startTime;

            if (job.attempts < job.maxAttempts) {
                // Retry with backoff
                const delay = calculateRetryDelay(job.attempts - 1, this.retryConfig);
                Logger.warn(`[Queue] Job ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts}), retrying in ${delay}ms`);

                setTimeout(() => {
                    this.pendingJobs.unshift(job); // Add to front for priority
                    this.processNext();
                }, delay);
            } else {
                this.failJob(job, error.message);
            }

            this.emit('failed', { jobId: job.id, success: false, error: error.message, duration } as JobResult<R>);
        } finally {
            this.processingJobs.delete(job.id);
            this.backpressure.decrement();
            this.processNext();
        }
    }

    private failJob(job: Job<T>, errorMessage: string): void {
        this.stats.failed++;
        this.deadLetterQueue.add(job, errorMessage);
        this.emit('deadLettered', { job, error: errorMessage });
    }

    getStats(): QueueStats {
        return {
            pending: this.pendingJobs.length,
            processing: this.processingJobs.size,
            completed: this.stats.completed,
            failed: this.stats.failed,
            deadLettered: this.deadLetterQueue.size(),
            averageProcessingTime: this.stats.completed > 0
                ? Math.round(this.stats.totalProcessingTime / this.stats.completed)
                : 0,
        };
    }

    getBackpressureStats() {
        return this.backpressure.getStats();
    }

    getDeadLetterQueue() {
        return this.deadLetterQueue.getAll();
    }

    retryDeadLettered(jobId?: string): void {
        if (jobId) {
            const job = this.deadLetterQueue.retry(jobId);
            if (job) {
                this.pendingJobs.push(job);
                this.backpressure.increment();
                this.processNext();
            }
        } else {
            const jobs = this.deadLetterQueue.retryAll();
            for (const job of jobs) {
                this.pendingJobs.push(job);
                this.backpressure.increment();
            }
            this.processNext();
        }
    }
}

// ============================================================================
// Exports
// ============================================================================

export {
    BackpressureController,
    DeadLetterQueue,
    WorkerPool,
    PriorityJobQueue,
    withRetry,
    calculateRetryDelay,
};

export type {
    Job,
    JobResult,
    QueueStats,
    JobHandler,
    BackpressureConfig,
    RetryConfig,
};
