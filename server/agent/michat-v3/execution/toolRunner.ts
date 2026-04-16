import { z } from "zod";
import { MichatError, wrapError } from "../errors";
import { withTimeout, jitter, sleep, clamp, nowISO, redactSecrets } from "../config";
import { Tracer } from "../observability/tracer";
import { RateLimiter } from "../resilience/rateLimiter";
import { Bulkhead } from "../resilience/bulkhead";
import { CircuitBreakerRegistry } from "../resilience/circuitBreaker";
import type { 
  ToolDefinition, 
  ToolContext, 
  ToolExecutionOptions, 
  ResolvedConfig, 
  Logger 
} from "../types";

export interface ToolRegistry {
  get: (name: string) => ToolDefinition<any, any>;
  has: (name: string) => boolean;
  list: () => Array<{ id: number; name: string; category: string; priority: string; description: string }>;
}

export class EnterpriseToolRunner {
  private tracer: Tracer;
  private rateLimiter: RateLimiter;
  private bulkhead: Bulkhead;
  private cbRegistry: CircuitBreakerRegistry;

  constructor(
    private registry: ToolRegistry,
    private cfg: ResolvedConfig,
    private logger: Logger
  ) {
    this.tracer = new Tracer(logger);
    this.rateLimiter = new RateLimiter(cfg.RL_BUCKET_CAPACITY, cfg.RL_REFILL_PER_SEC);
    this.bulkhead = new Bulkhead(cfg.TOOL_MAX_CONCURRENT_DEFAULT);
    this.cbRegistry = new CircuitBreakerRegistry(cfg);
  }

  async run(
    toolName: string,
    params: unknown,
    ctx: ToolContext,
    opt?: ToolExecutionOptions
  ): Promise<unknown> {
    const tool = this.registry.get(toolName);
    const options: ToolExecutionOptions = { ...tool.defaultOptions, ...opt };

    const cb = this.cbRegistry.get(`tool:${toolName}`);
    if (!cb.canExecute()) {
      ctx.metrics.inc("tool.circuit_open", { tool: toolName });
      throw new MichatError("E_CIRCUIT_OPEN", `Circuit open: ${toolName}`, {
        tool: toolName,
        circuit: cb.snapshot(),
      });
    }

    if (options.cacheKey) {
      const cached = ctx.cache.get(options.cacheKey);
      if (cached !== undefined) {
        ctx.metrics.inc("tool.cache_hit", { tool: toolName });
        cb.onSuccess();
        return cached;
      }
      ctx.metrics.inc("tool.cache_miss", { tool: toolName });
    }

    const rlKey = options.rateLimitKey ?? `tool:${toolName}`;
    if (!this.rateLimiter.allow(rlKey)) {
      ctx.metrics.inc("tool.rate_limited", { tool: toolName });
      cb.onFailure();
      throw new MichatError("E_RATE_LIMIT", `Rate limited: ${toolName}`, {
        tool: toolName,
        key: rlKey,
      });
    }

    const parsed = tool.schema.safeParse(params);
    if (!parsed.success) {
      ctx.metrics.inc("tool.bad_params", { tool: toolName });
      cb.onFailure();
      throw new MichatError(
        "E_BAD_PARAMS",
        `Invalid parameters for ${toolName}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        { tool: toolName, issues: parsed.error.issues }
      );
    }

    const retries = options.retries ?? 0;
    const base = options.retryBaseBackoffMs ?? 200;
    const maxB = options.retryMaxBackoffMs ?? 2500;
    const timeoutMs = options.timeoutMs ?? this.cfg.TIMEOUT_MS;

    ctx.events.emit("tool.started", {
      tool: toolName,
      traceId: ctx.traceId,
      requestId: ctx.requestId,
    });

    const attemptOnce = async (attempt: number): Promise<unknown> => {
      return await this.bulkhead.run(`tool:${toolName}`, async () => {
        return await this.tracer.span(
          `tool:${toolName}`,
          { tool: toolName, attempt, traceId: ctx.traceId, requestId: ctx.requestId },
          async () => {
            const t0 = performance.now();

            const result = await withTimeout(
              tool.handler(parsed.data, ctx),
              timeoutMs
            ).catch((err: unknown) => {
              const errMsg = err instanceof Error ? err.message : String(err);
              if (errMsg.startsWith("Timeout")) {
                throw new MichatError("E_TIMEOUT", `Timeout executing ${toolName}`, {
                  tool: toolName,
                  timeoutMs,
                });
              }
              throw err;
            });

            ctx.metrics.timing("tool.latency_ms", performance.now() - t0, { tool: toolName });

            if (this.cfg.ENABLE_AUDIT) {
              ctx.audit.log({
                action: "tool.execute",
                actor: ctx.user?.name ?? "anonymous",
                resource: toolName,
                details: { params: redactSecrets(params), options },
                timestamp: nowISO(),
                traceId: ctx.traceId,
                requestId: ctx.requestId,
              });
            }

            return result;
          }
        );
      }, options.maxConcurrent);
    };

    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await attemptOnce(attempt);
        cb.onSuccess();

        ctx.events.emit("tool.succeeded", {
          tool: toolName,
          attempt,
          traceId: ctx.traceId,
          requestId: ctx.requestId,
        });

        if (options.cacheKey) {
          const ttl = options.cacheTtlMs ?? this.cfg.CACHE_DEFAULT_TTL_MS;
          ctx.cache.set(options.cacheKey, result, ttl);
        }

        return result;
      } catch (err: unknown) {
        lastErr = err;
        cb.onFailure();

        ctx.events.emit("tool.failed", {
          tool: toolName,
          attempt,
          err: err instanceof Error ? err.message : String(err),
          traceId: ctx.traceId,
          requestId: ctx.requestId,
        });

        const isPermanent = 
          err instanceof MichatError && 
          ["E_BAD_PARAMS", "E_POLICY_DENIED"].includes(err.code);

        if (attempt < retries && !isPermanent) {
          const backoff = clamp(jitter(base * Math.pow(2, attempt), 0.35), base, maxB);
          await sleep(backoff);
          continue;
        }
        break;
      }
    }

    throw wrapError(lastErr, "E_INTERNAL");
  }

  getCircuitState(toolName: string) {
    return this.cbRegistry.get(`tool:${toolName}`).snapshot();
  }

  getRateLimitState(toolName: string) {
    return {
      available: this.rateLimiter.getAvailable(`tool:${toolName}`),
    };
  }

  getBulkheadState(toolName: string) {
    return this.bulkhead.getStats(`tool:${toolName}`);
  }

  resetCircuit(toolName: string) {
    this.cbRegistry.reset(`tool:${toolName}`);
  }

  resetAllCircuits() {
    this.cbRegistry.resetAll();
  }
}
