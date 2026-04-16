import { z } from "zod";

/**
 * ExecutionProtocol v1
 * 
 * A generalized protocol for streaming execution events that works for ANY request type,
 * not just academic articles. This provides typed events for real-time Process UI rendering.
 */

// ============================================================================
// Core Structures
// ============================================================================

export const StepStatusSchema = z.enum([
  "pending",
  "running", 
  "completed",
  "failed",
  "skipped",
  "cancelled"
]);

export const StepKindSchema = z.enum([
  "plan",
  "research",
  "execute",
  "validate",
  "generate",
  "transform",
  "aggregate",
  "deliver",
  "custom"
]);

export const StepSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: StepKindSchema,
  status: StepStatusSchema,
  progress: z.number().min(0).max(100).optional(),
  summary: z.string().optional(),
  inputs_preview: z.string().optional(),
  outputs_preview: z.string().optional(),
  started_at: z.number().optional(),
  completed_at: z.number().optional(),
  metrics: z.object({
    duration_ms: z.number().optional(),
    tokens_used: z.number().optional(),
    items_processed: z.number().optional(),
    errors_count: z.number().optional(),
  }).optional(),
});

export const ToolCallStatusSchema = z.enum([
  "pending",
  "running",
  "streaming",
  "completed",
  "failed",
  "retrying",
  "cancelled"
]);

export const ToolCallSchema = z.object({
  call_id: z.string(),
  tool: z.string(),
  summary: z.string(),
  status: ToolCallStatusSchema,
  started_at: z.number().optional(),
  completed_at: z.number().optional(),
  latency_ms: z.number().optional(),
  preview: z.string().optional(),
  error: z.string().optional(),
  retry_count: z.number().optional(),
  inputs: z.record(z.unknown()).optional(),
  outputs: z.record(z.unknown()).optional(),
});

export const ArtifactKindSchema = z.enum([
  "excel",
  "word",
  "pdf",
  "csv",
  "json",
  "image",
  "video",
  "audio",
  "archive",
  "code",
  "text",
  "markdown",
  "html",
  "presentation",
  "custom"
]);

export const ArtifactStatusSchema = z.enum([
  "declared",
  "generating",
  "ready",
  "failed"
]);

export const ArtifactSchema = z.object({
  artifact_id: z.string(),
  kind: ArtifactKindSchema,
  filename: z.string(),
  mime: z.string(),
  status: ArtifactStatusSchema,
  columns: z.array(z.string()).optional(),
  rows_count: z.number().optional(),
  size_bytes: z.number().optional(),
  progress: z.number().min(0).max(100).optional(),
  download_url: z.string().optional(),
  preview: z.string().optional(),
  created_at: z.number().optional(),
});

export const PlanSchema = z.object({
  plan_id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  steps: z.array(StepSchema),
  total_steps: z.number(),
  estimated_duration_ms: z.number().optional(),
});

// ============================================================================
// Event Types
// ============================================================================

export const ExecutionEventTypeSchema = z.enum([
  // Run lifecycle
  "run_started",
  "run_completed",
  "run_failed",
  "run_cancelled",
  
  // Plan events
  "plan_created",
  "plan_updated",
  
  // Step events
  "step_started",
  "step_progress",
  "step_completed",
  "step_failed",
  "step_skipped",
  
  // Tool call events
  "tool_call_started",
  "tool_call_chunk",
  "tool_call_progress",
  "tool_call_completed",
  "tool_call_failed",
  "tool_call_retry",
  
  // Artifact events
  "artifact_declared",
  "artifact_progress",
  "artifact_ready",
  "artifact_failed",
  
  // Status events
  "warning",
  "error",
  "info",
  "heartbeat",
]);

// ============================================================================
// Event Payloads
// ============================================================================

export const RunStartedPayloadSchema = z.object({
  request_type: z.string(),
  request_summary: z.string(),
  estimated_duration_ms: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const RunCompletedPayloadSchema = z.object({
  duration_ms: z.number(),
  total_steps: z.number(),
  completed_steps: z.number(),
  artifacts_count: z.number(),
  summary: z.string().optional(),
});

export const RunFailedPayloadSchema = z.object({
  error: z.string(),
  error_code: z.string().optional(),
  recoverable: z.boolean().optional(),
  step_id: z.string().optional(),
});

export const PlanCreatedPayloadSchema = z.object({
  plan: PlanSchema,
});

export const PlanUpdatedPayloadSchema = z.object({
  plan: PlanSchema,
  reason: z.string().optional(),
});

export const StepStartedPayloadSchema = z.object({
  step: StepSchema,
});

export const StepProgressPayloadSchema = z.object({
  step_id: z.string(),
  progress: z.number().min(0).max(100),
  message: z.string().optional(),
  items_processed: z.number().optional(),
  items_total: z.number().optional(),
});

export const StepCompletedPayloadSchema = z.object({
  step: StepSchema,
  outputs_summary: z.string().optional(),
});

export const StepFailedPayloadSchema = z.object({
  step_id: z.string(),
  error: z.string(),
  recoverable: z.boolean().optional(),
});

export const ToolCallStartedPayloadSchema = z.object({
  call: ToolCallSchema,
  step_id: z.string().optional(),
});

export const ToolCallChunkPayloadSchema = z.object({
  call_id: z.string(),
  chunk: z.string(),
  chunk_index: z.number().optional(),
});

export const ToolCallProgressPayloadSchema = z.object({
  call_id: z.string(),
  progress: z.number().min(0).max(100),
  message: z.string().optional(),
});

export const ToolCallCompletedPayloadSchema = z.object({
  call: ToolCallSchema,
  outputs_preview: z.string().optional(),
});

export const ToolCallFailedPayloadSchema = z.object({
  call_id: z.string(),
  error: z.string(),
  retry_scheduled: z.boolean().optional(),
  attempt: z.number().optional(),
});

export const ToolCallRetryPayloadSchema = z.object({
  call_id: z.string(),
  attempt: z.number(),
  max_attempts: z.number(),
  delay_ms: z.number(),
  reason: z.string().optional(),
});

export const ArtifactDeclaredPayloadSchema = z.object({
  artifact: ArtifactSchema,
  step_id: z.string().optional(),
});

export const ArtifactProgressPayloadSchema = z.object({
  artifact_id: z.string(),
  progress: z.number().min(0).max(100),
  rows_written: z.number().optional(),
  size_bytes: z.number().optional(),
  message: z.string().optional(),
});

export const ArtifactReadyPayloadSchema = z.object({
  artifact: ArtifactSchema,
});

export const ArtifactFailedPayloadSchema = z.object({
  artifact_id: z.string(),
  error: z.string(),
});

export const WarningPayloadSchema = z.object({
  code: z.string().optional(),
  message: z.string(),
  step_id: z.string().optional(),
  recoverable: z.boolean().optional(),
});

export const ErrorPayloadSchema = z.object({
  code: z.string().optional(),
  message: z.string(),
  step_id: z.string().optional(),
  fatal: z.boolean().optional(),
});

export const InfoPayloadSchema = z.object({
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});

export const HeartbeatPayloadSchema = z.object({
  uptime_ms: z.number(),
  memory_usage_mb: z.number().optional(),
});

// ============================================================================
// Base Event Schema
// ============================================================================

export const ExecutionEventSchema = z.object({
  schema_version: z.literal("v1"),
  run_id: z.string(),
  seq: z.number(),
  ts: z.number(),
  type: ExecutionEventTypeSchema,
  payload: z.union([
    RunStartedPayloadSchema,
    RunCompletedPayloadSchema,
    RunFailedPayloadSchema,
    PlanCreatedPayloadSchema,
    PlanUpdatedPayloadSchema,
    StepStartedPayloadSchema,
    StepProgressPayloadSchema,
    StepCompletedPayloadSchema,
    StepFailedPayloadSchema,
    ToolCallStartedPayloadSchema,
    ToolCallChunkPayloadSchema,
    ToolCallProgressPayloadSchema,
    ToolCallCompletedPayloadSchema,
    ToolCallFailedPayloadSchema,
    ToolCallRetryPayloadSchema,
    ArtifactDeclaredPayloadSchema,
    ArtifactProgressPayloadSchema,
    ArtifactReadyPayloadSchema,
    ArtifactFailedPayloadSchema,
    WarningPayloadSchema,
    ErrorPayloadSchema,
    InfoPayloadSchema,
    HeartbeatPayloadSchema,
  ]),
});

// ============================================================================
// Type Exports
// ============================================================================

export type StepStatus = z.infer<typeof StepStatusSchema>;
export type StepKind = z.infer<typeof StepKindSchema>;
export type Step = z.infer<typeof StepSchema>;
export type ToolCallStatus = z.infer<typeof ToolCallStatusSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
export type ArtifactStatus = z.infer<typeof ArtifactStatusSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type ExecutionEventType = z.infer<typeof ExecutionEventTypeSchema>;
export type ExecutionEvent = z.infer<typeof ExecutionEventSchema>;

// Payload types
export type RunStartedPayload = z.infer<typeof RunStartedPayloadSchema>;
export type RunCompletedPayload = z.infer<typeof RunCompletedPayloadSchema>;
export type RunFailedPayload = z.infer<typeof RunFailedPayloadSchema>;
export type PlanCreatedPayload = z.infer<typeof PlanCreatedPayloadSchema>;
export type PlanUpdatedPayload = z.infer<typeof PlanUpdatedPayloadSchema>;
export type StepStartedPayload = z.infer<typeof StepStartedPayloadSchema>;
export type StepProgressPayload = z.infer<typeof StepProgressPayloadSchema>;
export type StepCompletedPayload = z.infer<typeof StepCompletedPayloadSchema>;
export type StepFailedPayload = z.infer<typeof StepFailedPayloadSchema>;
export type ToolCallStartedPayload = z.infer<typeof ToolCallStartedPayloadSchema>;
export type ToolCallChunkPayload = z.infer<typeof ToolCallChunkPayloadSchema>;
export type ToolCallProgressPayload = z.infer<typeof ToolCallProgressPayloadSchema>;
export type ToolCallCompletedPayload = z.infer<typeof ToolCallCompletedPayloadSchema>;
export type ToolCallFailedPayload = z.infer<typeof ToolCallFailedPayloadSchema>;
export type ToolCallRetryPayload = z.infer<typeof ToolCallRetryPayloadSchema>;
export type ArtifactDeclaredPayload = z.infer<typeof ArtifactDeclaredPayloadSchema>;
export type ArtifactProgressPayload = z.infer<typeof ArtifactProgressPayloadSchema>;
export type ArtifactReadyPayload = z.infer<typeof ArtifactReadyPayloadSchema>;
export type ArtifactFailedPayload = z.infer<typeof ArtifactFailedPayloadSchema>;
export type WarningPayload = z.infer<typeof WarningPayloadSchema>;
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;
export type InfoPayload = z.infer<typeof InfoPayloadSchema>;
export type HeartbeatPayload = z.infer<typeof HeartbeatPayloadSchema>;

// ============================================================================
// Run State (for frontend state machine)
// ============================================================================

export const RunStatusSchema = z.enum([
  "idle",
  "connecting",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled"
]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

export interface RunState {
  run_id: string;
  status: RunStatus;
  plan: Plan | null;
  steps: Map<string, Step>;
  tool_calls: Map<string, ToolCall>;
  artifacts: Map<string, Artifact>;
  events: ExecutionEvent[];
  progress: number;
  current_step_id: string | null;
  error: string | null;
  started_at: number | null;
  completed_at: number | null;
  metrics: {
    total_tool_calls: number;
    completed_tool_calls: number;
    failed_tool_calls: number;
    total_duration_ms: number;
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

export function createInitialRunState(runId: string): RunState {
  return {
    run_id: runId,
    status: "idle",
    plan: null,
    steps: new Map(),
    tool_calls: new Map(),
    artifacts: new Map(),
    events: [],
    progress: 0,
    current_step_id: null,
    error: null,
    started_at: null,
    completed_at: null,
    metrics: {
      total_tool_calls: 0,
      completed_tool_calls: 0,
      failed_tool_calls: 0,
      total_duration_ms: 0,
    },
  };
}

export function reduceEvent(state: RunState, event: ExecutionEvent): RunState {
  const newState = { ...state };
  newState.events = [...state.events, event];

  switch (event.type) {
    case "run_started": {
      const payload = event.payload as RunStartedPayload;
      newState.status = "running";
      newState.started_at = event.ts;
      break;
    }

    case "run_completed": {
      const payload = event.payload as RunCompletedPayload;
      newState.status = "completed";
      newState.completed_at = event.ts;
      newState.progress = 100;
      newState.metrics.total_duration_ms = payload.duration_ms;
      break;
    }

    case "run_failed": {
      const payload = event.payload as RunFailedPayload;
      newState.status = "failed";
      newState.error = payload.error;
      newState.completed_at = event.ts;
      break;
    }

    case "run_cancelled": {
      newState.status = "cancelled";
      newState.completed_at = event.ts;
      break;
    }

    case "plan_created":
    case "plan_updated": {
      const payload = event.payload as PlanCreatedPayload;
      newState.plan = payload.plan;
      newState.steps = new Map();
      for (const step of payload.plan.steps) {
        newState.steps.set(step.id, step);
      }
      break;
    }

    case "step_started": {
      const payload = event.payload as StepStartedPayload;
      newState.steps.set(payload.step.id, payload.step);
      newState.current_step_id = payload.step.id;
      break;
    }

    case "step_progress": {
      const payload = event.payload as StepProgressPayload;
      const step = newState.steps.get(payload.step_id);
      if (step) {
        newState.steps.set(payload.step_id, {
          ...step,
          progress: payload.progress,
        });
      }
      // Update overall progress based on completed steps
      if (newState.plan) {
        const completedSteps = Array.from(newState.steps.values()).filter(
          s => s.status === "completed"
        ).length;
        const currentProgress = payload.progress / 100;
        newState.progress = Math.round(
          ((completedSteps + currentProgress) / newState.plan.total_steps) * 100
        );
      }
      break;
    }

    case "step_completed": {
      const payload = event.payload as StepCompletedPayload;
      newState.steps.set(payload.step.id, payload.step);
      // Update progress
      if (newState.plan) {
        const completedSteps = Array.from(newState.steps.values()).filter(
          s => s.status === "completed"
        ).length;
        newState.progress = Math.round((completedSteps / newState.plan.total_steps) * 100);
      }
      break;
    }

    case "step_failed": {
      const payload = event.payload as StepFailedPayload;
      const step = newState.steps.get(payload.step_id);
      if (step) {
        newState.steps.set(payload.step_id, {
          ...step,
          status: "failed",
        });
      }
      break;
    }

    case "tool_call_started": {
      const payload = event.payload as ToolCallStartedPayload;
      newState.tool_calls.set(payload.call.call_id, payload.call);
      newState.metrics.total_tool_calls++;
      break;
    }

    case "tool_call_progress": {
      const payload = event.payload as ToolCallProgressPayload;
      const call = newState.tool_calls.get(payload.call_id);
      if (call) {
        newState.tool_calls.set(payload.call_id, {
          ...call,
          preview: payload.message || call.preview,
        });
      }
      break;
    }

    case "tool_call_completed": {
      const payload = event.payload as ToolCallCompletedPayload;
      newState.tool_calls.set(payload.call.call_id, payload.call);
      newState.metrics.completed_tool_calls++;
      break;
    }

    case "tool_call_failed": {
      const payload = event.payload as ToolCallFailedPayload;
      const call = newState.tool_calls.get(payload.call_id);
      if (call) {
        newState.tool_calls.set(payload.call_id, {
          ...call,
          status: "failed",
          error: payload.error,
        });
      }
      if (!payload.retry_scheduled) {
        newState.metrics.failed_tool_calls++;
      }
      break;
    }

    case "artifact_declared": {
      const payload = event.payload as ArtifactDeclaredPayload;
      newState.artifacts.set(payload.artifact.artifact_id, payload.artifact);
      break;
    }

    case "artifact_progress": {
      const payload = event.payload as ArtifactProgressPayload;
      const artifact = newState.artifacts.get(payload.artifact_id);
      if (artifact) {
        newState.artifacts.set(payload.artifact_id, {
          ...artifact,
          status: "generating",
          progress: payload.progress,
          rows_count: payload.rows_written ?? artifact.rows_count,
          size_bytes: payload.size_bytes ?? artifact.size_bytes,
        });
      }
      break;
    }

    case "artifact_ready": {
      const payload = event.payload as ArtifactReadyPayload;
      newState.artifacts.set(payload.artifact.artifact_id, payload.artifact);
      break;
    }

    case "artifact_failed": {
      const payload = event.payload as ArtifactFailedPayload;
      const artifact = newState.artifacts.get(payload.artifact_id);
      if (artifact) {
        newState.artifacts.set(payload.artifact_id, {
          ...artifact,
          status: "failed",
        });
      }
      break;
    }

    case "warning": {
      // Warnings don't change state but are recorded in events
      break;
    }

    case "error": {
      const payload = event.payload as ErrorPayload;
      if (payload.fatal) {
        newState.status = "failed";
        newState.error = payload.message;
      }
      break;
    }
  }

  return newState;
}

// ============================================================================
// Event Factory Functions
// ============================================================================

let globalSeq = 0;

export function createEvent<T extends ExecutionEventType>(
  runId: string,
  type: T,
  payload: ExecutionEvent["payload"]
): ExecutionEvent {
  return {
    schema_version: "v1",
    run_id: runId,
    seq: ++globalSeq,
    ts: Date.now(),
    type,
    payload,
  };
}

export function resetEventSequence(): void {
  globalSeq = 0;
}
