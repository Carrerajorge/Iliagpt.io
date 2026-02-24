import { Router, Request, Response } from "express";
import { getStreamGateway } from "../agent/superAgent/tracing/StreamGateway";
import { TraceEmitter } from "../agent/superAgent/tracing/TraceEmitter";
import { getEventStore } from "../agent/superAgent/tracing/EventStore";
import { ExecutionEvent, ExecutionEventType } from "@shared/executionProtocol";
import { TraceEvent } from "../agent/superAgent/tracing/types";
import { AppError, catchAsync } from "../middleware/error";

const router = Router();

// Helper functions (moved from generic routes.ts)
function mapTraceEventType(eventType: string): ExecutionEventType {
  const mapping: Record<string, ExecutionEventType> = {
    run_started: "run_started",
    run_completed: "run_completed",
    run_failed: "run_failed",
    phase_started: "step_started",
    phase_completed: "step_completed",
    phase_failed: "step_failed",
    tool_start: "tool_call_started",
    tool_progress: "tool_call_progress",
    tool_stdout_chunk: "tool_call_chunk",
    tool_end: "tool_call_completed",
    tool_error: "tool_call_failed",
    checkpoint: "info",
    contract_violation: "warning",
    heartbeat: "heartbeat",
    retry_scheduled: "tool_call_retry",
    fallback_activated: "warning",
    source_collected: "info",
    source_verified: "info",
    source_rejected: "warning",
    artifact_created: "artifact_ready",
    progress_update: "step_progress",
  };
  return mapping[eventType] || "info";
}

function buildPayloadFromTraceEvent(event: TraceEvent): ExecutionEvent["payload"] {
  const basePayload = {
    message: event.message,
    agent: event.agent,
    phase: event.phase,
    status: event.status,
    progress: event.progress,
    ...(event.metrics || {}),
    ...(event.evidence || {}),
  };

  switch (event.event_type) {
    case "run_started":
      return {
        request_type: "research",
        request_summary: event.message,
        metadata: event.evidence,
      };
    case "run_completed":
      return {
        duration_ms: event.metrics?.latency_ms || 0,
        total_steps: event.metrics?.articles_verified || 0,
        completed_steps: event.metrics?.articles_accepted || 0,
        artifacts_count: 0,
        summary: event.message,
      };
    case "run_failed":
      return {
        error: event.message,
        error_code: event.evidence?.error_code,
        recoverable: false,
      };
    case "phase_started":
    case "phase_completed":
    case "phase_failed":
      return {
        step: {
          id: event.span_id,
          title: event.message,
          kind: "execute" as const,
          status: event.status === "success" ? "completed" : event.status === "failed" ? "failed" : "running",
          progress: event.progress,
        },
      };
    case "tool_start":
    case "tool_end":
    case "tool_error":
      return {
        call: {
          call_id: event.span_id,
          tool: event.node_id,
          summary: event.message,
          status: event.status === "success" ? "completed" : event.status === "failed" ? "failed" : "running",
          latency_ms: event.metrics?.latency_ms,
        },
      };
    case "tool_progress":
      return {
        call_id: event.span_id,
        progress: event.progress || 0,
        message: event.message,
      };
    case "tool_stdout_chunk":
      return {
        call_id: event.span_id,
        chunk: event.message,
      };
    case "artifact_created":
      return {
        artifact: {
          artifact_id: event.span_id,
          kind: "excel" as const,
          filename: event.message.replace(/^Created \w+: /, ""),
          mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          status: "ready" as const,
          download_url: event.evidence?.final_url,
        },
      };
    case "heartbeat":
      return {
        uptime_ms: Date.now() - event.ts,
      };
    case "progress_update":
      return {
        step_id: event.span_id,
        progress: event.progress || 0,
        message: event.message,
        items_processed: event.metrics?.articles_collected,
        items_total: event.metrics?.articles_verified,
      };
    default:
      return {
        message: event.message,
        details: { ...event.metrics, ...event.evidence },
      };
  }
}

// GET /api/runs/:runId - Get current run state
router.get("/:runId", catchAsync(async (req: Request, res: Response) => {
  const { runId } = req.params;
  const gateway = getStreamGateway();
  const traceBus = gateway.getRunBus(runId);

  if (!traceBus) {
    throw new AppError("Run not found", 404);
  }

  const emitter = traceBus as TraceEmitter;
  const metrics = emitter.getMetrics();
  const toolCalls = emitter.getToolCallsArray();

  const runningSteps = toolCalls.filter(tc => tc.status === "running" || tc.status === "streaming").length;

  let status: "pending" | "running" | "completed" | "failed" = "pending";
  if (runningSteps > 0) {
    status = "running";
  } else if (metrics.failedToolCalls > 0 && metrics.completedToolCalls === 0) {
    status = "failed";
  } else if (metrics.totalToolCalls > 0 && metrics.completedToolCalls === metrics.totalToolCalls) {
    status = "completed";
  } else if (metrics.totalToolCalls > 0) {
    status = "running";
  }

  const progress = metrics.totalToolCalls > 0
    ? Math.round((metrics.completedToolCalls / metrics.totalToolCalls) * 100)
    : 0;

  res.json({
    success: true,
    run_id: runId,
    status,
    progress,
    metrics: {
      total_tool_calls: metrics.totalToolCalls,
      completed_tool_calls: metrics.completedToolCalls,
      failed_tool_calls: metrics.failedToolCalls,
      total_artifacts: metrics.totalArtifacts,
      ready_artifacts: metrics.readyArtifacts,
    },
    counts: {
      steps: metrics.totalToolCalls,
      tool_calls: metrics.totalToolCalls,
      artifacts: metrics.totalArtifacts,
    },
  });
}));

// GET /api/runs/:runId/calls - List all tool calls for a run
router.get("/:runId/calls", catchAsync(async (req: Request, res: Response) => {
  const { runId } = req.params;
  const gateway = getStreamGateway();
  const traceBus = gateway.getRunBus(runId);

  if (!traceBus) {
    throw new AppError("Run not found", 404);
  }

  const emitter = traceBus as TraceEmitter;
  const toolCalls = emitter.getToolCallsArray();

  res.json({
    success: true,
    run_id: runId,
    count: toolCalls.length,
    calls: toolCalls,
  });
}));

// GET /api/runs/:runId/calls/:callId - Get specific tool call details
router.get("/:runId/calls/:callId", catchAsync(async (req: Request, res: Response) => {
  const { runId, callId } = req.params;
  const gateway = getStreamGateway();
  const traceBus = gateway.getRunBus(runId);

  if (!traceBus) {
    throw new AppError("Run not found", 404);
  }

  const emitter = traceBus as TraceEmitter;
  const toolCall = emitter.getToolCall(callId);

  if (!toolCall) {
    throw new AppError("Tool call not found", 404);
  }

  res.json({
    success: true,
    run_id: runId,
    call: toolCall,
  });
}));

// GET /api/runs/:runId/artifacts - List all artifacts for a run
router.get("/:runId/artifacts", catchAsync(async (req: Request, res: Response) => {
  const { runId } = req.params;
  const gateway = getStreamGateway();
  const traceBus = gateway.getRunBus(runId);

  if (!traceBus) {
    throw new AppError("Run not found", 404);
  }

  const emitter = traceBus as TraceEmitter;
  const artifacts = emitter.getArtifactsArray();

  res.json({
    success: true,
    run_id: runId,
    count: artifacts.length,
    artifacts,
  });
}));

// GET /api/runs/:runId/artifacts/:artifactId - Get specific artifact details
router.get("/:runId/artifacts/:artifactId", catchAsync(async (req: Request, res: Response) => {
  const { runId, artifactId } = req.params;
  const gateway = getStreamGateway();
  const traceBus = gateway.getRunBus(runId);

  if (!traceBus) {
    throw new AppError("Run not found", 404);
  }

  const emitter = traceBus as TraceEmitter;
  const artifact = emitter.getArtifact(artifactId);

  if (!artifact) {
    throw new AppError("Artifact not found", 404);
  }

  res.json({
    success: true,
    run_id: runId,
    artifact,
    download_url: artifact.download_url || null,
  });
}));

// GET /api/runs/:runId/stream - SSE endpoint for real-time execution events
router.get("/:runId/stream", (req: Request, res: Response) => {
  const { runId } = req.params;
  const lastEventId = req.headers["last-event-id"]
    ? parseInt(req.headers["last-event-id"] as string, 10)
    : 0;

  const gateway = getStreamGateway();
  const traceBus = gateway.getRunBus(runId);

  if (!traceBus) {
    return res.status(404).json({
      success: false,
      error: "Run not found",
      run_id: runId,
    });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  let seq = lastEventId;
  let closed = false;

  const sendEvent = (eventType: string, data: any, eventSeq?: number) => {
    if (closed) return;
    try {
      const eventId = eventSeq ?? ++seq;
      res.write(`id: ${eventId}\n`);
      res.write(`event: ${eventType}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) {
      console.error("[RunStream] Write error:", e);
    }
  };

  sendEvent("connected", {
    run_id: runId,
    message: "Connected to execution stream",
    ts: Date.now(),
  });

  const executionEventHandler = (event: ExecutionEvent) => {
    if (closed) return;
    sendEvent(event.type, event, event.seq);
  };

  const traceEventHandler = (event: any) => {
    if (closed) return;
    const execEvent: ExecutionEvent = {
      schema_version: "v1",
      run_id: event.run_id || runId,
      seq: event.seq || ++seq,
      ts: event.ts || Date.now(),
      type: mapTraceEventType(event.event_type),
      payload: buildPayloadFromTraceEvent(event),
    };
    sendEvent(execEvent.type, execEvent, execEvent.seq);
  };

  const emitter = traceBus as TraceEmitter;

  if (emitter.listenerCount && emitter.listenerCount("execution_event") >= 0) {
    emitter.on("execution_event", executionEventHandler);
  }
  emitter.on("trace", traceEventHandler);

  const heartbeatInterval = setInterval(() => {
    if (closed) return;
    sendEvent("heartbeat", {
      run_id: runId,
      ts: Date.now(),
    });
  }, 800);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeatInterval);
    emitter.off("execution_event", executionEventHandler);
    emitter.off("trace", traceEventHandler);
    console.log(`[RunStream] Client disconnected from run ${runId}`);
  };

  req.on("close", cleanup);
  req.on("error", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);
});

// GET /api/runs/:runId/events - Polling endpoint for execution events
router.get("/:runId/events", catchAsync(async (req: Request, res: Response) => {
  const { runId } = req.params;
  const after = parseInt(req.query.after as string, 10) || 0;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 1000);

  const gateway = getStreamGateway();
  const traceBus = gateway.getRunBus(runId);

  if (!traceBus) {
    const eventStore = getEventStore();
    const storedEvents = await eventStore.getEvents(runId, after, limit);

    if (storedEvents.length === 0) {
      throw new AppError("Run not found", 404);
    }

    const events: ExecutionEvent[] = storedEvents.map(traceEvent => ({
      schema_version: "v1",
      run_id: traceEvent.run_id,
      seq: traceEvent.seq,
      ts: traceEvent.ts,
      type: mapTraceEventType(traceEvent.event_type),
      payload: buildPayloadFromTraceEvent(traceEvent),
    }));

    return res.json({
      success: true,
      run_id: runId,
      events,
      count: events.length,
      last_seq: events.length > 0 ? events[events.length - 1].seq : after,
    });
  }

  const eventStore = getEventStore();
  const storedEvents = await eventStore.getEvents(runId, after, limit);

  const events: ExecutionEvent[] = storedEvents.map(traceEvent => ({
    schema_version: "v1",
    run_id: traceEvent.run_id,
    seq: traceEvent.seq,
    ts: traceEvent.ts,
    type: mapTraceEventType(traceEvent.event_type),
    payload: buildPayloadFromTraceEvent(traceEvent),
  }));

  res.json({
    success: true,
    run_id: runId,
    events,
    count: events.length,
    last_seq: events.length > 0 ? events[events.length - 1].seq : after,
  });
}));

export const createRunRouter = () => router;
