/**
 * Task Model — Formal specification for agentic tasks.
 *
 * Every task processed by the orchestrator is modelled with:
 *   goal, constraints, definition_of_done, risk_level, budget
 *
 * This drives the Planner → Executor → Verifier loop and enables
 * the orchestrator to decide when to retry, escalate, or mark done.
 */

import { z } from "zod";
import { randomUUID } from "crypto";

/* ------------------------------------------------------------------ */
/*  Enums & Primitives                                                */
/* ------------------------------------------------------------------ */

export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const TaskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TaskStatusSchema = z.enum([
  "pending",
  "planning",
  "executing",
  "verifying",
  "retrying",
  "escalated",
  "completed",
  "failed",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

/* ------------------------------------------------------------------ */
/*  Budget                                                            */
/* ------------------------------------------------------------------ */

export const BudgetSchema = z.object({
  /** Maximum wall-clock milliseconds before forced timeout. */
  maxTimeMs: z.number().int().positive().default(300_000), // 5 min
  /** Maximum number of discrete steps the executor may take. */
  maxSteps: z.number().int().positive().default(20),
  /** Maximum number of LLM tokens to spend (sum of in+out). */
  maxTokens: z.number().int().positive().optional(),
  /** Maximum number of retries per individual step. */
  maxRetriesPerStep: z.number().int().min(0).default(3),
  /** Maximum number of full replan attempts. */
  maxReplans: z.number().int().min(0).default(2),
});
export type Budget = z.infer<typeof BudgetSchema>;

/* ------------------------------------------------------------------ */
/*  Constraints                                                       */
/* ------------------------------------------------------------------ */

export const TaskConstraintsSchema = z.object({
  /** Allowed tool names (empty = all allowed by policy). */
  allowedTools: z.array(z.string()).default([]),
  /** Denied tool names (takes precedence over allowed). */
  deniedTools: z.array(z.string()).default([]),
  /** If true, no data may leave the local environment. */
  offlineOnly: z.boolean().default(false),
  /** If true, the task must not perform any writes/mutations. */
  readOnly: z.boolean().default(false),
  /** Allowed domains for browser navigation. */
  allowedDomains: z.array(z.string()).default([]),
  /** Require human confirmation before high-risk actions. */
  requireHumanConfirmation: z.boolean().default(false),
  /** Maximum file size the task may produce (bytes). */
  maxOutputSizeBytes: z.number().int().positive().optional(),
});
export type TaskConstraints = z.infer<typeof TaskConstraintsSchema>;

/* ------------------------------------------------------------------ */
/*  Definition of Done                                                */
/* ------------------------------------------------------------------ */

export const AssertionSchema = z.object({
  /** Human-readable description of the assertion. */
  description: z.string(),
  /** Machine-checkable type (e.g. "file_exists", "contains_text"). */
  type: z.enum([
    "file_exists",
    "contains_text",
    "url_matches",
    "artifact_generated",
    "network_status",
    "value_equals",
    "custom",
  ]),
  /** Parameters specific to the assertion type. */
  params: z.record(z.any()).default({}),
});
export type Assertion = z.infer<typeof AssertionSchema>;

export const DefinitionOfDoneSchema = z.object({
  /** Free-text description of what "done" looks like. */
  summary: z.string(),
  /** Machine-checkable assertions that must all pass. */
  assertions: z.array(AssertionSchema).default([]),
  /** Minimum confidence score (0–1) from the Verifier agent. */
  minConfidence: z.number().min(0).max(1).default(0.8),
});
export type DefinitionOfDone = z.infer<typeof DefinitionOfDoneSchema>;

/* ------------------------------------------------------------------ */
/*  Full Task Model                                                   */
/* ------------------------------------------------------------------ */

export const TaskModelSchema = z.object({
  id: z.string().uuid(),
  /** What the user wants to achieve. */
  goal: z.string().min(1),
  /** Operational constraints. */
  constraints: TaskConstraintsSchema.default({}),
  /** What "done" means. */
  definitionOfDone: DefinitionOfDoneSchema,
  /** Risk assessment. */
  riskLevel: RiskLevelSchema.default("low"),
  /** Time/resource budget. */
  budget: BudgetSchema.default({}),
  /** Priority for scheduling. */
  priority: TaskPrioritySchema.default("medium"),
  /** Current lifecycle status. */
  status: TaskStatusSchema.default("pending"),

  /** Contextual metadata (attachments, history, user prefs). */
  context: z.object({
    userId: z.string(),
    chatId: z.string().optional(),
    runId: z.string().optional(),
    userPlan: z.enum(["free", "pro", "admin"]).default("free"),
    locale: z.string().default("es"),
    attachments: z.array(z.object({
      name: z.string(),
      type: z.string().optional(),
      path: z.string().optional(),
      url: z.string().optional(),
    })).default([]),
    conversationHistory: z.array(z.object({
      role: z.enum(["user", "assistant", "system"]),
      content: z.string(),
    })).default([]),
  }),

  /** Timestamps. */
  createdAt: z.date().default(() => new Date()),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),

  /** Metrics collected during execution. */
  metrics: z.object({
    stepsExecuted: z.number().int().min(0).default(0),
    stepsSucceeded: z.number().int().min(0).default(0),
    stepsFailed: z.number().int().min(0).default(0),
    retries: z.number().int().min(0).default(0),
    replans: z.number().int().min(0).default(0),
    tokensUsed: z.number().int().min(0).default(0),
    wallClockMs: z.number().int().min(0).default(0),
    artifactsProduced: z.number().int().min(0).default(0),
  }).default({}),
});
export type TaskModel = z.infer<typeof TaskModelSchema>;

/* ------------------------------------------------------------------ */
/*  Factory helper                                                    */
/* ------------------------------------------------------------------ */

export function createTaskModel(
  params: Pick<TaskModel, "goal" | "context"> &
    Partial<Omit<TaskModel, "goal" | "context" | "id" | "createdAt">>
): TaskModel {
  return TaskModelSchema.parse({
    id: randomUUID(),
    definitionOfDone: {
      summary: `Complete: ${(params.goal || "").slice(0, 200)}`,
      assertions: [],
      minConfidence: 0.8,
    },
    ...params,
  });
}

/* ------------------------------------------------------------------ */
/*  Risk classifier (heuristic)                                       */
/* ------------------------------------------------------------------ */

const HIGH_RISK_TOOLS = new Set([
  "shell_command",
  "write_file",
  "delete_file",
  "send_email",
  "whatsapp_send",
  "database_query",
]);

const CRITICAL_KEYWORDS = /\b(delete|drop|truncate|format|rm\s+-rf|transfer|payment|wire)\b/i;

export function assessRisk(goal: string, tools: string[]): RiskLevel {
  if (CRITICAL_KEYWORDS.test(goal)) return "critical";
  const hasHighRiskTool = tools.some((t) => HIGH_RISK_TOOLS.has(t));
  if (hasHighRiskTool) return "high";
  if (tools.length > 5) return "medium";
  return "low";
}
