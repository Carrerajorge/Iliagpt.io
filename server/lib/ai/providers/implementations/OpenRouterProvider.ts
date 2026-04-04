/**
 * OpenRouterProvider — Access to 200+ models through a single API
 * Automatic fallback routing, unified pricing, model capability metadata
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

// Curated popular models — full list fetched dynamically
const OPENROUTER_STATIC_MODELS: IModelInfo[] = [
  {
    id: "anthropic/claude-opus-4",
    name: "Claude Opus 4 (via OpenRouter)",
    provider: "openrouter",
    capabilities: [ModelCapability.CHAT, ModelCapability.VISION, ModelCapability.CODE, ModelCapability.REASONING],
    contextWindow: 200_000,
    pricing: { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  },
  {
    id: "openai/gpt-4o",
    name: "GPT-4o (via OpenRouter)",
    provider: "openrouter",
    capabilities: [ModelCapability.CHAT, ModelCapability.VISION, ModelCapability.CODE],
    contextWindow: 128_000,
    pricing: { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  },
  {
    id: "google/gemini-2.5-pro",
    name: "Gemini 2.5 Pro (via OpenRouter)",
    provider: "openrouter",
    capabilities: [ModelCapability.CHAT, ModelCapability.VISION, ModelCapability.CODE, ModelCapability.LONG_CONTEXT],
    contextWindow: 1_048_576,
    pricing: { inputPerMillion: 1.25, outputPerMillion: 10.0 },
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    name: "Llama 3.3 70B (via OpenRouter)",
    provider: "openrouter",
    capabilities: [ModelCapability.CHAT, ModelCapability.CODE],
    contextWindow: 128_000,
    pricing: { inputPerMillion: 0.12, outputPerMillion: 0.3 },
  },
  {
    id: "deepseek/deepseek-r1",
    name: "DeepSeek R1 (via OpenRouter)",
    provider: "openrouter",
    capabilities: [ModelCapability.CHAT, ModelCapability.CODE, ModelCapability.REASONING],
    contextWindow: 64_000,
    pricing: { inputPerMillion: 0.55, outputPerMillion: 2.19 },
  },
];

interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  architecture?: { modality: string };
}

export class OpenRouterProvider extends BaseProvider {
  readonly id = "openrouter";
  readonly name = "OpenRouter";
  private readonly client: OpenAI;
  private modelsCache: IModelInfo[] = [];
  private modelsCachedAt = 0;

  constructor(config: Partial<IProviderConfig> & { apiKey: string }) {
    super({
      id: "openrouter",
      name: "OpenRouter",
      defaultModel: "anthropic/claude-sonnet-4-6",
      timeout: 120_000,
      maxRetries: 3,
      rateLimitRpm: 200,
      ...config,
    });

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://iliagpt.ai",
        "X-Title": "IliaGPT",
      },
      timeout: this.config.timeout,
      maxRetries: 0,
    });

    this._models = OPENROUTER_STATIC_MODELS;
  }

  isCapable(capability: ModelCapability): boolean {
    // OpenRouter has access to models with all capabilities
    return Object.values(ModelCapability).includes(capability);
  }

  protected async _chat(messages: IChatMessage[], options: IChatOptions): Promise<IChatResponse> {
    const start = Date.now();
    const model = options.model ?? this.config.defaultModel ?? "anthropic/claude-sonnet-4-6";

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: this.formatMessages(messages, options.systemPrompt),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: options.topP,
        stop: options.stop,
        stream: false,
      } as OpenAI.ChatCompletionCreateParamsNonStreaming);

      const choice = response.choices[0];
      const usage = {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      };

      // OpenRouter includes actual cost in response
      const generationCost = (response as { usage?: { cost?: number } }).usage?.cost;

      return {
        id: response.id,
        model: response.model,
        provider: this.id,
        content: choice.message.content ?? "",
        finishReason: choice.finish_reason === "stop" ? FinishReason.STOP : FinishReason.LENGTH,
        usage,
        cost: generationCost ?? this.calculateCost(model, usage.promptTokens, usage.completionTokens),
        latencyMs: Date.now() - start,
        createdAt: new Date(response.created * 1000),
        metadata: { routedTo: response.model },
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async *_stream(messages: IChatMessage[], options: IChatOptions): AsyncIterable<IStreamChunk> {
    const model = options.model ?? this.config.defaultModel ?? "anthropic/claude-sonnet-4-6";

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
          metadata: { model: chunk.model },
        };
      }
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async _embed(_texts: string[], _options: IEmbeddingOptions): Promise<IEmbeddingResponse> {
    throw new ProviderError("OpenRouter embedding endpoint is not yet supported.", this.id, "NOT_SUPPORTED", undefined, false);
  }

  protected async _listModels(): Promise<IModelInfo[]> {
    // Cache for 10 minutes
    const now = Date.now();
    if (this.modelsCache.length > 0 && now - this.modelsCachedAt < 600_000) {
      return this.modelsCache;
    }

    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) return OPENROUTER_STATIC_MODELS;

      const data = await response.json() as { data: OpenRouterModel[] };
      this.modelsCache = data.data.map((m): IModelInfo => ({
        id: m.id,
        name: m.name,
        provider: "openrouter",
        capabilities: this.inferCapabilities(m),
        contextWindow: m.context_length,
        pricing: {
          inputPerMillion: parseFloat(m.pricing.prompt) * 1_000_000,
          outputPerMillion: parseFloat(m.pricing.completion) * 1_000_000,
        },
      }));
      this.modelsCachedAt = now;
      return this.modelsCache;
    } catch {
      return OPENROUTER_STATIC_MODELS;
    }
  }

  private inferCapabilities(model: OpenRouterModel): ModelCapability[] {
    const caps: ModelCapability[] = [ModelCapability.CHAT];
    const id = model.id.toLowerCase();
    const modality = model.architecture?.modality ?? "";

    if (modality.includes("image") || id.includes("vision") || id.includes("vl")) {
      caps.push(ModelCapability.VISION);
    }
    if (id.includes("code") || id.includes("coder") || id.includes("deepseek")) {
      caps.push(ModelCapability.CODE);
    }
    if (id.includes("reasoning") || id.includes("-r1") || id.includes("-o1") || id.includes("-o3")) {
      caps.push(ModelCapability.REASONING);
    }
    if (model.context_length >= 100_000) {
      caps.push(ModelCapability.LONG_CONTEXT);
    }

    return caps;
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
      return new ProviderError(err.message, this.id, `OPENROUTER_${err.status}`, err.status, err.status >= 500, err);
    }
    return new ProviderError(String(err), this.id, "UNKNOWN", undefined, true, err);
  }
}
