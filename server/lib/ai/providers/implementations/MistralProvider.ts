/**
 * MistralProvider — Mistral Large, Mistral Medium, Codestral, Pixtral
 * Uses OpenAI-compatible API format
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

const MISTRAL_MODELS: IModelInfo[] = [
  {
    id: "mistral-large-latest",
    name: "Mistral Large",
    provider: "mistral",
    capabilities: [ModelCapability.CHAT, ModelCapability.CODE, ModelCapability.FUNCTION_CALLING],
    contextWindow: 131_072,
    pricing: { inputPerMillion: 2.0, outputPerMillion: 6.0 },
  },
  {
    id: "mistral-medium-latest",
    name: "Mistral Medium",
    provider: "mistral",
    capabilities: [ModelCapability.CHAT, ModelCapability.CODE, ModelCapability.FUNCTION_CALLING],
    contextWindow: 131_072,
    pricing: { inputPerMillion: 0.4, outputPerMillion: 2.0 },
  },
  {
    id: "mistral-small-latest",
    name: "Mistral Small",
    provider: "mistral",
    capabilities: [ModelCapability.CHAT, ModelCapability.CODE],
    contextWindow: 32_768,
    pricing: { inputPerMillion: 0.1, outputPerMillion: 0.3 },
  },
  {
    id: "codestral-latest",
    name: "Codestral",
    provider: "mistral",
    capabilities: [ModelCapability.CHAT, ModelCapability.CODE],
    contextWindow: 262_144,
    pricing: { inputPerMillion: 0.2, outputPerMillion: 0.6 },
  },
  {
    id: "pixtral-large-latest",
    name: "Pixtral Large",
    provider: "mistral",
    capabilities: [ModelCapability.CHAT, ModelCapability.VISION, ModelCapability.CODE],
    contextWindow: 131_072,
    pricing: { inputPerMillion: 2.0, outputPerMillion: 6.0 },
  },
  {
    id: "mistral-embed",
    name: "Mistral Embed",
    provider: "mistral",
    capabilities: [ModelCapability.EMBEDDING],
    contextWindow: 8_192,
    pricing: { inputPerMillion: 0.1, outputPerMillion: 0, embeddingPerMillion: 0.1 },
  },
];

export class MistralProvider extends BaseProvider {
  readonly id = "mistral";
  readonly name = "Mistral AI";
  private readonly client: OpenAI;

  constructor(config: Partial<IProviderConfig> & { apiKey: string }) {
    super({
      id: "mistral",
      name: "Mistral AI",
      defaultModel: "mistral-large-latest",
      timeout: 60_000,
      maxRetries: 3,
      rateLimitRpm: 60,
      ...config,
    });

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? "https://api.mistral.ai/v1",
      timeout: this.config.timeout,
      maxRetries: 0,
    });

    this._models = MISTRAL_MODELS;
  }

  isCapable(capability: ModelCapability): boolean {
    return [
      ModelCapability.CHAT,
      ModelCapability.VISION,
      ModelCapability.CODE,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.EMBEDDING,
    ].includes(capability);
  }

  protected async _chat(messages: IChatMessage[], options: IChatOptions): Promise<IChatResponse> {
    const start = Date.now();
    const model = options.model ?? this.config.defaultModel ?? "mistral-large-latest";
    const formattedMessages = this.formatMessages(messages, options.systemPrompt);

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: formattedMessages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: options.topP,
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
        finishReason: choice.finish_reason === "stop" ? FinishReason.STOP : FinishReason.LENGTH,
        usage,
        cost: this.calculateCost(model, usage.promptTokens, usage.completionTokens),
        latencyMs: Date.now() - start,
        createdAt: new Date(response.created * 1000),
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async *_stream(messages: IChatMessage[], options: IChatOptions): AsyncIterable<IStreamChunk> {
    const model = options.model ?? this.config.defaultModel ?? "mistral-large-latest";
    const formattedMessages = this.formatMessages(messages, options.systemPrompt);

    try {
      const stream = await this.client.chat.completions.create({
        model,
        messages: formattedMessages,
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
          finishReason: choice.finish_reason === "stop" ? FinishReason.STOP : undefined,
        };
      }
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async _embed(texts: string[], options: IEmbeddingOptions): Promise<IEmbeddingResponse> {
    const start = Date.now();
    const model = options.model ?? "mistral-embed";

    try {
      const response = await this.client.embeddings.create({ model, input: texts });
      return {
        id: this.generateRequestId(),
        provider: this.id,
        model,
        embeddings: response.data.map((d) => d.embedding),
        usage: { totalTokens: response.usage.total_tokens },
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async _listModels(): Promise<IModelInfo[]> {
    return MISTRAL_MODELS;
  }

  private formatMessages(messages: IChatMessage[], systemPrompt?: string): OpenAI.ChatCompletionMessageParam[] {
    const result: OpenAI.ChatCompletionMessageParam[] = [];
    if (systemPrompt) result.push({ role: "system", content: systemPrompt });
    for (const m of messages) {
      if (m.role === MessageRole.SYSTEM) result.push({ role: "system", content: this.normalizeContent(m.content) });
      else if (m.role === MessageRole.USER) result.push({ role: "user", content: this.normalizeContent(m.content) });
      else if (m.role === MessageRole.ASSISTANT) result.push({ role: "assistant", content: this.normalizeContent(m.content) });
    }
    return result;
  }

  private mapError(err: unknown): ProviderError {
    if (err instanceof OpenAI.APIError) {
      if (err.status === 401) return new AuthenticationError(this.id, err);
      if (err.status === 429) return new RateLimitError(this.id, undefined, err);
      return new ProviderError(err.message, this.id, `MISTRAL_${err.status}`, err.status, err.status >= 500, err);
    }
    return new ProviderError(String(err), this.id, "UNKNOWN", undefined, true, err);
  }
}
