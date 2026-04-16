import { TraceBus } from "./TraceBus";
import type {
  ExecutionEvent,
  ExecutionEventType,
  Plan,
  Step,
  StepKind,
  ToolCall,
  Artifact,
  RunStartedPayload,
  PlanCreatedPayload,
  StepStartedPayload,
  StepProgressPayload,
  StepCompletedPayload,
  ToolCallStartedPayload,
  ToolCallChunkPayload,
  ToolCallCompletedPayload,
  ToolCallFailedPayload,
  ArtifactDeclaredPayload,
  ArtifactProgressPayload,
  ArtifactReadyPayload,
  WarningPayload,
  ErrorPayload,
} from "../../../../shared/executionProtocol";
import type { TraceEvent } from "./types";

type TraceBusPhase = TraceEvent["phase"];

interface TraceEmitterOptions {
  maxListeners?: number;
  bufferSize?: number;
  flushIntervalMs?: number;
}

const STEP_KIND_TO_PHASE: Record<StepKind, NonNullable<TraceBusPhase>> = {
  plan: "planning",
  research: "signals",
  execute: "enrichment",
  validate: "verification",
  generate: "export",
  transform: "enrichment",
  aggregate: "enrichment",
  deliver: "finalization",
  custom: "enrichment",
};

export class TraceEmitter extends TraceBus {
  private execSequence: number = 0;
  private toolCalls: Map<string, ToolCall> = new Map();
  private artifacts: Map<string, Artifact> = new Map();
  private startedAt: number | null = null;

  constructor(runId: string, options: TraceEmitterOptions = {}) {
    super(runId, options);
  }

  private nextExecSequence(): number {
    return ++this.execSequence;
  }

  private createExecutionEvent<T extends ExecutionEventType>(
    type: T,
    payload: ExecutionEvent["payload"]
  ): ExecutionEvent {
    return {
      schema_version: "v1",
      run_id: this.getRunId(),
      seq: this.nextExecSequence(),
      ts: Date.now(),
      type,
      payload,
    };
  }

  private publishExecutionEvent(event: ExecutionEvent): void {
    this.emit("execution_event", event);
    this.emit("trace", event);
  }

  private mapStepKindToPhase(kind: StepKind): NonNullable<TraceBusPhase> {
    return STEP_KIND_TO_PHASE[kind] || "enrichment";
  }

  emitRunStarted(requestType: string, summary: string, estimatedDurationMs?: number, metadata?: Record<string, unknown>): void {
    this.startedAt = Date.now();
    const payload: RunStartedPayload = {
      request_type: requestType,
      request_summary: summary,
      estimated_duration_ms: estimatedDurationMs,
      metadata,
    };
    const event = this.createExecutionEvent("run_started", payload);
    this.publishExecutionEvent(event);
    this.runStarted("system", summary);
  }

  emitRunCompleted(totalSteps: number, completedSteps: number, summary?: string): void {
    const durationMs = this.startedAt ? Date.now() - this.startedAt : 0;
    const payload = {
      duration_ms: durationMs,
      total_steps: totalSteps,
      completed_steps: completedSteps,
      artifacts_count: this.artifacts.size,
      summary,
    };
    const event = this.createExecutionEvent("run_completed", payload);
    this.publishExecutionEvent(event);
    this.runCompleted("system", summary || "Run completed", {
      latency_ms: durationMs,
    });
  }

  emitRunFailed(error: string, errorCode?: string, recoverable?: boolean, stepId?: string): void {
    const payload = {
      error,
      error_code: errorCode,
      recoverable,
      step_id: stepId,
    };
    const event = this.createExecutionEvent("run_failed", payload);
    this.publishExecutionEvent(event);
    this.runFailed("system", error, {
      error_code: errorCode,
      fail_reason: error,
    });
  }

  emitPlanCreated(plan: Plan): void {
    const payload: PlanCreatedPayload = { plan };
    const event = this.createExecutionEvent("plan_created", payload);
    this.publishExecutionEvent(event);
    this.phaseStarted("planner", "planning", `Plan created: ${plan.title}`);
  }

  emitPlanUpdated(plan: Plan, reason?: string): void {
    const payload = { plan, reason };
    const event = this.createExecutionEvent("plan_updated", payload);
    this.publishExecutionEvent(event);
  }

  emitStepStarted(step: Step): void {
    const payload: StepStartedPayload = { step };
    const event = this.createExecutionEvent("step_started", payload);
    this.publishExecutionEvent(event);
    const phase = this.mapStepKindToPhase(step.kind);
    this.phaseStarted("executor", phase, `Step started: ${step.title}`);
  }

  emitStepProgress(stepId: string, progress: number, message?: string, itemsProcessed?: number, itemsTotal?: number): void {
    const payload: StepProgressPayload = {
      step_id: stepId,
      progress,
      message,
      items_processed: itemsProcessed,
      items_total: itemsTotal,
    };
    const event = this.createExecutionEvent("step_progress", payload);
    this.publishExecutionEvent(event);
    this.progressUpdate("executor", progress, {
      articles_collected: itemsProcessed,
    });
  }

  emitStepCompleted(step: Step, outputsSummary?: string): void {
    const payload: StepCompletedPayload = {
      step,
      outputs_summary: outputsSummary,
    };
    const event = this.createExecutionEvent("step_completed", payload);
    this.publishExecutionEvent(event);
    const phase = this.mapStepKindToPhase(step.kind);
    this.phaseCompleted("executor", phase, `Step completed: ${step.title}`, {
      latency_ms: step.metrics?.duration_ms,
    });
  }

  emitStepFailed(stepId: string, error: string, recoverable?: boolean): void {
    const payload = {
      step_id: stepId,
      error,
      recoverable,
    };
    const event = this.createExecutionEvent("step_failed", payload);
    this.publishExecutionEvent(event);
    this.phaseFailed("executor", "enrichment", error, {
      fail_reason: error,
    });
  }

  emitToolCallStarted(call: ToolCall, stepId?: string): void {
    this.toolCalls.set(call.call_id, call);
    const payload: ToolCallStartedPayload = {
      call,
      step_id: stepId,
    };
    const event = this.createExecutionEvent("tool_call_started", payload);
    this.publishExecutionEvent(event);
    this.toolStart("tools", call.tool, `Tool started: ${call.summary}`);
  }

  emitToolCallChunk(callId: string, chunk: string, chunkIndex?: number): void {
    const payload: ToolCallChunkPayload = {
      call_id: callId,
      chunk,
      chunk_index: chunkIndex,
    };
    const event = this.createExecutionEvent("tool_call_chunk", payload);
    this.publishExecutionEvent(event);
    this.toolStdoutChunk("tools", chunk);
  }

  emitToolCallProgress(callId: string, progress: number, message?: string): void {
    const existing = this.toolCalls.get(callId);
    if (existing) {
      this.toolCalls.set(callId, {
        ...existing,
        preview: message || existing.preview,
      });
    }
    const payload = {
      call_id: callId,
      progress,
      message,
    };
    const event = this.createExecutionEvent("tool_call_progress", payload);
    this.publishExecutionEvent(event);
    this.toolProgress("tools", message || `Progress: ${progress}%`, progress);
  }

  emitToolCallCompleted(call: ToolCall, outputsPreview?: string): void {
    this.toolCalls.set(call.call_id, call);
    const payload: ToolCallCompletedPayload = {
      call,
      outputs_preview: outputsPreview,
    };
    const event = this.createExecutionEvent("tool_call_completed", payload);
    this.publishExecutionEvent(event);
    this.toolEnd("tools", `Tool completed: ${call.summary}`, {
      latency_ms: call.latency_ms,
    });
  }

  emitToolCallFailed(callId: string, error: string, retryScheduled?: boolean, attempt?: number): void {
    const existing = this.toolCalls.get(callId);
    if (existing) {
      this.toolCalls.set(callId, {
        ...existing,
        status: retryScheduled ? "retrying" : "failed",
        error,
        retry_count: attempt,
      });
    }
    const payload: ToolCallFailedPayload = {
      call_id: callId,
      error,
      retry_scheduled: retryScheduled,
      attempt,
    };
    const event = this.createExecutionEvent("tool_call_failed", payload);
    this.publishExecutionEvent(event);
    if (retryScheduled) {
      this.retryScheduled("tools", error, attempt || 1);
    } else {
      this.toolError("tools", error, {
        fail_reason: error,
      });
    }
  }

  emitToolCallRetry(callId: string, attempt: number, maxAttempts: number, delayMs: number, reason?: string): void {
    const payload = {
      call_id: callId,
      attempt,
      max_attempts: maxAttempts,
      delay_ms: delayMs,
      reason,
    };
    const event = this.createExecutionEvent("tool_call_retry", payload);
    this.publishExecutionEvent(event);
    this.retryScheduled("tools", reason || `Retry attempt ${attempt}/${maxAttempts}`, attempt);
  }

  emitArtifactDeclared(artifact: Artifact, stepId?: string): void {
    this.artifacts.set(artifact.artifact_id, artifact);
    const payload: ArtifactDeclaredPayload = {
      artifact,
      step_id: stepId,
    };
    const event = this.createExecutionEvent("artifact_declared", payload);
    this.publishExecutionEvent(event);
  }

  emitArtifactProgress(artifactId: string, progress: number, details?: { rowsWritten?: number; sizeBytes?: number; message?: string }): void {
    const existing = this.artifacts.get(artifactId);
    if (existing) {
      this.artifacts.set(artifactId, {
        ...existing,
        status: "generating",
        progress,
        rows_count: details?.rowsWritten ?? existing.rows_count,
        size_bytes: details?.sizeBytes ?? existing.size_bytes,
      });
    }
    const payload: ArtifactProgressPayload = {
      artifact_id: artifactId,
      progress,
      rows_written: details?.rowsWritten,
      size_bytes: details?.sizeBytes,
      message: details?.message,
    };
    const event = this.createExecutionEvent("artifact_progress", payload);
    this.publishExecutionEvent(event);
    this.progressUpdate("artifacts", progress, {
      bytes_out: details?.sizeBytes,
    });
  }

  emitArtifactReady(artifact: Artifact): void {
    this.artifacts.set(artifact.artifact_id, artifact);
    const payload = { artifact };
    const event = this.createExecutionEvent("artifact_ready", payload);
    this.publishExecutionEvent(event);
    this.artifactCreated(
      "artifacts",
      artifact.kind,
      artifact.filename,
      artifact.download_url || ""
    );
  }

  emitArtifactFailed(artifactId: string, error: string): void {
    const existing = this.artifacts.get(artifactId);
    if (existing) {
      this.artifacts.set(artifactId, {
        ...existing,
        status: "failed",
      });
    }
    const payload = {
      artifact_id: artifactId,
      error,
    };
    const event = this.createExecutionEvent("artifact_failed", payload);
    this.publishExecutionEvent(event);
  }

  emitWarning(message: string, code?: string, stepId?: string, recoverable?: boolean): void {
    const payload: WarningPayload = {
      message,
      code,
      step_id: stepId,
      recoverable,
    };
    const event = this.createExecutionEvent("warning", payload);
    this.publishExecutionEvent(event);
  }

  emitError(message: string, code?: string, fatal?: boolean, stepId?: string): void {
    const payload: ErrorPayload = {
      message,
      code,
      step_id: stepId,
      fatal,
    };
    const event = this.createExecutionEvent("error", payload);
    this.publishExecutionEvent(event);
    if (fatal) {
      this.runFailed("system", message, {
        error_code: code,
        fail_reason: message,
      });
    }
  }

  emitInfo(message: string, details?: Record<string, unknown>): void {
    const payload = { message, details };
    const event = this.createExecutionEvent("info", payload);
    this.publishExecutionEvent(event);
  }

  emitHeartbeat(uptimeMs: number, memoryUsageMb?: number): void {
    const payload = {
      uptime_ms: uptimeMs,
      memory_usage_mb: memoryUsageMb,
    };
    const event = this.createExecutionEvent("heartbeat", payload);
    this.publishExecutionEvent(event);
    this.heartbeat();
  }

  getToolCall(callId: string): ToolCall | undefined {
    return this.toolCalls.get(callId);
  }

  getArtifact(artifactId: string): Artifact | undefined {
    return this.artifacts.get(artifactId);
  }

  getAllToolCalls(): Map<string, ToolCall> {
    return new Map(this.toolCalls);
  }

  getAllArtifacts(): Map<string, Artifact> {
    return new Map(this.artifacts);
  }

  getToolCallsArray(): ToolCall[] {
    return Array.from(this.toolCalls.values());
  }

  getArtifactsArray(): Artifact[] {
    return Array.from(this.artifacts.values());
  }

  getMetrics(): {
    totalToolCalls: number;
    completedToolCalls: number;
    failedToolCalls: number;
    totalArtifacts: number;
    readyArtifacts: number;
  } {
    const toolCallsList = Array.from(this.toolCalls.values());
    const artifactsList = Array.from(this.artifacts.values());

    return {
      totalToolCalls: this.toolCalls.size,
      completedToolCalls: toolCallsList.filter(tc => tc.status === "completed").length,
      failedToolCalls: toolCallsList.filter(tc => tc.status === "failed").length,
      totalArtifacts: this.artifacts.size,
      readyArtifacts: artifactsList.filter(a => a.status === "ready").length,
    };
  }

  clearState(): void {
    this.toolCalls.clear();
    this.artifacts.clear();
    this.execSequence = 0;
    this.startedAt = null;
  }

  override destroy(): void {
    this.clearState();
    super.destroy();
  }
}

export function createTraceEmitter(runId: string, options?: TraceEmitterOptions): TraceEmitter {
  return new TraceEmitter(runId, options);
}
