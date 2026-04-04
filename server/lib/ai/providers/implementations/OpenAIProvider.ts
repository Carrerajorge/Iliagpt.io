/**
 * OpenAI Provider
 * Supports: GPT-4o, GPT-4o-mini, GPT-4-turbo, GPT-3.5-turbo, o1, o3, embeddings
 */

import OpenAI from 'openai';
import {
  IProviderConfig,
  IChatRequest,
  IChatResponse,
  IStreamChunk,
  IEmbedRequest,
  IEmbedResponse,
  IModelInfo,
  ModelCapability,
  MessageRole,
  ProviderError,
  AuthenticationError,
  RateLimitError,
  ModelNotFoundError,
} from '../core/types';
import { BaseProvider } from '../core/BaseProvider';

// ─── Static model catalogue (updated 2025) ────────────────────────────────────

const OPENAI_MODELS: IModelInfo[] = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.JsonMode, ModelCapability.Streaming, ModelCapability.ImageUnderstanding, ModelCapability.CodeGeneration],
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
    latencyClass: 'fast',
    qualityScore: 0.92,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.JsonMode, ModelCapability.Streaming, ModelCapability.ImageUnderstanding],
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
    latencyClass: 'ultra_fast',
    qualityScore: 0.78,
  },
  {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    provider: 'openai',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.JsonMode, ModelCapability.Streaming, ModelCapability.ImageUnderstanding, ModelCapability.CodeGeneration],
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    pricing: { inputPerMillion: 10, outputPerMillion: 30 },
    latencyClass: 'medium',
    qualityScore: 0.91,
  },
  {
    id: 'o1',
    name: 'o1',
    provider: 'openai',
    capabilities: [ModelCapability.Chat, ModelCapability.Reasoning, ModelCapability.CodeGeneration],
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    pricing: { inputPerMillion: 15, outputPerMillion: 60 },
    latencyClass: 'slow',
    qualityScore: 0.97,
  },
  {
    id: 'o3-mini',
    name: 'o3-mini',
    provider: 'openai',
    capabilities: [ModelCapability.Chat, ModelCapability.Reasoning, ModelCapability.CodeGeneration, ModelCapability.Streaming],
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    pricing: { inputPerMillion: 1.1, outputPerMillion: 4.4 },
    latencyClass: 'medium',
    qualityScore: 0.88,
  },
  {
    id: 'text-embedding-3-small',
    name: 'text-embedding-3-small',
    provider: 'openai',
    capabilities: [ModelCapability.Embedding],
    contextWindow: 8_191,
    maxOutputTokens: 0,
    pricing: { inputPerMillion: 0.02, outputPerMillion: 0 },
    latencyClass: 'ultra_fast',
    qualityScore: 0.75,
  },
  {
    id: 'text-embedding-3-large',
    name: 'text-embedding-3-large',
    provider: 'openai',
    capabilities: [ModelCapability.Embedding],
    contextWindow: 8_191,
    maxOutputTokens: 0,
    pricing: { inputPerMillion: 0.13, outputPerMillion: 0 },
    latencyClass: 'fast',
    qualityScore: 0.88,
  },
];

// ─── Provider ─────────────────────────────────────────────────────────────────

export class OpenAIProvider extends BaseProvider {
  private client!: OpenAI;

  get name(): string {
    return 'openai';
  }

  override async initialize(config: IProviderConfig): Promise<void> {
    await super.initialize(config);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      organization: config.organization,
      project: config.project,
      baseURL: config.baseUrl,
      timeout: config.timeout ?? 60_000,
      maxRetries: 0, // we handle retries in BaseProvider
      defaultHeaders: config.headers,
    });
  }

  protected async _chat(request: IChatRequest): Promise<IChatResponse> {
    const model = request.model ?? this.config.defaultModel ?? 'gpt-4o-mini';
    const t0 = Date.now();

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: request.messages as OpenAI.ChatCompletionMessageParam[],
        temperature: request.temperature,
        max_completion_tokens: request.maxTokens,
        top_p: request.topP,
        frequency_penalty: request.frequencyPenalty,
        presence_penalty: request.presencePenalty,
        stop: request.stop,
        tools: request.tools as OpenAI.ChatCompletionTool[] | undefined,
        tool_choice: request.toolChoice as OpenAI.ChatCompletionToolChoiceOption | undefined,
        response_format: request.responseFormat as OpenAI.ResponseFormatJSONObject | undefined,
        stream: false,
      });

      const choice = response.choices[0];
      const usage = response.usage!;
      const modelInfo = OPENAI_MODELS.find((m) => m.id === model);
      const cost = modelInfo
        ? this.calculateCost(
            this.buildUsage(usage.prompt_tokens, usage.completion_tokens),
            modelInfo.pricing,
          )
        : undefined;

      return {
        id: response.id,
        content: choice.message.content ?? '',
        role: MessageRole.Assistant,
        model: response.model,
        provider: this.name,
        usage: this.buildUsage(usage.prompt_tokens, usage.completion_tokens, {
          cachedTokens: (usage as any).prompt_tokens_details?.cached_tokens,
          reasoningTokens: (usage as any).completion_tokens_details?.reasoning_tokens,
        }),
        finishReason: this.normalizeFinishReason(choice.finish_reason),
        toolCalls: choice.message.tool_calls?.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
        latencyMs: Date.now() - t0,
        cost,
      };
    } catch (err: any) {
      throw this._mapError(err);
    }
  }

  protected async *_stream(request: IChatRequest): AsyncGenerator<IStreamChunk> {
    const model = request.model ?? this.config.defaultModel ?? 'gpt-4o-mini';
    const id = this.generateId('openai');

    try {
      const stream = await this.client.chat.completions.create({
        model,
        messages: request.messages as OpenAI.ChatCompletionMessageParam[],
        temperature: request.temperature,
        max_completion_tokens: request.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      });

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) {
          // Usage chunk
          if (chunk.usage) {
            yield {
              type: 'usage',
              id,
              model,
              provider: this.name,
              usage: this.buildUsage(chunk.usage.prompt_tokens, chunk.usage.completion_tokens),
              finishReason: 'stop',
            };
          }
          continue;
        }

        const delta = choice.delta?.content;
        if (delta) {
          yield {
            type: 'delta',
            id,
            model,
            provider: this.name,
            delta,
            finishReason: null,
          };
        }

        if (choice.finish_reason) {
          yield {
            type: 'done',
            id,
            model,
            provider: this.name,
            finishReason: this.normalizeFinishReason(choice.finish_reason),
          };
        }
      }
    } catch (err: any) {
      yield {
        type: 'error',
        id,
        model,
        provider: this.name,
        error: err.message ?? 'Stream error',
        finishReason: null,
      };
      throw this._mapError(err);
    }
  }

  protected async _embed(request: IEmbedRequest): Promise<IEmbedResponse> {
    const model = request.model ?? 'text-embedding-3-small';

    try {
      const response = await this.client.embeddings.create({
        model,
        input: request.input,
        dimensions: request.dimensions,
      });

      return {
        embeddings: response.data.map((d) => d.embedding),
        model: response.model,
        provider: this.name,
        usage: {
          promptTokens: response.usage.prompt_tokens,
          totalTokens: response.usage.total_tokens,
        },
      };
    } catch (err: any) {
      throw this._mapError(err);
    }
  }

  async listModels(): Promise<IModelInfo[]> {
    return OPENAI_MODELS;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  private _mapError(err: any): Error {
    if (err instanceof ProviderError) return err;
    const status = err.status ?? err.statusCode;
    if (status === 401) return new AuthenticationError(this.name);
    if (status === 429) return new RateLimitError(this.name, err.headers?.['retry-after-ms'] ? parseInt(err.headers['retry-after-ms']) : undefined);
    if (status === 404) return new ModelNotFoundError(this.name, 'unknown');
    return new ProviderError(err.message ?? 'Unknown OpenAI error', this.name, 'OPENAI_ERROR', status >= 500);
  }
}
