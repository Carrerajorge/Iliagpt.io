/**
 * Intelligent Router
 *
 * Selects the best provider+model for a request using:
 *   - Strategy: cheapest | fastest | balanced | highest_quality
 *   - Complexity score from ComplexityAnalyzer
 *   - Real-time health from ProviderRegistry
 *   - Budget awareness from CostCalculator
 *   - Cascade fallback on provider failure
 */

import {
  IRoutingContext,
  IRoutingDecision,
  IChatRequest,
  IChatResponse,
  IStreamChunk,
  IModelInfo,
  RoutingStrategy,
  ModelCapability,
  ProviderStatus,
  BudgetExceededError,
  ProviderError,
} from '../providers/core/types';
import { ProviderRegistry } from '../providers/core/ProviderRegistry';
import { ComplexityAnalyzer } from './ComplexityAnalyzer';
import { CostCalculator } from './CostCalculator';

// ─── Scoring ──────────────────────────────────────────────────────────────────

interface ScoredModel {
  provider: string;
  model: IModelInfo;
  score: number;
  estimatedCostUsd: number;
  estimatedLatencyMs: number;
}

const LATENCY_CLASS_MS: Record<IModelInfo['latencyClass'], number> = {
  ultra_fast: 400,
  fast: 1_200,
  medium: 3_000,
  slow: 8_000,
};

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

// ─── Router ───────────────────────────────────────────────────────────────────

export class IntelligentRouter {
  private _registry: ProviderRegistry;
  private _complexity: ComplexityAnalyzer;
  private _cost: CostCalculator;

  constructor(
    registry?: ProviderRegistry,
    complexity?: ComplexityAnalyzer,
    cost?: CostCalculator,
  ) {
    this._registry = registry ?? ProviderRegistry.getInstance();
    this._complexity = complexity ?? new ComplexityAnalyzer();
    this._cost = cost ?? new CostCalculator();
  }

  // ── Main routing ─────────────────────────────────────────────────────────────

  async route(context: IRoutingContext): Promise<IRoutingDecision> {
    const allModels = await this._registry.getAllModels();

    // 1. Filter eligible models
    const eligible = this._filterEligible(allModels, context);
    if (eligible.length === 0) {
      throw new ProviderError(
        'No eligible providers found for the given requirements',
        'router',
        'NO_ELIGIBLE_PROVIDERS',
        false,
      );
    }

    // 2. Score each model
    const scored = eligible.map((m) => this._scoreModel(m, context));
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    const fallbacks = scored.slice(1, 4).map((s) => ({ provider: s.provider, model: s.model.id }));

    return {
      provider: best.provider,
      model: best.model.id,
      estimatedCostUsd: best.estimatedCostUsd,
      estimatedLatencyMs: best.estimatedLatencyMs,
      rationale: this._buildRationale(best, context),
      fallbacks,
    };
  }

  // ── Execute with cascade fallback ────────────────────────────────────────────

  async execute(context: IRoutingContext): Promise<IChatResponse> {
    // Budget pre-check
    if (context.budgetUsd !== undefined) {
      const allModels = await this._registry.getAllModels();
      const eligible = this._filterEligible(allModels, context);
      if (eligible.length > 0) {
        const topModel = this._filterEligible(allModels, context)[0];
        const estimate = this._cost.estimate(context.request, topModel);
        if (estimate.estimatedCostUsd > context.budgetUsd) {
          throw new BudgetExceededError(context.budgetUsd, estimate.estimatedCostUsd);
        }
      }
    }

    const decision = await this.route(context);
    const cascade: Array<{ provider: string; model: string }> = [
      { provider: decision.provider, model: decision.model },
      ...decision.fallbacks,
    ];

    let lastError: unknown;
    for (const target of cascade) {
      try {
        const provider = this._registry.tryGetProvider(target.provider);
        if (!provider) continue;

        const requestWithModel: IChatRequest = { ...context.request, model: target.model };
        const response = await provider.chat(requestWithModel);
        return response;
      } catch (err) {
        lastError = err;
        if (err instanceof ProviderError && !err.retryable) {
          // Non-retryable: skip to next in cascade
          continue;
        }
        if (err instanceof BudgetExceededError) throw err;
        // Retryable errors: still try next in cascade
        continue;
      }
    }

    throw lastError ?? new ProviderError('All providers in cascade failed', 'router', 'CASCADE_EXHAUSTED', false);
  }

  async *executeStream(context: IRoutingContext): AsyncGenerator<IStreamChunk> {
    const decision = await this.route(context);
    const provider = this._registry.getProvider(decision.provider);
    const request: IChatRequest = { ...context.request, model: decision.model, stream: true };
    yield* provider.stream(request);
  }

  // ── Model recommendation ──────────────────────────────────────────────────────

  async recommend(request: IChatRequest, strategy = RoutingStrategy.Balanced): Promise<IRoutingDecision> {
    const complexityScore = this._complexity.score(request);
    return this.route({
      request,
      strategy,
      complexityScore,
    });
  }

  // ── Filtering ────────────────────────────────────────────────────────────────

  private _filterEligible(models: IModelInfo[], context: IRoutingContext): IModelInfo[] {
    return models.filter((model) => {
      // Required capabilities
      if (context.requiredCapabilities?.length) {
        if (!context.requiredCapabilities.every((cap) => model.capabilities.includes(cap))) return false;
      }

      // Chat capability is always required
      if (!model.capabilities.includes(ModelCapability.Chat)) return false;

      // Provider health
      try {
        const health = this._registry.getHealth(model.provider);
        if (health.status === ProviderStatus.Unavailable) return false;
      } catch { return false; }

      // Provider exclusions
      if (context.excludedProviders?.includes(model.provider)) return false;

      // Latency constraint
      if (context.maxLatencyMs !== undefined) {
        const estimatedLatency = LATENCY_CLASS_MS[model.latencyClass];
        if (estimatedLatency > context.maxLatencyMs) return false;
      }

      return true;
    });
  }

  // ── Scoring ───────────────────────────────────────────────────────────────────

  private _scoreModel(model: IModelInfo, context: IRoutingContext): ScoredModel {
    const estimatedLatencyMs = LATENCY_CLASS_MS[model.latencyClass];
    const estimatedCostUsd = this._cost.estimate(context.request, model).estimatedCostUsd;

    // Normalize costs and latency across plausible ranges
    const normCost = normalize(estimatedCostUsd, 0, 0.05);   // $0.05 = high
    const normLatency = normalize(estimatedLatencyMs, 200, 10_000);
    const normQuality = model.qualityScore;

    let score: number;

    switch (context.strategy) {
      case RoutingStrategy.Cheapest:
        score = 0.7 * (1 - normCost) + 0.2 * normQuality + 0.1 * (1 - normLatency);
        break;

      case RoutingStrategy.Fastest:
        score = 0.7 * (1 - normLatency) + 0.2 * normQuality + 0.1 * (1 - normCost);
        break;

      case RoutingStrategy.HighestQuality:
        score = 0.7 * normQuality + 0.2 * (1 - normLatency) + 0.1 * (1 - normCost);
        break;

      case RoutingStrategy.Balanced:
      default: {
        // For balanced: quality weight scales with complexity
        const complexity = context.complexityScore ?? 0.5;
        const qualityWeight = 0.3 + 0.4 * complexity;      // 0.3 → 0.7
        const costWeight = 0.4 - 0.3 * complexity;          // 0.4 → 0.1
        const latencyWeight = 1 - qualityWeight - costWeight;
        score = qualityWeight * normQuality
          + costWeight * (1 - normCost)
          + latencyWeight * (1 - normLatency);
        break;
      }
    }

    // Preferred providers get a small boost
    if (context.preferredProviders?.includes(model.provider)) {
      score = Math.min(1, score * 1.1);
    }

    // Penalise degraded providers
    try {
      const health = this._registry.getHealth(model.provider);
      if (health.status === ProviderStatus.Degraded) {
        score *= 0.8;
      }
      // Latency from health check refines the estimate
      if (health.latencyMs > 0) {
        const realNormLatency = normalize(health.latencyMs, 200, 10_000);
        score = score * 0.8 + (1 - realNormLatency) * 0.2;
      }
    } catch { /* no health data yet */ }

    return { provider: model.provider, model, score, estimatedCostUsd, estimatedLatencyMs };
  }

  private _buildRationale(scored: ScoredModel, context: IRoutingContext): string {
    const parts: string[] = [
      `Selected ${scored.provider}/${scored.model.id} (score: ${scored.score.toFixed(3)})`,
      `strategy=${context.strategy}`,
      `estimatedCost=$${scored.estimatedCostUsd.toFixed(5)}`,
      `latencyClass=${scored.model.latencyClass}`,
    ];
    if (context.complexityScore !== undefined) {
      parts.push(`complexity=${context.complexityScore.toFixed(2)}`);
    }
    return parts.join(', ');
  }
}

export const intelligentRouter = new IntelligentRouter();
