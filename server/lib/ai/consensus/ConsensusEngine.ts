/**
 * ConsensusEngine — Send query to N models, compare responses, return best/fused result
 *
 * Use for high-stakes queries where quality > cost/latency.
 * Configurable: min models, timeout, quality threshold, cost ceiling.
 */

import { ProviderRegistry } from "../providers/core/ProviderRegistry.js";
import {
  type IChatMessage,
  type IChatOptions,
  type IChatResponse,
  ProviderStatus,
} from "../providers/core/types.js";
import { ResponseComparator } from "./ResponseComparator.js";
import { ResponseFusion, type IScoredResponse } from "./ResponseFusion.js";

// ─────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────

export interface IConsensusConfig {
  minModels: number;         // Minimum models that must respond
  maxModels: number;         // Maximum to query concurrently
  timeoutMs: number;         // Max wait for all models
  qualityThreshold: number;  // Min score for a response to count
  costCeiling?: number;      // Max total $ for this consensus call
  requireAgreement?: number; // Require X% agreement for high confidence
  fusionEnabled: boolean;    // Enable response fusion
}

export interface IModelTarget {
  providerId: string;
  modelId: string;
}

export interface IConsensusResponse {
  content: string;
  confidence: number;
  strategy: "unanimous" | "majority" | "fusion" | "best_available";
  participatingModels: number;
  responses: Array<{
    model: string;
    provider: string;
    content: string;
    score: number;
    latencyMs: number;
    error?: string;
  }>;
  totalCostUsd: number;
  totalLatencyMs: number;
  warnings: string[];
}

const DEFAULT_CONFIG: IConsensusConfig = {
  minModels: 2,
  maxModels: 5,
  timeoutMs: 30_000,
  qualityThreshold: 0.4,
  fusionEnabled: true,
};

// ─────────────────────────────────────────────
// ConsensusEngine
// ─────────────────────────────────────────────

export class ConsensusEngine {
  private readonly comparator: ResponseComparator;
  private readonly fusion: ResponseFusion;

  constructor(private readonly registry: ProviderRegistry) {
    this.comparator = new ResponseComparator();
    this.fusion = new ResponseFusion();
  }

  /**
   * Query multiple models and return a consensus response.
   *
   * @param messages - The conversation messages
   * @param targets - Which provider/model combos to query (auto-selected if empty)
   * @param options - Chat options passed to each model
   * @param config - Consensus configuration
   */
  async query(
    messages: IChatMessage[],
    targets: IModelTarget[] = [],
    options: IChatOptions = {},
    config: Partial<IConsensusConfig> = {},
  ): Promise<IConsensusResponse> {
    const cfg: IConsensusConfig = { ...DEFAULT_CONFIG, ...config };
    const start = Date.now();
    const warnings: string[] = [];

    // Auto-select models if not specified
    const selectedTargets = targets.length > 0
      ? targets.slice(0, cfg.maxModels)
      : this.autoSelectModels(cfg.maxModels);

    if (selectedTargets.length < cfg.minModels) {
      warnings.push(`Only ${selectedTargets.length} model(s) available, need ${cfg.minModels} for strong consensus`);
    }

    // Query all models concurrently with individual timeout
    const queries = selectedTargets.map((target) =>
      this.queryWithTimeout(target, messages, options, cfg.timeoutMs),
    );

    const results = await Promise.allSettled(queries);

    // Collect successful responses
    const successful: Array<{
      target: IModelTarget;
      response: IChatResponse;
      latencyMs: number;
    }> = [];

    const responseDetails: IConsensusResponse["responses"] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const target = selectedTargets[i];

      if (result.status === "fulfilled") {
        successful.push(result.value);
        responseDetails.push({
          model: target.modelId,
          provider: target.providerId,
          content: result.value.response.content,
          score: 0, // Will be filled after comparison
          latencyMs: result.value.latencyMs,
        });
      } else {
        responseDetails.push({
          model: target.modelId,
          provider: target.providerId,
          content: "",
          score: 0,
          latencyMs: Date.now() - start,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
        warnings.push(`${target.providerId}/${target.modelId} failed: ${responseDetails[i].error}`);
      }
    }

    if (successful.length === 0) {
      throw new Error("All consensus models failed. " + warnings.join("; "));
    }

    // Score each response relative to others
    const contents = successful.map((s) => s.response.content);
    const scoredResponses: IScoredResponse[] = successful.map((s, i) => {
      const others = contents.filter((_, j) => j !== i);
      const score = this.comparator.compare(s.response.content, others);
      responseDetails.find((r) => r.model === s.target.modelId)!.score = score.overallScore;
      return {
        content: s.response.content,
        score,
        model: s.target.modelId,
        provider: s.target.providerId,
      };
    });

    // Filter below quality threshold
    const qualityFiltered = scoredResponses.filter(
      (r) => r.score.overallScore >= cfg.qualityThreshold,
    );

    if (qualityFiltered.length === 0) {
      warnings.push("All responses below quality threshold, using best available");
    }

    const eligible = qualityFiltered.length > 0 ? qualityFiltered : scoredResponses;

    // Determine consensus strategy
    const consensusStrategy = this.determineStrategy(eligible, cfg);

    // Generate final response
    const fusionResult = cfg.fusionEnabled
      ? this.fusion.fuse(eligible)
      : {
          content: eligible[0].content,
          strategy: "best_single" as const,
          sourcesUsed: 1,
          confidence: eligible[0].score.overallScore,
          metadata: { totalResponses: eligible.length, bestResponseScore: eligible[0].score.overallScore, fusionQualityEstimate: eligible[0].score.overallScore },
        };

    const totalCost = successful.reduce(
      (sum, s) => sum + (s.response.cost ?? 0),
      0,
    );

    return {
      content: fusionResult.content,
      confidence: fusionResult.confidence,
      strategy: consensusStrategy,
      participatingModels: successful.length,
      responses: responseDetails,
      totalCostUsd: totalCost,
      totalLatencyMs: Date.now() - start,
      warnings,
    };
  }

  // ─── Private Helpers ───

  private async queryWithTimeout(
    target: IModelTarget,
    messages: IChatMessage[],
    options: IChatOptions,
    timeoutMs: number,
  ): Promise<{ target: IModelTarget; response: IChatResponse; latencyMs: number }> {
    const provider = this.registry.getProvider(target.providerId);
    const start = Date.now();

    const responsePromise = provider.chat(messages, {
      ...options,
      model: target.modelId,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs),
    );

    const response = await Promise.race([responsePromise, timeoutPromise]);
    return { target, response, latencyMs: Date.now() - start };
  }

  private autoSelectModels(maxModels: number): IModelTarget[] {
    const targets: IModelTarget[] = [];
    const providers = this.registry
      .listProviders()
      .filter((p) => p.health.status !== ProviderStatus.UNAVAILABLE);

    // Try to pick one model from each provider for diversity
    for (const provider of providers) {
      if (targets.length >= maxModels) break;
      const models = provider["_models"] as Array<{ id: string; capabilities: unknown[] }>;
      if (!models?.length) continue;

      const chatModels = models.filter((m) =>
        Array.isArray(m.capabilities) && m.capabilities.includes("chat"),
      );
      if (chatModels.length === 0) continue;

      // Pick the mid-tier model (not cheapest, not most expensive)
      const midIndex = Math.floor(chatModels.length / 2);
      targets.push({
        providerId: provider.id,
        modelId: chatModels[midIndex].id,
      });
    }

    return targets;
  }

  private determineStrategy(
    responses: IScoredResponse[],
    config: IConsensusConfig,
  ): IConsensusResponse["strategy"] {
    if (responses.length === 0) return "best_available";
    if (responses.length === 1) return "best_available";

    // Check for unanimous agreement (high similarity)
    const avgSimilarity = responses.reduce((sum, r) => sum + r.score.similarity, 0) / responses.length;
    if (avgSimilarity > 0.8) return "unanimous";

    // Check for majority agreement
    if (avgSimilarity > 0.5 && responses.length >= 2) return "majority";

    // Use fusion for divergent responses
    if (config.fusionEnabled && responses.length >= 2) return "fusion";

    return "best_available";
  }
}
