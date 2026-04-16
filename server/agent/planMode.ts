import { llmGateway } from "../lib/llmGateway";
import crypto from "crypto";
import { createLogger } from "../utils/logger";

const log = createLogger("plan-mode");

// ===== Types =====

type PlanStatus = "pending" | "draft" | "approved" | "modified" | "rejected" | "executing" | "completed" | "failed";
type StepStatus = "pending" | "in_progress" | "running" | "completed" | "failed" | "skipped";

/** Alias for external consumers that use the spec naming */
export type PlanStepStatus = StepStatus;

interface PlanStep {
  id: string;
  index: number;
  title: string;
  description: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolsRequired?: string[];
  status: StepStatus;
  result?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

interface AgentPlan {
  id: string;
  chatId: string;
  userId: string;
  title: string;
  query: string;
  steps: PlanStep[];
  status: PlanStatus;
  createdAt: number;
  updatedAt: number;
  approvedAt?: number;
  completedAt?: number;
  estimatedDurationSec?: number;
  totalSteps: number;
  completedSteps: number;
  currentStepIndex: number;
}

interface PlanStepUpdate {
  type: "step_start" | "step_complete" | "step_failed" | "plan_complete";
  step: PlanStep;
  plan: AgentPlan;
}

export interface PlanGenerationOptions {
  userMessage: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  chatId: string;
  userId: string;
}

// ===== Plan Mode Service =====

class PlanModeService {
  private plans = new Map<string, AgentPlan>();

  /**
   * Uses LLM to decompose a user query into an executable plan of steps.
   * Supports both the legacy (positional args) and new (options object) signatures.
   */
  async generatePlan(
    queryOrOptions: string | PlanGenerationOptions,
    userId?: string,
    chatId?: string,
    availableTools?: string[],
  ): Promise<AgentPlan> {
    // Normalise arguments: support both old positional and new options-object call style
    let query: string;
    let resolvedUserId: string;
    let resolvedChatId: string;
    let resolvedTools: string[];
    let conversationHistory: Array<{ role: string; content: string }> | undefined;

    if (typeof queryOrOptions === "object") {
      query = queryOrOptions.userMessage;
      resolvedUserId = queryOrOptions.userId;
      resolvedChatId = queryOrOptions.chatId;
      resolvedTools = availableTools ?? [];
      conversationHistory = queryOrOptions.conversationHistory;
    } else {
      query = queryOrOptions;
      resolvedUserId = userId ?? "anonymous";
      resolvedChatId = chatId ?? "adhoc";
      resolvedTools = availableTools ?? [];
    }

    const systemPrompt = `You are a planning agent. Given the user's request, create a step-by-step execution plan.
Return JSON only – no markdown fences, no explanation outside the JSON object.
Schema: {"title": "...", "steps": [{"title": "...", "description": "...", "toolsRequired": ["web_search", "code_gen"]}], "estimatedDurationSec": N}
Keep plans concise (2-6 steps). Only include necessary steps.${resolvedTools.length > 0 ? `\nAvailable tools: ${resolvedTools.join(", ")}` : ""}`;

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    if (conversationHistory && conversationHistory.length > 0) {
      const recent = conversationHistory.slice(-6);
      for (const msg of recent) {
        messages.push({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      }
    }

    messages.push({ role: "user", content: query });

    log.info({ chatId: resolvedChatId, userId: resolvedUserId }, "Generating plan for user request");

    const response = await llmGateway.chat(messages, {
      temperature: 0.3,
      maxTokens: 2048,
      userId: resolvedUserId,
    });

    let parsed: {
      title?: string;
      steps: Array<{
        title?: string;
        description: string;
        toolName?: string;
        toolArgs?: Record<string, unknown>;
        toolsRequired?: string[];
      }>;
      estimatedDurationSec?: number;
    };
    try {
      // Strip markdown fences if the model wraps its output
      let raw = response.content.trim();
      if (raw.startsWith("```")) {
        raw = raw.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "").trim();
      }
      parsed = JSON.parse(raw);
    } catch {
      // Fallback: create a single-step plan when LLM output is not valid JSON
      parsed = {
        title: "Execution Plan",
        steps: [{ description: query }],
      };
    }

    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      parsed = { ...parsed, steps: [{ description: query }] };
    }

    const planId = `plan_${crypto.randomUUID()}`;
    const now = Date.now();

    const steps: PlanStep[] = parsed.steps.map((s, i) => ({
      id: `step_${crypto.randomUUID()}`,
      index: i,
      title: s.title || s.description.slice(0, 60),
      description: s.description,
      toolName: s.toolName,
      toolArgs: s.toolArgs,
      toolsRequired: s.toolsRequired,
      status: "pending" as StepStatus,
    }));

    const plan: AgentPlan = {
      id: planId,
      chatId: resolvedChatId,
      userId: resolvedUserId,
      title: parsed.title || "Execution Plan",
      query,
      steps,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      estimatedDurationSec: parsed.estimatedDurationSec,
      totalSteps: steps.length,
      completedSteps: 0,
      currentStepIndex: 0,
    };

    this.plans.set(planId, plan);
    log.info({ planId, stepCount: steps.length }, "Plan generated");
    return plan;
  }

  /**
   * Approve a plan for execution.
   */
  approvePlan(planId: string): AgentPlan | undefined {
    const plan = this.plans.get(planId);
    if (!plan) return undefined;
    if (plan.status !== "pending" && plan.status !== "draft" && plan.status !== "modified") {
      return plan; // already approved or in a terminal state
    }
    plan.status = "approved";
    plan.approvedAt = Date.now();
    plan.updatedAt = Date.now();
    log.info({ planId }, "Plan approved");
    return plan;
  }

  /**
   * Modify specific steps and approve the plan.
   */
  modifyPlan(
    planId: string,
    modifications: Array<{ stepIndex: number; newDescription: string }>,
  ): AgentPlan {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }
    if (plan.status !== "pending" && plan.status !== "draft" && plan.status !== "modified") {
      throw new Error(`Cannot modify plan in status: ${plan.status}`);
    }

    for (const mod of modifications) {
      if (mod.stepIndex < 0 || mod.stepIndex >= plan.steps.length) {
        throw new Error(`Invalid step index: ${mod.stepIndex}`);
      }
      plan.steps[mod.stepIndex].description = mod.newDescription;
    }

    plan.status = "approved";
    plan.updatedAt = Date.now();
    return plan;
  }

  /**
   * Reject a plan, preventing execution.
   */
  rejectPlan(planId: string): AgentPlan | undefined {
    const plan = this.plans.get(planId);
    if (!plan) return undefined;
    plan.status = "rejected";
    plan.updatedAt = Date.now();
    log.info({ planId }, "Plan rejected");
    return plan;
  }

  /**
   * Execute an approved plan step-by-step, yielding progress updates.
   */
  async *executePlan(planId: string): AsyncGenerator<PlanStepUpdate, void, unknown> {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }
    if (plan.status !== "approved") {
      throw new Error(`Plan must be approved before execution. Current status: ${plan.status}`);
    }

    plan.status = "executing";
    plan.updatedAt = Date.now();

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      plan.currentStepIndex = i;

      // Signal step start
      step.status = "in_progress";
      step.startedAt = Date.now();
      plan.updatedAt = Date.now();

      yield {
        type: "step_start",
        step: { ...step },
        plan: { ...plan, steps: plan.steps.map((s) => ({ ...s })) },
      };

      try {
        // Execute the step via LLM
        const stepPrompt = step.toolName
          ? `Execute step ${i + 1}: "${step.description}" using tool "${step.toolName}" with args: ${JSON.stringify(step.toolArgs ?? {})}. Provide a concise result.`
          : `Execute step ${i + 1}: "${step.description}". Provide a concise result.`;

        const result = await llmGateway.chat(
          [
            {
              role: "system",
              content: `You are executing step ${i + 1} of ${plan.totalSteps} in a plan to: "${plan.query}". Provide a concise, actionable result for this step.`,
            },
            { role: "user", content: stepPrompt },
          ],
          {
            temperature: 0.2,
            maxTokens: 1024,
            userId: plan.userId,
          },
        );

        step.status = "completed";
        step.result = result.content;
        step.completedAt = Date.now();
        step.durationMs = step.completedAt - (step.startedAt ?? step.completedAt);
        plan.completedSteps++;
        plan.updatedAt = Date.now();

        yield {
          type: "step_complete",
          step: { ...step },
          plan: { ...plan, steps: plan.steps.map((s) => ({ ...s })) },
        };
      } catch (err) {
        step.status = "failed";
        step.error = err instanceof Error ? err.message : String(err);
        step.completedAt = Date.now();
        plan.updatedAt = Date.now();

        yield {
          type: "step_failed",
          step: { ...step },
          plan: { ...plan, steps: plan.steps.map((s) => ({ ...s })) },
        };

        // Mark remaining steps as skipped
        for (let j = i + 1; j < plan.steps.length; j++) {
          plan.steps[j].status = "skipped";
        }

        plan.status = "failed";
        plan.updatedAt = Date.now();
        return;
      }
    }

    plan.status = "completed";
    plan.completedAt = Date.now();
    plan.updatedAt = Date.now();

    yield {
      type: "plan_complete",
      step: plan.steps[plan.steps.length - 1],
      plan: { ...plan, steps: plan.steps.map((s) => ({ ...s })) },
    };
  }

  /**
   * Retrieve a plan by ID.
   */
  getPlan(planId: string): AgentPlan | undefined {
    return this.plans.get(planId);
  }

  /**
   * Get all active (non-terminal) plans for a user.
   */
  getActivePlans(userId: string): AgentPlan[] {
    const active: AgentPlan[] = [];
    for (const plan of this.plans.values()) {
      if (
        plan.userId === userId &&
        plan.status !== "completed" &&
        plan.status !== "failed" &&
        plan.status !== "rejected"
      ) {
        active.push(plan);
      }
    }
    return active;
  }
}

export type { PlanStep, AgentPlan, PlanStepUpdate, PlanStatus, StepStatus };
export const planModeService = new PlanModeService();

// ---------------------------------------------------------------------------
// Convenience standalone functions (used by planRouter)
// ---------------------------------------------------------------------------

export async function generatePlan(options: PlanGenerationOptions): Promise<AgentPlan> {
  return planModeService.generatePlan(options);
}

export function approvePlan(planId: string): AgentPlan | undefined {
  return planModeService.approvePlan(planId);
}

export function rejectPlan(planId: string): AgentPlan | undefined {
  return planModeService.rejectPlan(planId);
}

export function getPlan(planId: string): AgentPlan | undefined {
  return planModeService.getPlan(planId);
}

export function executePlanAsync(planId: string): AsyncGenerator<PlanStepUpdate, void, unknown> {
  return planModeService.executePlan(planId);
}
