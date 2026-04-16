export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  inputSchema: Record<string, ParameterSchema>;
  outputSchema: Record<string, ParameterSchema>;
  capabilities: string[];
  requiresApproval?: boolean;
  rateLimit?: { requests: number; windowMs: number };
  timeout?: number;
  execute: (context: ExecutionContext, params: Record<string, any>) => Promise<ToolResult>;
  validate?: (params: Record<string, any>) => ValidationResult;
}

export type ToolCategory = 
  | "web" 
  | "data" 
  | "file" 
  | "transform" 
  | "api" 
  | "analysis" 
  | "utility";

export interface ParameterSchema {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required?: boolean;
  default?: any;
  enum?: any[];
  items?: ParameterSchema;
  properties?: Record<string, ParameterSchema>;
}

export interface ExecutionContext {
  runId: string;
  planId: string;
  stepIndex: number;
  userId?: string;
  conversationId?: string;
  previousResults: StepResult[];
  artifacts: Map<string, Artifact>;
  variables: Map<string, any>;
  onProgress: (update: ProgressUpdate) => void;
  isCancelled: () => boolean;
}

export interface ProgressUpdate {
  runId: string;
  stepId: string;
  status: "started" | "progress" | "completed" | "failed" | "skipped";
  progress?: number;
  message?: string;
  detail?: any;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  artifacts?: Artifact[];
  metadata?: Record<string, any>;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

export interface Artifact {
  id: string;
  type: ArtifactType;
  name: string;
  content?: string;
  storagePath?: string;
  mimeType?: string;
  size?: number;
  metadata?: Record<string, any>;
}

export type ArtifactType = 
  | "text" 
  | "json" 
  | "html" 
  | "markdown" 
  | "image" 
  | "document" 
  | "spreadsheet"
  | "screenshot"
  | "file";

export interface PlanStep {
  id: string;
  toolId: string;
  description: string;
  params: Record<string, any>;
  dependsOn?: string[];
  condition?: string;
  retryPolicy?: RetryPolicy;
  timeout?: number;
  optional?: boolean;
}

export interface RetryPolicy {
  maxRetries: number;
  delayMs: number;
  backoffMultiplier?: number;
}

export interface ExecutionPlan {
  id: string;
  runId: string;
  objective: string;
  interpretedIntent: InterpretedIntent;
  steps: PlanStep[];
  createdAt: Date;
  estimatedDuration?: number;
}

export interface InterpretedIntent {
  action: string;
  entities: Record<string, any>;
  constraints: string[];
  expectedOutput: string;
  confidence: number;
}

export interface StepResult {
  stepId: string;
  toolId: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: Date;
  completedAt?: Date;
  input: Record<string, any>;
  output?: ToolResult;
  retryCount: number;
  duration?: number;
  validated: boolean;
  validationErrors?: string[];
}

export interface WebSource {
  url: string;
  title: string;
  domain: string;
  favicon: string;
  snippet?: string;
  date?: string;
}

export interface PipelineResult {
  runId: string;
  planId: string;
  success: boolean;
  summary: string;
  steps: StepResult[];
  artifacts: Artifact[];
  webSources?: WebSource[];
  errors?: string[];
  totalDuration: number;
  metadata?: Record<string, any>;
}

export interface PipelineConfig {
  maxSteps: number;
  defaultTimeout: number;
  enableParallelExecution: boolean;
  maxParallelSteps: number;
  auditLevel: "minimal" | "standard" | "verbose";
  sandboxMode: boolean;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  maxSteps: 20,
  defaultTimeout: 60000,
  enableParallelExecution: true,
  maxParallelSteps: 3,
  auditLevel: "standard",
  sandboxMode: true
};
