import { z } from "zod";
import crypto from "crypto";
import { toolRegistry, ToolExecutionResult, ToolCategory, TOOL_CATEGORIES, StrictE2EResult } from "./toolRegistry";
import { agentRegistry, AgentTask, AgentResult, AgentRole, AGENT_ROLES } from "./agentRegistry";
import { executeRealHandler, hasRealHandler } from "./realToolHandlers";

export interface StrictE2EEvidence {
  stepId: string;
  toolName: string;
  input: unknown;
  output: unknown;
  schemaValidation: "pass" | "fail";
  requestId: string;
  durationMs: number;
  retryCount: number;
  replanEvents: string[];
  validationPassed: boolean;
  artifacts?: string[];
  status: "completed" | "failed" | "skipped";
  errorStack?: string;
}

export interface StrictE2EWorkflowResult {
  success: boolean;
  type: "workflow" | "agent" | "tool";
  intent: TaskIntent;
  evidence: StrictE2EEvidence[];
  summary: {
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    skippedSteps: number;
    totalDurationMs: number;
    replans: number;
    allValidationsPassed: boolean;
  };
  artifacts: string[];
  firstFailure?: {
    stepId: string;
    toolName: string;
    errorStack: string;
  };
}

export const TaskIntentSchema = z.object({
  query: z.string(),
  intent: z.enum([
    "research",
    "code",
    "data_analysis",
    "content_creation",
    "communication",
    "browsing",
    "document",
    "testing",
    "security",
    "orchestration",
    "computer_use",
  ]),
  confidence: z.number().min(0).max(1),
  suggestedAgent: z.string(),
  suggestedTools: z.array(z.string()),
  complexity: z.enum(["simple", "moderate", "complex"]),
});

export type TaskIntent = z.infer<typeof TaskIntentSchema>;

export const WorkflowStepSchema = z.object({
  id: z.string(),
  type: z.enum(["tool", "agent", "decision", "parallel"]),
  name: z.string(),
  input: z.record(z.any()),
  dependsOn: z.array(z.string()).default([]),
  status: z.enum(["pending", "running", "completed", "failed", "skipped"]),
  result: z.any().optional(),
  error: z.string().optional(),
  duration: z.number().optional(),
});

export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const WorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  steps: z.array(WorkflowStepSchema),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  result: z.any().optional(),
  error: z.string().optional(),
});

export type Workflow = z.infer<typeof WorkflowSchema>;

const INTENT_PATTERNS: Record<TaskIntent["intent"], RegExp[]> = {
  research: [/search|find|look up|research|investigate|discover|learn about/i],
  code: [/code|program|function|class|implement|debug|fix bug|refactor|script/i],
  data_analysis: [/analyze|statistics|chart|graph|data|metrics|trends|csv|excel|spreadsheet/i],
  content_creation: [/write|create|generate|compose|draft|article|blog|story/i],
  communication: [/email|message|notify|send|communicate|respond|reply/i],
  browsing: [/browse|navigate|visit|open|scrape|extract from page/i],
  document: [/document|pdf|word|powerpoint|presentation|report|docx|pptx/i],
  testing: [/test|verify|validate|check|qa|quality|assert/i],
  security: [/security|vulnerability|scan|audit|encrypt|hash|password/i],
  orchestration: [/workflow|pipeline|automate|schedule|coordinate|manage/i],
  computer_use: [/computer use|control del (computador|ordenador)|browser control|agentic|terminal control|screen interact|screenshot|agentic brows|navega.*autónom|autonomous.*brows|control.*pantalla|screen.*control/i],
};

const INTENT_TO_AGENT: Record<TaskIntent["intent"], AgentRole> = {
  research: "Research",
  code: "Code",
  data_analysis: "Data",
  content_creation: "Content",
  communication: "Communication",
  browsing: "Browser",
  document: "Document",
  testing: "QA",
  security: "Security",
  orchestration: "Orchestrator",
  computer_use: "ComputerUse",
};

const INTENT_TO_TOOLS: Record<TaskIntent["intent"], string[]> = {
  research: ["web_search", "browse_url", "extract_content", "summarize"],
  code: ["code_generate", "code_analyze", "shell_execute", "file_write"],
  data_analysis: ["data_transform", "data_visualize", "spreadsheet_analyze", "statistics_compute"],
  content_creation: ["text_generate", "image_generate", "content_format", "translate"],
  communication: ["email_send", "message_compose", "notify", "respond"],
  browsing: ["browse_url", "screenshot", "form_fill", "extract_content"],
  document: ["document_create", "pdf_generate", "slides_create", "template_fill"],
  testing: ["test_run", "validate_output", "assert_condition", "report_generate"],
  security: ["security_scan", "encrypt", "hash", "audit_log"],
  orchestration: ["workflow_create", "task_schedule", "agent_delegate", "monitor"],
  computer_use: ["computer_use_session", "computer_use_navigate", "computer_use_interact", "computer_use_agentic", "terminal_execute", "generate_perfect_ppt", "generate_perfect_doc", "generate_perfect_excel", "vision_analyze"],
};

class Orchestrator {
  private activeWorkflows: Map<string, Workflow> = new Map();
  private workflowHistory: Workflow[] = [];
  private maxHistory = 100;

  analyzeIntent(query: string): TaskIntent {
    let bestIntent: TaskIntent["intent"] = "orchestration";
    let bestScore = 0;

    for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(query)) {
          const score = query.match(pattern)?.[0]?.length || 0;
          if (score > bestScore) {
            bestScore = score;
            bestIntent = intent as TaskIntent["intent"];
          }
        }
      }
    }

    const complexity = this.estimateComplexity(query);
    const suggestedAgent = INTENT_TO_AGENT[bestIntent];
    const suggestedTools = INTENT_TO_TOOLS[bestIntent];

    return {
      query,
      intent: bestIntent,
      confidence: bestScore > 0 ? Math.min(bestScore / 10, 1) : 0.5,
      suggestedAgent,
      suggestedTools,
      complexity,
    };
  }

  private estimateComplexity(query: string): TaskIntent["complexity"] {
    const wordCount = query.split(/\s+/).length;
    const hasMultipleTasks = /and|then|after|also|additionally/i.test(query);
    
    if (wordCount > 50 || hasMultipleTasks) return "complex";
    if (wordCount > 20) return "moderate";
    return "simple";
  }

  selectAgent(intent: TaskIntent): string {
    const agentRole = INTENT_TO_AGENT[intent.intent];
    const agent = agentRegistry.getByRole(agentRole);
    
    if (agent) {
      return agent.config.name;
    }

    const orchestrator = agentRegistry.getByRole("Orchestrator");
    return orchestrator?.config.name || "OrchestratorAgent";
  }

  selectTools(intent: TaskIntent): string[] {
    const suggestedTools = INTENT_TO_TOOLS[intent.intent];
    return suggestedTools.filter(toolName => toolRegistry.has(toolName));
  }

  async route(query: string): Promise<{
    intent: TaskIntent;
    agentName: string;
    tools: string[];
    workflow?: Workflow;
  }> {
    const intent = this.analyzeIntent(query);
    const agentName = this.selectAgent(intent);
    const tools = this.selectTools(intent);

    if (intent.complexity === "complex") {
      const workflow = await this.createWorkflow(query, intent);
      return { intent, agentName, tools, workflow };
    }

    return { intent, agentName, tools };
  }

  async createWorkflow(query: string, intent: TaskIntent): Promise<Workflow> {
    const workflowId = crypto.randomUUID();
    const steps: WorkflowStep[] = [];

    const tools = this.selectTools(intent);
    for (let i = 0; i < tools.length; i++) {
      steps.push({
        id: `step_${i + 1}`,
        type: "tool",
        name: tools[i],
        input: { query },
        dependsOn: i > 0 ? [`step_${i}`] : [],
        status: "pending",
      });
    }

    const workflow: Workflow = {
      id: workflowId,
      name: `Workflow for: ${query.slice(0, 50)}...`,
      description: `Auto-generated workflow for ${intent.intent} task`,
      steps,
      status: "pending",
    };

    this.activeWorkflows.set(workflowId, workflow);
    return workflow;
  }

  async executeWorkflow(workflowId: string): Promise<Workflow> {
    const workflow = this.activeWorkflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    workflow.status = "running";
    workflow.startedAt = Date.now();

    const stepResults: Map<string, any> = new Map();

    for (const step of workflow.steps) {
      const canExecute = step.dependsOn.every(depId => {
        const depStep = workflow.steps.find(s => s.id === depId);
        return depStep?.status === "completed";
      });

      if (!canExecute) {
        step.status = "skipped";
        continue;
      }

      step.status = "running";
      const startTime = Date.now();

      try {
        if (step.type === "tool") {
          const result = await toolRegistry.execute(step.name, step.input);
          step.result = result;
          step.status = result.success ? "completed" : "failed";
          step.error = result.error?.message;
          stepResults.set(step.id, result.data);
        } else if (step.type === "agent") {
          const task: AgentTask = {
            id: step.id,
            type: step.name,
            description: step.input.description || "",
            input: step.input,
          };
          const result = await agentRegistry.execute(step.name, task);
          step.result = result;
          step.status = result.success ? "completed" : "failed";
          step.error = result.error;
          stepResults.set(step.id, result.output);
        }
      } catch (err: any) {
        step.status = "failed";
        step.error = err.message;
      }

      step.duration = Date.now() - startTime;

      if (step.status === "failed" && !this.canReplan(workflow, step)) {
        workflow.status = "failed";
        workflow.error = `Step ${step.id} (${step.name}) failed: ${step.error}`;
        break;
      }
    }

    if (workflow.status !== "failed") {
      workflow.status = "completed";
      workflow.result = Object.fromEntries(stepResults);
    }

    workflow.completedAt = Date.now();
    this.activeWorkflows.delete(workflowId);
    this.addToHistory(workflow);

    return workflow;
  }

  private canReplan(workflow: Workflow, failedStep: WorkflowStep): boolean {
    const alternatives = this.findAlternativeTools(failedStep.name);
    if (alternatives.length > 0) {
      failedStep.name = alternatives[0];
      failedStep.status = "pending";
      return true;
    }
    return false;
  }

  private findAlternativeTools(toolName: string): string[] {
    const tool = toolRegistry.get(toolName);
    if (!tool) return [];

    const sameCategoryTools = toolRegistry.getByCategory(tool.metadata.category as any);
    return sameCategoryTools
      .filter(t => t.metadata.name !== toolName)
      .map(t => t.metadata.name);
  }

  async executeTask(query: string): Promise<{
    intent: TaskIntent;
    agentResult?: AgentResult;
    workflowResult?: Workflow;
    toolResults?: ToolExecutionResult[];
  }> {
    const { intent, agentName, tools, workflow } = await this.route(query);

    if (workflow) {
      const workflowResult = await this.executeWorkflow(workflow.id);
      return { intent, workflowResult };
    }

    if (intent.complexity === "simple" && tools.length === 1) {
      const toolResult = await toolRegistry.execute(tools[0], { query });
      return { intent, toolResults: [toolResult] };
    }

    const task: AgentTask = {
      id: crypto.randomUUID(),
      type: intent.intent,
      description: query,
      input: { query, tools },
    };

    const agentResult = await agentRegistry.execute(agentName, task);
    return { intent, agentResult };
  }

  private addToHistory(workflow: Workflow): void {
    this.workflowHistory.push(workflow);
    if (this.workflowHistory.length > this.maxHistory) {
      this.workflowHistory = this.workflowHistory.slice(-this.maxHistory / 2);
    }
  }

  getActiveWorkflows(): Workflow[] {
    return Array.from(this.activeWorkflows.values());
  }

  getWorkflowHistory(limit?: number): Workflow[] {
    return limit ? this.workflowHistory.slice(-limit) : this.workflowHistory;
  }

  getStats(): {
    activeWorkflows: number;
    completedWorkflows: number;
    failedWorkflows: number;
    avgWorkflowDuration: number;
  } {
    const completed = this.workflowHistory.filter(w => w.status === "completed").length;
    const failed = this.workflowHistory.filter(w => w.status === "failed").length;
    
    const durations = this.workflowHistory
      .filter(w => w.startedAt && w.completedAt)
      .map(w => w.completedAt! - w.startedAt!);
    
    const avgDuration = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    return {
      activeWorkflows: this.activeWorkflows.size,
      completedWorkflows: completed,
      failedWorkflows: failed,
      avgWorkflowDuration: avgDuration,
    };
  }

  async executeStrictE2E(query: string, strictE2E: boolean = true): Promise<StrictE2EWorkflowResult> {
    const startTime = Date.now();
    const intent = this.analyzeIntent(query);
    const tools = this.selectTools(intent);
    const evidence: StrictE2EEvidence[] = [];
    const allArtifacts: string[] = [];
    let replans = 0;
    let firstFailure: StrictE2EWorkflowResult["firstFailure"];

    const toolInputMap: Record<string, unknown> = {
      web_search: { query, maxResults: 5 },
      browse_url: { url: query.match(/https?:\/\/[^\s]+/)?.[0] || "https://example.com" },
      document_create: { title: query.slice(0, 50), content: query, type: "txt" },
      pdf_generate: { title: query.slice(0, 50), content: query },
      data_analyze: { data: [1, 2, 3, 4, 5], operation: "statistics" },
      hash: { data: query, algorithm: "sha256" },
    };

    for (let i = 0; i < tools.length; i++) {
      const toolName = tools[i];
      const stepId = `step_${i + 1}`;
      const stepStart = Date.now();
      const requestId = crypto.randomUUID();
      const replanEvents: string[] = [];

      const input = toolInputMap[toolName] || { query };

      const stepEvidence: StrictE2EEvidence = {
        stepId,
        toolName,
        input,
        output: null,
        schemaValidation: "fail",
        requestId,
        durationMs: 0,
        retryCount: 0,
        replanEvents,
        validationPassed: false,
        status: "failed",
      };

      try {
        if (strictE2E && hasRealHandler(toolName)) {
          const realResult = await executeRealHandler(toolName, input);
          if (realResult) {
            stepEvidence.output = realResult.data;
            stepEvidence.artifacts = realResult.artifacts;
            stepEvidence.validationPassed = realResult.validationPassed;
            stepEvidence.schemaValidation = realResult.success ? "pass" : "fail";
            stepEvidence.status = realResult.validationPassed ? "completed" : "failed";
            
            if (realResult.artifacts) {
              allArtifacts.push(...realResult.artifacts);
            }

            if (!realResult.validationPassed && !firstFailure) {
              firstFailure = {
                stepId,
                toolName,
                errorStack: `Real execution failed: ${realResult.message}`,
              };

              const alternatives = this.findAlternativeTools(toolName);
              if (alternatives.length > 0) {
                replanEvents.push(`Replanning from ${toolName} to ${alternatives[0]}`);
                replans++;
              }
            }
          }
        } else {
          const result = await toolRegistry.executeStrictE2E(toolName, input);
          stepEvidence.output = result.output;
          stepEvidence.artifacts = result.artifacts;
          stepEvidence.validationPassed = result.validationPassed;
          stepEvidence.schemaValidation = result.schemaValidation;
          stepEvidence.retryCount = result.retryCount;
          stepEvidence.status = result.validationPassed ? "completed" : "failed";
          
          if (result.artifacts) {
            allArtifacts.push(...result.artifacts);
          }

          if (!result.validationPassed && !firstFailure) {
            firstFailure = {
              stepId,
              toolName,
              errorStack: result.errorStack || "Validation failed",
            };
          }
        }
      } catch (err: any) {
        stepEvidence.status = "failed";
        stepEvidence.errorStack = err.stack || err.message;
        if (!firstFailure) {
          firstFailure = {
            stepId,
            toolName,
            errorStack: err.stack || err.message,
          };
        }
      }

      stepEvidence.durationMs = Date.now() - stepStart;
      stepEvidence.replanEvents = replanEvents;
      evidence.push(stepEvidence);
    }

    const completedSteps = evidence.filter(e => e.status === "completed").length;
    const failedSteps = evidence.filter(e => e.status === "failed").length;
    const skippedSteps = evidence.filter(e => e.status === "skipped").length;
    const allValidationsPassed = evidence.every(e => e.validationPassed);

    return {
      success: allValidationsPassed && failedSteps === 0,
      type: tools.length > 1 ? "workflow" : "tool",
      intent,
      evidence,
      summary: {
        totalSteps: evidence.length,
        completedSteps,
        failedSteps,
        skippedSteps,
        totalDurationMs: Date.now() - startTime,
        replans,
        allValidationsPassed,
      },
      artifacts: allArtifacts,
      firstFailure,
    };
  }
}

export const orchestrator = new Orchestrator();
export { Orchestrator };
