import { randomUUID } from "crypto";
import { pool } from "../db";
import { agentEventBus } from "./eventBus";

export type SpanStatus = "unset" | "ok" | "error";

export type SpanKind = "run" | "phase" | "step" | "tool_call";

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: SpanKind;
  startTime: number;
  endTime: number | null;
  status: SpanStatus;
  attributes: Record<string, unknown>;
  events: SpanEvent[];
}

export interface SpanTree extends Span {
  children: SpanTree[];
}

export interface TraceMetrics {
  totalSpans: number;
  totalDurationMs: number;
  latencyHistogram: Record<string, number>;
  tokenCounts: { input: number; output: number; total: number };
  errorRate: number;
  toolCallFrequency: Record<string, number>;
  phaseBreakdown: Record<string, { count: number; totalMs: number; avgMs: number }>;
}

export interface OTelResource {
  attributes: Record<string, unknown>;
}

export interface OTelInstrumentationScope {
  name: string;
  version: string;
}

export interface OTelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  status: { code: number; message?: string };
  attributes: Array<{ key: string; value: { stringValue?: string; intValue?: string; doubleValue?: string; boolValue?: boolean } }>;
  events: Array<{ name: string; timeUnixNano: string; attributes?: Array<{ key: string; value: { stringValue?: string } }> }>;
}

export interface OTelExport {
  resourceSpans: Array<{
    resource: OTelResource;
    scopeSpans: Array<{
      scope: OTelInstrumentationScope;
      spans: OTelSpan[];
    }>;
  }>;
}

const SPAN_KIND_MAP: Record<SpanKind, number> = {
  run: 1,
  phase: 1,
  step: 1,
  tool_call: 3,
};

const STATUS_CODE_MAP: Record<SpanStatus, number> = {
  unset: 0,
  ok: 1,
  error: 2,
};

class SpanBuilder {
  private span: Span;

  constructor(traceId: string, name: string, kind: SpanKind, parentSpanId: string | null = null) {
    this.span = {
      traceId,
      spanId: randomUUID().replace(/-/g, "").slice(0, 16),
      parentSpanId,
      name,
      kind,
      startTime: Date.now(),
      endTime: null,
      status: "unset",
      attributes: {},
      events: [],
    };
  }

  setAttribute(key: string, value: unknown): SpanBuilder {
    this.span.attributes[key] = value;
    return this;
  }

  setAttributes(attrs: Record<string, unknown>): SpanBuilder {
    Object.assign(this.span.attributes, attrs);
    return this;
  }

  addEvent(name: string, attributes?: Record<string, unknown>): SpanBuilder {
    this.span.events.push({ name, timestamp: Date.now(), attributes });
    return this;
  }

  setStatus(status: SpanStatus): SpanBuilder {
    this.span.status = status;
    return this;
  }

  end(): Span {
    this.span.endTime = Date.now();
    if (this.span.status === "unset") {
      this.span.status = "ok";
    }
    return this.span;
  }

  getSpan(): Span {
    return this.span;
  }
}

class RunTracer {
  private traceId: string;
  private runId: string;
  private spans: Map<string, Span> = new Map();
  private activeSpans: Map<string, SpanBuilder> = new Map();
  private metricsAccumulator: {
    tokenInput: number;
    tokenOutput: number;
    errors: number;
    toolCalls: Record<string, number>;
  };

  constructor(runId: string, traceId?: string) {
    this.runId = runId;
    this.traceId = traceId || randomUUID().replace(/-/g, "");
    this.metricsAccumulator = {
      tokenInput: 0,
      tokenOutput: 0,
      errors: 0,
      toolCalls: {},
    };
  }

  getTraceId(): string {
    return this.traceId;
  }

  getRunId(): string {
    return this.runId;
  }

  startSpan(name: string, kind: SpanKind, parentSpanId: string | null = null, attributes?: Record<string, unknown>): string {
    const builder = new SpanBuilder(this.traceId, name, kind, parentSpanId);
    if (attributes) {
      builder.setAttributes(attributes);
    }
    builder.setAttribute("run_id", this.runId);
    const span = builder.getSpan();
    this.activeSpans.set(span.spanId, builder);
    return span.spanId;
  }

  addSpanEvent(spanId: string, eventName: string, attributes?: Record<string, unknown>): void {
    const builder = this.activeSpans.get(spanId);
    if (builder) {
      builder.addEvent(eventName, attributes);
    }
  }

  setSpanAttribute(spanId: string, key: string, value: unknown): void {
    const builder = this.activeSpans.get(spanId);
    if (builder) {
      builder.setAttribute(key, value);
    }
  }

  setSpanStatus(spanId: string, status: SpanStatus): void {
    const builder = this.activeSpans.get(spanId);
    if (builder) {
      builder.setStatus(status);
      if (status === "error") {
        this.metricsAccumulator.errors++;
      }
    }
  }

  endSpan(spanId: string): Span | null {
    const builder = this.activeSpans.get(spanId);
    if (!builder) return null;
    const span = builder.end();
    this.spans.set(span.spanId, span);
    this.activeSpans.delete(spanId);
    return span;
  }

  recordTokens(input: number, output: number): void {
    this.metricsAccumulator.tokenInput += input;
    this.metricsAccumulator.tokenOutput += output;
  }

  recordToolCall(toolName: string): void {
    this.metricsAccumulator.toolCalls[toolName] = (this.metricsAccumulator.toolCalls[toolName] || 0) + 1;
  }

  startRunSpan(objective?: string): string {
    return this.startSpan(`run:${this.runId}`, "run", null, {
      "agent.run_id": this.runId,
      "agent.objective": objective || "",
    });
  }

  startPhaseSpan(phase: string, parentSpanId: string): string {
    return this.startSpan(`phase:${phase}`, "phase", parentSpanId, {
      "agent.phase": phase,
    });
  }

  startStepSpan(stepName: string, stepIndex: number, parentSpanId: string): string {
    return this.startSpan(`step:${stepName}`, "step", parentSpanId, {
      "agent.step.name": stepName,
      "agent.step.index": stepIndex,
    });
  }

  startToolCallSpan(toolName: string, parentSpanId: string, input?: Record<string, unknown>): string {
    this.recordToolCall(toolName);
    return this.startSpan(`tool:${toolName}`, "tool_call", parentSpanId, {
      "agent.tool.name": toolName,
      "agent.tool.input": input ? JSON.stringify(input).slice(0, 1000) : "",
    });
  }

  getAllSpans(): Span[] {
    const completed = Array.from(this.spans.values());
    const active = Array.from(this.activeSpans.values()).map(b => b.getSpan());
    return [...completed, ...active];
  }

  buildSpanTree(): SpanTree[] {
    const allSpans = this.getAllSpans();
    const spanMap = new Map<string, SpanTree>();
    const roots: SpanTree[] = [];

    for (const span of allSpans) {
      spanMap.set(span.spanId, { ...span, children: [] });
    }

    for (const node of spanMap.values()) {
      if (node.parentSpanId && spanMap.has(node.parentSpanId)) {
        spanMap.get(node.parentSpanId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  computeMetrics(): TraceMetrics {
    const allSpans = this.getAllSpans();
    const completedSpans = allSpans.filter(s => s.endTime !== null);

    const latencyBuckets = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
    const latencyHistogram: Record<string, number> = {};
    for (const bucket of latencyBuckets) {
      latencyHistogram[`le_${bucket}ms`] = 0;
    }
    latencyHistogram["le_inf"] = 0;

    const phaseBreakdown: Record<string, { count: number; totalMs: number; avgMs: number }> = {};

    for (const span of completedSpans) {
      const durationMs = span.endTime! - span.startTime;

      let placed = false;
      for (const bucket of latencyBuckets) {
        if (durationMs <= bucket) {
          latencyHistogram[`le_${bucket}ms`]++;
          placed = true;
          break;
        }
      }
      if (!placed) {
        latencyHistogram["le_inf"]++;
      }

      if (span.kind === "phase") {
        const phase = (span.attributes["agent.phase"] as string) || span.name;
        if (!phaseBreakdown[phase]) {
          phaseBreakdown[phase] = { count: 0, totalMs: 0, avgMs: 0 };
        }
        phaseBreakdown[phase].count++;
        phaseBreakdown[phase].totalMs += durationMs;
        phaseBreakdown[phase].avgMs = phaseBreakdown[phase].totalMs / phaseBreakdown[phase].count;
      }
    }

    const runSpan = allSpans.find(s => s.kind === "run");
    const totalDurationMs = runSpan
      ? (runSpan.endTime || Date.now()) - runSpan.startTime
      : 0;

    return {
      totalSpans: allSpans.length,
      totalDurationMs,
      latencyHistogram,
      tokenCounts: {
        input: this.metricsAccumulator.tokenInput,
        output: this.metricsAccumulator.tokenOutput,
        total: this.metricsAccumulator.tokenInput + this.metricsAccumulator.tokenOutput,
      },
      errorRate: allSpans.length > 0
        ? this.metricsAccumulator.errors / allSpans.length
        : 0,
      toolCallFrequency: { ...this.metricsAccumulator.toolCalls },
      phaseBreakdown,
    };
  }

  toOTelExport(): OTelExport {
    const allSpans = this.getAllSpans();

    const otelSpans: OTelSpan[] = allSpans.map(span => ({
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId || undefined,
      name: span.name,
      kind: SPAN_KIND_MAP[span.kind] || 1,
      startTimeUnixNano: (BigInt(span.startTime) * BigInt(1_000_000)).toString(),
      endTimeUnixNano: (BigInt(span.endTime || Date.now()) * BigInt(1_000_000)).toString(),
      status: {
        code: STATUS_CODE_MAP[span.status],
        message: span.status === "error" ? (span.attributes["error.message"] as string) : undefined,
      },
      attributes: Object.entries(span.attributes).map(([key, value]) => ({
        key,
        value: typeof value === "number"
          ? Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: String(value) }
          : typeof value === "boolean"
            ? { boolValue: value }
            : { stringValue: String(value) },
      })),
      events: span.events.map(evt => ({
        name: evt.name,
        timeUnixNano: (BigInt(evt.timestamp) * BigInt(1_000_000)).toString(),
        attributes: evt.attributes
          ? Object.entries(evt.attributes).map(([k, v]) => ({ key: k, value: { stringValue: String(v) } }))
          : undefined,
      })),
    }));

    return {
      resourceSpans: [
        {
          resource: {
            attributes: {
              "service.name": "agent-tracing",
              "service.version": "1.0.0",
              "agent.run_id": this.runId,
            },
          },
          scopeSpans: [
            {
              scope: {
                name: "agent-tracer",
                version: "1.0.0",
              },
              spans: otelSpans,
            },
          ],
        },
      ],
    };
  }
}

const activeTracers = new Map<string, RunTracer>();

export function getOrCreateTracer(runId: string): RunTracer {
  let tracer = activeTracers.get(runId);
  if (!tracer) {
    tracer = new RunTracer(runId);
    activeTracers.set(runId, tracer);
  }
  return tracer;
}

export function getTracer(runId: string): RunTracer | undefined {
  return activeTracers.get(runId);
}

export function removeTracer(runId: string): void {
  activeTracers.delete(runId);
}

export function listActiveTracers(): Array<{ runId: string; traceId: string; spanCount: number }> {
  return Array.from(activeTracers.entries()).map(([runId, tracer]) => ({
    runId,
    traceId: tracer.getTraceId(),
    spanCount: tracer.getAllSpans().length,
  }));
}

export async function getTracesForRun(runId: string): Promise<{
  runId: string;
  traceId: string;
  spans: SpanTree[];
  metrics: TraceMetrics;
  otel: OTelExport;
} | null> {
  const tracer = activeTracers.get(runId);

  if (tracer) {
    return {
      runId,
      traceId: tracer.getTraceId(),
      spans: tracer.buildSpanTree(),
      metrics: tracer.computeMetrics(),
      otel: tracer.toOTelExport(),
    };
  }

  try {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT run_id, seq, trace_id, span_id, parent_span_id, node_id,
               agent, event_type, phase, message, status, progress, metrics, evidence, ts
        FROM trace_events
        WHERE run_id = $1
        ORDER BY seq ASC
        LIMIT 5000
      `, [runId]);

      if (result.rows.length === 0) return null;

      const reconstructed = new RunTracer(runId, result.rows[0]?.trace_id);
      const spanMapping = new Map<string, string>();

      for (const row of result.rows) {
        const eventType = row.event_type as string;
        const spanId = row.span_id as string;
        const parentSpanId = row.parent_span_id as string | null;

        let kind: SpanKind = "step";
        if (eventType.startsWith("run_")) kind = "run";
        else if (eventType.startsWith("phase_")) kind = "phase";
        else if (eventType.startsWith("tool_")) kind = "tool_call";

        if (!spanMapping.has(spanId)) {
          const newSpanId = reconstructed.startSpan(
            row.message || eventType,
            kind,
            parentSpanId && spanMapping.has(parentSpanId) ? spanMapping.get(parentSpanId)! : null,
            {
              "original.span_id": spanId,
              "original.event_type": eventType,
              "agent": row.agent,
              ...(row.phase ? { "agent.phase": row.phase } : {}),
              ...(row.metrics ? { metrics: row.metrics } : {}),
            }
          );
          spanMapping.set(spanId, newSpanId);
        }

        const mappedId = spanMapping.get(spanId);
        if (mappedId) {
          if (row.status === "failed") {
            reconstructed.setSpanStatus(mappedId, "error");
          }
          if (eventType.includes("completed") || eventType.includes("failed") || eventType === "run_completed" || eventType === "run_failed") {
            if (row.status === "failed") {
              reconstructed.setSpanStatus(mappedId, "error");
            } else {
              reconstructed.setSpanStatus(mappedId, "ok");
            }
            reconstructed.endSpan(mappedId);
          }
          if (row.metrics?.tokens) {
            reconstructed.recordTokens(row.metrics.tokens, 0);
          }
        }
      }

      return {
        runId,
        traceId: reconstructed.getTraceId(),
        spans: reconstructed.buildSpanTree(),
        metrics: reconstructed.computeMetrics(),
        otel: reconstructed.toOTelExport(),
      };
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[Tracing] Failed to load traces from DB:", err);
    return null;
  }
}

export function setupEventBusTracing(): void {
  agentEventBus.on("trace", (event) => {
    try {
      const runId = event.runId;
      if (!runId) return;

      const tracer = getOrCreateTracer(runId);
      const eventType = event.event_type;

      if (eventType === "task_start" || eventType === "run_started") {
        tracer.startRunSpan(event.summary || event.command);
      } else if (eventType === "phase_start") {
        const runSpans = tracer.getAllSpans().filter(s => s.kind === "run");
        const parentId = runSpans[0]?.spanId || null;
        tracer.startPhaseSpan(event.phase || "unknown", parentId!);
      } else if (eventType === "step_start") {
        const phaseSpans = tracer.getAllSpans().filter(s => s.kind === "phase");
        const parentId = phaseSpans[phaseSpans.length - 1]?.spanId || null;
        tracer.startStepSpan(event.tool_name || "step", event.stepIndex || 0, parentId!);
      } else if (eventType === "tool_start") {
        const stepSpans = tracer.getAllSpans().filter(s => s.kind === "step");
        const parentId = stepSpans[stepSpans.length - 1]?.spanId || null;
        tracer.startToolCallSpan(event.tool_name || "unknown", parentId!, {
          command: event.command,
        });
        tracer.recordToolCall(event.tool_name || "unknown");
      } else if (eventType === "task_complete" || eventType === "run_completed") {
        const runSpans = tracer.getAllSpans().filter(s => s.kind === "run");
        if (runSpans[0]) {
          tracer.setSpanStatus(runSpans[0].spanId, "ok");
          tracer.endSpan(runSpans[0].spanId);
        }
      } else if (eventType === "error" || eventType === "run_failed") {
        const runSpans = tracer.getAllSpans().filter(s => s.kind === "run");
        if (runSpans[0]) {
          tracer.setSpanAttribute(runSpans[0].spanId, "error.message", event.error || "unknown error");
          tracer.setSpanStatus(runSpans[0].spanId, "error");
          tracer.endSpan(runSpans[0].spanId);
        }
      }
    } catch (err) {
      // Non-critical: tracing should never break the main flow
    }
  });
}

setupEventBusTracing();

export { RunTracer, SpanBuilder };
