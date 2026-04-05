/**
 * Routing System — Type Definitions
 */

import type { IModelInfo, IChatMessage, RoutingStrategy } from "../providers/core/types.js";

// ─────────────────────────────────────────────
// Complexity Analysis
// ─────────────────────────────────────────────

export interface IComplexityFactors {
  tokenCount: number;
  hasCode: boolean;
  hasMultipleLanguages: boolean;
  requiresReasoning: boolean;
  requiresSearch: boolean;
  hasImages: boolean;
  conversationDepth: number;
  toolCount: number;
  contextWindowNeeded: number;
  hasJsonOutput: boolean;
  hasMath: boolean;
}

export interface IComplexityScore {
  score: number;             // 0-1, higher = more complex
  confidence: number;        // 0-1
  tier: "flash" | "pro" | "ultra";
  factors: IComplexityFactors;
  reasoning: string;
}

// ─────────────────────────────────────────────
// Routing Decision
// ─────────────────────────────────────────────

export interface IRoutingCandidate {
  providerId: string;
  modelId: string;
  model: IModelInfo;
  score: number;             // Combined routing score (higher = better)
  estimatedCost: number;
  estimatedLatencyMs: number;
  reasons: string[];
}

export interface IRoutingDecision {
  primary: IRoutingCandidate;
  fallbacks: IRoutingCandidate[];
  strategy: RoutingStrategy;
  complexity: IComplexityScore;
  budgetRemaining?: number;
  warnings: string[];
}

// ─────────────────────────────────────────────
// Strategy Configuration
// ─────────────────────────────────────────────

export interface IStrategyWeights {
  cost: number;       // 0-1 weight for cost optimization
  quality: number;    // 0-1 weight for quality/capability
  speed: number;      // 0-1 weight for low latency
  reliability: number; // 0-1 weight for uptime/health
}

export const STRATEGY_WEIGHTS: Record<RoutingStrategy, IStrategyWeights> = {
  cost_optimized:  { cost: 0.6, quality: 0.2, speed: 0.1, reliability: 0.1 },
  quality_first:   { cost: 0.1, quality: 0.6, speed: 0.15, reliability: 0.15 },
  balanced:        { cost: 0.25, quality: 0.35, speed: 0.2, reliability: 0.2 },
  speed_first:     { cost: 0.15, quality: 0.2, speed: 0.5, reliability: 0.15 },
};

// ─────────────────────────────────────────────
// Budget Tracking
// ─────────────────────────────────────────────

export interface IBudgetConfig {
  userId?: string;
  orgId?: string;
  dailyLimitUsd?: number;
  monthlyLimitUsd?: number;
  perRequestLimitUsd?: number;
}

export interface IBudgetStatus {
  dailySpent: number;
  monthlySpent: number;
  dailyRemaining?: number;
  monthlyRemaining?: number;
  isExceeded: boolean;
}

// ─────────────────────────────────────────────
// Router Config
// ─────────────────────────────────────────────

export interface IRouterConfig {
  defaultStrategy: RoutingStrategy;
  maxFallbacks: number;
  minHealthScore: number;      // 0-1, providers below this are skipped
  preferredProviders?: string[];
  excludedProviders?: string[];
  budgetConfig?: IBudgetConfig;
  qualityHistory?: boolean;    // Track quality scores per model per task type
}
