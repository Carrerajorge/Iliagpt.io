/**
 * OpenAIProvider — GPT-4o, GPT-4o-mini, o1, o3-mini, text-embedding-3
 */

import OpenAI from "openai";
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

const OPENAI_MODELS: IModelInfo[] = [
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    capabilities: [
      ModelCapability.CHAT,
      ModelCapability.VISION,
      ModelCapability.CODE,
      ModelCapability.FUNCTION_CALLING,
    ],
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    pricing: { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    capabilities: [
      ModelCapability.CHAT,
      ModelCapability.VISION,
      ModelCapability.CODE,
      ModelCapability.FUNCTION_CALLING,
    ],
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  },
  {
    id: "gpt-4.1",
    name: "GPT-4.1",
    provider: "openai",
    capabilities: [
      ModelCapability.CHAT,
      ModelCapability.VISION,
      ModelCapability.CODE,
      ModelCapability.FUNCTION_CALLING,
    ],
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
    pricing: { inputPerMillion: 2.0, outputPerMillion: 8.0 },
  },
  {
    id: "gpt-4.1-mini",
    name: "GPT-4.1 Mini",
    provider: "openai",
    capabilities: [
      ModelCapability.CHAT,
      ModelCapability.VISION,
      ModelCapability.CODE,
      ModelCapability.FUNCTION_CALLING,
    ],
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
    pricing: { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  },
  {
    id: "o1",
    name: "OpenAI o1",
    provider: "openai",
    capabilities: [ModelCapability.CHAT, ModelCapability.CODE, ModelCapability.REASONING],
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    pricing: { inputPerMillion: 15.0, outputPerMillion: 60.0 },
  },
  {
    id: "o3-mini",
    name: "OpenAI o3-mini",
    provider: "openai",
    capabilities: [ModelCapability.CHAT, ModelCapability.CODE, ModelCapability.REASONING],
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    pricing: { inputPerMillion: 1.1, outputPerMillion: 4.4 },
  },
  {
    id: "text-embedding-3-large",
    name: "Text Embedding 3 Large",
    provider: "openai",
    capabilities: [ModelCapability.EMBEDDING],
    contextWindow: 8_191,
    pricing: { inputPerMillion: 0.13, outputPerMillion: 0, embeddingPerMillion: 0.13 },
  },
  {
    id: "text-embedding-3-small",
    name: "Text Embedding 3 Small",
    provider: "openai",
    capabilities: [ModelCapability.EMBEDDING],
    contextWindow: 8_191,
    pricing: { inputPerMillion: 0.02, outputPerMillion: 0, embeddingPerMillion: 0.02 },
  },
];

// ─────────────────────────────────────────────
// OpenAIProvider
// ─────────────────────────────────────────────

export class OpenAIProvider extends BaseProvider {
  readonly id = "openai";
  readonly name = "OpenAI";

  private readonly client: OpenAI;

  constructor(config: Partial<IProviderConfig> & { apiKey: string }) {
    super({
      id: "openai",
      name: "OpenAI",
      defaultModel: "gpt-4o",
      timeout: 60_000,
      maxRetries: 3,
      rateLimitRpm: 500,
      ...config,
    });

    this.client = new OpenAI({
      apiKey: config.apiKey,
      organization: config.organizationId,
      baseURL: config.baseUrl,
      timeout: this.config.timeout,
      maxRetries: 0, // We handle retries ourselves
    });

    this._models = OPENAI_MODELS;
  }

  isCapable(capability: ModelCapability): boolean {
    return [
      ModelCapability.CHAT,
      ModelCapability.VISION,
      ModelCapability.CODE,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.EMBEDDING,
      ModelCapability.REASONING,
    ].includes(capability);
  }

  protected async _chat(
    messages: IChatMessage[],
    options: IChatOptions,
  ): Promise<IChatResponse> {
    const start = Date.now();
    const model = options.model ?? this.config.defaultModel ?? "gpt-4o";

    const openaiMessages = this.toOpenAIMessages(messages, options.systemPrompt);
    const tools = options.tools?.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: openaiMessages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: options.topP,
        frequency_penalty: options.frequencyPenalty,
        presence_penalty: options.presencePenalty,
        stop: options.stop,
        tools: tools?.length ? tools : undefined,
        tool_choice: tools?.length ? (options.toolChoice as OpenAI.ChatCompletionToolChoiceOption ?? "auto") : undefined,
        response_format: options.responseFormat === "json" ? { type: "json_object" } : undefined,
        seed: options.seed,
        user: options.userId,
        stream: false,
      });

      const choice = response.choices[0];
      const toolCalls = choice.message.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || "{}"),
      }));

      const usage = {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
        cachedTokens: (response.usage as { prompt_tokens_details?: { cached_tokens?: number } })?.prompt_tokens_details?.cached_tokens,
      };

      return {
        id: response.id,
        model: response.model,
        provider: this.id,
        content: choice.message.content ?? "",
        toolCalls: toolCalls?.length ? toolCalls : undefined,
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
    const model = options.model ?? this.config.defaultModel ?? "gpt-4o";
    const openaiMessages = this.toOpenAIMessages(messages, options.systemPrompt);

    try {
      const stream = await this.client.chat.completions.create({
        model,
        messages: openaiMessages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: options.topP,
        stream: true,
        stream_options: { include_usage: true },
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
          usage: chunk.usage
            ? {
                promptTokens: chunk.usage.prompt_tokens,
                completionTokens: chunk.usage.completion_tokens,
                totalTokens: chunk.usage.total_tokens,
              }
            : undefined,
        };
      }
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async _embed(
    texts: string[],
    options: IEmbeddingOptions,
  ): Promise<IEmbeddingResponse> {
    const start = Date.now();
    const model = options.model ?? "text-embedding-3-small";

    try {
      const response = await this.client.embeddings.create({
        model,
        input: texts,
        dimensions: options.dimensions,
        user: options.userId,
      });

      return {
        id: `${this.id}-embed-${Date.now()}`,
        provider: this.id,
        model,
        embeddings: response.data.map((d) => d.embedding),
        usage: { totalTokens: response.usage.total_tokens },
        cost: (response.usage.total_tokens / 1_000_000) * 0.02,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async _listModels(): Promise<IModelInfo[]> {
    return OPENAI_MODELS;
  }

  // ─── Format Conversion ───

  private toOpenAIMessages(
    messages: IChatMessage[],
    systemPrompt?: string,
  ): OpenAI.ChatCompletionMessageParam[] {
    const result: OpenAI.ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      result.push({ role: "system", content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === MessageRole.SYSTEM) {
        result.push({ role: "system", content: this.normalizeContent(msg.content) });
      } else if (msg.role === MessageRole.USER) {
        const content = msg.content;
        if (typeof content === "string") {
          result.push({ role: "user", content });
        } else if (Array.isArray(content)) {
          const parts: OpenAI.ChatCompletionContentPart[] = content.map((part) => {
            if (typeof part === "object" && "type" in part && part.type === "image") {
              const imgPart = part as { type: "image"; url?: string; base64?: string; mimeType?: string };
              return {
                type: "image_url" as const,
                image_url: {
                  url: imgPart.url ?? `data:${imgPart.mimeType ?? "image/jpeg"};base64,${imgPart.base64}`,
                },
              };
            }
            return { type: "text" as const, text: typeof part === "object" && "text" in part ? (part as {text: string}).text : "" };
          });
          result.push({ role: "user", content: parts });
        } else {
          result.push({ role: "user", content: this.normalizeContent(content) });
        }
      } else if (msg.role === MessageRole.ASSISTANT) {
        result.push({ role: "assistant", content: this.normalizeContent(msg.content) });
      } else if (msg.role === MessageRole.TOOL) {
        result.push({
          role: "tool",
          content: this.normalizeContent(msg.content),
          tool_call_id: msg.toolCallId ?? "",
        });
      }
    }

    return result;
  }

  private mapFinishReason(reason: string | null): FinishReason {
    switch (reason) {
      case "stop": return FinishReason.STOP;
      case "length": return FinishReason.LENGTH;
      case "tool_calls": return FinishReason.TOOL_CALL;
      case "content_filter": return FinishReason.CONTENT_FILTER;
      default: return FinishReason.STOP;
    }
  }

  private mapError(err: unknown): ProviderError {
    if (err instanceof OpenAI.APIError) {
      if (err.status === 401) return new AuthenticationError(this.id, err);
      if (err.status === 429) {
        const retryAfter = parseInt(err.headers?.["retry-after"] ?? "0", 10) * 1000;
        return new RateLimitError(this.id, retryAfter || undefined, err);
      }
      if (err.status === 400 && err.message.includes("context_length")) {
        return new ContextLengthError(this.id, 128_000, 0);
      }
      return new ProviderError(err.message, this.id, `OPENAI_${err.code ?? err.status}`, err.status, err.status >= 500, err);
    }
    return new ProviderError(String(err), this.id, "UNKNOWN", undefined, true, err);
  }
}
