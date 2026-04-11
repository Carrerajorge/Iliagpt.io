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
import type {
  CognitiveIntent,
  CognitiveRequest,
  CognitiveResponse,
  CognitiveTelemetry,
  IntentClassification,
  NormalizedProviderRequest,
  ProviderAdapter,
  ProviderResponse,
  ProviderToolDescriptor,
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
}

const DEFAULT_OPTIONS = {
  maxRetries: 2,
  timeoutMs: 60_000,
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
 *   1. If `preferredProvider` is set AND that provider exists AND
 *      claims it can serve `intent` → use it. Reason: "preferred".
 *
 *   2. Otherwise, scan `adapters` in order and pick the first one
 *      whose `capabilities` set contains `intent`. Reason:
 *      "first capable".
 *
 *   3. If no adapter matches → return null. The orchestrator will
 *      then return an `ok=false` response.
 *
 * Test-friendly: pure function, no side effects.
 */
export function selectProvider(
  adapters: readonly ProviderAdapter[],
  intent: CognitiveIntent,
  preferredProvider?: string,
): ProviderSelectionResult {
  if (adapters.length === 0) {
    return { adapter: null, reason: "no adapters registered" };
  }

  if (preferredProvider) {
    const preferred = adapters.find((a) => a.name === preferredProvider);
    if (preferred && preferred.capabilities.has(intent)) {
      return { adapter: preferred, reason: `preferred provider ${preferred.name}` };
    }
    if (preferred && !preferred.capabilities.has(intent)) {
      // Preferred exists but can't handle this intent — fall through
      // to first-capable, log the mismatch in the reason.
      const first = adapters.find((a) => a.capabilities.has(intent));
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
      // Preferred name doesn't exist at all — fall through.
      const first = adapters.find((a) => a.capabilities.has(intent));
      if (first) {
        return {
          adapter: first,
          reason: `preferred provider "${preferredProvider}" not registered, fell back to ${first.name}`,
        };
      }
      return {
        adapter: null,
        reason: `preferred provider "${preferredProvider}" not registered and no fallback is capable`,
      };
    }
  }

  const first = adapters.find((a) => a.capabilities.has(intent));
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
 * + the middleware's defaults. Pure function — output depends only
 * on inputs, no global state.
 */
export function buildNormalizedRequest(
  req: CognitiveRequest,
  options: CognitiveMiddlewareOptions,
): NormalizedProviderRequest {
  return {
    systemPrompt: options.defaultSystemPrompt,
    messages: [
      {
        role: "user",
        content: req.message,
      },
    ],
    tools: options.defaultTools,
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
// Main orchestrator
// ---------------------------------------------------------------------------

export class CognitiveMiddleware {
  constructor(private readonly options: CognitiveMiddlewareOptions) {
    if (!Array.isArray(options.adapters)) {
      throw new Error("CognitiveMiddleware: options.adapters must be an array");
    }
  }

  /**
   * Run a single cognitive request end-to-end. Never throws.
   */
  async run(req: CognitiveRequest): Promise<CognitiveResponse> {
    const startedAt = Date.now();
    let intentClassificationMs = 0;
    let providerCallMs = 0;
    let validationMs = 0;
    let retries = 0;
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

    // ── 2. Provider selection ─────────────────────────────────────
    const selection = selectProvider(
      this.options.adapters,
      intent.intent,
      req.preferredProvider,
    );

    if (!selection.adapter) {
      // No capable provider — return a graceful failure response
      // with the routing decision attached for visibility.
      const endedAt = Date.now();
      return {
        ok: false,
        text: "",
        toolCalls: [],
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
              code: "no_capable_provider",
              message: selection.reason,
            },
          ],
          refusalDetected: false,
          toolCallsValid: true,
        },
        telemetry: emptyTelemetry(startedAt, endedAt, intentClassificationMs),
        errors: [...errors, "no_capable_provider"],
      };
    }

    const routing: RoutingDecision = {
      intent,
      providerName: selection.adapter.name,
      providerReason: selection.reason,
    };

    // ── 3. Build the normalized provider request ──────────────────
    const normalizedRequest = buildNormalizedRequest(req, this.options);

    // ── 4. Call the provider with retry / timeout / cancellation ──
    const t0 = Date.now();
    const callResult = await callProviderWithRetry(
      selection.adapter,
      normalizedRequest,
      this.options.maxRetries ?? DEFAULT_OPTIONS.maxRetries,
      this.options.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs,
      req.signal,
    );
    providerCallMs = Date.now() - t0;
    retries = callResult.retries;
    for (const e of callResult.errors) errors.push(e);

    // ── 5. Validate the response ──────────────────────────────────
    const t1 = Date.now();
    const validation: ValidationReport = validateOutput(callResult.response, {
      toolDescriptors: normalizedRequest.tools,
    });
    validationMs = Date.now() - t1;

    // ── 6. Assemble the final response ────────────────────────────
    const endedAt = Date.now();
    const telemetry: CognitiveTelemetry = {
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      intentClassificationMs,
      providerCallMs,
      validationMs,
      retries,
      promptTokens: callResult.response.usage?.promptTokens,
      completionTokens: callResult.response.usage?.completionTokens,
    };

    return {
      ok: validation.ok,
      text: callResult.response.text,
      toolCalls: callResult.response.toolCalls,
      routing,
      validation,
      telemetry,
      errors,
    };
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
): CognitiveTelemetry {
  return {
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    intentClassificationMs,
    providerCallMs: 0,
    validationMs: 0,
    retries: 0,
  };
}
