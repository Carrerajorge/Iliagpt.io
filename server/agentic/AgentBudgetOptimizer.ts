import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";
import { CLAUDE_MODELS } from "./ClaudeAgentBackbone.js";

const logger = pino({ name: "AgentBudgetOptimizer" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type ModelTier = "haiku" | "sonnet" | "opus";

export type TaskComplexity = "trivial" | "low" | "medium" | "high" | "critical";

export interface ModelCost {
  modelId: string;
  tier: ModelTier;
  inputCostPer1M: number;  // USD
  outputCostPer1M: number; // USD
}

export interface TokenUsageRecord {
  recordId: string;
  agentId: string;
  sessionId: string;
  modelId: string;
  tier: ModelTier;
  taskType: string;
  complexity: TaskComplexity;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  costUSD: number;
  success: boolean;
  qualityScore?: number; // 0-1 if available
  durationMs: number;
  timestamp: number;
}

export interface BudgetAllocation {
  agentId: string;
  sessionId?: string;
  totalBudgetUSD: number;
  spentUSD: number;
  remainingUSD: number;
  alertThreshold: number; // 0-1 (e.g. 0.8 = alert at 80%)
  hardLimitUSD?: number; // if set, refuse calls over this
  allocatedAt: number;
  expiresAt?: number;
}

export interface ModelSuggestion {
  recommendedModel: string;
  recommendedTier: ModelTier;
  reasoning: string;
  estimatedCostUSD: number;
  estimatedTokens: number;
  confidenceScore: number; // 0-1
  alternativeModel?: string;
  alternativeCostUSD?: number;
}

export interface BudgetReport {
  agentId?: string;
  sessionId?: string;
  period: { from: number; to: number };
  totalCostUSD: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalThinkingTokens: number;
  callCount: number;
  costByModel: Record<string, { costUSD: number; calls: number; tokens: number }>;
  costByTaskType: Record<string, { costUSD: number; calls: number }>;
  costByComplexity: Record<TaskComplexity, { costUSD: number; calls: number }>;
  avgCostPerCall: number;
  projectedMonthlyUSD: number;
  topExpensiveSessions: Array<{ sessionId: string; costUSD: number }>;
  savingsOpportunities: string[];
}

export interface OptimizerConfig {
  /** Default model selection strategy */
  strategy?: "cost_optimized" | "quality_first" | "balanced"; // default balanced
  /** Below this complexity, always try Haiku first */
  haikusForComplexityBelow?: TaskComplexity; // default "medium"
  /** Success rate threshold — if a cheaper model meets this, stick with it */
  minSuccessRate?: number; // default 0.85
  /** Quality threshold — if a model's quality is above this, downgrade is acceptable */
  qualityThreshold?: number; // default 0.75
  /** Max tokens to track in memory (auto-purge older) */
  maxRecordsInMemory?: number; // default 10_000
}

// ─── Model cost table ─────────────────────────────────────────────────────────

const MODEL_COSTS: Record<ModelTier, ModelCost> = {
  haiku: {
    modelId: CLAUDE_MODELS.HAIKU,
    tier: "haiku",
    inputCostPer1M: 0.8,
    outputCostPer1M: 4.0,
  },
  sonnet: {
    modelId: CLAUDE_MODELS.SONNET,
    tier: "sonnet",
    inputCostPer1M: 3.0,
    outputCostPer1M: 15.0,
  },
  opus: {
    modelId: CLAUDE_MODELS.OPUS,
    tier: "opus",
    inputCostPer1M: 15.0,
    outputCostPer1M: 75.0,
  },
};

function computeCost(
  tier: ModelTier,
  inputTokens: number,
  outputTokens: number,
  thinkingTokens = 0
): number {
  const cost = MODEL_COSTS[tier];
  return (
    (inputTokens / 1_000_000) * cost.inputCostPer1M +
    (outputTokens / 1_000_000) * cost.outputCostPer1M +
    (thinkingTokens / 1_000_000) * cost.inputCostPer1M // thinking billed as input
  );
}

function modelToTier(modelId: string): ModelTier {
  if (modelId.includes("haiku")) return "haiku";
  if (modelId.includes("opus")) return "opus";
  return "sonnet";
}

// ─── AgentBudgetOptimizer ─────────────────────────────────────────────────────

export class AgentBudgetOptimizer extends EventEmitter {
  private records: TokenUsageRecord[] = [];
  private budgets = new Map<string, BudgetAllocation>(); // agentId → allocation
  private modelPerformance = new Map<
    string, // `${tier}:${taskType}`
    { successCount: number; totalCount: number; totalQuality: number }
  >();

  constructor(private readonly config: OptimizerConfig = {}) {
    super();
    const {
      strategy = "balanced",
      haikusForComplexityBelow = "medium",
      minSuccessRate = 0.85,
      qualityThreshold = 0.75,
      maxRecordsInMemory = 10_000,
    } = config;

    this.config = {
      strategy,
      haikusForComplexityBelow,
      minSuccessRate,
      qualityThreshold,
      maxRecordsInMemory,
    };

    logger.info({ strategy }, "[AgentBudgetOptimizer] Initialized");
  }

  // ── Usage recording ───────────────────────────────────────────────────────────

  recordUsage(
    usage: Omit<TokenUsageRecord, "recordId" | "timestamp" | "costUSD" | "tier">
  ): TokenUsageRecord {
    const tier = modelToTier(usage.modelId);
    const costUSD = computeCost(
      tier,
      usage.inputTokens,
      usage.outputTokens,
      usage.thinkingTokens
    );

    const record: TokenUsageRecord = {
      ...usage,
      recordId: randomUUID(),
      tier,
      costUSD,
      timestamp: Date.now(),
    };

    this.records.push(record);

    // Trim memory
    const maxRecords = this.config.maxRecordsInMemory ?? 10_000;
    if (this.records.length > maxRecords) {
      this.records = this.records.slice(-maxRecords);
    }

    // Update model performance stats
    const key = `${tier}:${usage.taskType}`;
    const perf = this.modelPerformance.get(key) ?? {
      successCount: 0,
      totalCount: 0,
      totalQuality: 0,
    };
    perf.totalCount++;
    if (usage.success) perf.successCount++;
    if (usage.qualityScore !== undefined) perf.totalQuality += usage.qualityScore;
    this.modelPerformance.set(key, perf);

    // Check budget
    this.checkBudgetAlert(usage.agentId, costUSD);

    logger.debug(
      {
        agentId: usage.agentId,
        model: tier,
        costUSD: costUSD.toFixed(6),
        taskType: usage.taskType,
      },
      "[AgentBudgetOptimizer] Usage recorded"
    );

    this.emit("usage:recorded", record);
    return record;
  }

  // ── Model suggestion ──────────────────────────────────────────────────────────

  suggestModel(
    taskType: string,
    complexity: TaskComplexity,
    agentId?: string,
    estimatedTokens = 1000
  ): ModelSuggestion {
    const strategy = this.config.strategy ?? "balanced";
    const complexityOrder: TaskComplexity[] = [
      "trivial",
      "low",
      "medium",
      "high",
      "critical",
    ];
    const complexityIndex = complexityOrder.indexOf(complexity);
    const thresholdIndex = complexityOrder.indexOf(
      this.config.haikusForComplexityBelow ?? "medium"
    );

    // Budget constraint check
    const budget = agentId ? this.budgets.get(agentId) : null;
    const budgetConstrained =
      budget &&
      budget.hardLimitUSD !== undefined &&
      budget.spentUSD >= budget.hardLimitUSD;

    if (budgetConstrained) {
      return {
        recommendedModel: CLAUDE_MODELS.HAIKU,
        recommendedTier: "haiku",
        reasoning: "Budget limit reached — forced to cheapest model",
        estimatedCostUSD: computeCost("haiku", estimatedTokens, estimatedTokens / 2),
        estimatedTokens,
        confidenceScore: 1.0,
      };
    }

    let tier: ModelTier;

    if (strategy === "cost_optimized") {
      // Always start with Haiku unless proven insufficient
      const haikuPerf = this.getModelPerf("haiku", taskType);
      const minRate = this.config.minSuccessRate ?? 0.85;
      if (haikuPerf.successRate >= minRate || haikuPerf.sampleSize < 5) {
        tier = "haiku";
      } else {
        const sonnetPerf = this.getModelPerf("sonnet", taskType);
        tier = sonnetPerf.successRate >= minRate ? "sonnet" : "opus";
      }
    } else if (strategy === "quality_first") {
      tier = complexity === "critical" || complexity === "high" ? "opus" : "sonnet";
    } else {
      // Balanced — use complexity + observed performance
      if (complexityIndex < thresholdIndex) {
        const haikuPerf = this.getModelPerf("haiku", taskType);
        const minRate = this.config.minSuccessRate ?? 0.85;
        tier =
          haikuPerf.successRate >= minRate || haikuPerf.sampleSize < 5
            ? "haiku"
            : "sonnet";
      } else if (complexity === "critical") {
        tier = "opus";
      } else if (complexity === "high") {
        // Use Sonnet unless Sonnet has been failing
        const sonnetPerf = this.getModelPerf("sonnet", taskType);
        tier =
          sonnetPerf.successRate < (this.config.minSuccessRate ?? 0.85) &&
          sonnetPerf.sampleSize > 5
            ? "opus"
            : "sonnet";
      } else {
        tier = "sonnet";
      }
    }

    const estimatedOutputTokens = Math.round(estimatedTokens * 0.4);
    const estimatedCostUSD = computeCost(tier, estimatedTokens, estimatedOutputTokens);

    // Suggest cheaper alternative if appropriate
    const cheaperTier = tier === "opus" ? "sonnet" : tier === "sonnet" ? "haiku" : null;
    const altCostUSD = cheaperTier
      ? computeCost(cheaperTier, estimatedTokens, estimatedOutputTokens)
      : undefined;

    const perf = this.getModelPerf(tier, taskType);

    return {
      recommendedModel: MODEL_COSTS[tier].modelId,
      recommendedTier: tier,
      reasoning: this.buildReasoning(tier, taskType, complexity, perf, strategy),
      estimatedCostUSD,
      estimatedTokens,
      confidenceScore: perf.sampleSize > 5 ? 0.9 : 0.6,
      alternativeModel: cheaperTier ? MODEL_COSTS[cheaperTier].modelId : undefined,
      alternativeCostUSD: altCostUSD,
    };
  }

  private getModelPerf(
    tier: ModelTier,
    taskType: string
  ): { successRate: number; avgQuality: number; sampleSize: number } {
    const key = `${tier}:${taskType}`;
    const perf = this.modelPerformance.get(key);
    if (!perf || perf.totalCount === 0) {
      return { successRate: 1.0, avgQuality: 0.8, sampleSize: 0 };
    }
    return {
      successRate: perf.successCount / perf.totalCount,
      avgQuality:
        perf.totalCount > 0 ? perf.totalQuality / perf.totalCount : 0.8,
      sampleSize: perf.totalCount,
    };
  }

  private buildReasoning(
    tier: ModelTier,
    taskType: string,
    complexity: TaskComplexity,
    perf: ReturnType<AgentBudgetOptimizer["getModelPerf"]>,
    strategy: string
  ): string {
    const parts: string[] = [`Strategy: ${strategy}`];
    parts.push(`Complexity: ${complexity}`);
    if (perf.sampleSize > 0) {
      parts.push(
        `${tier} has ${(perf.successRate * 100).toFixed(0)}% success on '${taskType}' (${perf.sampleSize} samples)`
      );
    } else {
      parts.push(`No performance data for '${taskType}' — using complexity-based selection`);
    }
    return parts.join("; ");
  }

  // ── Budget management ─────────────────────────────────────────────────────────

  setBudget(
    agentId: string,
    totalBudgetUSD: number,
    opts: {
      sessionId?: string;
      alertThreshold?: number;
      hardLimitUSD?: number;
      expiresInMs?: number;
    } = {}
  ): BudgetAllocation {
    const allocation: BudgetAllocation = {
      agentId,
      sessionId: opts.sessionId,
      totalBudgetUSD,
      spentUSD: 0,
      remainingUSD: totalBudgetUSD,
      alertThreshold: opts.alertThreshold ?? 0.8,
      hardLimitUSD: opts.hardLimitUSD,
      allocatedAt: Date.now(),
      expiresAt: opts.expiresInMs ? Date.now() + opts.expiresInMs : undefined,
    };

    this.budgets.set(agentId, allocation);
    logger.info(
      { agentId, totalBudgetUSD, hardLimitUSD: opts.hardLimitUSD },
      "[AgentBudgetOptimizer] Budget set"
    );

    return allocation;
  }

  getBudget(agentId: string): BudgetAllocation | null {
    return this.budgets.get(agentId) ?? null;
  }

  private checkBudgetAlert(agentId: string, latestCostUSD: number): void {
    const budget = this.budgets.get(agentId);
    if (!budget) return;

    budget.spentUSD += latestCostUSD;
    budget.remainingUSD = Math.max(0, budget.totalBudgetUSD - budget.spentUSD);

    const utilization = budget.spentUSD / budget.totalBudgetUSD;

    if (utilization >= 1.0) {
      this.emit("budget:exhausted", { agentId, spentUSD: budget.spentUSD });
      logger.warn({ agentId }, "[AgentBudgetOptimizer] Budget exhausted");
    } else if (utilization >= budget.alertThreshold) {
      this.emit("budget:alert", {
        agentId,
        utilization,
        spentUSD: budget.spentUSD,
        remainingUSD: budget.remainingUSD,
      });
    }

    if (budget.hardLimitUSD && budget.spentUSD >= budget.hardLimitUSD) {
      this.emit("budget:hard_limit_reached", {
        agentId,
        spentUSD: budget.spentUSD,
        hardLimitUSD: budget.hardLimitUSD,
      });
      logger.error(
        { agentId, spentUSD: budget.spentUSD },
        "[AgentBudgetOptimizer] Hard budget limit reached"
      );
    }
  }

  canAfford(agentId: string, estimatedCostUSD: number): boolean {
    const budget = this.budgets.get(agentId);
    if (!budget?.hardLimitUSD) return true;
    return budget.spentUSD + estimatedCostUSD <= budget.hardLimitUSD;
  }

  // ── Reporting ─────────────────────────────────────────────────────────────────

  generateReport(opts: {
    agentId?: string;
    sessionId?: string;
    fromMs?: number;
    toMs?: number;
  } = {}): BudgetReport {
    const { agentId, sessionId, fromMs = 0, toMs = Date.now() } = opts;

    let filtered = this.records.filter(
      (r) => r.timestamp >= fromMs && r.timestamp <= toMs
    );

    if (agentId) filtered = filtered.filter((r) => r.agentId === agentId);
    if (sessionId) filtered = filtered.filter((r) => r.sessionId === sessionId);

    const totalCostUSD = filtered.reduce((s, r) => s + r.costUSD, 0);
    const totalInputTokens = filtered.reduce((s, r) => s + r.inputTokens, 0);
    const totalOutputTokens = filtered.reduce((s, r) => s + r.outputTokens, 0);
    const totalThinkingTokens = filtered.reduce((s, r) => s + r.thinkingTokens, 0);

    const costByModel: BudgetReport["costByModel"] = {};
    const costByTaskType: BudgetReport["costByTaskType"] = {};
    const costByComplexity: BudgetReport["costByComplexity"] = {
      trivial: { costUSD: 0, calls: 0 },
      low: { costUSD: 0, calls: 0 },
      medium: { costUSD: 0, calls: 0 },
      high: { costUSD: 0, calls: 0 },
      critical: { costUSD: 0, calls: 0 },
    };

    const sessionCosts = new Map<string, number>();

    for (const r of filtered) {
      // By model
      const modelKey = r.tier;
      if (!costByModel[modelKey]) costByModel[modelKey] = { costUSD: 0, calls: 0, tokens: 0 };
      costByModel[modelKey].costUSD += r.costUSD;
      costByModel[modelKey].calls++;
      costByModel[modelKey].tokens += r.inputTokens + r.outputTokens;

      // By task type
      if (!costByTaskType[r.taskType]) costByTaskType[r.taskType] = { costUSD: 0, calls: 0 };
      costByTaskType[r.taskType].costUSD += r.costUSD;
      costByTaskType[r.taskType].calls++;

      // By complexity
      costByComplexity[r.complexity].costUSD += r.costUSD;
      costByComplexity[r.complexity].calls++;

      // By session
      sessionCosts.set(r.sessionId, (sessionCosts.get(r.sessionId) ?? 0) + r.costUSD);
    }

    // Project monthly cost
    const periodMs = toMs - fromMs;
    const projectedMonthlyUSD =
      periodMs > 0
        ? (totalCostUSD / periodMs) * 30 * 24 * 60 * 60 * 1000
        : 0;

    // Top expensive sessions
    const topExpensiveSessions = [...sessionCosts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([sessionId, costUSD]) => ({ sessionId, costUSD }));

    // Savings opportunities
    const savingsOpportunities: string[] = [];
    for (const [taskType, stats] of Object.entries(costByTaskType)) {
      if (stats.costUSD > totalCostUSD * 0.2) {
        const haikuPerf = this.getModelPerf("haiku", taskType);
        if (haikuPerf.successRate >= 0.85 || haikuPerf.sampleSize === 0) {
          savingsOpportunities.push(
            `Task type '${taskType}' uses ${((stats.costUSD / totalCostUSD) * 100).toFixed(0)}% of budget — Haiku could reduce cost by ~70%`
          );
        }
      }
    }

    return {
      agentId,
      sessionId,
      period: { from: fromMs, to: toMs },
      totalCostUSD,
      totalInputTokens,
      totalOutputTokens,
      totalThinkingTokens,
      callCount: filtered.length,
      costByModel,
      costByTaskType,
      costByComplexity,
      avgCostPerCall: filtered.length > 0 ? totalCostUSD / filtered.length : 0,
      projectedMonthlyUSD,
      topExpensiveSessions,
      savingsOpportunities,
    };
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  getTotalCost(agentId?: string, sessionId?: string): number {
    let filtered = this.records;
    if (agentId) filtered = filtered.filter((r) => r.agentId === agentId);
    if (sessionId) filtered = filtered.filter((r) => r.sessionId === sessionId);
    return filtered.reduce((s, r) => s + r.costUSD, 0);
  }

  getUsageRecords(
    agentId?: string,
    limit = 100
  ): TokenUsageRecord[] {
    let filtered = this.records;
    if (agentId) filtered = filtered.filter((r) => r.agentId === agentId);
    return filtered.slice(-limit).reverse();
  }

  static computeCost(
    tier: ModelTier,
    inputTokens: number,
    outputTokens: number,
    thinkingTokens = 0
  ): number {
    return computeCost(tier, inputTokens, outputTokens, thinkingTokens);
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance: AgentBudgetOptimizer | null = null;

export function getAgentBudgetOptimizer(
  config?: OptimizerConfig
): AgentBudgetOptimizer {
  if (!_instance) _instance = new AgentBudgetOptimizer(config);
  return _instance;
}
