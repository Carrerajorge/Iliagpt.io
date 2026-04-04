/**
 * FireworksProvider — Fireworks AI: Fast inference, Firefunction, fine-tuned models
 * OpenAI-compatible API
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

const FIREWORKS_MODELS: IModelInfo[] = [
  {
    id: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    name: "Llama 3.3 70B Instruct",
    provider: "fireworks",
    capabilities: [ModelCapability.CHAT, ModelCapability.CODE, ModelCapability.FUNCTION_CALLING],
    contextWindow: 131_072,
    pricing: { inputPerMillion: 0.9, outputPerMillion: 0.9 },
  },
  {
    id: "accounts/fireworks/models/firefunction-v2",
    name: "Firefunction v2",
    provider: "fireworks",
    capabilities: [ModelCapability.CHAT, ModelCapability.FUNCTION_CALLING],
    contextWindow: 8_192,
    pricing: { inputPerMillion: 0.5, outputPerMillion: 1.5 },
  },
  {
    id: "accounts/fireworks/models/qwen2p5-72b-instruct",
    name: "Qwen 2.5 72B Instruct",
    provider: "fireworks",
    capabilities: [ModelCapability.CHAT, ModelCapability.CODE],
    contextWindow: 32_768,
    pricing: { inputPerMillion: 0.9, outputPerMillion: 0.9 },
  },
  {
    id: "accounts/fireworks/models/mixtral-8x22b-instruct",
    name: "Mixtral 8x22B Instruct",
    provider: "fireworks",
    capabilities: [ModelCapability.CHAT, ModelCapability.CODE, ModelCapability.FUNCTION_CALLING],
    contextWindow: 65_536,
    pricing: { inputPerMillion: 1.2, outputPerMillion: 1.2 },
  },
  {
    id: "nomic-ai/nomic-embed-text-v1.5",
    name: "Nomic Embed Text v1.5",
    provider: "fireworks",
    capabilities: [ModelCapability.EMBEDDING],
    contextWindow: 8_192,
    pricing: { inputPerMillion: 0.008, outputPerMillion: 0, embeddingPerMillion: 0.008 },
  },
];

export class FireworksProvider extends BaseProvider {
  readonly id = "fireworks";
  readonly name = "Fireworks AI";
  private readonly client: OpenAI;

  constructor(config: Partial<IProviderConfig> & { apiKey: string }) {
    super({
      id: "fireworks",
      name: "Fireworks AI",
      defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
      timeout: 60_000,
      maxRetries: 3,
      rateLimitRpm: 60,
      ...config,
    });

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? "https://api.fireworks.ai/inference/v1",
      timeout: this.config.timeout,
      maxRetries: 0,
    });

    this._models = FIREWORKS_MODELS;
  }

  isCapable(capability: ModelCapability): boolean {
    return [
      ModelCapability.CHAT,
      ModelCapability.CODE,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.EMBEDDING,
    ].includes(capability);
  }

  protected async _chat(messages: IChatMessage[], options: IChatOptions): Promise<IChatResponse> {
    const start = Date.now();
    const model = options.model ?? this.config.defaultModel ?? "accounts/fireworks/models/llama-v3p3-70b-instruct";

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: this.formatMessages(messages, options.systemPrompt),
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
    const model = options.model ?? this.config.defaultModel ?? "accounts/fireworks/models/llama-v3p3-70b-instruct";

    try {
      const stream = await this.client.chat.completions.create({
        model,
        messages: this.formatMessages(messages, options.systemPrompt),
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
    const model = options.model ?? "nomic-ai/nomic-embed-text-v1.5";

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
    return FIREWORKS_MODELS;
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
      return new ProviderError(err.message, this.id, `FIREWORKS_${err.status}`, err.status, err.status >= 500, err);
    }
    return new ProviderError(String(err), this.id, "UNKNOWN", undefined, true, err);
  }
}
