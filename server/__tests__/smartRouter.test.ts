import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SmartRouter,
  PROVIDER_COST_TIERS,
  EFFICIENT_MODELS,
  BUDGET_LIMITS,
  type LLMProvider,
  type SmartRouterConfig,
} from "../llm/smartRouter";

// Mock the circuit breaker module so tests don't depend on global state
vi.mock("../lib/circuitBreaker", () => {
  const CircuitState = {
    CLOSED: "CLOSED",
    OPEN: "OPEN",
    HALF_OPEN: "HALF_OPEN",
  };

  const mockBreakers = new Map<string, { state: string }>();

  return {
    CircuitState,
    getCircuitBreaker: (_tenantId: string, provider: string) => {
      if (!mockBreakers.has(provider)) {
        mockBreakers.set(provider, { state: CircuitState.CLOSED });
      }
      const breaker = mockBreakers.get(provider)!;
      return {
        getState: () => breaker.state,
      };
    },
    __mockBreakers: mockBreakers,
  };
});

function createRouter(config?: Partial<SmartRouterConfig>): SmartRouter {
  return new SmartRouter({
    healthCheckIntervalMs: 999_999, // disable periodic checks in tests
    ...config,
  });
}

describe("SmartRouter", () => {
  let router: SmartRouter;

  beforeEach(() => {
    router = createRouter();
  });

  afterEach(() => {
    router.destroy();
  });

  // -----------------------------------------------------------------------
  // 1. analyzeComplexity returns "simple" for greetings
  // -----------------------------------------------------------------------
  it("classifies short greetings as simple", () => {
    expect(router.classifyComplexity("hello")).toBe("simple");
    expect(router.classifyComplexity("hi there")).toBe("simple");
    expect(router.classifyComplexity("hey")).toBe("simple");
    expect(router.classifyComplexity("what is 2+2?")).toBe("simple");
  });

  // -----------------------------------------------------------------------
  // 2. analyzeComplexity returns "complex" for research queries
  // -----------------------------------------------------------------------
  it("classifies long research queries as complex", () => {
    const longQuery =
      "Please provide a step-by-step analysis of the economic implications " +
      "of artificial intelligence adoption in developing nations, including " +
      "labor market disruptions, GDP growth projections, and policy recommendations " +
      "for governments. First, outline the current state, then analyze projections, " +
      "and finally summarize the key takeaways with citations.";
    expect(router.classifyComplexity(longQuery)).toBe("complex");
  });

  it("classifies queries with code blocks as complex", () => {
    const codeQuery =
      "Fix this code:\n```typescript\nconst x = 1;\nconsole.log(x);\n```";
    expect(router.classifyComplexity(codeQuery)).toBe("complex");
  });

  // -----------------------------------------------------------------------
  // 3. analyzeComplexity returns "moderate" for code questions
  // -----------------------------------------------------------------------
  it("classifies medium-length questions as moderate", () => {
    // Need 50-200 tokens estimated (length/4 >= 50), no code blocks, no multi-step
    // 200 chars / 4 = 50 token estimate - right at the boundary
    const moderateQuery =
      "Can you explain how the JavaScript event loop works and how promises are scheduled " +
      "compared to setTimeout callbacks? I want to understand microtasks versus macrotasks in detail. " +
      "What is the difference in execution order between them?";
    expect(router.classifyComplexity(moderateQuery)).toBe("moderate");
  });

  // -----------------------------------------------------------------------
  // 4. selectModel respects user model override
  // -----------------------------------------------------------------------
  it("returns user model override when circuit is closed", () => {
    const result = router.selectModel("hello", {
      userModelOverride: "gpt-4o-mini",
    });
    expect(result.model).toBe("gpt-4o-mini");
    expect(result.provider).toBe("openai");
    expect(result.fallbackUsed).toBe(false);
    expect(result.reason).toContain("user model override");
  });

  // -----------------------------------------------------------------------
  // 5. selectModel degrades when budget exhausted
  // -----------------------------------------------------------------------
  it("forces cheapest provider when user budget is exhausted", () => {
    // Exhaust the free tier budget
    router.trackRequestCost("user-1", BUDGET_LIMITS.free + 0.01);

    const result = router.selectModel(
      "explain quantum computing in detail",
      {
        userId: "user-1",
        userTier: "free",
      },
    );

    expect(result.reason).toContain("budget exhausted");
    // Should pick the cheapest available provider
    const cheapestTier = Math.min(...Object.values(PROVIDER_COST_TIERS));
    expect(PROVIDER_COST_TIERS[result.provider]).toBe(cheapestTier);
  });

  // -----------------------------------------------------------------------
  // 6. circuit breaker opens after 3 failures
  // -----------------------------------------------------------------------
  it("opens circuit breaker after 3 consecutive failures", () => {
    const provider: LLMProvider = "openai";

    router.recordFailure(provider, "timeout");
    router.recordFailure(provider, "timeout");
    expect(router.isCircuitOpen(provider)).toBe(false);

    router.recordFailure(provider, "timeout");
    expect(router.isCircuitOpen(provider)).toBe(true);

    const state = router.getCircuitBreakerState(provider);
    expect(state).toBeDefined();
    expect(state!.state).toBe("open");
    expect(state!.failures).toBe(3);
  });

  // -----------------------------------------------------------------------
  // 7. circuit breaker closes after recovery period
  // -----------------------------------------------------------------------
  it("transitions circuit from open to half-open after cooldown and closes on success", () => {
    const provider: LLMProvider = "anthropic";

    // Open the circuit
    router.recordFailure(provider, "error");
    router.recordFailure(provider, "error");
    router.recordFailure(provider, "error");
    expect(router.isCircuitOpen(provider)).toBe(true);

    // Simulate cooldown by directly setting openedAt in the past
    const cb = router.circuitBreakers.get(provider)!;
    cb.openedAt = Date.now() - 300_001; // just past the 5-min cooldown

    // isCircuitOpen should now return false (transitions to half-open)
    expect(router.isCircuitOpen(provider)).toBe(false);
    expect(router.circuitBreakers.get(provider)!.state).toBe("half-open");

    // A success should close it fully
    router.recordSuccess(provider, 200);
    expect(router.circuitBreakers.get(provider)!.state).toBe("closed");
  });

  // -----------------------------------------------------------------------
  // 8. fallback selects next provider when primary is down
  // -----------------------------------------------------------------------
  it("falls back to another provider when primary circuit is open", () => {
    // Open circuit for anthropic (most capable)
    const expensive: LLMProvider = "anthropic";
    router.recordFailure(expensive, "err");
    router.recordFailure(expensive, "err");
    router.recordFailure(expensive, "err");

    // Make a complex query that would normally prefer anthropic
    const result = router.selectModelWithFallback(
      "Please provide a step-by-step multi-step analysis of climate change, first analyzing data then making projections, finally summarizing",
    );

    // Should not select the provider with open circuit
    expect(result.provider).not.toBe("anthropic");
  });

  // -----------------------------------------------------------------------
  // 9. fallback cascades to lower tier when all in tier are down
  // -----------------------------------------------------------------------
  it("cascades to lower tier when all providers have open circuits", () => {
    // Open circuits for ALL providers
    for (const provider of [
      "cerebras",
      "deepseek",
      "gemini",
      "xai",
      "openai",
      "anthropic",
    ] as LLMProvider[]) {
      router.recordFailure(provider, "err");
      router.recordFailure(provider, "err");
      router.recordFailure(provider, "err");
    }

    // Should still return a result (final fallback)
    const result = router.selectModelWithFallback("hello");

    expect(result.fallbackUsed).toBe(true);
    expect(result.reason).toContain("final fallback");
    expect(result.model).toBeDefined();
    expect(result.provider).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // 10. trackLatency maintains rolling window
  // -----------------------------------------------------------------------
  it("maintains a rolling window of latency samples (max 100)", () => {
    const provider: LLMProvider = "gemini";

    // Add 105 samples
    for (let i = 0; i < 105; i++) {
      router.recordSuccess(provider, 100 + i);
    }

    // P50 should reflect recent samples (not the oldest ones which were evicted)
    const p50 = router.getLatencyP50(provider);
    // With 100 samples from 5..104 offsets (values 105..204), P50 should be around 155
    expect(p50).toBeGreaterThan(100);
    expect(p50).toBeLessThan(250);

    // Average should also be reasonable
    const health = router.providerHealth.get(provider)!;
    expect(health.avgLatencyMs).toBeGreaterThan(100);
  });

  // -----------------------------------------------------------------------
  // 11. trackRequestCost accumulates daily
  // -----------------------------------------------------------------------
  it("accumulates daily request costs for a user", () => {
    const userId = "user-cost-test";
    const tier = "pro";
    const limit = BUDGET_LIMITS[tier];

    // Initially full budget
    expect(router.getRemainingBudget(userId, tier)).toBe(limit);

    // Track some costs
    router.trackRequestCost(userId, 1.0);
    expect(router.getRemainingBudget(userId, tier)).toBe(limit - 1.0);

    router.trackRequestCost(userId, 0.5);
    expect(router.getRemainingBudget(userId, tier)).toBe(limit - 1.5);

    // Exceeding budget should clamp to 0
    router.trackRequestCost(userId, limit);
    expect(router.getRemainingBudget(userId, tier)).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 12. health score favors providers with lower latency and higher success rate
  // -----------------------------------------------------------------------
  it("routes to provider with lower latency and higher success rate", () => {
    // Make openai slow and unreliable
    for (let i = 0; i < 10; i++) {
      router.recordSuccess("openai", 2000); // high latency
    }
    router.recordFailure("openai", "intermittent");

    // Make cerebras fast and reliable
    for (let i = 0; i < 10; i++) {
      router.recordSuccess("cerebras", 50); // low latency
    }

    // For a simple query with cost-aware routing, cerebras should be preferred
    // (it's both cheapest and fastest)
    const decision = router.route("hi");
    expect(decision.provider).toBe("cerebras");
  });

  // -----------------------------------------------------------------------
  // 13. getSmartRouterStats returns comprehensive stats
  // -----------------------------------------------------------------------
  it("returns comprehensive router stats", () => {
    router.recordSuccess("gemini", 150);
    router.recordSuccess("gemini", 200);
    router.recordFailure("openai", "timeout");

    const stats = router.getSmartRouterStats();

    expect(stats.providers).toHaveLength(6); // all providers
    expect(stats.totalRequests).toBe(3);
    expect(stats.circuitBreakers).toBeDefined();
    expect(typeof stats.fallbackRate).toBe("number");

    const geminiStats = stats.providers.find((p) => p.provider === "gemini");
    expect(geminiStats).toBeDefined();
    expect(geminiStats!.requestCount.success).toBe(2);
    expect(geminiStats!.latencyP50).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 14. budget warning at 80%
  // -----------------------------------------------------------------------
  it("returns budgetWarning when within 20% of limit", () => {
    const userId = "user-warn";
    const tier = "free";
    const limit = BUDGET_LIMITS[tier]; // 0.50

    // Spend 82% of budget
    router.trackRequestCost(userId, limit * 0.82);

    const result = router.selectModel("hello", {
      userId,
      userTier: tier,
    });

    expect(result.budgetWarning).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 15. selectModel factors in latency (prefers lowest P50)
  // -----------------------------------------------------------------------
  it("prefers provider with lowest P50 latency among available", () => {
    // Give all providers some latency data so none defaults to 0
    for (const p of ["cerebras", "deepseek", "gemini", "xai", "openai", "anthropic"] as LLMProvider[]) {
      for (let i = 0; i < 20; i++) {
        router.recordSuccess(p, 500);
      }
    }
    // Now make cerebras clearly fastest
    for (let i = 0; i < 80; i++) {
      router.recordSuccess("cerebras", 30);
    }

    const result = router.selectModel("hi");
    // cerebras should win: cheapest tier AND lowest latency after sorting
    expect(result.provider).toBe("cerebras");
  });

  // -----------------------------------------------------------------------
  // 16. provider preferences influence selection
  // -----------------------------------------------------------------------
  it("respects provider preferences when supplied", () => {
    const result = router.selectModel("hello", {
      providerPreferences: ["gemini"],
    });
    // gemini should be selected since it's preferred and all circuits are closed
    expect(result.provider).toBe("gemini");
  });

  // -----------------------------------------------------------------------
  // 17. getRemainingBudget returns full limit for unknown users
  // -----------------------------------------------------------------------
  it("returns full budget for a user with no tracked costs", () => {
    expect(router.getRemainingBudget("new-user", "pro")).toBe(
      BUDGET_LIMITS.pro,
    );
    expect(router.getRemainingBudget("new-user", "free")).toBe(
      BUDGET_LIMITS.free,
    );
    expect(router.getRemainingBudget("new-user", "enterprise")).toBe(
      BUDGET_LIMITS.enterprise,
    );
  });

  // -----------------------------------------------------------------------
  // 18. circuit breaker failure in half-open re-opens
  // -----------------------------------------------------------------------
  it("re-opens circuit breaker on failure during half-open state", () => {
    const provider: LLMProvider = "xai";

    // Open the circuit
    router.recordFailure(provider, "err");
    router.recordFailure(provider, "err");
    router.recordFailure(provider, "err");
    expect(router.isCircuitOpen(provider)).toBe(true);

    // Force half-open by setting openedAt in the past
    const cb = router.circuitBreakers.get(provider)!;
    cb.openedAt = Date.now() - 300_001;
    router.isCircuitOpen(provider); // triggers transition to half-open
    expect(cb.state).toBe("half-open");

    // Failure in half-open should re-open
    router.recordFailure(provider, "still broken");
    expect(cb.state).toBe("open");
    expect(cb.openedAt).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // Legacy tests preserved
  // -----------------------------------------------------------------------

  it("routes simple queries to the cheapest healthy provider", () => {
    const decision = router.route("hi");
    expect(decision.complexity).toBe("simple");
    expect(PROVIDER_COST_TIERS[decision.provider]).toBe(1);
    expect(decision.reason).toContain("cheapest");
  });

  it("routes complex queries to the most capable healthy provider", () => {
    const longQuery = "x".repeat(900);
    const decision = router.route(longQuery);
    expect(decision.complexity).toBe("complex");
    expect(PROVIDER_COST_TIERS[decision.provider]).toBe(5);
    expect(decision.reason).toContain("most capable");
  });

  it("uses the requested provider when it is healthy", () => {
    const decision = router.route("any query", "anthropic");
    expect(decision.provider).toBe("anthropic");
    expect(decision.reason).toContain("requested provider");
  });

  it("returns efficient model for simple and powerful for complex", () => {
    expect(router.getRecommendedModel("openai", "simple")).toBe("gpt-4o-mini");
    expect(router.getRecommendedModel("openai", "complex")).toBe("gpt-4o");
    expect(router.getRecommendedModel("anthropic", "simple")).toBe(
      "claude-3-haiku",
    );
    expect(router.getRecommendedModel("anthropic", "complex")).toBe(
      "claude-3.5-sonnet",
    );
  });

  it("falls back to health-based routing when cost-aware is disabled", () => {
    router.destroy();
    router = createRouter({ costAwareRouting: false });

    const decision = router.route("hi");
    expect(decision.reason).toContain("health-based");
  });
});
