/**
 * Ollama Provider
 *
 * Ollama runs open-source models locally via a native REST API.
 * It also exposes an OpenAI-compatible endpoint at /v1/chat/completions.
 * We use the OpenAI-compat layer for chat but the native /api/tags endpoint
 * for model discovery (which gives richer info).
 *
 * Default base URL: http://localhost:11434
 * No API key required.
 *
 * Extends OpenAICompatBase — the /v1/ prefix is appended automatically via
 * our baseUrl pointing to port 11434/v1.
 *
 * Additional Ollama-specific features:
 *  - /api/pull to download models
 *  - /api/embeddings for local vector generation
 *  - Model IDs can be "llama3", "mistral", "codellama" etc.
 */

import { OpenAICompatBase } from './shared/OpenAICompatBase';
import { Logger } from '../../logger';
import {
  type IProviderConfig,
  type IEmbedOptions,
  type IEmbedResponse,
  type IModelInfo,
  ModelCapability,
  ProviderStatus,
  classifyProviderError,
} from './core/types';

export function ollamaDefaultConfig(opts?: { baseUrl?: string }): IProviderConfig {
  const base = opts?.baseUrl ?? process.env.OLLAMA_HOST ?? 'http://localhost:11434';
  return {
    name        : 'ollama',
    displayName : 'Ollama (local)',
    apiKey      : undefined,           // no auth
    baseUrl     : `${base}/v1`,        // OpenAI-compat mount point
    defaultModel: 'llama3.3',
    timeoutMs   : 300_000,             // local models can be slow on first token
    retry: {
      maxRetries       : 2,
      baseDelayMs      : 1_000,
      backoffFactor    : 2,
      maxDelayMs       : 10_000,
      retryableStatuses: [500, 503],
    },
    rateLimit: {
      requestsPerMinute: 0,   // unlimited — local only
      tokensPerMinute  : 0,
      maxConcurrent    : 4,   // usually constrained by VRAM
    },
    extra: {
      nativeBase: base,       // base URL without /v1 for native API calls
      capabilities:
        ModelCapability.CHAT | ModelCapability.STREAMING |
        ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE |
        ModelCapability.EMBEDDING | ModelCapability.CODE | ModelCapability.VISION,
    },
  };
}

// A representative set — actual list is fetched dynamically from /api/tags.
const OLLAMA_STATIC_MODELS: IModelInfo[] = [
  {
    id: 'llama3.3', provider: 'ollama', displayName: 'Llama 3.3 (local)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING | ModelCapability.CODE,
    contextWindow: 128_000,
    pricing: { inputPer1M: 0, outputPer1M: 0 },
    latencyScore: 30, reliabilityScore: 0.90, available: true,
    tags: ['local', 'open-source'],
  },
  {
    id: 'mistral', provider: 'ollama', displayName: 'Mistral (local)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.FUNCTION_CALLING,
    contextWindow: 32_768,
    pricing: { inputPer1M: 0, outputPer1M: 0 },
    latencyScore: 20, reliabilityScore: 0.90, available: true,
    tags: ['local', 'open-source'],
  },
  {
    id: 'codellama', provider: 'ollama', displayName: 'Code Llama (local)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.CODE,
    contextWindow: 16_384,
    pricing: { inputPer1M: 0, outputPer1M: 0 },
    latencyScore: 25, reliabilityScore: 0.89, available: true,
    tags: ['local', 'code'],
  },
  {
    id: 'nomic-embed-text', provider: 'ollama', displayName: 'nomic-embed-text (local)',
    capabilities: ModelCapability.EMBEDDING,
    contextWindow: 8_192,
    pricing: { inputPer1M: 0, outputPer1M: 0, embedPer1M: 0 },
    latencyScore: 10, reliabilityScore: 0.90, available: true,
    tags: ['local', 'embedding', '768-dim'],
  },
  {
    id: 'llava', provider: 'ollama', displayName: 'LLaVA (local vision)',
    capabilities: ModelCapability.CHAT | ModelCapability.STREAMING | ModelCapability.VISION,
    contextWindow: 4_096,
    pricing: { inputPer1M: 0, outputPer1M: 0 },
    latencyScore: 40, reliabilityScore: 0.85, available: true,
    tags: ['local', 'vision'],
  },
];

export class OllamaProvider extends OpenAICompatBase {
  private get nativeBase(): string {
    return (this.config.extra as any)?.nativeBase ?? 'http://localhost:11434';
  }

  constructor(config: Partial<IProviderConfig> = {}) {
    const defaults = ollamaDefaultConfig({ baseUrl: config.baseUrl?.replace('/v1', '') });
    super({ ...defaults, ...config });
    this.status = ProviderStatus.ACTIVE;
  }

  protected staticModels(): IModelInfo[] {
    return OLLAMA_STATIC_MODELS;
  }

  // No auth header for Ollama.
  protected buildHeaders(_apiKey: string): Record<string, string> {
    return { 'Content-Type': 'application/json' };
  }

  /**
   * Override _embed to use Ollama's native /api/embeddings endpoint,
   * which supports any model that has been pulled locally.
   */
  protected async _embed(texts: string[], options: IEmbedOptions): Promise<IEmbedResponse> {
    const requestId = options.requestId ?? this._newRequestId();
    const start     = Date.now();
    const model     = options.model ?? 'nomic-embed-text';

    try {
      const embeddings: number[][] = [];

      // Ollama's /api/embeddings only accepts one text at a time.
      for (const text of texts) {
        const res = await fetch(`${this.nativeBase}/api/embeddings`, {
          method : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify({ model, prompt: text }),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw Object.assign(new Error(body || res.statusText), { status: res.status });
        }

        const data = await res.json() as { embedding: number[] };
        embeddings.push(data.embedding);
      }

      return {
        embeddings,
        model,
        provider : this.name,
        usage    : {
          promptTokens: texts.reduce((s, t) => s + Math.ceil(t.length / 4), 0),
          totalTokens : texts.reduce((s, t) => s + Math.ceil(t.length / 4), 0),
        },
        latencyMs: Date.now() - start,
        requestId,
      };
    } catch (err) {
      throw classifyProviderError(err, this.name, requestId);
    }
  }

  /**
   * Query /api/tags for dynamically installed models.
   * Falls back to static list if Ollama is not running.
   */
  protected async _listModels(): Promise<IModelInfo[]> {
    try {
      const res = await fetch(`${this.nativeBase}/api/tags`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) return OLLAMA_STATIC_MODELS;

      const data = await res.json() as { models: Array<{ name: string; size: number; details: { parameter_size: string; family: string } }> };

      return data.models.map(m => ({
        id              : m.name,
        provider        : 'ollama',
        displayName     : `${m.name} (local)`,
        capabilities    : ModelCapability.CHAT | ModelCapability.STREAMING,
        contextWindow   : 4_096,          // unknown without pulling model info
        pricing         : { inputPer1M: 0, outputPer1M: 0 },
        latencyScore    : 30,
        reliabilityScore: 0.85,
        available       : true,
        tags            : ['local', m.details?.family ?? 'unknown'],
      }));
    } catch {
      Logger.warn('[ollama] Could not reach Ollama — returning static model list');
      return OLLAMA_STATIC_MODELS;
    }
  }

  /**
   * Health probe pings the native /api/tags instead of sending a completion.
   * Much cheaper — just a GET request.
   */
  protected async _healthProbe(): Promise<void> {
    const res = await fetch(`${this.nativeBase}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      throw Object.assign(new Error('Ollama not responding'), { status: res.status });
    }
  }
}
