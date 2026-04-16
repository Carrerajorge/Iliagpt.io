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
  ProviderStreamChunk,
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
// Streaming adapter — emits chunks via `generateStream`
// ---------------------------------------------------------------------------

/**
 * Streaming mock that yields a fixed sequence of text chunks with an
 * optional per-chunk delay. When the caller aborts mid-stream the
 * iterator yields a terminal `{done: true, finishReason: "aborted"}`
 * chunk and stops. Also exposes a plain `generate()` path that
 * returns the concatenated text, so tests can exercise BOTH the
 * native streaming branch AND the single-shot fallback against the
 * same adapter.
 *
 * The adapter optionally emits a tool call right after a specific
 * chunk index (`toolCallAfterChunk`) for tests that need to verify
 * the interleaved text-delta / tool-call ordering.
 */
export interface StreamingMockAdapterOptions {
  chunks: readonly string[];
  /** Delay between chunks in milliseconds. 0 means "no delay". */
  delayMs?: number;
  /** Optional tool call to emit after chunk[index]. */
  toolCallAfterChunk?: {
    index: number;
    id: string;
    name: string;
    args: Record<string, unknown>;
  };
  /** Adapter name override. Default "mock-streaming". */
  name?: string;
  /** Finish reason to emit on the final chunk. Default "stop". */
  finishReason?: "stop" | "length" | "tool_calls";
}

export class StreamingMockAdapter implements ProviderAdapter {
  readonly name: string;
  readonly capabilities = ALL_INTENTS;
  lastRequest: NormalizedProviderRequest | null = null;
  streamCallCount = 0;
  generateCallCount = 0;

  constructor(private readonly options: StreamingMockAdapterOptions) {
    if (options.chunks.length === 0) {
      throw new Error("StreamingMockAdapter: chunks must not be empty");
    }
    this.name = options.name ?? "mock-streaming";
  }

  async generate(
    request: NormalizedProviderRequest,
    signal?: AbortSignal,
  ): Promise<ProviderResponse> {
    this.lastRequest = request;
    this.generateCallCount++;
    if (signal?.aborted) {
      return errorResponse("aborted before call", "aborted");
    }
    const text = this.options.chunks.join("");
    return {
      text,
      finishReason: this.options.finishReason ?? "stop",
      toolCalls: this.options.toolCallAfterChunk
        ? [
            {
              id: this.options.toolCallAfterChunk.id,
              name: this.options.toolCallAfterChunk.name,
              args: this.options.toolCallAfterChunk.args,
            },
          ]
        : [],
      usage: {
        promptTokens: estimatePromptTokens(request),
        completionTokens: text.length,
      },
    };
  }

  async *generateStream(
    request: NormalizedProviderRequest,
    signal?: AbortSignal,
  ): AsyncIterable<ProviderStreamChunk> {
    this.lastRequest = request;
    this.streamCallCount++;
    const { chunks, delayMs = 0, toolCallAfterChunk } = this.options;

    if (signal?.aborted) {
      yield { delta: "", done: true, finishReason: "aborted" };
      return;
    }

    for (let i = 0; i < chunks.length; i++) {
      // Cooperative cancellation check before each delta.
      if (signal?.aborted) {
        yield { delta: "", done: true, finishReason: "aborted" };
        return;
      }

      if (delayMs > 0) {
        // Abortable sleep so cancel kicks in mid-delay.
        const aborted = await abortableSleep(delayMs, signal);
        if (aborted) {
          yield { delta: "", done: true, finishReason: "aborted" };
          return;
        }
      }

      yield { delta: chunks[i], done: false };

      // Emit a tool call right after the configured chunk index, if set.
      if (toolCallAfterChunk && toolCallAfterChunk.index === i) {
        yield {
          delta: "",
          done: false,
          toolCall: {
            id: toolCallAfterChunk.id,
            name: toolCallAfterChunk.name,
            args: toolCallAfterChunk.args,
          },
        };
      }
    }

    const total = chunks.join("");
    yield {
      delta: "",
      done: true,
      finishReason: this.options.finishReason ?? "stop",
      usage: {
        promptTokens: estimatePromptTokens(request),
        completionTokens: total.length,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sleep that resolves early when the caller aborts. Returns `true`
 * if the sleep was interrupted by an abort, `false` if it ran to
 * completion. Used by the streaming adapter to keep per-chunk delay
 * cancellable.
 */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

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
