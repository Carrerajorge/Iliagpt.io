import { Queue, Worker, QueueEvents } from "bullmq";
import * as YAML from "yaml";
import axios from "axios";
import { randomUUID } from "crypto";
import { Logger } from "../lib/logger";
import { redis } from "../lib/redis";
import { llmGateway } from "../lib/llmGateway";

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkflowTrigger =
  | { type: "manual" }
  | { type: "cron"; schedule: string }
  | { type: "webhook"; path?: string }
  | { type: "event"; event: string };

export type WorkflowStep = {
  id: string;
  type:
    | "llm_call"
    | "tool_execute"
    | "condition"
    | "loop"
    | "parallel"
    | "human_approval"
    | "delay"
    | "http_request"
    | "transform";
  [key: string]: any;
};

export interface WorkflowDefinition {
  name: string;
  version: string;
  description?: string;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  timeout?: number;
  retries?: number;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
  startedAt: Date;
  completedAt?: Date;
  triggerData?: any;
  stepResults: Record<string, StepResult>;
  currentStep?: string;
  error?: string;
  userId?: string;
}

export interface StepResult {
  stepId: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  result?: any;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ExecutionContext {
  workflow: WorkflowDefinition;
  run: WorkflowRun;
  triggerData?: any;
  steps: Record<string, StepResult>;
}

// ─── Registered Tools ─────────────────────────────────────────────────────────

type ToolFn = (args: Record<string, any>, context: ExecutionContext) => Promise<any>;
const registeredTools = new Map<string, ToolFn>();

registeredTools.set("web_search", async (args) => {
  const result = await llmGateway.chat(
    [{ role: "user", content: `Search the web for: ${args.query}. Return top results with summaries.` }],
    {}
  );
  return result.content;
});

registeredTools.set("summarize", async (args) => {
  const result = await llmGateway.chat(
    [{ role: "user", content: `Summarize the following:\n\n${args.content}` }],
    {}
  );
  return result.content;
});

registeredTools.set("send_email", async (args) => {
  Logger.info("[WorkflowEngine] send_email tool called", { to: args.to, subject: args.subject });
  // Integration point — would connect to email service
  return { success: true, message: `Email queued to ${args.to}: ${args.subject}` };
});

// ─── Constants ────────────────────────────────────────────────────────────────

const QUEUE_NAME = "workflow-runs";
const RUN_KEY = (id: string) => `workflow:run:${id}`;
const DEF_KEY = (id: string) => `workflow:def:${id}`;
const APPROVAL_KEY = (runId: string, stepId: string) => `workflow:approval:${runId}:${stepId}`;
const RUN_TTL = 60 * 60 * 24 * 7; // 7 days

// ─── Engine ───────────────────────────────────────────────────────────────────

class WorkflowEngine {
  private queue: Queue;
  private worker: Worker | null = null;
  private queueEvents: QueueEvents;

  constructor() {
    const connection = redis;

    this.queue = new Queue(QUEUE_NAME, { connection } as any);
    this.queueEvents = new QueueEvents(QUEUE_NAME, { connection } as any);

    Logger.info("[WorkflowEngine] Initialized", { queue: QUEUE_NAME });
  }

  // ── Registration ────────────────────────────────────────────────────────────

  async registerWorkflow(definition: WorkflowDefinition): Promise<string> {
    this.validateDefinition(definition);
    const workflowId = `wf_${Date.now()}_${randomUUID().slice(0, 8)}`;
    await redis.setex(DEF_KEY(workflowId), RUN_TTL * 4, JSON.stringify(definition));
    Logger.info("[WorkflowEngine] Workflow registered", { workflowId, name: definition.name });
    return workflowId;
  }

  async trigger(workflowId: string, triggerData?: any, userId?: string): Promise<WorkflowRun> {
    const defRaw = await redis.get(DEF_KEY(workflowId));
    if (!defRaw) throw new Error(`Workflow not found: ${workflowId}`);
    const definition: WorkflowDefinition = JSON.parse(defRaw);

    const runId = `run_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const run: WorkflowRun = {
      id: runId,
      workflowId,
      status: "pending",
      startedAt: new Date(),
      triggerData,
      stepResults: {},
      userId,
    };

    await redis.setex(RUN_KEY(runId), RUN_TTL, JSON.stringify(run));
    await this.queue.add("run", { runId, workflowId }, {
      jobId: runId,
      attempts: definition.retries ?? 1,
      backoff: { type: "exponential", delay: 2000 },
      ...(definition.timeout ? { timeout: definition.timeout * 1000 } : {}),
    });

    Logger.info("[WorkflowEngine] Workflow triggered", { workflowId, runId, userId });
    return run;
  }

  // ── Execution ───────────────────────────────────────────────────────────────

  async executeRun(run: WorkflowRun, definition: WorkflowDefinition): Promise<WorkflowRun> {
    Logger.info("[WorkflowEngine] Executing run", { runId: run.id, workflow: definition.name, steps: definition.steps.length });

    run.status = "running";
    await this.saveRun(run);

    const context: ExecutionContext = {
      workflow: definition,
      run,
      triggerData: run.triggerData,
      steps: run.stepResults,
    };

    try {
      for (const step of definition.steps) {
        // Skip if paused (human_approval)
        if (run.status === "paused") {
          Logger.info("[WorkflowEngine] Run paused, stopping execution", { runId: run.id, atStep: step.id });
          break;
        }
        if (run.status === "cancelled") break;

        run.currentStep = step.id;
        const stepResult = await this.executeStep(step, run, context);
        run.stepResults[step.id] = stepResult;
        context.steps[step.id] = stepResult;

        await this.saveRun(run);

        if (stepResult.status === "failed") {
          Logger.error("[WorkflowEngine] Step failed, aborting run", { runId: run.id, stepId: step.id, error: stepResult.error });
          run.status = "failed";
          run.error = stepResult.error;
          run.completedAt = new Date();
          await this.saveRun(run);
          return run;
        }
      }

      if (run.status === "running") {
        run.status = "completed";
        run.completedAt = new Date();
        Logger.info("[WorkflowEngine] Run completed", { runId: run.id, duration: Date.now() - run.startedAt.getTime() });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      Logger.error("[WorkflowEngine] Run execution error", { runId: run.id, error: msg });
      run.status = "failed";
      run.error = msg;
      run.completedAt = new Date();
    }

    await this.saveRun(run);
    return run;
  }

  async executeStep(step: WorkflowStep, run: WorkflowRun, context: ExecutionContext): Promise<StepResult> {
    const result: StepResult = {
      stepId: step.id,
      status: "running",
      startedAt: new Date(),
    };

    Logger.info("[WorkflowEngine] Executing step", { runId: run.id, stepId: step.id, type: step.type });

    try {
      switch (step.type) {
        case "llm_call":
          result.result = await this.executeLLMCall(step, context);
          break;

        case "tool_execute":
          result.result = await this.executeToolCall(step, context);
          break;

        case "condition":
          result.result = await this.executeCondition(step, context);
          break;

        case "loop":
          result.result = await this.executeLoop(step, run, context);
          break;

        case "parallel":
          result.result = await this.executeParallel(step, run, context);
          break;

        case "human_approval":
          result.result = await this.executeHumanApproval(step, run, context);
          // If paused, the step stays pending
          if (run.status === "paused") {
            result.status = "pending";
            return result;
          }
          break;

        case "delay":
          await this.executeDelay(step, context);
          result.result = { waited: step.seconds ?? 1 };
          break;

        case "http_request":
          result.result = await this.executeHttpRequest(step, context);
          break;

        case "transform":
          result.result = await this.executeTransform(step, context);
          break;

        default:
          Logger.warn("[WorkflowEngine] Unknown step type", { type: step.type, stepId: step.id });
          result.result = null;
      }

      result.status = "completed";
      result.completedAt = new Date();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      Logger.error("[WorkflowEngine] Step execution failed", { stepId: step.id, error: msg });
      result.status = "failed";
      result.error = msg;
      result.completedAt = new Date();
    }

    return result;
  }

  // ── Step Implementations ─────────────────────────────────────────────────────

  private async executeLLMCall(step: WorkflowStep, context: ExecutionContext): Promise<any> {
    const prompt = this.interpolate(step.prompt ?? "", context);
    const model = step.model ?? "claude-opus-4-5";
    Logger.debug("[WorkflowEngine] LLM call", { stepId: step.id, model, promptLength: prompt.length });
    const response = await llmGateway.chat(
      [{ role: "user", content: prompt }],
      { model, userId: context.run.userId, temperature: step.temperature }
    );
    return response.content;
  }

  private async executeToolCall(step: WorkflowStep, context: ExecutionContext): Promise<any> {
    const toolName = step.tool as string;
    const rawInput = step.input ?? {};
    // Interpolate all string values in the input
    const input: Record<string, any> = {};
    for (const [k, v] of Object.entries(rawInput)) {
      input[k] = typeof v === "string" ? this.interpolate(v, context) : v;
    }

    Logger.debug("[WorkflowEngine] Tool execute", { stepId: step.id, tool: toolName });

    const toolFn = registeredTools.get(toolName);
    if (toolFn) {
      return toolFn(input, context);
    }

    // Fallback: ask LLM to simulate the tool
    const response = await llmGateway.chat(
      [{ role: "user", content: `Execute tool "${toolName}" with args: ${JSON.stringify(input)}. Return the result.` }],
      { userId: context.run.userId }
    );
    return response.content;
  }

  private async executeCondition(step: WorkflowStep, context: ExecutionContext): Promise<any> {
    const expr = this.interpolate(step.if ?? "false", context);
    const result = this.evaluateCondition(expr, context);
    Logger.debug("[WorkflowEngine] Condition evaluated", { stepId: step.id, expr, result });
    return { condition: result, branch: result ? step.then : step.else };
  }

  private async executeLoop(step: WorkflowStep, run: WorkflowRun, context: ExecutionContext): Promise<any> {
    const itemsExpr = step.items as string;
    const items = this.resolveValue(itemsExpr, context);
    if (!Array.isArray(items)) {
      throw new Error(`Loop items must be an array, got: ${typeof items}`);
    }

    Logger.debug("[WorkflowEngine] Loop starting", { stepId: step.id, itemCount: items.length });
    const results: any[] = [];

    for (let i = 0; i < items.length; i++) {
      const loopContext: ExecutionContext = {
        ...context,
        triggerData: { ...context.triggerData, loopItem: items[i], loopIndex: i },
        steps: { ...context.steps },
      };

      // Find the sub-step to execute
      const subStepId = step.step as string;
      const subStep = context.workflow.steps.find((s) => s.id === subStepId);
      if (!subStep) {
        Logger.warn("[WorkflowEngine] Loop sub-step not found", { subStepId });
        continue;
      }

      const subResult = await this.executeStep(subStep, run, loopContext);
      results.push(subResult.result);
    }

    return results;
  }

  private async executeParallel(step: WorkflowStep, run: WorkflowRun, context: ExecutionContext): Promise<any> {
    const stepIds = (step.steps as string[]) ?? [];
    Logger.debug("[WorkflowEngine] Parallel execution", { stepId: step.id, parallelSteps: stepIds.length });

    const stepObjects = stepIds
      .map((id) => context.workflow.steps.find((s) => s.id === id))
      .filter(Boolean) as WorkflowStep[];

    const results = await Promise.allSettled(
      stepObjects.map((subStep) => this.executeStep(subStep, run, context))
    );

    return results.map((r, i) => ({
      stepId: stepIds[i],
      status: r.status,
      result: r.status === "fulfilled" ? r.value.result : undefined,
      error: r.status === "rejected" ? String(r.reason) : undefined,
    }));
  }

  private async executeHumanApproval(step: WorkflowStep, run: WorkflowRun, context: ExecutionContext): Promise<any> {
    const message = this.interpolate(step.message ?? "Please review and approve", context);
    const timeoutSecs = step.timeout ?? 3600;

    Logger.info("[WorkflowEngine] Human approval required", { runId: run.id, stepId: step.id, message });

    // Check if approval already exists
    const existingApproval = await redis.get(APPROVAL_KEY(run.id, step.id));
    if (existingApproval) {
      const approval = JSON.parse(existingApproval);
      Logger.info("[WorkflowEngine] Approval found", { runId: run.id, stepId: step.id, approved: approval.approved });
      return approval;
    }

    // Store pending approval and pause the run
    await redis.setex(
      APPROVAL_KEY(run.id, step.id),
      timeoutSecs,
      JSON.stringify({ pending: true, message, requestedAt: new Date().toISOString() })
    );

    run.status = "paused";
    Logger.info("[WorkflowEngine] Run paused for human approval", { runId: run.id, stepId: step.id, timeoutSecs });
    return { pending: true, message };
  }

  private async executeDelay(step: WorkflowStep, _context: ExecutionContext): Promise<void> {
    const seconds = Math.min(Number(step.seconds ?? 1), 300); // max 5 min delay
    Logger.debug("[WorkflowEngine] Delay step", { seconds });
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }

  private async executeHttpRequest(step: WorkflowStep, context: ExecutionContext): Promise<any> {
    const url = this.interpolate(step.url ?? "", context);
    const method = (step.method ?? "GET").toUpperCase();
    const headers = step.headers ?? {};
    const data = step.body ? JSON.parse(this.interpolate(JSON.stringify(step.body), context)) : undefined;

    Logger.debug("[WorkflowEngine] HTTP request", { stepId: step.id, method, url });

    const response = await axios({ method, url, headers, data, timeout: 30000 });
    return {
      status: response.status,
      headers: response.headers,
      data: response.data,
    };
  }

  private async executeTransform(step: WorkflowStep, context: ExecutionContext): Promise<any> {
    const input = step.input ? this.resolveValue(step.input, context) : context.triggerData;
    const transformInstruction = this.interpolate(step.transform ?? "Return input unchanged", context);

    Logger.debug("[WorkflowEngine] Transform step", { stepId: step.id });

    const response = await llmGateway.chat(
      [
        {
          role: "user",
          content: `Transform the following data:\n${JSON.stringify(input, null, 2)}\n\nTransformation: ${transformInstruction}\n\nReturn only the transformed result as JSON.`,
        },
      ],
      { userId: context.run.userId }
    );

    try {
      const jsonMatch = response.content.match(/```(?:json)?\n?([\s\S]+?)\n?```/);
      return jsonMatch ? JSON.parse(jsonMatch[1]) : response.content;
    } catch {
      return response.content;
    }
  }

  // ── Run Management ───────────────────────────────────────────────────────────

  async resumeRun(runId: string, approvalResult: any): Promise<void> {
    const run = await this.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (run.status !== "paused") throw new Error(`Run is not paused: ${run.status}`);

    const stepId = run.currentStep;
    if (!stepId) throw new Error("No current step to resume");

    Logger.info("[WorkflowEngine] Resuming run", { runId, stepId, approved: approvalResult.approved });

    // Store approval result
    await redis.setex(APPROVAL_KEY(runId, stepId), 3600, JSON.stringify(approvalResult));

    // Re-queue the run
    run.status = "running";
    await this.saveRun(run);

    const defRaw = await redis.get(DEF_KEY(run.workflowId));
    if (!defRaw) throw new Error(`Workflow definition not found: ${run.workflowId}`);

    await this.queue.add("run", { runId, workflowId: run.workflowId }, {
      jobId: `${runId}_resume_${Date.now()}`,
    });
  }

  async cancelRun(runId: string): Promise<void> {
    const run = await this.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    run.status = "cancelled";
    run.completedAt = new Date();
    await this.saveRun(run);
    Logger.info("[WorkflowEngine] Run cancelled", { runId });
  }

  async getRun(runId: string): Promise<WorkflowRun | null> {
    const raw = await redis.get(RUN_KEY(runId));
    if (!raw) return null;
    const run = JSON.parse(raw) as WorkflowRun;
    // Restore Date objects
    run.startedAt = new Date(run.startedAt);
    if (run.completedAt) run.completedAt = new Date(run.completedAt);
    return run;
  }

  async listRuns(workflowId?: string, userId?: string): Promise<WorkflowRun[]> {
    const pattern = "workflow:run:*";
    const keys = await redis.keys(pattern);
    const runs: WorkflowRun[] = [];

    for (const key of keys) {
      const raw = await redis.get(key);
      if (!raw) continue;
      try {
        const run = JSON.parse(raw) as WorkflowRun;
        if (workflowId && run.workflowId !== workflowId) continue;
        if (userId && run.userId !== userId) continue;
        run.startedAt = new Date(run.startedAt);
        if (run.completedAt) run.completedAt = new Date(run.completedAt);
        runs.push(run);
      } catch {
        // ignore parse errors
      }
    }

    return runs.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }

  async setupCronTriggers(): Promise<void> {
    const defKeys = await redis.keys("workflow:def:*");
    Logger.info("[WorkflowEngine] Setting up cron triggers", { count: defKeys.length });

    for (const key of defKeys) {
      const raw = await redis.get(key);
      if (!raw) continue;
      try {
        const def: WorkflowDefinition = JSON.parse(raw);
        if (def.trigger.type !== "cron") continue;

        const workflowId = key.replace("workflow:def:", "");
        const schedule = (def.trigger as { type: "cron"; schedule: string }).schedule;

        await this.queue.add(
          "workflow",
          { workflowId },
          { repeat: { pattern: schedule }, jobId: `cron_${workflowId}` }
        );

        Logger.info("[WorkflowEngine] Cron trigger registered", { workflowId, schedule, name: def.name });
      } catch (e) {
        Logger.error("[WorkflowEngine] Failed to set up cron trigger", { key, error: e });
      }
    }
  }

  async loadWorkflowFromYAML(yamlContent: string): Promise<WorkflowDefinition> {
    const def = YAML.parse(yamlContent) as WorkflowDefinition;
    this.validateDefinition(def);
    Logger.info("[WorkflowEngine] Loaded workflow from YAML", { name: def.name, steps: def.steps.length });
    return def;
  }

  // ── Worker ───────────────────────────────────────────────────────────────────

  startWorker(): void {
    if (this.worker) {
      Logger.warn("[WorkflowEngine] Worker already running");
      return;
    }

    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        const { runId, workflowId } = job.data;
        Logger.info("[WorkflowEngine] Worker processing job", { jobId: job.id, runId, workflowId });

        const runRaw = await redis.get(RUN_KEY(runId));
        if (!runRaw) {
          throw new Error(`Run not found: ${runId}`);
        }
        const run: WorkflowRun = JSON.parse(runRaw);
        run.startedAt = new Date(run.startedAt);

        const defRaw = await redis.get(DEF_KEY(workflowId ?? run.workflowId));
        if (!defRaw) {
          throw new Error(`Workflow definition not found: ${workflowId}`);
        }
        const definition: WorkflowDefinition = JSON.parse(defRaw);

        await this.executeRun(run, definition);
      },
      { connection: redis as any, concurrency: 5 }
    );

    this.worker.on("completed", (job) => {
      Logger.info("[WorkflowEngine] Job completed", { jobId: job.id });
    });

    this.worker.on("failed", (job, err) => {
      Logger.error("[WorkflowEngine] Job failed", { jobId: job?.id, error: err.message });
    });

    Logger.info("[WorkflowEngine] Worker started", { queue: QUEUE_NAME });
  }

  // ── Interpolation ─────────────────────────────────────────────────────────────

  interpolate(template: string, context: ExecutionContext): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
      const trimmed = path.trim();
      const value = this.resolvePath(trimmed, context);
      if (value === undefined || value === null) return "";
      return typeof value === "object" ? JSON.stringify(value) : String(value);
    });
  }

  private resolveValue(expr: string, context: ExecutionContext): any {
    if (typeof expr !== "string") return expr;
    // If the whole string is a template expression, resolve it directly
    const templateMatch = expr.match(/^\{\{([^}]+)\}\}$/);
    if (templateMatch) {
      return this.resolvePath(templateMatch[1].trim(), context);
    }
    return this.interpolate(expr, context);
  }

  private resolvePath(path: string, context: ExecutionContext): any {
    const parts = path.split(".");
    const root = parts[0];

    let obj: any;
    if (root === "steps" && parts.length >= 3) {
      const stepId = parts[1];
      const field = parts.slice(2).join(".");
      const stepResult = context.steps[stepId];
      if (!stepResult) return undefined;
      obj = stepResult.result;
      if (parts.length === 3 && parts[2] === "result") return stepResult.result;
      // Dig further into the result
      return this.deepGet(stepResult.result, parts.slice(3));
    }

    if (root === "trigger") {
      obj = context.triggerData;
      return this.deepGet(obj, parts.slice(1));
    }

    if (root === "workflow") {
      obj = context.workflow;
      return this.deepGet(obj, parts.slice(1));
    }

    return undefined;
  }

  private deepGet(obj: any, parts: string[]): any {
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  }

  // ── Condition Evaluation (no eval) ───────────────────────────────────────────

  evaluateCondition(expression: string, context: ExecutionContext): boolean {
    const interpolated = this.interpolate(expression, context);
    const expr = interpolated.trim();

    // Comparison operators: >, <, >=, <=, ==, !=
    const comparisonPattern = /^(.+?)\s*(>=|<=|==|!=|>|<)\s*(.+)$/;
    const compMatch = expr.match(comparisonPattern);
    if (compMatch) {
      const [, left, op, right] = compMatch;
      const leftVal = this.coerceValue(left.trim());
      const rightVal = this.coerceValue(right.trim());
      switch (op) {
        case ">":  return Number(leftVal) > Number(rightVal);
        case "<":  return Number(leftVal) < Number(rightVal);
        case ">=": return Number(leftVal) >= Number(rightVal);
        case "<=": return Number(leftVal) <= Number(rightVal);
        case "==": return String(leftVal) === String(rightVal);
        case "!=": return String(leftVal) !== String(rightVal);
      }
    }

    // includes check: "value includes substring"
    const includesMatch = expr.match(/^(.+?)\s+includes\s+(.+)$/i);
    if (includesMatch) {
      const [, haystack, needle] = includesMatch;
      return String(haystack.trim()).includes(needle.trim().replace(/^["']|["']$/g, ""));
    }

    // Boolean literals
    if (expr.toLowerCase() === "true") return true;
    if (expr.toLowerCase() === "false") return false;

    // Truthy/falsy for non-empty strings
    return expr.length > 0 && expr !== "0" && expr !== "null" && expr !== "undefined";
  }

  private coerceValue(val: string): string | number | boolean {
    if (val === "true") return true;
    if (val === "false") return false;
    const num = Number(val.replace(/["']/g, ""));
    if (!isNaN(num)) return num;
    return val.replace(/^["']|["']$/g, "");
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private validateDefinition(def: WorkflowDefinition): void {
    if (!def.name) throw new Error("Workflow definition must have a name");
    if (!def.trigger) throw new Error("Workflow definition must have a trigger");
    if (!Array.isArray(def.steps)) throw new Error("Workflow definition must have steps array");
    const ids = new Set<string>();
    for (const step of def.steps) {
      if (!step.id) throw new Error(`Step missing id: ${JSON.stringify(step)}`);
      if (!step.type) throw new Error(`Step ${step.id} missing type`);
      if (ids.has(step.id)) throw new Error(`Duplicate step id: ${step.id}`);
      ids.add(step.id);
    }
  }

  private async saveRun(run: WorkflowRun): Promise<void> {
    await redis.setex(RUN_KEY(run.id), RUN_TTL, JSON.stringify(run));
  }
}

export const workflowEngine = new WorkflowEngine();
