/**
 * Fireworks AI Provider
 *
 * Fireworks AI offers fast inference for open-source models and their own
 * FireFunction models.  API is OpenAI-compatible at
 * https://api.fireworks.ai/inference/v1.
 *
 * Model IDs follow the format "accounts/fireworks/models/model-name".
 * FireFunction-v2 is notably excellent at function calling.
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

export function fireworksDefaultConfig(apiKey?: string): IProviderConfig {
  return {
    name        : 'fireworks',
    displayName : 'Fireworks AI',
    apiKey      : apiKey ?? process.env.FIREWORKS_API_KEY,
    baseUrl     : 'https://api.fireworks.ai/inference/v1',
    defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    timeoutMs   : 60_000,
    retry: {
      maxRetries       : 3,
      baseDelayMs      : 300,
      backoffFactor    : 2,
      maxDelayMs       : 8_000,
      retryableStatuses: [429, 500, 503],
    },
    rateLimit: {
      requestsPerMinute: 120,
      tokensPerMinute  : 2_000_000,
      maxConcurrent    : 20,
    },
    extra: {
      capabilities:
        ModelCapability.CHAT | ModelCapability.STREAMING |
        ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.CODE,
    },
  };
}

const FIREWORKS_MODELS: IModelInfo[] = [
  {
    id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', provider: 'fireworks', displayName: 'Llama 3.3 70B Instruct',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.CODE,
    contextWindow: 131_072,
    pricing: { inputPer1M: 0.90, outputPer1M: 0.90 },
    latencyScore: 10, reliabilityScore: 0.95, available: true,
    tags: ['open-source', 'llama', 'fast'],
  },
  {
    id: 'accounts/fireworks/models/firefunction-v2', provider: 'fireworks', displayName: 'FireFunction v2',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE,
    contextWindow: 8_192,
    pricing: { inputPer1M: 0.90, outputPer1M: 0.90 },
    latencyScore: 8, reliabilityScore: 0.96, available: true,
    tags: ['function-calling', 'fast'],
  },
  {
    id: 'accounts/fireworks/models/deepseek-r1', provider: 'fireworks', displayName: 'DeepSeek R1 (Fireworks)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.REASONING | ModelCapability.CODE,
    contextWindow: 160_000,
    pricing: { inputPer1M: 3.0, outputPer1M: 8.0 },
    latencyScore: 30, reliabilityScore: 0.94, available: true,
    tags: ['reasoning', 'deepseek'],
  },
  {
    id: 'accounts/fireworks/models/mixtral-8x22b-instruct-hf', provider: 'fireworks', displayName: 'Mixtral 8x22B',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.CODE,
    contextWindow: 65_536,
    pricing: { inputPer1M: 1.20, outputPer1M: 1.20 },
    latencyScore: 15, reliabilityScore: 0.94, available: true,
    tags: ['moe', 'large'],
  },
  {
    id: 'accounts/fireworks/models/qwen2p5-72b-instruct', provider: 'fireworks', displayName: 'Qwen2.5 72B Instruct',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.CODE,
    contextWindow: 32_768,
    pricing: { inputPer1M: 0.90, outputPer1M: 0.90 },
    latencyScore: 12, reliabilityScore: 0.94, available: true,
    tags: ['qwen', 'fast'],
  },
];

export class FireworksProvider extends OpenAICompatBase {
  constructor(config: Partial<IProviderConfig> = {}) {
    const defaults = fireworksDefaultConfig(config.apiKey);
    super({ ...defaults, ...config });
    this.status = ProviderStatus.ACTIVE;
  }

  protected staticModels(): IModelInfo[] {
    return FIREWORKS_MODELS;
  }

  // Fireworks has no public embedding endpoint.
  protected async _embed(_texts: string[], options: IEmbedOptions): Promise<IEmbedResponse> {
    throw new ProviderError({
      message  : '[fireworks] Fireworks AI does not provide a public embedding API.',
      provider : this.name,
      requestId: options.requestId ?? 'embed',
      retryable: false,
      statusCode: 501,
    });
  }
}
