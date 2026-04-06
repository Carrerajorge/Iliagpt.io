import { Counter, Gauge, Histogram, Registry } from "prom-client";

export type LLMMetricProvider = "xai" | "gemini" | "openai" | "anthropic" | "deepseek" | "cerebras";
export type LLMMetricOperation = "chat" | "stream";
export type LLMMetricResult = "success" | "error" | "cache_hit" | "rate_limited" | "deduplicated";

const registry = new Registry();

const requestCounter = new Counter({
  name: "llm_gateway_requests_total",
  help: "Total LLM gateway requests by provider, operation and result",
  labelNames: ["provider", "operation", "result"] as const,
  registers: [registry],
});

const latencyHistogram = new Histogram({
  name: "llm_gateway_latency_ms",
  help: "LLM gateway provider latency in milliseconds",
  labelNames: ["provider", "operation", "result"] as const,
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 300000],
  registers: [registry],
});

const tokenCounter = new Counter({
  name: "llm_gateway_tokens_total",
  help: "LLM gateway token usage by provider and direction",
  labelNames: ["provider", "direction"] as const,
  registers: [registry],
});

const fallbackCounter = new Counter({
  name: "llm_gateway_fallbacks_total",
  help: "Total LLM gateway fallback attempts between providers",
  labelNames: ["from_provider", "to_provider", "operation"] as const,
  registers: [registry],
});

const cacheHitCounter = new Counter({
  name: "llm_gateway_cache_hits_total",
  help: "Total LLM gateway cache hits by provider and cache source",
  labelNames: ["provider", "source"] as const,
  registers: [registry],
});

const rateLimitCounter = new Counter({
  name: "llm_gateway_rate_limit_hits_total",
  help: "Total LLM gateway user-level rate limit hits",
  registers: [registry],
});

const providerConcurrencyGauge = new Gauge({
  name: "llm_gateway_provider_concurrency",
  help: "Current LLM gateway provider concurrency state",
  labelNames: ["provider", "state"] as const,
  registers: [registry],
});

const gatewayStateGauge = new Gauge({
  name: "llm_gateway_state",
  help: "Current LLM gateway operational state",
  labelNames: ["state"] as const,
  registers: [registry],
});

export function recordLlmGatewayRequest(args: {
  provider: LLMMetricProvider;
  operation: LLMMetricOperation;
  result: LLMMetricResult;
  latencyMs?: number;
}): void {
  requestCounter.inc({
    provider: args.provider,
    operation: args.operation,
    result: args.result,
  });

  if (typeof args.latencyMs === "number" && Number.isFinite(args.latencyMs)) {
    latencyHistogram.observe(
      {
        provider: args.provider,
        operation: args.operation,
        result: args.result,
      },
      args.latencyMs,
    );
  }
}

export function recordLlmGatewayTokens(args: {
  provider: LLMMetricProvider;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}): void {
  if ((args.promptTokens ?? 0) > 0) {
    tokenCounter.inc({ provider: args.provider, direction: "prompt" }, args.promptTokens);
  }
  if ((args.completionTokens ?? 0) > 0) {
    tokenCounter.inc({ provider: args.provider, direction: "completion" }, args.completionTokens);
  }
  if ((args.totalTokens ?? 0) > 0) {
    tokenCounter.inc({ provider: args.provider, direction: "total" }, args.totalTokens);
  }
}

export function recordLlmGatewayFallback(args: {
  fromProvider: LLMMetricProvider;
  toProvider: LLMMetricProvider;
  operation: LLMMetricOperation;
}): void {
  fallbackCounter.inc({
    from_provider: args.fromProvider,
    to_provider: args.toProvider,
    operation: args.operation,
  });
}

export function recordLlmGatewayCacheHit(args: {
  provider: LLMMetricProvider;
  source: "redis" | "memory";
}): void {
  cacheHitCounter.inc({
    provider: args.provider,
    source: args.source,
  });
}

export function recordLlmGatewayRateLimitHit(): void {
  rateLimitCounter.inc();
}

export function setLlmGatewayProviderConcurrency(
  provider: LLMMetricProvider,
  state: { activeCount: number; pendingCount: number; maxConcurrent: number },
): void {
  providerConcurrencyGauge.set({ provider, state: "active" }, state.activeCount);
  providerConcurrencyGauge.set({ provider, state: "pending" }, state.pendingCount);
  providerConcurrencyGauge.set({ provider, state: "limit" }, state.maxConcurrent);
}

export function setLlmGatewayStateGauge(state: string, value: number): void {
  gatewayStateGauge.set({ state }, value);
}

export async function getLlmGatewayMetricsText(): Promise<string> {
  return registry.metrics();
}

export function resetLlmGatewayMetrics(): void {
  registry.resetMetrics();
}
