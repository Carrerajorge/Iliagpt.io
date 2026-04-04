/**
 * AgentPlannerWithThinking — Deep task planning using Claude's extended thinking.
 *
 * Generates hierarchical plans with dependency graphs, validates them for
 * circular dependencies and missing tools, optimises parallel execution,
 * and supports re-planning when a step fails.
 */

import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "crypto";
import { Logger } from "../lib/logger";
import { REASONING_MODEL, FAST_MODEL } from "./ClaudeAgentBackbone";

// ─── Types ──────────────────────────────────────────────────────────────────────
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface PlanStep {
  id: string;
  index: number;
  description: string;
  requiredTools: string[];
  estimatedMinutes: number;
  riskLevel: RiskLevel;
  dependsOn: string[]; // step ids
  parallelGroup?: string; // steps with same group can run concurrently
  status: StepStatus;
  failureReason?: string;
  retryCount: number;
}

export interface HierarchicalPlan {
  id: string;
  goal: string;
  summary: string;
  steps: PlanStep[];
  estimatedTotalMinutes: number;
  overallRisk: RiskLevel;
  createdAt: Date;
  version: number;
}

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface PlanOptimizationResult {
  plan: HierarchicalPlan;
  parallelGroups: string[][];
  estimatedSpeedup: number;
}

export interface ReplanInput {
  originalPlan: HierarchicalPlan;
  failedStepId: string;
  failureReason: string;
  completedStepIds: string[];
  availableTools: string[];
}

// ─── Prompt helpers ──────────────────────────────────────────────────────────────
function buildPlanningPrompt(goal: string, availableTools: string[]): string {
  return `You are an expert task planner. Given a goal and available tools, produce a hierarchical execution plan.

GOAL: ${goal}

AVAILABLE TOOLS: ${availableTools.join(", ")}

Return a JSON object matching this exact schema:
{
  "summary": "one-sentence plan overview",
  "steps": [
    {
      "index": 0,
      "description": "what this step does",
      "requiredTools": ["tool_name"],
      "estimatedMinutes": 2,
      "riskLevel": "low|medium|high|critical",
      "dependsOn": []
    }
  ]
}

Rules:
- Keep steps atomic (one clear action per step)
- Use concrete tool names from the available list
- dependsOn must reference earlier step indices (not current or future)
- Estimate time honestly; research steps take longer than computation steps
- riskLevel: low = read-only, medium = creates artifacts, high = modifies state, critical = irreversible
- Maximum 15 steps`;
}

function buildReplanPrompt(input: ReplanInput): string {
  const remaining = input.originalPlan.steps
    .filter((s) => !input.completedStepIds.includes(s.id) && s.id !== input.failedStepId)
    .map((s) => `  [${s.index}] ${s.description}`)
    .join("\n");

  return `A plan step has failed. Re-plan the remaining work.

ORIGINAL GOAL: ${input.originalPlan.goal}

FAILED STEP: ${input.originalPlan.steps.find((s) => s.id === input.failedStepId)?.description}
FAILURE REASON: ${input.failureReason}

ALREADY COMPLETED: ${input.completedStepIds.length} steps
REMAINING STEPS (original):
${remaining}

AVAILABLE TOOLS: ${input.availableTools.join(", ")}

Produce an updated JSON plan for the remaining steps only. Adjust for the failure — skip impossible steps, find alternatives, add recovery steps. Use the same schema as before.`;
}

function buildExplanationPrompt(plan: HierarchicalPlan): string {
  const stepList = plan.steps
    .map((s) => `  Step ${s.index + 1}: ${s.description} (${s.estimatedMinutes}m, risk: ${s.riskLevel})`)
    .join("\n");
  return `Explain this execution plan in plain language for a non-technical user. Be concise and clear.

PLAN STEPS:
${stepList}

OVERALL ESTIMATED TIME: ${plan.estimatedTotalMinutes} minutes
RISK LEVEL: ${plan.overallRisk}

Write 2-3 sentences covering: what will be done, in what order, and any notable risks.`;
}

// ─── AgentPlannerWithThinking ────────────────────────────────────────────────────
export class AgentPlannerWithThinking {
  private readonly client: Anthropic;
  private readonly thinkingBudget: number;

  constructor(thinkingBudget = 8000) {
    this.client = new Anthropic();
    this.thinkingBudget = thinkingBudget;
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  /** Generate a full hierarchical plan for a goal using extended thinking. */
  async plan(goal: string, availableTools: string[]): Promise<HierarchicalPlan> {
    Logger.info("[AgentPlanner] Generating plan with extended thinking", { goal });

    const prompt = buildPlanningPrompt(goal, availableTools);
    const raw = await this.callWithThinking(prompt, REASONING_MODEL);
    const parsed = this.parseSteps(raw, goal);
    const plan = this.assemblePlan(goal, parsed);

    Logger.info("[AgentPlanner] Plan generated", {
      planId: plan.id,
      steps: plan.steps.length,
      estimatedMinutes: plan.estimatedTotalMinutes,
    });

    return plan;
  }

  /** Validate a plan for structural correctness. */
  validate(plan: HierarchicalPlan, availableTools: string[]): PlanValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const ids = new Set(plan.steps.map((s) => s.id));

    // Check for circular dependencies using DFS
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const hasCycle = (stepId: string): boolean => {
      visited.add(stepId);
      recStack.add(stepId);
      const step = plan.steps.find((s) => s.id === stepId);
      for (const dep of step?.dependsOn ?? []) {
        if (!visited.has(dep) && hasCycle(dep)) return true;
        if (recStack.has(dep)) return true;
      }
      recStack.delete(stepId);
      return false;
    };

    for (const step of plan.steps) {
      if (!visited.has(step.id) && hasCycle(step.id)) {
        errors.push(`Circular dependency detected involving step "${step.description}"`);
      }
    }

    // Check dependency references exist
    for (const step of plan.steps) {
      for (const dep of step.dependsOn) {
        if (!ids.has(dep)) {
          errors.push(`Step "${step.description}" depends on non-existent step id "${dep}"`);
        }
        const depStep = plan.steps.find((s) => s.id === dep);
        if (depStep && depStep.index >= step.index) {
          errors.push(
            `Step "${step.description}" (index ${step.index}) depends on later step "${depStep.description}" (index ${depStep.index})`
          );
        }
      }
    }

    // Check tools are available
    const toolSet = new Set(availableTools);
    for (const step of plan.steps) {
      for (const tool of step.requiredTools) {
        if (!toolSet.has(tool)) {
          warnings.push(`Step "${step.description}" requires tool "${tool}" which may not be available`);
        }
      }
    }

    // Check for impossible high-risk steps with no confirmation
    const criticalSteps = plan.steps.filter((s) => s.riskLevel === "critical");
    if (criticalSteps.length > 3) {
      warnings.push(`Plan has ${criticalSteps.length} critical-risk steps — consider splitting into smaller plans`);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /** Optimise a plan by identifying parallelisable step groups. */
  optimise(plan: HierarchicalPlan): PlanOptimizationResult {
    const stepMap = new Map(plan.steps.map((s) => [s.id, s]));
    const groups: string[][] = [];
    const stepToGroup = new Map<string, string>();

    // Topological sort
    const inDegree = new Map(plan.steps.map((s) => [s.id, s.dependsOn.length]));
    const queue: PlanStep[] = plan.steps.filter((s) => s.dependsOn.length === 0);
    const levels: PlanStep[][] = [];

    while (queue.length > 0) {
      levels.push([...queue]);
      queue.length = 0;

      for (const step of levels[levels.length - 1]) {
        for (const other of plan.steps) {
          if (other.dependsOn.includes(step.id)) {
            inDegree.set(other.id, (inDegree.get(other.id) ?? 1) - 1);
            if (inDegree.get(other.id) === 0) {
              queue.push(other);
            }
          }
        }
      }
    }

    // Assign parallel groups per level
    const optimisedSteps: PlanStep[] = [];
    for (let li = 0; li < levels.length; li++) {
      const groupId = `pg_${li}`;
      const groupStepIds = levels[li].map((s) => s.id);
      if (groupStepIds.length > 1) groups.push(groupStepIds);

      for (const step of levels[li]) {
        stepToGroup.set(step.id, groupId);
        optimisedSteps.push({ ...step, parallelGroup: groupId });
      }
    }

    const serialMinutes = plan.steps.reduce((sum, s) => sum + s.estimatedMinutes, 0);
    const parallelMinutes = levels.reduce(
      (sum, level) => sum + Math.max(...level.map((s) => s.estimatedMinutes)),
      0
    );
    const speedup = serialMinutes > 0 ? serialMinutes / Math.max(parallelMinutes, 1) : 1;

    const optimisedPlan: HierarchicalPlan = {
      ...plan,
      steps: optimisedSteps,
      estimatedTotalMinutes: parallelMinutes,
      version: plan.version + 1,
    };

    Logger.info("[AgentPlanner] Plan optimised", {
      planId: plan.id,
      parallelGroups: groups.length,
      estimatedSpeedup: speedup.toFixed(2),
    });

    return { plan: optimisedPlan, parallelGroups: groups, estimatedSpeedup: speedup };
  }

  /** Re-plan after a step failure using Claude fast model. */
  async replan(input: ReplanInput): Promise<HierarchicalPlan> {
    Logger.info("[AgentPlanner] Re-planning after step failure", {
      planId: input.originalPlan.id,
      failedStep: input.failedStepId,
    });

    const prompt = buildReplanPrompt(input);
    const raw = await this.callWithThinking(prompt, FAST_MODEL);
    const parsed = this.parseSteps(raw, input.originalPlan.goal);
    const plan = this.assemblePlan(input.originalPlan.goal, parsed, input.originalPlan.version + 1);

    return plan;
  }

  /** Produce a natural language explanation of the plan. */
  async explain(plan: HierarchicalPlan): Promise<string> {
    const prompt = buildExplanationPrompt(plan);
    const response = await this.client.messages.create({
      model: FAST_MODEL,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock?.type === "text" ? textBlock.text : "Plan explanation unavailable.";
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private async callWithThinking(prompt: string, model: string): Promise<string> {
    const params: any = {
      model,
      max_tokens: 16000,
      messages: [{ role: "user", content: prompt }],
    };

    if (this.thinkingBudget > 0) {
      params.thinking = { type: "enabled", budget_tokens: this.thinkingBudget };
    }

    const response = await this.client.messages.create(params);
    const textBlock = response.content.find((b: any) => b.type === "text");
    return textBlock?.type === "text" ? (textBlock as any).text : "";
  }

  private parseSteps(
    raw: string,
    goal: string
  ): Array<{
    index: number;
    description: string;
    requiredTools: string[];
    estimatedMinutes: number;
    riskLevel: RiskLevel;
    dependsOn: number[];
  }> {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      Logger.warn("[AgentPlanner] Could not parse JSON from response", { raw: raw.slice(0, 200) });
      return [];
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return (parsed.steps ?? []).map((s: any, i: number) => ({
        index: typeof s.index === "number" ? s.index : i,
        description: String(s.description ?? ""),
        requiredTools: Array.isArray(s.requiredTools) ? s.requiredTools : [],
        estimatedMinutes: typeof s.estimatedMinutes === "number" ? s.estimatedMinutes : 5,
        riskLevel: ["low", "medium", "high", "critical"].includes(s.riskLevel) ? s.riskLevel : "medium",
        dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
      }));
    } catch (err) {
      Logger.error("[AgentPlanner] JSON parse failed", err);
      return [];
    }
  }

  private assemblePlan(
    goal: string,
    rawSteps: ReturnType<AgentPlannerWithThinking["parseSteps"]>,
    version = 1
  ): HierarchicalPlan {
    // Assign stable IDs
    const steps: PlanStep[] = rawSteps.map((s) => ({
      id: randomUUID(),
      index: s.index,
      description: s.description,
      requiredTools: s.requiredTools,
      estimatedMinutes: s.estimatedMinutes,
      riskLevel: s.riskLevel,
      dependsOn: [], // resolved below
      status: "pending",
      retryCount: 0,
    }));

    // Resolve numeric dependsOn indices to step IDs
    for (let i = 0; i < steps.length; i++) {
      steps[i].dependsOn = rawSteps[i].dependsOn
        .filter((dep) => dep < steps.length && dep !== i)
        .map((dep) => steps[dep].id);
    }

    const totalMinutes = steps.reduce((sum, s) => sum + s.estimatedMinutes, 0);
    const riskPriority: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
    const maxRisk = steps.reduce(
      (max, s) => (riskPriority[s.riskLevel] > riskPriority[max] ? s.riskLevel : max),
      "low" as RiskLevel
    );

    return {
      id: randomUUID(),
      goal,
      summary: `${steps.length}-step plan`,
      steps,
      estimatedTotalMinutes: totalMinutes,
      overallRisk: maxRisk,
      createdAt: new Date(),
      version,
    };
  }
}
