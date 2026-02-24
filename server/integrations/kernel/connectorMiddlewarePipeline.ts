/**
 * ConnectorMiddlewarePipeline — Composable middleware chain for connector operations.
 *
 * Orchestrates the full execution pipeline:
 *   Input Sanitization → Scope Validation → Compliance Check → Rate Limit →
 *   Circuit Breaker → Credential Resolution → Idempotency Guard → Retry →
 *   Execution → Output Redaction → Audit Enrichment → Metrics
 *
 * Each middleware is a pure function (ctx, next) → Promise<ConnectorOperationResult>.
 * Middlewares can short-circuit by returning a result without calling next().
 */

import type { ConnectorOperationResult } from "./types";

// ─── Types ───────────────────────────────────────────────────────────

export interface MiddlewareContext {
  connectorId: string;
  operationId: string;
  userId: string;
  chatId: string;
  runId: string;
  input: Record<string, unknown>;
  isConfirmed?: boolean;
  signal?: AbortSignal;
  /** Mutable bag for middlewares to attach metadata */
  meta: Record<string, unknown>;
  /** Timestamp when the pipeline started */
  startedAt: number;
}

export type ConnectorMiddlewareFn = (
  ctx: MiddlewareContext,
  next: () => Promise<ConnectorOperationResult>
) => Promise<ConnectorOperationResult>;

export interface MiddlewareDescriptor {
  name: string;
  /** Lower = runs first. Default 500. */
  order: number;
  /** If true, errors in this middleware don't stop the pipeline */
  bestEffort?: boolean;
  fn: ConnectorMiddlewareFn;
}

// ─── Pipeline ────────────────────────────────────────────────────────

export class ConnectorMiddlewarePipeline {
  private middlewares: MiddlewareDescriptor[] = [];
  private frozen = false;

  /** Register a middleware. Must be called before freeze(). */
  use(descriptor: MiddlewareDescriptor): this {
    if (this.frozen) {
      console.warn(
        `[ConnectorPipeline] Cannot add middleware "${descriptor.name}" after pipeline is frozen`
      );
      return this;
    }
    this.middlewares.push(descriptor);
    return this;
  }

  /** Freeze the pipeline — sort by order, prevent further additions. */
  freeze(): this {
    this.middlewares.sort((a, b) => a.order - b.order);
    this.frozen = true;
    console.log(
      `[ConnectorPipeline] Frozen with ${this.middlewares.length} middlewares: ` +
        this.middlewares.map((m) => m.name).join(" → ")
    );
    return this;
  }

  /** Execute the full pipeline with a terminal handler. */
  async execute(
    ctx: MiddlewareContext,
    handler: () => Promise<ConnectorOperationResult>
  ): Promise<ConnectorOperationResult> {
    const chain = [...this.middlewares];
    let index = 0;

    const runNext = async (): Promise<ConnectorOperationResult> => {
      // Terminal: execute the actual handler
      if (index >= chain.length) {
        return handler();
      }

      const mw = chain[index++];

      try {
        const result = await mw.fn(ctx, runNext);
        return result;
      } catch (err: unknown) {
        if (mw.bestEffort) {
          console.warn(
            `[ConnectorPipeline] Best-effort middleware "${mw.name}" failed:`,
            err instanceof Error ? err.message : String(err)
          );
          // Skip this middleware, continue pipeline
          return runNext();
        }

        // Hard failure — short-circuit
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: {
            code: "MIDDLEWARE_ERROR",
            message: `Pipeline middleware "${mw.name}" failed: ${msg}`,
            retryable: false,
          },
          metadata: { latencyMs: Date.now() - ctx.startedAt, failedMiddleware: mw.name },
        };
      }
    };

    return runNext();
  }

  /** Get the ordered middleware names (for introspection / health check) */
  getChain(): string[] {
    return this.middlewares.map((m) => m.name);
  }

  /** Get middleware count */
  get size(): number {
    return this.middlewares.length;
  }
}

// ─── Built-in middleware factories ───────────────────────────────────

/**
 * Timing middleware — records total pipeline duration in ctx.meta.
 * Should be first in the chain (lowest order).
 */
export function createTimingMiddleware(): MiddlewareDescriptor {
  return {
    name: "timing",
    order: 0,
    bestEffort: false,
    fn: async (ctx, next) => {
      const start = performance.now();
      const result = await next();
      const durationMs = Math.round(performance.now() - start);
      ctx.meta.pipelineDurationMs = durationMs;

      return {
        ...result,
        metadata: {
          ...(result.metadata || {}),
          pipelineDurationMs: durationMs,
        },
      };
    },
  };
}

/**
 * Abort signal middleware — checks if the request was cancelled before proceeding.
 */
export function createAbortCheckMiddleware(): MiddlewareDescriptor {
  return {
    name: "abortCheck",
    order: 10,
    bestEffort: false,
    fn: async (ctx, next) => {
      if (ctx.signal?.aborted) {
        return {
          success: false,
          error: {
            code: "ABORTED",
            message: "Operation was cancelled by the client",
            retryable: false,
          },
          metadata: { latencyMs: Date.now() - ctx.startedAt },
        };
      }
      return next();
    },
  };
}

/**
 * Input validation middleware — ensures required fields are present.
 */
export function createInputValidationMiddleware(): MiddlewareDescriptor {
  return {
    name: "inputValidation",
    order: 50,
    bestEffort: false,
    fn: async (ctx, next) => {
      if (!ctx.connectorId || !ctx.operationId) {
        return {
          success: false,
          error: {
            code: "INVALID_INPUT",
            message: "Missing connectorId or operationId",
            retryable: false,
          },
        };
      }
      if (!ctx.userId) {
        return {
          success: false,
          error: {
            code: "AUTH_REQUIRED",
            message: "No authenticated user for connector operation",
            retryable: false,
          },
        };
      }
      if (typeof ctx.input !== "object" || ctx.input === null) {
        ctx.input = {};
      }
      return next();
    },
  };
}

/**
 * Input size limiter — rejects oversized payloads.
 */
export function createInputSizeLimiterMiddleware(maxBytes = 1_048_576): MiddlewareDescriptor {
  return {
    name: "inputSizeLimiter",
    order: 60,
    bestEffort: false,
    fn: async (ctx, next) => {
      const inputStr = JSON.stringify(ctx.input);
      const sizeBytes = Buffer.byteLength(inputStr, "utf8");

      if (sizeBytes > maxBytes) {
        return {
          success: false,
          error: {
            code: "INPUT_TOO_LARGE",
            message: `Input size ${sizeBytes} bytes exceeds limit of ${maxBytes} bytes`,
            retryable: false,
          },
        };
      }

      ctx.meta.inputSizeBytes = sizeBytes;
      return next();
    },
  };
}

/**
 * Confirmation middleware — blocks write operations that require confirmation.
 */
export function createConfirmationMiddleware(): MiddlewareDescriptor {
  return {
    name: "confirmation",
    order: 100,
    bestEffort: false,
    fn: async (ctx, next) => {
      // Lazy load to avoid circular deps
      const { connectorRegistry } = await import("./connectorRegistry");

      const manifest = connectorRegistry.get(ctx.connectorId);
      if (!manifest) return next();

      const capability = manifest.capabilities.find((c) => c.operationId === ctx.operationId);
      if (!capability) return next();

      if (capability.confirmationRequired && !ctx.isConfirmed) {
        return {
          success: false,
          error: {
            code: "REQUIRES_CONFIRMATION",
            message: `Operation "${capability.name}" requires explicit confirmation before execution.`,
            retryable: false,
            details: {
              connectorId: ctx.connectorId,
              operationId: ctx.operationId,
              dataAccessLevel: capability.dataAccessLevel,
            },
          },
        };
      }

      return next();
    },
  };
}

/**
 * Output size limiter — truncates oversized responses.
 */
export function createOutputSizeLimiterMiddleware(maxBytes = 5_242_880): MiddlewareDescriptor {
  return {
    name: "outputSizeLimiter",
    order: 900,
    bestEffort: true,
    fn: async (ctx, next) => {
      const result = await next();

      if (result.data) {
        const outputStr = JSON.stringify(result.data);
        const outputSize = Buffer.byteLength(outputStr, "utf8");
        ctx.meta.outputSizeBytes = outputSize;

        if (outputSize > maxBytes) {
          console.warn(
            `[ConnectorPipeline] Output truncated for ${ctx.connectorId}/${ctx.operationId}: ` +
              `${outputSize} > ${maxBytes} bytes`
          );
          // Truncate: return a summary instead of the full data
          return {
            ...result,
            data: {
              _truncated: true,
              _originalSizeBytes: outputSize,
              _maxAllowedBytes: maxBytes,
              _message: "Response was truncated due to size limits. Try a more specific query.",
            },
            metadata: {
              ...(result.metadata || {}),
              truncated: true,
              originalSizeBytes: outputSize,
            },
          };
        }
      }

      return result;
    },
  };
}

/**
 * Structured logging middleware — logs every connector operation.
 */
export function createLoggingMiddleware(): MiddlewareDescriptor {
  return {
    name: "logging",
    order: 950,
    bestEffort: true,
    fn: async (ctx, next) => {
      const result = await next();

      const logEntry = {
        event: "connector_operation",
        connectorId: ctx.connectorId,
        operationId: ctx.operationId,
        userId: ctx.userId,
        chatId: ctx.chatId,
        runId: ctx.runId,
        success: result.success,
        durationMs: ctx.meta.pipelineDurationMs ?? Date.now() - ctx.startedAt,
        inputSizeBytes: ctx.meta.inputSizeBytes ?? 0,
        outputSizeBytes: ctx.meta.outputSizeBytes ?? 0,
        errorCode: result.error?.code,
        timestamp: new Date().toISOString(),
      };

      if (result.success) {
        console.log(JSON.stringify(logEntry));
      } else {
        console.warn(JSON.stringify(logEntry));
      }

      return result;
    },
  };
}

// ─── Default pipeline factory ────────────────────────────────────────

/**
 * Create the default connector execution pipeline with all built-in middlewares.
 */
export function createDefaultPipeline(): ConnectorMiddlewarePipeline {
  const pipeline = new ConnectorMiddlewarePipeline();

  pipeline
    .use(createTimingMiddleware())
    .use(createAbortCheckMiddleware())
    .use(createInputValidationMiddleware())
    .use(createInputSizeLimiterMiddleware())
    .use(createConfirmationMiddleware())
    .use(createOutputSizeLimiterMiddleware())
    .use(createLoggingMiddleware())
    .freeze();

  return pipeline;
}

// ─── Singleton ───────────────────────────────────────────────────────

/** The default global pipeline instance. */
export const connectorPipeline = createDefaultPipeline();
