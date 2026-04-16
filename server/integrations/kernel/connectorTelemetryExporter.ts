/**
 * connectorTelemetryExporter.ts
 *
 * Standalone telemetry export pipeline with batching, sampling, and
 * multi-destination export.  Zero imports from other kernel files.
 *
 * Exports:  telemetryPipeline, connectorTelemetryExporter, metricAggregator
 */

import * as os from "os";
import * as crypto from "crypto";
import * as http from "http";
import * as https from "https";
import * as zlib from "zlib";

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function uuid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function nowMs(): number {
  return Date.now();
}

function hrtimeMs(): number {
  const [s, ns] = process.hrtime();
  return s * 1e3 + ns / 1e6;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------
// 1. TelemetrySpan
// ---------------------------------------------------------------------------

export type SpanStatus = "ok" | "error" | "timeout";

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes: Record<string, string | number | boolean>;
}

export interface SpanLink {
  traceId: string;
  spanId: string;
  attributes: Record<string, string | number | boolean>;
}

export class TelemetrySpan {
  public readonly id: string;
  public readonly traceId: string;
  public readonly parentSpanId: string | undefined;
  public readonly operationName: string;
  public readonly connectorId: string;
  public readonly startTime: number;
  public endTime: number | undefined;
  public duration: number | undefined;
  public status: SpanStatus = "ok";
  public readonly attributes: Map<string, string | number | boolean> = new Map();
  public readonly events: SpanEvent[] = [];
  public readonly links: SpanLink[] = [];

  private _ended = false;
  private readonly _onEnd: ((span: TelemetrySpan) => void) | undefined;

  constructor(
    operationName: string,
    connectorId: string,
    traceId?: string,
    parentSpanId?: string,
    onEnd?: (span: TelemetrySpan) => void,
  ) {
    this.id = uuid();
    this.traceId = traceId ?? uuid();
    this.parentSpanId = parentSpanId;
    this.operationName = operationName;
    this.connectorId = connectorId;
    this.startTime = nowMs();
    this._onEnd = onEnd;
  }

  setAttribute(key: string, value: string | number | boolean): this {
    this.attributes.set(key, value);
    return this;
  }

  addEvent(name: string, attributes: Record<string, string | number | boolean> = {}): this {
    this.events.push({ name, timestamp: nowMs(), attributes });
    return this;
  }

  addLink(traceId: string, spanId: string, attributes: Record<string, string | number | boolean> = {}): this {
    this.links.push({ traceId, spanId, attributes });
    return this;
  }

  end(status?: SpanStatus): void {
    if (this._ended) return;
    this._ended = true;
    if (status) this.status = status;
    this.endTime = nowMs();
    this.duration = this.endTime - this.startTime;
    if (this._onEnd) this._onEnd(this);
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      traceId: this.traceId,
      parentSpanId: this.parentSpanId,
      operationName: this.operationName,
      connectorId: this.connectorId,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.duration,
      status: this.status,
      attributes: Object.fromEntries(Array.from(this.attributes.entries())),
      events: this.events,
      links: this.links,
    };
  }
}

// ---------------------------------------------------------------------------
// 2. TelemetryMetric
// ---------------------------------------------------------------------------

export type MetricType = "counter" | "gauge" | "histogram" | "summary";

export interface HistogramBuckets {
  boundaries: number[];
  counts: number[];
}

export interface TelemetryMetric {
  name: string;
  type: MetricType;
  value: number;
  labels: Record<string, string>;
  timestamp: number;
  unit: string;
  description: string;
}

export interface HistogramSnapshot {
  min: number;
  max: number;
  avg: number;
  sum: number;
  count: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  buckets: HistogramBuckets;
}

// ---------------------------------------------------------------------------
// 3. MetricAggregator
// ---------------------------------------------------------------------------

const DEFAULT_HISTOGRAM_BOUNDARIES = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

interface CounterState {
  type: "counter";
  value: number;
  lastUpdated: number;
}

interface GaugeState {
  type: "gauge";
  value: number;
  lastUpdated: number;
}

interface HistogramState {
  type: "histogram";
  values: number[];
  boundaries: number[];
  lastUpdated: number;
}

type AggregatorState = CounterState | GaugeState | HistogramState;

function labelsKey(name: string, labels: Record<string, string>): string {
  const sorted = Array.from(Object.entries(labels)).sort((a, b) => a[0].localeCompare(b[0]));
  return `${name}|${sorted.map(([k, v]) => `${k}=${v}`).join(",")}`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export interface MetricAggregatorConfig {
  flushIntervalMs?: number;
  maxCapacity?: number;
  histogramBoundaries?: Record<string, number[]>;
  onFlush?: (metrics: TelemetryMetric[]) => void;
}

export class MetricAggregator {
  private readonly _state = new Map<string, AggregatorState>();
  private readonly _lruOrder: string[] = [];
  private readonly _maxCapacity: number;
  private readonly _flushIntervalMs: number;
  private readonly _histogramBoundaries: Map<string, number[]> = new Map();
  private readonly _onFlush: ((metrics: TelemetryMetric[]) => void) | undefined;
  private _flushTimer: ReturnType<typeof setInterval> | null = null;
  private _disposed = false;

  constructor(config: MetricAggregatorConfig = {}) {
    this._maxCapacity = config.maxCapacity ?? 10000;
    this._flushIntervalMs = config.flushIntervalMs ?? 60_000;
    this._onFlush = config.onFlush;
    if (config.histogramBoundaries) {
      for (const [k, v] of Object.entries(config.histogramBoundaries)) {
        this._histogramBoundaries.set(k, v);
      }
    }
    this._startAutoFlush();
  }

  // -- public API -----------------------------------------------------------

  record(name: string, value: number, labels: Record<string, string> = {}, type: MetricType = "counter"): void {
    if (this._disposed) return;
    const key = labelsKey(name, labels);
    this._touchLru(key);

    const existing = this._state.get(key);
    if (existing) {
      existing.lastUpdated = nowMs();
      switch (existing.type) {
        case "counter":
          existing.value += value;
          break;
        case "gauge":
          existing.value = value;
          break;
        case "histogram":
          existing.values.push(value);
          break;
      }
      return;
    }

    this._ensureCapacity();

    switch (type) {
      case "counter":
        this._state.set(key, { type: "counter", value, lastUpdated: nowMs() });
        break;
      case "gauge":
        this._state.set(key, { type: "gauge", value, lastUpdated: nowMs() });
        break;
      case "histogram":
      case "summary": {
        const boundaries = this._histogramBoundaries.get(name) ?? DEFAULT_HISTOGRAM_BOUNDARIES;
        this._state.set(key, { type: "histogram", values: [value], boundaries, lastUpdated: nowMs() });
        break;
      }
    }
  }

  getCounter(name: string, labels: Record<string, string> = {}): number {
    const key = labelsKey(name, labels);
    const st = this._state.get(key);
    if (!st || st.type !== "counter") return 0;
    return st.value;
  }

  getGauge(name: string, labels: Record<string, string> = {}): number {
    const key = labelsKey(name, labels);
    const st = this._state.get(key);
    if (!st || st.type !== "gauge") return 0;
    return st.value;
  }

  getHistogram(name: string, labels: Record<string, string> = {}): HistogramSnapshot {
    const key = labelsKey(name, labels);
    const st = this._state.get(key);
    if (!st || st.type !== "histogram" || st.values.length === 0) {
      return { min: 0, max: 0, avg: 0, sum: 0, count: 0, p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, buckets: { boundaries: [], counts: [] } };
    }
    const sorted = [...st.values].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const count = sorted.length;
    const boundaries = st.boundaries;
    const counts = boundaries.map((b) => sorted.filter((v) => v <= b).length);

    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / count,
      sum,
      count,
      p50: percentile(sorted, 50),
      p75: percentile(sorted, 75),
      p90: percentile(sorted, 90),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      buckets: { boundaries, counts },
    };
  }

  setHistogramBoundaries(name: string, boundaries: number[]): void {
    this._histogramBoundaries.set(name, [...boundaries].sort((a, b) => a - b));
  }

  snapshot(): TelemetryMetric[] {
    const out: TelemetryMetric[] = [];
    Array.from(this._state.entries()).forEach(([key, st]) => {
      const [name] = key.split("|", 1);
      const labelsStr = key.slice(name.length + 1);
      const labels: Record<string, string> = {};
      if (labelsStr) {
        labelsStr.split(",").forEach((pair) => {
          const eqIdx = pair.indexOf("=");
          if (eqIdx > 0) labels[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
        });
      }

      if (st.type === "counter") {
        out.push({ name, type: "counter", value: st.value, labels, timestamp: st.lastUpdated, unit: "", description: "" });
      } else if (st.type === "gauge") {
        out.push({ name, type: "gauge", value: st.value, labels, timestamp: st.lastUpdated, unit: "", description: "" });
      } else if (st.type === "histogram") {
        const h = this.getHistogram(name, labels);
        out.push({ name, type: "histogram", value: h.avg, labels, timestamp: st.lastUpdated, unit: "", description: "" });
      }
    });
    return out;
  }

  reset(): void {
    this._state.clear();
    this._lruOrder.length = 0;
  }

  dispose(): void {
    this._disposed = true;
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
  }

  get size(): number {
    return this._state.size;
  }

  // -- private --------------------------------------------------------------

  private _touchLru(key: string): void {
    const idx = this._lruOrder.indexOf(key);
    if (idx !== -1) this._lruOrder.splice(idx, 1);
    this._lruOrder.push(key);
  }

  private _ensureCapacity(): void {
    while (this._state.size >= this._maxCapacity && this._lruOrder.length > 0) {
      const evict = this._lruOrder.shift();
      if (evict) this._state.delete(evict);
    }
  }

  private _startAutoFlush(): void {
    if (this._flushIntervalMs <= 0) return;
    this._flushTimer = setInterval(() => {
      if (this._onFlush) {
        try {
          this._onFlush(this.snapshot());
        } catch {
          // swallow flush errors
        }
      }
    }, this._flushIntervalMs);
    if (this._flushTimer && typeof this._flushTimer === "object" && "unref" in this._flushTimer) {
      (this._flushTimer as NodeJS.Timeout).unref();
    }
  }
}

// ---------------------------------------------------------------------------
// 4. SpanProcessor — Samplers
// ---------------------------------------------------------------------------

export interface SamplingResult {
  decision: boolean;
  attributes: Record<string, string | number | boolean>;
}

export interface Sampler {
  shouldSample(traceId: string, parentSpanId: string | undefined, operationName: string): SamplingResult;
}

export class AlwaysOnSampler implements Sampler {
  shouldSample(_traceId: string, _parentSpanId: string | undefined, _operationName: string): SamplingResult {
    return { decision: true, attributes: { "sampling.priority": 1 } };
  }
}

export class AlwaysOffSampler implements Sampler {
  shouldSample(_traceId: string, _parentSpanId: string | undefined, _operationName: string): SamplingResult {
    return { decision: false, attributes: { "sampling.priority": 0 } };
  }
}

export class TraceIdRatioSampler implements Sampler {
  private readonly _ratio: number;
  private readonly _upperBound: number;

  constructor(ratio: number) {
    this._ratio = clamp(ratio, 0, 1);
    this._upperBound = Math.floor(this._ratio * 0xffffffff);
  }

  shouldSample(traceId: string, _parentSpanId: string | undefined, _operationName: string): SamplingResult {
    const hash = this._hashTraceId(traceId);
    const sampled = hash < this._upperBound;
    return {
      decision: sampled,
      attributes: { "sampling.ratio": this._ratio, "sampling.priority": sampled ? 1 : 0 },
    };
  }

  private _hashTraceId(traceId: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < traceId.length; i++) {
      h ^= traceId.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h;
  }
}

export class ParentBasedSampler implements Sampler {
  private readonly _root: Sampler;
  private readonly _remoteParentSampled: Sampler;
  private readonly _remoteParentNotSampled: Sampler;

  constructor(
    root: Sampler,
    remoteParentSampled?: Sampler,
    remoteParentNotSampled?: Sampler,
  ) {
    this._root = root;
    this._remoteParentSampled = remoteParentSampled ?? new AlwaysOnSampler();
    this._remoteParentNotSampled = remoteParentNotSampled ?? new AlwaysOffSampler();
  }

  shouldSample(traceId: string, parentSpanId: string | undefined, operationName: string): SamplingResult {
    if (!parentSpanId) {
      return this._root.shouldSample(traceId, parentSpanId, operationName);
    }
    // If parent exists, delegate based on whether parent was sampled.
    // Without full context propagation we assume parent was sampled.
    return this._remoteParentSampled.shouldSample(traceId, parentSpanId, operationName);
  }
}

// ---------------------------------------------------------------------------
// 4b. SpanProcessor — Processors
// ---------------------------------------------------------------------------

export type DropPolicy = "drop_oldest" | "drop_newest" | "block";

export interface SpanProcessorInterface {
  onEnd(span: TelemetrySpan): void;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

export class SimpleSpanProcessor implements SpanProcessorInterface {
  private readonly _exporter: TelemetryExporterInterface;

  constructor(exporter: TelemetryExporterInterface) {
    this._exporter = exporter;
  }

  onEnd(span: TelemetrySpan): void {
    this._exporter.exportSpans([span]).catch(() => {});
  }

  async forceFlush(): Promise<void> {
    await this._exporter.forceFlush();
  }

  async shutdown(): Promise<void> {
    await this._exporter.shutdown();
  }
}

export interface BatchSpanProcessorConfig {
  maxBatchSize?: number;
  maxQueueSize?: number;
  scheduledDelayMs?: number;
  dropPolicy?: DropPolicy;
}

export class BatchSpanProcessor implements SpanProcessorInterface {
  private readonly _exporter: TelemetryExporterInterface;
  private readonly _maxBatchSize: number;
  private readonly _maxQueueSize: number;
  private readonly _scheduledDelayMs: number;
  private readonly _dropPolicy: DropPolicy;
  private _queue: TelemetrySpan[] = [];
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _disposed = false;
  private _droppedCount = 0;

  constructor(exporter: TelemetryExporterInterface, config: BatchSpanProcessorConfig = {}) {
    this._exporter = exporter;
    this._maxBatchSize = config.maxBatchSize ?? 512;
    this._maxQueueSize = config.maxQueueSize ?? 2048;
    this._scheduledDelayMs = config.scheduledDelayMs ?? 5000;
    this._dropPolicy = config.dropPolicy ?? "drop_oldest";
    this._startTimer();
  }

  onEnd(span: TelemetrySpan): void {
    if (this._disposed) return;

    if (this._queue.length >= this._maxQueueSize) {
      switch (this._dropPolicy) {
        case "drop_oldest":
          this._queue.shift();
          this._droppedCount++;
          break;
        case "drop_newest":
          this._droppedCount++;
          return;
        case "block":
          // In non-async context we just drop newest to avoid blocking
          this._droppedCount++;
          return;
      }
    }

    this._queue.push(span);

    if (this._queue.length >= this._maxBatchSize) {
      this._flush().catch(() => {});
    }
  }

  async forceFlush(): Promise<void> {
    await this._flush();
    await this._exporter.forceFlush();
  }

  async shutdown(): Promise<void> {
    this._disposed = true;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    await this._flush();
    await this._exporter.shutdown();
  }

  get queueDepth(): number {
    return this._queue.length;
  }

  get droppedCount(): number {
    return this._droppedCount;
  }

  // -- private --------------------------------------------------------------

  private async _flush(): Promise<void> {
    if (this._queue.length === 0) return;
    const batch = this._queue.splice(0, this._maxBatchSize);
    try {
      await this._exporter.exportSpans(batch);
    } catch {
      // requeue on failure (up to capacity)
      const remaining = this._maxQueueSize - this._queue.length;
      if (remaining > 0) {
        this._queue.unshift(...batch.slice(0, remaining));
      }
    }
  }

  private _startTimer(): void {
    this._timer = setInterval(() => {
      this._flush().catch(() => {});
    }, this._scheduledDelayMs);
    if (this._timer && typeof this._timer === "object" && "unref" in this._timer) {
      (this._timer as NodeJS.Timeout).unref();
    }
  }
}

// ---------------------------------------------------------------------------
// 5. TelemetryExporter — Interface & Implementations
// ---------------------------------------------------------------------------

export interface TelemetryExporterInterface {
  exportSpans(spans: TelemetrySpan[]): Promise<void>;
  exportMetrics(metrics: TelemetryMetric[]): Promise<void>;
  shutdown(): Promise<void>;
  forceFlush(): Promise<void>;
}

// -- ConsoleExporter --------------------------------------------------------

const ANSI = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
} as const;

function statusColor(status: SpanStatus): string {
  switch (status) {
    case "ok": return ANSI.green;
    case "error": return ANSI.red;
    case "timeout": return ANSI.yellow;
  }
}

export class ConsoleExporter implements TelemetryExporterInterface {
  private _closed = false;

  async exportSpans(spans: TelemetrySpan[]): Promise<void> {
    if (this._closed) return;
    for (const span of spans) {
      const sc = statusColor(span.status);
      const dur = span.duration !== undefined ? `${span.duration.toFixed(1)}ms` : "ongoing";
      const attrs = Array.from(span.attributes.entries())
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(" ");

      console.log(
        `${ANSI.cyan}[SPAN]${ANSI.reset} ` +
        `${ANSI.bold}${span.operationName}${ANSI.reset} ` +
        `${sc}${span.status}${ANSI.reset} ` +
        `${ANSI.gray}${dur}${ANSI.reset} ` +
        `connector=${span.connectorId} ` +
        `trace=${span.traceId.slice(0, 8)} ` +
        `${attrs ? ANSI.gray + attrs + ANSI.reset : ""}`,
      );

      for (const ev of span.events) {
        const evAttrs = Array.from(Object.entries(ev.attributes))
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(" ");
        console.log(
          `  ${ANSI.yellow}[EVENT]${ANSI.reset} ${ev.name} ${ANSI.gray}${evAttrs}${ANSI.reset}`,
        );
      }
    }
  }

  async exportMetrics(metrics: TelemetryMetric[]): Promise<void> {
    if (this._closed) return;
    for (const m of metrics) {
      const labelsStr = Array.from(Object.entries(m.labels))
        .map(([k, v]) => `${k}="${v}"`)
        .join(",");
      const tag = labelsStr ? `{${labelsStr}}` : "";
      console.log(
        `${ANSI.blue}[METRIC]${ANSI.reset} ` +
        `${m.name}${tag} ` +
        `${ANSI.bold}${m.value}${ANSI.reset} ` +
        `${ANSI.gray}(${m.type})${ANSI.reset}`,
      );
    }
  }

  async shutdown(): Promise<void> {
    this._closed = true;
  }

  async forceFlush(): Promise<void> {
    // Console is synchronous, nothing to flush
  }
}

// -- InMemoryExporter -------------------------------------------------------

export interface InMemoryExporterConfig {
  maxEntries?: number;
}

export class InMemoryExporter implements TelemetryExporterInterface {
  private readonly _maxEntries: number;
  private _spans: TelemetrySpan[] = [];
  private _metrics: TelemetryMetric[] = [];
  private _closed = false;

  constructor(config: InMemoryExporterConfig = {}) {
    this._maxEntries = config.maxEntries ?? 5000;
  }

  async exportSpans(spans: TelemetrySpan[]): Promise<void> {
    if (this._closed) return;
    for (const s of spans) {
      if (this._spans.length >= this._maxEntries) {
        this._spans.shift();
      }
      this._spans.push(s);
    }
  }

  async exportMetrics(metrics: TelemetryMetric[]): Promise<void> {
    if (this._closed) return;
    for (const m of metrics) {
      if (this._metrics.length >= this._maxEntries) {
        this._metrics.shift();
      }
      this._metrics.push(m);
    }
  }

  getSpans(): TelemetrySpan[] {
    return [...this._spans];
  }

  getMetrics(): TelemetryMetric[] {
    return [...this._metrics];
  }

  clear(): void {
    this._spans = [];
    this._metrics = [];
  }

  async shutdown(): Promise<void> {
    this._closed = true;
  }

  async forceFlush(): Promise<void> {
    // In-memory, nothing to flush
  }
}

// -- HttpExporter -----------------------------------------------------------

export interface HttpExporterConfig {
  endpoint: string;
  authHeader?: string;
  maxRetries?: number;
  initialBackoffMs?: number;
  timeoutMs?: number;
  compress?: boolean;
  headers?: Record<string, string>;
}

export class HttpExporter implements TelemetryExporterInterface {
  private readonly _endpoint: string;
  private readonly _authHeader: string | undefined;
  private readonly _maxRetries: number;
  private readonly _initialBackoffMs: number;
  private readonly _timeoutMs: number;
  private readonly _compress: boolean;
  private readonly _headers: Record<string, string>;
  private _closed = false;
  private _successCount = 0;
  private _failureCount = 0;
  private _pendingRequests = 0;

  constructor(config: HttpExporterConfig) {
    this._endpoint = config.endpoint;
    this._authHeader = config.authHeader;
    this._maxRetries = config.maxRetries ?? 3;
    this._initialBackoffMs = config.initialBackoffMs ?? 500;
    this._timeoutMs = config.timeoutMs ?? 10_000;
    this._compress = config.compress ?? false;
    this._headers = config.headers ?? {};
  }

  async exportSpans(spans: TelemetrySpan[]): Promise<void> {
    if (this._closed || spans.length === 0) return;
    const payload = JSON.stringify({
      type: "spans",
      data: spans.map((s) => s.toJSON()),
      timestamp: nowMs(),
    });
    await this._send(payload, "/spans");
  }

  async exportMetrics(metrics: TelemetryMetric[]): Promise<void> {
    if (this._closed || metrics.length === 0) return;
    const payload = JSON.stringify({
      type: "metrics",
      data: metrics,
      timestamp: nowMs(),
    });
    await this._send(payload, "/metrics");
  }

  async shutdown(): Promise<void> {
    this._closed = true;
    // Wait for pending requests with a timeout
    const deadline = nowMs() + 5000;
    while (this._pendingRequests > 0 && nowMs() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async forceFlush(): Promise<void> {
    // HTTP exporter sends immediately, nothing queued
  }

  get stats(): { success: number; failure: number; pending: number } {
    return { success: this._successCount, failure: this._failureCount, pending: this._pendingRequests };
  }

  // -- private --------------------------------------------------------------

  private async _send(payload: string, pathSuffix: string): Promise<void> {
    let attempt = 0;
    let lastError: Error | undefined;

    while (attempt <= this._maxRetries) {
      try {
        this._pendingRequests++;
        await this._doRequest(payload, pathSuffix);
        this._successCount++;
        this._pendingRequests--;
        return;
      } catch (err) {
        this._pendingRequests--;
        lastError = err instanceof Error ? err : new Error(String(err));
        attempt++;
        if (attempt <= this._maxRetries) {
          const backoff = this._initialBackoffMs * Math.pow(2, attempt - 1);
          const jitter = Math.random() * backoff * 0.3;
          await new Promise((r) => setTimeout(r, backoff + jitter));
        }
      }
    }

    this._failureCount++;
    if (lastError) {
      // Log but don't throw — telemetry should not crash the host
      console.error(`[TelemetryHttpExporter] Export failed after ${this._maxRetries} retries:`, lastError.message);
    }
  }

  private _doRequest(payload: string, pathSuffix: string): Promise<void> {
    return new Promise(async (resolve, reject) => {
      let body: Buffer | string = payload;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...this._headers,
      };

      if (this._authHeader) {
        headers["Authorization"] = this._authHeader;
      }

      if (this._compress) {
        try {
          body = await new Promise<Buffer>((res, rej) => {
            zlib.gzip(Buffer.from(payload, "utf-8"), (err, result) => {
              if (err) rej(err);
              else res(result);
            });
          });
          headers["Content-Encoding"] = "gzip";
        } catch {
          // fallback to uncompressed
          body = payload;
        }
      }

      headers["Content-Length"] = String(Buffer.byteLength(body));

      const url = new URL(this._endpoint + pathSuffix);
      const isHttps = url.protocol === "https:";
      const transport = isHttps ? https : http;

      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method: "POST",
          headers,
          timeout: this._timeoutMs,
        },
        (res) => {
          let responseBody = "";
          res.on("data", (chunk: Buffer) => {
            responseBody += chunk.toString();
          });
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve();
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${responseBody.slice(0, 200)}`));
            }
          });
        },
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error(`Request timeout after ${this._timeoutMs}ms`));
      });

      req.write(body);
      req.end();
    });
  }
}

// -- MultiExporter ----------------------------------------------------------

export class MultiExporter implements TelemetryExporterInterface {
  private readonly _exporters: TelemetryExporterInterface[];
  private _closed = false;

  constructor(exporters: TelemetryExporterInterface[]) {
    this._exporters = [...exporters];
  }

  async exportSpans(spans: TelemetrySpan[]): Promise<void> {
    if (this._closed) return;
    const results = await Promise.allSettled(
      this._exporters.map((e) => e.exportSpans(spans)),
    );
    for (const r of results) {
      if (r.status === "rejected") {
        console.error("[MultiExporter] Exporter span export failed:", r.reason);
      }
    }
  }

  async exportMetrics(metrics: TelemetryMetric[]): Promise<void> {
    if (this._closed) return;
    const results = await Promise.allSettled(
      this._exporters.map((e) => e.exportMetrics(metrics)),
    );
    for (const r of results) {
      if (r.status === "rejected") {
        console.error("[MultiExporter] Exporter metric export failed:", r.reason);
      }
    }
  }

  async forceFlush(): Promise<void> {
    await Promise.allSettled(this._exporters.map((e) => e.forceFlush()));
  }

  async shutdown(): Promise<void> {
    this._closed = true;
    await Promise.allSettled(this._exporters.map((e) => e.shutdown()));
  }

  addExporter(exporter: TelemetryExporterInterface): void {
    this._exporters.push(exporter);
  }

  removeExporter(exporter: TelemetryExporterInterface): boolean {
    const idx = this._exporters.indexOf(exporter);
    if (idx !== -1) {
      this._exporters.splice(idx, 1);
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// 6. ResourceDetector
// ---------------------------------------------------------------------------

export interface ResourceAttributes {
  "service.name": string;
  "service.version": string;
  "service.instance.id": string;
  "host.name": string;
  "host.arch": string;
  "os.type": string;
  "os.version": string;
  "process.pid": number;
  "process.runtime.name": string;
  "process.runtime.version": string;
  [key: string]: string | number | boolean;
}

export class ResourceDetector {
  private _cached: ResourceAttributes | null = null;

  detect(): ResourceAttributes {
    if (this._cached) return this._cached;

    const attrs: ResourceAttributes = {
      "service.name": process.env.OTEL_SERVICE_NAME || "unknown_service",
      "service.version": process.env.npm_package_version || "0.0.0",
      "service.instance.id": uuid(),
      "host.name": this._safeHostname(),
      "host.arch": process.arch,
      "os.type": os.type(),
      "os.version": os.release(),
      "process.pid": process.pid,
      "process.runtime.name": "node",
      "process.runtime.version": process.version,
    };

    // Parse OTEL_RESOURCE_ATTRIBUTES env var
    const envAttrs = process.env.OTEL_RESOURCE_ATTRIBUTES;
    if (envAttrs) {
      const pairs = envAttrs.split(",");
      for (const pair of pairs) {
        const eqIdx = pair.indexOf("=");
        if (eqIdx > 0) {
          const key = pair.slice(0, eqIdx).trim();
          const val = pair.slice(eqIdx + 1).trim();
          if (key && val) {
            // Try numeric parse
            const num = Number(val);
            if (!isNaN(num) && val !== "") {
              attrs[key] = num;
            } else if (val === "true") {
              attrs[key] = true;
            } else if (val === "false") {
              attrs[key] = false;
            } else {
              attrs[key] = val;
            }
          }
        }
      }
    }

    this._cached = attrs;
    return attrs;
  }

  refresh(): ResourceAttributes {
    this._cached = null;
    return this.detect();
  }

  private _safeHostname(): string {
    try {
      return os.hostname();
    } catch {
      return "unknown";
    }
  }
}

// ---------------------------------------------------------------------------
// 7. TelemetryPipeline
// ---------------------------------------------------------------------------

export interface TelemetryPipelineConfig {
  serviceName?: string;
  exporters?: TelemetryExporterInterface[];
  processorType?: "simple" | "batch";
  batchConfig?: BatchSpanProcessorConfig;
  sampler?: Sampler;
  metricAggregatorConfig?: MetricAggregatorConfig;
  resource?: Partial<ResourceAttributes>;
}

export interface PipelineHealthStatus {
  queueDepth: number;
  exportSuccessCount: number;
  exportFailureCount: number;
  samplingRate: number;
  totalSpansCreated: number;
  totalSpansSampled: number;
  totalSpansDropped: number;
  activeSpans: number;
  metricsCount: number;
  uptime: number;
}

export class TelemetryPipeline {
  private _processor: SpanProcessorInterface | null = null;
  private _sampler: Sampler = new AlwaysOnSampler();
  private _exporter: TelemetryExporterInterface | null = null;
  private _resource: ResourceAttributes;
  private _aggregator: MetricAggregator;
  private _resourceDetector = new ResourceDetector();
  private _activeSpans = new Map<string, TelemetrySpan>();
  private _recentSpans: TelemetrySpan[] = [];
  private _maxRecentSpans = 1000;
  private _totalCreated = 0;
  private _totalSampled = 0;
  private _totalDropped = 0;
  private _startedAt = nowMs();
  private _disposed = false;
  private _configured = false;

  constructor() {
    this._resource = this._resourceDetector.detect();
    this._aggregator = new MetricAggregator();
  }

  configure(config: TelemetryPipelineConfig = {}): void {
    if (this._disposed) throw new Error("Pipeline is disposed");

    // Shut down previous processor if reconfiguring
    if (this._processor) {
      this._processor.shutdown().catch(() => {});
    }

    // Resource
    if (config.serviceName) {
      this._resource["service.name"] = config.serviceName;
    }
    if (config.resource) {
      Object.assign(this._resource, config.resource);
    }

    // Sampler
    if (config.sampler) {
      this._sampler = config.sampler;
    }

    // Metric aggregator
    if (config.metricAggregatorConfig) {
      this._aggregator.dispose();
      this._aggregator = new MetricAggregator(config.metricAggregatorConfig);
    }

    // Exporter
    if (config.exporters && config.exporters.length > 0) {
      this._exporter = config.exporters.length === 1
        ? config.exporters[0]
        : new MultiExporter(config.exporters);
    } else if (!this._exporter) {
      this._exporter = new InMemoryExporter();
    }

    // Processor
    const processorType = config.processorType ?? "batch";
    if (processorType === "simple") {
      this._processor = new SimpleSpanProcessor(this._exporter);
    } else {
      this._processor = new BatchSpanProcessor(this._exporter, config.batchConfig);
    }

    this._configured = true;
  }

  startSpan(
    operationName: string,
    connectorId: string,
    parentContext?: { traceId?: string; spanId?: string },
  ): TelemetrySpan {
    if (!this._configured) this.configure();
    this._totalCreated++;

    const traceId = parentContext?.traceId ?? uuid();
    const parentSpanId = parentContext?.spanId;

    // Sampling decision
    const samplingResult = this._sampler.shouldSample(traceId, parentSpanId, operationName);
    if (!samplingResult.decision) {
      this._totalDropped++;
      // Return a no-op-ish span that won't be exported
      const noopSpan = new TelemetrySpan(operationName, connectorId, traceId, parentSpanId);
      noopSpan.setAttribute("sampling.dropped", true);
      return noopSpan;
    }

    this._totalSampled++;

    const span = new TelemetrySpan(
      operationName,
      connectorId,
      traceId,
      parentSpanId,
      (completedSpan) => this._onSpanEnd(completedSpan),
    );

    // Attach resource attributes
    Array.from(Object.entries(this._resource)).forEach(([k, v]) => {
      span.setAttribute(`resource.${k}`, v);
    });

    // Attach sampling attributes
    Array.from(Object.entries(samplingResult.attributes)).forEach(([k, v]) => {
      span.setAttribute(k, v);
    });

    this._activeSpans.set(span.id, span);
    return span;
  }

  recordMetric(
    name: string,
    value: number,
    labels: Record<string, string> = {},
    type: MetricType = "counter",
  ): void {
    if (this._disposed) return;
    if (!this._configured) this.configure();
    this._aggregator.record(name, value, labels, type);
  }

  async withSpan<T>(
    operationName: string,
    connectorId: string,
    fn: (span: TelemetrySpan) => T | Promise<T>,
  ): Promise<T> {
    const span = this.startSpan(operationName, connectorId);
    try {
      const result = await fn(span);
      span.end("ok");
      return result;
    } catch (err) {
      span.setAttribute("error.message", err instanceof Error ? err.message : String(err));
      span.setAttribute("error.type", err instanceof Error ? err.constructor.name : "Error");
      if (err instanceof Error && err.stack) {
        span.setAttribute("error.stack", err.stack.slice(0, 500));
      }
      span.addEvent("exception", {
        "exception.message": err instanceof Error ? err.message : String(err),
      });
      span.end("error");
      throw err;
    }
  }

  getMetrics(filter?: { name?: string; labels?: Record<string, string> }): TelemetryMetric[] {
    const all = this._aggregator.snapshot();
    if (!filter) return all;
    return all.filter((m) => {
      if (filter.name && m.name !== filter.name) return false;
      if (filter.labels) {
        for (const [k, v] of Object.entries(filter.labels)) {
          if (m.labels[k] !== v) return false;
        }
      }
      return true;
    });
  }

  getRecentSpans(limit = 100): Array<Record<string, unknown>> {
    return this._recentSpans.slice(-limit).map((s) => s.toJSON());
  }

  getHealth(): PipelineHealthStatus {
    const batchProc = this._processor instanceof BatchSpanProcessor ? this._processor : null;
    const httpExp = this._findHttpExporter();

    return {
      queueDepth: batchProc ? batchProc.queueDepth : 0,
      exportSuccessCount: httpExp ? httpExp.stats.success : 0,
      exportFailureCount: httpExp ? httpExp.stats.failure : 0,
      samplingRate: this._totalCreated > 0 ? this._totalSampled / this._totalCreated : 1,
      totalSpansCreated: this._totalCreated,
      totalSpansSampled: this._totalSampled,
      totalSpansDropped: this._totalDropped,
      activeSpans: this._activeSpans.size,
      metricsCount: this._aggregator.size,
      uptime: nowMs() - this._startedAt,
    };
  }

  async shutdown(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;

    // End any active spans
    Array.from(this._activeSpans.values()).forEach((span) => {
      span.end("error");
    });
    this._activeSpans.clear();

    // Export remaining metrics
    if (this._exporter) {
      const metrics = this._aggregator.snapshot();
      if (metrics.length > 0) {
        try {
          await this._exporter.exportMetrics(metrics);
        } catch {
          // swallow
        }
      }
    }

    // Shutdown processor (which flushes and shuts down exporter)
    if (this._processor) {
      await this._processor.shutdown();
    }

    this._aggregator.dispose();
  }

  get aggregator(): MetricAggregator {
    return this._aggregator;
  }

  // -- private --------------------------------------------------------------

  private _onSpanEnd(span: TelemetrySpan): void {
    this._activeSpans.delete(span.id);

    // Ring buffer for recent spans
    if (this._recentSpans.length >= this._maxRecentSpans) {
      this._recentSpans.shift();
    }
    this._recentSpans.push(span);

    // Forward to processor
    if (this._processor) {
      this._processor.onEnd(span);
    }
  }

  private _findHttpExporter(): HttpExporter | null {
    if (this._exporter instanceof HttpExporter) return this._exporter;
    if (this._exporter instanceof MultiExporter) {
      // Can't inspect private members easily, return null
      return null;
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// 8. ConnectorTelemetryExporter — High-level facade
// ---------------------------------------------------------------------------

interface ConnectorStats {
  totalOperations: number;
  successCount: number;
  errorCount: number;
  totalDurationMs: number;
  lastOperationAt: number;
  slowOperationCount: number;
}

export interface ConnectorMetricsSummary {
  connectorId: string;
  totalOperations: number;
  successRate: number;
  errorRate: number;
  avgDurationMs: number;
  slowOperationCount: number;
  lastOperationAt: number;
  durationHistogram: HistogramSnapshot;
}

export interface SystemOverview {
  totalSpans: number;
  errorRate: number;
  avgDurationMs: number;
  throughputPerMinute: number;
  activeOperations: number;
  topConnectors: Array<{ connectorId: string; operationCount: number; avgDurationMs: number; errorRate: number }>;
  health: PipelineHealthStatus;
}

const SLOW_OPERATION_THRESHOLD_MS = 5000;

export class ConnectorTelemetryExporter {
  private readonly _pipeline: TelemetryPipeline;
  private readonly _connectorStats = new Map<string, ConnectorStats>();
  private readonly _startedAt = nowMs();
  private _httpExporter: HttpExporter | null = null;
  private _inMemoryExporter: InMemoryExporter;
  private _currentSampler: Sampler = new AlwaysOnSampler();

  constructor(pipeline: TelemetryPipeline) {
    this._pipeline = pipeline;
    this._inMemoryExporter = new InMemoryExporter({ maxEntries: 5000 });

    // Default configuration
    this._pipeline.configure({
      exporters: [this._inMemoryExporter],
      processorType: "batch",
      batchConfig: {
        maxBatchSize: 512,
        scheduledDelayMs: 5000,
        maxQueueSize: 2048,
        dropPolicy: "drop_oldest",
      },
      sampler: this._currentSampler,
    });
  }

  async instrument<T>(
    connectorId: string,
    operationId: string,
    fn: () => T | Promise<T>,
  ): Promise<T> {
    const operationName = `${connectorId}.${operationId}`;
    const stats = this._getOrCreateStats(connectorId);
    stats.totalOperations++;
    stats.lastOperationAt = nowMs();

    // Track active operations gauge
    this._pipeline.recordMetric("operation.active", 1, { connector_id: connectorId }, "gauge");

    const startHr = hrtimeMs();

    try {
      const result = await this._pipeline.withSpan(
        operationName,
        connectorId,
        async (span) => {
          span.setAttribute("operation.id", operationId);
          span.setAttribute("connector.id", connectorId);

          const res = await fn();

          const durationMs = hrtimeMs() - startHr;

          // Check for slow operation
          if (durationMs > SLOW_OPERATION_THRESHOLD_MS) {
            span.setAttribute("slow_operation", true);
            span.setAttribute("operation.duration_ms", durationMs);
            span.addEvent("slow_operation_detected", {
              threshold_ms: SLOW_OPERATION_THRESHOLD_MS,
              actual_ms: durationMs,
            });
            stats.slowOperationCount++;
          }

          return res;
        },
      );

      const durationMs = hrtimeMs() - startHr;
      stats.successCount++;
      stats.totalDurationMs += durationMs;

      // Record metrics
      this._pipeline.recordMetric("operation.duration", durationMs, { connector_id: connectorId }, "histogram");
      this._pipeline.recordMetric("operation.success", 1, { connector_id: connectorId }, "counter");

      return result;
    } catch (err) {
      const durationMs = hrtimeMs() - startHr;
      stats.errorCount++;
      stats.totalDurationMs += durationMs;

      this._pipeline.recordMetric("operation.duration", durationMs, { connector_id: connectorId }, "histogram");
      this._pipeline.recordMetric("operation.error", 1, { connector_id: connectorId }, "counter");

      throw err;
    } finally {
      // Decrement active gauge — record current active count
      const currentActive = stats.totalOperations - stats.successCount - stats.errorCount;
      this._pipeline.recordMetric("operation.active", Math.max(0, currentActive), { connector_id: connectorId }, "gauge");
    }
  }

  getConnectorMetrics(connectorId: string): ConnectorMetricsSummary {
    const stats = this._connectorStats.get(connectorId);
    if (!stats) {
      return {
        connectorId,
        totalOperations: 0,
        successRate: 0,
        errorRate: 0,
        avgDurationMs: 0,
        slowOperationCount: 0,
        lastOperationAt: 0,
        durationHistogram: { min: 0, max: 0, avg: 0, sum: 0, count: 0, p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, buckets: { boundaries: [], counts: [] } },
      };
    }

    const completed = stats.successCount + stats.errorCount;
    const histogram = this._pipeline.aggregator.getHistogram("operation.duration", { connector_id: connectorId });

    return {
      connectorId,
      totalOperations: stats.totalOperations,
      successRate: completed > 0 ? stats.successCount / completed : 0,
      errorRate: completed > 0 ? stats.errorCount / completed : 0,
      avgDurationMs: completed > 0 ? stats.totalDurationMs / completed : 0,
      slowOperationCount: stats.slowOperationCount,
      lastOperationAt: stats.lastOperationAt,
      durationHistogram: histogram,
    };
  }

  getSystemOverview(): SystemOverview {
    const health = this._pipeline.getHealth();
    let totalOps = 0;
    let totalErrors = 0;
    let totalDuration = 0;

    const connectorSummaries: Array<{ connectorId: string; operationCount: number; avgDurationMs: number; errorRate: number }> = [];

    Array.from(this._connectorStats.entries()).forEach(([cid, stats]) => {
      const completed = stats.successCount + stats.errorCount;
      totalOps += completed;
      totalErrors += stats.errorCount;
      totalDuration += stats.totalDurationMs;

      connectorSummaries.push({
        connectorId: cid,
        operationCount: completed,
        avgDurationMs: completed > 0 ? stats.totalDurationMs / completed : 0,
        errorRate: completed > 0 ? stats.errorCount / completed : 0,
      });
    });

    // Sort by operation count descending, take top 10
    connectorSummaries.sort((a, b) => b.operationCount - a.operationCount);
    const topConnectors = connectorSummaries.slice(0, 10);

    const uptimeMinutes = (nowMs() - this._startedAt) / 60_000;

    return {
      totalSpans: totalOps,
      errorRate: totalOps > 0 ? totalErrors / totalOps : 0,
      avgDurationMs: totalOps > 0 ? totalDuration / totalOps : 0,
      throughputPerMinute: uptimeMinutes > 0 ? totalOps / uptimeMinutes : 0,
      activeOperations: health.activeSpans,
      topConnectors,
      health,
    };
  }

  setExportEndpoint(url: string, authToken?: string): void {
    this._httpExporter = new HttpExporter({
      endpoint: url,
      authHeader: authToken ? `Bearer ${authToken}` : undefined,
      maxRetries: 3,
      compress: true,
    });

    const exporters: TelemetryExporterInterface[] = [this._inMemoryExporter, this._httpExporter];
    this._pipeline.configure({
      exporters,
      processorType: "batch",
      sampler: this._currentSampler,
    });
  }

  enableSampling(rate: number): void {
    const clampedRate = clamp(rate, 0, 1);
    this._currentSampler = new TraceIdRatioSampler(clampedRate);

    const exporters: TelemetryExporterInterface[] = [this._inMemoryExporter];
    if (this._httpExporter) exporters.push(this._httpExporter);

    this._pipeline.configure({
      exporters,
      processorType: "batch",
      sampler: this._currentSampler,
    });
  }

  getRecentSpans(limit = 50): Array<Record<string, unknown>> {
    return this._pipeline.getRecentSpans(limit);
  }

  async shutdown(): Promise<void> {
    await this._pipeline.shutdown();
  }

  // -- private --------------------------------------------------------------

  private _getOrCreateStats(connectorId: string): ConnectorStats {
    let stats = this._connectorStats.get(connectorId);
    if (!stats) {
      stats = {
        totalOperations: 0,
        successCount: 0,
        errorCount: 0,
        totalDurationMs: 0,
        lastOperationAt: 0,
        slowOperationCount: 0,
      };
      this._connectorStats.set(connectorId, stats);
    }
    return stats;
  }
}

// ---------------------------------------------------------------------------
// Singleton exports
// ---------------------------------------------------------------------------

export const telemetryPipeline = new TelemetryPipeline();
export const metricAggregator = telemetryPipeline.aggregator;
export const connectorTelemetryExporter = new ConnectorTelemetryExporter(telemetryPipeline);
