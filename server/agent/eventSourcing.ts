import { randomUUID } from "crypto";
import { db } from "../db";
import { agentModeEvents, agentModeRuns } from "@shared/schema";
import { eq, asc, desc, and, gte, lte } from "drizzle-orm";
import { createHash } from "crypto";

export type EventSourcingEventType =
  | "CommandReceived"
  | "PlanCreated"
  | "SubtaskStarted"
  | "ToolCalled"
  | "ToolCompleted"
  | "CriticEvaluated"
  | "JudgeVerdict"
  | "StateTransition"
  | "SnapshotTaken"
  | "ReplanTriggered"
  | "ErrorOccurred";

export interface DomainEvent {
  id: string;
  runId: string;
  eventType: EventSourcingEventType;
  correlationId: string;
  stepIndex: number | null;
  payload: Record<string, any>;
  metadata: Record<string, any> | null;
  timestamp: Date;
  inputHash: string | null;
  outputRef: string | null;
  durationMs: number | null;
  errorCode: string | null;
  retryCount: number;
}

export interface AgentStateSnapshot {
  runId: string;
  snapshotId: string;
  eventIndex: number;
  status: string;
  plan: any | null;
  completedSteps: number;
  currentStepIndex: number;
  artifacts: any[];
  error: string | null;
  timestamp: Date;
}

export interface ReplayResult {
  runId: string;
  events: DomainEvent[];
  snapshots: AgentStateSnapshot[];
  finalState: AgentStateSnapshot;
  totalEvents: number;
}

function hashInput(input: any): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 16);
}

function reconstructState(events: DomainEvent[], upToIndex?: number): AgentStateSnapshot {
  const limit = upToIndex !== undefined ? upToIndex + 1 : events.length;
  const relevantEvents = events.slice(0, limit);

  const state: AgentStateSnapshot = {
    runId: relevantEvents[0]?.runId ?? "",
    snapshotId: randomUUID(),
    eventIndex: limit - 1,
    status: "pending",
    plan: null,
    completedSteps: 0,
    currentStepIndex: 0,
    artifacts: [],
    error: null,
    timestamp: new Date(),
  };

  for (const event of relevantEvents) {
    switch (event.eventType) {
      case "CommandReceived":
        state.status = "running";
        break;
      case "PlanCreated":
        state.status = "planning";
        state.plan = event.payload.plan ?? null;
        break;
      case "SubtaskStarted":
        state.status = "running";
        state.currentStepIndex = event.stepIndex ?? state.currentStepIndex;
        break;
      case "ToolCalled":
        state.status = "running";
        break;
      case "ToolCompleted":
        state.completedSteps += 1;
        if (event.payload.artifact) {
          state.artifacts.push(event.payload.artifact);
        }
        break;
      case "CriticEvaluated":
        state.status = "running";
        break;
      case "JudgeVerdict":
        if (event.payload.verdict === "approved") {
          state.status = "succeeded";
        } else if (event.payload.verdict === "rejected") {
          state.status = "failed";
        }
        break;
      case "StateTransition":
        state.status = event.payload.toState ?? state.status;
        break;
      case "ReplanTriggered":
        state.plan = event.payload.newPlan ?? state.plan;
        state.currentStepIndex = 0;
        state.completedSteps = 0;
        break;
      case "ErrorOccurred":
        state.error = event.payload.message ?? event.errorCode ?? "unknown error";
        state.status = "failed";
        break;
      case "SnapshotTaken":
        break;
    }
    state.timestamp = event.timestamp;
  }

  return state;
}

class EventStore {
  private snapshotInterval = 20;
  private snapshotCache: Map<string, AgentStateSnapshot[]> = new Map();

  async appendEvent(
    runId: string,
    eventType: EventSourcingEventType,
    payload: Record<string, any>,
    options?: {
      correlationId?: string;
      stepIndex?: number;
      metadata?: Record<string, any>;
      inputHash?: string;
      outputRef?: string;
      durationMs?: number;
      errorCode?: string;
      retryCount?: number;
    }
  ): Promise<DomainEvent> {
    const event: DomainEvent = {
      id: randomUUID(),
      runId,
      eventType,
      correlationId: options?.correlationId ?? randomUUID(),
      stepIndex: options?.stepIndex ?? null,
      payload,
      metadata: options?.metadata ?? null,
      timestamp: new Date(),
      inputHash: options?.inputHash ?? (payload.input ? hashInput(payload.input) : null),
      outputRef: options?.outputRef ?? null,
      durationMs: options?.durationMs ?? null,
      errorCode: options?.errorCode ?? null,
      retryCount: options?.retryCount ?? 0,
    };

    if (db && typeof (db as any).insert === "function") {
      try {
        await (db as any).insert(agentModeEvents).values({
          id: event.id,
          runId: event.runId,
          stepIndex: event.stepIndex,
          correlationId: event.correlationId,
          eventType: event.eventType,
          payload: event.payload,
          metadata: event.metadata,
          timestamp: event.timestamp,
          inputHash: event.inputHash,
          outputRef: event.outputRef,
          durationMs: event.durationMs,
          errorCode: event.errorCode,
          retryCount: event.retryCount,
        });
      } catch (err: any) {
        if (err?.code === "23503" || err?.code === "23502") {
          return event;
        }
        console.error("[EventSourcing] Persist error:", err);
      }
    }

    const allEvents = await this.getEventsForRun(runId);
    if (allEvents.length > 0 && allEvents.length % this.snapshotInterval === 0) {
      await this.takeSnapshot(runId, allEvents);
    }

    return event;
  }

  async getEventsForRun(runId: string): Promise<DomainEvent[]> {
    if (!db || typeof (db as any).select !== "function") {
      return [];
    }

    try {
      const rows = await (db as any)
        .select()
        .from(agentModeEvents)
        .where(eq(agentModeEvents.runId, runId))
        .orderBy(asc(agentModeEvents.timestamp));

      return rows.map(this.rowToDomainEvent);
    } catch (err) {
      console.error("[EventSourcing] Query error:", err);
      return [];
    }
  }

  async getEventsForRunPaginated(
    runId: string,
    offset: number = 0,
    limit: number = 100
  ): Promise<{ events: DomainEvent[]; total: number }> {
    if (!db || typeof (db as any).select !== "function") {
      return { events: [], total: 0 };
    }

    try {
      const allRows = await (db as any)
        .select()
        .from(agentModeEvents)
        .where(eq(agentModeEvents.runId, runId))
        .orderBy(asc(agentModeEvents.timestamp));

      const total = allRows.length;
      const events = allRows.slice(offset, offset + limit).map(this.rowToDomainEvent);
      return { events, total };
    } catch (err) {
      console.error("[EventSourcing] Paginated query error:", err);
      return { events: [], total: 0 };
    }
  }

  async replay(runId: string, upToIndex?: number): Promise<ReplayResult> {
    const events = await this.getEventsForRun(runId);
    const snapshots = this.snapshotCache.get(runId) ?? [];
    const finalState = reconstructState(events, upToIndex);

    return {
      runId,
      events: upToIndex !== undefined ? events.slice(0, upToIndex + 1) : events,
      snapshots,
      finalState,
      totalEvents: events.length,
    };
  }

  async getStateAtEvent(runId: string, eventIndex: number): Promise<AgentStateSnapshot> {
    const snapshots = this.snapshotCache.get(runId) ?? [];
    let closestSnapshot: AgentStateSnapshot | null = null;

    for (const snap of snapshots) {
      if (snap.eventIndex <= eventIndex) {
        closestSnapshot = snap;
      }
    }

    const events = await this.getEventsForRun(runId);
    if (closestSnapshot) {
      const remainingEvents = events.slice(closestSnapshot.eventIndex + 1, eventIndex + 1);
      const state = reconstructState(remainingEvents);
      state.runId = runId;
      state.eventIndex = eventIndex;
      state.completedSteps += closestSnapshot.completedSteps;
      state.artifacts = [...closestSnapshot.artifacts, ...state.artifacts];
      if (!state.plan && closestSnapshot.plan) {
        state.plan = closestSnapshot.plan;
      }
      return state;
    }

    return reconstructState(events, eventIndex);
  }

  private async takeSnapshot(runId: string, events: DomainEvent[]): Promise<AgentStateSnapshot> {
    const snapshot = reconstructState(events);
    snapshot.snapshotId = randomUUID();

    if (!this.snapshotCache.has(runId)) {
      this.snapshotCache.set(runId, []);
    }
    this.snapshotCache.get(runId)!.push(snapshot);

    if (db && typeof (db as any).insert === "function") {
      try {
        await (db as any).insert(agentModeEvents).values({
          id: randomUUID(),
          runId,
          stepIndex: snapshot.eventIndex,
          correlationId: snapshot.snapshotId,
          eventType: "SnapshotTaken",
          payload: {
            status: snapshot.status,
            plan: snapshot.plan,
            completedSteps: snapshot.completedSteps,
            currentStepIndex: snapshot.currentStepIndex,
            artifacts: snapshot.artifacts,
            error: snapshot.error,
          },
          metadata: { snapshotId: snapshot.snapshotId },
          timestamp: snapshot.timestamp,
        });
      } catch (err: any) {
        if (err?.code !== "23503" && err?.code !== "23502") {
          console.error("[EventSourcing] Snapshot persist error:", err);
        }
      }
    }

    return snapshot;
  }

  private rowToDomainEvent(row: any): DomainEvent {
    return {
      id: row.id,
      runId: row.runId,
      eventType: row.eventType as EventSourcingEventType,
      correlationId: row.correlationId,
      stepIndex: row.stepIndex,
      payload: row.payload ?? {},
      metadata: row.metadata,
      timestamp: row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp),
      inputHash: row.inputHash ?? null,
      outputRef: row.outputRef ?? null,
      durationMs: row.durationMs ?? null,
      errorCode: row.errorCode ?? null,
      retryCount: row.retryCount ?? 0,
    };
  }

  clearSnapshotCache(runId?: string): void {
    if (runId) {
      this.snapshotCache.delete(runId);
    } else {
      this.snapshotCache.clear();
    }
  }
}

class CommandBus {
  private handlers: Map<string, (cmd: any) => Promise<any>> = new Map();

  register(commandType: string, handler: (cmd: any) => Promise<any>): void {
    this.handlers.set(commandType, handler);
  }

  async dispatch(commandType: string, payload: any): Promise<any> {
    const handler = this.handlers.get(commandType);
    if (!handler) {
      throw new Error(`No handler registered for command: ${commandType}`);
    }
    return handler(payload);
  }

  hasHandler(commandType: string): boolean {
    return this.handlers.has(commandType);
  }

  getRegisteredCommands(): string[] {
    return Array.from(this.handlers.keys());
  }
}

class QueryBus {
  private handlers: Map<string, (query: any) => Promise<any>> = new Map();

  register(queryType: string, handler: (query: any) => Promise<any>): void {
    this.handlers.set(queryType, handler);
  }

  async dispatch(queryType: string, payload: any): Promise<any> {
    const handler = this.handlers.get(queryType);
    if (!handler) {
      throw new Error(`No handler registered for query: ${queryType}`);
    }
    return handler(payload);
  }

  hasHandler(queryType: string): boolean {
    return this.handlers.has(queryType);
  }

  getRegisteredQueries(): string[] {
    return Array.from(this.handlers.keys());
  }
}

export const eventStore = new EventStore();
export const commandBus = new CommandBus();
export const queryBus = new QueryBus();

commandBus.register("StartRun", async (cmd: { runId: string; objective: string; userId?: string }) => {
  return eventStore.appendEvent(cmd.runId, "CommandReceived", {
    objective: cmd.objective,
    userId: cmd.userId,
  });
});

commandBus.register("CreatePlan", async (cmd: { runId: string; plan: any; correlationId?: string }) => {
  return eventStore.appendEvent(cmd.runId, "PlanCreated", {
    plan: cmd.plan,
  }, {
    correlationId: cmd.correlationId,
  });
});

commandBus.register("StartSubtask", async (cmd: { runId: string; stepIndex: number; description: string; correlationId?: string }) => {
  return eventStore.appendEvent(cmd.runId, "SubtaskStarted", {
    description: cmd.description,
  }, {
    stepIndex: cmd.stepIndex,
    correlationId: cmd.correlationId,
  });
});

commandBus.register("CallTool", async (cmd: { runId: string; toolName: string; input: any; stepIndex?: number; correlationId?: string }) => {
  return eventStore.appendEvent(cmd.runId, "ToolCalled", {
    toolName: cmd.toolName,
    input: cmd.input,
  }, {
    stepIndex: cmd.stepIndex,
    correlationId: cmd.correlationId,
    inputHash: hashInput(cmd.input),
  });
});

commandBus.register("CompleteTool", async (cmd: { runId: string; toolName: string; output: any; durationMs?: number; artifact?: any; stepIndex?: number; correlationId?: string }) => {
  return eventStore.appendEvent(cmd.runId, "ToolCompleted", {
    toolName: cmd.toolName,
    output: cmd.output,
    artifact: cmd.artifact,
  }, {
    stepIndex: cmd.stepIndex,
    correlationId: cmd.correlationId,
    durationMs: cmd.durationMs,
  });
});

commandBus.register("EvaluateCritic", async (cmd: { runId: string; evaluation: any; confidence?: number; correlationId?: string }) => {
  return eventStore.appendEvent(cmd.runId, "CriticEvaluated", {
    evaluation: cmd.evaluation,
    confidence: cmd.confidence,
  }, {
    correlationId: cmd.correlationId,
  });
});

commandBus.register("JudgeVerdict", async (cmd: { runId: string; verdict: string; reasoning?: string; correlationId?: string }) => {
  return eventStore.appendEvent(cmd.runId, "JudgeVerdict", {
    verdict: cmd.verdict,
    reasoning: cmd.reasoning,
  }, {
    correlationId: cmd.correlationId,
  });
});

commandBus.register("TransitionState", async (cmd: { runId: string; fromState: string; toState: string; reason?: string }) => {
  return eventStore.appendEvent(cmd.runId, "StateTransition", {
    fromState: cmd.fromState,
    toState: cmd.toState,
    reason: cmd.reason,
  });
});

queryBus.register("GetRunEvents", async (query: { runId: string; offset?: number; limit?: number }) => {
  if (query.offset !== undefined || query.limit !== undefined) {
    return eventStore.getEventsForRunPaginated(query.runId, query.offset, query.limit);
  }
  return eventStore.getEventsForRun(query.runId);
});

queryBus.register("ReplayRun", async (query: { runId: string; upToIndex?: number }) => {
  return eventStore.replay(query.runId, query.upToIndex);
});

queryBus.register("GetStateAtEvent", async (query: { runId: string; eventIndex: number }) => {
  return eventStore.getStateAtEvent(query.runId, query.eventIndex);
});
