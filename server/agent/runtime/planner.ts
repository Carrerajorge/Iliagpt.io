import { randomUUID } from "crypto";
import type { RuntimeTaskGraph, RuntimeTaskNode, TaskValidationRule, ExpectedArtifact } from "./types";

export interface PlannerPlanStep {
  index: number;
  toolName: string;
  description: string;
  input: any;
  expectedOutput?: string;
}

export interface PlannerInput {
  objective: string;
  userMessage: string;
  steps: PlannerPlanStep[];
  attachments?: any[];
}

const READ_ONLY_TOOLS = new Set([
  "web_search",
  "web_search_retrieve",
  "browse_url",
  "fetch_url",
  "read_file",
  "list_files",
  "analyze_spreadsheet",
  "analyze_data",
]);

const ARTIFACT_TOOLS: Record<string, { type: string; namePrefix: string }> = {
  generate_document: { type: "document", namePrefix: "document" },
  create_document: { type: "document", namePrefix: "document" },
  create_spreadsheet: { type: "spreadsheet", namePrefix: "spreadsheet" },
  create_presentation: { type: "presentation", namePrefix: "presentation" },
  generate_image: { type: "image", namePrefix: "image" },
};

function normalizeToolName(name: string): string {
  const normalized = String(name || "").trim();
  if (!normalized) return "respond";
  if (normalized === "search_web") return "web_search";
  return normalized;
}

function buildTaskValidations(step: PlannerPlanStep, expectedArtifacts: ExpectedArtifact[]): TaskValidationRule[] {
  const validations: TaskValidationRule[] = [
    {
      id: `validation-${step.index}-tool-success`,
      name: "Tool execution succeeded",
      type: "tool_success",
      required: true,
    },
  ];

  if (step.expectedOutput || READ_ONLY_TOOLS.has(normalizeToolName(step.toolName))) {
    validations.push({
      id: `validation-${step.index}-output`,
      name: "Output produced",
      type: "output_present",
      required: true,
    });
  }

  for (const artifact of expectedArtifacts) {
    validations.push({
      id: `validation-${step.index}-artifact-${artifact.type}`,
      name: `Artifact generated (${artifact.type})`,
      type: "artifact_present",
      required: artifact.required,
      artifactType: artifact.type,
      artifactName: artifact.name,
    });
  }

  return validations;
}

function buildExpectedArtifacts(step: PlannerPlanStep): ExpectedArtifact[] {
  const toolName = normalizeToolName(step.toolName);
  const descriptor = ARTIFACT_TOOLS[toolName];
  if (!descriptor) return [];
  return [
    {
      name: `${descriptor.namePrefix}-${step.index + 1}`,
      type: descriptor.type,
      required: true,
    },
  ];
}

function isAggregationStep(step: PlannerPlanStep, index: number, totalSteps: number): boolean {
  if (index === totalSteps - 1) {
    const lowered = `${step.description || ""} ${step.toolName || ""}`.toLowerCase();
    if (
      lowered.includes("resumen") ||
      lowered.includes("summary") ||
      lowered.includes("synthesize") ||
      lowered.includes("respond")
    ) {
      return true;
    }
  }
  return false;
}

function inferDependencies(step: PlannerPlanStep, index: number, allSteps: PlannerPlanStep[]): string[] {
  if (index === 0) return [];

  const explicit = Array.isArray(step.input?.dependencies)
    ? step.input.dependencies
        .map((id: any) => String(id || "").trim())
        .filter(Boolean)
    : [];

  if (explicit.length > 0) {
    return explicit;
  }

  if (isAggregationStep(step, index, allSteps.length)) {
    return allSteps.slice(0, index).map((_, i) => `task-${i + 1}`);
  }

  const prev = allSteps[index - 1];
  const currentReadOnly = READ_ONLY_TOOLS.has(normalizeToolName(step.toolName));
  const prevReadOnly = READ_ONLY_TOOLS.has(normalizeToolName(prev.toolName));

  if (currentReadOnly && prevReadOnly) {
    return [];
  }

  return [`task-${index}`];
}

function buildGlobalValidations(tasks: RuntimeTaskNode[]): TaskValidationRule[] {
  const hasCodeWorkflow = tasks.some((task) =>
    ["generate_code", "write_file", "write_multiple_files", "shell_command", "shell_exec", "scaffold_project"].includes(task.toolName)
  );

  const rules: TaskValidationRule[] = [
    {
      id: "global-delivery-pack",
      name: "Delivery pack assembled",
      type: "output_present",
      required: true,
    },
  ];

  if (!hasCodeWorkflow) {
    return rules;
  }

  rules.push(
    {
      id: "global-lint",
      name: "Lint check",
      type: "command_exit_zero",
      command: "npm run lint --if-present",
      required: true,
    },
    {
      id: "global-test",
      name: "Test suite",
      type: "command_exit_zero",
      command: "npm run test --if-present",
      required: true,
    },
    {
      id: "global-smoke",
      name: "Smoke build",
      type: "command_exit_zero",
      command: "npm run build --if-present",
      required: true,
    }
  );

  return rules;
}

export class TaskGraphPlanner {
  build(input: PlannerInput): RuntimeTaskGraph {
    const normalizedSteps = (input.steps || []).map((step, idx) => ({
      index: typeof step.index === "number" ? step.index : idx,
      toolName: normalizeToolName(step.toolName),
      description: step.description || `Task ${idx + 1}`,
      input: step.input || {},
      expectedOutput: step.expectedOutput,
    }));

    const tasks: RuntimeTaskNode[] = normalizedSteps.map((step, idx, all) => {
      const expectedArtifacts = buildExpectedArtifacts(step);
      const validations = buildTaskValidations(step, expectedArtifacts);
      const dependencies = inferDependencies(step, idx, all);
      const successCriteria = [
        step.expectedOutput || "Tool finishes without execution errors",
      ];
      const definitionOfDone = [
        ...successCriteria,
        "Validations pass",
        ...(expectedArtifacts.map((artifact) => `Artifact available: ${artifact.name} (${artifact.type})`)),
      ];

      return {
        id: `task-${idx + 1}`,
        index: idx,
        title: step.description || `Task ${idx + 1}`,
        description: step.description || `Task ${idx + 1}`,
        toolName: step.toolName,
        input: step.input || {},
        dependencies,
        successCriteria,
        definitionOfDone,
        validations,
        expectedArtifacts,
        retryPolicy: {
          maxAttempts: 2,
          backoffMs: 1200,
        },
        metadata: {
          sourceIndex: step.index,
        },
      };
    });

    return {
      graphId: randomUUID(),
      objective: input.objective || input.userMessage,
      createdAt: Date.now(),
      maxConcurrency: Math.min(4, Math.max(1, tasks.length > 1 ? 2 : 1)),
      tasks,
      globalValidations: buildGlobalValidations(tasks),
    };
  }
}
