/**
 * xAI (Grok) Provider — OpenAI-compatible API
 * Models: grok-3, grok-3-mini, grok-2-vision
 */

import OpenAI from 'openai';
import {
  IProviderConfig, IChatRequest, IChatResponse, IStreamChunk,
  IEmbedRequest, IEmbedResponse, IModelInfo, ModelCapability,
  MessageRole, ProviderError, AuthenticationError, RateLimitError,
} from '../core/types';
import { BaseProvider } from '../core/BaseProvider';

const XAI_MODELS: IModelInfo[] = [
  {
    id: 'grok-3',
    name: 'Grok 3',
    provider: 'xai',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.Streaming, ModelCapability.CodeGeneration, ModelCapability.Reasoning],
    contextWindow: 131_072,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 3, outputPerMillion: 15 },
    latencyClass: 'fast',
    qualityScore: 0.88,
  },
  {
    id: 'grok-3-mini',
    name: 'Grok 3 Mini',
    provider: 'xai',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.Streaming, ModelCapability.Reasoning],
    contextWindow: 131_072,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 0.3, outputPerMillion: 0.5 },
    latencyClass: 'ultra_fast',
    qualityScore: 0.74,
  },
  {
    id: 'grok-2-vision-1212',
    name: 'Grok 2 Vision',
    provider: 'xai',
    capabilities: [ModelCapability.Chat, ModelCapability.Streaming, ModelCapability.ImageUnderstanding],
    contextWindow: 32_768,
    maxOutputTokens: 4_096,
    pricing: { inputPerMillion: 2, outputPerMillion: 10 },
    latencyClass: 'medium',
    qualityScore: 0.80,
  },
];

export class XAIProvider extends BaseProvider {
  private client!: OpenAI;

  get name(): string { return 'xai'; }

  override async initialize(config: IProviderConfig): Promise<void> {
    await super.initialize(config);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? 'https://api.x.ai/v1',
      timeout: config.timeout ?? 60_000,
      maxRetries: 0,
    });
  }

  protected async _chat(request: IChatRequest): Promise<IChatResponse> {
    const model = request.model ?? this.config.defaultModel ?? 'grok-3-mini';
    try {
      const res = await this.client.chat.completions.create({
        model,
        messages: request.messages as OpenAI.ChatCompletionMessageParam[],
        temperature: request.temperature,
        max_completion_tokens: request.maxTokens,
        stream: false,
      });
      const choice = res.choices[0];
      const usage = this.buildUsage(res.usage!.prompt_tokens, res.usage!.completion_tokens);
      const modelInfo = XAI_MODELS.find((m) => m.id === model);
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
    const model = request.model ?? this.config.defaultModel ?? 'grok-3-mini';
    const id = this.generateId('xai');
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
    throw new ProviderError('xAI does not support embeddings', this.name, 'NOT_SUPPORTED', false);
  }

  async listModels(): Promise<IModelInfo[]> { return XAI_MODELS; }

  async healthCheck(): Promise<boolean> {
    try { await this.client.models.list(); return true; } catch { return false; }
  }

  private _mapError(err: any): Error {
    if (err instanceof ProviderError) return err;
    const s = err.status ?? err.statusCode;
    if (s === 401) return new AuthenticationError(this.name);
    if (s === 429) return new RateLimitError(this.name);
    return new ProviderError(err.message ?? 'xAI error', this.name, 'XAI_ERROR', s >= 500);
  }
}
