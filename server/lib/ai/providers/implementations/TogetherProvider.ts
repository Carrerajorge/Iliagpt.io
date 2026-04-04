/**
 * Together AI Provider — OpenAI-compatible API
 * Hosts hundreds of open-source models (Llama, Mistral, Qwen, etc.)
 */

import OpenAI from 'openai';
import {
  IProviderConfig, IChatRequest, IChatResponse, IStreamChunk,
  IEmbedRequest, IEmbedResponse, IModelInfo, ModelCapability,
  MessageRole, ProviderError, AuthenticationError, RateLimitError,
} from '../core/types';
import { BaseProvider } from '../core/BaseProvider';

const TOGETHER_MODELS: IModelInfo[] = [
  {
    id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    name: 'Llama 3.3 70B Instruct Turbo',
    provider: 'together',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.Streaming, ModelCapability.CodeGeneration],
    contextWindow: 131_072,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 0.88, outputPerMillion: 0.88 },
    latencyClass: 'fast',
    qualityScore: 0.85,
  },
  {
    id: 'Qwen/Qwen2.5-72B-Instruct-Turbo',
    name: 'Qwen 2.5 72B Instruct',
    provider: 'together',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.Streaming, ModelCapability.CodeGeneration],
    contextWindow: 32_768,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 1.2, outputPerMillion: 1.2 },
    latencyClass: 'fast',
    qualityScore: 0.84,
  },
  {
    id: 'togethercomputer/m2-bert-80M-8k-retrieval',
    name: 'M2 BERT Embeddings',
    provider: 'together',
    capabilities: [ModelCapability.Embedding],
    contextWindow: 8_192,
    maxOutputTokens: 0,
    pricing: { inputPerMillion: 0.008, outputPerMillion: 0 },
    latencyClass: 'ultra_fast',
    qualityScore: 0.70,
  },
];

export class TogetherProvider extends BaseProvider {
  private client!: OpenAI;

  get name(): string { return 'together'; }

  override async initialize(config: IProviderConfig): Promise<void> {
    await super.initialize(config);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? 'https://api.together.xyz/v1',
      timeout: config.timeout ?? 60_000,
      maxRetries: 0,
    });
  }

  protected async _chat(request: IChatRequest): Promise<IChatResponse> {
    const model = request.model ?? this.config.defaultModel ?? 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
    try {
      const res = await this.client.chat.completions.create({
        model, messages: request.messages as OpenAI.ChatCompletionMessageParam[],
        temperature: request.temperature, max_tokens: request.maxTokens, stream: false,
      });
      const choice = res.choices[0];
      const usage = this.buildUsage(res.usage!.prompt_tokens, res.usage!.completion_tokens);
      const modelInfo = TOGETHER_MODELS.find((m) => m.id === model);
      return {
        id: res.id, content: choice.message.content ?? '',
        role: MessageRole.Assistant, model: res.model, provider: this.name, usage,
        finishReason: this.normalizeFinishReason(choice.finish_reason), latencyMs: 0,
        cost: modelInfo ? this.calculateCost(usage, modelInfo.pricing) : undefined,
      };
    } catch (err: any) { throw this._mapError(err); }
  }

  protected async *_stream(request: IChatRequest): AsyncGenerator<IStreamChunk> {
    const model = request.model ?? this.config.defaultModel ?? 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
    const id = this.generateId('together');
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
    const model = request.model ?? 'togethercomputer/m2-bert-80M-8k-retrieval';
    try {
      const res = await this.client.embeddings.create({ model, input: request.input });
      return {
        embeddings: res.data.map((d) => d.embedding), model: res.model, provider: this.name,
        usage: { promptTokens: res.usage.prompt_tokens, totalTokens: res.usage.total_tokens },
      };
    } catch (err: any) { throw this._mapError(err); }
  }

  async listModels(): Promise<IModelInfo[]> { return TOGETHER_MODELS; }

  async healthCheck(): Promise<boolean> {
    try { await this.client.models.list(); return true; } catch { return false; }
  }

  private _mapError(err: any): Error {
    if (err instanceof ProviderError) return err;
    const s = err.status ?? err.statusCode;
    if (s === 401) return new AuthenticationError(this.name);
    if (s === 429) return new RateLimitError(this.name);
    return new ProviderError(err.message ?? 'Together error', this.name, 'TOGETHER_ERROR', s >= 500);
  }
}
