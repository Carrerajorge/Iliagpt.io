import { EventEmitter } from "events";
import type { Response } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { agentEventBus } from "../eventBus";
import type { TraceEvent, TraceEventType } from "@shared/schema";

export const ActivityEventTypeSchema = z.enum([
  "run_created",
  "plan_generated",
  "tool_call_started",
  "tool_call_succeeded",
  "tool_call_failed",
  "agent_delegated",
  "artifact_created",
  "qa_passed",
  "qa_failed",
  "run_completed",
  "run_failed",
]);
export type ActivityEventType = z.infer<typeof ActivityEventTypeSchema>;

export const ToolCallEventPayloadSchema = z.object({
  toolName: z.string(),
  toolCallId: z.string().optional(),
  input: z.record(z.any()).optional(),
  inputPreview: z.string().optional(),
  status: z.enum(["started", "succeeded", "failed", "retrying"]),
  output: z.any().optional(),
  outputPreview: z.string().optional(),
  error: z.string().optional(),
  willRetry: z.boolean().optional(),
  retryCount: z.number().optional(),
  durationMs: z.number().optional(),
  stepIndex: z.number().optional(),
});
export type ToolCallEventPayload = z.infer<typeof ToolCallEventPayloadSchema>;

export const ArtifactEventPayloadSchema = z.object({
  artifactId: z.string(),
  type: z.enum(["file", "image", "document", "chart", "data", "preview", "link"]),
  name: z.string(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().optional(),
  downloadUrl: z.string().optional(),
  previewUrl: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});
export type ArtifactEventPayload = z.infer<typeof ArtifactEventPayloadSchema>;

export const PlanEventPayloadSchema = z.object({
  objective: z.string(),
  totalSteps: z.number(),
  estimatedDurationMs: z.number().optional(),
  steps: z.array(z.object({
    index: z.number(),
    toolName: z.string(),
    description: z.string(),
  })),
});
export type PlanEventPayload = z.infer<typeof PlanEventPayloadSchema>;

export const AgentDelegatedPayloadSchema = z.object({
  agentName: z.string(),
  agentRole: z.string().optional(),
  taskDescription: z.string().optional(),
  parentRunId: z.string().optional(),
  status: z.enum(["started", "completed", "failed"]).optional(),
});
export type AgentDelegatedPayload = z.infer<typeof AgentDelegatedPayloadSchema>;

export const QAResultPayloadSchema = z.object({
  passed: z.boolean(),
  checkName: z.string().optional(),
  message: z.string().optional(),
  details: z.record(z.any()).optional(),
  confidence: z.number().optional(),
});
export type QAResultPayload = z.infer<typeof QAResultPayloadSchema>;

export const RunStatusPayloadSchema = z.object({
  status: z.enum(["created", "running", "completed", "failed", "cancelled", "paused"]),
  message: z.string().optional(),
  summary: z.string().optional(),
  error: z.string().optional(),
  durationMs: z.number().optional(),
  completedSteps: z.number().optional(),
  totalSteps: z.number().optional(),
  artifactsCount: z.number().optional(),
});
export type RunStatusPayload = z.infer<typeof RunStatusPayloadSchema>;

export const ActivityEventPayloadSchema = z.union([
  ToolCallEventPayloadSchema,
  ArtifactEventPayloadSchema,
  PlanEventPayloadSchema,
  AgentDelegatedPayloadSchema,
  QAResultPayloadSchema,
  RunStatusPayloadSchema,
  z.record(z.any()),
]);
export type ActivityEventPayload = z.infer<typeof ActivityEventPayloadSchema>;

export const ActivityEventSchema = z.object({
  id: z.string(),
  type: ActivityEventTypeSchema,
  runId: z.string(),
  timestamp: z.number(),
  stepIndex: z.number().optional(),
  payload: ActivityEventPayloadSchema,
  metadata: z.record(z.any()).optional(),
});
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

interface SSEClient {
  id: string;
  res: Response;
  runId: string;
  connectedAt: number;
}

function writeSse(res: Response, event: string, data: object): boolean {
  try {
    const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    res.write(chunk);
    if (typeof (res as any).flush === "function") {
      (res as any).flush();
    }
    return true;
  } catch (err) {
    console.error("[ActivityStream] SSE write failed:", err);
    return false;
  }
}

function truncatePreview(value: unknown, maxLength: number = 200): string {
  if (value === null || value === undefined) return "";
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + "...";
}

export class ActivityStreamPublisher extends EventEmitter {
  private clients: Map<string, SSEClient> = new Map();
  private runClients: Map<string, Set<string>> = new Map();
  private eventHistory: Map<string, ActivityEvent[]> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly maxHistoryPerRun = 200;
  private eventBusListeners: Map<TraceEventType, (...args: any[]) => void> = new Map();

  constructor() {
    super();
    this.setMaxListeners(100);
    this.startHeartbeat();
    this.subscribeToEventBus();
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const [clientId, client] of this.clients) {
        try {
          writeSse(client.res, "heartbeat", { timestamp: now, runId: client.runId });
        } catch (error) {
          console.log(`[ActivityStream] Removing dead client ${clientId}`);
          this.removeClient(clientId);
        }
      }
    }, 30000);
  }

  private subscribeToEventBus(): void {
    const eventMappings: Array<{
      traceType: TraceEventType;
      activityType: ActivityEventType;
      transform: (event: TraceEvent) => ActivityEventPayload;
    }> = [
      {
        traceType: "task_start",
        activityType: "run_created",
        transform: (e) => ({
          status: "created" as const,
          message: "Run started",
        }),
      },
      {
        traceType: "plan_created",
        activityType: "plan_generated",
        transform: (e) => ({
          objective: e.plan?.objective || "",
          totalSteps: e.plan?.steps?.length || 0,
          steps: e.plan?.steps?.map((s, i) => ({
            index: s.index ?? i,
            toolName: s.toolName,
            description: s.description,
          })) || [],
        }),
      },
      {
        traceType: "tool_call_started",
        activityType: "tool_call_started",
        transform: (e) => ({
          toolName: e.tool_name || "unknown",
          toolCallId: e.stepId,
          inputPreview: truncatePreview(e.tool_input),
          status: "started" as const,
          stepIndex: e.stepIndex,
        }),
      },
      {
        traceType: "tool_call_succeeded",
        activityType: "tool_call_succeeded",
        transform: (e) => ({
          toolName: e.tool_name || "unknown",
          toolCallId: e.stepId,
          status: "succeeded" as const,
          outputPreview: truncatePreview(e.output_snippet),
          durationMs: e.metadata?.durationMs,
          stepIndex: e.stepIndex,
        }),
      },
      {
        traceType: "tool_call_failed",
        activityType: "tool_call_failed",
        transform: (e) => ({
          toolName: e.tool_name || "unknown",
          toolCallId: e.stepId,
          status: "failed" as const,
          error: e.error?.message || "Unknown error",
          willRetry: e.error?.retryable ?? false,
          retryCount: e.metadata?.retryCount,
          stepIndex: e.stepIndex,
        }),
      },
      {
        traceType: "agent_delegated",
        activityType: "agent_delegated",
        transform: (e) => ({
          agentName: e.metadata?.agentName || e.agent?.name || "sub-agent",
          agentRole: e.metadata?.role || e.agent?.role,
          taskDescription: e.metadata?.task,
          status: "started" as const,
        }),
      },
      {
        traceType: "artifact_created",
        activityType: "artifact_created",
        transform: (e) => ({
          artifactId: e.artifact?.id || randomUUID(),
          type: (e.artifact?.type || "file") as ArtifactEventPayload["type"],
          name: e.artifact?.name || "artifact",
          mimeType: e.artifact?.mimeType,
          sizeBytes: e.artifact?.size,
          downloadUrl: e.artifact?.url,
        }),
      },
      {
        traceType: "verification_passed",
        activityType: "qa_passed",
        transform: (e) => ({
          passed: true,
          checkName: e.metadata?.checkName || "QA Check",
          message: e.summary || "Verification passed",
          confidence: e.confidence,
        }),
      },
      {
        traceType: "verification_failed",
        activityType: "qa_failed",
        transform: (e) => ({
          passed: false,
          checkName: e.metadata?.checkName || "QA Check",
          message: e.error?.message || "Verification failed",
          details: e.error?.details,
        }),
      },
      {
        traceType: "done",
        activityType: "run_completed",
        transform: (e) => ({
          status: "completed" as const,
          summary: e.summary,
          durationMs: e.metadata?.durationMs,
          completedSteps: e.metadata?.completedSteps,
          totalSteps: e.metadata?.totalSteps,
          artifactsCount: e.metadata?.artifactsCount,
        }),
      },
      {
        traceType: "error",
        activityType: "run_failed",
        transform: (e) => ({
          status: "failed" as const,
          error: e.error?.message || "Unknown error",
          message: e.summary,
        }),
      },
    ];

    for (const mapping of eventMappings) {
      const listener = (traceEvent: TraceEvent) => {
        const activityEvent = this.createActivityEvent(
          mapping.activityType,
          traceEvent.runId,
          mapping.transform(traceEvent),
          traceEvent.stepIndex
        );
        this.publish(traceEvent.runId, activityEvent);
      };

      this.eventBusListeners.set(mapping.traceType, listener);
      agentEventBus.on(mapping.traceType, listener);
    }

    console.log(`[ActivityStream] Subscribed to ${eventMappings.length} eventBus events`);
  }

  private createActivityEvent(
    type: ActivityEventType,
    runId: string,
    payload: ActivityEventPayload,
    stepIndex?: number
  ): ActivityEvent {
    return {
      id: randomUUID(),
      type,
      runId,
      timestamp: Date.now(),
      stepIndex,
      payload,
    };
  }

  subscribe(runId: string, res: Response): string {
    const clientId = randomUUID();

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const client: SSEClient = {
      id: clientId,
      res,
      runId,
      connectedAt: Date.now(),
    };

    this.clients.set(clientId, client);

    if (!this.runClients.has(runId)) {
      this.runClients.set(runId, new Set());
    }
    this.runClients.get(runId)!.add(clientId);

    console.log(`[ActivityStream] Client ${clientId} subscribed to run ${runId}`);

    const history = this.eventHistory.get(runId) || [];
    for (const event of history) {
      writeSse(res, event.type, event);
    }

    writeSse(res, "subscribed", {
      clientId,
      runId,
      historyCount: history.length,
      timestamp: Date.now(),
    });

    res.on("close", () => {
      this.removeClient(clientId);
    });

    return clientId;
  }

  private removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      this.clients.delete(clientId);
      const runClients = this.runClients.get(client.runId);
      if (runClients) {
        runClients.delete(clientId);
        if (runClients.size === 0) {
          this.runClients.delete(client.runId);
        }
      }
      console.log(`[ActivityStream] Client ${clientId} disconnected from run ${client.runId}`);
    }
  }

  unsubscribe(runId: string, res: Response): void {
    for (const [clientId, client] of this.clients) {
      if (client.runId === runId && client.res === res) {
        this.removeClient(clientId);
        try {
          res.end();
        } catch {}
        return;
      }
    }
  }

  publish(runId: string, event: ActivityEvent): void {
    if (!this.eventHistory.has(runId)) {
      this.eventHistory.set(runId, []);
    }
    const history = this.eventHistory.get(runId)!;
    history.push(event);
    if (history.length > this.maxHistoryPerRun) {
      history.shift();
    }

    const clientIds = this.runClients.get(runId);
    if (!clientIds || clientIds.size === 0) {
      return;
    }

    const deadClients: string[] = [];
    for (const clientId of clientIds) {
      const client = this.clients.get(clientId);
      if (client) {
        const success = writeSse(client.res, event.type, event);
        if (!success) {
          deadClients.push(clientId);
        }
      }
    }

    for (const clientId of deadClients) {
      this.removeClient(clientId);
    }

    this.emit("published", event);
  }

  publishToolCallStarted(runId: string, payload: ToolCallEventPayload): void {
    const event = this.createActivityEvent("tool_call_started", runId, payload, payload.stepIndex);
    this.publish(runId, event);
  }

  publishToolCallSucceeded(runId: string, payload: ToolCallEventPayload): void {
    const event = this.createActivityEvent("tool_call_succeeded", runId, payload, payload.stepIndex);
    this.publish(runId, event);
  }

  publishToolCallFailed(runId: string, payload: ToolCallEventPayload): void {
    const event = this.createActivityEvent("tool_call_failed", runId, payload, payload.stepIndex);
    this.publish(runId, event);
  }

  publishArtifactCreated(runId: string, payload: ArtifactEventPayload): void {
    const event = this.createActivityEvent("artifact_created", runId, payload);
    this.publish(runId, event);
  }

  publishPlanGenerated(runId: string, payload: PlanEventPayload): void {
    const event = this.createActivityEvent("plan_generated", runId, payload);
    this.publish(runId, event);
  }

  publishAgentDelegated(runId: string, payload: AgentDelegatedPayload): void {
    const event = this.createActivityEvent("agent_delegated", runId, payload);
    this.publish(runId, event);
  }

  publishQAResult(runId: string, passed: boolean, payload: QAResultPayload): void {
    const eventType = passed ? "qa_passed" : "qa_failed";
    const event = this.createActivityEvent(eventType, runId, payload);
    this.publish(runId, event);
  }

  publishRunCreated(runId: string, payload: RunStatusPayload): void {
    const event = this.createActivityEvent("run_created", runId, payload);
    this.publish(runId, event);
  }

  publishRunCompleted(runId: string, payload: RunStatusPayload): void {
    const event = this.createActivityEvent("run_completed", runId, payload);
    this.publish(runId, event);
  }

  publishRunFailed(runId: string, payload: RunStatusPayload): void {
    const event = this.createActivityEvent("run_failed", runId, payload);
    this.publish(runId, event);
  }

  getHistory(runId: string): ActivityEvent[] {
    return this.eventHistory.get(runId) || [];
  }

  clearHistory(runId: string): void {
    this.eventHistory.delete(runId);
  }

  getSubscriberCount(runId?: string): number {
    if (runId) {
      return this.runClients.get(runId)?.size || 0;
    }
    return this.clients.size;
  }

  getActiveRuns(): string[] {
    return Array.from(this.runClients.keys());
  }

  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    for (const [traceType, listener] of this.eventBusListeners) {
      agentEventBus.off(traceType, listener);
    }
    this.eventBusListeners.clear();

    for (const client of this.clients.values()) {
      try {
        writeSse(client.res, "shutdown", { timestamp: Date.now() });
        client.res.end();
      } catch {}
    }

    this.clients.clear();
    this.runClients.clear();
    this.eventHistory.clear();

    console.log("[ActivityStream] Publisher shutdown complete");
  }
}

export const activityStreamPublisher = new ActivityStreamPublisher();
