/**
 * Groq Provider — OpenAI-compatible, ultra-fast inference
 * Models: llama-3.3-70b, llama-3.1-8b, mixtral-8x7b, gemma2-9b
 */

import OpenAI from 'openai';
import {
  IProviderConfig, IChatRequest, IChatResponse, IStreamChunk,
  IEmbedRequest, IEmbedResponse, IModelInfo, ModelCapability,
  MessageRole, ProviderError, AuthenticationError, RateLimitError,
} from '../core/types';
import { BaseProvider } from '../core/BaseProvider';

const GROQ_MODELS: IModelInfo[] = [
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B',
    provider: 'groq',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.Streaming, ModelCapability.JsonMode, ModelCapability.CodeGeneration],
    contextWindow: 128_000,
    maxOutputTokens: 32_768,
    pricing: { inputPerMillion: 0.59, outputPerMillion: 0.79 },
    latencyClass: 'ultra_fast',
    qualityScore: 0.85,
  },
  {
    id: 'llama-3.1-8b-instant',
    name: 'Llama 3.1 8B Instant',
    provider: 'groq',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.Streaming, ModelCapability.JsonMode],
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 0.05, outputPerMillion: 0.08 },
    latencyClass: 'ultra_fast',
    qualityScore: 0.70,
  },
  {
    id: 'mixtral-8x7b-32768',
    name: 'Mixtral 8x7B',
    provider: 'groq',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.Streaming, ModelCapability.JsonMode],
    contextWindow: 32_768,
    maxOutputTokens: 4_096,
    pricing: { inputPerMillion: 0.24, outputPerMillion: 0.24 },
    latencyClass: 'ultra_fast',
    qualityScore: 0.76,
  },
  {
    id: 'gemma2-9b-it',
    name: 'Gemma 2 9B',
    provider: 'groq',
    capabilities: [ModelCapability.Chat, ModelCapability.Streaming],
    contextWindow: 8_192,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 0.2, outputPerMillion: 0.2 },
    latencyClass: 'ultra_fast',
    qualityScore: 0.72,
  },
];

export class GroqProvider extends BaseProvider {
  private client!: OpenAI;

  get name(): string { return 'groq'; }

  override async initialize(config: IProviderConfig): Promise<void> {
    await super.initialize(config);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? 'https://api.groq.com/openai/v1',
      timeout: config.timeout ?? 30_000,
      maxRetries: 0,
    });
  }

  protected async _chat(request: IChatRequest): Promise<IChatResponse> {
    const model = request.model ?? this.config.defaultModel ?? 'llama-3.1-8b-instant';
    try {
      const res = await this.client.chat.completions.create({
        model,
        messages: request.messages as OpenAI.ChatCompletionMessageParam[],
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        top_p: request.topP,
        stop: request.stop,
        stream: false,
        response_format: request.responseFormat as any,
      });
      const choice = res.choices[0];
      const usage = this.buildUsage(res.usage!.prompt_tokens, res.usage!.completion_tokens);
      const modelInfo = GROQ_MODELS.find((m) => m.id === model);
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
    const model = request.model ?? this.config.defaultModel ?? 'llama-3.1-8b-instant';
    const id = this.generateId('groq');
    try {
      const stream = await this.client.chat.completions.create({
        model, messages: request.messages as any, stream: true,
        stream_options: { include_usage: true },
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield { type: 'delta', id, model, provider: this.name, delta, finishReason: null };
        if (chunk.usage) {
          yield { type: 'usage', id, model, provider: this.name, usage: this.buildUsage(chunk.usage.prompt_tokens, chunk.usage.completion_tokens), finishReason: 'stop' };
        }
        const fr = chunk.choices[0]?.finish_reason;
        if (fr) yield { type: 'done', id, model, provider: this.name, finishReason: this.normalizeFinishReason(fr) };
      }
    } catch (err: any) {
      yield { type: 'error', id, model, provider: this.name, error: err.message, finishReason: null };
      throw this._mapError(err);
    }
  }

  protected async _embed(_req: IEmbedRequest): Promise<IEmbedResponse> {
    throw new ProviderError('Groq does not support embeddings', this.name, 'NOT_SUPPORTED', false);
  }

  async listModels(): Promise<IModelInfo[]> { return GROQ_MODELS; }

  async healthCheck(): Promise<boolean> {
    try { await this.client.models.list(); return true; } catch { return false; }
  }

  private _mapError(err: any): Error {
    if (err instanceof ProviderError) return err;
    const s = err.status ?? err.statusCode;
    if (s === 401) return new AuthenticationError(this.name);
    if (s === 429) return new RateLimitError(this.name);
    return new ProviderError(err.message ?? 'Groq error', this.name, 'GROQ_ERROR', s >= 500);
  }
}
