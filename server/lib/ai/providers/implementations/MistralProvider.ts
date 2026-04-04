/**
 * Mistral AI Provider — OpenAI-compatible REST
 * Models: mistral-large, mistral-small, codestral, mistral-embed
 */

import OpenAI from 'openai';
import {
  IProviderConfig, IChatRequest, IChatResponse, IStreamChunk,
  IEmbedRequest, IEmbedResponse, IModelInfo, ModelCapability,
  MessageRole, ProviderError, AuthenticationError, RateLimitError,
} from '../core/types';
import { BaseProvider } from '../core/BaseProvider';

const MISTRAL_MODELS: IModelInfo[] = [
  {
    id: 'mistral-large-latest',
    name: 'Mistral Large',
    provider: 'mistral',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.Streaming, ModelCapability.JsonMode, ModelCapability.CodeGeneration],
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 2, outputPerMillion: 6 },
    latencyClass: 'fast',
    qualityScore: 0.87,
  },
  {
    id: 'mistral-small-latest',
    name: 'Mistral Small',
    provider: 'mistral',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.Streaming, ModelCapability.JsonMode],
    contextWindow: 32_768,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 0.1, outputPerMillion: 0.3 },
    latencyClass: 'ultra_fast',
    qualityScore: 0.74,
  },
  {
    id: 'codestral-latest',
    name: 'Codestral',
    provider: 'mistral',
    capabilities: [ModelCapability.Chat, ModelCapability.CodeGeneration, ModelCapability.Streaming],
    contextWindow: 256_000,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 0.2, outputPerMillion: 0.6 },
    latencyClass: 'fast',
    qualityScore: 0.85,
  },
  {
    id: 'mistral-embed',
    name: 'Mistral Embed',
    provider: 'mistral',
    capabilities: [ModelCapability.Embedding],
    contextWindow: 8_192,
    maxOutputTokens: 0,
    pricing: { inputPerMillion: 0.1, outputPerMillion: 0 },
    latencyClass: 'ultra_fast',
    qualityScore: 0.76,
  },
];

export class MistralProvider extends BaseProvider {
  private client!: OpenAI;

  get name(): string { return 'mistral'; }

  override async initialize(config: IProviderConfig): Promise<void> {
    await super.initialize(config);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? 'https://api.mistral.ai/v1',
      timeout: config.timeout ?? 60_000,
      maxRetries: 0,
    });
  }

  protected async _chat(request: IChatRequest): Promise<IChatResponse> {
    const model = request.model ?? this.config.defaultModel ?? 'mistral-small-latest';
    try {
      const res = await this.client.chat.completions.create({
        model,
        messages: request.messages as OpenAI.ChatCompletionMessageParam[],
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        top_p: request.topP,
        stream: false,
        response_format: request.responseFormat as any,
      });
      const choice = res.choices[0];
      const usage = this.buildUsage(res.usage!.prompt_tokens, res.usage!.completion_tokens);
      const modelInfo = MISTRAL_MODELS.find((m) => m.id === model);
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
    const model = request.model ?? this.config.defaultModel ?? 'mistral-small-latest';
    const id = this.generateId('mistral');
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
    const model = request.model ?? 'mistral-embed';
    try {
      const res = await this.client.embeddings.create({ model, input: request.input });
      return {
        embeddings: res.data.map((d) => d.embedding),
        model: res.model, provider: this.name,
        usage: { promptTokens: res.usage.prompt_tokens, totalTokens: res.usage.total_tokens },
      };
    } catch (err: any) { throw this._mapError(err); }
  }

  async listModels(): Promise<IModelInfo[]> { return MISTRAL_MODELS; }

  async healthCheck(): Promise<boolean> {
    try { await this.client.models.list(); return true; } catch { return false; }
  }

  private _mapError(err: any): Error {
    if (err instanceof ProviderError) return err;
    const s = err.status ?? err.statusCode;
    if (s === 401) return new AuthenticationError(this.name);
    if (s === 429) return new RateLimitError(this.name);
    return new ProviderError(err.message ?? 'Mistral error', this.name, 'MISTRAL_ERROR', s >= 500);
  }
}
