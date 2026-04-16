/**
 * Cognitive Middleware — SmartRouterAdapter.
 *
 * Production provider adapter that delegates every call to the
 * existing IliaGPT `llmGateway` (`server/lib/llmGateway.ts`). The
 * gateway already handles:
 *
 *   • Smart router model selection (cost / latency / complexity)
 *   • Multi-provider fallback chains (OpenAI ↔ Anthropic ↔ Gemini ↔ ...)
 *   • Circuit breakers + rate limiting + budget enforcement
 *   • Caching + request deduplication
 *   • Context-window truncation
 *
 * Our job here is to be the SHIM between the cognitive layer's
 * provider-agnostic types and the gateway's OpenAI-compatible chat
 * shape. We do NOT re-implement any of the routing logic — that
 * stays in the gateway where it lives.
 *
 * Hard guarantees the adapter delivers (matches the
 * `ProviderAdapter` contract):
 *
 *   1. Never throws. Any exception from the gateway is caught and
 *      wrapped into a `ProviderResponse{ finishReason: "error" }`.
 *
 *   2. Cancellation propagation. The orchestrator's AbortSignal
 *      flows directly into the gateway's `abortSignal` option, so
 *      cancellation reaches the underlying provider HTTP call.
 *
 *   3. Dependency-injectable for tests. The constructor accepts a
 *      `chatFn` callable that defaults to `llmGateway.chat.bind(...)`.
 *      Tests pass a stub that returns canned `LLMResponse` objects
 *      so unit coverage doesn't require real API credentials.
 */

import type {
  CognitiveIntent,
  NormalizedProviderRequest,
  ProviderAdapter,
  ProviderFinishReason,
  ProviderResponse,
} from "../types";

// ---------------------------------------------------------------------------
// Gateway types (re-declared narrowly to avoid pulling in the whole module)
//
// We re-declare the minimal subset of `llmGateway`'s types we depend on so
// the cognitive layer stays loosely coupled. If the gateway changes its
// public types, this adapter is the ONE place we have to update.
// ---------------------------------------------------------------------------

/** OpenAI-compatible message shape used by the gateway. */
export interface GatewayMessage {
  role: "system" | "user" | "assistant" | "tool" | "function";
  content: string;
  name?: string;
}

export interface GatewayRequestOptions {
  model?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  userId?: string;
  requestId?: string;
  timeout?: number;
  provider?: string;
  enableFallback?: boolean;
  skipCache?: boolean;
  abortSignal?: AbortSignal;
}

export interface GatewayResponseUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type GatewayResponseStatus = "completed" | "incomplete" | "failed";

export interface GatewayIncompleteDetails {
  reason:
    | "max_output_tokens"
    | "content_filter"
    | "stream_error"
    | "provider_error"
    | "timeout"
    | "truncated";
}

export interface GatewayResponse {
  content: string;
  usage?: GatewayResponseUsage;
  requestId: string;
  latencyMs: number;
  model: string;
  provider: string;
  cached?: boolean;
  fromFallback?: boolean;
  status?: GatewayResponseStatus;
  incompleteDetails?: GatewayIncompleteDetails | null;
}

/**
 * Callable shape we accept for the gateway. Matches the real
 * `llmGateway.chat` signature exactly.
 */
export type GatewayChatFn = (
  messages: GatewayMessage[],
  options?: GatewayRequestOptions,
) => Promise<GatewayResponse>;

// ---------------------------------------------------------------------------
// Capability set
// ---------------------------------------------------------------------------

/**
 * The smart router can serve every text-based intent. Image
 * generation is a separate code path in the gateway (and not
 * exposed via `chat`), so we exclude it from the capabilities.
 * Anything that does not need explicit image generation is fair
 * game — the gateway handles routing to the right provider.
 */
const SMART_ROUTER_CAPABILITIES: ReadonlySet<CognitiveIntent> = new Set<CognitiveIntent>([
  "chat",
  "qa",
  "rag_search",
  "code_generation",
  "doc_generation",
  "data_analysis",
  "tool_call",
  "agent_task",
  "summarization",
  "translation",
  "unknown",
]);

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface SmartRouterAdapterOptions {
  /**
   * The function used to call the gateway. Default: lazily resolves
   * `llmGateway.chat.bind(llmGateway)` from `server/lib/llmGateway`.
   * Tests inject a stub here so they don't need real credentials.
   */
  chatFn?: GatewayChatFn;
  /**
   * Optional adapter name override. Useful when registering multiple
   * SmartRouterAdapter instances with different default options.
   * Defaults to "smart-router".
   */
  name?: string;
  /**
   * Default model passed to the gateway. The smart router will
   * still override this when its complexity classifier picks
   * something better, but it's the starting point. Leave undefined
   * to let the smart router decide entirely.
   */
  defaultModel?: string;
  /**
   * Default user id for telemetry / quota attribution. Leave
   * undefined and individual requests can supply their own. Note:
   * the cognitive layer's `CognitiveRequest.userId` is NOT auto-
   * passed here because the adapter doesn't see CognitiveRequest —
   * the orchestrator constructs `NormalizedProviderRequest` first.
   */
  defaultUserId?: string;
}

export class SmartRouterAdapter implements ProviderAdapter {
  readonly name: string;
  readonly capabilities = SMART_ROUTER_CAPABILITIES;
  private chatFn?: GatewayChatFn;
  private readonly defaultModel?: string;
  private readonly defaultUserId?: string;

  constructor(options: SmartRouterAdapterOptions = {}) {
    this.name = options.name ?? "smart-router";
    this.chatFn = options.chatFn;
    this.defaultModel = options.defaultModel;
    this.defaultUserId = options.defaultUserId;
  }

  async generate(
    request: NormalizedProviderRequest,
    signal?: AbortSignal,
  ): Promise<ProviderResponse> {
    if (signal?.aborted) {
      return errorResponse("aborted before call", "aborted");
    }

    // 1. Translate the normalized request → gateway shape.
    const messages: GatewayMessage[] = [];
    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    for (const m of request.messages) {
      messages.push({
        role: m.role === "tool" ? "tool" : (m.role as GatewayMessage["role"]),
        content: m.content,
        name: m.name,
      });
    }

    const gatewayOptions: GatewayRequestOptions = {
      model: this.defaultModel,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      userId: this.defaultUserId,
      abortSignal: signal,
    };

    // 2. Resolve the gateway callable. Lazy import on first call so
    //    that test environments that never instantiate the adapter
    //    don't pay the cost of importing the heavy gateway module.
    let chatFn = this.chatFn;
    if (!chatFn) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = await import("../../lib/llmGateway");
        const candidate = (mod as { llmGateway?: { chat: GatewayChatFn } })
          .llmGateway;
        if (!candidate || typeof candidate.chat !== "function") {
          return errorResponse(
            "llmGateway not available — import returned no usable chat function",
            "error",
          );
        }
        chatFn = candidate.chat.bind(candidate);
        this.chatFn = chatFn; // memoize
      } catch (err) {
        return errorResponse(
          `failed to import llmGateway: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    }

    // 3. Call the gateway with full error wrapping. The gateway
    //    can throw on rate limits, missing API keys, network
    //    failures, etc. — we never let those propagate.
    let gatewayResponse: GatewayResponse;
    try {
      gatewayResponse = await chatFn(messages, gatewayOptions);
    } catch (err) {
      if (signal?.aborted) {
        return errorResponse("aborted during call", "aborted");
      }
      const message = err instanceof Error ? err.message : String(err);
      return errorResponse(`gateway threw: ${message}`, "error");
    }

    // 4. Translate the gateway response → ProviderResponse.
    return translateGatewayResponse(gatewayResponse);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map the gateway's `status` + `incompleteDetails` to our
 * `ProviderFinishReason`. The mapping is:
 *
 *   • status="completed"                                → "stop"
 *   • status="incomplete" + reason="max_output_tokens"  → "length"
 *   • status="incomplete" + reason="truncated"          → "length"
 *   • status="incomplete" + reason="content_filter"     → "content_filter"
 *   • status="incomplete" + reason="timeout"            → "error"
 *   • status="incomplete" + reason="provider_error"     → "error"
 *   • status="incomplete" + reason="stream_error"       → "error"
 *   • status="failed"                                   → "error"
 *   • status undefined                                  → "stop" (legacy
 *                                                         responses had
 *                                                         no status field)
 */
export function mapGatewayFinishReason(
  response: GatewayResponse,
): ProviderFinishReason {
  const status = response.status;
  if (!status || status === "completed") return "stop";
  if (status === "failed") return "error";
  // status === "incomplete"
  const reason = response.incompleteDetails?.reason;
  switch (reason) {
    case "max_output_tokens":
    case "truncated":
      return "length";
    case "content_filter":
      return "content_filter";
    case "timeout":
    case "provider_error":
    case "stream_error":
      return "error";
    default:
      return "stop";
  }
}

/**
 * Translate a gateway response into our normalized
 * `ProviderResponse`. Pure function, exported for tests.
 */
export function translateGatewayResponse(
  response: GatewayResponse,
): ProviderResponse {
  return {
    text: response.content ?? "",
    finishReason: mapGatewayFinishReason(response),
    // The legacy gateway shape doesn't surface tool calls in the
    // chat() return value (tools are handled at a different layer).
    // Empty array is correct for now; a follow-up will wire tool
    // calls through once we plug the agent runner in.
    toolCalls: [],
    usage: response.usage
      ? {
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          totalTokens: response.usage.totalTokens,
        }
      : undefined,
    raw: response,
  };
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
