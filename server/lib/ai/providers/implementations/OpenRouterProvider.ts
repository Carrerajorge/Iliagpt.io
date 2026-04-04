/**
 * OpenRouter Provider — OpenAI-compatible meta-router
 * Routes to 200+ models across all major providers with unified billing
 */

import OpenAI from 'openai';
import {
  IProviderConfig, IChatRequest, IChatResponse, IStreamChunk,
  IEmbedRequest, IEmbedResponse, IModelInfo, ModelCapability,
  MessageRole, ProviderError, AuthenticationError, RateLimitError,
} from '../core/types';
import { BaseProvider } from '../core/BaseProvider';

// A representative subset; the real list is fetched dynamically
const OPENROUTER_STATIC_MODELS: IModelInfo[] = [
  {
    id: 'anthropic/claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5 (via OpenRouter)',
    provider: 'openrouter',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.Streaming, ModelCapability.ImageUnderstanding],
    contextWindow: 200_000,
    maxOutputTokens: 16_000,
    pricing: { inputPerMillion: 3, outputPerMillion: 15 },
    latencyClass: 'fast',
    qualityScore: 0.92,
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o (via OpenRouter)',
    provider: 'openrouter',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.Streaming, ModelCapability.ImageUnderstanding],
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
    latencyClass: 'fast',
    qualityScore: 0.92,
  },
  {
    id: 'google/gemini-2.0-flash-exp:free',
    name: 'Gemini 2.0 Flash (free)',
    provider: 'openrouter',
    capabilities: [ModelCapability.Chat, ModelCapability.Streaming],
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 0, outputPerMillion: 0 },
    latencyClass: 'ultra_fast',
    qualityScore: 0.80,
  },
];

export class OpenRouterProvider extends BaseProvider {
  private client!: OpenAI;
  private _cachedModels: IModelInfo[] = [...OPENROUTER_STATIC_MODELS];

  get name(): string { return 'openrouter'; }

  override async initialize(config: IProviderConfig): Promise<void> {
    await super.initialize(config);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? 'https://openrouter.ai/api/v1',
      timeout: config.timeout ?? 90_000,
      maxRetries: 0,
      defaultHeaders: {
        'HTTP-Referer': config.metadata?.siteUrl as string ?? 'https://iliagpt.ia',
        'X-Title': config.metadata?.siteTitle as string ?? 'IliaGPT',
        ...config.headers,
      },
    });
  }

  protected async _chat(request: IChatRequest): Promise<IChatResponse> {
    const model = request.model ?? this.config.defaultModel ?? 'openai/gpt-4o-mini';
    try {
      const res = await this.client.chat.completions.create({
        model, messages: request.messages as OpenAI.ChatCompletionMessageParam[],
        temperature: request.temperature, max_tokens: request.maxTokens,
        stream: false,
      });
      const choice = res.choices[0];
      const usage = this.buildUsage(res.usage!.prompt_tokens, res.usage!.completion_tokens);
      return {
        id: res.id, content: choice.message.content ?? '',
        role: MessageRole.Assistant, model: res.model, provider: this.name, usage,
        finishReason: this.normalizeFinishReason(choice.finish_reason), latencyMs: 0,
        cost: (res as any).usage?.cost ?? undefined,
      };
    } catch (err: any) { throw this._mapError(err); }
  }

  protected async *_stream(request: IChatRequest): AsyncGenerator<IStreamChunk> {
    const model = request.model ?? this.config.defaultModel ?? 'openai/gpt-4o-mini';
    const id = this.generateId('openrouter');
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
    throw new ProviderError('OpenRouter does not support embeddings directly', this.name, 'NOT_SUPPORTED', false);
  }

  async listModels(): Promise<IModelInfo[]> {
    try {
      const res = await this.client.models.list();
      this._cachedModels = res.data.map((m) => ({
        id: m.id,
        name: (m as any).name ?? m.id,
        provider: 'openrouter',
        capabilities: [ModelCapability.Chat, ModelCapability.Streaming],
        contextWindow: (m as any).context_length ?? 128_000,
        maxOutputTokens: 4_096,
        pricing: {
          inputPerMillion: parseFloat((m as any).pricing?.prompt ?? '0') * 1_000_000,
          outputPerMillion: parseFloat((m as any).pricing?.completion ?? '0') * 1_000_000,
        },
        latencyClass: 'medium' as const,
        qualityScore: 0.80,
      }));
      return this._cachedModels;
    } catch {
      return this._cachedModels;
    }
  }

  async healthCheck(): Promise<boolean> {
    try { await this.client.models.list(); return true; } catch { return false; }
  }

  private _mapError(err: any): Error {
    if (err instanceof ProviderError) return err;
    const s = err.status ?? err.statusCode;
    if (s === 401) return new AuthenticationError(this.name);
    if (s === 429) return new RateLimitError(this.name);
    return new ProviderError(err.message ?? 'OpenRouter error', this.name, 'OPENROUTER_ERROR', s >= 500);
  }
}
