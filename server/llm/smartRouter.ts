/**
 * Smart Router - Cost-aware routing and enhanced health management
 *
 * Provides a higher-level routing layer ON TOP of the existing LLMGateway.
 * Classifies query complexity, selects cost-optimal providers, tracks
 * provider health with degradation/recovery, and logs routing decisions.
 */

import { getCircuitBreaker, CircuitState } from "../lib/circuitBreaker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LLMProvider =
  | "xai"
  | "gemini"
  | "openai"
  | "anthropic"
  | "deepseek"
  | "cerebras";

export interface ProviderHealth {
  provider: LLMProvider;
  state: "healthy" | "degraded" | "down";
  consecutiveFailures: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  degradedUntil: number | null;
  avgLatencyMs: number;
  errorRate: number; // 0-1
  lastHealthCheck: number;
}

export interface CircuitBreakerState {
  state: "closed" | "open" | "half-open";
  failures: number;
  lastFailure: number;
  lastSuccess: number;
  openedAt: number;
}

export interface RoutingDecision {
  provider: LLMProvider;
  fallbackChain: LLMProvider[];
  reason: string;
  complexity: "simple" | "moderate" | "complex";
  estimatedCostTier: number; // 1-5
  timestamp: number;
}

export interface FallbackResult {
  model: string;
  provider: LLMProvider;
  reason: string;
  fallbackUsed: boolean;
  originalProvider?: LLMProvider;
  budgetWarning?: boolean;
}

export interface SmartRouterConfig {
  degradedCooldownMs: number;
  healthCheckIntervalMs: number;
  maxConsecutiveFailures: number;
  costAwareRouting: boolean;
}

export interface ProviderStats {
  provider: LLMProvider;
  health: ProviderHealth;
  circuitBreaker: CircuitBreakerState;
  requestCount: { success: number; failure: number };
  latencyP50: number;
  latencyP95: number;
}

export interface SmartRouterStats {
  providers: ProviderStats[];
  circuitBreakers: Record<string, CircuitBreakerState>;
  totalRequests: number;
  fallbackRate: number;
}

export interface RoutingStats {
  totalDecisions: number;
  byProvider: Record<string, number>;
  byComplexity: Record<string, number>;
  avgLatency: Record<string, number>;
}

/** Daily cost record for a single user */
export interface UserDailyCost {
  date: string; // YYYY-MM-DD
  totalCost: number;
}

/** Budget tiers with daily limits */
export const BUDGET_LIMITS: Record<string, number> = {
  free: 0.50,
  pro: 5.00,
  enterprise: 50.00,
  admin: Infinity,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cost per 1M tokens (input/output avg) - relative tiers 1-5 */
export const PROVIDER_COST_TIERS: Record<LLMProvider, number> = {
  cerebras: 1,
  deepseek: 1,
  gemini: 2,
  xai: 3,
  openai: 4,
  anthropic: 5,
};

/** Models considered "powerful" - best for complex tasks */
export const POWERFUL_MODELS = new Set([
  "gpt-4o",
  "gpt-4-turbo",
  "claude-3-opus",
  "claude-3.5-sonnet",
  "gemini-2.5-pro",
  "grok-3",
]);

/** Efficient (cheaper/faster) model per provider - best for simple tasks */
export const EFFICIENT_MODELS: Record<LLMProvider, string> = {
  cerebras: "llama-3.3-70b",
  deepseek: "deepseek-chat",
  gemini: "gemini-2.5-flash",
  xai: "grok-4.1-fast",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-haiku",
};

/** Powerful (higher-quality) model per provider */
const POWERFUL_MODEL_MAP: Record<LLMProvider, string> = {
  cerebras: "llama-3.3-70b",
  deepseek: "deepseek-chat",
  gemini: "gemini-2.5-pro",
  xai: "grok-3",
  openai: "gpt-4o",
  anthropic: "claude-3.5-sonnet",
};

const ALL_PROVIDERS: LLMProvider[] = [
  "cerebras",
  "deepseek",
  "gemini",
  "xai",
  "openai",
  "anthropic",
];

const DEFAULT_CONFIG: SmartRouterConfig = {
  degradedCooldownMs: 300_000, // 5 minutes
  healthCheckIntervalMs: 60_000, // 1 minute
  maxConsecutiveFailures: 3,
  costAwareRouting: true,
};

const MAX_ROUTING_LOG = 1000;

// ---------------------------------------------------------------------------
// SmartRouter Class
// ---------------------------------------------------------------------------

export class SmartRouter {
  readonly config: SmartRouterConfig;
  readonly providerHealth: Map<LLMProvider, ProviderHealth> = new Map();
  readonly routingLog: RoutingDecision[] = [];

  /** Per-provider circuit breaker state managed internally by the smart router */
  readonly circuitBreakers: Map<LLMProvider, CircuitBreakerState> = new Map();

  private latencySamples: Map<LLMProvider, number[]> = new Map();
  private requestCounts: Map<LLMProvider, { success: number; failure: number }> =
    new Map();
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  /** Per-user daily cost tracking: userId -> { date, totalCost } */
  private userDailyCosts: Map<string, UserDailyCost> = new Map();

  /** Counter of how many routing decisions used a fallback */
  private fallbackCount: number = 0;

  constructor(config: Partial<SmartRouterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize health for all providers
    for (const provider of ALL_PROVIDERS) {
      this.providerHealth.set(provider, this.createDefaultHealth(provider));
      this.latencySamples.set(provider, []);
      this.requestCounts.set(provider, { success: 0, failure: 0 });
      this.circuitBreakers.set(provider, {
        state: "closed",
        failures: 0,
        lastFailure: 0,
        lastSuccess: 0,
        openedAt: 0,
      });
    }

    this.startHealthCheckTimer();
  }

  // -------------------------------------------------------------------------
  // Main routing method
  // -------------------------------------------------------------------------

  route(query: string, requestedProvider?: LLMProvider): RoutingDecision {
    const complexity = this.classifyComplexity(query);
    const now = Date.now();

    // If a specific provider is requested and it is healthy, use it
    if (requestedProvider) {
      const health = this.providerHealth.get(requestedProvider);
      if (health && health.state !== "down") {
        const fallbackChain = this.buildFallbackChain(
          requestedProvider,
          complexity,
        );
        const decision: RoutingDecision = {
          provider: requestedProvider,
          fallbackChain,
          reason: `requested provider "${requestedProvider}" is ${health.state}`,
          complexity,
          estimatedCostTier: PROVIDER_COST_TIERS[requestedProvider],
          timestamp: now,
        };
        this.logDecision(decision);
        return decision;
      }
    }

    // Cost-aware routing
    const healthyProviders = this.getProvidersByState("healthy");
    const degradedProviders = this.getProvidersByState("degraded");
    const availableProviders =
      healthyProviders.length > 0 ? healthyProviders : degradedProviders;

    // If nothing is available at all, pick the least-bad option
    const candidatePool =
      availableProviders.length > 0 ? availableProviders : ALL_PROVIDERS;

    let selectedProvider: LLMProvider;
    let reason: string;

    if (this.config.costAwareRouting) {
      if (complexity === "simple") {
        // Pick cheapest healthy provider
        selectedProvider = this.cheapestProvider(candidatePool);
        reason = `cost-aware: cheapest healthy provider for simple query (tier ${PROVIDER_COST_TIERS[selectedProvider]})`;
      } else if (complexity === "complex") {
        // Pick most capable (highest cost tier = most capable) healthy provider
        selectedProvider = this.mostCapableProvider(candidatePool);
        reason = `cost-aware: most capable provider for complex query (tier ${PROVIDER_COST_TIERS[selectedProvider]})`;
      } else {
        // Moderate: balance cost and capability - pick mid-tier
        selectedProvider = this.balancedProvider(candidatePool);
        reason = `cost-aware: balanced provider for moderate query (tier ${PROVIDER_COST_TIERS[selectedProvider]})`;
      }
    } else {
      // No cost awareness: pick provider with best health
      selectedProvider = this.healthiestProvider(candidatePool);
      reason = `health-based: best health score among available providers`;
    }

    const fallbackChain = this.buildFallbackChain(selectedProvider, complexity);

    const decision: RoutingDecision = {
      provider: selectedProvider,
      fallbackChain,
      reason,
      complexity,
      estimatedCostTier: PROVIDER_COST_TIERS[selectedProvider],
      timestamp: now,
    };

    this.logDecision(decision);
    return decision;
  }

  // -------------------------------------------------------------------------
  // Recording success / failure
  // -------------------------------------------------------------------------

  recordSuccess(provider: LLMProvider, latencyMs: number): void {
    const health = this.providerHealth.get(provider);
    if (!health) return;

    health.consecutiveFailures = 0;
    health.lastSuccessTime = Date.now();

    // If was degraded, recovery via success
    if (health.state === "degraded") {
      health.state = "healthy";
      health.degradedUntil = null;
    }

    // Update circuit breaker: success in half-open closes it
    const cb = this.circuitBreakers.get(provider);
    if (cb) {
      cb.lastSuccess = Date.now();
      cb.failures = 0;
      if (cb.state === "half-open" || cb.state === "open") {
        cb.state = "closed";
        cb.openedAt = 0;
      }
    }

    // Update latency tracking
    const samples = this.latencySamples.get(provider) ?? [];
    samples.push(latencyMs);
    if (samples.length > 100) samples.shift();
    this.latencySamples.set(provider, samples);
    health.avgLatencyMs = this.computeAvgLatency(provider);

    // Update request counts
    const counts = this.requestCounts.get(provider) ?? {
      success: 0,
      failure: 0,
    };
    counts.success++;
    this.requestCounts.set(provider, counts);
    health.errorRate = this.computeErrorRate(provider);
  }

  recordFailure(provider: LLMProvider, _error: string): void {
    const health = this.providerHealth.get(provider);
    if (!health) return;

    health.consecutiveFailures++;
    health.lastFailureTime = Date.now();

    // Update request counts
    const counts = this.requestCounts.get(provider) ?? {
      success: 0,
      failure: 0,
    };
    counts.failure++;
    this.requestCounts.set(provider, counts);
    health.errorRate = this.computeErrorRate(provider);

    // Update circuit breaker state
    const cb = this.circuitBreakers.get(provider);
    if (cb) {
      cb.failures++;
      cb.lastFailure = Date.now();

      // 3 consecutive failures -> open circuit for 5 minutes
      if (cb.failures >= this.config.maxConsecutiveFailures && cb.state === "closed") {
        cb.state = "open";
        cb.openedAt = Date.now();
      }

      // Failure in half-open -> reopen
      if (cb.state === "half-open") {
        cb.state = "open";
        cb.openedAt = Date.now();
      }
    }

    // Check degradation threshold
    if (
      health.consecutiveFailures >= this.config.maxConsecutiveFailures &&
      health.state === "healthy"
    ) {
      health.state = "degraded";
      health.degradedUntil = Date.now() + this.config.degradedCooldownMs;
    }
  }

  // -------------------------------------------------------------------------
  // Health & stats queries
  // -------------------------------------------------------------------------

  getHealthStatus(): ProviderHealth[] {
    // Run health check pass before returning
    this.runHealthCheck();
    return Array.from(this.providerHealth.values());
  }

  getRoutingStats(): RoutingStats {
    const byProvider: Record<string, number> = {};
    const byComplexity: Record<string, number> = {};
    const latencySums: Record<string, { total: number; count: number }> = {};

    for (const decision of this.routingLog) {
      byProvider[decision.provider] =
        (byProvider[decision.provider] ?? 0) + 1;
      byComplexity[decision.complexity] =
        (byComplexity[decision.complexity] ?? 0) + 1;
    }

    // Compute avg latency from latency samples
    for (const [provider, samples] of this.latencySamples.entries()) {
      if (samples.length > 0) {
        const sum = samples.reduce((a, b) => a + b, 0);
        latencySums[provider] = { total: sum, count: samples.length };
      }
    }

    const avgLatency: Record<string, number> = {};
    for (const [provider, data] of Object.entries(latencySums)) {
      avgLatency[provider] = Math.round(data.total / data.count);
    }

    return {
      totalDecisions: this.routingLog.length,
      byProvider,
      byComplexity,
      avgLatency,
    };
  }

  // -------------------------------------------------------------------------
  // Fallback chain with circuit breaker awareness
  // -------------------------------------------------------------------------

  /**
   * Select a model with automatic fallback when circuits are open.
   * Skips providers with open circuits and cascades through tiers.
   */
  selectModelWithFallback(
    query: string,
    options?: {
      userModelOverride?: string;
      providerPreferences?: LLMProvider[];
      userId?: string;
      userTier?: string;
    },
  ): FallbackResult {
    const complexity = this.classifyComplexity(query);

    // Check budget enforcement
    let budgetWarning = false;
    let budgetExhausted = false;
    if (options?.userId && options?.userTier) {
      const remaining = this.getRemainingBudget(options.userId, options.userTier);
      const limit = BUDGET_LIMITS[options.userTier] ?? BUDGET_LIMITS.free;
      if (remaining <= 0) {
        budgetExhausted = true;
      } else if (remaining <= limit * 0.2) {
        budgetWarning = true;
      }
    }

    // If user provided a model override, honor it (with cheapest provider if budget exhausted)
    if (options?.userModelOverride) {
      // Find which provider owns this model
      let ownerProvider: LLMProvider | undefined;
      for (const [provider, model] of Object.entries(EFFICIENT_MODELS)) {
        if (model === options.userModelOverride) {
          ownerProvider = provider as LLMProvider;
          break;
        }
      }
      if (!ownerProvider) {
        for (const [provider, model] of Object.entries(POWERFUL_MODEL_MAP)) {
          if (model === options.userModelOverride) {
            ownerProvider = provider as LLMProvider;
            break;
          }
        }
      }

      if (ownerProvider && !this.isCircuitOpen(ownerProvider)) {
        return {
          model: options.userModelOverride,
          provider: ownerProvider,
          reason: "user model override",
          fallbackUsed: false,
          budgetWarning,
        };
      }
    }

    // Build candidate list by tier
    const tierProviders = this.getProvidersByTier(complexity);

    // Apply provider preferences if supplied
    if (options?.providerPreferences && options.providerPreferences.length > 0) {
      const prefSet = new Set(options.providerPreferences);
      tierProviders.sort((a, b) => {
        const aInPref = prefSet.has(a) ? 0 : 1;
        const bInPref = prefSet.has(b) ? 0 : 1;
        return aInPref - bInPref;
      });
    }

    // If budget exhausted, force cheapest available
    if (budgetExhausted) {
      const cheapest = this.cheapestAvailableProvider();
      return {
        model: EFFICIENT_MODELS[cheapest],
        provider: cheapest,
        reason: "budget exhausted - forced cheapest provider",
        fallbackUsed: tierProviders[0] !== cheapest,
        originalProvider: tierProviders[0] !== cheapest ? tierProviders[0] : undefined,
        budgetWarning: true,
      };
    }

    // Sort by lowest P50 latency among non-open-circuit providers
    const available = tierProviders.filter((p) => !this.isCircuitOpen(p));

    // Sort available by P50 latency (prefer lowest)
    available.sort((a, b) => this.getLatencyP50(a) - this.getLatencyP50(b));

    if (available.length > 0) {
      const selected = available[0];
      const model =
        complexity === "complex"
          ? (POWERFUL_MODEL_MAP[selected] ?? EFFICIENT_MODELS[selected])
          : EFFICIENT_MODELS[selected];

      return {
        model,
        provider: selected,
        reason: `selected for ${complexity} query (lowest latency available)`,
        fallbackUsed: false,
        budgetWarning,
      };
    }

    // All in tier exhausted -> try lower tier
    const lowerTierProviders = this.getLowerTierProviders(complexity);
    const lowerAvailable = lowerTierProviders.filter((p) => !this.isCircuitOpen(p));

    if (lowerAvailable.length > 0) {
      const selected = lowerAvailable[0];
      this.fallbackCount++;
      return {
        model: EFFICIENT_MODELS[selected],
        provider: selected,
        reason: `fallback to lower tier - all ${complexity} providers have open circuits`,
        fallbackUsed: true,
        originalProvider: tierProviders[0],
        budgetWarning,
      };
    }

    // Final fallback: cheapest model always available regardless of circuit
    const cheapest = this.cheapestProvider(ALL_PROVIDERS);
    this.fallbackCount++;
    return {
      model: EFFICIENT_MODELS[cheapest],
      provider: cheapest,
      reason: "final fallback - all circuits open, using cheapest provider",
      fallbackUsed: true,
      originalProvider: tierProviders[0],
      budgetWarning,
    };
  }

  /**
   * Enhanced selectModel that skips open circuits, factors in P50 latency,
   * and supports user-level provider preferences.
   */
  selectModel(
    query: string,
    options?: {
      userModelOverride?: string;
      providerPreferences?: LLMProvider[];
      userId?: string;
      userTier?: string;
    },
  ): FallbackResult {
    return this.selectModelWithFallback(query, options);
  }

  // -------------------------------------------------------------------------
  // Budget tracking
  // -------------------------------------------------------------------------

  /**
   * Track a request cost for a user. Accumulates daily.
   */
  trackRequestCost(userId: string, cost: number): void {
    const today = new Date().toISOString().slice(0, 10);
    const existing = this.userDailyCosts.get(userId);

    if (existing && existing.date === today) {
      existing.totalCost += cost;
    } else {
      this.userDailyCosts.set(userId, { date: today, totalCost: cost });
    }
  }

  /**
   * Get the remaining daily budget for a user.
   */
  getRemainingBudget(userId: string, userTier: string): number {
    const limit = BUDGET_LIMITS[userTier] ?? BUDGET_LIMITS.free;
    const today = new Date().toISOString().slice(0, 10);
    const record = this.userDailyCosts.get(userId);

    if (!record || record.date !== today) {
      return limit;
    }

    return Math.max(0, limit - record.totalCost);
  }

  // -------------------------------------------------------------------------
  // SmartRouterStats API
  // -------------------------------------------------------------------------

  getSmartRouterStats(): SmartRouterStats {
    const providers: ProviderStats[] = [];
    const cbRecord: Record<string, CircuitBreakerState> = {};

    let totalRequests = 0;

    for (const provider of ALL_PROVIDERS) {
      const health = this.providerHealth.get(provider)!;
      const cb = this.circuitBreakers.get(provider)!;
      const counts = this.requestCounts.get(provider) ?? { success: 0, failure: 0 };

      totalRequests += counts.success + counts.failure;
      cbRecord[provider] = { ...cb };

      providers.push({
        provider,
        health: { ...health },
        circuitBreaker: { ...cb },
        requestCount: { ...counts },
        latencyP50: this.getLatencyP50(provider),
        latencyP95: this.getLatencyP95(provider),
      });
    }

    return {
      providers,
      circuitBreakers: cbRecord,
      totalRequests,
      fallbackRate: totalRequests > 0 ? this.fallbackCount / totalRequests : 0,
    };
  }

  // -------------------------------------------------------------------------
  // Health check timer (public start/stop)
  // -------------------------------------------------------------------------

  /**
   * Start periodic health checks. Checks degraded providers every 60s.
   * For each open circuit past the cooldown, transitions to half-open.
   */
  startHealthChecks(): void {
    // Stop any existing timer first
    this.stopHealthChecks();
    this.healthCheckTimer = setInterval(() => {
      this.runHealthCheck();
    }, this.config.healthCheckIntervalMs);

    if (this.healthCheckTimer && typeof this.healthCheckTimer === "object" && "unref" in this.healthCheckTimer) {
      (this.healthCheckTimer as NodeJS.Timeout).unref();
    }
  }

  /**
   * Stop the periodic health check timer.
   */
  stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Circuit breaker queries
  // -------------------------------------------------------------------------

  /** Check if a provider's circuit breaker is open */
  isCircuitOpen(provider: LLMProvider): boolean {
    const cb = this.circuitBreakers.get(provider);
    if (!cb) return false;

    // Transition open -> half-open if cooldown has passed
    if (cb.state === "open" && cb.openedAt > 0) {
      const elapsed = Date.now() - cb.openedAt;
      if (elapsed >= this.config.degradedCooldownMs) {
        cb.state = "half-open";
        return false; // allow probe
      }
    }

    return cb.state === "open";
  }

  /** Get the circuit breaker state for a provider */
  getCircuitBreakerState(provider: LLMProvider): CircuitBreakerState | undefined {
    const cb = this.circuitBreakers.get(provider);
    return cb ? { ...cb } : undefined;
  }

  // -------------------------------------------------------------------------
  // Model recommendation
  // -------------------------------------------------------------------------

  getRecommendedModel(
    provider: LLMProvider,
    complexity: string,
  ): string {
    if (complexity === "complex") {
      return POWERFUL_MODEL_MAP[provider] ?? EFFICIENT_MODELS[provider];
    }
    return EFFICIENT_MODELS[provider];
  }

  // -------------------------------------------------------------------------
  // Complexity classification
  // -------------------------------------------------------------------------

  classifyComplexity(query: string): "simple" | "moderate" | "complex" {
    const tokenEstimate = Math.ceil(query.length / 4);
    const hasCodeBlocks = /```[\s\S]*```/.test(query);
    const hasMultiStep =
      /step[- ]?by[- ]?step|multi[- ]?step|first[\s,].*then[\s,].*finally/i.test(
        query,
      );

    // Simple: short queries without code
    if (tokenEstimate < 50 && !hasCodeBlocks && !hasMultiStep) {
      return "simple";
    }

    // Complex: long queries, code blocks, or multi-step
    if (tokenEstimate > 200 || hasCodeBlocks || hasMultiStep) {
      return "complex";
    }

    return "moderate";
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  destroy(): void {
    this.stopHealthChecks();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private createDefaultHealth(provider: LLMProvider): ProviderHealth {
    return {
      provider,
      state: "healthy",
      consecutiveFailures: 0,
      lastFailureTime: null,
      lastSuccessTime: null,
      degradedUntil: null,
      avgLatencyMs: 0,
      errorRate: 0,
      lastHealthCheck: Date.now(),
    };
  }

  private startHealthCheckTimer(): void {
    this.healthCheckTimer = setInterval(() => {
      this.runHealthCheck();
    }, this.config.healthCheckIntervalMs);

    if (this.healthCheckTimer && typeof this.healthCheckTimer === "object" && "unref" in this.healthCheckTimer) {
      (this.healthCheckTimer as NodeJS.Timeout).unref();
    }
  }

  private runHealthCheck(): void {
    const now = Date.now();

    for (const [provider, health] of this.providerHealth) {
      health.lastHealthCheck = now;

      // Recovery: if degraded cooldown has passed, mark healthy again
      if (
        health.state === "degraded" &&
        health.degradedUntil !== null &&
        now >= health.degradedUntil
      ) {
        health.state = "healthy";
        health.degradedUntil = null;
        health.consecutiveFailures = 0;
      }

      // Check internal circuit breaker: open -> half-open after cooldown
      const cb = this.circuitBreakers.get(provider);
      if (cb && cb.state === "open" && cb.openedAt > 0) {
        const elapsed = now - cb.openedAt;
        if (elapsed >= this.config.degradedCooldownMs) {
          cb.state = "half-open";
        }
      }

      // Sync with external circuit breaker state for "down" detection
      try {
        const externalCb = getCircuitBreaker("__legacy__", health.provider);
        const cbState = externalCb.getState();
        if (cbState === CircuitState.OPEN) {
          health.state = "down";
        }
      } catch {
        // Circuit breaker not available for this provider - skip
      }
    }
  }

  private getProvidersByState(
    state: "healthy" | "degraded" | "down",
  ): LLMProvider[] {
    const result: LLMProvider[] = [];
    for (const [provider, health] of this.providerHealth) {
      // Check if degraded cooldown expired before filtering
      if (
        health.state === "degraded" &&
        health.degradedUntil !== null &&
        Date.now() >= health.degradedUntil
      ) {
        health.state = "healthy";
        health.degradedUntil = null;
        health.consecutiveFailures = 0;
      }

      if (health.state === state) {
        result.push(provider);
      }
    }
    return result;
  }

  private cheapestProvider(candidates: LLMProvider[]): LLMProvider {
    return candidates.reduce((cheapest, p) =>
      PROVIDER_COST_TIERS[p] < PROVIDER_COST_TIERS[cheapest] ? p : cheapest,
    );
  }

  private mostCapableProvider(candidates: LLMProvider[]): LLMProvider {
    return candidates.reduce((best, p) =>
      PROVIDER_COST_TIERS[p] > PROVIDER_COST_TIERS[best] ? p : best,
    );
  }

  private balancedProvider(candidates: LLMProvider[]): LLMProvider {
    // Pick the provider closest to the median cost tier
    const sorted = [...candidates].sort(
      (a, b) => PROVIDER_COST_TIERS[a] - PROVIDER_COST_TIERS[b],
    );
    const midIdx = Math.floor(sorted.length / 2);
    return sorted[midIdx];
  }

  private healthiestProvider(candidates: LLMProvider[]): LLMProvider {
    let best = candidates[0];
    let bestScore = -1;

    for (const p of candidates) {
      const health = this.providerHealth.get(p);
      if (!health) continue;

      // Simple health score: low error rate + low latency = good
      const score =
        (1 - health.errorRate) * 0.6 +
        (health.avgLatencyMs > 0
          ? Math.min(1, 500 / health.avgLatencyMs)
          : 0.5) *
          0.4;

      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }

    return best;
  }

  private buildFallbackChain(
    primary: LLMProvider,
    complexity: "simple" | "moderate" | "complex",
  ): LLMProvider[] {
    // Build fallback chain: exclude primary, exclude down providers,
    // order by cost (cheap first for simple, expensive first for complex)
    const downProviders = new Set(this.getProvidersByState("down"));
    const degradedProviders = new Set(this.getProvidersByState("degraded"));

    const candidates = ALL_PROVIDERS.filter(
      (p) => p !== primary && !downProviders.has(p),
    );

    // Sort: healthy before degraded, then by cost appropriateness
    candidates.sort((a, b) => {
      const aHealthy = !degradedProviders.has(a) ? 0 : 1;
      const bHealthy = !degradedProviders.has(b) ? 0 : 1;
      if (aHealthy !== bHealthy) return aHealthy - bHealthy;

      if (complexity === "simple") {
        return PROVIDER_COST_TIERS[a] - PROVIDER_COST_TIERS[b]; // cheap first
      }
      if (complexity === "complex") {
        return PROVIDER_COST_TIERS[b] - PROVIDER_COST_TIERS[a]; // expensive first
      }
      // Moderate: sort by cost ascending
      return PROVIDER_COST_TIERS[a] - PROVIDER_COST_TIERS[b];
    });

    return candidates;
  }

  /** Get providers suitable for a given complexity tier, ordered by cost appropriateness */
  private getProvidersByTier(complexity: "simple" | "moderate" | "complex"): LLMProvider[] {
    const sorted = [...ALL_PROVIDERS];
    if (complexity === "simple") {
      sorted.sort((a, b) => PROVIDER_COST_TIERS[a] - PROVIDER_COST_TIERS[b]);
    } else if (complexity === "complex") {
      sorted.sort((a, b) => PROVIDER_COST_TIERS[b] - PROVIDER_COST_TIERS[a]);
    } else {
      // moderate: balanced, sort ascending
      sorted.sort((a, b) => PROVIDER_COST_TIERS[a] - PROVIDER_COST_TIERS[b]);
    }
    return sorted;
  }

  /** Get providers from lower tiers as fallback when primary tier is exhausted */
  private getLowerTierProviders(complexity: "simple" | "moderate" | "complex"): LLMProvider[] {
    // For complex queries falling back, try moderate-tier (mid-cost) providers
    // For moderate queries falling back, try simple-tier (cheapest) providers
    // For simple queries, there's no lower tier
    if (complexity === "complex") {
      return this.getProvidersByTier("moderate");
    } else if (complexity === "moderate") {
      return this.getProvidersByTier("simple");
    }
    // Simple: just return all sorted by cost
    return this.getProvidersByTier("simple");
  }

  /** Find cheapest provider with a non-open circuit */
  private cheapestAvailableProvider(): LLMProvider {
    const available = ALL_PROVIDERS.filter((p) => !this.isCircuitOpen(p));
    if (available.length > 0) {
      return this.cheapestProvider(available);
    }
    // All circuits open - return cheapest regardless
    return this.cheapestProvider(ALL_PROVIDERS);
  }

  /** Compute P50 latency for a provider */
  getLatencyP50(provider: LLMProvider): number {
    return this.computePercentile(provider, 0.5);
  }

  /** Compute P95 latency for a provider */
  getLatencyP95(provider: LLMProvider): number {
    return this.computePercentile(provider, 0.95);
  }

  private computePercentile(provider: LLMProvider, percentile: number): number {
    const samples = this.latencySamples.get(provider);
    if (!samples || samples.length === 0) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const idx = Math.min(
      Math.floor(sorted.length * percentile),
      sorted.length - 1,
    );
    return sorted[idx];
  }

  private computeAvgLatency(provider: LLMProvider): number {
    const samples = this.latencySamples.get(provider);
    if (!samples || samples.length === 0) return 0;
    return Math.round(
      samples.reduce((a, b) => a + b, 0) / samples.length,
    );
  }

  private computeErrorRate(provider: LLMProvider): number {
    const counts = this.requestCounts.get(provider);
    if (!counts) return 0;
    const total = counts.success + counts.failure;
    if (total === 0) return 0;
    return counts.failure / total;
  }

  private logDecision(decision: RoutingDecision): void {
    this.routingLog.push(decision);
    if (this.routingLog.length > MAX_ROUTING_LOG) {
      this.routingLog.splice(0, this.routingLog.length - MAX_ROUTING_LOG);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

let _instance: SmartRouter | null = null;

export function getSmartRouter(
  config?: Partial<SmartRouterConfig>,
): SmartRouter {
  if (!_instance) {
    _instance = new SmartRouter(config);
  }
  return _instance;
}

export function resetSmartRouter(): void {
  if (_instance) {
    _instance.destroy();
    _instance = null;
  }
}

// ---------------------------------------------------------------------------
// Convenience exports wrapping singleton
// ---------------------------------------------------------------------------

export function getRouterStats(): SmartRouterStats {
  return getSmartRouter().getSmartRouterStats();
}

export function startHealthChecks(): void {
  getSmartRouter().startHealthChecks();
}

export function stopHealthChecks(): void {
  getSmartRouter().stopHealthChecks();
}

export function getRemainingBudget(userId: string, userTier: string): number {
  return getSmartRouter().getRemainingBudget(userId, userTier);
}
