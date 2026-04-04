/**
 * Azure OpenAI Provider
 *
 * Uses the `openai` SDK's AzureOpenAI client.  Azure differs from OpenAI in:
 *
 *  1. Models are referenced by DEPLOYMENT NAME, not model ID.
 *  2. Authentication is via api-key header (or Azure Entra bearer token).
 *  3. Endpoint is per-resource: https://{resourceName}.openai.azure.com/
 *  4. API version must be pinned (e.g. "2024-12-01-preview").
 *  5. Embeddings and chat live under the same deployment-based path.
 *  6. Some features lag behind OpenAI by 1-2 API versions.
 *
 * Config notes:
 *   baseUrl     = full Azure endpoint, e.g. https://myresource.openai.azure.com
 *   extra.apiVersion   = Azure API version string (default: 2024-12-01-preview)
 *   extra.deployments  = map of logical name → Azure deployment name
 */

import { AzureOpenAI } from 'openai';
import { BaseProvider } from './core/BaseProvider';
import { Logger } from '../../logger';
import {
  type IProviderConfig,
  type IChatMessage,
  type IChatOptions,
  type IChatResponse,
  type IStreamChunk,
  type StreamHandler,
  type IEmbedOptions,
  type IEmbedResponse,
  type IModelInfo,
  type ITokenUsage,
  ModelCapability,
  ProviderStatus,
  classifyProviderError,
  ProviderError,
} from './core/types';

// ─── Default config ──────────────────────────────────────────────────────────

export function azureDefaultConfig(opts?: {
  apiKey?        : string;
  endpoint?      : string;
  apiVersion?    : string;
  defaultDeploy? : string;
}): IProviderConfig {
  return {
    name        : 'azure-openai',
    displayName : 'Azure OpenAI',
    apiKey      : opts?.apiKey   ?? process.env.AZURE_OPENAI_API_KEY,
    baseUrl     : opts?.endpoint ?? process.env.AZURE_OPENAI_ENDPOINT ?? '',
    defaultModel: opts?.defaultDeploy ?? process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o',
    timeoutMs   : 120_000,
    retry: {
      maxRetries       : 3,
      baseDelayMs      : 500,
      backoffFactor    : 2,
      maxDelayMs       : 16_000,
      retryableStatuses: [429, 500, 502, 503],
    },
    rateLimit: {
      requestsPerMinute: 300,
      tokensPerMinute  : 500_000,
      maxConcurrent    : 30,
    },
    extra: {
      apiVersion  : opts?.apiVersion ?? process.env.AZURE_OPENAI_API_VERSION ?? '2024-12-01-preview',
      capabilities:
        ModelCapability.CHAT | ModelCapability.STREAMING |
        ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE |
        ModelCapability.VISION | ModelCapability.EMBEDDING | ModelCapability.CODE,
      /**
       * Optional deployment name map.  Keys are logical model names used by
       * callers; values are actual Azure deployment names.
       * e.g. { 'gpt-4o': 'my-gpt4o-deployment', 'text-embedding-3-large': 'my-embed-deploy' }
       */
      deployments: {} as Record<string, string>,
    },
  };
}

// ─── Static model catalogue (deployment-agnostic) ────────────────────────────

const AZURE_MODELS: IModelInfo[] = [
  {
    id: 'gpt-4o', provider: 'azure-openai', displayName: 'GPT-4o (Azure)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.VISION | ModelCapability.CODE,
    contextWindow: 128_000, maxOutputTokens: 16_384,
    pricing: { inputPer1M: 5.0, outputPer1M: 15.0 },
    latencyScore: 25, reliabilityScore: 0.999, available: true,
    tags: ['enterprise', 'vision', 'sla'],
  },
  {
    id: 'gpt-4o-mini', provider: 'azure-openai', displayName: 'GPT-4o mini (Azure)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.VISION,
    contextWindow: 128_000, maxOutputTokens: 16_384,
    pricing: { inputPer1M: 0.165, outputPer1M: 0.66 },
    latencyScore: 10, reliabilityScore: 0.999, available: true,
    tags: ['enterprise', 'fast', 'cheap'],
  },
  {
    id: 'gpt-4-turbo', provider: 'azure-openai', displayName: 'GPT-4 Turbo (Azure)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.VISION,
    contextWindow: 128_000, maxOutputTokens: 4_096,
    pricing: { inputPer1M: 10.0, outputPer1M: 30.0 },
    latencyScore: 30, reliabilityScore: 0.999, available: true,
    tags: ['enterprise'],
  },
  {
    id: 'text-embedding-3-large', provider: 'azure-openai', displayName: 'text-embedding-3-large (Azure)',
    capabilities: ModelCapability.EMBEDDING,
    contextWindow: 8_191,
    pricing: { inputPer1M: 0.13, outputPer1M: 0, embedPer1M: 0.13 },
    latencyScore: 5, reliabilityScore: 0.999, available: true,
    tags: ['embedding', 'enterprise'],
  },
  {
    id: 'text-embedding-3-small', provider: 'azure-openai', displayName: 'text-embedding-3-small (Azure)',
    capabilities: ModelCapability.EMBEDDING,
    contextWindow: 8_191,
    pricing: { inputPer1M: 0.02, outputPer1M: 0, embedPer1M: 0.02 },
    latencyScore: 3, reliabilityScore: 0.999, available: true,
    tags: ['embedding', 'enterprise', 'cheap'],
  },
];

// ─── Provider ────────────────────────────────────────────────────────────────

export class AzureOpenAIProvider extends BaseProvider {
  private readonly _client: AzureOpenAI;

  constructor(config: Partial<IProviderConfig> = {}) {
    const defaults = azureDefaultConfig({ apiKey: config.apiKey });
    super({ ...defaults, ...config });

    const extra = this.config.extra as any;

    this._client = new AzureOpenAI({
      apiKey     : this.config.apiKey,
      endpoint   : this.config.baseUrl,
      apiVersion : extra?.apiVersion ?? '2024-12-01-preview',
      maxRetries : 0,
      timeout    : this.config.timeoutMs,
    });

    this.status = ProviderStatus.ACTIVE;
  }

  // ─── Deployment resolution ──────────────────────────────────────────────────

  /**
   * Map a logical model name to an Azure deployment name.
   * Falls back to using the model name directly as the deployment name.
   */
  private resolveDeployment(model: string): string {
    const deployments = (this.config.extra as any)?.deployments as Record<string, string> | undefined;
    return deployments?.[model] ?? model;
  }

  // ─── Message mapping (reuses OpenAI message types) ──────────────────────────

  private toSDKMessages(messages: IChatMessage[]): any[] {
    return messages.map(m => {
      if (typeof m.content === 'string') {
        return { role: m.role, content: m.content, ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}), ...(m.toolCalls ? { tool_calls: m.toolCalls } : {}) };
      }
      const parts = (m.content as any[]).map(p => {
        if (p.type === 'text')      return { type: 'text', text: p.text };
        if (p.type === 'image_url') return { type: 'image_url', image_url: p.image_url };
        return { type: 'text', text: '[content]' };
      });
      return { role: m.role, content: parts };
    });
  }

  // ─── _chat ──────────────────────────────────────────────────────────────────

  protected async _chat(messages: IChatMessage[], options: IChatOptions): Promise<IChatResponse> {
    const requestId  = options.requestId ?? this._newRequestId();
    const start      = Date.now();
    const deployment = this.resolveDeployment(options.model ?? this.config.defaultModel);

    try {
      const response = await this._client.chat.completions.create({
        model      : deployment,
        messages   : this.toSDKMessages(messages) as any,
        temperature: options.temperature,
        top_p      : options.topP,
        max_tokens : options.maxTokens,
        stop       : options.stop as any,
        tools      : options.tools?.map(t => ({ type: 'function' as const, function: { ...t.function, parameters: t.function.parameters as any } })),
        tool_choice: options.toolChoice as any,
        response_format: options.jsonMode ? { type: 'json_object' as const } : undefined,
        stream     : false,
      });

      const choice = response.choices[0];
      const usage  = response.usage!;

      return {
        content     : choice.message.content ?? '',
        model       : deployment,
        provider    : this.name,
        usage: {
          promptTokens    : usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens     : usage.total_tokens,
          cachedTokens    : (usage as any).prompt_tokens_details?.cached_tokens,
        },
        finishReason: (choice.finish_reason as IChatResponse['finishReason']) ?? 'unknown',
        latencyMs   : Date.now() - start,
        requestId,
        cached      : false,
        fromFallback: false,
        toolCalls   : choice.message.tool_calls?.map(tc => ({
          id      : tc.id,
          type    : 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
        raw: response,
      };
    } catch (err) {
      throw classifyProviderError(err, this.name, requestId);
    }
  }

  // ─── _stream ────────────────────────────────────────────────────────────────

  protected async _stream(
    messages: IChatMessage[],
    onChunk : StreamHandler,
    options : IChatOptions,
  ): Promise<IChatResponse> {
    const requestId   = options.requestId ?? this._newRequestId();
    const start       = Date.now();
    const deployment  = this.resolveDeployment(options.model ?? this.config.defaultModel);
    let   accumulated = '';
    let   finishReason: IChatResponse['finishReason'] = 'unknown';
    let   finalUsage  : ITokenUsage | undefined;

    try {
      const stream = await this._client.chat.completions.create({
        model         : deployment,
        messages      : this.toSDKMessages(messages) as any,
        temperature   : options.temperature,
        max_tokens    : options.maxTokens,
        stream        : true,
        stream_options: { include_usage: true },
      });

      for await (const chunk of stream as any) {
        if ((chunk as any).usage) {
          const u = (chunk as any).usage;
          finalUsage = { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens, totalTokens: u.total_tokens };
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason as IChatResponse['finishReason'];
        const token = choice.delta?.content ?? '';
        if (token) {
          accumulated += token;
          await onChunk({ delta: token, accumulated, done: false, requestId });
        }
      }

      const usage = finalUsage ?? {
        promptTokens    : this.countMessagesTokens(messages),
        completionTokens: this.countTokens(accumulated),
        totalTokens     : this.countMessagesTokens(messages) + this.countTokens(accumulated),
      };
      await onChunk({ delta: '', accumulated, done: true, usage, finishReason, requestId });
      return { content: accumulated, model: deployment, provider: this.name, usage, finishReason, latencyMs: Date.now() - start, requestId, cached: false, fromFallback: false };
    } catch (err) {
      throw classifyProviderError(err, this.name, requestId);
    }
  }

  // ─── _embed ─────────────────────────────────────────────────────────────────

  protected async _embed(texts: string[], options: IEmbedOptions): Promise<IEmbedResponse> {
    const requestId  = options.requestId ?? this._newRequestId();
    const start      = Date.now();
    const deployment = this.resolveDeployment(options.model ?? 'text-embedding-3-small');

    try {
      const response = await this._client.embeddings.create({
        model     : deployment,
        input     : texts,
        dimensions: options.dimensions,
      });
      const sorted     = [...response.data].sort((a, b) => a.index - b.index);
      return {
        embeddings: sorted.map(d => d.embedding),
        model     : deployment,
        provider  : this.name,
        usage     : { promptTokens: response.usage.prompt_tokens, totalTokens: response.usage.total_tokens },
        latencyMs : Date.now() - start,
        requestId,
      };
    } catch (err) {
      throw classifyProviderError(err, this.name, requestId);
    }
  }

  protected async _listModels(): Promise<IModelInfo[]> {
    return AZURE_MODELS;
  }

  protected async _healthProbe(): Promise<void> {
    const deployment = this.resolveDeployment(this.config.defaultModel);
    await this._client.chat.completions.create({
      model    : deployment,
      messages : [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream   : false,
    });
  }
}
