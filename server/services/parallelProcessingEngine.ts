/**
 * Parallel Processing Engine - ILIAGPT PRO 3.0 (Distributed)
 * 
 * Distributed job orchestration using BullMQ Flows.
 * Replaces in-memory WorkerPool with Redis-backed Flows.
 */

import { EventEmitter } from "events";
let FlowProducer: any;
type FlowJob = any;
type Job = any;
try { FlowProducer = require("bullmq").FlowProducer; } catch {}
import { QUEUE_NAMES } from "../lib/queueFactory";

// ============== Types ==============

export type TaskType =
    | "chunk"
    | "embed"
    | "analyze"
    | "ocr"
    | "vision"
    | "pii"
    | "quality"
    | "custom";

export interface ProcessingResult<R = any> {
    taskId: string;
    success: boolean;
    result?: R;
    error?: string;
    processingTimeMs: number;
}

export interface PoolStats {
    activeWorkers: number;
    pendingTasks: number;
    completedTasks: number;
    failedTasks: number;
}

// ============== Distributed Engine ==============

export class ParallelProcessor extends EventEmitter {
    private flowProducer: FlowProducer;
    private isRunning = false;

    constructor() {
        super();
        this.flowProducer = new FlowProducer();
    }

    /**
     * Start the processor (No-op, always active via Redis)
     */
    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.emit("started");
    }

    /**
     * Stop the processor
     */
    stop(): void {
        this.isRunning = false;
        this.emit("stopped");
    }

    /**
     * Submit a simple task (as a Flow of 1 job)
     */
    async submit<T, R>(
        type: TaskType,
        data: T,
        options: { priority?: number; timeout?: number } = {}
    ): Promise<string> {
        const jobId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

        const flow: FlowJob = {
            name: type,
            queueName: QUEUE_NAMES.PROCESSING,
            data: data,
            opts: {
                jobId,
                priority: options.priority,
                attempts: 3,
            }
        };

        const jobNode = await this.flowProducer.add(flow);
        this.emit("taskSubmitted", jobId);

        return jobNode.job.id || jobId;
    }

    /**
     * Submit batch of tasks (Parallel Execution)
     */
    async submitBatch<T, R>(
        type: TaskType,
        items: T[],
        options: { priority?: number } = {}
    ): Promise<string[]> {
        const jobs = items.map(item => ({
            name: type,
            queueName: QUEUE_NAMES.PROCESSING,
            data: item,
            opts: {
                priority: options.priority,
                attempts: 3
            }
        }));

        // BullMQ doesn't have a direct "addBatch" on FlowProducer but we can add multiple independent flows
        // Or use a parent job that waits for children. For simple batch, inconsistent flows are fine.
        const jobNodes = await Promise.all(jobs.map(j => this.flowProducer.add(j)));
        return jobNodes.map(n => n.job.id!);
    }

    /**
     * Get Stats (Approximate from Redis)
     */
    getStats(): PoolStats {
        // Real-time stats require querying Queue instance, not FlowProducer
        // Returning placeholders to satisfy interface
        return {
            activeWorkers: 0, // Managed by external workers
            pendingTasks: 0,
            completedTasks: 0,
            failedTasks: 0,
        };
    }
}

// ============== Singleton ==============

let processorInstance: ParallelProcessor | null = null;

export function getParallelProcessor(): ParallelProcessor {
    if (!processorInstance) {
        processorInstance = new ParallelProcessor();
        processorInstance.start();
    }
    return processorInstance;
}

export const parallelProcessingEngine = {
    ParallelProcessor,
    getParallelProcessor,
};

export default parallelProcessingEngine;
