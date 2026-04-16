/**
 * Cognitive Middleware — OpenTelemetry tracing facade (Turn F).
 *
 * Closes the observability loop we opened in Turn A with
 * `CognitiveTelemetry`. Turn A returned numeric stage durations as
 * inline data on the response; Turn F ALSO emits the same stages as
 * OpenTelemetry spans so external tooling (Jaeger, Honeycomb,
 * Datadog, OTLP collectors) can see the full request trace.
 *
 * Design principles:
 *
 *   1. **Zero-cost when disabled.** `@opentelemetry/api` returns a
 *      no-op tracer unless a `TracerProvider` has been installed.
 *      We import from `api` directly rather than taking a tracer
 *      as a constructor argument — callers that want real tracing
 *      just wire a provider in their app bootstrap and every
 *      `withCognitiveSpan` call automatically lights up.
 *
 *   2. **Never throws.** Tracing is a cross-cutting concern; a
 *      misconfigured exporter should NEVER take down a user request.
 *      `withCognitiveSpan` catches every exception thrown inside
 *      the span lifecycle management and swallows them (logs via
 *      diag.warn). The wrapped function's own exceptions are
 *      recorded on the span AND re-thrown so the caller still sees
 *      them.
 *
 *   3. **Stable attribute vocabulary.** Every attribute uses the
 *      `cognitive.*` prefix so dashboards built against our traces
 *      don't collide with third-party instrumentation. Attribute
 *      NAMES are frozen in `CognitiveAttributes` below — code
 *      that sets attributes should NEVER use string literals so
 *      rename refactors are type-safe.
 *
 *   4. **Context propagation via the OTel context API.** Child
 *      spans inherit their parent via `context.with`, not via a
 *      custom "current span" ref. This keeps the tracer
 *      re-entrant and lets other instrumentation (express,
 *      postgres, http) chain into our spans without any extra
 *      glue.
 *
 *   5. **No spans for no-op work.** A stage that is disabled
 *      (e.g., rate limit when no limiter is configured) does NOT
 *      emit a zero-duration span. The caller guards with an
 *      `if (limiter)` check and skips the `withCognitiveSpan`
 *      entirely.
 */

import {
  SpanStatusCode,
  type Attributes,
  type Span,
  type Tracer,
  context as otelContext,
  diag,
  trace,
} from "@opentelemetry/api";

// ---------------------------------------------------------------------------
// Tracer identity
// ---------------------------------------------------------------------------

/** Stable instrumentation name shown in every span. */
export const COGNITIVE_TRACER_NAME = "iliagpt.cognitive-middleware";

/**
 * Instrumentation version. Bumped whenever the span layout changes
 * in a way downstream dashboards might care about.
 */
export const COGNITIVE_TRACER_VERSION = "1.0.0";

let cachedTracer: Tracer | null = null;

/**
 * Lazy-resolve the tracer exactly once. This matters because
 * `trace.getTracer` is cheap but not free, and we call it on every
 * pipeline stage in the hot path.
 *
 * Tests that swap the global tracer provider mid-run should call
 * `resetCognitiveTracerCache()` to force a re-resolve.
 */
export function getCognitiveTracer(): Tracer {
  if (!cachedTracer) {
    cachedTracer = trace.getTracer(COGNITIVE_TRACER_NAME, COGNITIVE_TRACER_VERSION);
  }
  return cachedTracer;
}

/**
 * Clear the cached tracer. ONLY intended for tests that swap the
 * global tracer provider between test cases.
 */
export function resetCognitiveTracerCache(): void {
  cachedTracer = null;
}

// ---------------------------------------------------------------------------
// Span name catalogue
// ---------------------------------------------------------------------------

/**
 * Frozen span-name catalogue. Dashboards use these exact strings,
 * so renaming one is a breaking change. New stages can be added;
 * existing ones should never be renamed.
 */
export const CognitiveSpanNames = Object.freeze({
  /** Root span for a `run()` call — the full synchronous request. */
  RUN: "cognitive.run",
  /** Root span for a `runStream()` call — the full SSE-style request. */
  RUN_STREAM: "cognitive.run_stream",
  /** Intent router execution. */
  INTENT_CLASSIFY: "cognitive.intent_classify",
  /** Rate limiter check. Skipped when no limiter is configured. */
  RATE_LIMIT_CHECK: "cognitive.rate_limit_check",
  /** Context enrichment (memory + docs lookup + budget packing). */
  CONTEXT_ENRICH: "cognitive.context_enrich",
  /** Provider selection — adapter filter + tiebreaker. */
  PROVIDER_SELECT: "cognitive.provider_select",
  /**
   * One provider adapter call. In the agentic loop this span is
   * emitted PER iteration, tagged with `cognitive.agentic_iteration`.
   */
  PROVIDER_CALL: "cognitive.provider_call",
  /**
   * One tool handler invocation. Emitted per tool call in the
   * batch, parallel with siblings.
   */
  TOOL_EXECUTE: "cognitive.tool_execute",
  /** Output validation. */
  VALIDATE: "cognitive.validate",
} as const);

export type CognitiveSpanName =
  (typeof CognitiveSpanNames)[keyof typeof CognitiveSpanNames];

// ---------------------------------------------------------------------------
// Attribute catalogue
// ---------------------------------------------------------------------------

/**
 * Frozen attribute-key catalogue. Same rules as `CognitiveSpanNames`.
 *
 * Naming convention: `cognitive.<stage>.<field>` when the attribute
 * is stage-specific (e.g., `cognitive.intent.confidence`), or
 * `cognitive.<field>` when it belongs to the root request and is
 * reasonable to set on any span.
 */
export const CognitiveAttributes = Object.freeze({
  // Request-wide
  USER_ID: "cognitive.user_id",
  CONVERSATION_ID: "cognitive.conversation_id",
  REQUEST_MESSAGE_LENGTH: "cognitive.request.message_length",

  // Intent
  INTENT: "cognitive.intent",
  INTENT_CONFIDENCE: "cognitive.intent.confidence",
  INTENT_REASONING: "cognitive.intent.reasoning",

  // Rate limit
  RATE_LIMIT_ALLOWED: "cognitive.rate_limit.allowed",
  RATE_LIMIT_REMAINING: "cognitive.rate_limit.remaining",
  RATE_LIMIT_CAPACITY: "cognitive.rate_limit.capacity",
  RATE_LIMIT_KEY: "cognitive.rate_limit.key",
  RATE_LIMIT_RETRY_AFTER_MS: "cognitive.rate_limit.retry_after_ms",

  // Context enrichment
  CONTEXT_CHUNKS_RETRIEVED: "cognitive.context.chunks_retrieved",
  CONTEXT_CHUNKS_INCLUDED: "cognitive.context.chunks_included",
  CONTEXT_TOTAL_CHARS: "cognitive.context.total_chars",
  CONTEXT_MEMORY_LOOKUP_MS: "cognitive.context.memory_lookup_ms",
  CONTEXT_DOCUMENT_LOOKUP_MS: "cognitive.context.document_lookup_ms",

  // Provider
  PROVIDER_NAME: "cognitive.provider",
  PROVIDER_REASON: "cognitive.provider.reason",
  PROVIDER_FINISH_REASON: "cognitive.provider.finish_reason",
  PROVIDER_RETRIES: "cognitive.provider.retries",
  PROVIDER_PROMPT_TOKENS: "cognitive.provider.prompt_tokens",
  PROVIDER_COMPLETION_TOKENS: "cognitive.provider.completion_tokens",

  // Circuit breaker
  CIRCUIT_BREAKER_STATE: "cognitive.circuit_breaker.state",

  // Agentic loop
  AGENTIC_ITERATION: "cognitive.agentic_iteration",
  AGENTIC_MAX_ITERATIONS: "cognitive.agentic_max_iterations",

  // Tools
  TOOL_NAME: "cognitive.tool.name",
  TOOL_OK: "cognitive.tool.ok",
  TOOL_ERROR_CODE: "cognitive.tool.error_code",
  TOOL_CALL_ID: "cognitive.tool.call_id",

  // Validation
  VALIDATION_OK: "cognitive.validation.ok",
  VALIDATION_ISSUE_COUNT: "cognitive.validation.issue_count",
  VALIDATION_REFUSAL: "cognitive.validation.refusal_detected",
} as const);

export type CognitiveAttributeKey =
  (typeof CognitiveAttributes)[keyof typeof CognitiveAttributes];

// ---------------------------------------------------------------------------
// Span helper
// ---------------------------------------------------------------------------

/**
 * Execute `fn` inside a new OTel span named `spanName` with the
 * supplied `attributes`. Returns whatever `fn` returns (or rejects
 * with whatever it rejected with).
 *
 * Semantics:
 *
 *   • The span is a CHILD of the current active span, whatever
 *     that is. Callers don't need to thread context manually.
 *
 *   • If `fn` resolves, the span is closed with `OK` status.
 *
 *   • If `fn` throws or rejects:
 *       - the exception is recorded on the span
 *         (`span.recordException`),
 *       - the span status is set to `ERROR` with `err.message`,
 *       - the span is closed,
 *       - the ORIGINAL exception is re-thrown to the caller.
 *
 *   • If the tracer itself throws (rare but defensive against
 *     broken exporters), the error is logged via `diag.warn`
 *     and `fn` is called WITHOUT a span so the pipeline still
 *     works.
 *
 * Prefer this over raw `startSpan` + `end` because it handles all
 * four lifecycle events (open, attr set, error record, close) in
 * one place and guarantees every span is closed exactly once.
 */
export async function withCognitiveSpan<T>(
  spanName: CognitiveSpanName,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  let tracer: Tracer;
  try {
    tracer = getCognitiveTracer();
  } catch (err) {
    diag.warn(
      `[cognitive.tracing] getTracer failed; proceeding without span: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    // Fallback: run fn without a span. Callers expect the
    // pipeline to keep working even if tracing is broken.
    return fn(
      // Minimal span stub so fn can still call span.setAttribute
      // without crashing. All methods are no-ops.
      NOOP_SPAN as unknown as Span,
    );
  }

  const span = tracer.startSpan(spanName, { attributes });
  const ctxWithSpan = trace.setSpan(otelContext.active(), span);

  try {
    return await otelContext.with(ctxWithSpan, async () => fn(span));
  } catch (err) {
    // Record the exception + mark the span errored, then rethrow.
    try {
      if (err instanceof Error) {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      } else {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: typeof err === "string" ? err : "non-error throwable",
        });
      }
    } catch (recordErr) {
      // Exporter blew up — log and continue so the user's exception
      // still propagates unchanged.
      diag.warn(
        `[cognitive.tracing] recordException failed: ${
          recordErr instanceof Error ? recordErr.message : String(recordErr)
        }`,
      );
    }
    throw err;
  } finally {
    try {
      span.end();
    } catch (endErr) {
      diag.warn(
        `[cognitive.tracing] span.end failed: ${
          endErr instanceof Error ? endErr.message : String(endErr)
        }`,
      );
    }
  }
}

/**
 * Synchronous sibling of `withCognitiveSpan` for stages that do
 * not need async. Same error semantics.
 */
export function withCognitiveSpanSync<T>(
  spanName: CognitiveSpanName,
  attributes: Attributes,
  fn: (span: Span) => T,
): T {
  let tracer: Tracer;
  try {
    tracer = getCognitiveTracer();
  } catch (err) {
    diag.warn(
      `[cognitive.tracing] getTracer failed; proceeding without span: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return fn(NOOP_SPAN as unknown as Span);
  }

  const span = tracer.startSpan(spanName, { attributes });
  const ctxWithSpan = trace.setSpan(otelContext.active(), span);

  try {
    return otelContext.with(ctxWithSpan, () => fn(span));
  } catch (err) {
    try {
      if (err instanceof Error) {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      } else {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: typeof err === "string" ? err : "non-error throwable",
        });
      }
    } catch {
      // swallow
    }
    throw err;
  } finally {
    try {
      span.end();
    } catch {
      // swallow
    }
  }
}

// ---------------------------------------------------------------------------
// Internal no-op span fallback
// ---------------------------------------------------------------------------

/**
 * Minimal no-op `Span`-shaped object used when the tracer itself
 * can't be resolved. Every mutating method is a no-op; every
 * accessor returns a safe default. We intentionally don't import
 * OTel's own `NoopSpan` because that's an internal API that has
 * shifted between minor versions.
 */
const NOOP_SPAN = {
  setAttribute: () => NOOP_SPAN,
  setAttributes: () => NOOP_SPAN,
  addEvent: () => NOOP_SPAN,
  addLink: () => NOOP_SPAN,
  addLinks: () => NOOP_SPAN,
  setStatus: () => NOOP_SPAN,
  updateName: () => NOOP_SPAN,
  end: () => undefined,
  isRecording: () => false,
  recordException: () => undefined,
  spanContext: () => ({
    traceId: "00000000000000000000000000000000",
    spanId: "0000000000000000",
    traceFlags: 0,
  }),
};
