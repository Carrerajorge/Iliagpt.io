/**
 * LM Studio Provider
 *
 * LM Studio exposes a local OpenAI-compatible server at http://localhost:1234/v1.
 * No API key required.  The active model is whatever the user has loaded in
 * the LM Studio GUI — you cannot specify an arbitrary model by ID unless it
 * was loaded.
 *
 * Notable:
 *  - Model ID in requests must match exactly what LM Studio has loaded.
 *  - The /v1/models endpoint returns the currently loaded model.
 *  - Supports embeddings via /v1/embeddings for embedding-capable models.
 *  - Ideal for development / privacy-sensitive workflows.
 *
 * Extends OpenAICompatBase.
 */

import { OpenAICompatBase } from './shared/OpenAICompatBase';
import { Logger } from '../../logger';
import {
  type IProviderConfig,
  type IModelInfo,
  ModelCapability,
  ProviderStatus,
} from './core/types';

export function lmStudioDefaultConfig(opts?: { baseUrl?: string }): IProviderConfig {
  return {
    name        : 'lmstudio',
    displayName : 'LM Studio (local)',
    apiKey      : undefined,
    baseUrl     : opts?.baseUrl ?? process.env.LM_STUDIO_URL ?? 'http://localhost:1234/v1',
    defaultModel: 'local-model',          // placeholder — replaced by whatever is loaded
    timeoutMs   : 300_000,
    retry: {
      maxRetries       : 1,
      baseDelayMs      : 1_000,
      backoffFactor    : 2,
      maxDelayMs       : 5_000,
      retryableStatuses: [500, 503],
    },
    rateLimit: {
      requestsPerMinute: 0,   // unlimited local
      tokensPerMinute  : 0,
      maxConcurrent    : 2,   // single GPU usually
    },
    extra: {
      capabilities:
        ModelCapability.CHAT | ModelCapability.STREAMING |
        ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE |
        ModelCapability.EMBEDDING | ModelCapability.CODE,
    },
  };
}

export class LMStudioProvider extends OpenAICompatBase {
  constructor(config: Partial<IProviderConfig> = {}) {
    const defaults = lmStudioDefaultConfig({ baseUrl: config.baseUrl });
    super({ ...defaults, ...config });
    this.status = ProviderStatus.ACTIVE;
  }

  protected staticModels(): IModelInfo[] {
    // LM Studio models are dynamic — return empty; live fetch in _listModels().
    return [];
  }

  protected buildHeaders(_apiKey: string): Record<string, string> {
    // LM Studio does not require auth; some users configure a custom bearer key.
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (_apiKey) h['Authorization'] = `Bearer ${_apiKey}`;
    return h;
  }

  /**
   * LM Studio's /v1/models returns only the currently loaded model(s).
   * Parse and return them as IModelInfo entries.
   */
  protected async _listModels(): Promise<IModelInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.buildHeaders(this.config.apiKey ?? ''),
        signal : AbortSignal.timeout(3_000),
      });
      if (!res.ok) return [];

      const data = await res.json() as { data: Array<{ id: string; owned_by?: string }> };

      return data.data.map(m => ({
        id              : m.id,
        provider        : 'lmstudio',
        displayName     : `${m.id} (LM Studio)`,
        capabilities    : ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.CODE | ModelCapability.FUNCTION_CALLING,
        contextWindow   : 8_192,   // unknown without model card
        pricing         : { inputPer1M: 0, outputPer1M: 0 },
        latencyScore    : 40,
        reliabilityScore: 0.85,
        available       : true,
        tags            : ['local'],
      }));
    } catch {
      Logger.warn('[lmstudio] Could not reach LM Studio server.');
      return [];
    }
  }

  protected async _healthProbe(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: this.buildHeaders(this.config.apiKey ?? ''),
      signal : AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      throw Object.assign(new Error('LM Studio not responding'), { status: res.status });
    }
    const data = await res.json() as { data: unknown[] };
    if (!data?.data?.length) {
      throw new Error('LM Studio has no model loaded');
    }
  }
}
