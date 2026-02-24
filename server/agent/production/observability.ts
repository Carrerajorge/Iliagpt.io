/**
 * Observability System
 * 
 * Trazabilidad y métricas para producción:
 * - JobTracker (seguimiento de jobs)
 * - MetricsCollector (métricas de rendimiento)
 * - AuditLogger (log de auditoría)
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type { WorkOrder, PipelineStage, ProductionEvent } from './types';
import type { QAGateResult } from './qualityGates';

// ============================================================================
// Types
// ============================================================================

export interface JobRecord {
    id: string;
    workOrderId: string;
    userId: string;
    topic: string;
    intent: string;
    deliverables: string[];
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    startedAt: Date;
    completedAt?: Date;
    durationMs?: number;
    stages: StageRecord[];
    metrics: JobMetrics;
    qaResult?: QAGateResult;
    artifacts: ArtifactRecord[];
    error?: string;
}

export interface StageRecord {
    stage: PipelineStage;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    startedAt?: Date;
    completedAt?: Date;
    durationMs?: number;
    attempts: number;
    error?: string;
    metadata?: Record<string, unknown>;
}

export interface JobMetrics {
    llmCalls: number;
    totalTokens: number;
    searchQueries: number;
    cacheHits: number;
    retries: number;
    sectionsWritten: number;
    slidesGenerated: number;
    citationsUsed: number;
    wordsGenerated: number;
    qaScore: number;
    consistencyScore: number;
}

export interface ArtifactRecord {
    type: string;
    filename: string;
    size: number;
    generatedAt: Date;
    renderTime: number;
}

export interface AuditEvent {
    id: string;
    timestamp: Date;
    jobId: string;
    userId: string;
    eventType: string;
    stage?: PipelineStage;
    details: Record<string, unknown>;
    severity: 'info' | 'warning' | 'error' | 'critical';
}

export interface PerformanceMetric {
    name: string;
    value: number;
    unit: string;
    timestamp: Date;
    jobId?: string;
    tags?: Record<string, string>;
}

// ============================================================================
// Job Tracker
// ============================================================================

class JobTracker extends EventEmitter {
    private jobs: Map<string, JobRecord> = new Map();
    private activeJobs: Set<string> = new Set();

    createJob(workOrder: WorkOrder): JobRecord {
        const job: JobRecord = {
            id: uuidv4(),
            workOrderId: workOrder.id,
            userId: workOrder.userId,
            topic: workOrder.topic,
            intent: workOrder.intent,
            deliverables: workOrder.deliverables,
            status: 'pending',
            startedAt: new Date(),
            stages: this.initializeStages(),
            metrics: this.initializeMetrics(),
            artifacts: [],
        };

        this.jobs.set(job.id, job);
        this.emit('job:created', job);
        return job;
    }

    startJob(jobId: string): void {
        const job = this.jobs.get(jobId);
        if (!job) return;

        job.status = 'running';
        this.activeJobs.add(jobId);
        this.emit('job:started', job);
    }

    completeJob(jobId: string, qaResult?: QAGateResult): void {
        const job = this.jobs.get(jobId);
        if (!job) return;

        job.status = 'completed';
        job.completedAt = new Date();
        job.durationMs = job.completedAt.getTime() - job.startedAt.getTime();
        job.qaResult = qaResult;
        this.activeJobs.delete(jobId);
        this.emit('job:completed', job);
    }

    failJob(jobId: string, error: string): void {
        const job = this.jobs.get(jobId);
        if (!job) return;

        job.status = 'failed';
        job.completedAt = new Date();
        job.durationMs = job.completedAt.getTime() - job.startedAt.getTime();
        job.error = error;
        this.activeJobs.delete(jobId);
        this.emit('job:failed', job);
    }

    updateStage(
        jobId: string,
        stage: PipelineStage,
        status: StageRecord['status'],
        metadata?: Record<string, unknown>
    ): void {
        const job = this.jobs.get(jobId);
        if (!job) return;

        const stageRecord = job.stages.find(s => s.stage === stage);
        if (!stageRecord) return;

        const now = new Date();

        if (status === 'running' && !stageRecord.startedAt) {
            stageRecord.startedAt = now;
        }

        if (status === 'completed' || status === 'failed') {
            stageRecord.completedAt = now;
            if (stageRecord.startedAt) {
                stageRecord.durationMs = now.getTime() - stageRecord.startedAt.getTime();
            }
        }

        stageRecord.status = status;
        if (metadata) {
            stageRecord.metadata = { ...stageRecord.metadata, ...metadata };
        }

        this.emit('stage:updated', { jobId, stage, stageRecord });
    }

    incrementMetric(jobId: string, metric: keyof JobMetrics, amount: number = 1): void {
        const job = this.jobs.get(jobId);
        if (!job) return;

        (job.metrics[metric] as number) += amount;
        this.emit('metric:updated', { jobId, metric, value: job.metrics[metric] });
    }

    addArtifact(jobId: string, artifact: ArtifactRecord): void {
        const job = this.jobs.get(jobId);
        if (!job) return;

        job.artifacts.push(artifact);
        this.emit('artifact:added', { jobId, artifact });
    }

    getJob(jobId: string): JobRecord | undefined {
        return this.jobs.get(jobId);
    }

    getActiveJobs(): JobRecord[] {
        return Array.from(this.activeJobs).map(id => this.jobs.get(id)!).filter(Boolean);
    }

    getAllJobs(): JobRecord[] {
        return Array.from(this.jobs.values());
    }

    getJobStats(): {
        total: number;
        completed: number;
        failed: number;
        active: number;
        avgDuration: number;
        avgQaScore: number;
    } {
        const all = this.getAllJobs();
        const completed = all.filter(j => j.status === 'completed');
        const failed = all.filter(j => j.status === 'failed');

        const avgDuration = completed.length > 0
            ? completed.reduce((acc, j) => acc + (j.durationMs || 0), 0) / completed.length
            : 0;

        const avgQaScore = completed.length > 0
            ? completed.reduce((acc, j) => acc + (j.qaResult?.overallScore || 0), 0) / completed.length
            : 0;

        return {
            total: all.length,
            completed: completed.length,
            failed: failed.length,
            active: this.activeJobs.size,
            avgDuration: Math.round(avgDuration),
            avgQaScore: Math.round(avgQaScore),
        };
    }

    private initializeStages(): StageRecord[] {
        const stages: PipelineStage[] = [
            'intake', 'blueprint', 'research', 'analysis', 'writing',
            'data', 'slides', 'qa', 'consistency', 'render'
        ];

        return stages.map(stage => ({
            stage,
            status: 'pending',
            attempts: 0,
        }));
    }

    private initializeMetrics(): JobMetrics {
        return {
            llmCalls: 0,
            totalTokens: 0,
            searchQueries: 0,
            cacheHits: 0,
            retries: 0,
            sectionsWritten: 0,
            slidesGenerated: 0,
            citationsUsed: 0,
            wordsGenerated: 0,
            qaScore: 0,
            consistencyScore: 0,
        };
    }
}

// ============================================================================
// Metrics Collector
// ============================================================================

class MetricsCollector extends EventEmitter {
    private metrics: PerformanceMetric[] = [];
    private readonly maxMetrics = 10000;

    record(name: string, value: number, unit: string, tags?: Record<string, string>, jobId?: string): void {
        const metric: PerformanceMetric = {
            name,
            value,
            unit,
            timestamp: new Date(),
            jobId,
            tags,
        };

        this.metrics.push(metric);
        this.emit('metric:recorded', metric);

        // Prune old metrics
        if (this.metrics.length > this.maxMetrics) {
            this.metrics = this.metrics.slice(-this.maxMetrics / 2);
        }
    }

    recordDuration(name: string, durationMs: number, tags?: Record<string, string>, jobId?: string): void {
        this.record(name, durationMs, 'ms', tags, jobId);
    }

    recordCount(name: string, count: number, tags?: Record<string, string>, jobId?: string): void {
        this.record(name, count, 'count', tags, jobId);
    }

    recordGauge(name: string, value: number, unit: string, tags?: Record<string, string>): void {
        this.record(name, value, unit, tags);
    }

    getMetrics(filter?: { name?: string; since?: Date; jobId?: string }): PerformanceMetric[] {
        let result = this.metrics;

        if (filter?.name) {
            result = result.filter(m => m.name === filter.name);
        }
        if (filter?.since) {
            result = result.filter(m => m.timestamp >= filter.since);
        }
        if (filter?.jobId) {
            result = result.filter(m => m.jobId === filter.jobId);
        }

        return result;
    }

    getAggregates(name: string, since?: Date): {
        count: number;
        sum: number;
        avg: number;
        min: number;
        max: number;
        p50: number;
        p95: number;
        p99: number;
    } {
        const metrics = this.getMetrics({ name, since });
        const values = metrics.map(m => m.value).sort((a, b) => a - b);

        if (values.length === 0) {
            return { count: 0, sum: 0, avg: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
        }

        const sum = values.reduce((a, b) => a + b, 0);
        const percentile = (p: number) => values[Math.floor(values.length * p / 100)] || 0;

        return {
            count: values.length,
            sum,
            avg: sum / values.length,
            min: values[0],
            max: values[values.length - 1],
            p50: percentile(50),
            p95: percentile(95),
            p99: percentile(99),
        };
    }
}

// ============================================================================
// Audit Logger
// ============================================================================

class AuditLogger extends EventEmitter {
    private events: AuditEvent[] = [];
    private readonly maxEvents = 5000;

    log(
        jobId: string,
        userId: string,
        eventType: string,
        details: Record<string, unknown>,
        severity: AuditEvent['severity'] = 'info',
        stage?: PipelineStage
    ): void {
        const event: AuditEvent = {
            id: uuidv4(),
            timestamp: new Date(),
            jobId,
            userId,
            eventType,
            stage,
            details,
            severity,
        };

        this.events.push(event);
        this.emit('audit:logged', event);

        // Console output for critical events
        if (severity === 'critical' || severity === 'error') {
            console.error(`[AUDIT] ${severity.toUpperCase()}: ${eventType}`, {
                jobId,
                userId,
                details,
            });
        }

        // Prune old events
        if (this.events.length > this.maxEvents) {
            this.events = this.events.slice(-this.maxEvents / 2);
        }
    }

    info(jobId: string, userId: string, eventType: string, details: Record<string, unknown>): void {
        this.log(jobId, userId, eventType, details, 'info');
    }

    warning(jobId: string, userId: string, eventType: string, details: Record<string, unknown>): void {
        this.log(jobId, userId, eventType, details, 'warning');
    }

    error(jobId: string, userId: string, eventType: string, details: Record<string, unknown>): void {
        this.log(jobId, userId, eventType, details, 'error');
    }

    critical(jobId: string, userId: string, eventType: string, details: Record<string, unknown>): void {
        this.log(jobId, userId, eventType, details, 'critical');
    }

    getEvents(filter?: {
        jobId?: string;
        userId?: string;
        severity?: AuditEvent['severity'];
        since?: Date;
    }): AuditEvent[] {
        let result = this.events;

        if (filter?.jobId) {
            result = result.filter(e => e.jobId === filter.jobId);
        }
        if (filter?.userId) {
            result = result.filter(e => e.userId === filter.userId);
        }
        if (filter?.severity) {
            result = result.filter(e => e.severity === filter.severity);
        }
        if (filter?.since) {
            result = result.filter(e => e.timestamp >= filter.since);
        }

        return result;
    }

    getJobAuditTrail(jobId: string): AuditEvent[] {
        return this.events
            .filter(e => e.jobId === jobId)
            .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    }
}

// ============================================================================
// Budget Controller
// ============================================================================

export interface Budget {
    maxLLMCalls: number;
    maxTokens: number;
    maxSearchQueries: number;
    maxRetries: number;
    timeoutMinutes: number;
}

export interface BudgetStatus {
    llmCalls: { used: number; max: number; remaining: number };
    tokens: { used: number; max: number; remaining: number };
    searchQueries: { used: number; max: number; remaining: number };
    retries: { used: number; max: number; remaining: number };
    timeRemaining: number;
    isExhausted: boolean;
    warnings: string[];
}

class BudgetController {
    checkBudget(metrics: JobMetrics, budget: Budget, startTime: Date): BudgetStatus {
        const elapsedMinutes = (Date.now() - startTime.getTime()) / 1000 / 60;
        const timeRemaining = Math.max(0, budget.timeoutMinutes - elapsedMinutes);

        const status: BudgetStatus = {
            llmCalls: {
                used: metrics.llmCalls,
                max: budget.maxLLMCalls,
                remaining: Math.max(0, budget.maxLLMCalls - metrics.llmCalls),
            },
            tokens: {
                used: metrics.totalTokens,
                max: budget.maxTokens || Infinity,
                remaining: budget.maxTokens ? Math.max(0, budget.maxTokens - metrics.totalTokens) : Infinity,
            },
            searchQueries: {
                used: metrics.searchQueries,
                max: budget.maxSearchQueries,
                remaining: Math.max(0, budget.maxSearchQueries - metrics.searchQueries),
            },
            retries: {
                used: metrics.retries,
                max: budget.maxRetries,
                remaining: Math.max(0, budget.maxRetries - metrics.retries),
            },
            timeRemaining,
            isExhausted: false,
            warnings: [],
        };

        // Check for exhaustion
        if (status.llmCalls.remaining <= 0) {
            status.isExhausted = true;
            status.warnings.push('LLM call budget exhausted');
        }
        if (status.timeRemaining <= 0) {
            status.isExhausted = true;
            status.warnings.push('Time budget exhausted');
        }

        // Warnings at 80% usage
        if (status.llmCalls.used / status.llmCalls.max >= 0.8) {
            status.warnings.push('LLM calls approaching limit (>80%)');
        }
        if (status.retries.used / status.retries.max >= 0.8) {
            status.warnings.push('Retries approaching limit (>80%)');
        }

        return status;
    }
}

// ============================================================================
// Singleton Instances
// ============================================================================

export const jobTracker = new JobTracker();
export const metricsCollector = new MetricsCollector();
export const auditLogger = new AuditLogger();
export const budgetController = new BudgetController();

// ============================================================================
// Convenience Wrappers
// ============================================================================

export function startJobTracking(workOrder: WorkOrder): JobRecord {
    const job = jobTracker.createJob(workOrder);
    jobTracker.startJob(job.id);
    auditLogger.info(job.id, workOrder.userId, 'job:started', {
        topic: workOrder.topic,
        intent: workOrder.intent,
        deliverables: workOrder.deliverables,
    });
    return job;
}

export function completeJobTracking(jobId: string, qaResult?: QAGateResult): void {
    const job = jobTracker.getJob(jobId);
    if (job) {
        jobTracker.completeJob(jobId, qaResult);
        auditLogger.info(jobId, job.userId, 'job:completed', {
            duration: job.durationMs,
            qaScore: qaResult?.overallScore,
            artifacts: job.artifacts.length,
        });

        // Record metrics
        metricsCollector.recordDuration('job.duration', job.durationMs || 0, { intent: job.intent }, jobId);
        metricsCollector.recordGauge('job.qa_score', qaResult?.overallScore || 0, 'score', { intent: job.intent });
    }
}

export function failJobTracking(jobId: string, error: string): void {
    const job = jobTracker.getJob(jobId);
    if (job) {
        jobTracker.failJob(jobId, error);
        auditLogger.error(jobId, job.userId, 'job:failed', { error });
        metricsCollector.recordCount('job.failures', 1, { intent: job.intent, error: error.substring(0, 50) });
    }
}
