/**
 * Agent Step Types — defines the structure of each step in an agentic tool-use pipeline.
 * Steps are streamed via SSE to show real-time progress in the chat UI.
 */

export type AgentStepType =
  | "thinking"
  | "reading"
  | "executing"
  | "editing"
  | "searching"
  | "generating"
  | "analyzing"
  | "completed";

export type AgentStepStatus = "pending" | "running" | "completed" | "failed";

export interface AgentStep {
  id: string;
  type: AgentStepType;
  title: string;
  description?: string;
  fileName?: string;
  diff?: { added: number; removed: number };
  script?: string;
  output?: string;
  status: AgentStepStatus;
  timestamp: Date;
  duration?: number;
  expandable: boolean;
  artifact?: StepArtifact;
}

export interface StepArtifact {
  id: string;
  name: string;
  type: "docx" | "xlsx" | "pptx" | "pdf" | "png" | "csv" | "json" | "txt" | "html";
  mimeType: string;
  size?: number;
  downloadUrl: string;
  previewUrl?: string;
}

let stepCounter = 0;

/** Create a new step with auto-generated ID and timestamp. */
export function createStep(
  type: AgentStepType,
  title: string,
  opts?: Partial<Pick<AgentStep, "description" | "fileName" | "diff" | "script" | "output" | "artifact" | "expandable">>,
): AgentStep {
  return {
    id: `step-${Date.now()}-${++stepCounter}`,
    type,
    title,
    status: "running",
    timestamp: new Date(),
    expandable: type === "executing" || type === "editing" || !!opts?.script || !!opts?.output,
    ...opts,
  };
}

/** Mark a step as completed and record its duration. */
export function completeStep(step: AgentStep, updates?: Partial<Pick<AgentStep, "output" | "artifact" | "title">>): AgentStep {
  return {
    ...step,
    ...updates,
    status: "completed",
    duration: Date.now() - step.timestamp.getTime(),
  };
}

/** Mark a step as failed. */
export function failStep(step: AgentStep, error?: string): AgentStep {
  return {
    ...step,
    status: "failed",
    output: error || "Step failed",
    duration: Date.now() - step.timestamp.getTime(),
  };
}
