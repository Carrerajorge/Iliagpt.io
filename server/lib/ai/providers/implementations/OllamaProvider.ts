/**
 * Ollama Provider — Local model inference, OpenAI-compatible API
 * Runs models locally on CPU/GPU. No API key required.
 */

import OpenAI from 'openai';
import {
  IProviderConfig, IChatRequest, IChatResponse, IStreamChunk,
  IEmbedRequest, IEmbedResponse, IModelInfo, ModelCapability,
  MessageRole, ProviderError,
} from '../core/types';
import { BaseProvider } from '../core/BaseProvider';

export class OllamaProvider extends BaseProvider {
  private client!: OpenAI;
  private _baseUrl = 'http://localhost:11434';

  get name(): string { return 'ollama'; }

  override async initialize(config: IProviderConfig): Promise<void> {
    await super.initialize(config);
    this._baseUrl = config.baseUrl ?? 'http://localhost:11434';
    this.client = new OpenAI({
      apiKey: 'ollama', // required by SDK, not validated by Ollama
      baseURL: `${this._baseUrl}/v1`,
      timeout: config.timeout ?? 120_000, // local models can be slow
      maxRetries: 0,
    });
  }

  protected async _chat(request: IChatRequest): Promise<IChatResponse> {
    const model = request.model ?? this.config.defaultModel ?? 'llama3.2';
    try {
      const res = await this.client.chat.completions.create({
        model, messages: request.messages as OpenAI.ChatCompletionMessageParam[],
        temperature: request.temperature, max_tokens: request.maxTokens,
        stream: false,
      });
      const choice = res.choices[0];
      const usage = this.buildUsage(res.usage?.prompt_tokens ?? 0, res.usage?.completion_tokens ?? 0);
      return {
        id: res.id ?? this.generateId('ollama'),
        content: choice.message.content ?? '',
        role: MessageRole.Assistant, model, provider: this.name, usage,
        finishReason: this.normalizeFinishReason(choice.finish_reason),
        latencyMs: 0,
      };
    } catch (err: any) { throw this._mapError(err); }
  }

  protected async *_stream(request: IChatRequest): AsyncGenerator<IStreamChunk> {
    const model = request.model ?? this.config.defaultModel ?? 'llama3.2';
    const id = this.generateId('ollama');
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
    const model = request.model ?? 'nomic-embed-text';
    const inputs = Array.isArray(request.input) ? request.input : [request.input];

    // Ollama uses a different endpoint for embeddings
    const res = await fetch(`${this._baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: inputs }),
    });

    if (!res.ok) throw new ProviderError(`Ollama embed error: ${res.status}`, this.name, 'OLLAMA_EMBED_ERROR', false);
    const data = await res.json();

    return {
      embeddings: data.embeddings ?? [],
      model, provider: this.name,
      usage: { promptTokens: data.prompt_eval_count ?? 0, totalTokens: data.prompt_eval_count ?? 0 },
    };
  }

  async listModels(): Promise<IModelInfo[]> {
    try {
      const res = await fetch(`${this._baseUrl}/api/tags`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.models ?? []).map((m: any) => ({
        id: m.name,
        name: m.name,
        provider: 'ollama',
        capabilities: [ModelCapability.Chat, ModelCapability.Streaming, ModelCapability.Embedding],
        contextWindow: m.details?.parameter_size ? parseInt(m.details.parameter_size) * 1000 : 128_000,
        maxOutputTokens: 4_096,
        pricing: { inputPerMillion: 0, outputPerMillion: 0 }, // free, local
        latencyClass: 'medium' as const,
        qualityScore: 0.70,
        metadata: { size: m.size, family: m.details?.family },
      }));
    } catch { return []; }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this._baseUrl}/api/tags`);
      return res.ok;
    } catch { return false; }
  }

  private _mapError(err: any): Error {
    if (err instanceof ProviderError) return err;
    const isConnectionRefused = err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED';
    if (isConnectionRefused) {
      return new ProviderError('Ollama is not running. Start with: ollama serve', this.name, 'OLLAMA_NOT_RUNNING', false);
    }
    return new ProviderError(err.message ?? 'Ollama error', this.name, 'OLLAMA_ERROR', true);
  }
}
