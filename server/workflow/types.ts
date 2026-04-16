export type WorkflowRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type WorkflowStepStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "retrying";

export interface WorkflowStepRetryPolicy {
  attempts: number;
  backoffMs: number;
  maxBackoffMs?: number;
}

export interface WorkflowArtifact {
  id?: string;
  key?: string;
  type: string;
  name: string;
  url?: string;
  payload?: Record<string, any> | null;
  metadata?: Record<string, any>;
}

export interface WorkflowStepLog {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface WorkflowStepDefinition {
  id: string;
  name: string;
  toolName: string;
  description?: string;
  executorKey?: string;
  dependencies?: string[];
  timeoutMs?: number;
  retryPolicy?: WorkflowStepRetryPolicy;
  metadata?: Record<string, any>;
  input?: Record<string, any>;
}

export interface WorkflowDefinition {
  id?: string;
  objective: string;
  steps: WorkflowStepDefinition[];
  concurrency?: number;
  metadata?: Record<string, any>;
}

export interface WorkflowSubmission {
  chatId: string;
  userId: string | null;
  plan: WorkflowDefinition;
  idempotencyKey?: string;
  traceId?: string;
  userPlan?: "free" | "pro" | "admin";
  variables?: Record<string, any>;
}

export interface StepExecutorContext {
  runId: string;
  chatId: string;
  userId?: string | null;
  userPlan?: "free" | "pro" | "admin";
  step: WorkflowStepDefinition;
  stepId?: string;
  attempt: number;
  variables: Record<string, any>;
  traceId?: string;
  stepIndex: number;
}

export interface WorkflowStepResult {
  success: boolean;
  output?: any;
  artifacts?: WorkflowArtifact[];
  logs?: WorkflowStepLog[];
  error?: {
    code?: string;
    message: string;
    retryable?: boolean;
  };
  metadata?: Record<string, any>;
}

export type StepExecutor = (context: StepExecutorContext) => Promise<WorkflowStepResult>;

export interface StepExecutorRegistry {
  getExecutor(key: string): StepExecutor | undefined;
  registerExecutor(key: string, executor: StepExecutor): void;
}

export type WorkflowEventSeverity = "info" | "warning" | "error";
