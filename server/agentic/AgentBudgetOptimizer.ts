/**
 * AgentBudgetOptimizer — Track token usage and cost per agent/tool/model,
 * dynamically select models, project remaining costs, and enforce budget limits.
 */

import Anthropic from "@anthropic-ai/sdk";
import { Logger } from "../lib/logger";
import { FAST_MODEL, REASONING_MODEL } from "./ClaudeAgentBackbone";

// ─── Types ─────────────────────────────────────────────────────────────────────
export type CostPreference = "quality-first" | "cost-first" | "balanced";
export type ModelTier = "fast" | "reasoning";

export interface TokenUsageRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  costUsd: number;
  timestamp: Date;
  tool?: string;
  stepDescription?: string;
}

export interface BudgetAllocation {
  stepId: string;
  stepDescription: string;
  allocatedUsd: number;
  model: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
}

export interface CostProjection {
  completedUsd: number;
  projectedRemainingUsd: number;
  projectedTotalUsd: number;
  confidence: number; // 0-1; how reliable this estimate is
  willExceedBudget: boolean;
  remainingBudgetUsd: number;
}

export interface BudgetAlert {
  level: "info" | "warning" | "critical";
  message: string;
  spentUsd: number;
  budgetUsd: number;
  percentUsed: number;
}

export interface ModelRecommendation {
  model: string;
  tier: ModelTier;
  reason: string;
  estimatedCostUsd: number;
}

export interface BudgetOptimizerConfig {
  sessionBudgetUsd: number;
  preference?: CostPreference;
  alertThresholds?: number[]; // e.g. [0.5, 0.8, 0.95]
  onAlert?: (alert: BudgetAlert) => void;
}

// ─── Model pricing (USD per million tokens) ────────────────────────────────────
const PRICING: Record<string, { input: number; output: number; thinking?: number }> = {
  [FAST_MODEL]: { input: 3.0, output: 15.0 },
  [REASONING_MODEL]: { input: 15.0, output: 75.0, thinking: 15.0 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4.0 },
};

function computeCost(model: string, inputTokens: number, outputTokens: number, thinkingTokens = 0): number {
  const pricing = PRICING[model] ?? PRICING[FAST_MODEL];
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output +
    (thinkingTokens / 1_000_000) * (pricing.thinking ?? pricing.input)
  );
}

// ─── AgentBudgetOptimizer ──────────────────────────────────────────────────────
export class AgentBudgetOptimizer {
  private readonly sessionBudgetUsd: number;
  private readonly preference: CostPreference;
  private readonly alertThresholds: number[];
  private readonly onAlert?: (alert: BudgetAlert) => void;

  private usageHistory: TokenUsageRecord[] = [];
  private totalSpentUsd = 0;
  private firedThresholds = new Set<number>();

  // Historical cost data per task type (populated over time)
  private taskCostHistory = new Map<string, number[]>();

  constructor(config: BudgetOptimizerConfig) {
    this.sessionBudgetUsd = config.sessionBudgetUsd;
    this.preference = config.preference ?? "balanced";
    this.alertThresholds = config.alertThresholds ?? [0.5, 0.8, 0.95];
    this.onAlert = config.onAlert;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /** Record token usage from an API response. */
  record(
    model: string,
    inputTokens: number,
    outputTokens: number,
    thinkingTokens = 0,
    context?: { tool?: string; stepDescription?: string }
  ): TokenUsageRecord {
    const costUsd = computeCost(model, inputTokens, outputTokens, thinkingTokens);
    const record: TokenUsageRecord = {
      model,
      inputTokens,
      outputTokens,
      thinkingTokens,
      costUsd,
      timestamp: new Date(),
      ...context,
    };

    this.usageHistory.push(record);
    this.totalSpentUsd += costUsd;

    Logger.debug("[BudgetOptimizer] Usage recorded", {
      model,
      tokens: { inputTokens, outputTokens, thinkingTokens },
      costUsd: costUsd.toFixed(6),
      totalSpent: this.totalSpentUsd.toFixed(6),
    });

    this.checkAlerts();
    return record;
  }

  /** Recommend a model for the next step based on complexity and budget. */
  recommendModel(
    stepDescription: string,
    estimatedComplexity: "simple" | "moderate" | "complex",
    remainingSteps: number
  ): ModelRecommendation {
    const remainingBudgetUsd = this.remainingBudget();
    const budgetPerStep = remainingSteps > 0 ? remainingBudgetUsd / remainingSteps : remainingBudgetUsd;

    // Cost estimates per step (rough averages)
    const fastCostPerStep = 0.005; // ~1500 input + 500 output tokens
    const reasoningCostPerStep = 0.03; // same tokens but higher rate

    // Decision matrix
    if (this.preference === "cost-first") {
      return {
        model: FAST_MODEL,
        tier: "fast",
        reason: "Cost-first preference: always use fast model",
        estimatedCostUsd: fastCostPerStep,
      };
    }

    if (this.preference === "quality-first" && estimatedComplexity === "complex") {
      if (remainingBudgetUsd >= reasoningCostPerStep * 2) {
        return {
          model: REASONING_MODEL,
          tier: "reasoning",
          reason: "Quality-first preference with complex step",
          estimatedCostUsd: reasoningCostPerStep,
        };
      }
    }

    // Balanced: use reasoning only for complex steps with sufficient budget
    if (estimatedComplexity === "complex" && budgetPerStep >= reasoningCostPerStep * 1.5) {
      return {
        model: REASONING_MODEL,
        tier: "reasoning",
        reason: `Complex step with sufficient per-step budget ($${budgetPerStep.toFixed(4)})`,
        estimatedCostUsd: reasoningCostPerStep,
      };
    }

    return {
      model: FAST_MODEL,
      tier: "fast",
      reason:
        estimatedComplexity !== "complex"
          ? "Non-complex step: fast model is sufficient"
          : `Budget constraint: per-step budget $${budgetPerStep.toFixed(4)} favours fast model`,
      estimatedCostUsd: fastCostPerStep,
    };
  }

  /** Allocate budget across planned steps. */
  allocateBudget(
    steps: Array<{ id: string; description: string; estimatedMinutes: number; riskLevel: string }>
  ): BudgetAllocation[] {
    if (steps.length === 0) return [];

    const totalWeight = steps.reduce((sum, s) => sum + this.stepWeight(s), 0);
    const remainingBudget = this.remainingBudget();

    return steps.map((step) => {
      const weight = this.stepWeight(step);
      const allocatedUsd = (weight / totalWeight) * remainingBudget;
      const isHighRisk = step.riskLevel === "high" || step.riskLevel === "critical";
      const model =
        isHighRisk && allocatedUsd >= 0.02 ? REASONING_MODEL : FAST_MODEL;

      return {
        stepId: step.id,
        stepDescription: step.description,
        allocatedUsd,
        model,
        estimatedInputTokens: Math.round((allocatedUsd * 1_000_000) / (PRICING[model]?.input ?? 3) * 0.7),
        estimatedOutputTokens: Math.round((allocatedUsd * 1_000_000) / (PRICING[model]?.output ?? 15) * 0.3),
      };
    });
  }

  /** Project remaining cost for N remaining steps. */
  project(remainingSteps: number): CostProjection {
    const avgCostPerStep = this.averageCostPerStep();
    const projectedRemainingUsd = avgCostPerStep * remainingSteps;
    const projectedTotalUsd = this.totalSpentUsd + projectedRemainingUsd;
    const remainingBudgetUsd = this.remainingBudget();
    const confidence = this.usageHistory.length >= 3 ? 0.75 : 0.4;

    return {
      completedUsd: this.totalSpentUsd,
      projectedRemainingUsd,
      projectedTotalUsd,
      confidence,
      willExceedBudget: projectedTotalUsd > this.sessionBudgetUsd,
      remainingBudgetUsd,
    };
  }

  /** Get cumulative cost summary by model. */
  costByModel(): Record<string, { tokens: number; costUsd: number }> {
    const summary: Record<string, { tokens: number; costUsd: number }> = {};
    for (const r of this.usageHistory) {
      if (!summary[r.model]) summary[r.model] = { tokens: 0, costUsd: 0 };
      summary[r.model].tokens += r.inputTokens + r.outputTokens + r.thinkingTokens;
      summary[r.model].costUsd += r.costUsd;
    }
    return summary;
  }

  /** Get cumulative cost summary by tool. */
  costByTool(): Record<string, { calls: number; costUsd: number }> {
    const summary: Record<string, { calls: number; costUsd: number }> = {};
    for (const r of this.usageHistory) {
      const key = r.tool ?? "no_tool";
      if (!summary[key]) summary[key] = { calls: 0, costUsd: 0 };
      summary[key].calls++;
      summary[key].costUsd += r.costUsd;
    }
    return summary;
  }

  /** Compute the estimated cost for a given number of tokens and model. */
  static estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    return computeCost(model, inputTokens, outputTokens);
  }

  remainingBudget(): number {
    return Math.max(0, this.sessionBudgetUsd - this.totalSpentUsd);
  }

  totalSpent(): number {
    return this.totalSpentUsd;
  }

  budgetExhausted(): boolean {
    return this.totalSpentUsd >= this.sessionBudgetUsd;
  }

  /** Store historical cost for a task type. */
  recordTaskCost(taskType: string, costUsd: number): void {
    const history = this.taskCostHistory.get(taskType) ?? [];
    history.push(costUsd);
    // Keep last 20 entries
    if (history.length > 20) history.shift();
    this.taskCostHistory.set(taskType, history);
  }

  /** Look up historical average cost for a task type. */
  historicalAverageCost(taskType: string): number | null {
    const history = this.taskCostHistory.get(taskType);
    if (!history || history.length === 0) return null;
    return history.reduce((a, b) => a + b, 0) / history.length;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private checkAlerts(): void {
    const pct = this.totalSpentUsd / this.sessionBudgetUsd;
    for (const threshold of this.alertThresholds) {
      if (pct >= threshold && !this.firedThresholds.has(threshold)) {
        this.firedThresholds.add(threshold);
        const alert: BudgetAlert = {
          level: threshold >= 0.95 ? "critical" : threshold >= 0.8 ? "warning" : "info",
          message: `Budget ${(threshold * 100).toFixed(0)}% used ($${this.totalSpentUsd.toFixed(4)} of $${this.sessionBudgetUsd})`,
          spentUsd: this.totalSpentUsd,
          budgetUsd: this.sessionBudgetUsd,
          percentUsed: pct * 100,
        };
        Logger.warn("[BudgetOptimizer] Budget alert", alert);
        this.onAlert?.(alert);
      }
    }
  }

  private averageCostPerStep(): number {
    if (this.usageHistory.length === 0) return 0.005; // default estimate
    const total = this.usageHistory.reduce((sum, r) => sum + r.costUsd, 0);
    return total / this.usageHistory.length;
  }

  private stepWeight(step: { estimatedMinutes: number; riskLevel: string }): number {
    const riskMultiplier: Record<string, number> = { low: 1, medium: 1.5, high: 2, critical: 3 };
    return step.estimatedMinutes * (riskMultiplier[step.riskLevel] ?? 1);
  }
}
