/**
 * Cognitive Middleware — tool execution layer (Turn D).
 *
 * Turns A–C forwarded the model's `toolCalls` back to the caller
 * unchanged. Turn D gives the middleware a built-in execution loop:
 * when a `ToolRegistry` is configured, the orchestrator
 *
 *   1. forwards tool descriptors to the provider,
 *   2. detects `finishReason === "tool_calls"` in the response,
 *   3. executes each tool call in parallel against the registry,
 *   4. appends the results as `{ role: "tool" }` messages, and
 *   5. re-invokes the provider until it produces a `stop` or the
 *      iteration budget is exhausted.
 *
 * The design borrows directly from the OpenAI + Anthropic function-
 * calling conventions — a tool handler is just an async function
 * from args to result, and the execution environment is uniform
 * across providers because the middleware normalizes the request
 * shape before each call.
 *
 * Hard guarantees:
 *
 *   1. **Never throws to the caller.** Handler exceptions, unknown
 *      tool names, timeouts, and abort signals are all captured and
 *      encoded as a `ToolExecutionOutcome` with `ok: false` and a
 *      machine-readable `errorCode`. The outcome is still fed back
 *      to the model as a tool message so the model can recover.
 *
 *   2. **Timeout isolation.** Every handler runs under a fresh
 *      `AbortController` whose `abort()` fires after the tool's
 *      configured `timeoutMs` (default 30 s). The caller's signal
 *      is chained in so external cancellation propagates
 *      immediately. Handlers that ignore the signal will hang the
 *      controller forever — the orchestrator wins via
 *      `Promise.race` so the caller sees a timeout result
 *      regardless.
 *
 *   3. **Determinism for tests.** The in-memory registry has zero
 *      global state — each instance is independent, so parallel
 *      tests don't leak handlers into each other.
 *
 *   4. **Observability.** Every execution records its wall-clock
 *      `durationMs`, the `iteration` index in the agentic loop,
 *      and the tool call id so downstream dashboards can correlate
 *      model turns with tool work.
 */

import type { ProviderToolDescriptor } from "./types";

// ---------------------------------------------------------------------------
// Execution context
// ---------------------------------------------------------------------------

/**
 * Information every tool handler receives on invocation.
 *
 * The context is rebuilt for each call — handlers should NOT cache
 * it across invocations because the `signal` in particular is
 * scoped to a single execution and will be aborted the moment that
 * execution ends.
 */
export interface ToolExecutionContext {
  /** Stable user id (used for auth + rate-limit attribution). */
  userId: string;
  /** Optional conversation id from the originating request. */
  conversationId?: string;
  /**
   * Per-call abort signal. Fires on timeout OR when the caller
   * aborts the outer cognitive request. Handlers should check
   * this before long-running work.
   */
  signal: AbortSignal;
  /**
   * 0-based index of the current agentic-loop iteration. Useful
   * for handlers that need to avoid repeating state-changing
   * operations on retries.
   */
  iteration: number;
  /**
   * The model's generated tool call id. Included so handlers can
   * correlate their work with upstream logs.
   */
  toolCallId: string;
}

// ---------------------------------------------------------------------------
// Handler + tool descriptor
// ---------------------------------------------------------------------------

/**
 * One tool handler. `args` is whatever the model emitted (after
 * JSON parsing). `result` is whatever the handler wants to return
 * to the model — it must be JSON-serializable because it gets
 * stringified into a `{ role: "tool" }` message on the next turn.
 */
export type ToolHandler<
  Args extends Record<string, unknown> = Record<string, unknown>,
  Result = unknown,
> = (args: Args, ctx: ToolExecutionContext) => Promise<Result>;

/**
 * Registry entry: the descriptor the model sees + the handler that
 * runs when the model picks the tool + an optional timeout override.
 */
export interface RegisteredTool<
  Args extends Record<string, unknown> = Record<string, unknown>,
  Result = unknown,
> {
  /** The normalized JSON-schema descriptor sent to the model. */
  descriptor: ProviderToolDescriptor;
  /** The handler that runs when the model picks this tool. */
  handler: ToolHandler<Args, Result>;
  /**
   * Per-call timeout in ms. Handlers that exceed this get aborted
   * and the registry returns a `timeout` outcome. Default 30_000.
   */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Execution outcome
// ---------------------------------------------------------------------------

/**
 * Structured error codes so dashboards can split "tool failures"
 * into actionable buckets instead of a single opaque string.
 */
export type ToolExecutionErrorCode =
  | "unknown_tool"
  | "invalid_args"
  | "timeout"
  | "aborted"
  | "handler_threw"
  | "result_not_serializable";

/**
 * What came out of one handler invocation. Always produced — even
 * failed executions return an outcome so the orchestrator can feed
 * it back to the model.
 */
export interface ToolExecutionOutcome {
  /** Stable id from the model's tool call. */
  toolCallId: string;
  /** The tool's registered name. */
  toolName: string;
  /** True iff the handler ran and returned successfully. */
  ok: boolean;
  /** JSON-serializable result. Present only when `ok === true`. */
  result?: unknown;
  /** Human-readable error message. Present only when `ok === false`. */
  error?: string;
  /** Structured error code. Present only when `ok === false`. */
  errorCode?: ToolExecutionErrorCode;
  /** Wall-clock duration of the handler in ms. */
  durationMs: number;
  /** 0-based iteration index of the agentic loop when this ran. */
  iteration: number;
}

// ---------------------------------------------------------------------------
// Registry interface
// ---------------------------------------------------------------------------

/**
 * The single seam between the cognitive layer and any concrete tool
 * backend. Production could wire this to a sandboxed process pool,
 * an MCP server, or a dispatch table of in-process functions — the
 * orchestrator doesn't care which.
 *
 * Hard contract for implementations:
 *
 *   • `execute` MUST NOT throw. Every failure path (unknown tool,
 *     handler exception, timeout) must return a `ToolExecutionOutcome`
 *     with `ok: false`.
 *
 *   • `execute` MUST respect `ctx.signal` and return promptly on
 *     abort. Implementations should check the signal BEFORE doing
 *     any expensive work.
 *
 *   • `list` MUST be a read-only snapshot. Callers should be free
 *     to mutate it without affecting the registry.
 *
 *   • Implementations SHOULD be safe for concurrent use across
 *     multiple requests. The in-memory impl uses an immutable Map
 *     for reads + copy-on-write for writes.
 */
export interface ToolRegistry {
  register(tool: RegisteredTool): void;
  unregister(name: string): void;
  list(): ProviderToolDescriptor[];
  has(name: string): boolean;
  execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionOutcome>;
}

// ---------------------------------------------------------------------------
// InMemoryToolRegistry
// ---------------------------------------------------------------------------

export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

export class InMemoryToolRegistry implements ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  /**
   * Bulk-register a list of tools. Convenience for callers that
   * build the registry from a static manifest.
   */
  constructor(initial: readonly RegisteredTool[] = []) {
    for (const t of initial) {
      this.register(t);
    }
  }

  register(tool: RegisteredTool): void {
    if (!tool.descriptor?.name || typeof tool.descriptor.name !== "string") {
      throw new Error(
        "InMemoryToolRegistry.register: tool.descriptor.name is required",
      );
    }
    if (typeof tool.handler !== "function") {
      throw new Error(
        `InMemoryToolRegistry.register: tool ${tool.descriptor.name} handler must be a function`,
      );
    }
    this.tools.set(tool.descriptor.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  list(): ProviderToolDescriptor[] {
    return Array.from(this.tools.values(), (t) => t.descriptor);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Tests + observability: current tool count. */
  get size(): number {
    return this.tools.size;
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionOutcome> {
    const start = Date.now();
    const tool = this.tools.get(name);

    // ── 1. Unknown tool ───────────────────────────────────────────
    if (!tool) {
      return errorOutcome(
        ctx,
        name,
        "unknown_tool",
        `tool "${name}" is not registered`,
        Date.now() - start,
      );
    }

    // ── 2. Invalid args shape ─────────────────────────────────────
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
      return errorOutcome(
        ctx,
        name,
        "invalid_args",
        `tool "${name}": args must be a plain object`,
        Date.now() - start,
      );
    }

    // ── 3. Pre-abort fast path ────────────────────────────────────
    if (ctx.signal.aborted) {
      return errorOutcome(
        ctx,
        name,
        "aborted",
        "aborted before handler invocation",
        Date.now() - start,
      );
    }

    // ── 4. Build a per-call controller for timeout + cancellation ─
    // Chain the caller's signal in so external aborts propagate,
    // then set a timer that fires `abort` after the tool's timeout.
    const innerController = new AbortController();
    const onExternalAbort = (): void => innerController.abort();
    if (ctx.signal.aborted) {
      innerController.abort();
    } else {
      ctx.signal.addEventListener("abort", onExternalAbort, { once: true });
    }
    const timeoutMs = tool.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
    const timer = setTimeout(() => innerController.abort(), timeoutMs);

    const handlerCtx: ToolExecutionContext = {
      ...ctx,
      signal: innerController.signal,
    };

    // ── 5. Run the handler under a race with the abort signal ────
    // We Promise.race() so a handler that IGNORES the signal still
    // lets the registry return a timeout/abort outcome promptly.
    // The zombie handler keeps running in the background until the
    // JS engine reaps it — acceptable leak, and the alternative
    // (no race) means hung handlers block the whole cognitive
    // pipeline.
    let result: unknown;
    let caughtError: unknown = null;
    try {
      result = await Promise.race([
        tool.handler(args, handlerCtx),
        new Promise<never>((_, reject) => {
          if (innerController.signal.aborted) {
            reject(new Error("aborted before race started"));
            return;
          }
          innerController.signal.addEventListener(
            "abort",
            () => {
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
      ]);
    } catch (err) {
      caughtError = err;
    } finally {
      clearTimeout(timer);
      ctx.signal.removeEventListener("abort", onExternalAbort);
    }

    const durationMs = Date.now() - start;

    if (caughtError) {
      const aborted = innerController.signal.aborted;
      // If our inner controller aborted but the caller's outer
      // signal did NOT, then we tripped the timeout — not the
      // caller. That's a more actionable error code.
      const timedOut = aborted && !ctx.signal.aborted;
      return errorOutcome(
        ctx,
        name,
        timedOut ? "timeout" : aborted ? "aborted" : "handler_threw",
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError),
        durationMs,
      );
    }

    // ── 6. Ensure the result is JSON-serializable ─────────────────
    // The orchestrator will JSON.stringify it into a tool message,
    // so non-serializable results (circular refs, BigInt, etc.)
    // would explode downstream. Catch it here with a clear code.
    try {
      JSON.stringify(result);
    } catch (err) {
      return errorOutcome(
        ctx,
        name,
        "result_not_serializable",
        `tool "${name}" returned a non-JSON-serializable result: ${
          err instanceof Error ? err.message : String(err)
        }`,
        durationMs,
      );
    }

    return {
      toolCallId: ctx.toolCallId,
      toolName: name,
      ok: true,
      result,
      durationMs,
      iteration: ctx.iteration,
    };
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function errorOutcome(
  ctx: ToolExecutionContext,
  toolName: string,
  errorCode: ToolExecutionErrorCode,
  error: string,
  durationMs: number,
): ToolExecutionOutcome {
  return {
    toolCallId: ctx.toolCallId,
    toolName,
    ok: false,
    error,
    errorCode,
    durationMs,
    iteration: ctx.iteration,
  };
}

// ---------------------------------------------------------------------------
// Serialization helper (used by the orchestrator)
// ---------------------------------------------------------------------------

/**
 * Convert a tool execution outcome into the string content for a
 * `{ role: "tool" }` message fed back to the provider. Lives here
 * (not in the middleware) so the serialization format is a
 * single-source-of-truth every place that builds tool messages.
 *
 * Shape:
 *
 *   ok  → JSON.stringify(result)                // whatever the handler returned
 *   !ok → JSON.stringify({ error, code })       // plain object, minimal
 */
export function serializeToolOutcomeForModel(
  outcome: ToolExecutionOutcome,
): string {
  if (outcome.ok) {
    try {
      return JSON.stringify(outcome.result);
    } catch {
      // Defensive — should have been caught in execute(), but if
      // someone constructs an outcome manually with a circular
      // ref we return an explicit error stub instead of throwing.
      return JSON.stringify({
        error: "result_not_serializable_post_hoc",
        code: "result_not_serializable",
      });
    }
  }
  return JSON.stringify({
    error: outcome.error ?? "unknown error",
    code: outcome.errorCode ?? "handler_threw",
  });
}
