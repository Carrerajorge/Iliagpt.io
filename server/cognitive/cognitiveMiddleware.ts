/**
 * Cognitive Middleware — orchestrator.
 *
 * The single entry point for the entire cognitive layer. Given a
 * `CognitiveRequest`, runs the full pipeline:
 *
 *     classifyIntent
 *           ↓
 *     selectProvider
 *           ↓
 *     buildNormalizedRequest
 *           ↓
 *     providerAdapter.generate    (with retry, timeout, AbortSignal)
 *           ↓
 *     validateOutput
 *           ↓
 *     assembleResponse  (telemetry + routing decision + errors)
 *
 * Hard guarantees:
 *
 *   1. **Never throws** to the caller. Even if every adapter
 *      explodes, the caller gets a `CognitiveResponse` with
 *      `ok: false` and the failure encoded in `errors[]`. This is
 *      essential for using the middleware inside HTTP handlers,
 *      job queues, and stream-processing pipelines without
 *      defensive try/catch on every call site.
 *
 *   2. **Cancellation propagation**. The caller's `AbortSignal`
 *      flows down to the provider's `generate()` so cancellation
 *      reaches the network layer, not just the post-processing.
 *
 *   3. **Telemetry as data**. Every stage's wall-clock duration is
 *      recorded inline on the response. No global state, no async
 *      hooks, no log scraping needed.
 *
 *   4. **Provider-agnostic**. The orchestrator only ever talks to
 *      `ProviderAdapter`. It does not know whether a given adapter
 *      is hitting Claude, GPT, Gemini, our in-house GPT-3, or a
 *      mock. The same code path works for all of them.
 *
 *   5. **Bounded retries**. Provider failures (`finishReason ===
 *      "error"`) trigger up to N retries with linear backoff. The
 *      retry counter ends up on the response telemetry so callers
 *      can see how stable each provider is.
 *
 * Composition guidelines (for follow-up turns):
 *   • Wire `intentRouter` outputs into the existing smart router by
 *     adding a thin adapter that maps CognitiveIntent → model tier.
 *   • Wire the existing tool registry by passing its descriptors
 *     into the `tools` field of `NormalizedProviderRequest`.
 *   • Wire memory by extending the orchestrator with a context
 *     enrichment pre-stage that injects relevant memories into the
 *     system prompt.
 */

import { classifyIntent } from "./intentRouter";
import { validateOutput } from "./outputValidator";
import { enrichContext, renderContextBundle } from "./contextEnricher";
import { serializeToolOutcomeForModel } from "./tools";
import { defaultRateLimitKey } from "./rateLimit";
import type { CircuitBreakerRegistry } from "./circuitBreaker";
import type { RateLimitCheckResult, RateLimiter } from "./rateLimit";
import type {
  ContextBundle,
  DocumentStore,
  MemoryStore,
} from "./context";
import type {
  ToolExecutionContext,
  ToolExecutionOutcome,
  ToolRegistry,
} from "./tools";
import type {
  CognitiveIntent,
  CognitiveRequest,
  CognitiveResponse,
  CognitiveStreamEvent,
  CognitiveTelemetry,
  IntentClassification,
  NormalizedProviderRequest,
  ProviderAdapter,
  ProviderFinishReason,
  ProviderMessage,
  ProviderResponse,
  ProviderToolCall,
  ProviderToolDescriptor,
  ProviderUsage,
  RoutingDecision,
  ValidationReport,
} from "./types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CognitiveMiddlewareOptions {
  /**
   * The provider adapters available to the orchestrator. Order
   * matters: when no `preferredProvider` is set on the request and
   * the chosen intent has multiple capable adapters, the FIRST one
   * in this array wins. Treat this as the priority order.
   */
  adapters: ProviderAdapter[];
  /**
   * Maximum number of retries for transient provider errors.
   * Default 2 (so the worst case is 1 initial call + 2 retries = 3).
   */
  maxRetries?: number;
  /**
   * Per-call timeout in milliseconds. The orchestrator wraps the
   * provider call in an AbortController so a hung adapter can't
   * pin a request forever. Default 60_000 (60 seconds).
   */
  timeoutMs?: number;
  /**
   * Optional default system prompt prepended to every request.
   * Adapters can still augment this — the orchestrator only sets
   * a baseline.
   */
  defaultSystemPrompt?: string;
  /**
   * Optional list of tool descriptors to include in every request.
   * The orchestrator does NOT execute tool calls — it only forwards
   * descriptors and reports any tool calls the model emits. Tool
   * execution is the caller's job (a follow-up commit will add a
   * built-in execution loop).
   */
  defaultTools?: ProviderToolDescriptor[];
  /**
   * Optional long-term memory store. When provided, every request
   * goes through the context enrichment stage to recall relevant
   * memories for the user. Added in Turn C.
   */
  memoryStore?: MemoryStore;
  /**
   * Optional document store for RAG-style context retrieval. When
   * provided, every request goes through the enrichment stage.
   * Added in Turn C.
   */
  documentStore?: DocumentStore;
  /**
   * Hard character budget for the assembled context bundle. Default
   * 4000. Chunks beyond this budget are dropped in lowest-score-first
   * order. Added in Turn C.
   */
  contextBudgetChars?: number;
  /**
   * Optional tool registry. When provided, the orchestrator turns
   * tool calls into actual handler invocations and loops until the
   * model emits a `stop` finishReason or hits `maxToolIterations`.
   * The registry's `list()` is merged into the `tools` field of
   * every provider request so the model always sees the available
   * tools. Added in Turn D.
   */
  toolRegistry?: ToolRegistry;
  /**
   * Maximum number of agentic-loop iterations. Each iteration is
   * one provider call + one batch of tool executions. Default 5 —
   * enough for typical tool chains (search → fetch → summarize)
   * without letting a broken model spin forever. Added in Turn D.
   */
  maxToolIterations?: number;
  /**
   * Optional rate limiter. When provided, every request goes
   * through a `check` call before any provider work. On denial the
   * middleware returns a graceful failure response with
   * `errors: ["rate_limited"]` and the retryAfter value lifted to
   * the top-level CognitiveResponse (via `validation.issues`).
   * Added in Turn E.
   */
  rateLimiter?: RateLimiter;
  /**
   * How to compute the limiter key for a given request. Defaults
   * to `user:${userId}:intent:${intent}`. Use `"user"` for a
   * simple per-user limit, or any custom function for tiered
   * limits (e.g., paid vs free users). Added in Turn E.
   */
  rateLimitKeyFn?: (
    req: CognitiveRequest,
    intent: CognitiveIntent,
  ) => string;
  /**
   * Token cost charged to the bucket per request. Default 1.
   * Production can vary this based on expected token usage (e.g.,
   * a long image-generation request might cost 5 tokens). Added
   * in Turn E.
   */
  rateLimitCost?: number;
  /**
   * Optional per-provider circuit breakers. When supplied, the
   * orchestrator filters the adapter list to only those whose
   * breakers are currently available (closed or half-open) before
   * picking one. After each provider call the orchestrator
   * records a success or failure against the chosen adapter's
   * breaker. Added in Turn E.
   */
  circuitBreakers?: CircuitBreakerRegistry;
}

const DEFAULT_OPTIONS = {
  maxRetries: 2,
  timeoutMs: 60_000,
  contextBudgetChars: 4000,
  maxToolIterations: 5,
} as const;

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

interface ProviderSelectionResult {
  adapter: ProviderAdapter | null;
  reason: string;
}

/**
 * Pick a provider for a given intent + optional preference.
 *
 * Algorithm:
 *
 *   1. If a circuit breaker registry is supplied, filter out every
 *      adapter whose breaker currently reports unavailable
 *      (`open` with a still-running cooldown). The filtered list
 *      is what steps 2–4 operate on.
 *
 *   2. If `preferredProvider` is set AND that provider exists AND
 *      claims it can serve `intent` AND its breaker is available
 *      → use it. Reason: "preferred".
 *
 *   3. Otherwise, scan the filtered list in order and pick the
 *      first one whose `capabilities` set contains `intent`.
 *      Reason: "first capable".
 *
 *   4. If no adapter matches → return null. When the filter
 *      removed everything, the reason says so explicitly so the
 *      caller knows this is a transient outage and not a
 *      misconfiguration.
 *
 * Test-friendly: pure function, no side effects (breaker state is
 * only read here; mutation happens in the middleware after the
 * provider call returns).
 */
export function selectProvider(
  adapters: readonly ProviderAdapter[],
  intent: CognitiveIntent,
  preferredProvider?: string,
  breakers?: CircuitBreakerRegistry,
): ProviderSelectionResult {
  if (adapters.length === 0) {
    return { adapter: null, reason: "no adapters registered" };
  }

  // Filter by breaker availability first, in a stable order so the
  // `first capable` tiebreaker still respects the priority list.
  const availableAdapters = breakers
    ? adapters.filter((a) => breakers.get(a.name).isAvailable())
    : adapters;

  if (availableAdapters.length === 0) {
    return {
      adapter: null,
      reason: `all ${adapters.length} adapters are circuit-broken`,
    };
  }

  if (preferredProvider) {
    const preferred = availableAdapters.find((a) => a.name === preferredProvider);
    if (preferred && preferred.capabilities.has(intent)) {
      return { adapter: preferred, reason: `preferred provider ${preferred.name}` };
    }
    if (preferred && !preferred.capabilities.has(intent)) {
      // Preferred exists but can't handle this intent — fall through
      // to first-capable, log the mismatch in the reason.
      const first = availableAdapters.find((a) => a.capabilities.has(intent));
      if (first) {
        return {
          adapter: first,
          reason: `preferred ${preferred.name} cannot handle "${intent}", fell back to ${first.name}`,
        };
      }
      return {
        adapter: null,
        reason: `preferred ${preferred.name} cannot handle "${intent}" and no fallback is capable`,
      };
    }
    if (!preferred) {
      // Preferred name doesn't exist at all (or is circuit-broken)
      // — fall through to the first capable adapter.
      const brokenButExists =
        breakers &&
        adapters.find((a) => a.name === preferredProvider) &&
        !availableAdapters.find((a) => a.name === preferredProvider);
      const first = availableAdapters.find((a) => a.capabilities.has(intent));
      if (first) {
        return {
          adapter: first,
          reason: brokenButExists
            ? `preferred provider "${preferredProvider}" is circuit-broken, fell back to ${first.name}`
            : `preferred provider "${preferredProvider}" not registered, fell back to ${first.name}`,
        };
      }
      return {
        adapter: null,
        reason: `preferred provider "${preferredProvider}" not registered and no fallback is capable`,
      };
    }
  }

  const first = availableAdapters.find((a) => a.capabilities.has(intent));
  if (first) {
    return { adapter: first, reason: `first capable: ${first.name}` };
  }
  return { adapter: null, reason: `no adapter advertises "${intent}"` };
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

/**
 * Build a normalized provider request from the user's CognitiveRequest
 * + the middleware's defaults + an optional enriched context bundle.
 * Pure function — output depends only on inputs, no global state.
 *
 * If `contextBundle` has chunks, they are rendered into a block and
 * appended to the system prompt so the model sees them exactly once,
 * in a provenance-tagged format, before processing the user message.
 *
 * If a tool registry is configured (Turn D), every tool it lists is
 * merged into the request's `tools` field. Static `defaultTools`
 * are preserved and listed first so existing callers are unaffected.
 */
export function buildNormalizedRequest(
  req: CognitiveRequest,
  options: CognitiveMiddlewareOptions,
  contextBundle?: ContextBundle,
): NormalizedProviderRequest {
  const baseSystemPrompt = options.defaultSystemPrompt;
  let systemPrompt = baseSystemPrompt;
  if (contextBundle && contextBundle.chunks.length > 0) {
    const rendered = renderContextBundle(contextBundle);
    systemPrompt = baseSystemPrompt
      ? `${baseSystemPrompt}\n\n${rendered}`
      : rendered;
  }
  const staticTools = options.defaultTools ?? [];
  const registryTools = options.toolRegistry?.list() ?? [];
  const mergedTools: ProviderToolDescriptor[] | undefined =
    staticTools.length + registryTools.length > 0
      ? [...staticTools, ...registryTools]
      : undefined;
  return {
    systemPrompt,
    messages: [
      {
        role: "user",
        content: req.message,
      },
    ],
    tools: mergedTools,
    maxTokens: req.maxTokens,
    temperature: req.temperature ?? 0.7,
  };
}

// ---------------------------------------------------------------------------
// Retry + timeout wrapper for provider calls
// ---------------------------------------------------------------------------

interface CallWithRetryResult {
  response: ProviderResponse;
  retries: number;
  errors: string[];
}

/**
 * Call `adapter.generate` with timeout + retry policy + cancellation
 * propagation. The function:
 *
 *   • Wraps each call in a fresh AbortController whose abort fires
 *     after `timeoutMs`. The user's signal (if supplied) is also
 *     wired so external cancellation propagates immediately.
 *
 *   • Retries up to `maxRetries` times when the response's
 *     finishReason is "error" or the adapter throws unexpectedly.
 *     Aborts and content_filter results are NEVER retried — those
 *     are terminal.
 *
 *   • Linear backoff between retries (50ms × attempt). Tunable in
 *     a follow-up commit.
 *
 *   • Always returns a ProviderResponse, even on total failure
 *     (last response wrapped if necessary, otherwise a synthetic
 *     "all retries failed" error response).
 */
export async function callProviderWithRetry(
  adapter: ProviderAdapter,
  request: NormalizedProviderRequest,
  maxRetries: number,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<CallWithRetryResult> {
  const errors: string[] = [];
  let retries = 0;
  let lastResponse: ProviderResponse | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (externalSignal?.aborted) {
      return {
        response: {
          text: "",
          finishReason: "aborted",
          toolCalls: [],
          raw: { error: "aborted before attempt" },
        },
        retries,
        errors: [...errors, "aborted before attempt"],
      };
    }

    // Build a per-attempt AbortController that combines (a) the
    // external signal and (b) the timeout. We use a fresh controller
    // per attempt so the previous timeout doesn't leak.
    const controller = new AbortController();
    const onExternalAbort = (): void => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener("abort", onExternalAbort, { once: true });
      }
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: ProviderResponse;
    try {
      response = await adapter.generate(request, controller.signal);
    } catch (err) {
      // Adapters are not supposed to throw, but defensive coding
      // protects the orchestrator's "never throws" contract anyway.
      response = {
        text: "",
        finishReason: "error",
        toolCalls: [],
        raw: {
          error: err instanceof Error ? err.message : String(err),
        },
      };
    } finally {
      clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
    }

    lastResponse = response;

    // Decide whether to retry.
    if (response.finishReason === "stop" || response.finishReason === "tool_calls") {
      return { response, retries, errors };
    }
    if (response.finishReason === "aborted" || response.finishReason === "content_filter") {
      // Terminal — no point retrying.
      return { response, retries, errors };
    }
    // finishReason === "error" or "length" → consider retrying
    if (response.finishReason === "length") {
      // Length truncations are not retried by default — the model
      // produced output, just not enough. Caller can re-request
      // with a larger maxTokens budget.
      return { response, retries, errors };
    }

    const errMsg =
      (response.raw as { error?: string } | undefined)?.error ?? "unknown provider error";
    errors.push(`attempt ${attempt + 1}: ${errMsg}`);

    if (attempt < maxRetries) {
      retries++;
      // Linear backoff: 50ms × attempt count
      await sleep(50 * (attempt + 1));
    }
  }

  return {
    response:
      lastResponse ?? {
        text: "",
        finishReason: "error",
        toolCalls: [],
        raw: { error: "no provider response captured" },
      },
    retries,
    errors,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ---------------------------------------------------------------------------
// Tool execution helpers (Turn D)
// ---------------------------------------------------------------------------

/**
 * Execute every tool call from one provider turn against the
 * registry, in parallel. Returns the outcomes in the same order as
 * the input `toolCalls`. Never throws.
 *
 * Shared by `run()` and `runStream()` so both paths use identical
 * concurrency + error semantics.
 */
async function executeToolBatch(
  registry: ToolRegistry,
  toolCalls: readonly ProviderToolCall[],
  baseCtx: Omit<ToolExecutionContext, "signal" | "toolCallId">,
  signal: AbortSignal,
): Promise<ToolExecutionOutcome[]> {
  return Promise.all(
    toolCalls.map((tc) =>
      registry.execute(tc.name, tc.args, {
        ...baseCtx,
        toolCallId: tc.id,
        signal,
      }),
    ),
  );
}

/**
 * Append one provider turn's output + the batch of tool executions
 * to the running message history in the format every adapter
 * expects: the assistant's tool-calling turn (empty text is fine)
 * followed by one `{ role: "tool", name, content }` message per
 * execution. Mutates the supplied array in-place.
 */
function appendToolTurn(
  messages: ProviderMessage[],
  turnText: string,
  toolCalls: readonly ProviderToolCall[],
  outcomes: readonly ToolExecutionOutcome[],
): void {
  messages.push({ role: "assistant", content: turnText });
  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i];
    const toolCall = toolCalls[i];
    messages.push({
      role: "tool",
      name: toolCall.name,
      content: serializeToolOutcomeForModel(outcome),
    });
  }
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export class CognitiveMiddleware {
  constructor(private readonly options: CognitiveMiddlewareOptions) {
    if (!Array.isArray(options.adapters)) {
      throw new Error("CognitiveMiddleware: options.adapters must be an array");
    }
  }

  /**
   * Run the context enrichment stage for a request. Never throws.
   * Returns an empty bundle when no stores are configured so the
   * caller can treat the result uniformly.
   *
   * Added in Turn C.
   */
  private async runContextEnrichment(
    req: CognitiveRequest,
  ): Promise<ContextBundle> {
    if (!this.options.memoryStore && !this.options.documentStore) {
      return {
        chunks: [],
        totalChars: 0,
        retrievedCount: 0,
        includedCount: 0,
        errors: [],
        telemetry: {
          memoryLookupMs: 0,
          documentLookupMs: 0,
          totalMs: 0,
        },
      };
    }
    return enrichContext(
      req.userId,
      req.message,
      {
        memoryStore: this.options.memoryStore,
        documentStore: this.options.documentStore,
        maxTotalChars:
          this.options.contextBudgetChars ?? DEFAULT_OPTIONS.contextBudgetChars,
      },
      req.signal,
    );
  }

  /**
   * Run a single cognitive request end-to-end. Never throws.
   *
   * Turn D: when a `toolRegistry` is configured the orchestrator
   * enters an agentic loop that executes tool calls locally and
   * feeds their results back to the provider until the model
   * produces a `stop` finishReason or `maxToolIterations` is hit.
   */
  async run(req: CognitiveRequest): Promise<CognitiveResponse> {
    const startedAt = Date.now();
    let intentClassificationMs = 0;
    let contextEnrichmentMs = 0;
    let providerCallMs = 0;
    let validationMs = 0;
    let retries = 0;
    let contextChunksIncluded = 0;
    let toolCallCount = 0;
    let toolTotalMs = 0;
    let agenticIterations = 0;
    let rateLimitCheckMs = 0;
    let rateLimitAllowed = true;
    let rateLimitRemaining = Number.NaN;
    let circuitBreakerState: CognitiveTelemetry["circuitBreakerState"] = "none";
    const toolExecutions: ToolExecutionOutcome[] = [];
    const errors: string[] = [];

    // ── 1. Intent classification ──────────────────────────────────
    let intent: IntentClassification;
    try {
      const t0 = Date.now();
      intent = classifyIntent(req.message, req.intentHint);
      intentClassificationMs = Date.now() - t0;
    } catch (err) {
      // classifyIntent throws on non-string input — caller bug. We
      // still don't propagate; we wrap and return.
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`intent_classifier_threw: ${message}`);
      intent = {
        intent: "unknown",
        confidence: 0,
        reasoning: `classifier threw: ${message}`,
        alternatives: [],
      };
    }

    // ── 2. Rate limit check (Turn E) ──────────────────────────────
    // Fails fast BEFORE any store or provider work so a throttled
    // user never consumes downstream budget. The limiter itself
    // never throws — on impl errors it returns allowed=false with
    // a diagnostic code which we fold into `errors[]`.
    let rateLimitResult: RateLimitCheckResult | null = null;
    if (this.options.rateLimiter) {
      const rlT0 = Date.now();
      try {
        const key = this.options.rateLimitKeyFn
          ? this.options.rateLimitKeyFn(req, intent.intent)
          : defaultRateLimitKey(req.userId, intent.intent);
        rateLimitResult = await this.options.rateLimiter.check(
          key,
          this.options.rateLimitCost ?? 1,
        );
        rateLimitAllowed = rateLimitResult.allowed;
        rateLimitRemaining = rateLimitResult.remaining;
      } catch (err) {
        // Defensive — limiters should not throw, but if one does
        // we let the request through so a broken limiter doesn't
        // brick the whole pipeline.
        errors.push(
          `rate_limiter_threw: ${err instanceof Error ? err.message : String(err)}`,
        );
        rateLimitAllowed = true;
      }
      rateLimitCheckMs = Date.now() - rlT0;
    }

    if (rateLimitResult && !rateLimitResult.allowed) {
      const endedAt = Date.now();
      const retryAfterMs = rateLimitResult.retryAfterMs ?? 0;
      return {
        ok: false,
        text: "",
        toolCalls: [],
        toolExecutions: [],
        routing: {
          intent,
          providerName: "(none)",
          providerReason: "rate_limited",
        },
        validation: {
          ok: false,
          issues: [
            {
              severity: "error",
              code: "rate_limited",
              message: `request denied by rate limiter (key=${rateLimitResult.limiterKey}, retry after ~${retryAfterMs}ms)`,
            },
          ],
          refusalDetected: false,
          toolCallsValid: true,
        },
        telemetry: {
          ...emptyTelemetry(
            startedAt,
            endedAt,
            intentClassificationMs,
            0,
            0,
          ),
          rateLimitAllowed: false,
          rateLimitRemaining: rateLimitResult.remaining,
          rateLimitCheckMs,
          circuitBreakerState: "none",
        },
        errors: [...errors, `rate_limited:retry_after_ms=${retryAfterMs}`],
      };
    }

    // ── 3. Context enrichment (Turn C) ────────────────────────────
    // Runs before provider selection so enrichment failures are
    // visible even when no provider could be picked. Never throws;
    // a store error lands as `errors[]` on the bundle.
    const ctxT0 = Date.now();
    const contextBundle = await this.runContextEnrichment(req);
    contextEnrichmentMs = Date.now() - ctxT0;
    contextChunksIncluded = contextBundle.includedCount;
    for (const e of contextBundle.errors) {
      errors.push(`context: ${e}`);
    }

    // ── 4. Provider selection ─────────────────────────────────────
    // Passes the breaker registry so selectProvider filters out
    // known-sick adapters before picking one.
    const selection = selectProvider(
      this.options.adapters,
      intent.intent,
      req.preferredProvider,
      this.options.circuitBreakers,
    );

    if (!selection.adapter) {
      // No capable provider — return a graceful failure response
      // with the routing decision attached for visibility.
      const endedAt = Date.now();
      const circuitBroken = selection.reason.includes("circuit-broken");
      return {
        ok: false,
        text: "",
        toolCalls: [],
        toolExecutions: [],
        routing: {
          intent,
          providerName: "(none)",
          providerReason: selection.reason,
        },
        validation: {
          ok: false,
          issues: [
            {
              severity: "error",
              code: circuitBroken ? "circuit_breaker_open" : "no_capable_provider",
              message: selection.reason,
            },
          ],
          refusalDetected: false,
          toolCallsValid: true,
        },
        telemetry: {
          ...emptyTelemetry(
            startedAt,
            endedAt,
            intentClassificationMs,
            contextEnrichmentMs,
            contextChunksIncluded,
          ),
          rateLimitAllowed,
          rateLimitRemaining,
          rateLimitCheckMs,
          circuitBreakerState: circuitBroken ? "open" : "none",
        },
        errors: [
          ...errors,
          circuitBroken ? "circuit_breaker_open" : "no_capable_provider",
        ],
      };
    }

    const routing: RoutingDecision = {
      intent,
      providerName: selection.adapter.name,
      providerReason: selection.reason,
    };

    // Capture the breaker state at selection time so telemetry
    // reflects whether this call was a probe.
    if (this.options.circuitBreakers) {
      const status = this.options.circuitBreakers
        .get(selection.adapter.name)
        .getStatus();
      circuitBreakerState = status.state;
    }

    // ── 5. Build the normalized provider request ──────────────────
    // The message history is mutated during the agentic loop to
    // accumulate the model's tool-calling turns + the tool results
    // fed back. We start with just the user message and let the
    // loop append as it goes.
    let normalizedRequest = buildNormalizedRequest(
      req,
      this.options,
      contextBundle,
    );
    const messages: ProviderMessage[] = [...normalizedRequest.messages];

    // ── 5. Agentic tool loop (Turn D) ─────────────────────────────
    const registry = this.options.toolRegistry;
    const maxIterations =
      this.options.maxToolIterations ?? DEFAULT_OPTIONS.maxToolIterations;
    const maxRetries = this.options.maxRetries ?? DEFAULT_OPTIONS.maxRetries;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs;

    let lastResponse: ProviderResponse | null = null;

    for (let iter = 0; iter < maxIterations; iter++) {
      agenticIterations = iter + 1;

      const pT0 = Date.now();
      const callResult = await callProviderWithRetry(
        selection.adapter,
        normalizedRequest,
        maxRetries,
        timeoutMs,
        req.signal,
      );
      providerCallMs += Date.now() - pT0;
      retries += callResult.retries;
      for (const e of callResult.errors) errors.push(e);
      lastResponse = callResult.response;

      // If the model is done, or there is no registry to dispatch
      // tool calls to, or the model produced no tool calls, exit
      // the loop.
      if (
        !registry ||
        callResult.response.finishReason !== "tool_calls" ||
        callResult.response.toolCalls.length === 0
      ) {
        break;
      }

      // Execute every tool call from this turn in parallel.
      const ttT0 = Date.now();
      const outcomes = await executeToolBatch(
        registry,
        callResult.response.toolCalls,
        {
          userId: req.userId,
          conversationId: req.conversationId,
          iteration: iter,
        },
        req.signal ?? new AbortController().signal,
      );
      toolTotalMs += Date.now() - ttT0;
      toolExecutions.push(...outcomes);
      toolCallCount += outcomes.length;

      // Append the model's tool turn + the results to the running
      // history so the next iteration's provider call sees them.
      appendToolTurn(
        messages,
        callResult.response.text,
        callResult.response.toolCalls,
        outcomes,
      );

      // Rebuild the normalized request with the extended message
      // list. The systemPrompt + tools stay the same.
      normalizedRequest = {
        ...normalizedRequest,
        messages: [...messages],
      };

      // If the caller aborted mid-loop, don't start another iteration.
      if (req.signal?.aborted) break;
    }

    // Synthetic safety net: every path above should have populated
    // `lastResponse` (the loop always runs at least one iteration).
    // This defensive fallback keeps the orchestrator from crashing
    // if someone ever sets `maxToolIterations` to 0.
    const finalResponse: ProviderResponse = lastResponse ?? {
      text: "",
      finishReason: "error",
      toolCalls: [],
      raw: { error: "no provider response captured (maxToolIterations=0?)" },
    };

    // ── 6. Record breaker success/failure (Turn E) ────────────────
    // A finishReason of "stop" or "tool_calls" is a healthy outcome.
    // "error" / "aborted" / "content_filter" counts as a failure so
    // the breaker trips after enough consecutive bad calls.
    if (this.options.circuitBreakers) {
      const breaker = this.options.circuitBreakers.get(selection.adapter.name);
      const healthy =
        finalResponse.finishReason === "stop" ||
        finalResponse.finishReason === "tool_calls" ||
        finalResponse.finishReason === "length";
      if (healthy) {
        breaker.recordSuccess();
      } else {
        breaker.recordFailure();
      }
    }

    // ── 7. Validate the response ──────────────────────────────────
    const t1 = Date.now();
    const validation: ValidationReport = validateOutput(finalResponse, {
      toolDescriptors: normalizedRequest.tools,
      contextBundle,
      userMessage: req.message,
    });
    validationMs = Date.now() - t1;

    // ── 8. Assemble the final response ────────────────────────────
    const endedAt = Date.now();
    const telemetry: CognitiveTelemetry = {
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      intentClassificationMs,
      contextEnrichmentMs,
      providerCallMs,
      validationMs,
      retries,
      contextChunksIncluded,
      toolCallCount,
      toolTotalMs,
      agenticIterations,
      rateLimitAllowed,
      rateLimitRemaining,
      rateLimitCheckMs,
      circuitBreakerState,
      promptTokens: finalResponse.usage?.promptTokens,
      completionTokens: finalResponse.usage?.completionTokens,
    };

    return {
      ok: validation.ok,
      text: finalResponse.text,
      toolCalls: finalResponse.toolCalls,
      toolExecutions,
      routing,
      validation,
      telemetry,
      errors,
    };
  }

  /**
   * Stream a single cognitive request end-to-end. Never throws.
   *
   * Emits a fixed sequence of `CognitiveStreamEvent`s as the pipeline
   * progresses. The happy-path order is:
   *
   *   1. exactly ONE  "intent-decided"
   *   2. zero or more "text-delta"
   *   3. zero or more "tool-call"
   *   4. exactly ONE  "validation"
   *   5. exactly ONE  "done"           (terminates the stream)
   *
   * On failure before provider selection (no capable adapter,
   * classifier threw), the generator emits ONE "error" followed by
   * ONE "done" whose response has `ok: false`. The "done" event
   * ALWAYS fires, so consumers can rely on it as the single
   * termination marker.
   *
   * Streaming strategy:
   *
   *   • If the chosen adapter implements `generateStream`, we pipe
   *     its chunks through directly. The adapter is responsible for
   *     aggregating multi-chunk tool calls into complete ones before
   *     yielding them.
   *
   *   • If the chosen adapter does NOT implement `generateStream`,
   *     we fall back to calling `generate()` once and synthesizing
   *     a single text-delta from the full response. Streaming-naive
   *     adapters still work — just not incrementally.
   *
   * Cancellation:
   *
   *   • The caller's `req.signal` is forwarded to the adapter. When
   *     it aborts, the adapter's iterator receives an aborted signal,
   *     the generator records an "aborted" finish reason, and the
   *     "done" event fires with `ok: false`.
   *
   *   • A timeout AbortController is also chained in — matches the
   *     retry path's semantics so streaming and non-streaming have
   *     identical hang-protection.
   *
   * Retries:
   *
   *   • Streaming requests are NOT retried. By the time the first
   *     chunk reaches the consumer, the stream is committed. A
   *     mid-stream error is reported via the "error" event plus a
   *     done event with `ok: false`; the consumer can re-issue the
   *     request if desired.
   */
  async *runStream(
    req: CognitiveRequest,
  ): AsyncGenerator<CognitiveStreamEvent, void, void> {
    const startedAt = Date.now();
    let intentClassificationMs = 0;
    let contextEnrichmentMs = 0;
    let providerCallMs = 0;
    let validationMs = 0;
    let contextChunksIncluded = 0;
    let rateLimitCheckMs = 0;
    let rateLimitAllowed = true;
    let rateLimitRemaining = Number.NaN;
    let circuitBreakerState: CognitiveTelemetry["circuitBreakerState"] = "none";
    const errors: string[] = [];

    // ── 1. Intent classification ──────────────────────────────────
    let intent: IntentClassification;
    try {
      const t0 = Date.now();
      intent = classifyIntent(req.message, req.intentHint);
      intentClassificationMs = Date.now() - t0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`intent_classifier_threw: ${message}`);
      intent = {
        intent: "unknown",
        confidence: 0,
        reasoning: `classifier threw: ${message}`,
        alternatives: [],
      };
    }

    // ── 2. Rate limit check (Turn E) ──────────────────────────────
    let rateLimitResult: RateLimitCheckResult | null = null;
    if (this.options.rateLimiter) {
      const rlT0 = Date.now();
      try {
        const key = this.options.rateLimitKeyFn
          ? this.options.rateLimitKeyFn(req, intent.intent)
          : defaultRateLimitKey(req.userId, intent.intent);
        rateLimitResult = await this.options.rateLimiter.check(
          key,
          this.options.rateLimitCost ?? 1,
        );
        rateLimitAllowed = rateLimitResult.allowed;
        rateLimitRemaining = rateLimitResult.remaining;
      } catch (err) {
        errors.push(
          `rate_limiter_threw: ${err instanceof Error ? err.message : String(err)}`,
        );
        rateLimitAllowed = true;
      }
      rateLimitCheckMs = Date.now() - rlT0;
    }

    if (rateLimitResult && !rateLimitResult.allowed) {
      const retryAfterMs = rateLimitResult.retryAfterMs ?? 0;
      yield {
        kind: "error",
        code: "rate_limited",
        message: `request denied by rate limiter (retry after ~${retryAfterMs}ms)`,
      };
      const endedAt = Date.now();
      yield {
        kind: "done",
        response: {
          ok: false,
          text: "",
          toolCalls: [],
          toolExecutions: [],
          routing: {
            intent,
            providerName: "(none)",
            providerReason: "rate_limited",
          },
          validation: {
            ok: false,
            issues: [
              {
                severity: "error",
                code: "rate_limited",
                message: `request denied by rate limiter (key=${rateLimitResult.limiterKey}, retry after ~${retryAfterMs}ms)`,
              },
            ],
            refusalDetected: false,
            toolCallsValid: true,
          },
          telemetry: {
            ...emptyTelemetry(
              startedAt,
              endedAt,
              intentClassificationMs,
              0,
              0,
            ),
            rateLimitAllowed: false,
            rateLimitRemaining: rateLimitResult.remaining,
            rateLimitCheckMs,
            circuitBreakerState: "none",
          },
          errors: [...errors, `rate_limited:retry_after_ms=${retryAfterMs}`],
        },
      };
      return;
    }

    // ── 3. Context enrichment (Turn C) ────────────────────────────
    const ctxT0 = Date.now();
    const contextBundle = await this.runContextEnrichment(req);
    contextEnrichmentMs = Date.now() - ctxT0;
    contextChunksIncluded = contextBundle.includedCount;
    for (const e of contextBundle.errors) {
      errors.push(`context: ${e}`);
    }

    // ── 4. Provider selection ─────────────────────────────────────
    const selection = selectProvider(
      this.options.adapters,
      intent.intent,
      req.preferredProvider,
      this.options.circuitBreakers,
    );

    if (!selection.adapter) {
      const circuitBroken = selection.reason.includes("circuit-broken");
      yield {
        kind: "error",
        code: circuitBroken ? "circuit_breaker_open" : "no_capable_provider",
        message: selection.reason,
      };
      const endedAt = Date.now();
      yield {
        kind: "done",
        response: {
          ok: false,
          text: "",
          toolCalls: [],
          toolExecutions: [],
          routing: {
            intent,
            providerName: "(none)",
            providerReason: selection.reason,
          },
          validation: {
            ok: false,
            issues: [
              {
                severity: "error",
                code: circuitBroken ? "circuit_breaker_open" : "no_capable_provider",
                message: selection.reason,
              },
            ],
            refusalDetected: false,
            toolCallsValid: true,
          },
          telemetry: {
            ...emptyTelemetry(
              startedAt,
              endedAt,
              intentClassificationMs,
              contextEnrichmentMs,
              contextChunksIncluded,
            ),
            rateLimitAllowed,
            rateLimitRemaining,
            rateLimitCheckMs,
            circuitBreakerState: circuitBroken ? "open" : "none",
          },
          errors: [
            ...errors,
            circuitBroken ? "circuit_breaker_open" : "no_capable_provider",
          ],
        },
      };
      return;
    }

    const routing: RoutingDecision = {
      intent,
      providerName: selection.adapter.name,
      providerReason: selection.reason,
    };

    // Capture the breaker state at selection time so the stream
    // consumer can distinguish a normal call from a half-open probe.
    if (this.options.circuitBreakers) {
      const status = this.options.circuitBreakers
        .get(selection.adapter.name)
        .getStatus();
      circuitBreakerState = status.state;
    }

    // Emit the routing decision BEFORE we call the provider so the
    // consumer can surface "thinking…" UI even if the first text
    // chunk takes a while to arrive.
    yield { kind: "intent-decided", routing };

    // Emit a context-enriched event immediately after intent so the
    // UI can render "read N memories / docs" indicators before the
    // first token arrives.
    yield {
      kind: "context-enriched",
      chunksIncluded: contextBundle.includedCount,
      totalChars: contextBundle.totalChars,
      contextEnrichmentMs,
    };

    // ── 4. Build the normalized provider request ──────────────────
    // The message history mutates during the agentic loop; start
    // with just the user message and accumulate tool turns + tool
    // results as iterations progress.
    let normalizedRequest = buildNormalizedRequest(
      req,
      this.options,
      contextBundle,
    );
    const messages: ProviderMessage[] = [...normalizedRequest.messages];

    // Cancellation + timeout: a fresh controller that wires the
    // caller's signal + a per-iteration timeout. Rebuilt each
    // iteration so a previous timer doesn't leak.
    const externalSignal = req.signal;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs;
    const registry = this.options.toolRegistry;
    const maxIterations =
      this.options.maxToolIterations ?? DEFAULT_OPTIONS.maxToolIterations;

    // ── 5. Agentic streaming loop (Turn D) ────────────────────────
    let accumulatedText = "";
    const accumulatedToolCalls: ProviderToolCall[] = [];
    const toolExecutions: ToolExecutionOutcome[] = [];
    let finishReason: ProviderFinishReason = "stop";
    let usage: ProviderUsage | undefined;
    let toolCallCount = 0;
    let toolTotalMs = 0;
    let agenticIterations = 0;
    let terminatedByErrorEvent = false;

    for (let iter = 0; iter < maxIterations; iter++) {
      agenticIterations = iter + 1;

      // Per-iteration controller so the timeout and listeners don't
      // leak across iterations.
      const controller = new AbortController();
      const onExternalAbort = (): void => controller.abort();
      if (externalSignal) {
        if (externalSignal.aborted) {
          controller.abort();
        } else {
          externalSignal.addEventListener("abort", onExternalAbort, { once: true });
        }
      }
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      // One provider turn's accumulators — reset per iteration so
      // the tool loop appends only this iteration's text + tool
      // calls to the running history.
      let turnText = "";
      const turnToolCalls: ProviderToolCall[] = [];
      let turnFinishReason: ProviderFinishReason = "stop";
      let turnUsage: ProviderUsage | undefined;

      const pt0 = Date.now();
      try {
        if (typeof selection.adapter.generateStream === "function") {
          try {
            const iterator = selection.adapter.generateStream(
              normalizedRequest,
              controller.signal,
            );
            for await (const chunk of iterator) {
              if (chunk.delta && chunk.delta.length > 0) {
                turnText += chunk.delta;
                accumulatedText += chunk.delta;
                yield { kind: "text-delta", delta: chunk.delta };
              }
              if (chunk.toolCall) {
                turnToolCalls.push(chunk.toolCall);
                accumulatedToolCalls.push(chunk.toolCall);
                yield { kind: "tool-call", toolCall: chunk.toolCall };
              }
              if (chunk.done) {
                if (chunk.finishReason) turnFinishReason = chunk.finishReason;
                if (chunk.usage) turnUsage = chunk.usage;
                break;
              }
            }
            if (turnFinishReason === "aborted") {
              errors.push("aborted");
              yield { kind: "error", code: "aborted", message: "request aborted" };
              terminatedByErrorEvent = true;
            } else if (turnFinishReason === "error") {
              errors.push("provider_error");
              yield {
                kind: "error",
                code: "provider_error",
                message: "provider stream terminated with error",
              };
              terminatedByErrorEvent = true;
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`provider_stream_threw: ${msg}`);
            turnFinishReason = controller.signal.aborted ? "aborted" : "error";
            yield {
              kind: "error",
              code: turnFinishReason === "aborted" ? "aborted" : "provider_stream_threw",
              message: msg,
            };
            terminatedByErrorEvent = true;
          }
        } else {
          // Streaming-naive adapter fallback: one generate() call
          // per iteration, synthesize a single text-delta for the
          // full response so the event contract stays intact.
          try {
            const response = await selection.adapter.generate(
              normalizedRequest,
              controller.signal,
            );
            if (response.text.length > 0) {
              turnText = response.text;
              accumulatedText += response.text;
              yield { kind: "text-delta", delta: response.text };
            }
            for (const tc of response.toolCalls) {
              turnToolCalls.push(tc);
              accumulatedToolCalls.push(tc);
              yield { kind: "tool-call", toolCall: tc };
            }
            turnFinishReason = response.finishReason;
            turnUsage = response.usage;
            if (turnFinishReason === "error") {
              const errMsg =
                (response.raw as { error?: string } | undefined)?.error ??
                "unknown provider error";
              errors.push(errMsg);
              yield { kind: "error", code: "provider_error", message: errMsg };
              terminatedByErrorEvent = true;
            } else if (turnFinishReason === "aborted") {
              errors.push("aborted");
              yield { kind: "error", code: "aborted", message: "request aborted" };
              terminatedByErrorEvent = true;
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`generate_threw: ${msg}`);
            turnFinishReason = controller.signal.aborted ? "aborted" : "error";
            yield {
              kind: "error",
              code: turnFinishReason === "aborted" ? "aborted" : "generate_threw",
              message: msg,
            };
            terminatedByErrorEvent = true;
          }
        }
      } finally {
        clearTimeout(timer);
        if (externalSignal) {
          externalSignal.removeEventListener("abort", onExternalAbort);
        }
      }
      providerCallMs += Date.now() - pt0;
      // Keep usage on the LAST iteration's totals — matches the
      // non-streaming run() which reports the terminal turn's usage.
      usage = turnUsage;
      finishReason = turnFinishReason;

      // Break on error / abort — no point looping further.
      if (turnFinishReason === "error" || turnFinishReason === "aborted") break;

      // No tool loop needed if the model is done, or no registry,
      // or there are no tool calls to dispatch.
      if (
        !registry ||
        turnFinishReason !== "tool_calls" ||
        turnToolCalls.length === 0
      ) {
        break;
      }

      // Execute every tool call from this turn in parallel.
      const ttT0 = Date.now();
      const outcomes = await executeToolBatch(
        registry,
        turnToolCalls,
        {
          userId: req.userId,
          conversationId: req.conversationId,
          iteration: iter,
        },
        externalSignal ?? new AbortController().signal,
      );
      toolTotalMs += Date.now() - ttT0;
      toolExecutions.push(...outcomes);
      toolCallCount += outcomes.length;

      // Tell the consumer each tool has run — these events drive
      // the "✓ searched the web" style UI ticks.
      for (const outcome of outcomes) {
        yield { kind: "tool-result", outcome };
      }

      // Extend the message history + rebuild the request so the
      // next iteration's provider sees the tool results.
      appendToolTurn(messages, turnText, turnToolCalls, outcomes);
      normalizedRequest = {
        ...normalizedRequest,
        messages: [...messages],
      };

      // Respect mid-loop cancellation.
      if (externalSignal?.aborted) break;
    }

    // Suppress an unused-variable warning when the early-exit path
    // sets `terminatedByErrorEvent` but the rest of the function
    // doesn't need it — its purpose is to make error → done ordering
    // obvious to future readers.
    void terminatedByErrorEvent;

    // ── 6. Record breaker outcome (Turn E) ────────────────────────
    if (this.options.circuitBreakers) {
      const breaker = this.options.circuitBreakers.get(selection.adapter.name);
      const healthy =
        finishReason === "stop" ||
        finishReason === "tool_calls" ||
        finishReason === "length";
      if (healthy) {
        breaker.recordSuccess();
      } else {
        breaker.recordFailure();
      }
    }

    // ── 7. Validate the assembled response ────────────────────────
    const assembled: ProviderResponse = {
      text: accumulatedText,
      finishReason,
      toolCalls: accumulatedToolCalls,
      usage,
    };
    const vt0 = Date.now();
    const validation: ValidationReport = validateOutput(assembled, {
      toolDescriptors: normalizedRequest.tools,
      contextBundle,
      userMessage: req.message,
    });
    validationMs = Date.now() - vt0;

    yield { kind: "validation", validation };

    // ── 8. Emit the terminal "done" event ─────────────────────────
    const endedAt = Date.now();
    const telemetry: CognitiveTelemetry = {
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      intentClassificationMs,
      contextEnrichmentMs,
      providerCallMs,
      validationMs,
      retries: 0,
      contextChunksIncluded,
      toolCallCount,
      toolTotalMs,
      agenticIterations,
      rateLimitAllowed,
      rateLimitRemaining,
      rateLimitCheckMs,
      circuitBreakerState,
      promptTokens: usage?.promptTokens,
      completionTokens: usage?.completionTokens,
    };

    const response: CognitiveResponse = {
      ok: validation.ok,
      text: accumulatedText,
      toolCalls: accumulatedToolCalls,
      toolExecutions,
      routing,
      validation,
      telemetry,
      errors,
    };

    yield { kind: "done", response };
  }

  /**
   * List the names of every registered adapter, in priority order.
   * Useful for debugging and for surfacing to users which providers
   * are currently available.
   */
  listAdapters(): string[] {
    return this.options.adapters.map((a) => a.name);
  }
}

function emptyTelemetry(
  startedAt: number,
  endedAt: number,
  intentClassificationMs: number,
  contextEnrichmentMs: number = 0,
  contextChunksIncluded: number = 0,
): CognitiveTelemetry {
  return {
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    intentClassificationMs,
    contextEnrichmentMs,
    providerCallMs: 0,
    validationMs: 0,
    retries: 0,
    contextChunksIncluded,
    toolCallCount: 0,
    toolTotalMs: 0,
    agenticIterations: 0,
    rateLimitAllowed: true,
    rateLimitRemaining: Number.NaN,
    rateLimitCheckMs: 0,
    circuitBreakerState: "none",
  };
}
