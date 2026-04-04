/**
 * WorkflowEngine — define and execute multi-step automated workflows.
 * Step types: llm_call, tool_execute, condition, loop, parallel, human_approval, wait, transform.
 * Supports BullMQ scheduling, event emission, and safe expression evaluation (no eval/Function).
 */

import { EventEmitter } from "events";
import Anthropic from "@anthropic-ai/sdk";
import { createLogger } from "../utils/logger";
import { AppError } from "../utils/errors";

const logger = createLogger("WorkflowEngine");

// ─── Types ────────────────────────────────────────────────────────────────────

export type StepType =
  | "llm_call"
  | "tool_execute"
  | "condition"
  | "loop"
  | "parallel"
  | "human_approval"
  | "wait"
  | "transform";

export type TriggerType = "manual" | "scheduled" | "webhook" | "event";

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "waiting_approval";

export interface ConditionExpr {
  op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte" | "contains" | "startsWith" | "endsWith" | "exists" | "and" | "or" | "not";
  left?: string | number | boolean | ConditionExpr;
  right?: string | number | boolean | ConditionExpr;
  conditions?: ConditionExpr[]; // for "and"/"or"
  condition?: ConditionExpr;    // for "not"
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: StepType;
  config: Record<string, unknown>;
  condition?: ConditionExpr;    // skip step if evaluates to false
  onSuccess?: string;           // next step id (defaults to sequential)
  onFailure?: string;           // step id on error
  retries?: number;
  timeout?: number;             // ms
  outputKey?: string;           // store result in context variables under this key
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  version: string;
  trigger: TriggerType;
  steps: WorkflowStep[];
  variables?: Record<string, unknown>;
  schedule?: string; // cron expression
  tags?: string[];
}

export interface ExecutionContext {
  runId: string;
  workflowId: string;
  variables: Record<string, unknown>;
  outputs: Record<string, unknown>;  // stepId -> output
  startedAt: Date;
  userId?: string;
}

export interface StepResult {
  stepId: string;
  status: StepStatus;
  output?: unknown;
  error?: string;
  durationMs: number;
  retryCount: number;
}

export interface WorkflowRun {
  runId: string;
  workflowId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  stepResults: StepResult[];
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  outputs: Record<string, unknown>;
}

export interface WorkflowEvent {
  type: "step_started" | "step_completed" | "step_failed" | "workflow_completed" | "workflow_failed" | "approval_required";
  runId: string;
  workflowId: string;
  stepId?: string;
  data?: unknown;
  timestamp: Date;
}

// ─── Safe Expression Evaluator ────────────────────────────────────────────────

/**
 * Resolve a value — if it looks like "${varName.path}", extract from context.
 * Supports dot-notation paths: "${output.results.0.title}"
 */
function resolveValue(
  val: string | number | boolean | ConditionExpr | undefined,
  ctx: ExecutionContext
): unknown {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "number" || typeof val === "boolean") return val;
  if (typeof val === "object") return val; // nested ConditionExpr, handled by evaluateCondition

  // Template variable: ${varName} or ${outputs.stepId.field}
  const varMatch = String(val).match(/^\$\{([^}]+)\}$/);
  if (varMatch) {
    const path = varMatch[1]!.split(".");
    let current: unknown = { ...ctx.variables, outputs: ctx.outputs };
    for (const key of path) {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    return current;
  }

  return val;
}

/**
 * Safe recursive condition evaluator — supports comparison and logical operators.
 * No eval(), no new Function() — purely structural traversal.
 */
export function evaluateCondition(expr: ConditionExpr, ctx: ExecutionContext): boolean {
  switch (expr.op) {
    case "and":
      return (expr.conditions ?? []).every((c) => evaluateCondition(c, ctx));

    case "or":
      return (expr.conditions ?? []).some((c) => evaluateCondition(c, ctx));

    case "not":
      return expr.condition ? !evaluateCondition(expr.condition, ctx) : false;

    case "exists":
      return resolveValue(expr.left, ctx) !== undefined && resolveValue(expr.left, ctx) !== null;

    default: {
      const left = resolveValue(expr.left, ctx);
      const right = resolveValue(expr.right, ctx);

      switch (expr.op) {
        case "eq": return left == right;
        case "ne": return left != right;
        case "gt": return Number(left) > Number(right);
        case "lt": return Number(left) < Number(right);
        case "gte": return Number(left) >= Number(right);
        case "lte": return Number(left) <= Number(right);
        case "contains": return String(left).includes(String(right));
        case "startsWith": return String(left).startsWith(String(right));
        case "endsWith": return String(left).endsWith(String(right));
        default: return false;
      }
    }
  }
}

// ─── Template Resolver ────────────────────────────────────────────────────────

/**
 * Replace ${varName} patterns in a string with values from context.
 */
function resolveTemplate(template: string, ctx: ExecutionContext): string {
  return template.replace(/\$\{([^}]+)\}/g, (_, path) => {
    const keys = path.split(".");
    let current: unknown = { ...ctx.variables, outputs: ctx.outputs };
    for (const key of keys) {
      if (current == null || typeof current !== "object") return "";
      current = (current as Record<string, unknown>)[key];
    }
    return current != null ? String(current) : "";
  });
}

function resolveConfigTemplates(config: Record<string, unknown>, ctx: ExecutionContext): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(config)) {
    if (typeof val === "string") {
      resolved[key] = resolveTemplate(val, ctx);
    } else if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      resolved[key] = resolveConfigTemplates(val as Record<string, unknown>, ctx);
    } else {
      resolved[key] = val;
    }
  }
  return resolved;
}

// ─── Step Executors ───────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function executeLLMCall(config: Record<string, unknown>, ctx: ExecutionContext): Promise<unknown> {
  const model = String(config["model"] ?? "claude-haiku-4-5-20251001");
  const prompt = String(config["prompt"] ?? "");
  const systemPrompt = config["system"] ? String(config["system"]) : undefined;
  const maxTokens = Number(config["maxTokens"] ?? 1024);
  const jsonOutput = Boolean(config["jsonOutput"]);

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];

  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";

  if (jsonOutput) {
    const jsonMatch = text.match(/```json\s*([\s\S]+?)```/) ?? text.match(/(\{[\s\S]+\}|\[[\s\S]+\])/);
    try {
      return JSON.parse(jsonMatch ? jsonMatch[1]! : text);
    } catch {
      return { text };
    }
  }

  return { text, model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
}

async function executeToolCall(config: Record<string, unknown>, ctx: ExecutionContext): Promise<unknown> {
  const toolName = String(config["tool"] ?? "");
  const toolArgs = (config["args"] as Record<string, unknown>) ?? {};

  switch (toolName) {
    case "search": {
      const { multiSearchProvider } = await import("../search/MultiSearchProvider");
      return multiSearchProvider.searchMultiProvider({ query: String(toolArgs["query"] ?? ""), maxResults: Number(toolArgs["maxResults"] ?? 10) });
    }
    case "memory_search": {
      const { pgVectorMemoryStore } = await import("../memory/PgVectorMemoryStore");
      return pgVectorMemoryStore.search({ query: String(toolArgs["query"] ?? ""), limit: Number(toolArgs["limit"] ?? 5) });
    }
    case "http": {
      const url = String(toolArgs["url"] ?? "");
      const method = String(toolArgs["method"] ?? "GET").toUpperCase();
      const headers = (toolArgs["headers"] as Record<string, string>) ?? {};
      const body = toolArgs["body"];

      const resp = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });

      const contentType = resp.headers.get("content-type") ?? "";
      const responseData = contentType.includes("application/json")
        ? await resp.json()
        : await resp.text();

      return { status: resp.status, ok: resp.ok, data: responseData };
    }
    case "document_analyze": {
      const { documentIntelligencePipeline } = await import("../multimodal/DocumentIntelligencePipeline");
      return documentIntelligencePipeline.analyzeFile(String(toolArgs["filePath"] ?? ""), {
        generateSummary: Boolean(toolArgs["generateSummary"]),
      });
    }
    default:
      throw new AppError(`Unknown tool: ${toolName}`, 400, "UNKNOWN_TOOL");
  }
}

function executeTransform(config: Record<string, unknown>, ctx: ExecutionContext): unknown {
  const transformType = String(config["type"] ?? "extract");
  const input = resolveValue(String(config["input"] ?? ""), ctx);

  switch (transformType) {
    case "extract": {
      const field = String(config["field"] ?? "");
      if (typeof input === "object" && input !== null) {
        return field.split(".").reduce<unknown>((obj, key) => {
          if (obj == null || typeof obj !== "object") return undefined;
          return (obj as Record<string, unknown>)[key];
        }, input);
      }
      return input;
    }
    case "join": {
      const arr = Array.isArray(input) ? input : [input];
      return arr.join(String(config["separator"] ?? "\n"));
    }
    case "slice": {
      const arr = Array.isArray(input) ? input : String(input).split("\n");
      return arr.slice(Number(config["start"] ?? 0), Number(config["end"] ?? arr.length));
    }
    case "keys": {
      return typeof input === "object" && input !== null ? Object.keys(input) : [];
    }
    case "length": {
      if (Array.isArray(input)) return input.length;
      if (typeof input === "string") return input.length;
      if (typeof input === "object" && input !== null) return Object.keys(input).length;
      return 0;
    }
    case "merge": {
      const extra = (config["with"] as Record<string, unknown>) ?? {};
      if (typeof input === "object" && input !== null) return { ...(input as object), ...extra };
      return extra;
    }
    default:
      return input;
  }
}

// ─── WorkflowEngine ───────────────────────────────────────────────────────────

export class WorkflowEngine extends EventEmitter {
  private workflows = new Map<string, WorkflowDefinition>();
  private activeRuns = new Map<string, WorkflowRun>();
  private pendingApprovals = new Map<string, { resolve: (approved: boolean) => void; step: WorkflowStep }>();

  register(workflow: WorkflowDefinition): void {
    this.workflows.set(workflow.id, workflow);
    logger.info(`Workflow registered: ${workflow.id} (${workflow.name})`);
  }

  getWorkflow(id: string): WorkflowDefinition | undefined {
    return this.workflows.get(id);
  }

  listWorkflows(): WorkflowDefinition[] {
    return [...this.workflows.values()];
  }

  async execute(
    workflowId: string,
    initialVariables: Record<string, unknown> = {},
    userId?: string
  ): Promise<WorkflowRun> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new AppError(`Workflow not found: ${workflowId}`, 404, "WORKFLOW_NOT_FOUND");

    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const ctx: ExecutionContext = {
      runId,
      workflowId,
      variables: { ...(workflow.variables ?? {}), ...initialVariables },
      outputs: {},
      startedAt: new Date(),
      userId,
    };

    const run: WorkflowRun = {
      runId,
      workflowId,
      status: "running",
      stepResults: [],
      startedAt: ctx.startedAt,
      outputs: {},
    };

    this.activeRuns.set(runId, run);
    this.emit("event", { type: "step_started", runId, workflowId, timestamp: new Date() } satisfies WorkflowEvent);

    logger.info(`Workflow execution started: ${workflowId} (run: ${runId})`);

    try {
      await this.executeSteps(workflow.steps, ctx, run);

      run.status = "completed";
      run.completedAt = new Date();
      run.outputs = ctx.outputs;

      this.emit("event", {
        type: "workflow_completed",
        runId,
        workflowId,
        data: { outputs: ctx.outputs },
        timestamp: new Date(),
      } satisfies WorkflowEvent);

      logger.info(`Workflow completed: ${workflowId} (run: ${runId}) in ${Date.now() - ctx.startedAt.getTime()}ms`);
    } catch (err) {
      run.status = "failed";
      run.completedAt = new Date();
      run.error = (err as Error).message;

      this.emit("event", {
        type: "workflow_failed",
        runId,
        workflowId,
        data: { error: run.error },
        timestamp: new Date(),
      } satisfies WorkflowEvent);

      logger.error(`Workflow failed: ${workflowId} (run: ${runId})`, err);
    } finally {
      this.activeRuns.delete(runId);
    }

    return run;
  }

  private async executeSteps(
    steps: WorkflowStep[],
    ctx: ExecutionContext,
    run: WorkflowRun
  ): Promise<void> {
    const stepMap = new Map(steps.map((s) => [s.id, s]));
    let currentStepId: string | undefined = steps[0]?.id;

    while (currentStepId) {
      const step = stepMap.get(currentStepId);
      if (!step) break;

      const result = await this.executeStep(step, ctx, run);

      if (result.status === "failed" && step.onFailure) {
        currentStepId = step.onFailure;
      } else if (result.status === "completed" && step.onSuccess) {
        currentStepId = step.onSuccess;
      } else {
        // Move to next sequential step
        const idx = steps.findIndex((s) => s.id === currentStepId);
        currentStepId = steps[idx + 1]?.id;
      }
    }
  }

  private async executeStep(
    step: WorkflowStep,
    ctx: ExecutionContext,
    run: WorkflowRun
  ): Promise<StepResult> {
    const startTime = Date.now();
    let retryCount = 0;
    const maxRetries = step.retries ?? 0;

    // Evaluate skip condition
    if (step.condition && !evaluateCondition(step.condition, ctx)) {
      const result: StepResult = { stepId: step.id, status: "skipped", durationMs: 0, retryCount: 0 };
      run.stepResults.push(result);
      logger.info(`Step skipped (condition): ${step.id}`);
      return result;
    }

    this.emit("event", {
      type: "step_started",
      runId: ctx.runId,
      workflowId: ctx.workflowId,
      stepId: step.id,
      timestamp: new Date(),
    } satisfies WorkflowEvent);

    while (retryCount <= maxRetries) {
      try {
        const resolvedConfig = resolveConfigTemplates(step.config, ctx);
        const output = await this.dispatchStep(step.type, resolvedConfig, ctx, run);

        if (step.outputKey) {
          ctx.outputs[step.outputKey] = output;
          ctx.variables[step.outputKey] = output;
        } else {
          ctx.outputs[step.id] = output;
        }

        const result: StepResult = {
          stepId: step.id,
          status: "completed",
          output,
          durationMs: Date.now() - startTime,
          retryCount,
        };

        run.stepResults.push(result);
        this.emit("event", {
          type: "step_completed",
          runId: ctx.runId,
          workflowId: ctx.workflowId,
          stepId: step.id,
          data: { output },
          timestamp: new Date(),
        } satisfies WorkflowEvent);

        logger.info(`Step completed: ${step.id} in ${result.durationMs}ms`);
        return result;
      } catch (err) {
        retryCount++;
        if (retryCount > maxRetries) {
          const result: StepResult = {
            stepId: step.id,
            status: "failed",
            error: (err as Error).message,
            durationMs: Date.now() - startTime,
            retryCount,
          };

          run.stepResults.push(result);
          this.emit("event", {
            type: "step_failed",
            runId: ctx.runId,
            workflowId: ctx.workflowId,
            stepId: step.id,
            data: { error: result.error },
            timestamp: new Date(),
          } satisfies WorkflowEvent);

          logger.warn(`Step failed: ${step.id} — ${(err as Error).message}`);
          return result;
        }

        logger.warn(`Step ${step.id} retry ${retryCount}/${maxRetries}: ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 500 * retryCount));
      }
    }

    // Unreachable but TypeScript needs it
    return { stepId: step.id, status: "failed", durationMs: Date.now() - startTime, retryCount };
  }

  private async dispatchStep(
    type: StepType,
    config: Record<string, unknown>,
    ctx: ExecutionContext,
    run: WorkflowRun
  ): Promise<unknown> {
    switch (type) {
      case "llm_call":
        return executeLLMCall(config, ctx);

      case "tool_execute":
        return executeToolCall(config, ctx);

      case "transform":
        return executeTransform(config, ctx);

      case "wait": {
        const ms = Number(config["duration"] ?? 1_000);
        await new Promise((r) => setTimeout(r, ms));
        return { waited: ms };
      }

      case "condition": {
        // Condition step: evaluate and store boolean result
        const condExpr = config["expression"] as ConditionExpr | undefined;
        if (!condExpr) return { result: false };
        const result = evaluateCondition(condExpr, ctx);
        return { result };
      }

      case "parallel": {
        const parallelSteps = (config["steps"] as WorkflowStep[]) ?? [];
        const results = await Promise.allSettled(
          parallelSteps.map((s) => this.executeStep(s, ctx, run))
        );
        return results.map((r) => (r.status === "fulfilled" ? r.value : { error: r.reason }));
      }

      case "loop": {
        const itemsKey = String(config["items"] ?? "");
        const loopSteps = (config["steps"] as WorkflowStep[]) ?? [];
        const items = resolveValue(itemsKey.startsWith("${") ? itemsKey : `\${${itemsKey}}`, ctx);
        const arr = Array.isArray(items) ? items : [];
        const loopResults: unknown[] = [];

        for (let i = 0; i < arr.length; i++) {
          const loopCtx: ExecutionContext = {
            ...ctx,
            variables: { ...ctx.variables, loopItem: arr[i], loopIndex: i },
          };
          for (const loopStep of loopSteps) {
            const result = await this.executeStep(loopStep, loopCtx, run);
            ctx.outputs[loopStep.id] = result.output;
          }
          loopResults.push(ctx.outputs);
        }

        return { iterations: arr.length, results: loopResults };
      }

      case "human_approval": {
        const message = String(config["message"] ?? "Approval required to continue");
        const timeoutMs = Number(config["timeout"] ?? 3_600_000); // 1 hour default

        return new Promise<unknown>((resolve, reject) => {
          const approvalId = `${ctx.runId}_${Date.now()}`;

          const timeout = setTimeout(() => {
            this.pendingApprovals.delete(approvalId);
            reject(new AppError("Human approval timed out", 408, "APPROVAL_TIMEOUT"));
          }, timeoutMs);

          this.pendingApprovals.set(approvalId, {
            resolve: (approved: boolean) => {
              clearTimeout(timeout);
              this.pendingApprovals.delete(approvalId);
              if (approved) {
                resolve({ approved: true, approvalId });
              } else {
                reject(new AppError("Action rejected by approver", 403, "APPROVAL_REJECTED"));
              }
            },
            step: { id: approvalId, name: "approval", type: "human_approval", config },
          });

          this.emit("event", {
            type: "approval_required",
            runId: ctx.runId,
            workflowId: ctx.workflowId,
            data: { approvalId, message },
            timestamp: new Date(),
          } satisfies WorkflowEvent);

          logger.info(`Human approval required: ${approvalId} — "${message}"`);
        });
      }

      default:
        throw new AppError(`Unknown step type: ${type}`, 400, "UNKNOWN_STEP_TYPE");
    }
  }

  /**
   * Approve or reject a pending human_approval step.
   */
  approveStep(approvalId: string, approved: boolean): boolean {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) return false;
    pending.resolve(approved);
    return true;
  }

  getActiveRuns(): WorkflowRun[] {
    return [...this.activeRuns.values()];
  }

  getRun(runId: string): WorkflowRun | undefined {
    return this.activeRuns.get(runId);
  }

  getPendingApprovals(): Array<{ approvalId: string; step: WorkflowStep }> {
    return [...this.pendingApprovals.entries()].map(([approvalId, { step }]) => ({ approvalId, step }));
  }

  /**
   * Schedule a workflow via BullMQ (if available).
   */
  async scheduleWorkflow(
    workflowId: string,
    cronExpression: string,
    variables: Record<string, unknown> = {}
  ): Promise<string | null> {
    try {
      const { Queue } = await import("bullmq");
      const queue = new Queue("workflow-scheduler", {
        connection: { host: process.env.REDIS_HOST ?? "localhost", port: parseInt(process.env.REDIS_PORT ?? "6379") },
      });

      await queue.add(
        `workflow:${workflowId}`,
        { workflowId, variables },
        { repeat: { pattern: cronExpression }, removeOnComplete: 100, removeOnFail: 50 }
      );

      await queue.close();
      logger.info(`Workflow scheduled: ${workflowId} (cron: ${cronExpression})`);
      return `scheduled:${workflowId}:${cronExpression}`;
    } catch (err) {
      logger.warn(`BullMQ scheduling unavailable: ${(err as Error).message}`);
      return null;
    }
  }
}

export const workflowEngine = new WorkflowEngine();
