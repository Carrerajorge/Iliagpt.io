/**
 * Prometheus metrics for the Office Engine.
 *
 * Exposed via `GET /api/office-engine/metrics` (text/plain prom format).
 * Uses a dedicated `Registry` so the office metrics don't pollute the global
 * default registry, matching the pattern used by `server/db.ts`.
 */

import { Counter, Gauge, Histogram, Registry } from "prom-client";

export const officeMetricsRegistry = new Registry();

// ── Worker pool gauges ──
export const workerPoolBusy = new Gauge({
  name: "office_engine_worker_pool_busy",
  help: "Number of workers currently executing a task",
  registers: [officeMetricsRegistry],
});

export const workerPoolIdle = new Gauge({
  name: "office_engine_worker_pool_idle",
  help: "Number of workers currently idle",
  registers: [officeMetricsRegistry],
});

export const workerPoolDead = new Gauge({
  name: "office_engine_worker_pool_dead",
  help: "Number of workers permanently marked dead after MAX_BOOT_FAILURES",
  registers: [officeMetricsRegistry],
});

export const workerPoolQueueDepth = new Gauge({
  name: "office_engine_worker_pool_queue_depth",
  help: "Tasks queued waiting for an idle worker",
  registers: [officeMetricsRegistry],
});

export const workerPoolRestarts = new Counter({
  name: "office_engine_worker_pool_restarts_total",
  help: "Total number of worker thread restarts (crashes + recycles)",
  registers: [officeMetricsRegistry],
});

// ── Per-task metrics ──
export const workerTaskCounter = new Counter({
  name: "office_engine_worker_task_total",
  help: "Total worker tasks dispatched, by task type and outcome",
  labelNames: ["task", "outcome"] as const,
  registers: [officeMetricsRegistry],
});

export const workerTaskLatency = new Histogram({
  name: "office_engine_worker_task_duration_seconds",
  help: "Worker task latency in seconds, by task type",
  labelNames: ["task"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [officeMetricsRegistry],
});

// ── Run-level metrics ──
export const runStartedCounter = new Counter({
  name: "office_engine_runs_started_total",
  help: "Office Engine runs started",
  labelNames: ["doc_kind", "auth"] as const,
  registers: [officeMetricsRegistry],
});

export const runFinishedCounter = new Counter({
  name: "office_engine_runs_finished_total",
  help: "Office Engine runs finished, by doc_kind, status, and fallback level",
  labelNames: ["doc_kind", "status", "fallback_level"] as const,
  registers: [officeMetricsRegistry],
});

export const runDurationHistogram = new Histogram({
  name: "office_engine_run_duration_seconds",
  help: "Wall-clock duration of an Office Engine run, by doc_kind and final status",
  labelNames: ["doc_kind", "status"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [officeMetricsRegistry],
});

export const runIdempotentHits = new Counter({
  name: "office_engine_run_idempotent_hits_total",
  help: "Runs short-circuited via the idempotency cache",
  registers: [officeMetricsRegistry],
});

// ── Route gates ──
export const routeRejectsCounter = new Counter({
  name: "office_engine_route_rejects_total",
  help: "Requests rejected by the route gates (auth/concurrency/size/etc.)",
  labelNames: ["reason"] as const,
  registers: [officeMetricsRegistry],
});

/** Snapshot the worker pool gauges from a stats() call. Called periodically. */
export function snapshotPoolGauges(stats: { busy: number; idle: number; queueDepth: number; restarts: number; dead?: number }) {
  workerPoolBusy.set(stats.busy);
  workerPoolIdle.set(stats.idle);
  workerPoolQueueDepth.set(stats.queueDepth);
  if (typeof stats.dead === "number") workerPoolDead.set(stats.dead);
  // Counters are monotonic — we set them via .inc(delta) elsewhere, not here.
}

export async function renderMetrics(): Promise<string> {
  return officeMetricsRegistry.metrics();
}
