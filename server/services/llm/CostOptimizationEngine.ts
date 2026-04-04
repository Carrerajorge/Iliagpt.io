/**
 * COST OPTIMIZATION ENGINE
 *
 * Tracks, optimizes, and controls LLM costs across all providers.
 * Features:
 * - Real-time cost tracking per user, provider, model
 * - Budget alerts and hard limits
 * - Smart model routing for cost efficiency
 * - Token usage analytics and forecasting
 * - Cost anomaly detection
 * - Prompt caching optimization
 * - Batch processing for cost reduction
 */

import { EventEmitter } from "events";
import { providerRegistry } from "../../lib/providers/ProviderRegistry";
import type { ModelInfo, TokenUsage } from "../../lib/providers/BaseProvider";

// ============================================================================
// Types
// ============================================================================

export interface CostRecord {
  id: string;
  timestamp: number;
  userId: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  cached: boolean;
  fromFallback: boolean;
  latencyMs: number;
  metadata?: Record<string, unknown>;
}

export interface BudgetConfig {
  userId: string;
  dailyLimit: number;
  monthlyLimit: number;
  perRequestLimit: number;
  alertThreshold: number; // 0-1, e.g., 0.8 = alert at 80%
  hardStop: boolean;
}

export interface CostSummary {
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  byProvider: Record<string, { cost: number; tokens: number; requests: number }>;
  byModel: Record<string, { cost: number; tokens: number; requests: number }>;
  averageCostPerRequest: number;
  averageTokensPerRequest: number;
  period: { start: number; end: number };
}

export interface CostAnomaly {
  type: "spike" | "unusual_model" | "high_token_count" | "budget_breach";
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  details: Record<string, unknown>;
  timestamp: number;
}

export interface OptimizationSuggestion {
  type: "model_switch" | "caching" | "batching" | "prompt_reduction" | "provider_switch";
  description: string;
  estimatedSavings: number;
  confidence: number;
  action: Record<string, unknown>;
}

// ============================================================================
// Cost Engine
// ============================================================================

export class CostOptimizationEngine extends EventEmitter {
  private records: CostRecord[] = [];
  private budgets: Map<string, BudgetConfig> = new Map();
  private dailyCosts: Map<string, number> = new Map(); // userId:date -> cost
  private monthlyCosts: Map<string, number> = new Map(); // userId:month -> cost
  private modelPriceCache: Map<string, { input: number; output: number }> = new Map();
  private readonly MAX_RECORDS = 100000;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    super();
    this.setMaxListeners(50);
    this.cleanupInterval = setInterval(() => this.cleanup(), 3600000); // hourly
  }

  // ===== Cost Tracking =====

  async trackUsage(params: {
    userId: string;
    provider: string;
    model: string;
    usage: TokenUsage;
    cached?: boolean;
    fromFallback?: boolean;
    latencyMs?: number;
    metadata?: Record<string, unknown>;
  }): Promise<CostRecord> {
    const pricing = await this.getModelPricing(params.provider, params.model);

    const inputCost = (params.usage.promptTokens / 1_000_000) * pricing.input;
    const outputCost = (params.usage.completionTokens / 1_000_000) * pricing.output;
    // Cached tokens are typically 50-90% cheaper
    const cacheDiscount = params.cached ? 0.5 : 1.0;
    const totalCost = (inputCost + outputCost) * cacheDiscount;

    const record: CostRecord = {
      id: `cost_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      userId: params.userId,
      provider: params.provider,
      model: params.model,
      promptTokens: params.usage.promptTokens,
      completionTokens: params.usage.completionTokens,
      totalTokens: params.usage.totalTokens,
      inputCost,
      outputCost,
      totalCost,
      cached: params.cached || false,
      fromFallback: params.fromFallback || false,
      latencyMs: params.latencyMs || 0,
      metadata: params.metadata,
    };

    this.records.push(record);
    this.updateCostCounters(record);

    // Check budgets
    const budgetStatus = this.checkBudget(params.userId, totalCost);
    if (budgetStatus.alert) {
      this.emit("budgetAlert", { userId: params.userId, ...budgetStatus });
    }
    if (budgetStatus.exceeded) {
      this.emit("budgetExceeded", { userId: params.userId, ...budgetStatus });
    }

    // Anomaly detection
    this.detectAnomalies(record);

    this.emit("costRecorded", record);
    return record;
  }

  // ===== Budget Management =====

  setBudget(config: BudgetConfig): void {
    this.budgets.set(config.userId, config);
    this.emit("budgetSet", config);
  }

  getBudget(userId: string): BudgetConfig | undefined {
    return this.budgets.get(userId);
  }

  checkBudget(userId: string, additionalCost: number = 0): {
    withinBudget: boolean;
    alert: boolean;
    exceeded: boolean;
    dailyUsed: number;
    monthlyUsed: number;
    dailyLimit: number;
    monthlyLimit: number;
  } {
    const budget = this.budgets.get(userId);
    if (!budget) return { withinBudget: true, alert: false, exceeded: false, dailyUsed: 0, monthlyUsed: 0, dailyLimit: Infinity, monthlyLimit: Infinity };

    const today = new Date().toISOString().split("T")[0];
    const month = today.slice(0, 7);
    const dailyUsed = (this.dailyCosts.get(`${userId}:${today}`) || 0) + additionalCost;
    const monthlyUsed = (this.monthlyCosts.get(`${userId}:${month}`) || 0) + additionalCost;

    const dailyRatio = dailyUsed / budget.dailyLimit;
    const monthlyRatio = monthlyUsed / budget.monthlyLimit;
    const maxRatio = Math.max(dailyRatio, monthlyRatio);

    return {
      withinBudget: dailyUsed <= budget.dailyLimit && monthlyUsed <= budget.monthlyLimit,
      alert: maxRatio >= budget.alertThreshold,
      exceeded: dailyUsed > budget.dailyLimit || monthlyUsed > budget.monthlyLimit,
      dailyUsed,
      monthlyUsed,
      dailyLimit: budget.dailyLimit,
      monthlyLimit: budget.monthlyLimit,
    };
  }

  canAffordRequest(userId: string, estimatedTokens: number, model: string, provider: string): boolean {
    const budget = this.budgets.get(userId);
    if (!budget) return true;

    const pricing = this.modelPriceCache.get(`${provider}:${model}`) || { input: 5, output: 15 };
    const estimatedCost = (estimatedTokens / 1_000_000) * ((pricing.input + pricing.output) / 2);
    const status = this.checkBudget(userId, estimatedCost);
    return status.withinBudget || !budget.hardStop;
  }

  // ===== Analytics =====

  getSummary(userId?: string, periodMs: number = 86400000): CostSummary {
    const cutoff = Date.now() - periodMs;
    const filtered = this.records.filter((r) => {
      if (r.timestamp < cutoff) return false;
      if (userId && r.userId !== userId) return false;
      return true;
    });

    const byProvider: Record<string, { cost: number; tokens: number; requests: number }> = {};
    const byModel: Record<string, { cost: number; tokens: number; requests: number }> = {};
    let totalCost = 0;
    let totalTokens = 0;

    for (const r of filtered) {
      totalCost += r.totalCost;
      totalTokens += r.totalTokens;

      if (!byProvider[r.provider]) byProvider[r.provider] = { cost: 0, tokens: 0, requests: 0 };
      byProvider[r.provider].cost += r.totalCost;
      byProvider[r.provider].tokens += r.totalTokens;
      byProvider[r.provider].requests++;

      if (!byModel[r.model]) byModel[r.model] = { cost: 0, tokens: 0, requests: 0 };
      byModel[r.model].cost += r.totalCost;
      byModel[r.model].tokens += r.totalTokens;
      byModel[r.model].requests++;
    }

    return {
      totalCost,
      totalTokens,
      totalRequests: filtered.length,
      byProvider,
      byModel,
      averageCostPerRequest: filtered.length > 0 ? totalCost / filtered.length : 0,
      averageTokensPerRequest: filtered.length > 0 ? totalTokens / filtered.length : 0,
      period: { start: cutoff, end: Date.now() },
    };
  }

  // ===== Optimization Suggestions =====

  async getOptimizationSuggestions(userId?: string): Promise<OptimizationSuggestion[]> {
    const suggestions: OptimizationSuggestion[] = [];
    const summary = this.getSummary(userId, 7 * 86400000); // Last 7 days

    // Check if cheaper models could be used
    for (const [model, stats] of Object.entries(summary.byModel)) {
      if (stats.cost > 1.0) {
        const allModels = await providerRegistry.getAllModels();
        const current = allModels.find((m) => m.id === model);
        if (current) {
          const cheaper = allModels
            .filter((m) => m.category === current.category && m.inputPricePerMillion < current.inputPricePerMillion * 0.5)
            .sort((a, b) => a.inputPricePerMillion - b.inputPricePerMillion);

          if (cheaper.length > 0) {
            const savings = stats.cost * (1 - cheaper[0].inputPricePerMillion / current.inputPricePerMillion);
            suggestions.push({
              type: "model_switch",
              description: `Switch from ${model} to ${cheaper[0].id} for ~${Math.round(savings * 100) / 100} USD/week savings`,
              estimatedSavings: savings,
              confidence: 0.7,
              action: { fromModel: model, toModel: cheaper[0].id, toProvider: cheaper[0].provider },
            });
          }
        }
      }
    }

    // Check for caching opportunities
    const recentRecords = this.records.slice(-1000);
    const duplicateRatio = this.calculateDuplicateRatio(recentRecords);
    if (duplicateRatio > 0.1) {
      suggestions.push({
        type: "caching",
        description: `${Math.round(duplicateRatio * 100)}% of recent requests are similar. Enable response caching to reduce costs.`,
        estimatedSavings: summary.totalCost * duplicateRatio * 0.5,
        confidence: 0.8,
        action: { enableCaching: true, cacheTtlMs: 300000 },
      });
    }

    // Check for prompt optimization
    const avgTokens = summary.averageTokensPerRequest;
    if (avgTokens > 5000) {
      suggestions.push({
        type: "prompt_reduction",
        description: `Average ${Math.round(avgTokens)} tokens/request. Consider summarizing conversation history.`,
        estimatedSavings: summary.totalCost * 0.2,
        confidence: 0.6,
        action: { maxContextTokens: 4000, enableSummarization: true },
      });
    }

    return suggestions.sort((a, b) => b.estimatedSavings - a.estimatedSavings);
  }

  /**
   * Pick the cheapest model from the same category that's available.
   */
  async getCheapestModel(category: ModelInfo["category"] = "chat", minTier: ModelInfo["tier"] = "free"): Promise<ModelInfo | null> {
    const allModels = await providerRegistry.getAllModels();
    const tierOrder = { free: 0, standard: 1, premium: 2, enterprise: 3 };
    const minTierLevel = tierOrder[minTier];

    const candidates = allModels
      .filter((m) => m.category === category && tierOrder[m.tier] >= minTierLevel)
      .sort((a, b) => a.inputPricePerMillion - b.inputPricePerMillion);

    return candidates[0] || null;
  }

  // ===== Internal =====

  private async getModelPricing(provider: string, model: string): Promise<{ input: number; output: number }> {
    const key = `${provider}:${model}`;
    if (this.modelPriceCache.has(key)) return this.modelPriceCache.get(key)!;

    const allModels = await providerRegistry.getAllModels().catch(() => []);
    const modelInfo = allModels.find((m) => m.id === model);

    const pricing = modelInfo
      ? { input: modelInfo.inputPricePerMillion, output: modelInfo.outputPricePerMillion }
      : { input: 2.50, output: 10.00 }; // Default

    this.modelPriceCache.set(key, pricing);
    return pricing;
  }

  private updateCostCounters(record: CostRecord): void {
    const today = new Date(record.timestamp).toISOString().split("T")[0];
    const month = today.slice(0, 7);

    const dailyKey = `${record.userId}:${today}`;
    const monthlyKey = `${record.userId}:${month}`;

    this.dailyCosts.set(dailyKey, (this.dailyCosts.get(dailyKey) || 0) + record.totalCost);
    this.monthlyCosts.set(monthlyKey, (this.monthlyCosts.get(monthlyKey) || 0) + record.totalCost);
  }

  private detectAnomalies(record: CostRecord): void {
    // High single-request cost
    if (record.totalCost > 1.0) {
      this.emit("anomaly", {
        type: "spike",
        severity: record.totalCost > 5.0 ? "critical" : "high",
        message: `High cost request: $${record.totalCost.toFixed(4)} for ${record.model}`,
        details: { cost: record.totalCost, model: record.model, tokens: record.totalTokens },
        timestamp: Date.now(),
      } satisfies CostAnomaly);
    }

    // Abnormally high token count
    if (record.totalTokens > 100000) {
      this.emit("anomaly", {
        type: "high_token_count",
        severity: "medium",
        message: `High token count: ${record.totalTokens} tokens for ${record.model}`,
        details: { tokens: record.totalTokens, model: record.model },
        timestamp: Date.now(),
      } satisfies CostAnomaly);
    }
  }

  private calculateDuplicateRatio(records: CostRecord[]): number {
    if (records.length < 10) return 0;
    const seen = new Set<string>();
    let duplicates = 0;
    for (const r of records) {
      const key = `${r.model}:${r.promptTokens}`;
      if (seen.has(key)) duplicates++;
      seen.add(key);
    }
    return duplicates / records.length;
  }

  private cleanup(): void {
    if (this.records.length > this.MAX_RECORDS) {
      this.records = this.records.slice(-this.MAX_RECORDS * 0.8);
    }

    // Clean old daily/monthly entries
    const cutoff = Date.now() - 32 * 86400000;
    for (const [key] of this.dailyCosts) {
      const date = key.split(":")[1];
      if (new Date(date).getTime() < cutoff) this.dailyCosts.delete(key);
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.removeAllListeners();
  }
}

// Singleton
export const costEngine = new CostOptimizationEngine();
