/**
 * CostCalculator — Real-time cost calculation, budget tracking, and usage projection
 */

import type { IModelInfo } from "../providers/core/types.js";
import type { IBudgetConfig, IBudgetStatus } from "./types.js";

// ─────────────────────────────────────────────
// In-memory usage store (production would use Redis/DB)
// ─────────────────────────────────────────────

interface UsageEntry {
  timestamp: Date;
  cost: number;
  promptTokens: number;
  completionTokens: number;
  model: string;
  provider: string;
  userId?: string;
}

// ─────────────────────────────────────────────
// CostCalculator
// ─────────────────────────────────────────────

export class CostCalculator {
  private readonly usageLog: UsageEntry[] = [];
  private readonly MAX_LOG_SIZE = 10_000;

  /**
   * Calculate exact cost for a completed request
   */
  calculate(
    model: IModelInfo,
    promptTokens: number,
    completionTokens: number,
    cachedTokens = 0,
  ): number {
    const p = model.pricing;
    const effectivePromptTokens = Math.max(0, promptTokens - cachedTokens);

    const inputCost = (effectivePromptTokens / 1_000_000) * p.inputPerMillion;
    const cachedCost = p.cachedInputPerMillion
      ? (cachedTokens / 1_000_000) * p.cachedInputPerMillion
      : (cachedTokens / 1_000_000) * (p.inputPerMillion * 0.1); // default 90% discount
    const outputCost = (completionTokens / 1_000_000) * p.outputPerMillion;

    return inputCost + cachedCost + outputCost;
  }

  /**
   * Estimate cost before making a request (using approximate token counts)
   */
  estimate(
    model: IModelInfo,
    estimatedPromptTokens: number,
    estimatedCompletionTokens: number,
  ): { min: number; max: number; expected: number } {
    const expected = this.calculate(model, estimatedPromptTokens, estimatedCompletionTokens);
    // ±30% range for estimates
    return {
      min: expected * 0.7,
      max: expected * 1.3,
      expected,
    };
  }

  /**
   * Compare cost across models for the same workload
   */
  compare(
    models: IModelInfo[],
    estimatedPromptTokens: number,
    estimatedCompletionTokens: number,
  ): Array<{ model: IModelInfo; cost: number; costPerToken: number }> {
    return models
      .map((model) => {
        const cost = this.calculate(model, estimatedPromptTokens, estimatedCompletionTokens);
        const totalTokens = estimatedPromptTokens + estimatedCompletionTokens;
        return {
          model,
          cost,
          costPerToken: totalTokens > 0 ? cost / totalTokens : 0,
        };
      })
      .sort((a, b) => a.cost - b.cost);
  }

  /**
   * Record a completed request for budget tracking
   */
  record(entry: Omit<UsageEntry, "timestamp">): void {
    this.usageLog.push({ ...entry, timestamp: new Date() });
    // Evict old entries to prevent memory leak
    if (this.usageLog.length > this.MAX_LOG_SIZE) {
      this.usageLog.splice(0, Math.floor(this.MAX_LOG_SIZE * 0.1));
    }
  }

  /**
   * Get budget status for a user/org
   */
  getBudgetStatus(config: IBudgetConfig): IBudgetStatus {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const userEntries = this.usageLog.filter((e) => {
      if (config.userId && e.userId !== config.userId) return false;
      return true;
    });

    const dailySpent = userEntries
      .filter((e) => e.timestamp >= startOfDay)
      .reduce((sum, e) => sum + e.cost, 0);

    const monthlySpent = userEntries
      .filter((e) => e.timestamp >= startOfMonth)
      .reduce((sum, e) => sum + e.cost, 0);

    const dailyRemaining = config.dailyLimitUsd !== undefined
      ? Math.max(0, config.dailyLimitUsd - dailySpent)
      : undefined;

    const monthlyRemaining = config.monthlyLimitUsd !== undefined
      ? Math.max(0, config.monthlyLimitUsd - monthlySpent)
      : undefined;

    const isExceeded = (dailyRemaining !== undefined && dailyRemaining <= 0) ||
      (monthlyRemaining !== undefined && monthlyRemaining <= 0);

    return { dailySpent, monthlySpent, dailyRemaining, monthlyRemaining, isExceeded };
  }

  /**
   * Check if a request would exceed budget limits
   */
  wouldExceedBudget(
    estimatedCost: number,
    config: IBudgetConfig,
  ): { exceeds: boolean; reason?: string } {
    if (config.perRequestLimitUsd !== undefined && estimatedCost > config.perRequestLimitUsd) {
      return {
        exceeds: true,
        reason: `Estimated cost $${estimatedCost.toFixed(4)} exceeds per-request limit $${config.perRequestLimitUsd.toFixed(4)}`,
      };
    }

    const status = this.getBudgetStatus(config);

    if (status.dailyRemaining !== undefined && estimatedCost > status.dailyRemaining) {
      return {
        exceeds: true,
        reason: `Estimated cost $${estimatedCost.toFixed(4)} would exceed daily budget (remaining: $${status.dailyRemaining.toFixed(4)})`,
      };
    }

    if (status.monthlyRemaining !== undefined && estimatedCost > status.monthlyRemaining) {
      return {
        exceeds: true,
        reason: `Estimated cost $${estimatedCost.toFixed(4)} would exceed monthly budget (remaining: $${status.monthlyRemaining.toFixed(4)})`,
      };
    }

    return { exceeds: false };
  }

  /**
   * Project monthly spend based on current daily average
   */
  projectMonthlySpend(userId?: string): number {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysElapsed = Math.max(1, (now.getTime() - startOfMonth.getTime()) / (1000 * 60 * 60 * 24));

    const monthlyEntries = this.usageLog.filter((e) => {
      if (userId && e.userId !== userId) return false;
      return e.timestamp >= startOfMonth;
    });

    const monthlySpend = monthlyEntries.reduce((sum, e) => sum + e.cost, 0);
    const dailyAverage = monthlySpend / daysElapsed;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    return dailyAverage * daysInMonth;
  }

  /**
   * Get cost breakdown by provider and model
   */
  getBreakdown(
    since: Date,
    userId?: string,
  ): {
    total: number;
    byProvider: Record<string, number>;
    byModel: Record<string, number>;
    requestCount: number;
    avgCostPerRequest: number;
    totalTokens: number;
  } {
    const entries = this.usageLog.filter((e) => {
      if (userId && e.userId !== userId) return false;
      return e.timestamp >= since;
    });

    const byProvider: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    let totalCost = 0;
    let totalTokens = 0;

    for (const entry of entries) {
      byProvider[entry.provider] = (byProvider[entry.provider] ?? 0) + entry.cost;
      byModel[entry.model] = (byModel[entry.model] ?? 0) + entry.cost;
      totalCost += entry.cost;
      totalTokens += entry.promptTokens + entry.completionTokens;
    }

    return {
      total: totalCost,
      byProvider,
      byModel,
      requestCount: entries.length,
      avgCostPerRequest: entries.length > 0 ? totalCost / entries.length : 0,
      totalTokens,
    };
  }

  /**
   * Find cheapest model capable of a given workload
   */
  findCheapestModel(
    models: IModelInfo[],
    estimatedPromptTokens: number,
    estimatedCompletionTokens: number,
    maxCostUsd?: number,
  ): IModelInfo | undefined {
    const compared = this.compare(models, estimatedPromptTokens, estimatedCompletionTokens);
    const eligible = maxCostUsd !== undefined
      ? compared.filter((c) => c.cost <= maxCostUsd)
      : compared;
    return eligible[0]?.model;
  }
}

// Singleton instance
export const costCalculator = new CostCalculator();
