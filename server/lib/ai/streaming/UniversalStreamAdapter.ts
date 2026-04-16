/**
 * UniversalStreamAdapter — Normalizes streaming from all providers into one format
 *
 * Handles:
 * - OpenAI SSE chunks
 * - Anthropic SSE events
 * - Google streaming
 * - Custom/local provider formats
 * - Auto-reconnection with backoff
 * - Backpressure via StreamBuffer
 * - Metrics via StreamMetrics
 */

import { ProviderRegistry } from "../providers/core/ProviderRegistry.js";
import {
  type IChatMessage,
  type IChatOptions,
  type IStreamChunk,
  FinishReason,
  ProviderError,
} from "../providers/core/types.js";
import { StreamBuffer, type IBufferConfig } from "./StreamBuffer.js";
import { streamMetrics } from "./StreamMetrics.js";

// ─────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────

export interface IAdapterConfig {
  buffering: Partial<IBufferConfig>;
  autoReconnect: boolean;
  maxReconnectAttempts: number;
  reconnectDelayMs: number;
  metricsEnabled: boolean;
  fallbackProviders?: Array<{ providerId: string; modelId: string }>;
}

export interface IUniversalStreamEvent {
  type: "token" | "tool_call_start" | "tool_call_delta" | "done" | "error";
  content?: string;
  toolCallId?: string;
  toolCallName?: string;
  toolCallArgDelta?: string;
  finishReason?: FinishReason;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface IStreamSession {
  streamId: string;
  providerId: string;
  modelId: string;
  startedAt: Date;
  events: AsyncIterable<IUniversalStreamEvent>;
  cancel: () => void;
}

const DEFAULT_ADAPTER_CONFIG: IAdapterConfig = {
  buffering: {},
  autoReconnect: true,
  maxReconnectAttempts: 2,
  reconnectDelayMs: 1_000,
  metricsEnabled: true,
};

// ─────────────────────────────────────────────
// UniversalStreamAdapter
// ─────────────────────────────────────────────

export class UniversalStreamAdapter {
  private readonly config: IAdapterConfig;

  constructor(
    private readonly registry: ProviderRegistry,
    config: Partial<IAdapterConfig> = {},
  ) {
    this.config = { ...DEFAULT_ADAPTER_CONFIG, ...config };
  }

  /**
   * Start a streaming session. Returns an IStreamSession with an async iterator
   * of normalized IUniversalStreamEvent objects.
   */
  async startSession(
    providerId: string,
    modelId: string,
    messages: IChatMessage[],
    options: IChatOptions = {},
  ): Promise<IStreamSession> {
    const streamId = `${providerId}-${modelId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let cancelled = false;
    let currentStream: AsyncIterable<IStreamChunk> | null = null;

    if (this.config.metricsEnabled) {
      streamMetrics.start(streamId, providerId, modelId);
    }

    const cancel = () => {
      cancelled = true;
      if (this.config.metricsEnabled) {
        streamMetrics.recordError(streamId, "Cancelled by user");
      }
    };

    const events = this.generateEvents(
      streamId,
      providerId,
      modelId,
      messages,
      options,
      () => cancelled,
      (s) => { currentStream = s; },
    );

    return {
      streamId,
      providerId,
      modelId,
      startedAt: new Date(),
      events,
      cancel,
    };
  }

  /**
   * Pipe a stream session to Server-Sent Events (SSE) format.
   * Writes directly to a Response-compatible writer.
   */
  async pipeToSSE(
    session: IStreamSession,
    write: (data: string) => void,
    end: () => void,
  ): Promise<void> {
    try {
      for await (const event of session.events) {
        const sseData = JSON.stringify(event);

        if (event.type === "done") {
          write(`data: ${sseData}\n\n`);
          write("data: [DONE]\n\n");
          break;
        } else if (event.type === "error") {
          write(`data: ${sseData}\n\n`);
          break;
        } else {
          write(`data: ${sseData}\n\n`);
        }
      }
    } finally {
      end();
    }
  }

  /**
   * Collect entire stream into a single string (for non-streaming callers).
   */
  async collectToString(
    providerId: string,
    modelId: string,
    messages: IChatMessage[],
    options: IChatOptions = {},
  ): Promise<{ content: string; usage?: IUniversalStreamEvent["usage"] }> {
    const session = await this.startSession(providerId, modelId, messages, options);
    let content = "";
    let usage: IUniversalStreamEvent["usage"] | undefined;

    for await (const event of session.events) {
      if (event.type === "token" && event.content) {
        content += event.content;
      } else if (event.type === "done") {
        usage = event.usage;
        break;
      } else if (event.type === "error") {
        throw new Error(event.error);
      }
    }

    return { content, usage };
  }

  // ─── Core Stream Generator ───

  private async *generateEvents(
    streamId: string,
    providerId: string,
    modelId: string,
    messages: IChatMessage[],
    options: IChatOptions,
    isCancelled: () => boolean,
    onStream: (s: AsyncIterable<IStreamChunk>) => void,
  ): AsyncGenerator<IUniversalStreamEvent> {
    let attempt = 0;
    const maxAttempts = this.config.autoReconnect ? this.config.maxReconnectAttempts + 1 : 1;

    while (attempt < maxAttempts) {
      if (isCancelled()) return;

      try {
        const provider = this.registry.getProvider(providerId);
        const rawStream = provider.stream(messages, { ...options, model: modelId });
        onStream(rawStream);

        yield* this.normalizeStream(streamId, rawStream, isCancelled);
        return; // Completed successfully

      } catch (err) {
        attempt++;
        const isRetryable = err instanceof ProviderError && err.retryable;

        if (attempt >= maxAttempts || !isRetryable) {
          if (this.config.metricsEnabled) {
            streamMetrics.recordError(streamId, String(err));
          }

          // Try fallback providers
          if (this.config.fallbackProviders?.length) {
            const fallback = this.config.fallbackProviders[0];
            try {
              console.warn(`[UniversalStreamAdapter] Falling back to ${fallback.providerId}/${fallback.modelId}`);
              const fbProvider = this.registry.getProvider(fallback.providerId);
              const fbStream = fbProvider.stream(messages, { ...options, model: fallback.modelId });
              yield* this.normalizeStream(streamId, fbStream, isCancelled);
              return;
            } catch (fbErr) {
              yield {
                type: "error",
                error: `Primary failed: ${err instanceof Error ? err.message : String(err)}. Fallback also failed: ${fbErr instanceof Error ? fbErr.message : String(fbErr)}`,
              };
              return;
            }
          }

          yield {
            type: "error",
            error: err instanceof Error ? err.message : String(err),
          };
          return;
        }

        console.warn(
          `[UniversalStreamAdapter] Attempt ${attempt} failed, retrying in ${this.config.reconnectDelayMs}ms:`,
          err,
        );
        await new Promise((resolve) => setTimeout(resolve, this.config.reconnectDelayMs * attempt));
      }
    }
  }

  private async *normalizeStream(
    streamId: string,
    rawStream: AsyncIterable<IStreamChunk>,
    isCancelled: () => boolean,
  ): AsyncGenerator<IUniversalStreamEvent> {
    const buffer = new StreamBuffer(this.config.buffering);
    let finalUsage: IUniversalStreamEvent["usage"] | undefined;
    let providerDone = false;
    const bufferedTokens: string[] = [];
    const pendingEvents: IUniversalStreamEvent[] = [];
    const flushIntervalMs = this.config.buffering.flushIntervalMs ?? 16;

    const onBufferData = (text: string) => {
      if (text) {
        bufferedTokens.push(text);
      }
    };

    try {
      buffer.on("data", onBufferData);

      // Start consuming provider stream
      const consumeProvider = async () => {
        for await (const chunk of rawStream) {
          if (isCancelled()) break;

          if (chunk.delta) {
            buffer.push(chunk.delta);
            if (this.config.metricsEnabled) {
              streamMetrics.recordChunk(streamId, chunk.delta);
            }
          }

          // Handle tool calls
          if (chunk.toolCallDelta) {
            pendingEvents.push({
              type: chunk.toolCallDelta.name ? "tool_call_start" : "tool_call_delta",
              toolCallId: chunk.toolCallDelta.id,
              toolCallName: chunk.toolCallDelta.name,
              toolCallArgDelta: JSON.stringify(chunk.toolCallDelta.arguments),
            });
          }

          if (chunk.finishReason) {
            finalUsage = chunk.usage;
          }
        }
        providerDone = true;
        buffer.end();
      };

      const providerPromise = consumeProvider();

      while (!providerDone || pendingEvents.length > 0 || bufferedTokens.length > 0 || !buffer.isEmpty) {
        if (isCancelled()) break;

        if (pendingEvents.length > 0) {
          yield pendingEvents.shift()!;
          continue;
        }

        if (bufferedTokens.length > 0) {
          yield { type: "token", content: bufferedTokens.shift()! };
          continue;
        }

        await new Promise((resolve) => setTimeout(resolve, flushIntervalMs));
      }

      await providerPromise;

      if (this.config.metricsEnabled) {
        streamMetrics.complete(streamId);
      }

      yield {
        type: "done",
        finishReason: FinishReason.STOP,
        usage: finalUsage,
      };

    } catch (err) {
      buffer.destroy();
      throw err;
    } finally {
      buffer.off("data", onBufferData);
    }
  }
}
