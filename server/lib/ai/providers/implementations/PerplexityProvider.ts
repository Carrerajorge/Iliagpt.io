/**
 * Perplexity AI Provider — OpenAI-compatible API with web search
 * Models: sonar, sonar-pro, sonar-reasoning-pro
 */

import OpenAI from 'openai';
import {
  IProviderConfig, IChatRequest, IChatResponse, IStreamChunk,
  IEmbedRequest, IEmbedResponse, IModelInfo, ModelCapability,
  MessageRole, ProviderError, AuthenticationError, RateLimitError,
} from '../core/types';
import { BaseProvider } from '../core/BaseProvider';

const PERPLEXITY_MODELS: IModelInfo[] = [
  {
    id: 'sonar',
    name: 'Sonar',
    provider: 'perplexity',
    capabilities: [ModelCapability.Chat, ModelCapability.Streaming],
    contextWindow: 127_072,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 1, outputPerMillion: 1 },
    latencyClass: 'fast',
    qualityScore: 0.78,
    metadata: { supportsSearch: true },
  },
  {
    id: 'sonar-pro',
    name: 'Sonar Pro',
    provider: 'perplexity',
    capabilities: [ModelCapability.Chat, ModelCapability.Streaming, ModelCapability.Reasoning],
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 3, outputPerMillion: 15 },
    latencyClass: 'medium',
    qualityScore: 0.88,
    metadata: { supportsSearch: true },
  },
  {
    id: 'sonar-reasoning-pro',
    name: 'Sonar Reasoning Pro',
    provider: 'perplexity',
    capabilities: [ModelCapability.Chat, ModelCapability.Streaming, ModelCapability.Reasoning],
    contextWindow: 127_072,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 2, outputPerMillion: 8 },
    latencyClass: 'medium',
    qualityScore: 0.90,
    metadata: { supportsSearch: true },
  },
];

export class PerplexityProvider extends BaseProvider {
  private client!: OpenAI;

  get name(): string { return 'perplexity'; }

  override async initialize(config: IProviderConfig): Promise<void> {
    await super.initialize(config);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? 'https://api.perplexity.ai',
      timeout: config.timeout ?? 60_000,
      maxRetries: 0,
    });
  }

  protected async _chat(request: IChatRequest): Promise<IChatResponse> {
    const model = request.model ?? this.config.defaultModel ?? 'sonar';
    try {
      const res = await this.client.chat.completions.create({
        model, messages: request.messages as OpenAI.ChatCompletionMessageParam[],
        temperature: request.temperature, max_tokens: request.maxTokens, stream: false,
      });
      const choice = res.choices[0];
      const usage = this.buildUsage(res.usage!.prompt_tokens, res.usage!.completion_tokens);
      const modelInfo = PERPLEXITY_MODELS.find((m) => m.id === model);
      return {
        id: res.id, content: choice.message.content ?? '',
        role: MessageRole.Assistant, model: res.model, provider: this.name, usage,
        finishReason: this.normalizeFinishReason(choice.finish_reason), latencyMs: 0,
        cost: modelInfo ? this.calculateCost(usage, modelInfo.pricing) : undefined,
        metadata: { citations: (res as any).citations },
      };
    } catch (err: any) { throw this._mapError(err); }
  }

  protected async *_stream(request: IChatRequest): AsyncGenerator<IStreamChunk> {
    const model = request.model ?? this.config.defaultModel ?? 'sonar';
    const id = this.generateId('perplexity');
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
    throw new ProviderError('Perplexity does not support embeddings', this.name, 'NOT_SUPPORTED', false);
  }

  async listModels(): Promise<IModelInfo[]> { return PERPLEXITY_MODELS; }

  async healthCheck(): Promise<boolean> {
    try { await this.client.models.list(); return true; } catch { return false; }
  }

  private _mapError(err: any): Error {
    if (err instanceof ProviderError) return err;
    const s = err.status ?? err.statusCode;
    if (s === 401) return new AuthenticationError(this.name);
    if (s === 429) return new RateLimitError(this.name);
    return new ProviderError(err.message ?? 'Perplexity error', this.name, 'PERPLEXITY_ERROR', s >= 500);
  }
}
