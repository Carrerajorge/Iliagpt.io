/**
 * OpenRouter Provider
 *
 * OpenRouter is a unified gateway to 200+ models from multiple providers.
 * API is OpenAI-compatible at https://openrouter.ai/api/v1.
 *
 * Required extra headers (OpenRouter's terms):
 *   HTTP-Referer: your site URL
 *   X-Title: your app name
 *
 * Notable features:
 *  - `transforms` field for automatic prompt compression
 *  - `route` field: "fallback" lets OpenRouter pick the fastest available
 *  - `models` array for specifying ranked fallbacks within one request
 *  - model IDs are namespaced: "openai/gpt-4o", "anthropic/claude-3-5-sonnet"
 *
 * Extends OpenAICompatBase with custom headers override.
 */

import { OpenAICompatBase } from './shared/OpenAICompatBase';
import {
  type IProviderConfig,
  type IEmbedOptions,
  type IEmbedResponse,
  type IModelInfo,
  ModelCapability,
  ProviderStatus,
  ProviderError,
} from './core/types';

export function openRouterDefaultConfig(opts?: {
  apiKey?     : string;
  siteUrl?    : string;
  appName?    : string;
}): IProviderConfig {
  return {
    name        : 'openrouter',
    displayName : 'OpenRouter',
    apiKey      : opts?.apiKey  ?? process.env.OPENROUTER_API_KEY,
    baseUrl     : 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o',
    timeoutMs   : 120_000,
    retry: {
      maxRetries       : 2,
      baseDelayMs      : 500,
      backoffFactor    : 2,
      maxDelayMs       : 10_000,
      retryableStatuses: [429, 500, 502, 503],
    },
    rateLimit: {
      requestsPerMinute: 200,
      tokensPerMinute  : 0,        // unlimited via OpenRouter
      maxConcurrent    : 30,
    },
    extra: {
      siteUrl : opts?.siteUrl ?? process.env.OPENROUTER_SITE_URL ?? 'https://iliagpt.com',
      appName : opts?.appName ?? process.env.OPENROUTER_APP_NAME ?? 'IliaGPT',
      capabilities:
        ModelCapability.CHAT | ModelCapability.STREAMING |
        ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE |
        ModelCapability.VISION | ModelCapability.EMBEDDING |
        ModelCapability.CODE | ModelCapability.REASONING,
    },
  };
}

// A curated subset of popular OpenRouter routes.
const OPENROUTER_MODELS: IModelInfo[] = [
  {
    id: 'openai/gpt-4o', provider: 'openrouter', displayName: 'GPT-4o (via OpenRouter)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.VISION | ModelCapability.CODE,
    contextWindow: 128_000,
    pricing: { inputPer1M: 5.0, outputPer1M: 15.0 },
    latencyScore: 25, reliabilityScore: 0.97, available: true,
    tags: ['openai', 'vision'],
  },
  {
    id: 'anthropic/claude-sonnet-4-6', provider: 'openrouter', displayName: 'Claude Sonnet 4.6 (via OpenRouter)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.VISION | ModelCapability.CODE,
    contextWindow: 200_000,
    pricing: { inputPer1M: 3.0, outputPer1M: 15.0 },
    latencyScore: 28, reliabilityScore: 0.97, available: true,
    tags: ['anthropic', 'vision'],
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct', provider: 'openrouter', displayName: 'Llama 3.3 70B (via OpenRouter)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.CODE,
    contextWindow: 131_072,
    pricing: { inputPer1M: 0.59, outputPer1M: 0.79 },
    latencyScore: 12, reliabilityScore: 0.95, available: true,
    tags: ['open-source', 'llama'],
  },
  {
    id: 'deepseek/deepseek-r1', provider: 'openrouter', displayName: 'DeepSeek R1 (via OpenRouter)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.REASONING | ModelCapability.CODE,
    contextWindow: 64_000,
    pricing: { inputPer1M: 0.55, outputPer1M: 2.19 },
    latencyScore: 35, reliabilityScore: 0.94, available: true,
    tags: ['reasoning', 'deepseek'],
  },
  {
    id: 'google/gemini-2.5-flash', provider: 'openrouter', displayName: 'Gemini 2.5 Flash (via OpenRouter)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.VISION | ModelCapability.CODE,
    contextWindow: 1_000_000,
    pricing: { inputPer1M: 0.075, outputPer1M: 0.30 },
    latencyScore: 10, reliabilityScore: 0.96, available: true,
    tags: ['google', 'fast', 'long-context'],
  },
  {
    id: 'x-ai/grok-4-1-fast', provider: 'openrouter', displayName: 'Grok 4.1 Fast (via OpenRouter)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.CODE,
    contextWindow: 2_000_000,
    pricing: { inputPer1M: 0.50, outputPer1M: 2.00 },
    latencyScore: 15, reliabilityScore: 0.97, available: true,
    tags: ['xai', 'long-context'],
  },
  {
    id: 'moonshotai/kimi-k2.5', provider: 'openrouter', displayName: 'Kimi K2.5 (via OpenRouter)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.VISION | ModelCapability.CODE | ModelCapability.REASONING,
    contextWindow: 131_072,
    pricing: { inputPer1M: 0.60, outputPer1M: 2.40 },
    latencyScore: 20, reliabilityScore: 0.93, available: true,
    tags: ['moonshot', 'reasoning', 'vision', 'code'],
  },
];

export class OpenRouterProvider extends OpenAICompatBase {
  constructor(config: Partial<IProviderConfig> = {}) {
    const defaults = openRouterDefaultConfig({ apiKey: config.apiKey });
    super({ ...defaults, ...config });
    this.status = ProviderStatus.ACTIVE;
  }

  protected staticModels(): IModelInfo[] {
    return OPENROUTER_MODELS;
  }

  /** Inject OpenRouter's required attribution headers. */
  protected buildHeaders(apiKey: string): Record<string, string> {
    const extra = this.config.extra as any;
    return {
      ...super.buildHeaders(apiKey),
      'HTTP-Referer': extra?.siteUrl ?? 'https://iliagpt.com',
      'X-Title'     : extra?.appName ?? 'IliaGPT',
    };
  }

  /** No standalone embedding endpoint — OpenRouter routes to underlying providers. */
  protected async _embed(_texts: string[], options: IEmbedOptions): Promise<IEmbedResponse> {
    throw new ProviderError({
      message  : '[openrouter] OpenRouter does not expose a standalone embedding API. Call OpenAI or Cohere directly.',
      provider : this.name,
      requestId: options.requestId ?? 'embed',
      retryable: false,
      statusCode: 501,
    });
  }

  /**
   * Attempt to fetch the live model list from OpenRouter.
   * Falls back to static list on error.
   */
  protected async _listModels(): Promise<IModelInfo[]> {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: this.buildHeaders(this.config.apiKey ?? ''),
      });
      if (!res.ok) return OPENROUTER_MODELS;

      const data = await res.json() as { data: Array<{ id: string; name: string; context_length: number; pricing: { prompt: string; completion: string } }> };

      return data.data.map(m => ({
        id              : m.id,
        provider        : 'openrouter',
        displayName     : m.name,
        capabilities    : ModelCapability.CHAT | ModelCapability.STREAMING,
        contextWindow   : m.context_length,
        pricing         : {
          inputPer1M : parseFloat(m.pricing.prompt) * 1_000_000,
          outputPer1M: parseFloat(m.pricing.completion) * 1_000_000,
        },
        latencyScore    : 20,
        reliabilityScore: 0.9,
        available       : true,
        tags            : [],
      }));
    } catch {
      return OPENROUTER_MODELS;
    }
  }
}
