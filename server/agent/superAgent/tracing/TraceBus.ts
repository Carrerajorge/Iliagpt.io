import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { TraceEvent, TraceEventSchema, RunState } from "./types";

type TraceEventType = TraceEvent["event_type"] | "thought";

interface TraceBusOptions {
  maxListeners?: number;
  bufferSize?: number;
  flushIntervalMs?: number;
}

export class TraceBus extends EventEmitter {
  private runId: string;
  private traceId: string;
  private sequence: number = 0;
  private spanStack: string[] = [];
  private currentSpanId: string;
  private buffer: TraceEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private options: Required<TraceBusOptions>;

  constructor(runId: string, options: TraceBusOptions = {}) {
    super();
    this.runId = runId;
    this.traceId = randomUUID();
    this.currentSpanId = randomUUID();
    this.spanStack.push(this.currentSpanId);

    this.options = {
      maxListeners: options.maxListeners ?? 100,
      bufferSize: options.bufferSize ?? 50,
      flushIntervalMs: options.flushIntervalMs ?? 100,
    };

    this.setMaxListeners(this.options.maxListeners);
    this.startFlushTimer();
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.options.flushIntervalMs);
  }

  private flush(): void {
    if (this.buffer.length === 0) return;

    const events = [...this.buffer];
    this.buffer = [];

    for (const event of events) {
      this.emit("trace", event);
    }
  }

  private nextSeq(): number {
    return ++this.sequence;
  }

  private createEvent(
    eventType: TraceEventType,
    agent: string,
    message: string,
    extra: Partial<Omit<TraceEvent, "schema_version" | "run_id" | "seq" | "trace_id" | "span_id" | "parent_span_id" | "node_id" | "agent" | "event_type" | "message" | "ts">> = {}
  ): TraceEvent {
    const parentSpanId = this.spanStack.length > 1
      ? this.spanStack[this.spanStack.length - 2]
      : null;

    const event: TraceEvent = {
      schema_version: "v1",
      run_id: this.runId,
      seq: this.nextSeq(),
      trace_id: this.traceId,
      span_id: this.currentSpanId,
      parent_span_id: parentSpanId,
      node_id: `${agent}_${eventType}`,
      attempt_id: extra.attempt_id ?? 1,
      agent,
      event_type: eventType,
      message,
      ts: Date.now(),
      ...extra,
    };

    const validated = TraceEventSchema.parse(event);
    return validated;
  }

  pushSpan(spanId?: string): string {
    const newSpanId = spanId ?? randomUUID();
    this.spanStack.push(newSpanId);
    this.currentSpanId = newSpanId;
    return newSpanId;
  }

  popSpan(): string | undefined {
    if (this.spanStack.length > 1) {
      const popped = this.spanStack.pop();
      this.currentSpanId = this.spanStack[this.spanStack.length - 1];
      return popped;
    }
    return undefined;
  }

  getCurrentSpanId(): string {
    return this.currentSpanId;
  }

  getRunId(): string {
    return this.runId;
  }

  private publish(event: TraceEvent): void {
    this.buffer.push(event);

    if (this.buffer.length >= this.options.bufferSize) {
      this.flush();
    }
  }

  runStarted(agent: string, message: string): void {
    const event = this.createEvent("run_started", agent, message, {
      status: "running",
      phase: "planning",
      progress: 0,
    });
    this.publish(event);
  }

  runCompleted(agent: string, message: string, metrics?: TraceEvent["metrics"]): void {
    const event = this.createEvent("run_completed", agent, message, {
      status: "success",
      progress: 100,
      metrics,
    });
    this.publish(event);
    this.flush();
  }

  runFailed(agent: string, message: string, evidence?: TraceEvent["evidence"]): void {
    const event = this.createEvent("run_failed", agent, message, {
      status: "failed",
      evidence,
    });
    this.publish(event);
    this.flush();
  }

  phaseStarted(agent: string, phase: TraceEvent["phase"], message: string): void {
    const spanId = this.pushSpan();
    const event = this.createEvent("phase_started", agent, message, {
      phase,
      status: "running",
    });
    this.publish(event);
  }

  phaseCompleted(agent: string, phase: TraceEvent["phase"], message: string, metrics?: TraceEvent["metrics"]): void {
    const event = this.createEvent("phase_completed", agent, message, {
      phase,
      status: "success",
      metrics,
    });
    this.publish(event);
    this.popSpan();
  }

  phaseFailed(agent: string, phase: TraceEvent["phase"], message: string, evidence?: TraceEvent["evidence"]): void {
    const event = this.createEvent("phase_failed", agent, message, {
      phase,
      status: "failed",
      evidence,
    });
    this.publish(event);
    this.popSpan();
  }

  toolStart(agent: string, toolName: string, message: string): string {
    const spanId = this.pushSpan();
    const event = this.createEvent("tool_start", agent, message, {
      status: "running",
    });
    this.publish(event);
    return spanId;
  }

  toolProgress(agent: string, message: string, progress: number, metrics?: TraceEvent["metrics"]): void {
    const event = this.createEvent("tool_progress", agent, message, {
      progress,
      metrics,
    });
    this.publish(event);
  }

  toolStdoutChunk(agent: string, chunk: string): void {
    const event = this.createEvent("tool_stdout_chunk", agent, chunk, {});
    this.publish(event);
  }

  toolEnd(agent: string, message: string, metrics?: TraceEvent["metrics"]): void {
    const event = this.createEvent("tool_end", agent, message, {
      status: "success",
      metrics,
    });
    this.publish(event);
    this.popSpan();
  }

  toolError(agent: string, message: string, evidence?: TraceEvent["evidence"]): void {
    const event = this.createEvent("tool_error", agent, message, {
      status: "failed",
      evidence,
    });
    this.publish(event);
    this.popSpan();
  }

  checkpoint(agent: string, message: string, metrics: TraceEvent["metrics"]): void {
    const event = this.createEvent("checkpoint", agent, message, {
      metrics,
    });
    this.publish(event);
  }

  contractViolation(agent: string, message: string, evidence: TraceEvent["evidence"]): void {
    const event = this.createEvent("contract_violation", agent, message, {
      status: "failed",
      evidence,
    });
    this.publish(event);
  }

  heartbeat(): void {
    const event = this.createEvent("heartbeat", "system", "ping", {});
    this.publish(event);
    this.flush();
  }

  retryScheduled(agent: string, message: string, attemptId: number, evidence?: TraceEvent["evidence"]): void {
    const event = this.createEvent("retry_scheduled", agent, message, {
      attempt_id: attemptId,
      evidence,
    });
    this.publish(event);
  }

  fallbackActivated(agent: string, message: string, evidence?: TraceEvent["evidence"]): void {
    const event = this.createEvent("fallback_activated", agent, message, {
      evidence,
    });
    this.publish(event);
  }

  sourceCollected(agent: string, doi: string, title: string, relevanceScore: number): void {
    const event = this.createEvent("source_collected", agent, `Collected: ${title.substring(0, 60)}...`, {
      evidence: {
        doi,
        doi_url: `https://doi.org/${doi}`,
        relevance_score: relevanceScore,
      },
    });
    this.publish(event);
  }

  sourceVerified(agent: string, doi: string, titleSimilarity: number): void {
    const event = this.createEvent("source_verified", agent, `Verified DOI: ${doi}`, {
      status: "success",
      evidence: {
        doi,
        doi_url: `https://doi.org/${doi}`,
        title_similarity: titleSimilarity,
      },
    });
    this.publish(event);
  }

  sourceRejected(agent: string, doi: string, reason: string): void {
    const event = this.createEvent("source_rejected", agent, `Rejected: ${reason}`, {
      status: "failed",
      evidence: {
        doi,
        fail_reason: reason,
      },
    });
    this.publish(event);
  }

  artifactCreated(agent: string, artifactType: string, name: string, url: string): void {
    const event = this.createEvent("artifact_created", agent, `Created ${artifactType}: ${name}`, {
      status: "success",
      evidence: {
        final_url: url,
      },
    });
    this.publish(event);
  }

  thought(agent: string, message: string, data?: { content: string }): void {
    const event = this.createEvent("thought", agent, message, {
      status: "running",
      data
    });
    this.publish(event);
  }

  progressUpdate(agent: string, progress: number, metrics: TraceEvent["metrics"]): void {
    const event = this.createEvent("progress_update", agent, `Progress: ${progress.toFixed(1)}%`, {
      progress,
      metrics,
    });
    this.publish(event);
  }

  searchProgress(agent: string, data: {
    provider: "openalex" | "crossref" | "semantic_scholar";
    query_idx: number;
    query_total: number;
    page: number;
    found: number;
    candidates_total: number;
  }): void {
    const event = this.createEvent("search_progress", agent,
      `Search ${data.provider}: query ${data.query_idx}/${data.query_total}, found ${data.found}`, {
      progress: (data.query_idx / data.query_total) * 100,
      metrics: {
        articles_collected: data.candidates_total,
        queries_current: data.query_idx,
        queries_total: data.query_total,
        pages_searched: data.page,
        candidates_found: data.candidates_total,
      },
    });
    this.publish(event);
  }

  filterProgress(agent: string, data: {
    regions: string[];
    geo_mismatch: number;
    year_out_of_range: number;
    duplicate: number;
    low_relevance: number;
  }): void {
    const total = data.geo_mismatch + data.year_out_of_range + data.duplicate + data.low_relevance;
    const event = this.createEvent("filter_progress", agent,
      `Filtering: ${total} removed (geo:${data.geo_mismatch}, year:${data.year_out_of_range}, dup:${data.duplicate}, rel:${data.low_relevance})`, {
      evidence: {
        fail_reason: `regions:${data.regions.join(",")};geo:${data.geo_mismatch};year:${data.year_out_of_range};dup:${data.duplicate};rel:${data.low_relevance}`,
      },
    });
    this.publish(event);
  }

  verifyProgress(agent: string, data: {
    checked: number;
    ok: number;
    dead: number;
  }): void {
    const event = this.createEvent("verify_progress", agent,
      `Verification: ${data.checked} checked, ${data.ok} ok, ${data.dead} dead`, {
      metrics: {
        articles_verified: data.ok,
      },
    });
    this.publish(event);
  }

  acceptedProgress(agent: string, data: {
    accepted: number;
    target: number;
  }): void {
    const progress = (data.accepted / data.target) * 100;
    const event = this.createEvent("accepted_progress", agent,
      `Accepted: ${data.accepted}/${data.target}`, {
      progress: Math.min(progress, 100),
      metrics: {
        articles_accepted: data.accepted,
      },
    });
    this.publish(event);
  }

  exportProgress(agent: string, data: {
    columns_count: number;
    rows_written: number;
    target: number;
  }): void {
    const progress = (data.rows_written / data.target) * 100;
    const event = this.createEvent("export_progress", agent,
      `Export: ${data.rows_written}/${data.target} rows (${data.columns_count} columns)`, {
      progress: Math.min(progress, 100),
      phase: "export",
    });
    this.publish(event);
  }

  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
    this.removeAllListeners();
  }
}

export function createTraceBus(runId: string, options?: TraceBusOptions): TraceBus {
  return new TraceBus(runId, options);
}
