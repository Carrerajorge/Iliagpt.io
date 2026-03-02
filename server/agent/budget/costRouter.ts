import { budgetEventStream } from "./budgetEventStream";

export interface ProviderCostProfile {
  id: string;
  provider: string;
  costPer1kInput: number;
  costPer1kOutput: number;
  qualityScore: number;
  latencyMs: number;
  available: boolean;
}

export interface CostRouteResult {
  modelId: string;
  reason: string;
  estimatedCostPer1kTokens: number;
  qualityScore: number;
}

export interface SubTaskBudget {
  taskId: string;
  allocatedUsd: number;
  usedUsd: number;
  remainingUsd: number;
}

const PROVIDER_PROFILES: Record<string, ProviderCostProfile> = {
  "minimax/minimax-m2.5": {
    id: "minimax/minimax-m2.5",
    provider: "openrouter",
    costPer1kInput: 0.0001,
    costPer1kOutput: 0.0003,
    qualityScore: 0.7,
    latencyMs: 800,
    available: true,
  },
  "openai/gpt-4o-mini": {
    id: "openai/gpt-4o-mini",
    provider: "openrouter",
    costPer1kInput: 0.00015,
    costPer1kOutput: 0.0006,
    qualityScore: 0.8,
    latencyMs: 1200,
    available: true,
  },
  "deepseek/deepseek-chat": {
    id: "deepseek/deepseek-chat",
    provider: "openrouter",
    costPer1kInput: 0.00014,
    costPer1kOutput: 0.00028,
    qualityScore: 0.78,
    latencyMs: 1000,
    available: true,
  },
  "google/gemini-2.5-flash": {
    id: "google/gemini-2.5-flash",
    provider: "openrouter",
    costPer1kInput: 0.00015,
    costPer1kOutput: 0.0006,
    qualityScore: 0.82,
    latencyMs: 900,
    available: true,
  },
  "openai/gpt-4o": {
    id: "openai/gpt-4o",
    provider: "openrouter",
    costPer1kInput: 0.0025,
    costPer1kOutput: 0.01,
    qualityScore: 0.95,
    latencyMs: 2000,
    available: true,
  },
  "anthropic/claude-3.5-sonnet": {
    id: "anthropic/claude-3.5-sonnet",
    provider: "openrouter",
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
    qualityScore: 0.96,
    latencyMs: 2500,
    available: true,
  },
};

export class CostAwareRouter {
  private realTimeCosts: Map<string, { totalCost: number; calls: number; lastUpdated: number }> = new Map();
  private subTaskBudgets: Map<string, SubTaskBudget> = new Map();
  private globalBudgetUsd: number;
  private globalUsedUsd = 0;

  constructor(globalBudgetUsd?: number) {
    this.globalBudgetUsd = globalBudgetUsd ?? parseFloat(process.env.AGENT_COST_CEILING_USD || "10.00");
  }

  route(minQuality: number = 0.7): CostRouteResult {
    const eligible = Object.values(PROVIDER_PROFILES).filter(
      (p) => p.available && p.qualityScore >= minQuality
    );

    if (eligible.length === 0) {
      return {
        modelId: "minimax/minimax-m2.5",
        reason: "no_eligible_providers",
        estimatedCostPer1kTokens: 0.0002,
        qualityScore: 0.7,
      };
    }

    eligible.sort((a, b) => {
      const costA = (a.costPer1kInput + a.costPer1kOutput) / 2;
      const costB = (b.costPer1kInput + b.costPer1kOutput) / 2;
      return costA - costB;
    });

    const budgetPct = this.globalUsedUsd / this.globalBudgetUsd;

    let selected: ProviderCostProfile;
    if (budgetPct > 0.9) {
      selected = eligible[0];
      return {
        modelId: selected.id,
        reason: "budget_critical_cheapest",
        estimatedCostPer1kTokens: (selected.costPer1kInput + selected.costPer1kOutput) / 2,
        qualityScore: selected.qualityScore,
      };
    }

    if (budgetPct > 0.7) {
      selected = eligible[0];
      return {
        modelId: selected.id,
        reason: "budget_conservative",
        estimatedCostPer1kTokens: (selected.costPer1kInput + selected.costPer1kOutput) / 2,
        qualityScore: selected.qualityScore,
      };
    }

    const bestQuality = eligible.reduce((best, cur) => (cur.qualityScore > best.qualityScore ? cur : best), eligible[0]);
    selected = bestQuality;
    return {
      modelId: selected.id,
      reason: "budget_ok_best_quality",
      estimatedCostPer1kTokens: (selected.costPer1kInput + selected.costPer1kOutput) / 2,
      qualityScore: selected.qualityScore,
    };
  }

  routeForTask(taskId: string, minQuality: number = 0.7): CostRouteResult {
    const budget = this.subTaskBudgets.get(taskId);
    if (budget && budget.remainingUsd <= 0) {
      const cheapest = Object.values(PROVIDER_PROFILES)
        .filter((p) => p.available)
        .sort((a, b) => (a.costPer1kInput + a.costPer1kOutput) - (b.costPer1kInput + b.costPer1kOutput))[0];
      return {
        modelId: cheapest?.id || "minimax/minimax-m2.5",
        reason: "subtask_budget_exhausted",
        estimatedCostPer1kTokens: cheapest ? (cheapest.costPer1kInput + cheapest.costPer1kOutput) / 2 : 0.0002,
        qualityScore: cheapest?.qualityScore || 0.7,
      };
    }
    return this.route(minQuality);
  }

  trackCost(modelId: string, inputTokens: number, outputTokens: number, taskId?: string): number {
    const profile = PROVIDER_PROFILES[modelId];
    const cost = profile
      ? (inputTokens / 1000) * profile.costPer1kInput + (outputTokens / 1000) * profile.costPer1kOutput
      : (inputTokens + outputTokens) * 0.000001;

    this.globalUsedUsd += cost;

    const existing = this.realTimeCosts.get(modelId) || { totalCost: 0, calls: 0, lastUpdated: 0 };
    existing.totalCost += cost;
    existing.calls++;
    existing.lastUpdated = Date.now();
    this.realTimeCosts.set(modelId, existing);

    const provider = profile?.provider || modelId.split("/")[0];
    budgetEventStream.trackProviderCost(provider, cost);

    if (taskId) {
      const budget = this.subTaskBudgets.get(taskId);
      if (budget) {
        budget.usedUsd += cost;
        budget.remainingUsd = Math.max(0, budget.allocatedUsd - budget.usedUsd);
      }
    }

    const budgetPct = this.globalUsedUsd / this.globalBudgetUsd;
    if (budgetPct >= 1.0) {
      budgetEventStream.emitBudgetStop("global", "Global budget exceeded", this.globalUsedUsd);
    } else if (budgetPct >= 0.8) {
      budgetEventStream.emitBudgetWarn80("global", (1 - budgetPct) * 100, this.globalUsedUsd);
    }

    return cost;
  }

  allocateSubTaskBudget(taskId: string, amountUsd: number): SubTaskBudget {
    const budget: SubTaskBudget = {
      taskId,
      allocatedUsd: amountUsd,
      usedUsd: 0,
      remainingUsd: amountUsd,
    };
    this.subTaskBudgets.set(taskId, budget);
    return budget;
  }

  getSubTaskBudget(taskId: string): SubTaskBudget | undefined {
    return this.subTaskBudgets.get(taskId);
  }

  setProviderAvailability(modelId: string, available: boolean): void {
    if (PROVIDER_PROFILES[modelId]) {
      PROVIDER_PROFILES[modelId].available = available;
    }
  }

  getCostSummary(): {
    globalBudgetUsd: number;
    globalUsedUsd: number;
    globalRemainingUsd: number;
    globalUsedPct: number;
    perProvider: Record<string, { totalCost: number; calls: number }>;
    subTaskBudgets: SubTaskBudget[];
  } {
    const perProvider: Record<string, { totalCost: number; calls: number }> = {};
    for (const [modelId, data] of this.realTimeCosts) {
      perProvider[modelId] = { totalCost: data.totalCost, calls: data.calls };
    }

    return {
      globalBudgetUsd: this.globalBudgetUsd,
      globalUsedUsd: this.globalUsedUsd,
      globalRemainingUsd: Math.max(0, this.globalBudgetUsd - this.globalUsedUsd),
      globalUsedPct: (this.globalUsedUsd / this.globalBudgetUsd) * 100,
      perProvider,
      subTaskBudgets: Array.from(this.subTaskBudgets.values()),
    };
  }

  getProviderProfiles(): Record<string, ProviderCostProfile> {
    return { ...PROVIDER_PROFILES };
  }

  resetCosts(): void {
    this.realTimeCosts.clear();
    this.globalUsedUsd = 0;
    this.subTaskBudgets.clear();
  }

  isBudgetExceeded(): boolean {
    return this.globalUsedUsd >= this.globalBudgetUsd;
  }
}

export const costRouter = new CostAwareRouter();
