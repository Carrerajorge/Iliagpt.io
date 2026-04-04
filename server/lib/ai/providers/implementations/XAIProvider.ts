/**
 * XAIProvider — Grok models via xAI API (OpenAI-compatible)
 */

import OpenAI from "openai";
import { BaseProvider } from "../core/BaseProvider.js";
import {
  AuthenticationError,
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

const XAI_MODELS: IModelInfo[] = [
  {
    id: "grok-4-1-fast-non-reasoning",
    name: "Grok 4.1 Fast",
    provider: "xai",
    capabilities: [
      ModelCapability.CHAT,
      ModelCapability.CODE,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.LONG_CONTEXT,
    ],
    contextWindow: 2_000_000,
    maxOutputTokens: 32_768,
    pricing: { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  },
  {
    id: "grok-4-1-fast-reasoning",
    name: "Grok 4.1 Fast Reasoning",
    provider: "xai",
    capabilities: [
      ModelCapability.CHAT,
      ModelCapability.CODE,
      ModelCapability.REASONING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.LONG_CONTEXT,
    ],
    contextWindow: 2_000_000,
    maxOutputTokens: 32_768,
    pricing: { inputPerMillion: 5.0, outputPerMillion: 25.0 },
  },
  {
    id: "grok-3-fast",
    name: "Grok 3 Fast",
    provider: "xai",
    capabilities: [
      ModelCapability.CHAT,
      ModelCapability.CODE,
      ModelCapability.FUNCTION_CALLING,
    ],
    contextWindow: 131_072,
    maxOutputTokens: 16_384,
    pricing: { inputPerMillion: 0.6, outputPerMillion: 2.4 },
  },
  {
    id: "grok-2-vision-1212",
    name: "Grok 2 Vision",
    provider: "xai",
    capabilities: [
      ModelCapability.CHAT,
      ModelCapability.VISION,
      ModelCapability.CODE,
      ModelCapability.FUNCTION_CALLING,
    ],
    contextWindow: 32_768,
    maxOutputTokens: 4_096,
    pricing: { inputPerMillion: 2.0, outputPerMillion: 10.0 },
  },
];

// ─────────────────────────────────────────────
// XAIProvider
// ─────────────────────────────────────────────

export class XAIProvider extends BaseProvider {
  readonly id = "xai";
  readonly name = "xAI (Grok)";

  private readonly client: OpenAI;

  constructor(config: Partial<IProviderConfig> & { apiKey: string }) {
    super({
      id: "xai",
      name: "xAI (Grok)",
      defaultModel: "grok-4-1-fast-non-reasoning",
      timeout: 120_000,
      maxRetries: 3,
      rateLimitRpm: 60,
      ...config,
    });

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? "https://api.x.ai/v1",
      timeout: this.config.timeout,
      maxRetries: 0,
    });

    this._models = XAI_MODELS;
  }

  isCapable(capability: ModelCapability): boolean {
    return [
      ModelCapability.CHAT,
      ModelCapability.VISION,
      ModelCapability.CODE,
      ModelCapability.REASONING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.LONG_CONTEXT,
    ].includes(capability);
  }

  protected async _chat(
    messages: IChatMessage[],
    options: IChatOptions,
  ): Promise<IChatResponse> {
    const start = Date.now();
    const model = options.model ?? this.config.defaultModel ?? "grok-4-1-fast-non-reasoning";
    const openaiMessages = this.toOpenAIMessages(messages, options.systemPrompt);

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: openaiMessages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: options.topP,
        stop: options.stop,
        stream: false,
      });

      const choice = response.choices[0];
      const usage = {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      };

      return {
        id: response.id,
        model: response.model,
        provider: this.id,
        content: choice.message.content ?? "",
        finishReason: this.mapFinishReason(choice.finish_reason),
        usage,
        cost: this.calculateCost(model, usage.promptTokens, usage.completionTokens),
        latencyMs: Date.now() - start,
        createdAt: new Date(response.created * 1000),
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async *_stream(
    messages: IChatMessage[],
    options: IChatOptions,
  ): AsyncIterable<IStreamChunk> {
    const model = options.model ?? this.config.defaultModel ?? "grok-4-1-fast-non-reasoning";
    const openaiMessages = this.toOpenAIMessages(messages, options.systemPrompt);

    try {
      const stream = await this.client.chat.completions.create({
        model,
        messages: openaiMessages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        stream: true,
      });

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        yield {
          id: chunk.id,
          delta: choice.delta?.content ?? "",
          finishReason: choice.finish_reason
            ? this.mapFinishReason(choice.finish_reason)
            : undefined,
        };
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
      "xAI does not support embeddings.",
      this.id,
      "NOT_SUPPORTED",
      undefined,
      false,
    );
  }

  protected async _listModels(): Promise<IModelInfo[]> {
    return XAI_MODELS;
  }

  private toOpenAIMessages(
    messages: IChatMessage[],
    systemPrompt?: string,
  ): OpenAI.ChatCompletionMessageParam[] {
    const result: OpenAI.ChatCompletionMessageParam[] = [];
    if (systemPrompt) result.push({ role: "system", content: systemPrompt });

    for (const msg of messages) {
      if (msg.role === MessageRole.SYSTEM) {
        result.push({ role: "system", content: this.normalizeContent(msg.content) });
      } else if (msg.role === MessageRole.USER) {
        result.push({ role: "user", content: this.normalizeContent(msg.content) });
      } else if (msg.role === MessageRole.ASSISTANT) {
        result.push({ role: "assistant", content: this.normalizeContent(msg.content) });
      }
    }
    return result;
  }

  private mapFinishReason(reason: string | null): FinishReason {
    switch (reason) {
      case "stop": return FinishReason.STOP;
      case "length": return FinishReason.LENGTH;
      case "tool_calls": return FinishReason.TOOL_CALL;
      default: return FinishReason.STOP;
    }
  }

  private mapError(err: unknown): ProviderError {
    if (err instanceof OpenAI.APIError) {
      if (err.status === 401) return new AuthenticationError(this.id, err);
      if (err.status === 429) return new RateLimitError(this.id, undefined, err);
      return new ProviderError(err.message, this.id, `XAI_${err.status}`, err.status, err.status >= 500, err);
    }
    return new ProviderError(String(err), this.id, "UNKNOWN", undefined, true, err);
  }
}
