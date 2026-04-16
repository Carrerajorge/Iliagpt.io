/**
 * GroqProvider — Ultra-fast inference for Llama 3, Mixtral, Gemma via Groq LPU
 * OpenAI-compatible API with sub-100ms time-to-first-token
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

const GROQ_MODELS: IModelInfo[] = [
  {
    id: "llama-3.3-70b-versatile",
    name: "Llama 3.3 70B Versatile",
    provider: "groq",
    capabilities: [ModelCapability.CHAT, ModelCapability.CODE, ModelCapability.FUNCTION_CALLING],
    contextWindow: 128_000,
    maxOutputTokens: 32_768,
    pricing: { inputPerMillion: 0.59, outputPerMillion: 0.79 },
  },
  {
    id: "llama-3.1-8b-instant",
    name: "Llama 3.1 8B Instant",
    provider: "groq",
    capabilities: [ModelCapability.CHAT, ModelCapability.CODE],
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 0.05, outputPerMillion: 0.08 },
  },
  {
    id: "mixtral-8x7b-32768",
    name: "Mixtral 8x7B",
    provider: "groq",
    capabilities: [ModelCapability.CHAT, ModelCapability.CODE],
    contextWindow: 32_768,
    maxOutputTokens: 32_768,
    pricing: { inputPerMillion: 0.24, outputPerMillion: 0.24 },
  },
  {
    id: "gemma2-9b-it",
    name: "Gemma 2 9B",
    provider: "groq",
    capabilities: [ModelCapability.CHAT, ModelCapability.CODE],
    contextWindow: 8_192,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 0.2, outputPerMillion: 0.2 },
  },
  {
    id: "llama-3.2-90b-vision-preview",
    name: "Llama 3.2 90B Vision",
    provider: "groq",
    capabilities: [ModelCapability.CHAT, ModelCapability.VISION, ModelCapability.CODE],
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 0.9, outputPerMillion: 0.9 },
  },
];

export class GroqProvider extends BaseProvider {
  readonly id = "groq";
  readonly name = "Groq";
  private readonly client: OpenAI;

  constructor(config: Partial<IProviderConfig> & { apiKey: string }) {
    super({
      id: "groq",
      name: "Groq",
      defaultModel: "llama-3.3-70b-versatile",
      timeout: 30_000,
      maxRetries: 3,
      rateLimitRpm: 30,
      ...config,
    });

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? "https://api.groq.com/openai/v1",
      timeout: this.config.timeout,
      maxRetries: 0,
    });

    this._models = GROQ_MODELS;
  }

  isCapable(capability: ModelCapability): boolean {
    return [
      ModelCapability.CHAT,
      ModelCapability.VISION,
      ModelCapability.CODE,
      ModelCapability.FUNCTION_CALLING,
    ].includes(capability);
  }

  protected async _chat(messages: IChatMessage[], options: IChatOptions): Promise<IChatResponse> {
    const start = Date.now();
    const model = options.model ?? this.config.defaultModel ?? "llama-3.3-70b-versatile";

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: this.formatMessages(messages, options.systemPrompt),
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

      // Groq provides queue_time and total_time in x_groq metadata
      const groqMeta = (response as { x_groq?: { usage?: { queue_time?: number; total_time?: number } } }).x_groq;

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
        metadata: groqMeta ? { groqTiming: groqMeta.usage } : undefined,
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async *_stream(messages: IChatMessage[], options: IChatOptions): AsyncIterable<IStreamChunk> {
    const model = options.model ?? this.config.defaultModel ?? "llama-3.3-70b-versatile";

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

  protected async _embed(_texts: string[], _options: IEmbeddingOptions): Promise<IEmbeddingResponse> {
    throw new ProviderError("Groq does not support embeddings.", this.id, "NOT_SUPPORTED", undefined, false);
  }

  protected async _listModels(): Promise<IModelInfo[]> {
    return GROQ_MODELS;
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
      if (err.status === 429) {
        const retryAfter = parseInt(err.headers?.["retry-after"] ?? "60", 10) * 1000;
        return new RateLimitError(this.id, retryAfter, err);
      }
      return new ProviderError(err.message, this.id, `GROQ_${err.status}`, err.status, err.status >= 500, err);
    }
    return new ProviderError(String(err), this.id, "UNKNOWN", undefined, true, err);
  }
}
