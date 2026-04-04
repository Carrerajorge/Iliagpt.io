/**
 * IntelligentRouter — Cost-aware, quality-first, multi-strategy routing
 *
 * Analyzes task complexity → selects best provider/model → builds fallback chain
 * Tracks quality scores over time for continuous improvement.
 */

import { ProviderRegistry } from "../providers/core/ProviderRegistry.js";
import {
  type IChatMessage,
  type IChatOptions,
  ModelCapability,
  ProviderStatus,
  RoutingStrategy,
} from "../providers/core/types.js";
import { ComplexityAnalyzer } from "./ComplexityAnalyzer.js";
import { CostCalculator, costCalculator } from "./CostCalculator.js";
import {
  type IBudgetConfig,
  type IRouterConfig,
  type IRoutingCandidate,
  type IRoutingDecision,
  STRATEGY_WEIGHTS,
} from "./types.js";

// ─────────────────────────────────────────────
// Quality History Tracker
// ─────────────────────────────────────────────

interface QualityRecord {
  score: number;      // 0-1
  timestamp: Date;
  taskType: string;
}

class QualityTracker {
  private readonly records = new Map<string, QualityRecord[]>();
  private readonly MAX_RECORDS = 100;

  record(modelId: string, taskType: string, score: number): void {
    const key = `${modelId}:${taskType}`;
    const list = this.records.get(key) ?? [];
    list.push({ score, timestamp: new Date(), taskType });
    if (list.length > this.MAX_RECORDS) list.shift();
    this.records.set(key, list);
  }

  getAverageScore(modelId: string, taskType: string, windowDays = 7): number {
    const key = `${modelId}:${taskType}`;
    const list = this.records.get(key) ?? [];
    const cutoff = new Date(Date.now() - windowDays * 86_400_000);
    const recent = list.filter((r) => r.timestamp >= cutoff);
    if (recent.length === 0) return 0.5; // neutral prior
    return recent.reduce((sum, r) => sum + r.score, 0) / recent.length;
  }
}

// ─────────────────────────────────────────────
// IntelligentRouter
// ─────────────────────────────────────────────

export class IntelligentRouter {
  private readonly analyzer: ComplexityAnalyzer;
  private readonly calculator: CostCalculator;
  private readonly quality: QualityTracker;
  private readonly config: IRouterConfig;

  constructor(
    private readonly registry: ProviderRegistry,
    config: Partial<IRouterConfig> = {},
    calculator?: CostCalculator,
  ) {
    this.analyzer = new ComplexityAnalyzer();
    this.calculator = calculator ?? costCalculator;
    this.quality = new QualityTracker();
    this.config = {
      defaultStrategy: RoutingStrategy.BALANCED,
      maxFallbacks: 3,
      minHealthScore: 0.3,
      qualityHistory: true,
      ...config,
    };
  }

  /**
   * Main routing entry point.
   * Returns a routing decision with primary model + ordered fallbacks.
   */
  async route(
    messages: IChatMessage[],
    options: IChatOptions = {},
    strategy?: RoutingStrategy,
    budgetConfig?: IBudgetConfig,
  ): Promise<IRoutingDecision> {
    const usedStrategy = strategy ?? this.config.defaultStrategy;
    const complexity = this.analyzer.analyze(messages, options.tools?.length ?? 0);
    const requiredCaps = this.analyzer.requiredCapabilities(complexity);
    const estimatedTokens = complexity.factors.tokenCount;
    const warnings: string[] = [];

    // Get all healthy providers
    const providers = this.registry
      .listProviders()
      .filter((p) => {
        if (this.config.excludedProviders?.includes(p.id)) return false;
        if (p.health.status === ProviderStatus.UNAVAILABLE) return false;
        const errorRate = p.health.errorRate ?? 0;
        if (errorRate > 1 - this.config.minHealthScore) return false;
        return true;
      });

    // Collect all models from all providers
    const candidates: IRoutingCandidate[] = [];

    for (const provider of providers) {
      const models = await provider.listModels().catch(() => []);

      for (const model of models) {
        // Must satisfy required capabilities
        if (!requiredCaps.every((cap) => model.capabilities.includes(cap))) continue;

        // Must have sufficient context window
        if (model.contextWindow < complexity.factors.contextWindowNeeded) continue;

        // Estimate cost
        const estimatedOutputTokens = Math.min(options.maxTokens ?? 4096, model.maxOutputTokens ?? 4096);
        const estimatedCost = this.calculator.calculate(model, estimatedTokens, estimatedOutputTokens);

        // Check budget
        if (budgetConfig ?? this.config.budgetConfig) {
          const bc = budgetConfig ?? this.config.budgetConfig!;
          const { exceeds, reason } = this.calculator.wouldExceedBudget(estimatedCost, bc);
          if (exceeds) {
            warnings.push(reason ?? "Budget exceeded");
            continue;
          }
        }

        const score = this.scoreCandidate(
          provider.id,
          model,
          usedStrategy,
          complexity.tier,
          estimatedCost,
          provider.health.latencyMs ?? 500,
          provider.health.errorRate ?? 0,
        );

        candidates.push({
          providerId: provider.id,
          modelId: model.id,
          model,
          score,
          estimatedCost,
          estimatedLatencyMs: provider.health.latencyMs ?? 500,
          reasons: this.buildReasons(provider.id, model, usedStrategy, complexity.tier),
        });
      }
    }

    if (candidates.length === 0) {
      throw new Error(
        `No eligible providers found for complexity tier '${complexity.tier}' with capabilities: ${requiredCaps.join(", ")}. ` +
        (warnings.length > 0 ? `Warnings: ${warnings.join("; ")}` : ""),
      );
    }

    // Sort by score (highest first), with preferred providers boosted
    candidates.sort((a, b) => {
      const aBoost = this.config.preferredProviders?.includes(a.providerId) ? 0.1 : 0;
      const bBoost = this.config.preferredProviders?.includes(b.providerId) ? 0.1 : 0;
      return (b.score + bBoost) - (a.score + aBoost);
    });

    const [primary, ...rest] = candidates;
    const fallbacks = rest.slice(0, this.config.maxFallbacks);

    return {
      primary,
      fallbacks,
      strategy: usedStrategy,
      complexity,
      budgetRemaining: budgetConfig
        ? this.calculator.getBudgetStatus(budgetConfig).dailyRemaining
        : undefined,
      warnings,
    };
  }

  /**
   * Execute a chat request with automatic fallback on failure.
   * Records quality feedback after completion.
   */
  async routeAndExecute(
    messages: IChatMessage[],
    options: IChatOptions = {},
    strategy?: RoutingStrategy,
  ) {
    const decision = await this.route(messages, options, strategy);
    const chain = [decision.primary, ...decision.fallbacks];

    for (const candidate of chain) {
      try {
        const provider = this.registry.getProvider(candidate.providerId);
        const start = Date.now();
        const response = await provider.chat(messages, {
          ...options,
          model: candidate.modelId,
        });

        // Record quality (1.0 = success, adjust with actual feedback if available)
        if (this.config.qualityHistory) {
          this.quality.record(
            candidate.modelId,
            decision.complexity.tier,
            1.0,
          );
        }

        this.calculator.record({
          provider: candidate.providerId,
          model: candidate.modelId,
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          cost: response.cost ?? candidate.estimatedCost,
        });

        return {
          response,
          routingDecision: decision,
          usedCandidate: candidate,
          totalLatencyMs: Date.now() - start,
        };
      } catch (err) {
        console.warn(
          `[IntelligentRouter] ${candidate.providerId}/${candidate.modelId} failed:`,
          (err as Error).message,
        );

        if (this.config.qualityHistory) {
          this.quality.record(candidate.modelId, decision.complexity.tier, 0);
        }

        // If this was the last candidate, re-throw
        if (candidate === chain[chain.length - 1]) throw err;
      }
    }

    throw new Error("All routing candidates exhausted");
  }

  /**
   * Record quality feedback for a completed response.
   * Call this after evaluating the response quality externally.
   */
  recordQualityFeedback(modelId: string, taskType: string, score: number): void {
    this.quality.record(modelId, taskType, score);
  }

  // ─── Scoring ───

  private scoreCandidate(
    providerId: string,
    model: { id: string; pricing: { inputPerMillion: number; outputPerMillion: number } },
    strategy: RoutingStrategy,
    tier: "flash" | "pro" | "ultra",
    estimatedCost: number,
    latencyMs: number,
    errorRate: number,
  ): number {
    const weights = STRATEGY_WEIGHTS[strategy];

    // Cost score (0-1, inverted — cheaper is better)
    const maxExpectedCost = 0.05; // $0.05 per request as reference
    const costScore = 1 - Math.min(estimatedCost / maxExpectedCost, 1);

    // Quality score based on tier match and historical data
    const tierMatch = this.tierMatchScore(model.id, tier);
    const historicalQuality = this.config.qualityHistory
      ? this.quality.getAverageScore(model.id, tier)
      : 0.5;
    const qualityScore = tierMatch * 0.6 + historicalQuality * 0.4;

    // Speed score (0-1, inverted — faster is better)
    const maxLatency = 5000; // 5s as reference
    const speedScore = 1 - Math.min(latencyMs / maxLatency, 1);

    // Reliability score (0-1, inverted error rate)
    const reliabilityScore = 1 - errorRate;

    return (
      weights.cost * costScore +
      weights.quality * qualityScore +
      weights.speed * speedScore +
      weights.reliability * reliabilityScore
    );
  }

  private tierMatchScore(modelId: string, tier: "flash" | "pro" | "ultra"): number {
    const id = modelId.toLowerCase();

    const isFlashModel =
      id.includes("flash") || id.includes("mini") || id.includes("haiku") ||
      id.includes("small") || id.includes("light") || id.includes("3b") || id.includes("7b") || id.includes("8b");

    const isUltraModel =
      id.includes("opus") || id.includes("ultra") || id.includes("405b") ||
      id.includes("o1") || id.includes("-o3") || id.includes("large") || id.includes("reasoning");

    if (tier === "flash") {
      if (isFlashModel) return 1.0;
      if (isUltraModel) return 0.4; // Overkill but will work
      return 0.7;
    }

    if (tier === "ultra") {
      if (isUltraModel) return 1.0;
      if (isFlashModel) return 0.3; // May not be capable enough
      return 0.65;
    }

    // pro tier — prefer balanced models
    if (!isFlashModel && !isUltraModel) return 1.0;
    if (isFlashModel) return 0.7;
    return 0.8;
  }

  private buildReasons(
    providerId: string,
    model: { id: string; capabilities: ModelCapability[]; contextWindow: number },
    strategy: RoutingStrategy,
    tier: "flash" | "pro" | "ultra",
  ): string[] {
    const reasons: string[] = [];

    if (strategy === RoutingStrategy.COST_OPTIMIZED) reasons.push("Cost-optimized selection");
    if (strategy === RoutingStrategy.QUALITY_FIRST) reasons.push("Quality-first selection");
    if (strategy === RoutingStrategy.SPEED_FIRST) reasons.push("Speed-first selection");

    if (model.capabilities.includes(ModelCapability.REASONING)) reasons.push("Native reasoning");
    if (model.capabilities.includes(ModelCapability.VISION)) reasons.push("Vision support");
    if (model.contextWindow >= 100_000) reasons.push(`Large context (${(model.contextWindow / 1000).toFixed(0)}k)`);

    if (this.config.preferredProviders?.includes(providerId)) {
      reasons.push("Preferred provider");
    }

    return reasons;
  }
}
