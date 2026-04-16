/**
 * DeepSeek Provider
 *
 * DeepSeek's API is OpenAI-compatible at https://api.deepseek.com/v1.
 * Provides extremely cost-effective reasoning and code models.
 *
 * Special note on deepseek-reasoner: It exposes a `reasoning_content` field
 * alongside `content` in responses.  We surface that as metadata in `raw`.
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
  classifyProviderError,
} from './core/types';

export function deepseekDefaultConfig(apiKey?: string): IProviderConfig {
  return {
    name        : 'deepseek',
    displayName : 'DeepSeek',
    apiKey      : apiKey ?? process.env.DEEPSEEK_API_KEY,
    baseUrl     : 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    timeoutMs   : 120_000,
    retry: {
      maxRetries       : 3,
      baseDelayMs      : 500,
      backoffFactor    : 2,
      maxDelayMs       : 12_000,
      retryableStatuses: [429, 500, 503],
    },
    rateLimit: {
      requestsPerMinute: 60,
      tokensPerMinute  : 500_000,
      maxConcurrent    : 20,
    },
    extra: {
      capabilities:
        ModelCapability.CHAT | ModelCapability.STREAMING |
        ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE |
        ModelCapability.CODE | ModelCapability.REASONING,
    },
  };
}

const DEEPSEEK_MODELS: IModelInfo[] = [
  {
    id: 'deepseek-chat', provider: 'deepseek', displayName: 'DeepSeek V3',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.CODE,
    contextWindow: 64_000, maxOutputTokens: 8_192,
    pricing: { inputPer1M: 0.14, outputPer1M: 0.28 },    // cache hit pricing even cheaper
    latencyScore: 18, reliabilityScore: 0.96, available: true,
    tags: ['cheap', 'code', 'function-calling'],
  },
  {
    id: 'deepseek-reasoner', provider: 'deepseek', displayName: 'DeepSeek R1',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.REASONING | ModelCapability.CODE,
    contextWindow: 64_000, maxOutputTokens: 8_192,
    pricing: { inputPer1M: 0.55, outputPer1M: 2.19 },
    latencyScore: 40, reliabilityScore: 0.95, available: true,
    tags: ['reasoning', 'code', 'cheap'],
  },
  {
    id: 'deepseek-coder', provider: 'deepseek', displayName: 'DeepSeek Coder V2',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.CODE | ModelCapability.JSON_MODE,
    contextWindow: 128_000,
    pricing: { inputPer1M: 0.14, outputPer1M: 0.28 },
    latencyScore: 15, reliabilityScore: 0.95, available: true,
    tags: ['code', 'cheap'],
  },
];

export class DeepSeekProvider extends OpenAICompatBase {
  constructor(config: Partial<IProviderConfig> = {}) {
    const defaults = deepseekDefaultConfig(config.apiKey);
    super({ ...defaults, ...config });
    this.status = ProviderStatus.ACTIVE;
  }

  protected staticModels(): IModelInfo[] {
    return DEEPSEEK_MODELS;
  }

  /**
   * Override _chat to surface deepseek-reasoner's `reasoning_content`
   * in the response `raw` field.
   */
  protected async _chat(messages: IChatMessage[], options: IChatOptions): Promise<IChatResponse> {
    const response = await super._chat(messages, options);

    // If reasoning_content is present in the raw response, attach it.
    const rawChoice = (response.raw as any)?.choices?.[0]?.message;
    if (rawChoice?.reasoning_content) {
      (response as any).reasoningContent = rawChoice.reasoning_content;
    }

    return response;
  }

  // DeepSeek does not offer a public embedding API.
  protected async _embed(_texts: string[], options: IEmbedOptions): Promise<IEmbedResponse> {
    throw new ProviderError({
      message  : '[deepseek] DeepSeek does not expose an embedding API. Use OpenAI or Cohere.',
      provider : this.name,
      requestId: options.requestId ?? 'embed',
      retryable: false,
      statusCode: 501,
    });
  }
}
