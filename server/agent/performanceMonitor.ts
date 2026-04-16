/**
 * Performance Monitor - ILIAGPT PRO 3.0
 * Real-time metrics collection and alerting system
 */

import { EventEmitter } from "events";

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface MetricPoint {
    timestamp: number;
    value: number;
    labels: Record<string, string>;
}

export interface MetricSummary {
    name: string;
    count: number;
    sum: number;
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
}

export interface Alert {
    id: string;
    metricName: string;
    condition: "above" | "below";
    threshold: number;
    triggered: boolean;
    triggeredAt?: number;
    message: string;
}

export interface OperationMetrics {
    operationId: string;
    operationType: string;
    startTime: number;
    endTime?: number;
    duration?: number;
    success: boolean;
    memoryUsed?: number;
    labels: Record<string, string>;
}

// ============================================================================
// Performance Monitor Class
// ============================================================================

export class PerformanceMonitor extends EventEmitter {
    private metrics: Map<string, MetricPoint[]> = new Map();
    private operations: Map<string, OperationMetrics> = new Map();
    private alerts: Map<string, Alert> = new Map();
    private readonly maxHistory: number;
    private readonly retentionMs: number;

    constructor(options: { maxHistory?: number; retentionMs?: number } = {}) {
        super();
        this.maxHistory = options.maxHistory || 1000;
        this.retentionMs = options.retentionMs || 3600000; // 1 hour default
    }

    // --------------------------------------------------------------------------
    // Metric Recording
    // --------------------------------------------------------------------------

    recordMetric(
        name: string,
        value: number,
        labels: Record<string, string> = {}
    ): void {
        const point: MetricPoint = {
            timestamp: Date.now(),
            value,
            labels,
        };

        if (!this.metrics.has(name)) {
            this.metrics.set(name, []);
        }

        const points = this.metrics.get(name)!;
        points.push(point);

        // Trim to max history
        if (points.length > this.maxHistory) {
            points.shift();
        }

        this.checkAlerts(name, value);
        this.emit("metric:recorded", { name, point });
    }

    recordLatency(
        operation: string,
        durationMs: number,
        labels: Record<string, string> = {}
    ): void {
        this.recordMetric(`latency.${operation}`, durationMs, labels);
    }

    recordError(
        operation: string,
        errorType: string,
        labels: Record<string, string> = {}
    ): void {
        this.recordMetric(`errors.${operation}`, 1, { errorType, ...labels });
    }

    recordThroughput(
        operation: string,
        count: number = 1,
        labels: Record<string, string> = {}
    ): void {
        this.recordMetric(`throughput.${operation}`, count, labels);
    }

    // --------------------------------------------------------------------------
    // Operation Tracking
    // --------------------------------------------------------------------------

    startOperation(
        operationId: string,
        operationType: string,
        labels: Record<string, string> = {}
    ): void {
        const op: OperationMetrics = {
            operationId,
            operationType,
            startTime: Date.now(),
            success: false,
            labels,
        };

        this.operations.set(operationId, op);
        this.emit("operation:start", op);
    }

    endOperation(
        operationId: string,
        success: boolean,
        memoryUsed?: number
    ): OperationMetrics | null {
        const op = this.operations.get(operationId);
        if (!op) return null;

        op.endTime = Date.now();
        op.duration = op.endTime - op.startTime;
        op.success = success;
        op.memoryUsed = memoryUsed;

        // Record latency metric
        this.recordLatency(op.operationType, op.duration, op.labels);

        if (!success) {
            this.recordError(op.operationType, "operation_failed", op.labels);
        }

        this.emit("operation:end", op);
        this.operations.delete(operationId);

        return op;
    }

    // --------------------------------------------------------------------------
    // Metric Queries
    // --------------------------------------------------------------------------

    getMetricSummary(name: string, windowMs?: number): MetricSummary | null {
        const points = this.metrics.get(name);
        if (!points || points.length === 0) return null;

        const cutoff = windowMs ? Date.now() - windowMs : 0;
        const filtered = points.filter((p) => p.timestamp >= cutoff);

        if (filtered.length === 0) return null;

        const values = filtered.map((p) => p.value).sort((a, b) => a - b);
        const sum = values.reduce((a, b) => a + b, 0);

        return {
            name,
            count: values.length,
            sum,
            min: values[0],
            max: values[values.length - 1],
            avg: sum / values.length,
            p50: this.percentile(values, 50),
            p95: this.percentile(values, 95),
            p99: this.percentile(values, 99),
        };
    }

    private percentile(sortedValues: number[], p: number): number {
        if (sortedValues.length === 0) return 0;
        const idx = Math.ceil((p / 100) * sortedValues.length) - 1;
        return sortedValues[Math.max(0, idx)];
    }

    getAllMetrics(): Map<string, MetricSummary> {
        const summaries = new Map<string, MetricSummary>();
        for (const name of Array.from(this.metrics.keys())) {
            const summary = this.getMetricSummary(name);
            if (summary) summaries.set(name, summary);
        }
        return summaries;
    }

    // --------------------------------------------------------------------------
    // Alerting
    // --------------------------------------------------------------------------

    addAlert(
        id: string,
        metricName: string,
        condition: "above" | "below",
        threshold: number,
        message: string
    ): void {
        this.alerts.set(id, {
            id,
            metricName,
            condition,
            threshold,
            triggered: false,
            message,
        });
    }

    removeAlert(id: string): boolean {
        return this.alerts.delete(id);
    }

    private checkAlerts(metricName: string, value: number): void {
        for (const alert of Array.from(this.alerts.values())) {
            if (alert.metricName !== metricName) continue;

            const shouldTrigger =
                (alert.condition === "above" && value > alert.threshold) ||
                (alert.condition === "below" && value < alert.threshold);

            if (shouldTrigger && !alert.triggered) {
                alert.triggered = true;
                alert.triggeredAt = Date.now();
                this.emit("alert:triggered", { alert, value });
            } else if (!shouldTrigger && alert.triggered) {
                alert.triggered = false;
                alert.triggeredAt = undefined;
                this.emit("alert:resolved", { alert, value });
            }
        }
    }

    getTriggeredAlerts(): Alert[] {
        return Array.from(this.alerts.values()).filter((a: Alert) => a.triggered);
    }

    // --------------------------------------------------------------------------
    // Cleanup
    // --------------------------------------------------------------------------

    cleanup(): void {
        const cutoff = Date.now() - this.retentionMs;

        for (const [name, points] of Array.from(this.metrics.entries())) {
            const filtered = points.filter((p: MetricPoint) => p.timestamp >= cutoff);
            if (filtered.length === 0) {
                this.metrics.delete(name);
            } else {
                this.metrics.set(name, filtered);
            }
        }
    }

    reset(): void {
        this.metrics.clear();
        this.operations.clear();
        this.alerts.clear();
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const performanceMonitor = new PerformanceMonitor();

// ============================================================================
// Decorators / Helpers
// ============================================================================

export function withMetrics<T extends (...args: any[]) => Promise<any>>(
    operationType: string,
    fn: T,
    labels: Record<string, string> = {}
): T {
    return (async (...args: any[]) => {
        const operationId = `${operationType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        performanceMonitor.startOperation(operationId, operationType, labels);

        try {
            const result = await fn(...args);
            performanceMonitor.endOperation(operationId, true);
            return result;
        } catch (error) {
            performanceMonitor.endOperation(operationId, false);
            throw error;
        }
    }) as T;
}
