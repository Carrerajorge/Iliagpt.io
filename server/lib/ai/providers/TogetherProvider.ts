/**
 * Together AI Provider
 *
 * Together AI hosts 100+ open-source models via an OpenAI-compatible API.
 * Base URL: https://api.together.xyz/v1
 *
 * Notable: supports embeddings via BAAI/bge-large-en-v1.5 and similar.
 * Model IDs use the format "org/model-name" (e.g. "meta-llama/Llama-3-70b-chat-hf").
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

export function togetherDefaultConfig(apiKey?: string): IProviderConfig {
  return {
    name        : 'together',
    displayName : 'Together AI',
    apiKey      : apiKey ?? process.env.TOGETHER_API_KEY,
    baseUrl     : 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    timeoutMs   : 90_000,
    retry: {
      maxRetries       : 3,
      baseDelayMs      : 400,
      backoffFactor    : 2,
      maxDelayMs       : 10_000,
      retryableStatuses: [429, 500, 503],
    },
    rateLimit: {
      requestsPerMinute: 60,
      tokensPerMinute  : 1_000_000,
      maxConcurrent    : 20,
    },
    extra: {
      capabilities:
        ModelCapability.CHAT | ModelCapability.STREAMING |
        ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE |
        ModelCapability.EMBEDDING | ModelCapability.CODE,
    },
  };
}

const TOGETHER_MODELS: IModelInfo[] = [
  {
    id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', provider: 'together', displayName: 'Llama 3.3 70B Turbo',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.CODE,
    contextWindow: 131_072,
    pricing: { inputPer1M: 0.88, outputPer1M: 0.88 },
    latencyScore: 12, reliabilityScore: 0.95, available: true,
    tags: ['open-source', 'llama', 'fast'],
  },
  {
    id: 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo', provider: 'together', displayName: 'Llama 3.1 405B Turbo',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.CODE,
    contextWindow: 130_815,
    pricing: { inputPer1M: 3.50, outputPer1M: 3.50 },
    latencyScore: 25, reliabilityScore: 0.94, available: true,
    tags: ['open-source', 'flagship', 'llama'],
  },
  {
    id: 'Qwen/QwQ-32B-Preview', provider: 'together', displayName: 'QwQ 32B Preview',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.REASONING | ModelCapability.CODE,
    contextWindow: 32_768,
    pricing: { inputPer1M: 1.20, outputPer1M: 1.20 },
    latencyScore: 20, reliabilityScore: 0.93, available: true,
    tags: ['reasoning', 'qwen'],
  },
  {
    id: 'mistralai/Mixtral-8x7B-Instruct-v0.1', provider: 'together', displayName: 'Mixtral 8x7B',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING,
    contextWindow: 32_768,
    pricing: { inputPer1M: 0.60, outputPer1M: 0.60 },
    latencyScore: 10, reliabilityScore: 0.94, available: true,
    tags: ['moe', 'fast'],
  },
  {
    id: 'deepseek-ai/DeepSeek-R1', provider: 'together', displayName: 'DeepSeek R1 (Together)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.REASONING | ModelCapability.CODE,
    contextWindow: 64_000,
    pricing: { inputPer1M: 3.0, outputPer1M: 7.0 },
    latencyScore: 35, reliabilityScore: 0.93, available: true,
    tags: ['reasoning'],
  },
  {
    id: 'BAAI/bge-large-en-v1.5', provider: 'together', displayName: 'BGE Large EN v1.5',
    capabilities: ModelCapability.EMBEDDING,
    contextWindow: 512,
    pricing: { inputPer1M: 0.008, outputPer1M: 0, embedPer1M: 0.008 },
    latencyScore: 3, reliabilityScore: 0.97, available: true,
    tags: ['embedding', '1024-dim'],
  },
  {
    id: 'togethercomputer/m2-bert-80M-8k-retrieval', provider: 'together', displayName: 'M2 BERT 8K Retrieval',
    capabilities: ModelCapability.EMBEDDING,
    contextWindow: 8_192,
    pricing: { inputPer1M: 0.008, outputPer1M: 0, embedPer1M: 0.008 },
    latencyScore: 2, reliabilityScore: 0.96, available: true,
    tags: ['embedding', '768-dim', 'long-context'],
  },
];

export class TogetherProvider extends OpenAICompatBase {
  constructor(config: Partial<IProviderConfig> = {}) {
    const defaults = togetherDefaultConfig(config.apiKey);
    super({ ...defaults, ...config });
    this.status = ProviderStatus.ACTIVE;
  }

  protected staticModels(): IModelInfo[] {
    return TOGETHER_MODELS;
  }

  // Together uses "org/model" IDs directly — no mapping needed.
  protected normaliseModel(modelId: string): string {
    return modelId;
  }
}
