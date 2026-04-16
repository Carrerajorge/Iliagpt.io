/**
 * Perplexity Provider
 *
 * Perplexity's API is OpenAI-compatible at https://api.perplexity.ai.
 * Perplexity's sonar models perform live web searches and return citations
 * in a `citations` array alongside the answer.  The `online` model variants
 * are grounded in real-time search results.
 *
 * Notable quirks:
 *  - `citations` array in response raw — surfaced in metadata.
 *  - No embeddings API.
 *  - `search_domain_filter` and `return_images` are Perplexity-specific extras.
 *
 * Extends OpenAICompatBase.
 */

import { OpenAICompatBase } from './shared/OpenAICompatBase';
import {
  type IProviderConfig,
  type IChatMessage,
  type IChatOptions,
  type IChatResponse,
  type IEmbedOptions,
  type IEmbedResponse,
  type IModelInfo,
  ModelCapability,
  ProviderStatus,
  ProviderError,
} from './core/types';

export function perplexityDefaultConfig(apiKey?: string): IProviderConfig {
  return {
    name        : 'perplexity',
    displayName : 'Perplexity',
    apiKey      : apiKey ?? process.env.PERPLEXITY_API_KEY,
    baseUrl     : 'https://api.perplexity.ai',
    defaultModel: 'sonar',
    timeoutMs   : 60_000,
    retry: {
      maxRetries       : 2,
      baseDelayMs      : 500,
      backoffFactor    : 2,
      maxDelayMs       : 8_000,
      retryableStatuses: [429, 500, 503],
    },
    rateLimit: {
      requestsPerMinute: 50,
      tokensPerMinute  : 200_000,
      maxConcurrent    : 10,
    },
    extra: {
      capabilities:
        ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.CODE,
    },
  };
}

const PERPLEXITY_MODELS: IModelInfo[] = [
  {
    id: 'sonar', provider: 'perplexity', displayName: 'Sonar',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING,
    contextWindow: 127_072,
    pricing: { inputPer1M: 1.0, outputPer1M: 1.0 },
    latencyScore: 12, reliabilityScore: 0.95, available: true,
    tags: ['web-search', 'fast', 'citations'],
  },
  {
    id: 'sonar-pro', provider: 'perplexity', displayName: 'Sonar Pro',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING,
    contextWindow: 200_000,
    pricing: { inputPer1M: 3.0, outputPer1M: 15.0 },
    latencyScore: 25, reliabilityScore: 0.95, available: true,
    tags: ['web-search', 'flagship', 'citations'],
  },
  {
    id: 'sonar-reasoning', provider: 'perplexity', displayName: 'Sonar Reasoning',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.REASONING,
    contextWindow: 127_072,
    pricing: { inputPer1M: 1.0, outputPer1M: 5.0 },
    latencyScore: 20, reliabilityScore: 0.94, available: true,
    tags: ['web-search', 'reasoning', 'citations'],
  },
  {
    id: 'sonar-reasoning-pro', provider: 'perplexity', displayName: 'Sonar Reasoning Pro',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.REASONING,
    contextWindow: 200_000,
    pricing: { inputPer1M: 2.0, outputPer1M: 8.0 },
    latencyScore: 35, reliabilityScore: 0.94, available: true,
    tags: ['web-search', 'reasoning', 'pro', 'citations'],
  },
  {
    id: 'r1-1776', provider: 'perplexity', displayName: 'R1-1776 (offline)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.REASONING | ModelCapability.CODE,
    contextWindow: 128_000,
    pricing: { inputPer1M: 2.0, outputPer1M: 8.0 },
    latencyScore: 40, reliabilityScore: 0.94, available: true,
    tags: ['reasoning', 'offline', 'deepseek-r1'],
  },
];

export class PerplexityProvider extends OpenAICompatBase {
  constructor(config: Partial<IProviderConfig> = {}) {
    const defaults = perplexityDefaultConfig(config.apiKey);
    super({ ...defaults, ...config });
    this.status = ProviderStatus.ACTIVE;
  }

  protected staticModels(): IModelInfo[] {
    return PERPLEXITY_MODELS;
  }

  /**
   * Override to attach `citations` from the Perplexity-specific response
   * field to `response.raw` for callers that need provenance.
   */
  protected async _chat(messages: IChatMessage[], options: IChatOptions): Promise<IChatResponse> {
    const response = await super._chat(messages, options);
    // Citations are an array of URL strings in the Perplexity response.
    const citations = (response.raw as any)?.citations;
    if (citations?.length) {
      (response as any).citations = citations;
    }
    return response;
  }

  protected async _embed(_texts: string[], options: IEmbedOptions): Promise<IEmbedResponse> {
    throw new ProviderError({
      message  : '[perplexity] Perplexity does not provide an embedding API.',
      provider : this.name,
      requestId: options.requestId ?? 'embed',
      retryable: false,
      statusCode: 501,
    });
  }
}
