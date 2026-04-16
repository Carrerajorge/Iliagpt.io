import { z } from "zod";

export const IntentTypeSchema = z.enum([
  "search",
  "analyze",
  "generate",
  "transform",
  "summarize",
  "extract",
  "navigate",
  "chat"
]);

export type IntentType = z.infer<typeof IntentTypeSchema>;

export const ExecutionModeSchema = z.enum([
  "sequential",
  "parallel",
  "conditional"
]);

export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const TaskPlanSchema = z.object({
  id: z.string(),
  title: z.string(),
  intentType: IntentTypeSchema,
  description: z.string(),
  requiredContext: z.array(z.string()).default([]),
  executionMode: ExecutionModeSchema.default("sequential"),
  dependencies: z.array(z.string()).default([]),
  preferredTool: z.string().optional(),
  retryPolicy: z.object({
    maxRetries: z.number().default(2),
    delayMs: z.number().default(1000)
  }).optional(),
  priority: z.number().default(0)
});

export type TaskPlan = z.infer<typeof TaskPlanSchema>;

export const TaskStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped"
]);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const ExecutionResultSchema = z.object({
  taskId: z.string(),
  status: TaskStatusSchema,
  output: z.any().optional(),
  artifacts: z.array(z.object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    storagePath: z.string().optional(),
    mimeType: z.string().optional()
  })).default([]),
  error: z.string().optional(),
  duration: z.number().optional(),
  retryCount: z.number().default(0)
});

export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

export const PipelineErrorSchema = z.object({
  taskId: z.string(),
  code: z.string(),
  message: z.string(),
  recoverable: z.boolean().default(false),
  timestamp: z.number()
});

export type PipelineError = z.infer<typeof PipelineErrorSchema>;

export const CompletionStatusSchema = z.enum([
  "complete",
  "partial",
  "failed"
]);

export type CompletionStatus = z.infer<typeof CompletionStatusSchema>;

export const AggregateSummarySchema = z.object({
  completionStatus: CompletionStatusSchema,
  summary: z.string(),
  totalTasks: z.number(),
  completedTasks: z.number(),
  failedTasks: z.number(),
  skippedTasks: z.number(),
  missingTasks: z.array(z.string()).default([]),
  duration: z.number()
});

export type AggregateSummary = z.infer<typeof AggregateSummarySchema>;

export const PipelineResponseSchema = z.object({
  plan: z.array(TaskPlanSchema),
  results: z.array(ExecutionResultSchema),
  errors: z.array(PipelineErrorSchema).default([]),
  aggregate: AggregateSummarySchema
});

export type PipelineResponse = z.infer<typeof PipelineResponseSchema>;

export const MultiIntentDetectionSchema = z.object({
  isMultiIntent: z.boolean(),
  confidence: z.number().min(0).max(1),
  detectedIntents: z.array(z.object({
    type: IntentTypeSchema,
    description: z.string(),
    keywords: z.array(z.string())
  })),
  suggestedPlan: z.array(TaskPlanSchema).optional()
});

export type MultiIntentDetection = z.infer<typeof MultiIntentDetectionSchema>;

export const MULTI_INTENT_THRESHOLD = 0.7;
export const MAX_PARALLEL_TASKS = 3;
export const DEFAULT_TASK_TIMEOUT = 60000;
