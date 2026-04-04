import { randomUUID } from "crypto";
import pino from "pino";
import {
  getClaudeAgentBackbone,
  CLAUDE_MODELS,
  type AgentMessage,
  type ToolDefinition,
} from "./ClaudeAgentBackbone.js";

const logger = pino({ name: "AgentPlannerWithThinking" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface PlanStep {
  stepId: string;
  name: string;
  description: string;
  /** Tool to invoke for this step (empty = LLM reasoning only) */
  tool?: string;
  toolInput?: Record<string, unknown>;
  /** stepIds that must complete before this step can start */
  dependencies: string[];
  estimatedTokens: number;
  status: StepStatus;
  result?: unknown;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  retryCount: number;
  maxRetries: number;
  /** Can this step run alongside siblings that also have no conflicting deps? */
  parallelizable: boolean;
}

export interface HierarchicalPlan {
  planId: string;
  goal: string;
  context: string;
  steps: PlanStep[];
  thinkingContent: string;
  /** Topologically sorted execution order (respects deps) */
  executionOrder: string[][];
  status: "draft" | "validated" | "executing" | "completed" | "failed" | "replanning";
  validation: PlanValidation;
  createdAt: number;
  updatedAt: number;
  version: number;
  estimatedTotalTokens: number;
  estimatedCostUSD: number;
  failureReason?: string;
}

export interface PlanValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  circularDependencies: string[][];
  missingTools: string[];
  unreachableSteps: string[];
}

export interface PlanningOptions {
  availableTools?: ToolDefinition[];
  thinkingBudgetTokens?: number;
  maxSteps?: number;
  preferParallel?: boolean;
  contextDocuments?: string[];
}

export interface ReplanContext {
  failedStepId: string;
  failureReason: string;
  completedStepIds: string[];
  attemptNumber: number;
}

// ─── Topological sort ─────────────────────────────────────────────────────────

function topologicalSort(steps: PlanStep[]): { order: string[][]; hasCycle: boolean; cycles: string[][] } {
  const stepMap = new Map(steps.map((s) => [s.stepId, s]));
  const inDegree = new Map(steps.map((s) => [s.stepId, 0]));
  const graph = new Map<string, Set<string>>();

  for (const step of steps) {
    if (!graph.has(step.stepId)) graph.set(step.stepId, new Set());
    for (const dep of step.dependencies) {
      if (!graph.has(dep)) graph.set(dep, new Set());
      graph.get(dep)!.add(step.stepId);
      inDegree.set(step.stepId, (inDegree.get(step.stepId) ?? 0) + 1);
    }
  }

  const waves: string[][] = [];
  const visited = new Set<string>();

  while (visited.size < steps.length) {
    const wave = Array.from(inDegree.entries())
      .filter(([id, deg]) => deg === 0 && !visited.has(id))
      .map(([id]) => id);

    if (wave.length === 0) {
      // Cycle detected
      const remaining = steps.map((s) => s.stepId).filter((id) => !visited.has(id));
      return { order: waves, hasCycle: true, cycles: [remaining] };
    }

    waves.push(wave);
    for (const id of wave) {
      visited.add(id);
      for (const dependent of graph.get(id) ?? []) {
        inDegree.set(dependent, (inDegree.get(dependent) ?? 1) - 1);
      }
    }
  }

  return { order: waves, hasCycle: false, cycles: [] };
}

// ─── AgentPlannerWithThinking ─────────────────────────────────────────────────

export class AgentPlannerWithThinking {
  private plans = new Map<string, HierarchicalPlan>();

  constructor(
    private readonly backbone = getClaudeAgentBackbone()
  ) {
    logger.info("[AgentPlannerWithThinking] Initialized");
  }

  // ── Plan creation ─────────────────────────────────────────────────────────────

  async createPlan(
    goal: string,
    context: string,
    opts: PlanningOptions = {}
  ): Promise<HierarchicalPlan> {
    const {
      thinkingBudgetTokens = 16_000,
      maxSteps = 20,
      availableTools = [],
      contextDocuments = [],
    } = opts;

    logger.info({ goal: goal.slice(0, 80) }, "[AgentPlannerWithThinking] Creating plan with extended thinking");

    const toolList = availableTools.length > 0
      ? `\nAvailable tools:\n${availableTools.map((t) => `- ${t.name}: ${t.description}`).join("\n")}`
      : "\nNo specific tools are available — use LLM reasoning steps.";

    const contextSection = contextDocuments.length > 0
      ? `\nContext documents:\n${contextDocuments.map((d, i) => `[${i + 1}] ${d.slice(0, 500)}`).join("\n\n")}`
      : "";

    const systemPrompt = `You are an expert AI planning agent. Create detailed, executable plans with clear dependencies.

When planning, think deeply about:
1. What are the key sub-problems?
2. Which steps can run in parallel vs must be sequential?
3. What could go wrong and how to handle it?
4. What tools are best suited for each step?

Always output valid JSON following the exact schema provided.`;

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Create a hierarchical execution plan for the following goal.

GOAL: ${goal}

CONTEXT: ${context}${toolList}${contextSection}

Output a JSON plan with exactly this schema:
{
  "steps": [
    {
      "stepId": "step_1",
      "name": "Short name",
      "description": "Detailed description of what to do",
      "tool": "tool_name_or_null",
      "toolInput": {},
      "dependencies": [],
      "estimatedTokens": 500,
      "parallelizable": true,
      "maxRetries": 2
    }
  ]
}

Rules:
- Maximum ${maxSteps} steps
- Each step must have a unique stepId (step_1, step_2, etc.)
- dependencies array contains stepIds that must complete first
- parallelizable: true if this step can run alongside other independent steps
- tool must be one of the available tool names or null/omitted for reasoning steps
- estimatedTokens: rough token estimate for this step (100-2000)

Return ONLY the JSON, no explanation.`,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: CLAUDE_MODELS.OPUS,
      maxTokens: 8192,
      system: systemPrompt,
      thinking: { enabled: true, budgetTokens: thinkingBudgetTokens },
    });

    // Parse plan JSON from response
    let rawSteps: Omit<PlanStep, "status" | "retryCount" | "result" | "error" | "startedAt" | "completedAt">[] = [];

    try {
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
      }
    } catch (err) {
      logger.error({ err, text: response.text.slice(0, 200) }, "[AgentPlannerWithThinking] Failed to parse plan JSON");
    }

    // Normalize steps
    const steps: PlanStep[] = rawSteps.map((s) => ({
      ...s,
      stepId: s.stepId ?? randomUUID(),
      dependencies: Array.isArray(s.dependencies) ? s.dependencies : [],
      estimatedTokens: s.estimatedTokens ?? 500,
      parallelizable: s.parallelizable ?? true,
      maxRetries: s.maxRetries ?? 2,
      status: "pending",
      retryCount: 0,
    }));

    // Build execution order
    const { order: executionOrder, hasCycle, cycles } = topologicalSort(steps);

    const availableToolNames = new Set(availableTools.map((t) => t.name));
    const missingTools = steps
      .filter((s) => s.tool && !availableToolNames.has(s.tool))
      .map((s) => s.tool!);

    const allStepIds = new Set(steps.map((s) => s.stepId));
    const unreachableSteps = steps
      .filter((s) => s.dependencies.some((d) => !allStepIds.has(d)))
      .map((s) => s.stepId);

    const validation: PlanValidation = {
      valid: !hasCycle && missingTools.length === 0 && unreachableSteps.length === 0,
      errors: [
        ...(hasCycle ? [`Circular dependencies detected: ${JSON.stringify(cycles)}`] : []),
        ...missingTools.map((t) => `Tool '${t}' is not available`),
        ...unreachableSteps.map((id) => `Step '${id}' has unresolvable dependencies`),
      ],
      warnings: steps.length === 0 ? ["Plan has no steps"] : [],
      circularDependencies: cycles,
      missingTools,
      unreachableSteps,
    };

    const totalTokens = steps.reduce((s, step) => s + step.estimatedTokens, 0);
    const estimatedCostUSD = (totalTokens / 1_000_000) * 15.0; // Opus pricing

    const plan: HierarchicalPlan = {
      planId: randomUUID(),
      goal,
      context,
      steps,
      thinkingContent: response.thinkingContent,
      executionOrder,
      status: validation.valid ? "validated" : "draft",
      validation,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
      estimatedTotalTokens: totalTokens,
      estimatedCostUSD,
    };

    this.plans.set(plan.planId, plan);

    logger.info(
      {
        planId: plan.planId,
        steps: steps.length,
        valid: validation.valid,
        waves: executionOrder.length,
        thinkingTokens: response.thinkingContent.length,
      },
      "[AgentPlannerWithThinking] Plan created"
    );

    return plan;
  }

  // ── Plan optimization ─────────────────────────────────────────────────────────

  optimizePlan(plan: HierarchicalPlan): HierarchicalPlan {
    const optimized = { ...plan, steps: [...plan.steps] };
    let optimizationsMade = 0;

    // Re-run topo sort to confirm parallelization
    const { order } = topologicalSort(optimized.steps);
    optimized.executionOrder = order;

    // Mark steps in waves of size > 1 as parallelizable
    for (const wave of order) {
      if (wave.length > 1) {
        for (const stepId of wave) {
          const step = optimized.steps.find((s) => s.stepId === stepId);
          if (step && !step.parallelizable) {
            step.parallelizable = true;
            optimizationsMade++;
          }
        }
      }
    }

    if (optimizationsMade > 0) {
      logger.info(
        { planId: plan.planId, optimizations: optimizationsMade },
        "[AgentPlannerWithThinking] Plan optimized"
      );
    }

    optimized.updatedAt = Date.now();
    this.plans.set(optimized.planId, optimized);
    return optimized;
  }

  // ── Re-planning ───────────────────────────────────────────────────────────────

  async replan(
    originalPlan: HierarchicalPlan,
    ctx: ReplanContext,
    opts: PlanningOptions = {}
  ): Promise<HierarchicalPlan> {
    logger.info(
      { planId: originalPlan.planId, failedStep: ctx.failedStepId, attempt: ctx.attemptNumber },
      "[AgentPlannerWithThinking] Replanning after failure"
    );

    const completedSteps = originalPlan.steps
      .filter((s) => ctx.completedStepIds.includes(s.stepId))
      .map((s) => `✓ ${s.name}: ${JSON.stringify(s.result ?? {}).slice(0, 100)}`);

    const failedStep = originalPlan.steps.find((s) => s.stepId === ctx.failedStepId);
    const remainingGoal = failedStep
      ? `Failed at: ${failedStep.name} — ${ctx.failureReason}`
      : ctx.failureReason;

    const revisedContext = `
ORIGINAL GOAL: ${originalPlan.goal}

COMPLETED STEPS (don't repeat these):
${completedSteps.join("\n") || "(none)"}

FAILURE: ${remainingGoal}

Attempt number: ${ctx.attemptNumber}

Create a NEW plan only for the REMAINING work. Do not re-include completed steps.
Consider alternative approaches that avoid the previous failure.
`.trim();

    const newPlan = await this.createPlan(originalPlan.goal, revisedContext, opts);
    newPlan.version = (originalPlan.version ?? 1) + 1;
    newPlan.status = newPlan.validation.valid ? "validated" : "draft";

    return newPlan;
  }

  // ── Step execution tracking ────────────────────────────────────────────────────

  markStepStarted(planId: string, stepId: string): void {
    const plan = this.plans.get(planId);
    const step = plan?.steps.find((s) => s.stepId === stepId);
    if (step) {
      step.status = "running";
      step.startedAt = Date.now();
      plan!.updatedAt = Date.now();
    }
  }

  markStepCompleted(planId: string, stepId: string, result: unknown): void {
    const plan = this.plans.get(planId);
    const step = plan?.steps.find((s) => s.stepId === stepId);
    if (step) {
      step.status = "completed";
      step.result = result;
      step.completedAt = Date.now();
      plan!.updatedAt = Date.now();
    }
    this.updatePlanStatus(planId);
  }

  markStepFailed(planId: string, stepId: string, error: string): void {
    const plan = this.plans.get(planId);
    const step = plan?.steps.find((s) => s.stepId === stepId);
    if (step) {
      step.status = "failed";
      step.error = error;
      step.completedAt = Date.now();
      plan!.status = "failed";
      plan!.failureReason = `Step '${step.name}' failed: ${error}`;
      plan!.updatedAt = Date.now();
    }
  }

  getReadySteps(planId: string): PlanStep[] {
    const plan = this.plans.get(planId);
    if (!plan) return [];

    const completedIds = new Set(
      plan.steps.filter((s) => s.status === "completed").map((s) => s.stepId)
    );

    return plan.steps.filter(
      (s) =>
        s.status === "pending" &&
        s.dependencies.every((d) => completedIds.has(d))
    );
  }

  private updatePlanStatus(planId: string): void {
    const plan = this.plans.get(planId);
    if (!plan) return;
    const allDone = plan.steps.every(
      (s) => s.status === "completed" || s.status === "skipped"
    );
    if (allDone) plan.status = "completed";
  }

  getPlan(planId: string): HierarchicalPlan | null {
    return this.plans.get(planId) ?? null;
  }
}

export const agentPlanner = new AgentPlannerWithThinking();
