import type { ToolArtifact, ToolResult } from "../toolRegistry";

export type RuntimeStatus =
  | "planning"
  | "running"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export type RuntimeTaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "retry_scheduled"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

export interface TaskValidationRule {
  id: string;
  name: string;
  type: "tool_success" | "output_present" | "artifact_present" | "command_exit_zero";
  command?: string;
  artifactType?: string;
  artifactName?: string;
  required: boolean;
}

export interface ExpectedArtifact {
  name: string;
  type: string;
  required: boolean;
  pathHint?: string;
}

export interface TaskRetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

export interface RuntimeTaskNode {
  id: string;
  index: number;
  title: string;
  description: string;
  toolName: string;
  input: Record<string, any>;
  dependencies: string[];
  successCriteria: string[];
  definitionOfDone: string[];
  validations: TaskValidationRule[];
  expectedArtifacts: ExpectedArtifact[];
  retryPolicy: TaskRetryPolicy;
  metadata?: Record<string, any>;
}

export interface RuntimeTaskGraph {
  graphId: string;
  objective: string;
  createdAt: number;
  maxConcurrency: number;
  tasks: RuntimeTaskNode[];
  globalValidations: TaskValidationRule[];
}

export interface RuntimeTaskState {
  taskId: string;
  index: number;
  status: RuntimeTaskStatus;
  attempt: number;
  startedAt?: number;
  completedAt?: number;
  lastError?: string;
  result?: ToolResult;
}

export interface RuntimeValidationResult {
  id: string;
  name: string;
  type: TaskValidationRule["type"];
  passed: boolean;
  message: string;
  taskId?: string;
  taskIndex?: number;
  command?: string;
  durationMs?: number;
}

export interface RuntimeSnapshot {
  runId: string;
  graphId: string;
  status: RuntimeStatus;
  updatedAt: number;
  queueDepth: number;
  activeTasks: string[];
  tasks: Array<{
    taskId: string;
    index: number;
    status: RuntimeTaskStatus;
    attempt: number;
    startedAt?: number;
    completedAt?: number;
    lastError?: string;
  }>;
  validations: RuntimeValidationResult[];
  artifacts: Array<{
    id?: string;
    name: string;
    type: string;
    url?: string;
  }>;
}

export interface RuntimeTransition {
  taskId: string;
  taskIndex: number;
  from: RuntimeTaskStatus;
  to: RuntimeTaskStatus;
  attempt: number;
  result?: ToolResult;
  error?: string;
}

export interface RuntimeDeliveryPack {
  artifactPaths: string[];
  artifacts: Array<{
    name: string;
    type: string;
    url?: string;
    mimeType?: string;
    size?: number;
  }>;
  executionCommands: string[];
  automatedChecks: RuntimeValidationResult[];
  reproductionSteps: string[];
}

export interface RuntimeExecutionResult {
  success: boolean;
  status: RuntimeStatus;
  taskStates: RuntimeTaskState[];
  artifacts: ToolArtifact[];
  validations: RuntimeValidationResult[];
  deliveryPack: RuntimeDeliveryPack;
  summary: string;
  error?: string;
}

export interface RuntimeExecutorHooks {
  runId: string;
  chatId: string;
  userId: string;
  userPlan: "free" | "pro" | "admin";
  signal: AbortSignal;
  maxWorkers?: number;
  emitTraceEvent: (
    eventType: string,
    options?: {
      stepIndex?: number;
      stepId?: string;
      phase?: "planning" | "executing" | "verifying" | "completed" | "failed" | "cancelled";
      status?: "pending" | "running" | "completed" | "failed" | "cancelled" | "retrying";
      tool_name?: string;
      command?: string;
      output_snippet?: string;
      chunk_sequence?: number;
      is_final_chunk?: boolean;
      artifact?: { type: string; name: string; url?: string; data?: any };
      summary?: string;
      error?: { code?: string; message: string; retryable?: boolean };
      metadata?: Record<string, any>;
    }
  ) => Promise<void>;
  executeTool: (
    toolName: string,
    input: Record<string, any>,
    context: {
      stepIndex: number;
      correlationId: string;
      onStream?: (evt: { stream: "stdout" | "stderr"; chunk: string }) => void;
      onExit?: (evt: {
        exitCode: number;
        signal: string | null;
        wasKilled: boolean;
        durationMs: number;
      }) => void;
    }
  ) => Promise<ToolResult>;
  onTransition?: (transition: RuntimeTransition) => void;
  persistSnapshot?: (snapshot: RuntimeSnapshot) => Promise<void>;
}

