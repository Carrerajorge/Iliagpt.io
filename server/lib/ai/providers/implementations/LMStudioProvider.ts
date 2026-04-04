/**
 * LMStudioProvider — Local models via LM Studio
 * Exposes an OpenAI-compatible server at localhost:1234
 */

import OpenAI from "openai";
import { BaseProvider } from "../core/BaseProvider.js";
import {
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
} from "../core/types.js";

export class LMStudioProvider extends BaseProvider {
  readonly id = "lmstudio";
  readonly name = "LM Studio (Local)";
  private readonly client: OpenAI;

  constructor(config: Partial<IProviderConfig> = {}) {
    super({
      id: "lmstudio",
      name: "LM Studio (Local)",
      defaultModel: "local-model",
      baseUrl: "http://localhost:1234/v1",
      timeout: 300_000,
      maxRetries: 1,
      ...config,
    });

    this.client = new OpenAI({
      apiKey: "lm-studio",  // LM Studio doesn't require a real key
      baseURL: this.config.baseUrl ?? "http://localhost:1234/v1",
      timeout: this.config.timeout,
      maxRetries: 0,
    });
  }

  isCapable(capability: ModelCapability): boolean {
    return [
      ModelCapability.CHAT,
      ModelCapability.CODE,
      ModelCapability.EMBEDDING,
    ].includes(capability);
  }

  protected async _chat(messages: IChatMessage[], options: IChatOptions): Promise<IChatResponse> {
    const start = Date.now();
    const model = options.model ?? this.config.defaultModel ?? "local-model";

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

      return {
        id: response.id,
        model: response.model,
        provider: this.id,
        content: choice.message.content ?? "",
        finishReason: choice.finish_reason === "stop" ? FinishReason.STOP : FinishReason.LENGTH,
        usage,
        cost: 0, // Local — no cost
        latencyMs: Date.now() - start,
        createdAt: new Date(response.created * 1000),
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async *_stream(messages: IChatMessage[], options: IChatOptions): AsyncIterable<IStreamChunk> {
    const model = options.model ?? this.config.defaultModel ?? "local-model";

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
    const model = options.model ?? "text-embedding-nomic-embed-text-v1.5";

    try {
      const response = await this.client.embeddings.create({ model, input: texts });
      return {
        id: this.generateRequestId(),
        provider: this.id,
        model,
        embeddings: response.data.map((d) => d.embedding),
        usage: { totalTokens: response.usage.total_tokens },
        cost: 0,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async _listModels(): Promise<IModelInfo[]> {
    try {
      const response = await this.client.models.list();
      return response.data.map((m): IModelInfo => ({
        id: m.id,
        name: m.id,
        provider: this.id,
        capabilities: [ModelCapability.CHAT, ModelCapability.CODE],
        contextWindow: 8_192,
        pricing: { inputPerMillion: 0, outputPerMillion: 0 },
      }));
    } catch {
      return [];
    }
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
      const isConnRefused =
        err.message.includes("ECONNREFUSED") || err.message.includes("fetch failed");
      return new ProviderError(
        isConnRefused
          ? "LM Studio is not running. Start it and load a model first."
          : err.message,
        this.id,
        isConnRefused ? "LMS_NOT_RUNNING" : `LMS_${err.status}`,
        err.status,
        !isConnRefused && (err.status ?? 0) >= 500,
        err,
      );
    }
    return new ProviderError(String(err), this.id, "UNKNOWN", undefined, true, err);
  }
}
