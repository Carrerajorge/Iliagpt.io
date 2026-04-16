import { and, asc, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { createHash, randomUUID } from "crypto";

import { db } from "../db";
import { recordEventPersistence, recordPersistenceFailure } from "./metrics";
import { agentModeArtifacts, agentModeEvents, agentModeRuns, agentModeSteps } from "@shared/schema";
import { WorkflowArtifact, WorkflowDefinition, WorkflowEventSeverity, WorkflowRunStatus, WorkflowStepDefinition } from "./types";

export interface RunPersistence {
  id: string;
  status: WorkflowRunStatus;
  chatId: string;
  userId: string | null;
  plan: WorkflowDefinition;
  idempotencyKey: string | null;
  error?: string | null;
  totalSteps?: number | null;
  completedSteps?: number | null;
  currentStepIndex?: number | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  createdAt: Date;
}

export interface StepPersistence {
  id: string;
  runId: string;
  stepIndex: number;
  stepId: string;
  toolName: string;
  status: string;
  description?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface WorkflowEventWrite {
  runId: string;
  eventSeq: number;
  correlationId: string;
  eventType: string;
  payload: Record<string, any>;
  metadata?: Record<string, any> | null;
  stepId?: string | null;
  stepIndex?: number | null;
  traceId?: string | null;
  spanId?: string | null;
  severity?: WorkflowEventSeverity;
  timestamp?: Date;
}

export interface StoredWorkflowEvent {
  id: string;
  runId: string;
  eventSeq: number;
  eventType: string;
  correlationId: string;
  stepId: string | null;
  stepIndex: number | null;
  traceId: string | null;
  spanId: string | null;
  severity: string | null;
  payload: Record<string, any>;
  metadata: Record<string, any> | null;
  timestamp: Date;
}

export interface ArtifactWrite {
  runId: string;
  stepId: string;
  stepIndex: number;
  artifact: WorkflowArtifact;
}

function computeArtifactKey(artifact: WorkflowArtifact): string {
  if (artifact.key && artifact.key.length > 0) {
    return artifact.key;
  }

  const payload = JSON.stringify({
    type: artifact.type,
    name: artifact.name,
    url: artifact.url || null,
    payload: artifact.payload || null,
    metadata: artifact.metadata || null,
  });

  return createHash("sha256").update(payload).digest("hex");
}

function resolveDbErrorCode(error: any): string | undefined {
  return error?.code || error?.cause?.code;
}

export class WorkflowStore {
  async createRun(params: {
    runId: string;
    chatId: string;
    userId?: string | null;
    plan: WorkflowDefinition;
    idempotencyKey?: string | null;
  }): Promise<RunPersistence> {
    const values = {
      id: params.runId,
      chatId: params.chatId,
      messageId: null,
      userId: params.userId || null,
      status: "queued",
      plan: params.plan,
      artifacts: null,
      summary: null,
      error: null,
      totalSteps: params.plan.steps.length,
      completedSteps: 0,
      currentStepIndex: 0,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
      idempotencyKey: params.idempotencyKey || null,
    };

    if (params.idempotencyKey) {
      try {
        const inserted = await db
          .insert(agentModeRuns)
          .values(values)
          .onConflictDoNothing({ target: [agentModeRuns.chatId, agentModeRuns.idempotencyKey] })
          .returning();

        if (inserted[0]) {
          return inserted[0] as RunPersistence;
        }

        const existing = await this.getRunByIdempotencyKey(params.chatId, params.idempotencyKey);
        if (!existing) {
          throw new Error(`Idempotent run lookup failed for key ${params.idempotencyKey}`);
        }
        return existing;
      } catch (error: any) {
        if (resolveDbErrorCode(error) !== "42P10") {
          throw error;
        }

        const existing = await this.getRunByIdempotencyKey(params.chatId, params.idempotencyKey);
        if (existing) {
          return existing;
        }

        const [run] = await db.insert(agentModeRuns).values(values).returning();
        return run as RunPersistence;
      }
    }

    const [run] = await db.insert(agentModeRuns).values(values).returning();
    return run as RunPersistence;
  }

  async createSteps(runId: string, steps: WorkflowStepDefinition[]): Promise<Array<{ stepIndex: number; stepId: string; toolName: string }>> {
    const inserts = steps.map((step, index) => ({
      id: randomUUID(),
      runId,
      stepIndex: index,
      toolName: step.toolName,
      toolInput: step.input || null,
      toolOutput: null,
      status: "queued",
      error: null,
      retryCount: 0,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
    }));

    if (inserts.length === 0) {
      return [];
    }

    const inserted = await db
      .insert(agentModeSteps)
      .values(inserts)
      .returning({ id: agentModeSteps.id, stepIndex: agentModeSteps.stepIndex, toolName: agentModeSteps.toolName });

    return inserted.map((row) => ({
      stepIndex: row.stepIndex,
      stepId: row.id,
      toolName: row.toolName,
    }));
  }

  async updateRunStatus(runId: string, updates: Partial<typeof agentModeRuns.$inferInsert>): Promise<void> {
    await db.update(agentModeRuns).set({ ...updates }).where(eq(agentModeRuns.id, runId));
  }

  async updateStepStatus(stepId: string, updates: Partial<typeof agentModeSteps.$inferInsert>): Promise<void> {
    await db.update(agentModeSteps).set({ ...updates }).where(eq(agentModeSteps.id, stepId));
  }

  async cancelPendingSteps(runId: string): Promise<void> {
    await db
      .update(agentModeSteps)
      .set({
        status: "cancelled",
        completedAt: new Date(),
      })
      .where(
        and(
          eq(agentModeSteps.runId, runId),
          inArray(agentModeSteps.status, ["queued", "running", "retrying", "pending"]),
        ),
      );
  }

  async getRunByIdempotencyKey(chatId: string, idempotencyKey: string): Promise<RunPersistence | null> {
    const [run] = await db
      .select()
      .from(agentModeRuns)
      .where(and(eq(agentModeRuns.chatId, chatId), eq(agentModeRuns.idempotencyKey, idempotencyKey)))
      .limit(1);
    return (run as RunPersistence) || null;
  }

  async loadRun(runId: string): Promise<RunPersistence | null> {
    const [run] = await db.select().from(agentModeRuns).where(eq(agentModeRuns.id, runId)).limit(1);
    return (run as RunPersistence) || null;
  }

  async loadSteps(runId: string) {
    return db
      .select({
        id: agentModeSteps.id,
        stepIndex: agentModeSteps.stepIndex,
        toolName: agentModeSteps.toolName,
        status: agentModeSteps.status,
        error: agentModeSteps.error,
        startedAt: agentModeSteps.startedAt,
        completedAt: agentModeSteps.completedAt,
        retryCount: agentModeSteps.retryCount,
      })
      .from(agentModeSteps)
      .where(eq(agentModeSteps.runId, runId))
      .orderBy(agentModeSteps.stepIndex);
  }

  async appendEventIdempotent(event: WorkflowEventWrite): Promise<{ inserted: boolean; eventId: string | null }> {
    const startedAt = Date.now();

    try {
      const inserted = await db
        .insert(agentModeEvents)
        .values({
          id: randomUUID(),
          runId: event.runId,
          eventSeq: event.eventSeq,
          stepIndex: event.stepIndex ?? null,
          stepId: event.stepId ?? null,
          correlationId: event.correlationId,
          traceId: event.traceId ?? null,
          spanId: event.spanId ?? null,
          severity: event.severity ?? "info",
          eventType: event.eventType,
          payload: event.payload,
          metadata: event.metadata ?? null,
          timestamp: event.timestamp ?? new Date(),
        })
        .onConflictDoNothing({ target: [agentModeEvents.runId, agentModeEvents.eventSeq] })
        .returning({ id: agentModeEvents.id });

      const durationMs = Date.now() - startedAt;
      if (inserted[0]?.id) {
        recordEventPersistence("persisted", durationMs);
        return { inserted: true, eventId: inserted[0].id };
      }

      recordEventPersistence("deduplicated", durationMs);
      return { inserted: false, eventId: null };
    } catch (error: any) {
      // Fallback for environments where the unique index migration has not been applied yet.
      if (resolveDbErrorCode(error) === "42P10") {
        const existing = await db
          .select({ id: agentModeEvents.id })
          .from(agentModeEvents)
          .where(and(eq(agentModeEvents.runId, event.runId), eq(agentModeEvents.eventSeq, event.eventSeq)))
          .limit(1);

        if (existing[0]?.id) {
          const durationMs = Date.now() - startedAt;
          recordEventPersistence("deduplicated", durationMs);
          return { inserted: false, eventId: existing[0].id };
        }

        const [fallbackInsert] = await db
          .insert(agentModeEvents)
          .values({
            id: randomUUID(),
            runId: event.runId,
            eventSeq: event.eventSeq,
            stepIndex: event.stepIndex ?? null,
            stepId: event.stepId ?? null,
            correlationId: event.correlationId,
            traceId: event.traceId ?? null,
            spanId: event.spanId ?? null,
            severity: event.severity ?? "info",
            eventType: event.eventType,
            payload: event.payload,
            metadata: event.metadata ?? null,
            timestamp: event.timestamp ?? new Date(),
          })
          .returning({ id: agentModeEvents.id });

        const durationMs = Date.now() - startedAt;
        recordEventPersistence("persisted", durationMs);
        return { inserted: true, eventId: fallbackInsert?.id || null };
      }

      const durationMs = Date.now() - startedAt;
      recordEventPersistence("failed", durationMs);
      recordPersistenceFailure(event.runId, error?.message || "unknown persistence failure");
      throw error;
    }
  }

  async appendArtifactsIdempotent(entries: ArtifactWrite[]): Promise<{ inserted: number; deduplicated: number }> {
    if (entries.length === 0) {
      return { inserted: 0, deduplicated: 0 };
    }

    const now = new Date();
    const values = entries.map(({ runId, stepId, stepIndex, artifact }) => ({
      id: randomUUID(),
      runId,
      stepId,
      stepIndex,
      artifactKey: computeArtifactKey(artifact),
      type: artifact.type,
      name: artifact.name,
      url: artifact.url ?? null,
      payload: artifact.payload ?? null,
      metadata: artifact.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    }));

    try {
      const inserted = await db
        .insert(agentModeArtifacts)
        .values(values)
        .onConflictDoNothing({ target: [agentModeArtifacts.runId, agentModeArtifacts.stepId, agentModeArtifacts.artifactKey] })
        .returning({ id: agentModeArtifacts.id });

      return { inserted: inserted.length, deduplicated: Math.max(0, values.length - inserted.length) };
    } catch (error: any) {
      if (resolveDbErrorCode(error) !== "42P10") {
        throw error;
      }

      let insertedCount = 0;
      for (const value of values) {
        const existing = await db
          .select({ id: agentModeArtifacts.id })
          .from(agentModeArtifacts)
          .where(
            and(
              eq(agentModeArtifacts.runId, value.runId),
              eq(agentModeArtifacts.stepId, value.stepId),
              eq(agentModeArtifacts.artifactKey, value.artifactKey),
            ),
          )
          .limit(1);

        if (existing[0]?.id) {
          continue;
        }

        await db.insert(agentModeArtifacts).values(value);
        insertedCount += 1;
      }

      return { inserted: insertedCount, deduplicated: Math.max(0, values.length - insertedCount) };
    }
  }

  async listEvents(params: {
    runId: string;
    afterSeq?: number | null;
    limit?: number;
    order?: "asc" | "desc";
  }): Promise<StoredWorkflowEvent[]> {
    const limit = Math.max(1, Math.min(params.limit ?? 200, 5000));
    const order = params.order === "desc" ? "desc" : "asc";

    const conditions = [eq(agentModeEvents.runId, params.runId), isNotNull(agentModeEvents.eventSeq)];
    if (typeof params.afterSeq === "number" && Number.isFinite(params.afterSeq)) {
      conditions.push(gt(agentModeEvents.eventSeq, params.afterSeq));
    }

    const rows = await db
      .select({
        id: agentModeEvents.id,
        runId: agentModeEvents.runId,
        eventSeq: agentModeEvents.eventSeq,
        eventType: agentModeEvents.eventType,
        correlationId: agentModeEvents.correlationId,
        stepId: agentModeEvents.stepId,
        stepIndex: agentModeEvents.stepIndex,
        traceId: agentModeEvents.traceId,
        spanId: agentModeEvents.spanId,
        severity: agentModeEvents.severity,
        payload: agentModeEvents.payload,
        metadata: agentModeEvents.metadata,
        timestamp: agentModeEvents.timestamp,
      })
      .from(agentModeEvents)
      .where(and(...conditions))
      .orderBy(order === "asc" ? asc(agentModeEvents.eventSeq) : desc(agentModeEvents.eventSeq))
      .limit(limit);

    return rows.map((row) => ({
      ...row,
      eventSeq: Number(row.eventSeq),
      payload: (row.payload || {}) as Record<string, any>,
      metadata: (row.metadata || null) as Record<string, any> | null,
      timestamp: row.timestamp,
    }));
  }

  async getLastEventSeq(runId: string): Promise<number> {
    const [result] = await db
      .select({ maxSeq: sql<number>`COALESCE(MAX(${agentModeEvents.eventSeq}), 0)` })
      .from(agentModeEvents)
      .where(eq(agentModeEvents.runId, runId));

    return Number(result?.maxSeq ?? 0);
  }

  async loadArtifacts(runId: string) {
    return db
      .select({
        id: agentModeArtifacts.id,
        stepId: agentModeArtifacts.stepId,
        stepIndex: agentModeArtifacts.stepIndex,
        artifactKey: agentModeArtifacts.artifactKey,
        type: agentModeArtifacts.type,
        name: agentModeArtifacts.name,
        url: agentModeArtifacts.url,
        payload: agentModeArtifacts.payload,
        metadata: agentModeArtifacts.metadata,
        createdAt: agentModeArtifacts.createdAt,
      })
      .from(agentModeArtifacts)
      .where(eq(agentModeArtifacts.runId, runId))
      .orderBy(asc(agentModeArtifacts.stepIndex), asc(agentModeArtifacts.createdAt));
  }
}
