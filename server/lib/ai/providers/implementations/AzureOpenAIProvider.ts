/**
 * AzureOpenAIProvider — Azure-hosted OpenAI models
 * Requires Azure endpoint, deployment names, and API version
 */

import OpenAI, { AzureOpenAI } from "openai";
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

export interface AzureOpenAIConfig extends Partial<IProviderConfig> {
  apiKey: string;
  endpoint: string;           // e.g., "https://my-resource.openai.azure.com"
  apiVersion?: string;        // e.g., "2024-12-01-preview"
  deployments?: Record<string, string>;  // logical name → deployment name
}

const DEFAULT_DEPLOYMENTS: Record<string, string> = {
  "gpt-4o": "gpt-4o",
  "gpt-4o-mini": "gpt-4o-mini",
  "gpt-4": "gpt-4",
  "text-embedding-3-small": "text-embedding-3-small",
  "text-embedding-3-large": "text-embedding-3-large",
};

const AZURE_MODELS: IModelInfo[] = [
  {
    id: "gpt-4o",
    name: "GPT-4o (Azure)",
    provider: "azure-openai",
    capabilities: [ModelCapability.CHAT, ModelCapability.VISION, ModelCapability.CODE, ModelCapability.FUNCTION_CALLING],
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    pricing: { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini (Azure)",
    provider: "azure-openai",
    capabilities: [ModelCapability.CHAT, ModelCapability.VISION, ModelCapability.CODE, ModelCapability.FUNCTION_CALLING],
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  },
  {
    id: "text-embedding-3-small",
    name: "Text Embedding 3 Small (Azure)",
    provider: "azure-openai",
    capabilities: [ModelCapability.EMBEDDING],
    contextWindow: 8_191,
    pricing: { inputPerMillion: 0.02, outputPerMillion: 0, embeddingPerMillion: 0.02 },
  },
];

export class AzureOpenAIProvider extends BaseProvider {
  readonly id = "azure-openai";
  readonly name = "Azure OpenAI";
  private readonly client: AzureOpenAI;
  private readonly deployments: Record<string, string>;

  constructor(config: AzureOpenAIConfig) {
    super({
      id: "azure-openai",
      name: "Azure OpenAI",
      defaultModel: "gpt-4o",
      timeout: 60_000,
      maxRetries: 3,
      rateLimitRpm: 60,
      baseUrl: config.endpoint,
      ...config,
    });

    this.deployments = { ...DEFAULT_DEPLOYMENTS, ...(config.deployments ?? {}) };

    this.client = new AzureOpenAI({
      apiKey: config.apiKey,
      endpoint: config.endpoint,
      apiVersion: config.apiVersion ?? "2024-12-01-preview",
      timeout: this.config.timeout,
      maxRetries: 0,
    });

    this._models = AZURE_MODELS;
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
    const modelId = options.model ?? this.config.defaultModel ?? "gpt-4o";
    const deployment = this.deployments[modelId] ?? modelId;

    try {
      const response = await this.client.chat.completions.create({
        model: deployment,
        messages: this.formatMessages(messages, options.systemPrompt),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: options.topP,
        frequency_penalty: options.frequencyPenalty,
        presence_penalty: options.presencePenalty,
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
        model: modelId,
        provider: this.id,
        content: choice.message.content ?? "",
        finishReason: this.mapFinishReason(choice.finish_reason),
        usage,
        cost: this.calculateCost(modelId, usage.promptTokens, usage.completionTokens),
        latencyMs: Date.now() - start,
        createdAt: new Date(response.created * 1000),
        metadata: { deployment },
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async *_stream(messages: IChatMessage[], options: IChatOptions): AsyncIterable<IStreamChunk> {
    const modelId = options.model ?? this.config.defaultModel ?? "gpt-4o";
    const deployment = this.deployments[modelId] ?? modelId;

    try {
      const stream = await this.client.chat.completions.create({
        model: deployment,
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
          finishReason: choice.finish_reason ? this.mapFinishReason(choice.finish_reason) : undefined,
        };
      }
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async _embed(texts: string[], options: IEmbeddingOptions): Promise<IEmbeddingResponse> {
    const start = Date.now();
    const modelId = options.model ?? "text-embedding-3-small";
    const deployment = this.deployments[modelId] ?? modelId;

    try {
      const response = await this.client.embeddings.create({
        model: deployment,
        input: texts,
        dimensions: options.dimensions,
      });

      return {
        id: this.generateRequestId(),
        provider: this.id,
        model: modelId,
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
    return AZURE_MODELS;
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
      return new ProviderError(err.message, this.id, `AZURE_${err.code ?? err.status}`, err.status, err.status >= 500, err);
    }
    return new ProviderError(String(err), this.id, "UNKNOWN", undefined, true, err);
  }
}
