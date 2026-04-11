/**
 * Drizzle persistence layer for Office Engine runs.
 *
 * Thin repository wrapping inserts/updates on the three office_engine_*
 * tables. Idempotent retry lookup is exposed via `findIdempotentRun`.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  officeEngineRuns,
  officeEngineSteps,
  officeEngineArtifacts,
  type OfficeEngineRun,
  type InsertOfficeEngineRun,
  type OfficeEngineArtifact,
} from "@shared/schema";

export async function findIdempotentRun(
  inputChecksum: string,
  objectiveHash: string,
  docKind: string,
): Promise<OfficeEngineRun | null> {
  const rows = await db
    .select()
    .from(officeEngineRuns)
    .where(
      and(
        eq(officeEngineRuns.inputChecksum, inputChecksum),
        eq(officeEngineRuns.objectiveHash, objectiveHash),
        eq(officeEngineRuns.docKind, docKind),
        eq(officeEngineRuns.status, "succeeded"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function createRun(input: InsertOfficeEngineRun): Promise<OfficeEngineRun> {
  const [row] = await db.insert(officeEngineRuns).values(input).returning();
  return row;
}

export async function markRunStarted(runId: string): Promise<void> {
  await db
    .update(officeEngineRuns)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(officeEngineRuns.id, runId));
}

export async function markRunSucceeded(
  runId: string,
  fallbackLevel: number,
  durationMs: number,
): Promise<void> {
  await db
    .update(officeEngineRuns)
    .set({
      status: "succeeded",
      fallbackLevel,
      completedAt: new Date(),
      durationMs,
    })
    .where(eq(officeEngineRuns.id, runId));
}

export async function markRunFailed(
  runId: string,
  errorCode: string,
  errorMessage: string,
  durationMs: number,
): Promise<void> {
  await db
    .update(officeEngineRuns)
    .set({
      status: "failed",
      errorCode,
      errorMessage,
      completedAt: new Date(),
      durationMs,
    })
    .where(eq(officeEngineRuns.id, runId));
}

export async function markRunCancelled(runId: string, durationMs: number): Promise<void> {
  await db
    .update(officeEngineRuns)
    .set({
      status: "cancelled",
      completedAt: new Date(),
      durationMs,
    })
    .where(eq(officeEngineRuns.id, runId));
}

export interface RecordStepInput {
  runId: string;
  seq: number;
  stage: string;
  stepType: string;
  title: string;
  status: string;
  durationMs?: number;
  inputDigest?: string;
  outputDigest?: string;
  log?: unknown[];
  diff?: unknown;
  error?: unknown;
}

export async function recordStep(input: RecordStepInput): Promise<void> {
  await db.insert(officeEngineSteps).values({
    runId: input.runId,
    seq: input.seq,
    stage: input.stage,
    stepType: input.stepType,
    title: input.title,
    status: input.status,
    durationMs: input.durationMs,
    inputDigest: input.inputDigest,
    outputDigest: input.outputDigest,
    log: (input.log ?? []) as unknown as object[],
    diff: input.diff as unknown as object | undefined,
    error: input.error as unknown as object | undefined,
  });
}

export interface RecordArtifactInput {
  runId: string;
  parentArtifactId?: string;
  kind: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  versionLabel?: string;
  zipEntryCount?: number;
  metadata?: Record<string, unknown>;
}

export async function recordArtifact(input: RecordArtifactInput): Promise<OfficeEngineArtifact> {
  const [row] = await db
    .insert(officeEngineArtifacts)
    .values({
      runId: input.runId,
      parentArtifactId: input.parentArtifactId,
      kind: input.kind,
      path: input.path,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      checksumSha256: input.checksumSha256,
      versionLabel: input.versionLabel ?? "v1",
      zipEntryCount: input.zipEntryCount,
      metadata: (input.metadata ?? {}) as object,
    })
    .returning();
  return row;
}

export async function listArtifacts(runId: string): Promise<OfficeEngineArtifact[]> {
  return db
    .select()
    .from(officeEngineArtifacts)
    .where(eq(officeEngineArtifacts.runId, runId));
}

export async function getRun(runId: string): Promise<OfficeEngineRun | null> {
  const rows = await db.select().from(officeEngineRuns).where(eq(officeEngineRuns.id, runId)).limit(1);
  return rows[0] ?? null;
}

// Convenience: increment a step counter atomically using SQL.
export async function nextSeq(runId: string): Promise<number> {
  const result = await db.execute<{ next: number }>(
    sql`SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM ${officeEngineSteps} WHERE run_id = ${runId}`,
  );
  // drizzle-orm/node-postgres returns rows under .rows
  const rows = (result as unknown as { rows?: Array<{ next: number }> }).rows;
  return rows && rows[0] ? Number(rows[0].next) : 0;
}
