/**
 * PerplexityProvider — Sonar models with real-time web search
 * OpenAI-compatible API, responses include citations
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

const PERPLEXITY_MODELS: IModelInfo[] = [
  {
    id: "sonar-pro",
    name: "Sonar Pro",
    provider: "perplexity",
    capabilities: [ModelCapability.CHAT, ModelCapability.SEARCH, ModelCapability.REASONING],
    contextWindow: 200_000,
    maxOutputTokens: 8_000,
    pricing: { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  },
  {
    id: "sonar",
    name: "Sonar",
    provider: "perplexity",
    capabilities: [ModelCapability.CHAT, ModelCapability.SEARCH],
    contextWindow: 127_072,
    maxOutputTokens: 8_000,
    pricing: { inputPerMillion: 1.0, outputPerMillion: 1.0 },
  },
  {
    id: "sonar-reasoning-pro",
    name: "Sonar Reasoning Pro",
    provider: "perplexity",
    capabilities: [ModelCapability.CHAT, ModelCapability.SEARCH, ModelCapability.REASONING],
    contextWindow: 127_072,
    maxOutputTokens: 8_000,
    pricing: { inputPerMillion: 2.0, outputPerMillion: 8.0 },
  },
  {
    id: "sonar-reasoning",
    name: "Sonar Reasoning",
    provider: "perplexity",
    capabilities: [ModelCapability.CHAT, ModelCapability.SEARCH, ModelCapability.REASONING],
    contextWindow: 127_072,
    maxOutputTokens: 8_000,
    pricing: { inputPerMillion: 1.0, outputPerMillion: 5.0 },
  },
];

export class PerplexityProvider extends BaseProvider {
  readonly id = "perplexity";
  readonly name = "Perplexity AI";
  private readonly client: OpenAI;

  constructor(config: Partial<IProviderConfig> & { apiKey: string }) {
    super({
      id: "perplexity",
      name: "Perplexity AI",
      defaultModel: "sonar",
      timeout: 60_000,
      maxRetries: 3,
      rateLimitRpm: 60,
      ...config,
    });

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? "https://api.perplexity.ai",
      timeout: this.config.timeout,
      maxRetries: 0,
    });

    this._models = PERPLEXITY_MODELS;
  }

  isCapable(capability: ModelCapability): boolean {
    return [
      ModelCapability.CHAT,
      ModelCapability.SEARCH,
      ModelCapability.REASONING,
    ].includes(capability);
  }

  protected async _chat(messages: IChatMessage[], options: IChatOptions): Promise<IChatResponse> {
    const start = Date.now();
    const model = options.model ?? this.config.defaultModel ?? "sonar";

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: this.formatMessages(messages, options.systemPrompt),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        stream: false,
      } as OpenAI.ChatCompletionCreateParamsNonStreaming);

      const choice = response.choices[0];
      // Perplexity includes citations in the response
      const citations = (response as { citations?: string[] }).citations;

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
        metadata: citations ? { citations } : undefined,
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async *_stream(messages: IChatMessage[], options: IChatOptions): AsyncIterable<IStreamChunk> {
    const model = options.model ?? this.config.defaultModel ?? "sonar";

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

        const citations = (chunk as { citations?: string[] }).citations;
        yield {
          id: chunk.id,
          delta: choice.delta?.content ?? "",
          finishReason: choice.finish_reason === "stop" ? FinishReason.STOP : undefined,
          metadata: citations ? { citations } : undefined,
        };
      }
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async _embed(_texts: string[], _options: IEmbeddingOptions): Promise<IEmbeddingResponse> {
    throw new ProviderError("Perplexity does not support embeddings.", this.id, "NOT_SUPPORTED", undefined, false);
  }

  protected async _listModels(): Promise<IModelInfo[]> {
    return PERPLEXITY_MODELS;
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
      return new ProviderError(err.message, this.id, `PERPLEXITY_${err.status}`, err.status, err.status >= 500, err);
    }
    return new ProviderError(String(err), this.id, "UNKNOWN", undefined, true, err);
  }
}
