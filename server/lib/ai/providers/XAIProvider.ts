/**
 * xAI (Grok) Provider
 *
 * xAI's API is fully OpenAI-compatible at https://api.x.ai/v1.
 * Primary provider in this codebase — Grok models offer a 2M-token context
 * window at a fraction of GPT-4o pricing.
 *
 * Extends OpenAICompatBase for the HTTP layer; adds Grok model catalogue
 * and xAI-specific configuration defaults.
 */

import { OpenAICompatBase } from './shared/OpenAICompatBase';
import {
  type IProviderConfig,
  type IModelInfo,
  ModelCapability,
  ProviderStatus,
} from './core/types';

// ─── Default config ──────────────────────────────────────────────────────────

export function xaiDefaultConfig(apiKey?: string): IProviderConfig {
  return {
    name        : 'xai',
    displayName : 'xAI (Grok)',
    apiKey      : apiKey ?? process.env.XAI_API_KEY ?? process.env.GROK_API_KEY ?? process.env.ILIAGPT_API_KEY,
    baseUrl     : 'https://api.x.ai/v1',
    defaultModel: 'grok-4-1-fast',
    timeoutMs   : 120_000,
    retry: {
      maxRetries       : 3,
      baseDelayMs      : 300,
      backoffFactor    : 2,
      maxDelayMs       : 10_000,
      retryableStatuses: [429, 500, 502, 503],
    },
    rateLimit: {
      requestsPerMinute: 600,
      tokensPerMinute  : 2_000_000,
      maxConcurrent    : 50,
    },
    fallbackChain: ['openai', 'anthropic'],
    extra: {
      capabilities:
        ModelCapability.CHAT | ModelCapability.STREAMING |
        ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE |
        ModelCapability.VISION | ModelCapability.CODE | ModelCapability.REASONING,
    },
  };
}

// ─── Static model catalogue ──────────────────────────────────────────────────

const XAI_MODELS: IModelInfo[] = [
  {
    id: 'grok-4-1-fast', provider: 'xai', displayName: 'Grok 4.1 Fast',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.CODE,
    contextWindow: 2_000_000, maxOutputTokens: 32_768,
    pricing: { inputPer1M: 0.50, outputPer1M: 2.00 },
    latencyScore: 15, reliabilityScore: 0.99, available: true,
    tags: ['flagship', 'fast', 'long-context', 'cheap'],
  },
  {
    id: 'grok-4-1-fast-reasoning', provider: 'xai', displayName: 'Grok 4.1 Fast Reasoning',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.CODE | ModelCapability.REASONING,
    contextWindow: 2_000_000, maxOutputTokens: 32_768,
    pricing: { inputPer1M: 1.00, outputPer1M: 4.00 },
    latencyScore: 20, reliabilityScore: 0.99, available: true,
    tags: ['reasoning', 'long-context'],
  },
  {
    id: 'grok-3-fast', provider: 'xai', displayName: 'Grok 3 Fast',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE,
    contextWindow: 131_072,
    pricing: { inputPer1M: 5.00, outputPer1M: 25.00 },
    latencyScore: 12, reliabilityScore: 0.98, available: true,
    tags: ['fast', 'legacy'],
  },
  {
    id: 'grok-2-vision-1212', provider: 'xai', displayName: 'Grok 2 Vision',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.VISION,
    contextWindow: 32_768,
    pricing: { inputPer1M: 2.00, outputPer1M: 10.00 },
    latencyScore: 25, reliabilityScore: 0.97, available: true,
    tags: ['vision', 'legacy'],
  },
  {
    id: 'grok-3-mini-fast', provider: 'xai', displayName: 'Grok 3 Mini Fast',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.JSON_MODE,
    contextWindow: 131_072,
    pricing: { inputPer1M: 0.30, outputPer1M: 0.50 },
    latencyScore: 8, reliabilityScore: 0.98, available: true,
    tags: ['fast', 'cheap'],
  },
];

// ─── Provider ────────────────────────────────────────────────────────────────

export class XAIProvider extends OpenAICompatBase {
  constructor(config: Partial<IProviderConfig> = {}) {
    const defaults = xaiDefaultConfig(config.apiKey);
    super({ ...defaults, ...config });
    this.status = ProviderStatus.ACTIVE;
  }

  protected staticModels(): IModelInfo[] {
    return XAI_MODELS;
  }
}
