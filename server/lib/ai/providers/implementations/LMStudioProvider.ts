/**
 * LM Studio Provider — Local OpenAI-compatible server
 * GUI app for running local models. Default port: 1234.
 */

import OpenAI from 'openai';
import {
  IProviderConfig, IChatRequest, IChatResponse, IStreamChunk,
  IEmbedRequest, IEmbedResponse, IModelInfo, ModelCapability,
  MessageRole, ProviderError,
} from '../core/types';
import { BaseProvider } from '../core/BaseProvider';

export class LMStudioProvider extends BaseProvider {
  private client!: OpenAI;

  get name(): string { return 'lmstudio'; }

  override async initialize(config: IProviderConfig): Promise<void> {
    await super.initialize(config);
    this.client = new OpenAI({
      apiKey: 'lm-studio',
      baseURL: config.baseUrl ?? 'http://localhost:1234/v1',
      timeout: config.timeout ?? 120_000,
      maxRetries: 0,
    });
  }

  protected async _chat(request: IChatRequest): Promise<IChatResponse> {
    const model = request.model ?? this.config.defaultModel ?? '';
    try {
      const res = await this.client.chat.completions.create({
        model, messages: request.messages as OpenAI.ChatCompletionMessageParam[],
        temperature: request.temperature, max_tokens: request.maxTokens,
        stream: false,
      });
      const choice = res.choices[0];
      const usage = this.buildUsage(res.usage?.prompt_tokens ?? 0, res.usage?.completion_tokens ?? 0);
      return {
        id: res.id ?? this.generateId('lmstudio'),
        content: choice.message.content ?? '',
        role: MessageRole.Assistant, model: res.model, provider: this.name, usage,
        finishReason: this.normalizeFinishReason(choice.finish_reason),
        latencyMs: 0,
      };
    } catch (err: any) { throw this._mapError(err); }
  }

  protected async *_stream(request: IChatRequest): AsyncGenerator<IStreamChunk> {
    const model = request.model ?? this.config.defaultModel ?? '';
    const id = this.generateId('lmstudio');
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

  protected async _embed(request: IEmbedRequest): Promise<IEmbedResponse> {
    const model = request.model ?? '';
    try {
      const res = await this.client.embeddings.create({ model, input: request.input });
      return {
        embeddings: res.data.map((d) => d.embedding), model: res.model, provider: this.name,
        usage: { promptTokens: res.usage.prompt_tokens, totalTokens: res.usage.total_tokens },
      };
    } catch (err: any) { throw this._mapError(err); }
  }

  async listModels(): Promise<IModelInfo[]> {
    try {
      const res = await this.client.models.list();
      return res.data.map((m) => ({
        id: m.id,
        name: m.id,
        provider: 'lmstudio',
        capabilities: [ModelCapability.Chat, ModelCapability.Streaming, ModelCapability.Embedding],
        contextWindow: 32_768,
        maxOutputTokens: 4_096,
        pricing: { inputPerMillion: 0, outputPerMillion: 0 },
        latencyClass: 'medium' as const,
        qualityScore: 0.70,
      }));
    } catch { return []; }
  }

  async healthCheck(): Promise<boolean> {
    try { await this.client.models.list(); return true; } catch { return false; }
  }

  private _mapError(err: any): Error {
    if (err instanceof ProviderError) return err;
    const isConnectionRefused = err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED';
    if (isConnectionRefused) {
      return new ProviderError('LM Studio server is not running. Start it from the LM Studio app.', this.name, 'LMSTUDIO_NOT_RUNNING', false);
    }
    return new ProviderError(err.message ?? 'LM Studio error', this.name, 'LMSTUDIO_ERROR', true);
  }
}
