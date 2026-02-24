import { z } from "zod";

export const IntentCategoryEnum = z.enum([
  "query",
  "command",
  "conversation",
  "creation",
  "analysis",
  "automation",
  "research",
  "code",
  "clarification",
]);
export type IntentCategory = z.infer<typeof IntentCategoryEnum>;

export const EntityTypeEnum = z.enum([
  "file_path",
  "url",
  "code_snippet",
  "date_time",
  "number",
  "person",
  "organization",
  "tool_reference",
  "data_format",
  "programming_language",
  "action_verb",
  "domain_term",
  "technology",
  "library",
  "project_name"
]);
export type EntityType = z.infer<typeof EntityTypeEnum>;

export const IntentSchema = z.object({
  category: IntentCategoryEnum,
  subIntent: z.string().optional(),
  confidence: z.number().min(0).max(1),
  keywords: z.array(z.string()).default([]),
});
export type Intent = z.infer<typeof IntentSchema>;

export const EntitySchema = z.object({
  type: EntityTypeEnum,
  value: z.string(),
  startPos: z.number().int().nonnegative(),
  endPos: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  normalizedValue: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type Entity = z.infer<typeof EntitySchema>;

export const ToolCandidateSchema = z.object({
  toolName: z.string(),
  relevanceScore: z.number().min(0).max(1),
  capabilityMatch: z.number().min(0).max(1),
  requiredParams: z.record(z.unknown()).default({}),
  optionalParams: z.record(z.unknown()).default({}),
  dependencies: z.array(z.string()).default([]),
});
export type ToolCandidate = z.infer<typeof ToolCandidateSchema>;

export const TaskNodeSchema = z.object({
  id: z.string(),
  tool: z.string(),
  inputs: z.record(z.unknown()),
  dependencies: z.array(z.string()).default([]),
  priority: z.number().int().min(1).max(10).default(5),
  canFail: z.boolean().default(false),
  timeoutMs: z.number().int().positive().default(60000),
  retryCount: z.number().int().nonnegative().default(3),
});
export type TaskNode = z.infer<typeof TaskNodeSchema>;

export const ExecutionPlanSchema: z.ZodType<ExecutionPlan, z.ZodTypeDef, any> = z.object({
  planId: z.string(),
  objective: z.string(),
  nodes: z.array(TaskNodeSchema),
  edges: z.array(z.tuple([z.string(), z.string()])),
  estimatedDurationMs: z.number().int().nonnegative(),
  parallelGroups: z.array(z.array(z.string())),
  fallbackPlan: z.lazy(() => ExecutionPlanSchema).optional(),
});
export interface ExecutionPlan {
  planId: string;
  objective: string;
  nodes: TaskNode[];
  edges: [string, string][];
  estimatedDurationMs: number;
  parallelGroups: string[][];
  fallbackPlan?: ExecutionPlan;
}

export const PromptAnalysisResultSchema = z.object({
  originalPrompt: z.string(),
  normalizedPrompt: z.string(),
  intents: z.array(IntentSchema),
  entities: z.array(EntitySchema),
  toolCandidates: z.array(ToolCandidateSchema),
  executionPlan: ExecutionPlanSchema,
  requiresClarification: z.boolean().default(false),
  clarificationQuestions: z.array(z.string()).default([]),
  contextUsed: z.record(z.unknown()).default({}),
  analysisMetadata: z.record(z.unknown()).default({}),
});
export type PromptAnalysisResult = z.infer<typeof PromptAnalysisResultSchema>;

export const IntentPatternSchema = z.object({
  category: IntentCategoryEnum,
  patterns: z.array(z.string()),
  keywords: z.array(z.string()),
  weight: z.number().positive().default(1.0),
});
export type IntentPattern = z.infer<typeof IntentPatternSchema>;

export const EntityPatternSchema = z.object({
  type: EntityTypeEnum,
  pattern: z.string(),
  normalizer: z.string().optional(),
});
export type EntityPattern = z.infer<typeof EntityPatternSchema>;

export interface PAREConfig {
  intentConfidenceThreshold: number;
  similarityThreshold: number;
  maxToolCandidates: number;
  useLLMFallback: boolean;
  enableParallelExecution: boolean;
  maxPlanningIterations: number;
}

export const DEFAULT_PARE_CONFIG: PAREConfig = {
  intentConfidenceThreshold: 0.7,
  similarityThreshold: 0.5,
  maxToolCandidates: 5,
  useLLMFallback: true,
  enableParallelExecution: true,
  maxPlanningIterations: 3,
};

export interface SessionContext {
  sessionId?: string;
  userId?: string;
  previousMessages?: Array<{ role: string; content: string }>;
  attachments?: Array<{ type: string; name: string; content?: string }>;
  hasAttachments?: boolean;
  attachmentTypes?: string[];
  userPreferences?: Record<string, unknown>;
  relevantMemories?: Array<{ content: string; type: string }>;
}

export interface RoutingDecision {
  route: "chat" | "agent" | "hybrid";
  confidence: number;
  reasons: string[];
  toolNeeds: string[];
  planHint: string[];
  analysisResult?: PromptAnalysisResult;
}
