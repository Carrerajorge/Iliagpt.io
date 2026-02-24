/**
 * Prometheus Metrics Service
 * 
 * Features:
 * - Request latency histograms
 * - LLM token usage counters
 * - Cache hit/miss ratios
 * - Custom business metrics
 */

import { Request, Response, NextFunction } from "express";

// Metric types
type MetricType = "counter" | "gauge" | "histogram" | "summary";

interface MetricLabels {
    [key: string]: string;
}

interface MetricValue {
    value: number;
    labels: MetricLabels;
    timestamp: number;
}

interface MetricDefinition {
    name: string;
    type: MetricType;
    help: string;
    labelNames: string[];
    buckets?: number[]; // For histograms
}

// Metric storage
const metrics = new Map<string, MetricDefinition>();
const metricValues = new Map<string, MetricValue[]>();

// Default histogram buckets (in ms for latency)
const DEFAULT_LATENCY_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

// Initialize default metrics
export function initMetrics(): void {
    // HTTP request metrics
    registerHistogram({
        name: "http_request_duration_ms",
        help: "HTTP request duration in milliseconds",
        labelNames: ["method", "path", "status"],
        buckets: DEFAULT_LATENCY_BUCKETS,
    });

    registerCounter({
        name: "http_requests_total",
        help: "Total HTTP requests",
        labelNames: ["method", "path", "status"],
    });

    // LLM metrics
    registerCounter({
        name: "llm_tokens_total",
        help: "Total LLM tokens used",
        labelNames: ["model", "type"], // type: prompt, completion
    });

    registerHistogram({
        name: "llm_request_duration_ms",
        help: "LLM API request duration",
        labelNames: ["model"],
        buckets: [100, 500, 1000, 2000, 5000, 10000, 30000],
    });

    registerCounter({
        name: "llm_requests_total",
        help: "Total LLM API requests",
        labelNames: ["model", "status"],
    });

    // Cache metrics
    registerCounter({
        name: "cache_hits_total",
        help: "Cache hits",
        labelNames: ["cache"],
    });

    registerCounter({
        name: "cache_misses_total",
        help: "Cache misses",
        labelNames: ["cache"],
    });

    registerGauge({
        name: "cache_size",
        help: "Current cache size",
        labelNames: ["cache"],
    });

    // Pipeline metrics
    registerCounter({
        name: "pipeline_executions_total",
        help: "Total pipeline executions",
        labelNames: ["status"],
    });

    registerHistogram({
        name: "pipeline_duration_ms",
        help: "Pipeline execution duration",
        labelNames: ["type"],
        buckets: [1000, 5000, 10000, 30000, 60000, 120000],
    });

    registerGauge({
        name: "active_pipelines",
        help: "Currently active pipelines",
        labelNames: [],
    });

    // Document generation metrics
    registerCounter({
        name: "documents_generated_total",
        help: "Total documents generated",
        labelNames: ["type"], // excel, word, pdf
    });

    registerHistogram({
        name: "document_size_bytes",
        help: "Generated document size",
        labelNames: ["type"],
        buckets: [1024, 10240, 102400, 1048576, 10485760],
    });

    // Error metrics
    registerCounter({
        name: "errors_total",
        help: "Total errors",
        labelNames: ["type", "code"],
    });

    console.log("[Prometheus] Metrics initialized");
}

// Register a counter
export function registerCounter(def: Omit<MetricDefinition, "type">): void {
    metrics.set(def.name, { ...def, type: "counter" });
    metricValues.set(def.name, []);
}

// Register a gauge
export function registerGauge(def: Omit<MetricDefinition, "type">): void {
    metrics.set(def.name, { ...def, type: "gauge" });
    metricValues.set(def.name, []);
}

// Register a histogram
export function registerHistogram(def: Omit<MetricDefinition, "type"> & { buckets?: number[] }): void {
    metrics.set(def.name, {
        ...def,
        type: "histogram",
        buckets: def.buckets || DEFAULT_LATENCY_BUCKETS,
    });
    metricValues.set(def.name, []);
}

// Increment counter
export function incCounter(name: string, labels: MetricLabels = {}, value = 1): void {
    const values = metricValues.get(name);
    if (!values) return;

    const labelKey = JSON.stringify(labels);
    const existing = values.find(v => JSON.stringify(v.labels) === labelKey);

    if (existing) {
        existing.value += value;
        existing.timestamp = Date.now();
    } else {
        values.push({ value, labels, timestamp: Date.now() });
    }
}

// Set gauge
export function setGauge(name: string, value: number, labels: MetricLabels = {}): void {
    const values = metricValues.get(name);
    if (!values) return;

    const labelKey = JSON.stringify(labels);
    const existing = values.find(v => JSON.stringify(v.labels) === labelKey);

    if (existing) {
        existing.value = value;
        existing.timestamp = Date.now();
    } else {
        values.push({ value, labels, timestamp: Date.now() });
    }
}

// Observe histogram
export function observeHistogram(name: string, value: number, labels: MetricLabels = {}): void {
    const def = metrics.get(name);
    if (!def || def.type !== "histogram") return;

    const values = metricValues.get(name);
    if (!values) return;

    // Store raw observation
    values.push({ value, labels, timestamp: Date.now() });

    // Keep only last 10000 observations per metric
    if (values.length > 10000) {
        values.splice(0, values.length - 10000);
    }
}

// Create timer for measuring duration
export function startTimer(): { end: (name: string, labels?: MetricLabels) => number } {
    const start = Date.now();

    return {
        end(name: string, labels: MetricLabels = {}): number {
            const duration = Date.now() - start;
            observeHistogram(name, duration, labels);
            return duration;
        },
    };
}

// Express middleware for automatic HTTP metrics
export function metricsMiddleware() {
    return (req: Request, res: Response, next: NextFunction) => {
        const timer = startTimer();

        res.on("finish", () => {
            const path = normalizePath(req.path);
            const labels = {
                method: req.method,
                path,
                status: String(res.statusCode),
            };

            timer.end("http_request_duration_ms", labels);
            incCounter("http_requests_total", labels);
        });

        next();
    };
}

// Normalize path to avoid cardinality explosion
function normalizePath(path: string): string {
    // Replace UUIDs
    path = path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");
    // Replace numeric IDs
    path = path.replace(/\/\d+/g, "/:id");
    return path;
}

// Generate Prometheus exposition format
export function generateMetricsOutput(): string {
    const lines: string[] = [];

    for (const [name, def] of metrics) {
        const values = metricValues.get(name) || [];

        // Add HELP and TYPE
        lines.push(`# HELP ${name} ${def.help}`);
        lines.push(`# TYPE ${name} ${def.type}`);

        if (def.type === "histogram") {
            // Calculate histogram buckets
            const bucketCounts = new Map<string, Map<number, number>>();
            const sums = new Map<string, number>();
            const counts = new Map<string, number>();

            for (const v of values) {
                const labelKey = formatLabels(v.labels);

                if (!bucketCounts.has(labelKey)) {
                    bucketCounts.set(labelKey, new Map());
                    sums.set(labelKey, 0);
                    counts.set(labelKey, 0);
                }

                const buckets = bucketCounts.get(labelKey)!;
                sums.set(labelKey, (sums.get(labelKey) || 0) + v.value);
                counts.set(labelKey, (counts.get(labelKey) || 0) + 1);

                for (const bucket of def.buckets || []) {
                    if (v.value <= bucket) {
                        buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
                    }
                }
            }

            for (const [labelKey, buckets] of bucketCounts) {
                const labelStr = labelKey ? `{${labelKey}}` : "";
                let cumulative = 0;

                for (const bucket of def.buckets || []) {
                    cumulative += buckets.get(bucket) || 0;
                    const bucketLabels = labelKey ? `${labelKey},le="${bucket}"` : `le="${bucket}"`;
                    lines.push(`${name}_bucket{${bucketLabels}} ${cumulative}`);
                }

                const infLabels = labelKey ? `${labelKey},le="+Inf"` : `le="+Inf"`;
                lines.push(`${name}_bucket{${infLabels}} ${counts.get(labelKey) || 0}`);
                lines.push(`${name}_sum${labelStr} ${sums.get(labelKey) || 0}`);
                lines.push(`${name}_count${labelStr} ${counts.get(labelKey) || 0}`);
            }
        } else {
            // Counter or Gauge
            for (const v of values) {
                const labelStr = formatLabels(v.labels);
                lines.push(`${name}${labelStr ? `{${labelStr}}` : ""} ${v.value}`);
            }
        }

        lines.push("");
    }

    return lines.join("\n");
}

// Format labels for Prometheus
function formatLabels(labels: MetricLabels): string {
    return Object.entries(labels)
        .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
        .join(",");
}

// Escape label values
function escapeLabel(value: string): string {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n");
}

// Express handler for /metrics endpoint
export function metricsHandler() {
    return (_req: Request, res: Response) => {
        res.setHeader("Content-Type", "text/plain; version=0.0.4");
        res.send(generateMetricsOutput());
    };
}

// Convenience functions for common metrics
export const httpMetrics = {
    requestDuration: (method: string, path: string, status: number, durationMs: number) => {
        observeHistogram("http_request_duration_ms", durationMs, { method, path: normalizePath(path), status: String(status) });
    },
    requestCount: (method: string, path: string, status: number) => {
        incCounter("http_requests_total", { method, path: normalizePath(path), status: String(status) });
    },
};

export const llmMetrics = {
    tokens: (model: string, promptTokens: number, completionTokens: number) => {
        incCounter("llm_tokens_total", { model, type: "prompt" }, promptTokens);
        incCounter("llm_tokens_total", { model, type: "completion" }, completionTokens);
    },
    request: (model: string, status: "success" | "error", durationMs: number) => {
        incCounter("llm_requests_total", { model, status });
        observeHistogram("llm_request_duration_ms", durationMs, { model });
    },
};

export const cacheMetrics = {
    hit: (cacheName: string) => incCounter("cache_hits_total", { cache: cacheName }),
    miss: (cacheName: string) => incCounter("cache_misses_total", { cache: cacheName }),
    size: (cacheName: string, size: number) => setGauge("cache_size", size, { cache: cacheName }),
};

export const pipelineMetrics = {
    started: () => {
        incCounter("pipeline_executions_total", { status: "started" });
    },
    completed: (durationMs: number, type: string) => {
        incCounter("pipeline_executions_total", { status: "completed" });
        observeHistogram("pipeline_duration_ms", durationMs, { type });
    },
    failed: () => incCounter("pipeline_executions_total", { status: "failed" }),
    active: (count: number) => setGauge("active_pipelines", count),
};

export default {
    initMetrics,
    registerCounter,
    registerGauge,
    registerHistogram,
    incCounter,
    setGauge,
    observeHistogram,
    startTimer,
    metricsMiddleware,
    metricsHandler,
    generateMetricsOutput,
    httpMetrics,
    llmMetrics,
    cacheMetrics,
    pipelineMetrics,
};
