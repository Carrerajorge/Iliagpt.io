/**
 * Cognitive Middleware — shared type contracts.
 *
 * This is the SHAPE LAYER of the cognitive middleware: every other
 * file in `server/cognitive/` consumes these types and never invents
 * its own.
 *
 * Design principles:
 *
 *   1. Provider-agnostic. Nothing here mentions Claude, GPT, Gemini,
 *      etc. by name. The `ProviderAdapter` interface is the single
 *      seam between this layer and any concrete LLM. Same code path
 *      runs against the in-house GPT-3, an OpenAI API call, an
 *      Anthropic Messages call, a mock for tests, or anything else
 *      that implements the interface.
 *
 *   2. Total functions. Every operation that could fail (provider
 *      call, validation, retries) returns a `Result`-shaped value
 *      with `ok: boolean` instead of throwing. The orchestrator
 *      itself never throws to its caller — it always returns a
 *      well-formed `CognitiveResponse` with `ok=false` on failure.
 *      This is what makes the layer composable: callers can wire it
 *      into HTTP handlers, queue workers, or background jobs without
 *      worrying about uncaught exceptions taking down the process.
 *
 *   3. Telemetry as a first-class field. Every response carries a
 *      `CognitiveTelemetry` block that records timings for each
 *      pipeline stage. This enables both debugging (slow stages
 *      stand out) and dashboarding (export to OpenTelemetry without
 *      having to instrument the codebase a second time).
 *
 *   4. Cancellation via standard `AbortSignal`. Every long-running
 *      operation accepts an optional signal. When the caller aborts
 *      (HTTP client disconnects, user cancels, timeout fires), the
 *      orchestrator forwards the signal down to the provider call
 *      and returns a `CognitiveResponse` with `errors: ["aborted"]`.
 *
 *   5. Pure data, no methods. Types are interfaces, not classes.
 *      Behavior lives in standalone functions that take and return
 *      these types. This keeps the layer testable (no mocks needed
 *      for the data itself) and serializable (the entire response
 *      survives a JSON.stringify round-trip).
 */

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

/**
 * Discrete categories of user intent the middleware knows how to
 * route. The list is small on purpose: a fat enum is harder to
 * dispatch on than a thin one. Anything that doesn't fit one of the
 * named intents falls under `"chat"` (general conversation) or
 * `"unknown"` (when even the chat path can't apply).
 *
 * The classifier returns a single `CognitiveIntent` plus a
 * `confidence` score; downstream code can use the score to escalate
 * to an LLM-based classifier when the heuristic is uncertain.
 */
export type CognitiveIntent =
  | "chat"
  | "qa"
  | "rag_search"
  | "code_generation"
  | "doc_generation"
  | "image_generation"
  | "data_analysis"
  | "tool_call"
  | "agent_task"
  | "summarization"
  | "translation"
  | "unknown";

export interface IntentClassification {
  intent: CognitiveIntent;
  /**
   * Confidence in [0, 1]. The heuristic classifier emits 1 when a
   * deterministic pattern matches, 0.5 when only a weak signal
   * matches, and 0 for "I have no idea, defaulted to chat".
   */
  confidence: number;
  /**
   * Human-readable reason the classifier chose this intent. Useful
   * for debugging and for surfacing transparency to advanced users.
   */
  reasoning: string;
  /**
   * The ranked alternative intents the classifier considered, in
   * descending confidence order. Always includes the chosen intent
   * at index 0.
   */
  alternatives: Array<{ intent: CognitiveIntent; confidence: number }>;
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/**
 * One full cognitive request — the input to `runCognitiveRequest`.
 * The shape is intentionally minimal: anything more complex (memory
 * lookups, document attachments, RAG corpora) is built UP from this
 * by the enrichment stage rather than required from the caller.
 */
export interface CognitiveRequest {
  /** Stable user identifier (used for memory + telemetry attribution). */
  userId: string;
  /** Optional conversation thread id (used for context recall). */
  conversationId?: string;
  /** The user's natural-language message. */
  message: string;
  /**
   * Optional UI hint about what the user is trying to do. The
   * classifier prefers this when the heuristic also matches it; if
   * they disagree, the classifier still wins but logs the mismatch.
   */
  intentHint?: CognitiveIntent;
  /**
   * Optional explicit provider name. When set, the orchestrator
   * looks up the matching adapter and skips its own provider
   * selection logic. Useful for evaluation harnesses that want to
   * pin every test to a specific provider.
   */
  preferredProvider?: string;
  /**
   * Maximum tokens the orchestrator should ask the provider to
   * generate. Defaults to a sensible value when omitted.
   */
  maxTokens?: number;
  /**
   * Sampling temperature in [0, 2]. Defaults to 0.7 (slightly
   * exploratory but not chaotic).
   */
  temperature?: number;
  /**
   * Optional cancellation signal. The orchestrator forwards it down
   * to the provider's generate() call so cancellation propagates
   * through every stage of the pipeline.
   */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Provider adapter (the multi-LLM seam)
// ---------------------------------------------------------------------------

export type ProviderMessageRole = "system" | "user" | "assistant" | "tool";

export interface ProviderMessage {
  role: ProviderMessageRole;
  content: string;
  /** For role="tool", the name of the tool whose output this is. */
  name?: string;
}

/**
 * Tool descriptor in the normalized "function-calling" shape that
 * every modern LLM provider accepts (Anthropic tool_use, OpenAI
 * function calling, Gemini tools, in-house registries). Adapters are
 * responsible for translating this into their provider's native
 * shape — the rest of the cognitive layer never touches provider-
 * specific tool encoding.
 */
export interface ProviderToolDescriptor {
  name: string;
  description: string;
  /** JSON Schema for the tool's input arguments. */
  inputSchema: Record<string, unknown>;
}

/**
 * Provider-agnostic request shape. Adapters convert this into
 * whatever wire format their backing API needs.
 */
export interface NormalizedProviderRequest {
  systemPrompt?: string;
  messages: ProviderMessage[];
  tools?: ProviderToolDescriptor[];
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

export type ProviderFinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | "error"
  | "aborted";

export interface ProviderToolCall {
  /** Stable id so the orchestrator can pair calls with their results. */
  id: string;
  name: string;
  /** The model's parsed arguments object. */
  args: Record<string, unknown>;
}

export interface ProviderUsage {
  promptTokens: number;
  completionTokens: number;
  /**
   * Optional total. Some providers report total directly; others
   * compute it. The orchestrator falls back to `prompt + completion`
   * when this field is missing.
   */
  totalTokens?: number;
}

/**
 * Provider-agnostic response shape. The orchestrator only ever
 * touches this — never the raw provider payload.
 */
export interface ProviderResponse {
  text: string;
  finishReason: ProviderFinishReason;
  toolCalls: ProviderToolCall[];
  usage?: ProviderUsage;
  /**
   * The raw provider payload for debugging / inspection. Stripped
   * before serialization in production unless explicitly requested.
   */
  raw?: unknown;
}

/**
 * The single seam between the cognitive layer and any LLM provider.
 *
 * Adapters MUST:
 *   • Implement `name` as a stable string id ("claude", "openai",
 *     "gemini", "mock", "in-house-gpt3").
 *   • Implement `capabilities` as the set of `CognitiveIntent`s the
 *     adapter can serve. The orchestrator filters adapters by
 *     intent before calling them.
 *   • Implement `generate` as an async function that respects the
 *     supplied `AbortSignal` and never throws — it must return a
 *     `ProviderResponse` with `finishReason: "error"` on failure.
 *
 * Adapters MUST NOT:
 *   • Mutate the request object.
 *   • Throw to the caller. Errors must be wrapped into the response.
 *   • Hold mutable shared state across calls (the orchestrator
 *     assumes thread-safety / re-entrancy).
 */
export interface ProviderAdapter {
  readonly name: string;
  readonly capabilities: ReadonlySet<CognitiveIntent>;
  generate(
    request: NormalizedProviderRequest,
    signal?: AbortSignal,
  ): Promise<ProviderResponse>;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  severity: ValidationSeverity;
  /** Stable machine-readable code (e.g., "empty_text", "refusal_detected"). */
  code: string;
  /** Human-readable description for logs and dashboards. */
  message: string;
}

export interface ValidationReport {
  /** True iff the response has zero `error`-severity issues. */
  ok: boolean;
  issues: ValidationIssue[];
  /** True if the response looks like a refusal ("I cannot help…"). */
  refusalDetected: boolean;
  /**
   * Whether tool call arguments parsed against their declared
   * schemas. False when the model emitted malformed JSON.
   */
  toolCallsValid: boolean;
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

export interface CognitiveTelemetry {
  /** Wall-clock start (Unix ms). */
  startedAt: number;
  /** Wall-clock end (Unix ms). */
  endedAt: number;
  /** End − Start. */
  durationMs: number;
  /** Time spent inside the intent classifier. */
  intentClassificationMs: number;
  /** Time spent inside the provider adapter's generate() call. */
  providerCallMs: number;
  /** Time spent inside the output validator. */
  validationMs: number;
  /** How many provider call retries happened (0 means first call succeeded). */
  retries: number;
  promptTokens?: number;
  completionTokens?: number;
}

// ---------------------------------------------------------------------------
// Routing decision
// ---------------------------------------------------------------------------

/**
 * What the orchestrator decided about this request before calling
 * any provider. Surfaced on the response so callers can debug
 * "why did this go to provider X with intent Y?".
 */
export interface RoutingDecision {
  intent: IntentClassification;
  /** Name of the chosen provider adapter. */
  providerName: string;
  /** Why the provider was chosen (e.g., "preferred", "first capable"). */
  providerReason: string;
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export interface CognitiveResponse {
  /** True iff the pipeline completed without an error-severity validation issue. */
  ok: boolean;
  /** Final assistant text shown to the user. */
  text: string;
  /** Tool calls extracted from the provider response, if any. */
  toolCalls: ProviderToolCall[];
  /** What the orchestrator decided to do (intent + provider + reasons). */
  routing: RoutingDecision;
  validation: ValidationReport;
  telemetry: CognitiveTelemetry;
  /**
   * Non-fatal errors collected during the pipeline. Each entry is a
   * short machine-readable code; full stack traces go to the logger.
   */
  errors: string[];
}
