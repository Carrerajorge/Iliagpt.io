/**
 * DeepSeekProvider — DeepSeek V3, DeepSeek R1 (OpenAI-compatible API)
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

const DEEPSEEK_MODELS: IModelInfo[] = [
  {
    id: "deepseek-chat",
    name: "DeepSeek V3",
    provider: "deepseek",
    capabilities: [ModelCapability.CHAT, ModelCapability.CODE, ModelCapability.FUNCTION_CALLING],
    contextWindow: 64_000,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 0.27, outputPerMillion: 1.10 },
  },
  {
    id: "deepseek-reasoner",
    name: "DeepSeek R1",
    provider: "deepseek",
    capabilities: [ModelCapability.CHAT, ModelCapability.CODE, ModelCapability.REASONING],
    contextWindow: 64_000,
    maxOutputTokens: 32_768,
    pricing: { inputPerMillion: 0.55, outputPerMillion: 2.19 },
  },
];

export class DeepSeekProvider extends BaseProvider {
  readonly id = "deepseek";
  readonly name = "DeepSeek";
  private readonly client: OpenAI;

  constructor(config: Partial<IProviderConfig> & { apiKey: string }) {
    super({
      id: "deepseek",
      name: "DeepSeek",
      defaultModel: "deepseek-chat",
      timeout: 120_000,
      maxRetries: 3,
      rateLimitRpm: 60,
      ...config,
    });

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? "https://api.deepseek.com/v1",
      timeout: this.config.timeout,
      maxRetries: 0,
    });

    this._models = DEEPSEEK_MODELS;
  }

  isCapable(capability: ModelCapability): boolean {
    return [
      ModelCapability.CHAT,
      ModelCapability.CODE,
      ModelCapability.REASONING,
      ModelCapability.FUNCTION_CALLING,
    ].includes(capability);
  }

  protected async _chat(messages: IChatMessage[], options: IChatOptions): Promise<IChatResponse> {
    const start = Date.now();
    const model = options.model ?? this.config.defaultModel ?? "deepseek-chat";

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
      // DeepSeek R1 includes reasoning_content in the response
      const reasoningContent = (choice.message as { reasoning_content?: string }).reasoning_content;
      const content = choice.message.content ?? "";

      const usage = {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
        reasoningTokens: (response.usage as { completion_tokens_details?: { reasoning_tokens?: number } })?.completion_tokens_details?.reasoning_tokens,
      };

      return {
        id: response.id,
        model: response.model,
        provider: this.id,
        content,
        finishReason: choice.finish_reason === "stop" ? FinishReason.STOP : FinishReason.LENGTH,
        usage,
        cost: this.calculateCost(model, usage.promptTokens, usage.completionTokens),
        latencyMs: Date.now() - start,
        createdAt: new Date(response.created * 1000),
        metadata: reasoningContent ? { reasoningContent } : undefined,
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async *_stream(messages: IChatMessage[], options: IChatOptions): AsyncIterable<IStreamChunk> {
    const model = options.model ?? this.config.defaultModel ?? "deepseek-chat";

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

        // DeepSeek streams reasoning_content separately
        const reasoningDelta = (choice.delta as { reasoning_content?: string }).reasoning_content;
        const delta = choice.delta?.content ?? "";

        yield {
          id: chunk.id,
          delta: delta || (reasoningDelta ? `<think>${reasoningDelta}</think>` : ""),
          finishReason: choice.finish_reason === "stop" ? FinishReason.STOP : undefined,
          metadata: reasoningDelta ? { isReasoning: true } : undefined,
        };
      }
    } catch (err) {
      throw this.mapError(err);
    }
  }

  protected async _embed(_texts: string[], _options: IEmbeddingOptions): Promise<IEmbeddingResponse> {
    throw new ProviderError("DeepSeek does not support embeddings.", this.id, "NOT_SUPPORTED", undefined, false);
  }

  protected async _listModels(): Promise<IModelInfo[]> {
    return DEEPSEEK_MODELS;
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
      return new ProviderError(err.message, this.id, `DEEPSEEK_${err.status}`, err.status, err.status >= 500, err);
    }
    return new ProviderError(String(err), this.id, "UNKNOWN", undefined, true, err);
  }
}
