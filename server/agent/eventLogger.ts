import { db } from "../db";
import { agentModeEvents } from "@shared/schema";
import { randomUUID } from "crypto";
import type { AgentEvent } from "./contracts";

export type EventType = 
  | "run_created"
  | "run_started"
  | "run_completed"
  | "run_failed"
  | "run_cancelled"
  | "run_paused"
  | "run_resumed"
  | "plan_generated"
  | "step_started"
  | "step_completed"
  | "step_failed"
  | "step_retried"
  | "step_skipped"
  | "tool_called"
  | "tool_completed"
  | "tool_failed"
  | "artifact_created"
  | "error_occurred"
  | "warning_logged";

interface LogEventParams {
  runId: string;
  correlationId: string;
  eventType: EventType;
  stepIndex?: number;
  payload: Record<string, any>;
  metadata?: Record<string, any>;
}

export class EventLogger {
  private buffer: LogEventParams[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly bufferSize: number;
  private readonly flushIntervalMs: number;

  constructor(bufferSize: number = 10, flushIntervalMs: number = 1000) {
    this.bufferSize = bufferSize;
    this.flushIntervalMs = flushIntervalMs;
    this.startFlushInterval();
  }

  private startFlushInterval(): void {
    this.flushInterval = setInterval(() => {
      this.flush().catch(err => {
        console.error("[EventLogger] Flush error:", err);
      });
    }, this.flushIntervalMs);
  }

  async log(params: LogEventParams): Promise<void> {
    this.buffer.push(params);
    
    if (this.buffer.length >= this.bufferSize) {
      await this.flush();
    }
  }

  async logImmediate(params: LogEventParams): Promise<string> {
    const eventId = randomUUID();
    
    try {
      await db.insert(agentModeEvents).values({
        id: eventId,
        runId: params.runId,
        stepIndex: params.stepIndex ?? null,
        correlationId: params.correlationId,
        eventType: params.eventType,
        payload: params.payload,
        metadata: params.metadata ?? null,
        timestamp: new Date(),
      });
      
      console.log(`[EventLogger] ${params.eventType} logged for run ${params.runId}`);
      return eventId;
    } catch (error) {
      if ((error as any)?.code === '23503' && (error as any)?.constraint?.includes('agent_mode_runs')) {
        console.warn(`[EventLogger] Discarding immediate event - run ${params.runId} is not persisted to database`);
        return eventId;
      }
      console.error("[EventLogger] Failed to log event:", error);
      throw error;
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const eventsToFlush = [...this.buffer];
    this.buffer = [];

    try {
      const values = eventsToFlush.map(params => ({
        id: randomUUID(),
        runId: params.runId,
        stepIndex: params.stepIndex ?? null,
        correlationId: params.correlationId,
        eventType: params.eventType,
        payload: params.payload,
        metadata: params.metadata ?? null,
        timestamp: new Date(),
      }));

      await db.insert(agentModeEvents).values(values);
      console.log(`[EventLogger] Flushed ${values.length} events`);
    } catch (error: any) {
      // Check if this is a foreign key constraint error (run doesn't exist in agent_mode_runs)
      // This can happen when the pipeline runs without persisting to database (e.g., anonymous users)
      // In this case, don't re-buffer as it will keep failing
      if (error?.code === '23503' && error?.constraint?.includes('agent_mode_runs')) {
        console.warn(`[EventLogger] Discarding ${eventsToFlush.length} events - run not persisted to database (local-only mode)`);
        return;
      }
      console.error("[EventLogger] Flush failed, re-buffering events:", error);
      this.buffer.unshift(...eventsToFlush);
    }
  }

  async getEventsForRun(runId: string): Promise<any[]> {
    const { eq, asc } = await import("drizzle-orm");
    
    return db.select()
      .from(agentModeEvents)
      .where(eq(agentModeEvents.runId, runId))
      .orderBy(asc(agentModeEvents.timestamp));
  }

  async getEventsByCorrelation(correlationId: string): Promise<any[]> {
    const { eq, asc } = await import("drizzle-orm");
    
    return db.select()
      .from(agentModeEvents)
      .where(eq(agentModeEvents.correlationId, correlationId))
      .orderBy(asc(agentModeEvents.timestamp));
  }

  stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }
}

export const eventLogger = new EventLogger();

export async function logRunEvent(
  runId: string,
  correlationId: string,
  eventType: EventType,
  payload: Record<string, any>,
  metadata?: Record<string, any>
): Promise<void> {
  await eventLogger.log({
    runId,
    correlationId,
    eventType,
    payload,
    metadata,
  });
}

export async function logStepEvent(
  runId: string,
  correlationId: string,
  stepIndex: number,
  eventType: EventType,
  payload: Record<string, any>,
  metadata?: Record<string, any>
): Promise<void> {
  await eventLogger.log({
    runId,
    correlationId,
    eventType,
    stepIndex,
    payload,
    metadata,
  });
}

export async function logToolEvent(
  runId: string,
  correlationId: string,
  stepIndex: number,
  toolName: string,
  eventType: "tool_called" | "tool_completed" | "tool_failed",
  payload: Record<string, any>
): Promise<void> {
  // Tool execution must never fail because event persistence is down (e.g. tests, local-only runs).
  try {
    await eventLogger.logImmediate({
      runId,
      correlationId,
      eventType,
      stepIndex,
      payload: {
        toolName,
        ...payload,
      },
      metadata: {
        timestamp: Date.now(),
      },
    });
  } catch (error) {
    console.warn("[EventLogger] Skipping tool event log (best-effort):", error);
  }
}
