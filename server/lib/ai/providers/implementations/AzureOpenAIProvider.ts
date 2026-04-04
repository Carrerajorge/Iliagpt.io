/**
 * Azure OpenAI Provider
 * Uses the AzureOpenAI client from the openai package.
 * Config requires: apiKey, baseUrl (endpoint), and deployment names as model IDs.
 */

import OpenAI, { AzureOpenAI } from 'openai';
import {
  IProviderConfig, IChatRequest, IChatResponse, IStreamChunk,
  IEmbedRequest, IEmbedResponse, IModelInfo, ModelCapability,
  MessageRole, ProviderError, AuthenticationError, RateLimitError,
} from '../core/types';
import { BaseProvider } from '../core/BaseProvider';

// Azure deployments use custom names; these are defaults
const AZURE_DEFAULT_MODELS: IModelInfo[] = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o (Azure)',
    provider: 'azure',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.Streaming, ModelCapability.ImageUnderstanding, ModelCapability.JsonMode, ModelCapability.CodeGeneration],
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
    latencyClass: 'fast',
    qualityScore: 0.92,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini (Azure)',
    provider: 'azure',
    capabilities: [ModelCapability.Chat, ModelCapability.FunctionCalling, ModelCapability.Streaming, ModelCapability.JsonMode],
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    pricing: { inputPerMillion: 0.165, outputPerMillion: 0.66 },
    latencyClass: 'ultra_fast',
    qualityScore: 0.78,
  },
  {
    id: 'text-embedding-3-large',
    name: 'Text Embedding 3 Large (Azure)',
    provider: 'azure',
    capabilities: [ModelCapability.Embedding],
    contextWindow: 8_191,
    maxOutputTokens: 0,
    pricing: { inputPerMillion: 0.13, outputPerMillion: 0 },
    latencyClass: 'fast',
    qualityScore: 0.88,
  },
];

export interface AzureProviderConfig extends IProviderConfig {
  apiVersion?: string;  // e.g. '2025-01-01-preview'
  deployments?: Record<string, string>; // model alias -> deployment name
}

export class AzureOpenAIProvider extends BaseProvider {
  private client!: AzureOpenAI;
  private _deployments: Record<string, string> = {};

  get name(): string { return 'azure'; }

  override async initialize(config: AzureProviderConfig): Promise<void> {
    await super.initialize(config);
    this._deployments = config.deployments ?? {};
    this.client = new AzureOpenAI({
      apiKey: config.apiKey,
      endpoint: config.baseUrl,
      apiVersion: config.apiVersion ?? '2025-01-01-preview',
      timeout: config.timeout ?? 60_000,
      maxRetries: 0,
      defaultHeaders: config.headers,
    });
  }

  private _resolveDeployment(model: string): string {
    return this._deployments[model] ?? model;
  }

  protected async _chat(request: IChatRequest): Promise<IChatResponse> {
    const model = request.model ?? this.config.defaultModel ?? 'gpt-4o-mini';
    const deployment = this._resolveDeployment(model);
    try {
      const res = await this.client.chat.completions.create({
        model: deployment,
        messages: request.messages as OpenAI.ChatCompletionMessageParam[],
        temperature: request.temperature,
        max_completion_tokens: request.maxTokens,
        top_p: request.topP,
        frequency_penalty: request.frequencyPenalty,
        presence_penalty: request.presencePenalty,
        stop: request.stop,
        tools: request.tools as OpenAI.ChatCompletionTool[] | undefined,
        response_format: request.responseFormat as OpenAI.ResponseFormatJSONObject | undefined,
        stream: false,
      });
      const choice = res.choices[0];
      const usage = this.buildUsage(res.usage!.prompt_tokens, res.usage!.completion_tokens, {
        cachedTokens: (res.usage as any).prompt_tokens_details?.cached_tokens,
      });
      const modelInfo = AZURE_DEFAULT_MODELS.find((m) => m.id === model);
      return {
        id: res.id, content: choice.message.content ?? '',
        role: MessageRole.Assistant, model, provider: this.name, usage,
        finishReason: this.normalizeFinishReason(choice.finish_reason), latencyMs: 0,
        cost: modelInfo ? this.calculateCost(usage, modelInfo.pricing) : undefined,
      };
    } catch (err: any) { throw this._mapError(err); }
  }

  protected async *_stream(request: IChatRequest): AsyncGenerator<IStreamChunk> {
    const model = request.model ?? this.config.defaultModel ?? 'gpt-4o-mini';
    const deployment = this._resolveDeployment(model);
    const id = this.generateId('azure');
    try {
      const stream = await this.client.chat.completions.create({
        model: deployment, messages: request.messages as any, stream: true,
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

  protected async _embed(request: IEmbedRequest): Promise<IEmbedResponse> {
    const model = request.model ?? 'text-embedding-3-large';
    const deployment = this._resolveDeployment(model);
    try {
      const res = await this.client.embeddings.create({
        model: deployment, input: request.input, dimensions: request.dimensions,
      });
      return {
        embeddings: res.data.map((d) => d.embedding), model, provider: this.name,
        usage: { promptTokens: res.usage.prompt_tokens, totalTokens: res.usage.total_tokens },
      };
    } catch (err: any) { throw this._mapError(err); }
  }

  async listModels(): Promise<IModelInfo[]> { return AZURE_DEFAULT_MODELS; }

  async healthCheck(): Promise<boolean> {
    try { await this.client.models.list(); return true; } catch { return false; }
  }

  private _mapError(err: any): Error {
    if (err instanceof ProviderError) return err;
    const s = err.status ?? err.statusCode;
    if (s === 401) return new AuthenticationError(this.name);
    if (s === 429) return new RateLimitError(this.name, err.headers?.['retry-after-ms'] ? parseInt(err.headers['retry-after-ms']) : undefined);
    return new ProviderError(err.message ?? 'Azure OpenAI error', this.name, 'AZURE_ERROR', s >= 500);
  }
}
