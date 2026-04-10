/**
 * Office Engine — DOCX Vertical Slice
 *
 * Tables backing the structural document-engineering pipeline
 * (unpack → parse → map → edit → validate → repack → round-trip diff → preview → export).
 *
 * Each run is sandboxed by run_id, supports idempotent retries via
 * (input_checksum, objective_hash), and persists a full step timeline with
 * per-step digests, logs, and diffs for observability.
 */

import { pgTable, text, integer, timestamp, jsonb, uuid, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ---------------------------------------------------------------------------
// office_engine_runs
// ---------------------------------------------------------------------------
export const officeEngineRuns = pgTable(
  "office_engine_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id"),
    userId: text("user_id").notNull(),
    workspaceId: text("workspace_id"),
    objective: text("objective").notNull(),
    objectiveHash: text("objective_hash").notNull(),
    docKind: text("doc_kind").notNull(), // docx | xlsx | pptx | pdf — slice enforces docx
    inputChecksum: text("input_checksum").notNull(),
    inputName: text("input_name"),
    inputSize: integer("input_size"),
    sandboxPath: text("sandbox_path").notNull(),
    status: text("status").notNull().default("pending"), // pending|running|succeeded|failed|cancelled
    fallbackLevel: integer("fallback_level").notNull().default(0), // 0=high-level, 1=docxtemplater, 2=ooxml-node
    retryOfRunId: uuid("retry_of_run_id"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("office_engine_runs_conv_idx").on(table.conversationId, table.createdAt),
    index("office_engine_runs_status_idx").on(table.status),
    // Idempotent retry lookup: succeeded runs with the same (input, objective) can be reused.
    uniqueIndex("office_engine_runs_idempotency_idx")
      .on(table.inputChecksum, table.objectiveHash)
      .where(sql`status = 'succeeded'`),
  ],
);

// ---------------------------------------------------------------------------
// office_engine_steps
// ---------------------------------------------------------------------------
export const officeEngineSteps = pgTable(
  "office_engine_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => officeEngineRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    stage: text("stage").notNull(), // plan|unpack|parse|map|edit|validate|repack|roundtrip_diff|preview|export
    stepType: text("step_type").notNull(), // matches AgentStepType
    title: text("title").notNull(),
    status: text("status").notNull().default("running"), // running|completed|failed
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    durationMs: integer("duration_ms"),
    inputDigest: text("input_digest"),
    outputDigest: text("output_digest"),
    log: jsonb("log").notNull().default(sql`'[]'::jsonb`),
    diff: jsonb("diff"),
    error: jsonb("error"),
  },
  (table) => [
    index("office_engine_steps_run_idx").on(table.runId, table.seq),
    index("office_engine_steps_stage_idx").on(table.runId, table.stage),
  ],
);

// ---------------------------------------------------------------------------
// office_engine_artifacts
// ---------------------------------------------------------------------------
export const officeEngineArtifacts = pgTable(
  "office_engine_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => officeEngineRuns.id, { onDelete: "cascade" }),
    parentArtifactId: uuid("parent_artifact_id"),
    kind: text("kind").notNull(), // input|unpacked|edited|repacked|preview|exported|diff|report
    path: text("path").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    checksumSha256: text("checksum_sha256").notNull(),
    versionLabel: text("version_label").notNull().default("v1"),
    zipEntryCount: integer("zip_entry_count"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("office_engine_artifacts_run_kind_idx").on(table.runId, table.kind),
    index("office_engine_artifacts_checksum_idx").on(table.checksumSha256),
  ],
);

// ---------------------------------------------------------------------------
// Zod insert schemas
// ---------------------------------------------------------------------------
export const insertOfficeEngineRunSchema = createInsertSchema(officeEngineRuns).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
  durationMs: true,
});

export const insertOfficeEngineStepSchema = createInsertSchema(officeEngineSteps).omit({
  id: true,
  startedAt: true,
  durationMs: true,
});

export const insertOfficeEngineArtifactSchema = createInsertSchema(officeEngineArtifacts).omit({
  id: true,
  createdAt: true,
});

export type OfficeEngineRun = typeof officeEngineRuns.$inferSelect;
export type InsertOfficeEngineRun = z.infer<typeof insertOfficeEngineRunSchema>;
export type OfficeEngineStep = typeof officeEngineSteps.$inferSelect;
export type InsertOfficeEngineStep = z.infer<typeof insertOfficeEngineStepSchema>;
export type OfficeEngineArtifact = typeof officeEngineArtifacts.$inferSelect;
export type InsertOfficeEngineArtifact = z.infer<typeof insertOfficeEngineArtifactSchema>;

export type OfficeDocKind = "docx" | "xlsx" | "pptx" | "pdf";
export type OfficeRunStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";
export type OfficeFallbackLevel = 0 | 1 | 2;
export type OfficeEngineStage =
  | "plan"
  | "unpack"
  | "parse"
  | "map"
  | "edit"
  | "validate"
  | "repack"
  | "roundtrip_diff"
  | "preview"
  | "export";
export type OfficeArtifactKind =
  | "input"
  | "unpacked"
  | "edited"
  | "repacked"
  | "preview"
  | "exported"
  | "diff"
  | "report";
