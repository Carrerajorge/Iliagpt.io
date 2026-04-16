import { z } from "zod";
import { RunStatusSchema, StepStatusSchema } from "./stateMachine";

export const ToolCapabilitySchema = z.enum([
  "requires_network",
  "produces_artifacts",
  "reads_files",
  "writes_files",
  "executes_code",
  "accesses_external_api",
  "long_running",
  "high_risk"
]);
export type ToolCapability = z.infer<typeof ToolCapabilitySchema>;

export const UserPlanSchema = z.enum(["free", "pro", "admin"]);
export type UserPlan = z.infer<typeof UserPlanSchema>;

export const ImageArtifactDataSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  format: z.enum(["png", "jpeg", "gif", "webp", "svg"]),
  base64: z.string().optional(),
});

export const DocumentArtifactDataSchema = z.object({
  pageCount: z.number().int().nonnegative().optional(),
  format: z.enum(["pdf", "docx", "xlsx", "pptx", "txt", "html", "md"]),
  content: z.string().optional(),
});

export const ChartArtifactDataSchema = z.object({
  chartType: z.enum(["bar", "line", "pie", "scatter", "area", "radar"]),
  config: z.record(z.any()),
  data: z.array(z.record(z.any())),
});

export const DataArtifactDataSchema = z.object({
  format: z.enum(["json", "csv", "xml"]),
  rows: z.number().int().nonnegative().optional(),
  columns: z.array(z.string()).optional(),
  sample: z.any().optional(),
});

export const ArtifactDataSchema = z.discriminatedUnion("artifactType", [
  z.object({ artifactType: z.literal("image"), ...ImageArtifactDataSchema.shape }),
  z.object({ artifactType: z.literal("document"), ...DocumentArtifactDataSchema.shape }),
  z.object({ artifactType: z.literal("chart"), ...ChartArtifactDataSchema.shape }),
  z.object({ artifactType: z.literal("data"), ...DataArtifactDataSchema.shape }),
  z.object({ artifactType: z.literal("file"), path: z.string() }),
  z.object({ artifactType: z.literal("preview"), content: z.string() }),
  z.object({ artifactType: z.literal("link"), href: z.string().url() }),
]);

export const ArtifactSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["file", "image", "document", "chart", "data", "preview", "link"]),
  name: z.string().min(1),
  mimeType: z.string().optional(),
  url: z.string().url().optional(),
  data: ArtifactDataSchema.optional(),
  size: z.number().int().positive().optional(),
  metadata: z.record(z.any()).optional(),
  createdAt: z.date(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const ToolInputSchema = z.object({
  toolName: z.string().min(1),
  params: z.record(z.any()),
  idempotencyKey: z.string().optional(),
});
export type ToolInput = z.infer<typeof ToolInputSchema>;

export const ToolOutputSchema = z.object({
  success: z.boolean(),
  artifacts: z.array(ArtifactSchema).default([]),
  previews: z.array(z.object({
    type: z.enum(["text", "html", "markdown", "image", "chart"]),
    content: z.any(),
    title: z.string().optional(),
  })).default([]),
  logs: z.array(z.object({
    level: z.enum(["debug", "info", "warn", "error"]),
    message: z.string(),
    timestamp: z.date(),
    data: z.any().optional(),
  })).default([]),
  metrics: z.object({
    durationMs: z.number().int().nonnegative(),
    tokensUsed: z.number().int().nonnegative().optional(),
    apiCalls: z.number().int().nonnegative().optional(),
    bytesProcessed: z.number().int().nonnegative().optional(),
  }).optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean().default(false),
    details: z.any().optional(),
  }).optional(),
  rawOutput: z.any().optional(),
});
export type ToolOutput = z.infer<typeof ToolOutputSchema>;

export const ToolCallSchema = z.object({
  id: z.string().uuid(),
  stepIndex: z.number().int().nonnegative(),
  toolName: z.string().min(1),
  input: ToolInputSchema,
  output: ToolOutputSchema.optional(),
  status: StepStatusSchema,
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  retryCount: z.number().int().nonnegative().default(0),
  error: z.string().optional(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const PlanStepSchema = z.object({
  index: z.number().int().nonnegative(),
  toolName: z.string().min(1),
  description: z.string().min(1),
  input: z.record(z.any()),
  expectedOutput: z.string(),
  dependencies: z.array(z.number().int().nonnegative()).default([]),
  optional: z.boolean().default(false),
  timeoutMs: z.number().int().positive().optional(),
  phaseId: z.string().optional(),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const PlanPhaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["pending", "in_progress", "completed", "failed", "skipped"]).default("pending"),
  stepIndices: z.array(z.number().int().nonnegative()).default([]),
});
export type PlanPhase = z.infer<typeof PlanPhaseSchema>;

export const AgentTaskSchema = z.object({
  id: z.string().uuid().optional(),
  goal: z.string().min(1).describe("The primary objective the agent needs to achieve"),
  constraints: z.array(z.string()).default([]).describe("Rules, boundaries, or limitations the agent must strictly follow"),
  context: z.record(z.any()).default({}).describe("Background information, entity data, or environment state relevant to the task"),
  artifacts: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      required: z.boolean().default(true),
    })
  ).default([]).describe("Expected files, documents, or data payloads the agent must produce"),
  done_definition: z.string().describe("Clear criteria to determine if the goal has been successfully met"),
});
export type AgentTask = z.infer<typeof AgentTaskSchema>;

export const AgentPlanSchema = z.object({
  objective: z.string().min(1),
  steps: z.array(PlanStepSchema).min(1).max(20),
  phases: z.array(PlanPhaseSchema).optional(),
  currentPhaseIndex: z.number().int().nonnegative().optional(),
  estimatedTimeMs: z.number().int().positive(),
  reasoning: z.string().optional(),
  createdAt: z.date(),
});
export type AgentPlan = z.infer<typeof AgentPlanSchema>;

export const StepSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  stepIndex: z.number().int().nonnegative(),
  toolName: z.string().min(1),
  description: z.string(),
  status: StepStatusSchema,
  input: z.record(z.any()),
  output: ToolOutputSchema.optional(),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  retryCount: z.number().int().nonnegative().default(0),
  error: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});
export type Step = z.infer<typeof StepSchema>;

export const RunSchema = z.object({
  id: z.string().uuid(),
  chatId: z.string(),
  messageId: z.string().optional(),
  userId: z.string(),
  status: RunStatusSchema,
  plan: AgentPlanSchema.optional(),
  steps: z.array(StepSchema).default([]),
  artifacts: z.array(ArtifactSchema).default([]),
  summary: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  correlationId: z.string().uuid(),
  idempotencyKey: z.string().optional(),
  currentStepIndex: z.number().int().nonnegative().default(0),
  totalSteps: z.number().int().nonnegative().default(0),
  completedSteps: z.number().int().nonnegative().default(0),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  metadata: z.record(z.any()).optional(),
});
export type Run = z.infer<typeof RunSchema>;

export const AgentEventSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  stepIndex: z.number().int().nonnegative().optional(),
  correlationId: z.string().uuid(),
  eventType: z.enum([
    "run_created",
    "run_started",
    "run_completed",
    "run_failed",
    "run_cancelled",
    "run_paused",
    "run_resumed",
    "plan_generated",
    "step_started",
    "step_completed",
    "step_failed",
    "step_retried",
    "step_skipped",
    "tool_called",
    "tool_completed",
    "tool_failed",
    "artifact_created",
    "error_occurred",
    "warning_logged"
  ]),
  payload: z.record(z.any()),
  timestamp: z.date(),
  metadata: z.record(z.any()).optional(),
});
export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const CreateRunRequestSchema = z.object({
  chatId: z.string().min(1),
  messageId: z.string().optional(),
  message: z.string().min(1),
  model: z.string().optional(),
  attachments: z.array(z.any()).optional(),
  idempotencyKey: z.string().optional(),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

export const StepResponseSchema = z.object({
  stepIndex: z.number(),
  toolName: z.string(),
  description: z.string().optional().nullable(),
  status: StepStatusSchema,
  output: z.any().optional().nullable(),
  error: z.string().optional().nullable(),
  startedAt: z.union([z.string().datetime(), z.date()]).optional().nullable(),
  completedAt: z.union([z.string().datetime(), z.date()]).optional().nullable(),
});
export type StepResponse = z.infer<typeof StepResponseSchema>;

export const StepsArrayResponseSchema = z.array(StepResponseSchema);
export type StepsArrayResponse = z.infer<typeof StepsArrayResponseSchema>;

export const RunResponseSchema = z.object({
  id: z.string().uuid(),
  chatId: z.string(),
  status: RunStatusSchema,
  plan: AgentPlanSchema.optional().nullable(),
  steps: z.array(StepResponseSchema),
  artifacts: z.array(z.object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    url: z.string().optional(),
  })),
  summary: z.string().optional().nullable(),
  error: z.string().optional().nullable(),
  // Optional debug/UX helpers (present for in-memory runs; empty for historical runs).
  eventStream: z.array(z.any()).optional(),
  todoList: z.array(z.any()).optional(),
  workspaceFiles: z.record(z.string()).optional(),
  currentStepIndex: z.number(),
  totalSteps: z.number(),
  completedSteps: z.number(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});
export type RunResponse = z.infer<typeof RunResponseSchema>;

export const CitationSchema = z.object({
  id: z.string().uuid(),
  sourceUrl: z.string().url(),
  sourceTitle: z.string(),
  quote: z.string().min(1).max(500),
  locator: z.string(),
  confidence: z.number().min(0).max(1),
  retrievedAt: z.date(),
  verifiedAt: z.date().optional(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const RunResultPackageSchema = z.object({
  finalAnswer: z.string(),
  artifacts: z.array(ArtifactSchema),
  citations: z.array(CitationSchema),
  runLog: z.array(AgentEventSchema),
  metrics: z.object({
    totalDurationMs: z.number(),
    planningMs: z.number(),
    executionMs: z.number(),
    verificationMs: z.number(),
    toolCalls: z.number(),
    tokensUsed: z.number().optional(),
    citationCoverage: z.number().min(0).max(1),
  }),
  status: RunStatusSchema,
  error: z.string().optional(),
});
export type RunResultPackage = z.infer<typeof RunResultPackageSchema>;

export const AgentRoleSchema = z.enum(["planner", "executor", "verifier"]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const RoleTransitionSchema = z.object({
  fromRole: AgentRoleSchema,
  toRole: AgentRoleSchema,
  timestamp: z.date(),
  reason: z.string(),
  metadata: z.record(z.any()).optional(),
});
export type RoleTransition = z.infer<typeof RoleTransitionSchema>;

export const CancellationTokenSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  cancelled: z.boolean().default(false),
  paused: z.boolean().default(false),
  reason: z.string().optional(),
  requestedAt: z.date().optional(),
});
export type CancellationToken = z.infer<typeof CancellationTokenSchema>;

export function validateRun(data: unknown): Run {
  return RunSchema.parse(data);
}

export function validateStep(data: unknown): Step {
  return StepSchema.parse(data);
}

export function validateToolCall(data: unknown): ToolCall {
  return ToolCallSchema.parse(data);
}

export function validateArtifact(data: unknown): Artifact {
  return ArtifactSchema.parse(data);
}

export function validateAgentEvent(data: unknown): AgentEvent {
  return AgentEventSchema.parse(data);
}

export function safeValidateRun(data: unknown): { success: true; data: Run } | { success: false; error: z.ZodError } {
  const result = RunSchema.safeParse(data);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

export function validateCitation(data: unknown): Citation {
  return CitationSchema.parse(data);
}

export function validateRunResultPackage(data: unknown): RunResultPackage {
  return RunResultPackageSchema.parse(data);
}

export function validateAgentRole(data: unknown): AgentRole {
  return AgentRoleSchema.parse(data);
}

export function validateRoleTransition(data: unknown): RoleTransition {
  return RoleTransitionSchema.parse(data);
}

export function validateCancellationToken(data: unknown): CancellationToken {
  return CancellationTokenSchema.parse(data);
}

export function validateAgentTask(data: unknown): AgentTask {
  return AgentTaskSchema.parse(data);
}

