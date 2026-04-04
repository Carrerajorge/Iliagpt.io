/**
 * DeepSeek Provider — OpenAI-compatible API
 * Models: deepseek-chat (V3), deepseek-reasoner (R1)
 */

import OpenAI from 'openai';
import {
  IProviderConfig, IChatRequest, IChatResponse, IStreamChunk,
  IEmbedRequest, IEmbedResponse, IModelInfo, ModelCapability,
  MessageRole, ProviderError, AuthenticationError, RateLimitError,
} from '../core/types';
import { BaseProvider } from '../core/BaseProvider';

const DEEPSEEK_MODELS: IModelInfo[] = [
  {
    id: 'deepseek-chat',
    name: 'DeepSeek V3',
    provider: 'deepseek',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.Streaming, ModelCapability.JsonMode, ModelCapability.CodeGeneration],
    contextWindow: 64_000,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 0.14, outputPerMillion: 0.28 },
    latencyClass: 'fast',
    qualityScore: 0.87,
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek R1',
    provider: 'deepseek',
    capabilities: [ModelCapability.Chat, ModelCapability.Reasoning, ModelCapability.Streaming, ModelCapability.CodeGeneration],
    contextWindow: 64_000,
    maxOutputTokens: 32_768,
    pricing: { inputPerMillion: 0.55, outputPerMillion: 2.19 },
    latencyClass: 'medium',
    qualityScore: 0.93,
  },
];

export class DeepSeekProvider extends BaseProvider {
  private client!: OpenAI;

  get name(): string { return 'deepseek'; }

  override async initialize(config: IProviderConfig): Promise<void> {
    await super.initialize(config);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? 'https://api.deepseek.com/v1',
      timeout: config.timeout ?? 60_000,
      maxRetries: 0,
    });
  }

  protected async _chat(request: IChatRequest): Promise<IChatResponse> {
    const model = request.model ?? this.config.defaultModel ?? 'deepseek-chat';
    try {
      const res = await this.client.chat.completions.create({
        model,
        messages: request.messages as OpenAI.ChatCompletionMessageParam[],
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stream: false,
        response_format: request.responseFormat as any,
      });
      const choice = res.choices[0];
      const usage = this.buildUsage(res.usage!.prompt_tokens, res.usage!.completion_tokens, {
        cachedTokens: (res.usage as any).prompt_cache_hit_tokens,
        reasoningTokens: (res.usage as any).completion_tokens_details?.reasoning_tokens,
      });
      const modelInfo = DEEPSEEK_MODELS.find((m) => m.id === model);
      return {
        id: res.id, content: choice.message.content ?? '',
        role: MessageRole.Assistant, model: res.model,
        provider: this.name, usage,
        finishReason: this.normalizeFinishReason(choice.finish_reason),
        latencyMs: 0,
        cost: modelInfo ? this.calculateCost(usage, modelInfo.pricing) : undefined,
      };
    } catch (err: any) { throw this._mapError(err); }
  }

  protected async *_stream(request: IChatRequest): AsyncGenerator<IStreamChunk> {
    const model = request.model ?? this.config.defaultModel ?? 'deepseek-chat';
    const id = this.generateId('deepseek');
    try {
      const stream = await this.client.chat.completions.create({ model, messages: request.messages as any, stream: true });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield { type: 'delta', id, model, provider: this.name, delta, finishReason: null };
        const fr = chunk.choices[0]?.finish_reason;
        if (fr) yield { type: 'done', id, model, provider: this.name, finishReason: this.normalizeFinishReason(fr) };
      }
    } catch (err: any) {
      yield { type: 'error', id, model, provider: this.name, error: err.message, finishReason: null };
      throw this._mapError(err);
    }
  }

  protected async _embed(_req: IEmbedRequest): Promise<IEmbedResponse> {
    throw new ProviderError('DeepSeek does not support embeddings', this.name, 'NOT_SUPPORTED', false);
  }

  async listModels(): Promise<IModelInfo[]> { return DEEPSEEK_MODELS; }

  async healthCheck(): Promise<boolean> {
    try { await this.client.models.list(); return true; } catch { return false; }
  }

  private _mapError(err: any): Error {
    if (err instanceof ProviderError) return err;
    const s = err.status ?? err.statusCode;
    if (s === 401) return new AuthenticationError(this.name);
    if (s === 429) return new RateLimitError(this.name);
    return new ProviderError(err.message ?? 'DeepSeek error', this.name, 'DEEPSEEK_ERROR', s >= 500);
  }
}
