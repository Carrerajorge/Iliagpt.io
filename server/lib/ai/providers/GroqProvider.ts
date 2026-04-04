/**
 * Groq Provider
 *
 * Groq's LPU inference engine is the fastest available for open-source models.
 * API is fully OpenAI-compatible at https://api.groq.com/openai/v1.
 * Notable: does NOT support embeddings — use a different provider for that.
 *
 * Extends OpenAICompatBase.
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

export function groqDefaultConfig(apiKey?: string): IProviderConfig {
  return {
    name        : 'groq',
    displayName : 'Groq',
    apiKey      : apiKey ?? process.env.GROQ_API_KEY,
    baseUrl     : 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    timeoutMs   : 30_000,
    retry: {
      maxRetries       : 3,
      baseDelayMs      : 200,
      backoffFactor    : 2,
      maxDelayMs       : 8_000,
      retryableStatuses: [429, 500, 503],
    },
    rateLimit: {
      requestsPerMinute: 30,
      tokensPerMinute  : 6_000,    // Groq free tier is very tight
      maxConcurrent    : 5,
    },
    extra: {
      capabilities:
        ModelCapability.CHAT | ModelCapability.STREAMING |
        ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.CODE,
    },
  };
}

const GROQ_MODELS: IModelInfo[] = [
  {
    id: 'llama-3.3-70b-versatile', provider: 'groq', displayName: 'Llama 3.3 70B (Groq)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.CODE,
    contextWindow: 128_000, maxOutputTokens: 32_768,
    pricing: { inputPer1M: 0.59, outputPer1M: 0.79 },
    latencyScore: 4, reliabilityScore: 0.96, available: true,
    tags: ['fast', 'open-source', 'llama'],
  },
  {
    id: 'llama-3.1-70b-versatile', provider: 'groq', displayName: 'Llama 3.1 70B (Groq)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE,
    contextWindow: 131_072,
    pricing: { inputPer1M: 0.59, outputPer1M: 0.79 },
    latencyScore: 5, reliabilityScore: 0.96, available: true,
    tags: ['fast', 'open-source', 'llama'],
  },
  {
    id: 'llama-3.1-8b-instant', provider: 'groq', displayName: 'Llama 3.1 8B Instant',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.JSON_MODE,
    contextWindow: 131_072,
    pricing: { inputPer1M: 0.05, outputPer1M: 0.08 },
    latencyScore: 2, reliabilityScore: 0.96, available: true,
    tags: ['ultra-fast', 'cheap', 'small'],
  },
  {
    id: 'mixtral-8x7b-32768', provider: 'groq', displayName: 'Mixtral 8x7B (Groq)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING,
    contextWindow: 32_768,
    pricing: { inputPer1M: 0.24, outputPer1M: 0.24 },
    latencyScore: 4, reliabilityScore: 0.96, available: true,
    tags: ['fast', 'moe'],
  },
  {
    id: 'gemma2-9b-it', provider: 'groq', displayName: 'Gemma 2 9B (Groq)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.JSON_MODE,
    contextWindow: 8_192,
    pricing: { inputPer1M: 0.20, outputPer1M: 0.20 },
    latencyScore: 3, reliabilityScore: 0.95, available: true,
    tags: ['fast', 'google', 'small'],
  },
  {
    id: 'llama-3.3-70b-specdec', provider: 'groq', displayName: 'Llama 3.3 70B SpecDec',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING,
    contextWindow: 8_192,
    pricing: { inputPer1M: 0.59, outputPer1M: 0.99 },
    latencyScore: 3, reliabilityScore: 0.95, available: true,
    tags: ['speculative-decoding'],
  },
];

export class GroqProvider extends OpenAICompatBase {
  constructor(config: Partial<IProviderConfig> = {}) {
    const defaults = groqDefaultConfig(config.apiKey);
    super({ ...defaults, ...config });
    this.status = ProviderStatus.ACTIVE;
  }

  protected staticModels(): IModelInfo[] {
    return GROQ_MODELS;
  }

  // Groq has no embedding API.
  protected async _embed(_texts: string[], options: IEmbedOptions): Promise<IEmbedResponse> {
    throw new ProviderError({
      message  : '[groq] Groq does not support embeddings. Use OpenAI, Cohere, or Google.',
      provider : this.name,
      requestId: options.requestId ?? 'embed',
      retryable: false,
      statusCode: 501,
    });
  }
}
