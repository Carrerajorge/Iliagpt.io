import { Counter, Gauge, Histogram, register } from "prom-client";
import { createAlert } from "../lib/alertManager";

type Protocol = "sse" | "ws";

type EventPersistOutcome = "persisted" | "deduplicated" | "failed";

const ALERT_COOLDOWN_MS = Number(process.env.WORKFLOW_ALERT_COOLDOWN_MS || 60_000);

const alertLastFired = new Map<string, number>();

function shouldRaiseAlert(key: string): boolean {
  const now = Date.now();
  const last = alertLastFired.get(key) ?? 0;
  if (now - last < ALERT_COOLDOWN_MS) {
    return false;
  }
  alertLastFired.set(key, now);
  return true;
}

function getOrCreateCounter(name: string, help: string, labelNames: string[] = []): Counter<string> {
  const existing = register.getSingleMetric(name) as Counter<string> | undefined;
  if (existing) {
    return existing;
  }
  return new Counter({ name, help, labelNames });
}

function getOrCreateGauge(name: string, help: string, labelNames: string[] = []): Gauge<string> {
  const existing = register.getSingleMetric(name) as Gauge<string> | undefined;
  if (existing) {
    return existing;
  }
  return new Gauge({ name, help, labelNames });
}

function getOrCreateHistogram(name: string, help: string, buckets: number[], labelNames: string[] = []): Histogram<string> {
  const existing = register.getSingleMetric(name) as Histogram<string> | undefined;
  if (existing) {
    return existing;
  }
  return new Histogram({ name, help, buckets, labelNames });
}

const runLifecycleCounter = getOrCreateCounter(
  "workflow_runs_total",
  "Workflow run lifecycle counters",
  ["status"],
);

const runDurationHistogram = getOrCreateHistogram(
  "workflow_run_duration_seconds",
  "Workflow run duration in seconds",
  [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
  ["status"],
);

const eventPersistCounter = getOrCreateCounter(
  "workflow_events_persist_total",
  "Workflow event persistence outcomes",
  ["outcome"],
);

const eventPersistLatencyHistogram = getOrCreateHistogram(
  "workflow_event_persist_latency_seconds",
  "Workflow event persistence latency in seconds",
  [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
);

const streamClientsGauge = getOrCreateGauge(
  "workflow_stream_clients",
  "Active workflow stream clients",
  ["protocol"],
);

const streamOverflowCounter = getOrCreateCounter(
  "workflow_stream_overflow_total",
  "Workflow stream backpressure overflows",
  ["protocol"],
);

const streamQueueDepthGauge = getOrCreateGauge(
  "workflow_stream_queue_depth",
  "Current queue depth for workflow stream clients",
  ["protocol"],
);

const runLockTimeoutCounter = getOrCreateCounter(
  "workflow_run_lock_timeout_total",
  "Workflow run lock timeout events",
  ["operation"],
);

export function recordRunStatus(status: "created" | "completed" | "failed" | "cancelled"): void {
  runLifecycleCounter.labels(status).inc();
}

export function recordRunDuration(status: "completed" | "failed" | "cancelled", durationMs: number): void {
  runDurationHistogram.labels(status).observe(Math.max(0, durationMs) / 1000);
}

export function recordEventPersistence(outcome: EventPersistOutcome, durationMs?: number): void {
  eventPersistCounter.labels(outcome).inc();
  if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0) {
    eventPersistLatencyHistogram.observe(durationMs / 1000);
  }
}

export function incrementStreamClients(protocol: Protocol): void {
  streamClientsGauge.labels(protocol).inc();
}

export function decrementStreamClients(protocol: Protocol): void {
  streamClientsGauge.labels(protocol).dec();
}

export function setStreamQueueDepth(protocol: Protocol, depth: number): void {
  streamQueueDepthGauge.labels(protocol).set(Math.max(0, Math.floor(depth)));
}

export function recordStreamOverflow(protocol: Protocol, runId: string, queueSize: number): void {
  streamOverflowCounter.labels(protocol).inc();
  if (shouldRaiseAlert(`stream-overflow:${protocol}:${runId}`)) {
    createAlert({
      type: "error_spike",
      service: "workflow-stream",
      message: `Backpressure overflow in ${protocol.toUpperCase()} stream for run ${runId} (queue=${queueSize})`,
      severity: "high",
      resolved: false,
    });
  }
}

export function recordPersistenceFailure(runId: string, errorMessage: string): void {
  if (shouldRaiseAlert(`persist-failure:${runId}`)) {
    createAlert({
      type: "error_spike",
      service: "workflow-persistence",
      message: `Event persistence failing for run ${runId}: ${errorMessage}`,
      severity: "critical",
      resolved: false,
    });
  }
}

export function recordSlowRun(runId: string, durationMs: number, thresholdMs: number): void {
  if (durationMs < thresholdMs) {
    return;
  }

  if (shouldRaiseAlert(`slow-run:${runId}`)) {
    createAlert({
      type: "high_latency",
      service: "workflow-runner",
      message: `Run ${runId} exceeded latency threshold (${durationMs}ms > ${thresholdMs}ms)`,
      severity: "medium",
      resolved: false,
    });
  }
}

export function recordRunLockTimeout(operation: "start" | "cancel", runId: string): void {
  runLockTimeoutCounter.labels(operation).inc();
  if (shouldRaiseAlert(`lock-timeout:${operation}:${runId}`)) {
    createAlert({
      type: "error_spike",
      service: "workflow-lock",
      message: `Timeout acquiring lock for ${operation} on run ${runId}`,
      severity: "medium",
      resolved: false,
    });
  }
}
