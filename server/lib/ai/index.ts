/**
 * server/lib/ai/index.ts
 *
 * Central AI module — composition root for the entire AI subsystem.
 *
 * Responsibilities:
 *   1. Auto-registers all 15 LLM providers that have credentials in env vars.
 *   2. Starts the provider health-check loop.
 *   3. Exposes `AIService` — the single façade the rest of the app imports.
 *   4. Re-exports the new ReasoningEngine + UncertaintyEstimator (replaces
 *      the stubs that lived in server/lib/ai/reasoningEngine.ts).
 *
 * Consumers:
 *   import { aiService } from '../lib/ai';
 *   const resp = await aiService.chat(messages, opts);
 */

import { Logger } from '../logger';
import { llmGateway } from '../llmGateway';

// ── Provider registry + core types ───────────────────────────────────────────
import {
  providerRegistry,
  registerRegistryShutdownHooks,
  type ProviderQuery,
} from './providers/core/ProviderRegistry';
import { type IModelInfo, ModelCapability, ProviderStatus } from './providers/core/types';

// ── Provider implementations ─────────────────────────────────────────────────
import { OpenAIProvider }      from './providers/OpenAIProvider';
import { AnthropicProvider }   from './providers/AnthropicProvider';
import { GoogleProvider }      from './providers/GoogleProvider';
import { XAIProvider }         from './providers/XAIProvider';
import { MistralProvider }     from './providers/MistralProvider';
import { CohereProvider }      from './providers/CohereProvider';
import { DeepSeekProvider }    from './providers/DeepSeekProvider';
import { GroqProvider }        from './providers/GroqProvider';
import { TogetherProvider }    from './providers/TogetherProvider';
import { PerplexityProvider }  from './providers/PerplexityProvider';
import { FireworksProvider }   from './providers/FireworksProvider';
import { OpenRouterProvider }  from './providers/OpenRouterProvider';
import { OllamaProvider }      from './providers/OllamaProvider';
import { LMStudioProvider }    from './providers/LMStudioProvider';
import { AzureOpenAIProvider } from './providers/AzureOpenAIProvider';

// ── Reasoning + uncertainty (new implementations) ─────────────────────────────
export { ReasoningEngine, reasoningEngine, type ReasoningTrace, type ReasoningOptions }
  from '../../reasoning/ReasoningEngine';
export { UncertaintyEstimator, uncertaintyEstimator, type UncertaintyResult, type UncertaintyOptions }
  from '../../reasoning/UncertaintyEstimator';

// ─── Provider registration ────────────────────────────────────────────────────

/**
 * Registers a provider only if it appears to have credentials / config.
 * Returns true if registration happened.
 */
function tryRegister(
  name    : string,
  factory : () => InstanceType<typeof OpenAIProvider>,
  hasKey  : boolean,
): boolean {
  if (!hasKey) {
    Logger.debug(`[ai/index] skipping ${name} — no credentials found`);
    return false;
  }
  try {
    providerRegistry.register(factory());
    Logger.debug(`[ai/index] registered provider: ${name}`);
    return true;
  } catch (err) {
    Logger.warn(`[ai/index] failed to register ${name}`, { error: (err as Error).message });
    return false;
  }
}

function bootstrapProviders(): number {
  const env = process.env;
  let registered = 0;

  const tasks: [string, () => any, boolean][] = [
    ['openai',      () => new OpenAIProvider(),      !!(env.OPENAI_API_KEY)],
    ['anthropic',   () => new AnthropicProvider(),   !!(env.ANTHROPIC_API_KEY)],
    ['google',      () => new GoogleProvider(),      !!(env.GOOGLE_API_KEY || env.GEMINI_API_KEY)],
    ['xai',         () => new XAIProvider(),         !!(env.XAI_API_KEY || env.GROK_API_KEY || env.ILIAGPT_API_KEY)],
    ['mistral',     () => new MistralProvider(),     !!(env.MISTRAL_API_KEY)],
    ['cohere',      () => new CohereProvider(),      !!(env.COHERE_API_KEY)],
    ['deepseek',    () => new DeepSeekProvider(),    !!(env.DEEPSEEK_API_KEY)],
    ['groq',        () => new GroqProvider(),        !!(env.GROQ_API_KEY)],
    ['together',    () => new TogetherProvider(),    !!(env.TOGETHER_API_KEY)],
    ['perplexity',  () => new PerplexityProvider(),  !!(env.PERPLEXITY_API_KEY)],
    ['fireworks',   () => new FireworksProvider(),   !!(env.FIREWORKS_API_KEY)],
    ['openrouter',  () => new OpenRouterProvider(),  !!(env.OPENROUTER_API_KEY)],
    // Local providers — always register; health probe handles availability
    ['ollama',      () => new OllamaProvider(),      true],
    ['lmstudio',    () => new LMStudioProvider(),    true],
    ['azure',       () => new AzureOpenAIProvider(), !!(env.AZURE_OPENAI_API_KEY && env.AZURE_OPENAI_ENDPOINT)],
  ];

  for (const [name, factory, hasKey] of tasks) {
    if (tryRegister(name, factory, hasKey)) registered++;
  }

  return registered;
}

// ─── AIService ────────────────────────────────────────────────────────────────

export interface AIChatOptions {
  model?         : string;
  provider?      : string;
  temperature?   : number;
  maxTokens?     : number;
  topP?          : number;
  stream?        : boolean;
  requestId?     : string;
  userId?        : string;
  timeout?       : number;
  enableFallback?: boolean;
  skipCache?     : boolean;
  capability?    : ModelCapability;
}

export interface AIEmbedOptions {
  model?     : string;
  provider?  : string;
  requestId? : string;
}

export interface AIServiceStatus {
  providers     : Array<{ name: string; status: ProviderStatus; models: number }>;
  totalProviders: number;
  healthyCount  : number;
  initialized   : boolean;
}

export class AIService {
  private _initialized = false;

  /** Bootstrap providers and start health checks. Call once at app start. */
  async initialize(): Promise<void> {
    if (this._initialized) return;

    const count = bootstrapProviders();
    registerRegistryShutdownHooks();
    providerRegistry.startHealthCheckLoop(60_000);

    Logger.info('[AIService] initialized', { providersRegistered: count });
    this._initialized = true;
  }

  /**
   * Send a chat completion via llmGateway (which uses the provider registry
   * internally for routing + fallback).
   */
  async chat(
    messages: Array<{ role: string; content: string }>,
    opts    : AIChatOptions = {},
  ) {
    return llmGateway.chat(
      messages as Parameters<typeof llmGateway.chat>[0],
      {
        model         : opts.model,
        temperature   : opts.temperature,
        topP          : opts.topP,
        maxTokens     : opts.maxTokens,
        userId        : opts.userId,
        requestId     : opts.requestId,
        timeout       : opts.timeout,
        enableFallback: opts.enableFallback ?? true,
        skipCache     : opts.skipCache,
        provider      : opts.provider as any,
      },
    );
  }

  /**
   * Route to the best available provider for the given capability.
   */
  bestProviderFor(capability: ModelCapability): string | undefined {
    const query: ProviderQuery = { capability, strategy: 'reliability' };
    const result = providerRegistry.getBest(query);
    return result?.provider.name;
  }

  /**
   * List all available models across all registered providers.
   */
  async listAllModels(): Promise<IModelInfo[]> {
    return providerRegistry.listAllModels();
  }

  /** Return a health/status snapshot of all providers. */
  status(): AIServiceStatus {
    const snapshot = providerRegistry.statusSnapshot();
    const healthy  = snapshot.filter(
      s => s.status === ProviderStatus.ACTIVE || s.status === ProviderStatus.DEGRADED,
    );
    return {
      providers: snapshot.map(s => ({
        name  : s.name,
        status: s.status,
        models: 0, // populated lazily
      })),
      totalProviders: snapshot.length,
      healthyCount  : healthy.length,
      initialized   : this._initialized,
    };
  }

  /** Clean shutdown — stops health check loop and disposes providers. */
  async dispose(): Promise<void> {
    providerRegistry.stopHealthCheckLoop();
    await providerRegistry.dispose();
    Logger.info('[AIService] disposed');
  }
}

// ─── Singleton + convenience re-exports ──────────────────────────────────────

export const aiService = new AIService();

export {
  providerRegistry,
  ModelCapability,
  ProviderStatus,
  type IModelInfo,
  type ProviderQuery,
};
