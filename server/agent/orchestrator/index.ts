/**
 * Agentic Orchestrator — Central coordination layer.
 *
 * Wires together:
 *   - State Graph (PLAN → BROWSE → ACT → VERIFY → RETRY → ESCALATE → DONE)
 *   - Task Model (goal, constraints, definition_of_done, risk, budget)
 *   - Browser Tool API (structured browser actions, selector strategy, assertions)
 *   - Web Research Engine (search.query, web.fetch, web.extract with citations)
 *   - Document Engine (spec-driven PPT/DOCX/XLSX with validators)
 *   - Terminal Controller (RBAC, audit, command policies)
 *   - Desktop Controller (platform-abstracted UI automation)
 *
 * This is the main entry point that the existing AgentOrchestrator/AgentPipeline
 * can delegate to for enhanced agentic capabilities.
 */

export {
  // Task Model
  type TaskModel,
  type RiskLevel,
  type TaskPriority,
  type TaskStatus,
  type Budget,
  type TaskConstraints,
  type DefinitionOfDone,
  type Assertion,
  TaskModelSchema,
  BudgetSchema,
  TaskConstraintsSchema,
  DefinitionOfDoneSchema,
  AssertionSchema,
  RiskLevelSchema,
  createTaskModel,
  assessRisk,
} from "./taskModel";

export {
  // State Graph
  type AgenticState,
  type StateTransitionReason,
  type GraphContext,
  type PlanSpec,
  type PlanStepSpec,
  type StepResultEntry,
  type ArtifactEntry,
  type EvidenceEntry,
  type StateGraphEvent,
  AgenticStateGraph,
  createStateGraph,
} from "./agenticStateGraph";

// Re-export tools (lazy to avoid heavy imports at module load)
export { BrowserToolApi } from "../browser/browserToolApi";
export { SelectorResolver } from "../browser/selectorStrategy";
export { BrowserExpect } from "../browser/assertionDsl";
export { WebResearchEngine } from "../tools/webResearchTools";
export { DocumentEngine } from "../documents/documentEngine";
export {
  PresentationValidator,
  DocumentValidator,
  WorkbookValidator,
} from "../documents/documentValidators";
export {
  TerminalController,
  DesktopController,
  auditLogger,
  hasPermission,
  evaluateCommand,
  detectPlatform,
} from "../tools/terminalControl";

/* ------------------------------------------------------------------ */
/*  Convenience factory for a fully-wired orchestrator session        */
/* ------------------------------------------------------------------ */

import {
  AgenticStateGraph,
  createStateGraph,
  type PlanSpec,
  type StepResultEntry,
  type ArtifactEntry,
  type EvidenceEntry,
} from "./agenticStateGraph";
import { BrowserToolApi } from "../browser/browserToolApi";
import { WebResearchEngine } from "../tools/webResearchTools";
import { DocumentEngine } from "../documents/documentEngine";
import {
  PresentationValidator,
  DocumentValidator,
  WorkbookValidator,
} from "../documents/documentValidators";
import { TerminalController } from "../tools/terminalControl";
import { type DesignTokens } from "../documents/documentEngine";
import { randomUUID } from "crypto";

export interface OrchestratorSession {
  graph: AgenticStateGraph;
  browser: BrowserToolApi;
  research: WebResearchEngine;
  documents: DocumentEngine;
  terminal: TerminalController;
  validators: {
    pptx: PresentationValidator;
    docx: DocumentValidator;
    xlsx: WorkbookValidator;
  };
  /** Destroy all resources. */
  cleanup: () => Promise<void>;
}

/**
 * Create a fully-wired orchestrator session with all tools available.
 */
export function createOrchestratorSession(options: {
  goal: string;
  userId: string;
  chatId?: string;
  runId?: string;
  userPlan?: "free" | "pro" | "admin";
  tools?: string[];
  designTokens?: DesignTokens;
  attachments?: Array<{ name: string; type?: string; path?: string; url?: string }>;
  conversationHistory?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
}): OrchestratorSession {
  const graph = createStateGraph(options.goal, options.userId, {
    chatId: options.chatId,
    runId: options.runId,
    userPlan: options.userPlan,
    tools: options.tools,
    attachments: options.attachments,
    conversationHistory: options.conversationHistory,
  });

  const browser = new BrowserToolApi();
  const research = new WebResearchEngine();
  const documents = new DocumentEngine(options.designTokens);
  const terminal = new TerminalController();

  const validators = {
    pptx: new PresentationValidator(),
    docx: new DocumentValidator(),
    xlsx: new WorkbookValidator(),
  };

  return {
    graph,
    browser,
    research,
    documents,
    terminal,
    validators,
    cleanup: async () => {
      await browser.cleanup();
    },
  };
}

/* ------------------------------------------------------------------ */
/*  High-level execution helper                                       */
/* ------------------------------------------------------------------ */

export interface ExecutionResult {
  success: boolean;
  state: string;
  plan?: PlanSpec;
  steps: StepResultEntry[];
  artifacts: ArtifactEntry[];
  evidence: EvidenceEntry[];
  citations: any[];
  summary: string;
  metrics: Record<string, number>;
  error?: string;
}

/**
 * Execute a task through the full agentic pipeline.
 *
 * This is a simplified high-level runner. For production use, the
 * AgentOrchestrator or AgentPipeline should drive execution with
 * SSE streaming, persistence, and more sophisticated error handling.
 */
export async function executeAgenticTask(
  session: OrchestratorSession,
  plan: PlanSpec
): Promise<ExecutionResult> {
  const { graph, browser, research, documents, terminal, validators } = session;

  try {
    // PLAN phase
    graph.transition("PLAN", "task_received");
    graph.setPlan(plan);
    graph.transition("ACT", "plan_complete");

    // ACT phase — execute each step
    for (const step of plan.steps) {
      if (graph.isBudgetExceeded()) {
        graph.transition("FAILED", "budget_exceeded");
        break;
      }

      const start = Date.now();
      let success = false;
      let output: any = null;
      let error: string | undefined;
      const artifacts: ArtifactEntry[] = [];
      const evidence: EvidenceEntry[] = [];

      try {
        // Route to appropriate tool
        if (step.toolName.startsWith("browser.")) {
          const result = await browser.execute(step.input as any);
          success = result.success;
          output = result.data;
          error = result.error;
          if (result.screenshot) {
            evidence.push({
              type: "screenshot",
              data: result.screenshot,
              timestamp: Date.now(),
              stepIndex: step.index,
            });
          }
        } else if (step.toolName.startsWith("search.") || step.toolName.startsWith("web.")) {
          const result = await research.execute(step.input as any);
          success = result.success;
          output = result.data;
          error = result.error;
        } else if (step.toolName === "terminal.exec") {
          const result = await terminal.execute(step.input as any);
          success = result.success;
          output = result.stdout;
          error = result.error;
        } else if (step.toolName.startsWith("document.generate")) {
          // Document generation — route based on format
          const format = step.input?.format;
          if (format === "pptx") {
            const validation = validators.pptx.validateSpec(step.input as any);
            if (validation.valid) {
              const buffer = await documents.generatePresentation(step.input as any);
              success = true;
              output = { size: buffer.length, format: "pptx" };
              artifacts.push({
                id: randomUUID(),
                type: "document",
                name: `${step.input?.title || "presentation"}.pptx`,
                data: buffer.toString("base64"),
                createdAt: Date.now(),
              });
            } else {
              error = `Validation failed: ${validation.issues.map((i) => i.message).join("; ")}`;
            }
          } else if (format === "docx") {
            const validation = validators.docx.validateSpec(step.input as any);
            if (validation.valid) {
              const buffer = await documents.generateDocument(step.input as any);
              success = true;
              output = { size: buffer.length, format: "docx" };
              artifacts.push({
                id: randomUUID(),
                type: "document",
                name: `${step.input?.title || "document"}.docx`,
                data: buffer.toString("base64"),
                createdAt: Date.now(),
              });
            } else {
              error = `Validation failed: ${validation.issues.map((i) => i.message).join("; ")}`;
            }
          } else if (format === "xlsx") {
            const validation = validators.xlsx.validateSpec(step.input as any);
            if (validation.valid) {
              const buffer = await documents.generateWorkbook(step.input as any);
              success = true;
              output = { size: buffer.length, format: "xlsx" };
              artifacts.push({
                id: randomUUID(),
                type: "document",
                name: `${step.input?.title || "workbook"}.xlsx`,
                data: buffer.toString("base64"),
                createdAt: Date.now(),
              });
            } else {
              error = `Validation failed: ${validation.issues.map((i) => i.message).join("; ")}`;
            }
          }
        } else {
          // Unknown tool — skip
          error = `Unknown tool: ${step.toolName}`;
        }
      } catch (err: any) {
        error = err.message;
      }

      const stepResult: StepResultEntry = {
        stepIndex: step.index,
        toolName: step.toolName,
        success,
        output,
        error,
        durationMs: Date.now() - start,
        artifacts,
        evidence,
      };

      graph.recordStepResult(stepResult);

      if (!success) {
        // Check if we should escalate
        if (graph.shouldEscalate(step.toolName)) {
          graph.transition("ESCALATE", "escalation_needed");
          // In production, this would pause and wait for human input
          graph.transition("FAILED", "error", { reason: "Escalation required" });
          break;
        }

        // Retry?
        if (graph.consumeRetry()) {
          graph.transition("RETRY", "step_failed");
          graph.switchStrategy(graph.getContext().strategyMode === "dom" ? "visual" : "dom");
          graph.transition("ACT", "retry_requested");
          continue;
        }
      }
    }

    // VERIFY phase
    if (!graph.isTerminal()) {
      graph.transition("VERIFY", "all_steps_done");

      const ctx = graph.getContext();
      const successRate = ctx.task.metrics.stepsSucceeded / Math.max(ctx.task.metrics.stepsExecuted, 1);

      if (successRate >= ctx.task.definitionOfDone.minConfidence) {
        graph.transition("DONE", "verification_passed");
      } else {
        if (graph.consumeReplan()) {
          graph.transition("RETRY", "verification_failed");
          graph.transition("PLAN", "retry_requested");
          // In production, this would trigger replanning
        } else {
          graph.transition("DONE", "verification_passed", { partial: true });
        }
      }
    }

    const finalCtx = graph.getContext();

    return {
      success: graph.getState() === "DONE",
      state: graph.getState(),
      plan,
      steps: finalCtx.stepResults,
      artifacts: finalCtx.artifacts,
      evidence: finalCtx.evidence,
      citations: research.getCitations(),
      summary: `Executed ${finalCtx.task.metrics.stepsExecuted} steps, ${finalCtx.task.metrics.stepsSucceeded} succeeded, ${finalCtx.task.metrics.stepsFailed} failed. ${finalCtx.artifacts.length} artifacts produced.`,
      metrics: { ...finalCtx.task.metrics },
    };
  } catch (err: any) {
    const errCtx = graph.getContext();
    return {
      success: false,
      state: graph.getState(),
      steps: errCtx.stepResults,
      artifacts: errCtx.artifacts,
      evidence: errCtx.evidence,
      citations: research.getCitations(),
      summary: `Error: ${err.message}`,
      metrics: { ...errCtx.task.metrics },
      error: err.message,
    };
  }
}
