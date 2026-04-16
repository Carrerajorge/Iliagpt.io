import { z } from "zod";

export const PhaseStatusSchema = z.enum(["pending", "in_progress", "completed", "failed", "skipped"]);
export type PhaseStatus = z.infer<typeof PhaseStatusSchema>;

export const AgentStateSchema = z.enum(["idle", "analyzing", "planning", "executing", "delivering", "error"]);
export type AgentState = z.infer<typeof AgentStateSchema>;

export const ToolCategorySchema = z.enum(["system", "file", "document", "search", "browser", "communication", "development", "integration", "data", "ai"]);
export type ToolCategory = z.infer<typeof ToolCategorySchema>;

export const StepSchema = z.object({
  id: z.string(),
  description: z.string(),
  tool: z.string(),
  params: z.record(z.any()),
  status: PhaseStatusSchema.default("pending"),
  result: z.any().optional(),
  error: z.string().optional(),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
  executionTimeMs: z.number().optional(),
});
export type Step = z.infer<typeof StepSchema>;

export const PhaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string().default("📋"),
  steps: z.array(StepSchema).default([]),
  status: PhaseStatusSchema.default("pending"),
});
export type Phase = z.infer<typeof PhaseSchema>;

export const TaskPlanSchema = z.object({
  taskId: z.string(),
  objective: z.string(),
  phases: z.array(PhaseSchema).default([]),
  currentPhaseIndex: z.number().default(0),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type TaskPlan = z.infer<typeof TaskPlanSchema>;

export const ToolResultSchema = z.object({
  success: z.boolean(),
  toolName: z.string(),
  data: z.any().optional(),
  message: z.string().default(""),
  error: z.string().optional(),
  executionTimeMs: z.number().default(0),
  filesCreated: z.array(z.string()).default([]),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

export const AgentConfigSchema = z.object({
  name: z.string().default("Agent IA v2.0"),
  maxIterations: z.number().int().positive().default(100),
  timeout: z.number().int().positive().default(60000),
  verbose: z.boolean().default(true),
  workspaceRoot: z.string().optional(),
  outputDir: z.string().optional(),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const AgentStatusSchema = z.object({
  name: z.string(),
  state: AgentStateSchema,
  iterations: z.number(),
  toolsAvailable: z.array(z.string()),
  historyCount: z.number(),
  currentPlan: TaskPlanSchema.optional(),
  progress: z.number().min(0).max(100),
});
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const SlideChartSchema = z.object({
  type: z.enum(["bar", "line", "pie"]),
  data: z.object({
    labels: z.array(z.string()),
    values: z.array(z.number()),
  }),
  title: z.string().optional(),
});
export type SlideChart = z.infer<typeof SlideChartSchema>;

export const DocumentSlideSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  bullets: z.array(z.string()).optional(),
  imageUrl: z.string().optional(),
  imageBase64: z.string().optional(),
  generateImage: z.string().optional(),
  chart: SlideChartSchema.optional(),
});
export type DocumentSlide = z.infer<typeof DocumentSlideSchema>;

export const DocumentSectionSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  bullets: z.array(z.string()).optional(),
  level: z.number().int().min(1).max(6).default(1),
});
export type DocumentSection = z.infer<typeof DocumentSectionSchema>;

export const ExcelSheetSchema = z.object({
  name: z.string(),
  headers: z.array(z.string()),
  rows: z.array(z.array(z.any())),
  chart: z.object({
    title: z.string(),
    type: z.enum(["bar", "line", "pie"]).default("bar"),
  }).optional(),
});
export type ExcelSheet = z.infer<typeof ExcelSheetSchema>;

export const SearchResultSchema = z.object({
  title: z.string(),
  snippet: z.string(),
  url: z.string(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const WebPageContentSchema = z.object({
  url: z.string(),
  title: z.string(),
  content: z.string(),
  status: z.number(),
  error: z.string().optional(),
});
export type WebPageContent = z.infer<typeof WebPageContentSchema>;

export interface IAgentTool {
  name: string;
  description: string;
  category: ToolCategory;
  enabled: boolean;
  execute(params: Record<string, any>): Promise<ToolResult>;
}

export interface ITaskPlanner {
  createPlan(userInput: string): Promise<TaskPlan>;
  detectIntent(text: string): Promise<{ intent: string; entities: Record<string, any> }>;
}

export interface IAgentV2 {
  run(userInput: string): Promise<string>;
  executeDirectTool(toolName: string, params: Record<string, any>): Promise<ToolResult>;
  getStatus(): AgentStatus;
  getAvailableTools(): string[];
}

export function createStep(id: string, description: string, tool: string, params: Record<string, any>): Step {
  return { id, description, tool, params, status: "pending" };
}

export function createPhase(id: string, name: string, description: string, icon: string, steps: Step[]): Phase {
  return { id, name, description, icon, steps, status: "pending" };
}

export function createTaskPlan(taskId: string, objective: string, phases: Phase[]): TaskPlan {
  return {
    taskId,
    objective,
    phases,
    currentPhaseIndex: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export function calculateProgress(plan: TaskPlan): number {
  const totalSteps = plan.phases.reduce((sum, p) => sum + p.steps.length, 0);
  if (totalSteps === 0) return 0;
  const completedSteps = plan.phases.reduce(
    (sum, p) => sum + p.steps.filter(s => s.status === "completed").length,
    0
  );
  return (completedSteps / totalSteps) * 100;
}

export function isPlanComplete(plan: TaskPlan): boolean {
  return plan.phases.every(p => p.steps.every(s => s.status === "completed"));
}

export function getNextStep(plan: TaskPlan): { phase: Phase; step: Step } | null {
  for (const phase of plan.phases) {
    for (const step of phase.steps) {
      if (step.status === "pending") {
        return { phase, step };
      }
    }
  }
  return null;
}
