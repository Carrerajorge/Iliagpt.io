import { beforeEach, describe, expect, it } from "vitest";

import {
  getLlmGatewayMetricsText,
  recordLlmGatewayCacheHit,
  recordLlmGatewayFallback,
  recordLlmGatewayRateLimitHit,
  recordLlmGatewayRequest,
  recordLlmGatewayTokens,
  resetLlmGatewayMetrics,
  setLlmGatewayProviderConcurrency,
  setLlmGatewayStateGauge,
} from "../lib/llmGatewayMetrics";

describe("llmGatewayMetrics", () => {
  beforeEach(() => {
    resetLlmGatewayMetrics();
  });

  it("exports gateway request, token and state metrics", async () => {
    recordLlmGatewayRequest({
      provider: "openai",
      operation: "chat",
      result: "success",
      latencyMs: 125,
    });
    recordLlmGatewayTokens({
      provider: "openai",
      promptTokens: 40,
      completionTokens: 60,
      totalTokens: 100,
    });
    recordLlmGatewayCacheHit({ provider: "openai", source: "redis" });
    recordLlmGatewayFallback({
      fromProvider: "gemini",
      toProvider: "openai",
      operation: "chat",
    });
    recordLlmGatewayRateLimitHit();
    setLlmGatewayProviderConcurrency("openai", {
      activeCount: 2,
      pendingCount: 1,
      maxConcurrent: 8,
    });
    setLlmGatewayStateGauge("cache_entries", 3);

    const metricsText = await getLlmGatewayMetricsText();

    expect(metricsText).toContain('llm_gateway_requests_total{provider="openai",operation="chat",result="success"} 1');
    expect(metricsText).toContain('llm_gateway_tokens_total{provider="openai",direction="total"} 100');
    expect(metricsText).toContain('llm_gateway_cache_hits_total{provider="openai",source="redis"} 1');
    expect(metricsText).toContain('llm_gateway_fallbacks_total{from_provider="gemini",to_provider="openai",operation="chat"} 1');
    expect(metricsText).toContain("llm_gateway_rate_limit_hits_total 1");
    expect(metricsText).toContain('llm_gateway_provider_concurrency{provider="openai",state="active"} 2');
    expect(metricsText).toContain('llm_gateway_state{state="cache_entries"} 3');
  });
});
