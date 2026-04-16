/**
 * Orchestrator Bridge — Connects AgenticStateGraph to the existing
 * AgentOrchestrator/AgentPipeline execution flow.
 *
 * This bridges the new state machine with the existing infrastructure:
 *   - Maps state transitions to existing event bus events
 *   - Drives the plan → execute → verify loop via the state graph
 *   - Integrates with existing tool registry, persistence, and SSE
 */

import { randomUUID } from "crypto";
import {
  AgenticStateGraph,
  createStateGraph,
  type PlanSpec,
  type PlanStepSpec,
  type StepResultEntry,
  type ArtifactEntry,
  type EvidenceEntry,
} from "./agenticStateGraph";
import { type TaskModel, assessRisk } from "./taskModel";
import { agentEventBus } from "../eventBus";
import type { TraceEventType } from "@shared/schema";
import { cleanupRunResources } from "./agenticToolRegistrations";

/* ------------------------------------------------------------------ */
/*  Bridge Configuration                                              */
/* ------------------------------------------------------------------ */

export interface BridgeConfig {
  enableStateTracking: boolean;
  enableEscalation: boolean;
  maxRetries: number;
  maxReplans: number;
  strategyAutoSwitch: boolean;
}

const DEFAULT_BRIDGE_CONFIG: BridgeConfig = {
  enableStateTracking: true,
  enableEscalation: true,
  maxRetries: 3,
  maxReplans: 2,
  strategyAutoSwitch: true,
};

/* ------------------------------------------------------------------ */
/*  Active Graphs Registry                                            */
/* ------------------------------------------------------------------ */

const activeGraphs = new Map<string, AgenticStateGraph>();

export function getActiveGraph(runId: string): AgenticStateGraph | undefined {
  return activeGraphs.get(runId);
}

export function listActiveGraphs(): Array<{ runId: string; state: string; goal: string }> {
  return Array.from(activeGraphs.entries()).map(([runId, graph]) => ({
    runId,
    state: graph.getState(),
    goal: graph.getContext().task.goal,
  }));
}

/* ------------------------------------------------------------------ */
/*  Bridge: Create & Attach Graph to a Run                            */
/* ------------------------------------------------------------------ */

/**
 * Create an AgenticStateGraph for a run and attach it to the event bus.
 * Returns the graph instance.
 */
export function createGraphForRun(
  runId: string,
  goal: string,
  userId: string,
  options?: {
    chatId?: string;
    userPlan?: "free" | "pro" | "admin";
    tools?: string[];
    config?: Partial<BridgeConfig>;
    attachments?: Array<{ name: string; type?: string; path?: string; url?: string }>;
    conversationHistory?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  }
): AgenticStateGraph {
  const config = { ...DEFAULT_BRIDGE_CONFIG, ...options?.config };

  const graph = createStateGraph(goal, userId, {
    chatId: options?.chatId,
    runId,
    userPlan: options?.userPlan,
    tools: options?.tools,
    attachments: options?.attachments,
    conversationHistory: options?.conversationHistory,
    budget: {
      maxRetriesPerStep: config.maxRetries,
      maxReplans: config.maxReplans,
    },
  });

  // Wire state changes to event bus
  graph.on("state_change", async (event) => {
    try {
      await agentEventBus.emit(runId, "thinking" as TraceEventType, {
        output_snippet: `[State] ${event.previousState} → ${event.state} (${event.reason})`,
        metadata: {
          graphId: graph.id,
          state: event.state,
          previousState: event.previousState,
          reason: event.reason,
        },
      });
    } catch (err) {
      console.warn(`[orchestratorBridge] state_change emission failed for run ${runId}:`, err);
    }
  });

  graph.on("plan_created", async (event) => {
    try {
      const plan = event.data?.plan;
      if (plan) {
        await agentEventBus.emit(runId, "plan_created" as TraceEventType, {
          plan: {
            objective: plan.objective,
            steps: plan.steps.map((s: PlanStepSpec) => ({
              index: s.index,
              toolName: s.toolName,
              description: s.description,
            })),
            estimatedTime: `${Math.ceil(plan.estimatedTimeMs / 1000)}s`,
          },
        });
      }
    } catch (err) {
      console.warn(`[orchestratorBridge] plan_created emission failed for run ${runId}:`, err);
    }
  });

  graph.on("step_end", async (event) => {
    try {
      const result = event.data?.result as StepResultEntry | undefined;
      if (result) {
        await agentEventBus.emit(runId, "tool_output" as TraceEventType, {
          stepIndex: result.stepIndex,
          tool_name: result.toolName,
          output_snippet: typeof result.output === "string"
            ? result.output.slice(0, 500)
            : JSON.stringify(result.output).slice(0, 500),
          status: result.success ? "completed" : "failed",
        });
      }
    } catch (err) {
      console.warn(`[orchestratorBridge] step_end emission failed for run ${runId}:`, err);
    }
  });

  graph.on("done", async (event) => {
    try {
      await agentEventBus.emit(runId, "done" as TraceEventType, {
        summary: event.data?.summary || "Task completed",
        metadata: graph.toJSON(),
      });
    } catch (err) {
      console.warn(`[orchestratorBridge] done emission failed for run ${runId}:`, err);
    }
  });

  graph.on("error", async (event) => {
    try {
      await agentEventBus.emit(runId, "error" as TraceEventType, {
        error: {
          message: event.data?.message || "Unknown error",
          code: event.data?.code || "GRAPH_ERROR",
        },
      });
    } catch (err) {
      console.warn(`[orchestratorBridge] error emission failed for run ${runId}:`, err);
    }
  });

  activeGraphs.set(runId, graph);
  return graph;
}

/* ------------------------------------------------------------------ */
/*  Bridge: Convert existing plan to graph PlanSpec                   */
/* ------------------------------------------------------------------ */

export function convertPlanToSpec(
  plan: { objective: string; steps: Array<{ toolName: string; description: string; input: any; expectedOutput?: string }> }
): PlanSpec {
  return {
    id: randomUUID(),
    objective: plan.objective,
    steps: plan.steps.map((s, i) => ({
      index: i,
      toolName: s.toolName,
      description: s.description,
      input: s.input || {},
      expectedOutput: s.expectedOutput || "",
      dependsOn: [],
    })),
    estimatedTimeMs: plan.steps.length * 10_000, // 10s per step estimate
  };
}

/* ------------------------------------------------------------------ */
/*  Bridge: Record tool result into graph                             */
/* ------------------------------------------------------------------ */

export function recordToolResult(
  runId: string,
  stepIndex: number,
  toolName: string,
  result: {
    success: boolean;
    output: any;
    error?: string;
    artifacts?: Array<{ type: string; name: string; url?: string; data?: any }>;
  },
  durationMs: number
): void {
  const graph = activeGraphs.get(runId);
  if (!graph) return;

  const artifacts: ArtifactEntry[] = (result.artifacts || []).map((a) => ({
    id: randomUUID(),
    type: a.type,
    name: a.name,
    url: a.url,
    data: a.data,
    createdAt: Date.now(),
  }));

  graph.recordStepResult({
    stepIndex,
    toolName,
    success: result.success,
    output: result.output,
    error: result.error,
    durationMs,
    artifacts,
    evidence: [],
  });
}

/* ------------------------------------------------------------------ */
/*  Bridge: State transition helpers                                  */
/* ------------------------------------------------------------------ */

export function transitionToPlanning(runId: string): boolean {
  const graph = activeGraphs.get(runId);
  if (!graph) return false;
  try {
    if (graph.getState() === "IDLE") {
      graph.transition("PLAN", "task_received");
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function transitionToExecuting(runId: string): boolean {
  const graph = activeGraphs.get(runId);
  if (!graph) return false;
  try {
    if (graph.canTransitionTo("ACT", "plan_complete")) {
      graph.transition("ACT", "plan_complete");
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function transitionToVerifying(runId: string): boolean {
  const graph = activeGraphs.get(runId);
  if (!graph) return false;
  try {
    if (graph.canTransitionTo("VERIFY", "all_steps_done")) {
      graph.transition("VERIFY", "all_steps_done");
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function transitionToRetry(runId: string): boolean {
  const graph = activeGraphs.get(runId);
  if (!graph) return false;
  try {
    if (graph.canTransitionTo("RETRY", "step_failed") && graph.consumeRetry()) {
      graph.transition("RETRY", "step_failed");
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function transitionToEscalate(runId: string): boolean {
  const graph = activeGraphs.get(runId);
  if (!graph) return false;
  try {
    if (graph.canTransitionTo("ESCALATE", "escalation_needed")) {
      graph.transition("ESCALATE", "escalation_needed");
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function transitionToDone(runId: string): boolean {
  const graph = activeGraphs.get(runId);
  if (!graph) return false;
  try {
    if (graph.canTransitionTo("DONE", "verification_passed")) {
      graph.transition("DONE", "verification_passed");
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function transitionToFailed(runId: string, reason?: string): boolean {
  const graph = activeGraphs.get(runId);
  if (!graph) return false;
  try {
    if (graph.canTransitionTo("FAILED", "error")) {
      graph.transition("FAILED", "error", { reason });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function transitionToCancelled(runId: string): boolean {
  const graph = activeGraphs.get(runId);
  if (!graph) return false;
  try {
    if (graph.canTransitionTo("CANCELLED", "cancelled")) {
      graph.transition("CANCELLED", "cancelled");
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Bridge: Query graph state                                         */
/* ------------------------------------------------------------------ */

export function getGraphStatus(runId: string): {
  state: string;
  metrics: Record<string, number>;
  retriesRemaining: number;
  replansRemaining: number;
  strategyMode: string;
  stepCount: number;
  artifactCount: number;
} | null {
  const graph = activeGraphs.get(runId);
  if (!graph) return null;

  const ctx = graph.getContext();
  const m = ctx.task.metrics;
  return {
    state: graph.getState(),
    metrics: {
      stepsExecuted: m.stepsExecuted,
      stepsSucceeded: m.stepsSucceeded,
      stepsFailed: m.stepsFailed,
      retries: m.retries,
      replans: m.replans,
      tokensUsed: m.tokensUsed,
      wallClockMs: m.wallClockMs,
      artifactsProduced: m.artifactsProduced,
    },
    retriesRemaining: ctx.retriesRemaining,
    replansRemaining: ctx.replansRemaining,
    strategyMode: ctx.strategyMode,
    stepCount: ctx.stepResults.length,
    artifactCount: ctx.artifacts.length,
  };
}

export function shouldEscalateAction(runId: string, action: string): boolean {
  const graph = activeGraphs.get(runId);
  if (!graph) return false;
  return graph.shouldEscalate(action);
}

export function isBudgetExceeded(runId: string): boolean {
  const graph = activeGraphs.get(runId);
  if (!graph) return false;
  return graph.isBudgetExceeded();
}

export function switchStrategy(runId: string, mode: "dom" | "visual"): boolean {
  const graph = activeGraphs.get(runId);
  if (!graph) return false;
  graph.switchStrategy(mode);
  return true;
}

/* ------------------------------------------------------------------ */
/*  Bridge: Cleanup                                                   */
/* ------------------------------------------------------------------ */

export async function cleanupGraph(runId: string): Promise<void> {
  const graph = activeGraphs.get(runId);
  if (graph) {
    graph.removeAllListeners();
    activeGraphs.delete(runId);
  }
  await cleanupRunResources(runId);
}
