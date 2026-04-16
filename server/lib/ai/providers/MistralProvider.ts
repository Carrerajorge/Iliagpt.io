/**
 * Mistral AI Provider
 *
 * Mistral's API is OpenAI-compatible at https://api.mistral.ai/v1.
 * Notable features:
 *  - Native embedding API (mistral-embed, 1024-dim)
 *  - Codestral for code completion
 *  - Mistral Large for strongest reasoning
 *  - Function calling supported on most models
 *
 * Extends OpenAICompatBase.
 */

import { OpenAICompatBase } from './shared/OpenAICompatBase';
import {
  type IProviderConfig,
  type IModelInfo,
  ModelCapability,
  ProviderStatus,
} from './core/types';

export function mistralDefaultConfig(apiKey?: string): IProviderConfig {
  return {
    name        : 'mistral',
    displayName : 'Mistral AI',
    apiKey      : apiKey ?? process.env.MISTRAL_API_KEY,
    baseUrl     : 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    timeoutMs   : 90_000,
    retry: {
      maxRetries       : 3,
      baseDelayMs      : 500,
      backoffFactor    : 2,
      maxDelayMs       : 12_000,
      retryableStatuses: [429, 500, 503],
    },
    rateLimit: {
      requestsPerMinute: 120,
      tokensPerMinute  : 500_000,
      maxConcurrent    : 20,
    },
    fallbackChain: ['openai', 'anthropic'],
    extra: {
      capabilities:
        ModelCapability.CHAT | ModelCapability.STREAMING |
        ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE |
        ModelCapability.EMBEDDING | ModelCapability.CODE,
    },
  };
}

const MISTRAL_MODELS: IModelInfo[] = [
  {
    id: 'mistral-large-latest', provider: 'mistral', displayName: 'Mistral Large',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.CODE,
    contextWindow: 131_072,
    pricing: { inputPer1M: 3.0, outputPer1M: 9.0 },
    latencyScore: 25, reliabilityScore: 0.98, available: true,
    tags: ['flagship', 'function-calling'],
  },
  {
    id: 'mistral-medium-latest', provider: 'mistral', displayName: 'Mistral Medium',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.JSON_MODE,
    contextWindow: 32_768,
    pricing: { inputPer1M: 2.7, outputPer1M: 8.1 },
    latencyScore: 20, reliabilityScore: 0.97, available: true,
    tags: ['balanced'],
  },
  {
    id: 'mistral-small-latest', provider: 'mistral', displayName: 'Mistral Small',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE,
    contextWindow: 32_768,
    pricing: { inputPer1M: 0.2, outputPer1M: 0.6 },
    latencyScore: 10, reliabilityScore: 0.98, available: true,
    tags: ['fast', 'cheap'],
  },
  {
    id: 'codestral-latest', provider: 'mistral', displayName: 'Codestral',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.CODE | ModelCapability.JSON_MODE,
    contextWindow: 262_144,
    pricing: { inputPer1M: 0.3, outputPer1M: 0.9 },
    latencyScore: 15, reliabilityScore: 0.97, available: true,
    tags: ['code', 'long-context'],
  },
  {
    id: 'mistral-embed', provider: 'mistral', displayName: 'Mistral Embed',
    capabilities: ModelCapability.EMBEDDING,
    contextWindow: 8_192,
    pricing: { inputPer1M: 0.1, outputPer1M: 0, embedPer1M: 0.1 },
    latencyScore: 4, reliabilityScore: 0.99, available: true,
    tags: ['embedding', '1024-dim'],
  },
  {
    id: 'mixtral-8x7b-instruct-v0.1', provider: 'mistral', displayName: 'Mixtral 8x7B',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING,
    contextWindow: 32_768,
    pricing: { inputPer1M: 0.7, outputPer1M: 0.7 },
    latencyScore: 18, reliabilityScore: 0.96, available: true,
    tags: ['open-source', 'moe'],
  },
  {
    id: 'mixtral-8x22b-instruct-v0.1', provider: 'mistral', displayName: 'Mixtral 8x22B',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.CODE,
    contextWindow: 65_536,
    pricing: { inputPer1M: 2.0, outputPer1M: 6.0 },
    latencyScore: 30, reliabilityScore: 0.96, available: true,
    tags: ['open-source', 'moe', 'flagship'],
  },
];

export class MistralProvider extends OpenAICompatBase {
  constructor(config: Partial<IProviderConfig> = {}) {
    const defaults = mistralDefaultConfig(config.apiKey);
    super({ ...defaults, ...config });
    this.status = ProviderStatus.ACTIVE;
  }

  protected staticModels(): IModelInfo[] {
    return MISTRAL_MODELS;
  }
}
