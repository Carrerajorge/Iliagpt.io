import { pgTable, text, integer, timestamp, jsonb, doublePrecision, uuid, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const orchestratorRuns = pgTable("orchestrator_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  objective: text("objective").notNull(),
  status: text("status").notNull().default("queued"),
  priority: integer("priority").notNull().default(5),
  budgetLimitUsd: doublePrecision("budget_limit_usd"),
  timeLimitMs: integer("time_limit_ms"),
  concurrencyLimit: integer("concurrency_limit").notNull().default(10),
  createdBy: text("created_by").notNull(),
  dagJson: jsonb("dag_json"),
  resultJson: jsonb("result_json"),
  error: text("error"),
  totalTasks: integer("total_tasks").notNull().default(0),
  completedTasks: integer("completed_tasks").notNull().default(0),
  failedTasks: integer("failed_tasks").notNull().default(0),
  totalCostUsd: doublePrecision("total_cost_usd").notNull().default(0),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const orchestratorTasks = pgTable("orchestrator_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull(),
  parentTaskId: uuid("parent_task_id"),
  agentRole: text("agent_role").notNull(),
  label: text("label").notNull().default(""),
  status: text("status").notNull().default("pending"),
  inputJson: jsonb("input_json"),
  outputJson: jsonb("output_json"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  dependsOn: text("depends_on").array(),
  riskLevel: text("risk_level").notNull().default("safe"),
  costUsd: doublePrecision("cost_usd").notNull().default(0),
  durationMs: integer("duration_ms"),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

export const orchestratorApprovals = pgTable("orchestrator_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull(),
  runId: uuid("run_id").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"),
  requestedBy: text("requested_by").notNull(),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const orchestratorArtifacts = pgTable("orchestrator_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id"),
  runId: uuid("run_id").notNull(),
  type: text("type").notNull().default("data"),
  name: text("name").notNull(),
  contentJson: jsonb("content_json"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertOrchestratorRunSchema = createInsertSchema(orchestratorRuns).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
  totalTasks: true,
  completedTasks: true,
  failedTasks: true,
  totalCostUsd: true,
});

export const insertOrchestratorTaskSchema = createInsertSchema(orchestratorTasks).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
  retryCount: true,
  costUsd: true,
  durationMs: true,
});

export const insertOrchestratorApprovalSchema = createInsertSchema(orchestratorApprovals).omit({
  id: true,
  createdAt: true,
  decidedBy: true,
  decidedAt: true,
});

export const insertOrchestratorArtifactSchema = createInsertSchema(orchestratorArtifacts).omit({
  id: true,
  createdAt: true,
});

export type OrchestratorRun = typeof orchestratorRuns.$inferSelect;
export type InsertOrchestratorRun = z.infer<typeof insertOrchestratorRunSchema>;
export type OrchestratorTask = typeof orchestratorTasks.$inferSelect;
export type InsertOrchestratorTask = z.infer<typeof insertOrchestratorTaskSchema>;
export type OrchestratorApproval = typeof orchestratorApprovals.$inferSelect;
export type InsertOrchestratorApproval = z.infer<typeof insertOrchestratorApprovalSchema>;
export type OrchestratorArtifact = typeof orchestratorArtifacts.$inferSelect;
export type InsertOrchestratorArtifact = z.infer<typeof insertOrchestratorArtifactSchema>;
