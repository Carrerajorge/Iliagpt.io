/**
 * Cognitive Middleware — deterministic mock provider adapter.
 *
 * The mock adapter is the cornerstone of our test suite: it
 * implements the `ProviderAdapter` interface with zero LLM calls,
 * zero network, and zero non-determinism. Every test that exercises
 * the orchestrator runs against this mock so the test outcomes are
 * pinned to the orchestrator's logic, not to a flaky external API.
 *
 * The mock supports four "personalities" that callers can pin via
 * the constructor:
 *
 *   1. echoMockAdapter
 *      Returns the user's last message back as the assistant text,
 *      with finishReason "stop" and zero tool calls. Used by tests
 *      that just want to verify the request → response plumbing.
 *
 *   2. scriptedMockAdapter(script)
 *      Returns successive responses from a fixed array each time
 *      `generate` is called. Useful for tests that need to verify
 *      a specific output without writing logic to compute it.
 *
 *   3. failingMockAdapter(error)
 *      Always returns a `{ finishReason: "error" }` response with
 *      the supplied error message. Used to verify the orchestrator's
 *      retry / resilience behavior.
 *
 *   4. abortableMockAdapter
 *      Hangs for a long time but listens to the AbortSignal. Used
 *      to verify cancellation propagation.
 *
 * Every mock adapter:
 *   • Never throws — failures are always wrapped in the response.
 *   • Records its call history (lastRequest) so tests can assert
 *     the orchestrator passed the right normalized request.
 *   • Honors the AbortSignal cooperatively.
 */

import type {
  CognitiveIntent,
  NormalizedProviderRequest,
  ProviderAdapter,
  ProviderResponse,
} from "../types";

// ---------------------------------------------------------------------------
// Capability set: the mock claims it can handle every intent
// ---------------------------------------------------------------------------

const ALL_INTENTS: ReadonlySet<CognitiveIntent> = new Set<CognitiveIntent>([
  "chat",
  "qa",
  "rag_search",
  "code_generation",
  "doc_generation",
  "image_generation",
  "data_analysis",
  "tool_call",
  "agent_task",
  "summarization",
  "translation",
  "unknown",
]);

// ---------------------------------------------------------------------------
// Echo adapter — returns the last user message
// ---------------------------------------------------------------------------

/**
 * Echo adapter: returns the most recent user message back to the
 * caller as the assistant's reply. Has a `lastRequest` property so
 * tests can introspect the normalized request the orchestrator
 * actually sent down.
 */
export class EchoMockAdapter implements ProviderAdapter {
  readonly name = "mock-echo";
  readonly capabilities = ALL_INTENTS;
  /** The most recent request `generate` was invoked with. */
  lastRequest: NormalizedProviderRequest | null = null;
  /** How many times `generate` has been invoked. */
  callCount = 0;

  async generate(
    request: NormalizedProviderRequest,
    signal?: AbortSignal,
  ): Promise<ProviderResponse> {
    this.lastRequest = request;
    this.callCount++;
    if (signal?.aborted) {
      return errorResponse("aborted before call", "aborted");
    }
    const lastUser = [...request.messages]
      .reverse()
      .find((m) => m.role === "user");
    const text = lastUser?.content ?? "";
    return {
      text: `Echo: ${text}`,
      finishReason: "stop",
      toolCalls: [],
      usage: {
        promptTokens: estimatePromptTokens(request),
        completionTokens: text.length,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Scripted adapter — returns canned responses in order
// ---------------------------------------------------------------------------

export class ScriptedMockAdapter implements ProviderAdapter {
  readonly name: string;
  readonly capabilities = ALL_INTENTS;
  lastRequest: NormalizedProviderRequest | null = null;
  callCount = 0;
  private cursor = 0;

  constructor(
    private readonly script: ReadonlyArray<Partial<ProviderResponse>>,
    name = "mock-scripted",
  ) {
    if (script.length === 0) {
      throw new Error("ScriptedMockAdapter: script must not be empty");
    }
    this.name = name;
  }

  async generate(
    request: NormalizedProviderRequest,
    signal?: AbortSignal,
  ): Promise<ProviderResponse> {
    this.lastRequest = request;
    this.callCount++;
    if (signal?.aborted) {
      return errorResponse("aborted before call", "aborted");
    }
    const idx = Math.min(this.cursor, this.script.length - 1);
    this.cursor++;
    const partial = this.script[idx];
    return {
      text: partial.text ?? "",
      finishReason: partial.finishReason ?? "stop",
      toolCalls: partial.toolCalls ?? [],
      usage: partial.usage ?? { promptTokens: 0, completionTokens: 0 },
      raw: partial.raw,
    };
  }

  /** Reset the cursor so the script restarts from index 0. */
  reset(): void {
    this.cursor = 0;
    this.callCount = 0;
    this.lastRequest = null;
  }
}

// ---------------------------------------------------------------------------
// Failing adapter — always errors, with retry counting
// ---------------------------------------------------------------------------

export class FailingMockAdapter implements ProviderAdapter {
  readonly name: string;
  readonly capabilities = ALL_INTENTS;
  /** Number of times `generate` has been called (for retry verification). */
  callCount = 0;
  /**
   * After this many failures, succeed instead. Set to Infinity (the
   * default) to fail forever. Useful for testing retry-then-succeed.
   */
  successAfter: number;

  constructor(
    private readonly errorMessage: string = "mock provider error",
    successAfter: number = Infinity,
    name = "mock-failing",
  ) {
    this.name = name;
    this.successAfter = successAfter;
  }

  async generate(
    request: NormalizedProviderRequest,
    signal?: AbortSignal,
  ): Promise<ProviderResponse> {
    this.callCount++;
    if (signal?.aborted) {
      return errorResponse("aborted before call", "aborted");
    }
    if (this.callCount > this.successAfter) {
      return {
        text: "ok after retry",
        finishReason: "stop",
        toolCalls: [],
        usage: { promptTokens: 0, completionTokens: 0 },
      };
    }
    return errorResponse(this.errorMessage, "error");
  }
}

// ---------------------------------------------------------------------------
// Abortable adapter — listens to the signal and resolves on abort
// ---------------------------------------------------------------------------

export class AbortableMockAdapter implements ProviderAdapter {
  readonly name = "mock-abortable";
  readonly capabilities = ALL_INTENTS;

  constructor(private readonly delayMs: number = 5_000) {}

  async generate(
    _request: NormalizedProviderRequest,
    signal?: AbortSignal,
  ): Promise<ProviderResponse> {
    if (signal?.aborted) {
      return errorResponse("aborted before call", "aborted");
    }
    return new Promise<ProviderResponse>((resolve) => {
      const timer = setTimeout(() => {
        resolve({
          text: "took the full delay",
          finishReason: "stop",
          toolCalls: [],
          usage: { promptTokens: 0, completionTokens: 5 },
        });
      }, this.delayMs);
      const onAbort = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(errorResponse("aborted during call", "aborted"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

// ---------------------------------------------------------------------------
// Tool-emitting adapter — for verifying tool-call paths
// ---------------------------------------------------------------------------

export class ToolEmittingMockAdapter implements ProviderAdapter {
  readonly name = "mock-tool-emitter";
  readonly capabilities = ALL_INTENTS;

  constructor(
    private readonly toolName: string,
    private readonly toolArgs: Record<string, unknown>,
  ) {}

  async generate(
    _request: NormalizedProviderRequest,
    signal?: AbortSignal,
  ): Promise<ProviderResponse> {
    if (signal?.aborted) {
      return errorResponse("aborted before call", "aborted");
    }
    return {
      text: "",
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: `call_${Date.now()}`,
          name: this.toolName,
          args: this.toolArgs,
        },
      ],
      usage: { promptTokens: 0, completionTokens: 0 },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorResponse(
  message: string,
  finishReason: "error" | "aborted",
): ProviderResponse {
  return {
    text: "",
    finishReason,
    toolCalls: [],
    raw: { error: message },
  };
}

function estimatePromptTokens(request: NormalizedProviderRequest): number {
  // Naive: 4 chars per token. Good enough for tests.
  let total = (request.systemPrompt ?? "").length;
  for (const m of request.messages) total += m.content.length;
  return Math.ceil(total / 4);
}
