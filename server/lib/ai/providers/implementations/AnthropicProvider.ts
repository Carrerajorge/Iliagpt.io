/**
 * AnthropicProvider — Claude Opus 4.6, Sonnet 4.6, Haiku 4.5
 */

import Anthropic from "@anthropic-ai/sdk";
import { BaseProvider } from "../core/BaseProvider.js";
import {
  AuthenticationError,
  ContextLengthError,
  FinishReason,
  type IChatMessage,
  type IChatOptions,
  type IChatResponse,
  type IEmbeddingOptions,
  type IEmbeddingResponse,
  type IModelInfo,
  type IProviderConfig,
  type IStreamChunk,
  MessageRole,
  ModelCapability,
  ProviderError,
  RateLimitError,
} from "../core/types.js";

// ─────────────────────────────────────────────
// Model Catalog
// ─────────────────────────────────────────────

const ANTHROPIC_MODELS: IModelInfo[] = [
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    provider: "anthropic",
    capabilities: [
      ModelCapability.CHAT,
      ModelCapability.VISION,
      ModelCapability.CODE,
      ModelCapability.REASONING,
      ModelCapability.FUNCTION_CALLING,
    ],
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    pricing: { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    provider: "anthropic",
    capabilities: [
      ModelCapability.CHAT,
      ModelCapability.VISION,
      ModelCapability.CODE,
      ModelCapability.REASONING,
      ModelCapability.FUNCTION_CALLING,
    ],
    contextWindow: 200_000,
    maxOutputTokens: 16_000,
    pricing: { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  },
  {
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    provider: "anthropic",
    capabilities: [
      ModelCapability.CHAT,
      ModelCapability.VISION,
      ModelCapability.CODE,
      ModelCapability.FUNCTION_CALLING,
    ],
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 0.8, outputPerMillion: 4.0 },
  },
  {
    id: "claude-3-5-sonnet-20241022",
    name: "Claude 3.5 Sonnet (legacy)",
    provider: "anthropic",
    capabilities: [
      ModelCapability.CHAT,
      ModelCapability.VISION,
      ModelCapability.CODE,
      ModelCapability.FUNCTION_CALLING,
    ],
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  },
];

// ─────────────────────────────────────────────
// AnthropicProvider
// ─────────────────────────────────────────────

export class AnthropicProvider extends BaseProvider {
  readonly id = "anthropic";
  readonly name = "Anthropic";

  private readonly client: Anthropic;

  constructor(config: Partial<IProviderConfig> & { apiKey: string }) {
    super({
      id: "anthropic",
      name: "Anthropic",
      defaultModel: "claude-sonnet-4-6",
      timeout: 120_000,
      maxRetries: 3,
      rateLimitRpm: 60,
      ...config,
    });

    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: this.config.timeout,
      maxRetries: 0,
    });

    this._models = ANTHROPIC_MODELS;
  }

  isCapable(capability: ModelCapability): boolean {
    return [
      ModelCapability.CHAT,
      ModelCapability.VISION,
      ModelCapability.CODE,
      ModelCapability.REASONING,
      ModelCapability.FUNCTION_CALLING,
    ].includes(capability);
  }

  protected async _chat(
    messages: IChatMessage[],
    options: IChatOptions,
  ): Promise<IChatResponse> {
    const start = Date.now();
    const model = options.model ?? this.config.defaultModel ?? "claude-sonnet-4-6";

    const { system, anthropicMessages } = this.toAnthropicMessages(messages, options.systemPrompt);
    const tools = options.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool["input_schema"],
    }));

    try {
      const response = await this.client.messages.create({
        model,
        messages: anthropicMessages,
        system,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
        top_p: options.topP,
        stop_sequences: options.stop,
        tools: tools?.length ? tools : undefined,
        tool_choice: tools?.length ? { type: "auto" } : undefined,
        stream: false,
      });

      const content = response.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { type: "text"; text: string }).text)
        .join("");

      const toolCalls = response.content
        .filter((c) => c.type === "tool_use")
        .map((c) => {
          const tc = c as { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
          return { id: tc.id, name: tc.name, arguments: tc.input };
        });

      const usage = {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        cachedTokens: (response.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens,
      };

      return {
        id: response.id,
        model: response.model,
        provider: this.id,
        content,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        finishReason: this.mapFinishReason(response.stop_reason),
        usage,
        cost: this.calculateCost(model, usage.promptTokens, usage.completionTokens),
        latencyMs: Date.now() - start,
        createdAt: new Date(),
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async *_stream(
    messages: IChatMessage[],
    options: IChatOptions,
  ): AsyncIterable<IStreamChunk> {
    const model = options.model ?? this.config.defaultModel ?? "claude-sonnet-4-6";
    const { system, anthropicMessages } = this.toAnthropicMessages(messages, options.systemPrompt);
    const requestId = this.generateRequestId();

    try {
      const stream = this.client.messages.stream({
        model,
        messages: anthropicMessages,
        system,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { id: requestId, delta: event.delta.text };
        } else if (event.type === "message_stop") {
          const finalMessage = await stream.finalMessage();
          yield {
            id: requestId,
            delta: "",
            finishReason: this.mapFinishReason(finalMessage.stop_reason),
            usage: {
              promptTokens: finalMessage.usage.input_tokens,
              completionTokens: finalMessage.usage.output_tokens,
              totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
            },
          };
        }
      }
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async _embed(
    _texts: string[],
    _options: IEmbeddingOptions,
  ): Promise<IEmbeddingResponse> {
    throw new ProviderError(
      "Anthropic does not support embeddings. Use OpenAI or Cohere instead.",
      this.id,
      "NOT_SUPPORTED",
      undefined,
      false,
    );
  }

  protected async _listModels(): Promise<IModelInfo[]> {
    return ANTHROPIC_MODELS;
  }

  // ─── Format Conversion ───

  private toAnthropicMessages(
    messages: IChatMessage[],
    systemPrompt?: string,
  ): {
    system: string | undefined;
    anthropicMessages: Anthropic.MessageParam[];
  } {
    const systemMessages = messages
      .filter((m) => m.role === MessageRole.SYSTEM)
      .map((m) => this.normalizeContent(m.content));

    const system = [systemPrompt, ...systemMessages].filter(Boolean).join("\n\n") || undefined;

    const anthropicMessages: Anthropic.MessageParam[] = messages
      .filter((m) => m.role !== MessageRole.SYSTEM)
      .map((m): Anthropic.MessageParam => {
        if (m.role === MessageRole.USER) {
          const content = m.content;
          if (typeof content === "string") {
            return { role: "user", content };
          }
          if (Array.isArray(content)) {
            const parts: Anthropic.ContentBlockParam[] = content.map((part) => {
              if (typeof part === "object" && "type" in part && part.type === "image") {
                const img = part as { type: "image"; url?: string; base64?: string; mimeType?: string };
                if (img.base64) {
                  return {
                    type: "image" as const,
                    source: {
                      type: "base64" as const,
                      media_type: (img.mimeType ?? "image/jpeg") as Anthropic.Base64ImageSource["media_type"],
                      data: img.base64,
                    },
                  };
                }
                return {
                  type: "image" as const,
                  source: { type: "url" as const, url: img.url ?? "" },
                };
              }
              return { type: "text" as const, text: typeof part === "object" && "text" in part ? (part as {text: string}).text : "" };
            });
            return { role: "user", content: parts };
          }
          return { role: "user", content: this.normalizeContent(content) };
        }

        return {
          role: "assistant",
          content: this.normalizeContent(m.content),
        };
      });

    return { system, anthropicMessages };
  }

  private mapFinishReason(reason: string | null): FinishReason {
    switch (reason) {
      case "end_turn": return FinishReason.STOP;
      case "max_tokens": return FinishReason.LENGTH;
      case "tool_use": return FinishReason.TOOL_CALL;
      case "stop_sequence": return FinishReason.STOP;
      default: return FinishReason.STOP;
    }
  }

  private mapError(err: unknown): ProviderError {
    if (err instanceof Anthropic.APIError) {
      if (err.status === 401) return new AuthenticationError(this.id, err);
      if (err.status === 429) {
        const retryAfter = parseInt(err.headers?.["retry-after"] ?? "0", 10) * 1000;
        return new RateLimitError(this.id, retryAfter || undefined, err);
      }
      if (err.status === 400 && err.message.includes("too large")) {
        return new ContextLengthError(this.id, 200_000, 0);
      }
      return new ProviderError(err.message, this.id, `ANTHROPIC_${err.status}`, err.status, err.status >= 500, err);
    }
    return new ProviderError(String(err), this.id, "UNKNOWN", undefined, true, err);
  }
}
