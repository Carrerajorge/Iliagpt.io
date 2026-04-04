/**
 * Universal LLM Provider System — Public API
 *
 * Import from here rather than individual files:
 *
 *   import { registry, OpenAIProvider, intelligentRouter } from '@/lib/ai/providers/core';
 */

// ── Core types ──────────────────────────────────────────────────────────────
export * from './types';

// ── Base & Registry ─────────────────────────────────────────────────────────
export { BaseProvider, exponentialBackoffWithJitter } from './BaseProvider';
export { ProviderRegistry, registry, type RegistryEvents } from './ProviderRegistry';

// ── Provider implementations ────────────────────────────────────────────────
export { OpenAIProvider } from '../implementations/OpenAIProvider';
export { AnthropicProvider } from '../implementations/AnthropicProvider';
export { GoogleProvider } from '../implementations/GoogleProvider';
export { XAIProvider } from '../implementations/XAIProvider';
export { MistralProvider } from '../implementations/MistralProvider';
export { CohereProvider } from '../implementations/CohereProvider';
export { DeepSeekProvider } from '../implementations/DeepSeekProvider';
export { GroqProvider } from '../implementations/GroqProvider';
export { TogetherProvider } from '../implementations/TogetherProvider';
export { PerplexityProvider } from '../implementations/PerplexityProvider';
export { FireworksProvider } from '../implementations/FireworksProvider';
export { OpenRouterProvider } from '../implementations/OpenRouterProvider';
export { OllamaProvider } from '../implementations/OllamaProvider';
export { LMStudioProvider } from '../implementations/LMStudioProvider';
export { AzureOpenAIProvider, type AzureProviderConfig } from '../implementations/AzureOpenAIProvider';

// ── Routing ─────────────────────────────────────────────────────────────────
export { IntelligentRouter, intelligentRouter } from '../../routing/IntelligentRouter';
export { ComplexityAnalyzer, complexityAnalyzer, type ComplexityBreakdown } from '../../routing/ComplexityAnalyzer';
export {
  CostCalculator, costCalculator,
  type CostEstimate, type CostRecord, type BudgetConfig, type BudgetStatus,
} from '../../routing/CostCalculator';

// ── Consensus ────────────────────────────────────────────────────────────────
export { ConsensusEngine, consensusEngine } from '../../consensus/ConsensusEngine';

// ── Streaming ────────────────────────────────────────────────────────────────
export {
  UniversalStreamAdapter, streamAdapter,
  chunkToSSE, sseTerminator, tee, merge,
} from '../../streaming/UniversalStreamAdapter';

// ── Factory helper ───────────────────────────────────────────────────────────

import { IProvider, IProviderConfig } from './types';
import { ProviderRegistry } from './ProviderRegistry';
import { OpenAIProvider } from '../implementations/OpenAIProvider';
import { AnthropicProvider } from '../implementations/AnthropicProvider';
import { GoogleProvider } from '../implementations/GoogleProvider';
import { XAIProvider } from '../implementations/XAIProvider';
import { MistralProvider } from '../implementations/MistralProvider';
import { CohereProvider } from '../implementations/CohereProvider';
import { DeepSeekProvider } from '../implementations/DeepSeekProvider';
import { GroqProvider } from '../implementations/GroqProvider';
import { TogetherProvider } from '../implementations/TogetherProvider';
import { PerplexityProvider } from '../implementations/PerplexityProvider';
import { FireworksProvider } from '../implementations/FireworksProvider';
import { OpenRouterProvider } from '../implementations/OpenRouterProvider';
import { OllamaProvider } from '../implementations/OllamaProvider';
import { LMStudioProvider } from '../implementations/LMStudioProvider';
import { AzureOpenAIProvider } from '../implementations/AzureOpenAIProvider';

type ProviderName =
  | 'openai' | 'anthropic' | 'google' | 'xai' | 'mistral'
  | 'cohere' | 'deepseek' | 'groq' | 'together' | 'perplexity'
  | 'fireworks' | 'openrouter' | 'ollama' | 'lmstudio' | 'azure';

const PROVIDER_CONSTRUCTORS: Record<ProviderName, new () => IProvider> = {
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
  google: GoogleProvider,
  xai: XAIProvider,
  mistral: MistralProvider,
  cohere: CohereProvider,
  deepseek: DeepSeekProvider,
  groq: GroqProvider,
  together: TogetherProvider,
  perplexity: PerplexityProvider,
  fireworks: FireworksProvider,
  openrouter: OpenRouterProvider,
  ollama: OllamaProvider,
  lmstudio: LMStudioProvider,
  azure: AzureOpenAIProvider,
};

/**
 * Convenience factory: create and register a provider by name.
 *
 * @example
 * await registerProvider('openai', { apiKey: process.env.OPENAI_API_KEY! });
 * await registerProvider('anthropic', { apiKey: process.env.ANTHROPIC_API_KEY! });
 */
export async function registerProvider(
  name: ProviderName,
  config: IProviderConfig,
  reg?: ProviderRegistry,
): Promise<IProvider> {
  const R = reg ?? ProviderRegistry.getInstance();
  const Ctor = PROVIDER_CONSTRUCTORS[name];
  if (!Ctor) throw new Error(`Unknown provider: ${name}`);
  const provider = new Ctor();
  await R.register(provider, { name, ...config });
  return provider;
}

/**
 * Register all providers whose API keys are present in the provided config map.
 * Safe to call at startup — skips providers with missing keys.
 */
export async function registerAllAvailableProviders(
  configs: Partial<Record<ProviderName, IProviderConfig>>,
  reg?: ProviderRegistry,
): Promise<string[]> {
  const registered: string[] = [];
  for (const [name, config] of Object.entries(configs) as [ProviderName, IProviderConfig][]) {
    if (!config) continue;
    try {
      await registerProvider(name, config, reg);
      registered.push(name);
    } catch (err) {
      // Log but don't throw — partial registration is fine
      console.warn(`[ProviderSystem] Failed to register ${name}:`, err instanceof Error ? err.message : err);
    }
  }
  return registered;
}
