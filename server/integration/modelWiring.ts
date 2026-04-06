/**
 * modelWiring
 *
 * Auto-detects available LLM providers from environment variables, selects
 * the best default model, and exposes a unified call interface used by the
 * agentic integration layer.
 *
 * Priority order (highest capability first):
 *   claude-opus-4   → claude-sonnet-4-6 → gpt-4o → gemini-2.0-flash → local
 */

import { Logger } from '../lib/logger';

// ─── Provider catalogue ───────────────────────────────────────────────────────

export type ProviderName = 'anthropic' | 'openai' | 'gemini' | 'xai' | 'deepseek' | 'local';

export interface ProviderConfig {
  name        : ProviderName;
  available   : boolean;
  defaultModel: string;
  apiKey?     : string;
  baseUrl?    : string;
}

export interface ModelWiringConfig {
  defaultProvider: ProviderName;
  defaultModel   : string;
  providers      : Map<ProviderName, ProviderConfig>;
  fallbackChain  : string[];   // model ids in priority order
}

function readConfiguredValue(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.toLowerCase();
  if (normalized === 'undefined' || normalized === 'null' || normalized === 'missing') {
    return undefined;
  }
  return trimmed;
}

// ─── Detection ────────────────────────────────────────────────────────────────

function detectProviders(): Map<ProviderName, ProviderConfig> {
  const configs = new Map<ProviderName, ProviderConfig>();

  const anthropicKey = readConfiguredValue('ANTHROPIC_API_KEY');
  configs.set('anthropic', {
    name        : 'anthropic',
    available   : !!anthropicKey,
    defaultModel: process.env['ANTHROPIC_DEFAULT_MODEL'] ?? 'claude-sonnet-4-6',
    apiKey      : anthropicKey,
  });

  const openaiKey = readConfiguredValue('OPENAI_API_KEY');
  configs.set('openai', {
    name        : 'openai',
    available   : !!openaiKey,
    defaultModel: process.env['OPENAI_DEFAULT_MODEL'] ?? 'gpt-4o',
    apiKey      : openaiKey,
  });

  const geminiKey = readConfiguredValue('GEMINI_API_KEY') ?? readConfiguredValue('GOOGLE_API_KEY');
  configs.set('gemini', {
    name        : 'gemini',
    available   : !!geminiKey,
    defaultModel: process.env['GEMINI_DEFAULT_MODEL'] ?? 'gemini-2.0-flash',
    apiKey      : geminiKey,
  });

  const xaiKey = readConfiguredValue('XAI_API_KEY');
  configs.set('xai', {
    name        : 'xai',
    available   : !!xaiKey,
    defaultModel: process.env['XAI_DEFAULT_MODEL'] ?? 'grok-beta',
    apiKey      : xaiKey,
  });

  const deepseekKey = readConfiguredValue('DEEPSEEK_API_KEY');
  configs.set('deepseek', {
    name        : 'deepseek',
    available   : !!deepseekKey,
    defaultModel: 'deepseek-chat',
    apiKey      : deepseekKey,
  });

  const localUrl = readConfiguredValue('LOCAL_LLM_URL');
  configs.set('local', {
    name        : 'local',
    available   : !!localUrl,
    defaultModel: process.env['LOCAL_LLM_MODEL'] ?? 'local',
    baseUrl     : localUrl,
  });

  return configs;
}

function buildFallbackChain(providers: Map<ProviderName, ProviderConfig>): string[] {
  const order: ProviderName[] = ['anthropic', 'openai', 'gemini', 'xai', 'deepseek', 'local'];
  const chain: string[] = [];
  for (const name of order) {
    const cfg = providers.get(name);
    if (cfg?.available) chain.push(cfg.defaultModel);
  }
  return chain;
}

function pickDefaultProvider(providers: Map<ProviderName, ProviderConfig>): ProviderConfig {
  const order: ProviderName[] = ['anthropic', 'openai', 'gemini', 'xai', 'deepseek', 'local'];
  for (const name of order) {
    const cfg = providers.get(name);
    if (cfg?.available) return cfg;
  }
  // No external providers — fall back to "auto" which llmGateway resolves
  return { name: 'anthropic', available: false, defaultModel: 'auto' };
}

// ─── Public API ───────────────────────────────────────────────────────────────

let _config: ModelWiringConfig | null = null;

export function initModelWiring(): ModelWiringConfig {
  const providers      = detectProviders();
  const defaultCfg     = pickDefaultProvider(providers);
  const fallbackChain  = buildFallbackChain(providers);

  _config = {
    defaultProvider: defaultCfg.name,
    defaultModel   : defaultCfg.defaultModel,
    providers,
    fallbackChain,
  };

  const available = [...providers.entries()]
    .filter(([, v]) => v.available)
    .map(([k]) => k);

  Logger.info('[ModelWiring] initialized', {
    defaultModel  : _config.defaultModel,
    defaultProvider: _config.defaultProvider,
    available,
    fallbackChain,
  });

  return _config;
}

export function getModelConfig(): ModelWiringConfig {
  if (!_config) return initModelWiring();
  return _config;
}

/**
 * Resolve the best model for a given request.
 * Returns the first available model from the fallback chain,
 * or 'auto' if nothing is configured (llmGateway will handle).
 */
export function resolveModel(requested?: string): string {
  if (requested && requested !== 'auto') return requested;
  const cfg = getModelConfig();
  return cfg.fallbackChain[0] ?? 'auto';
}

/**
 * Detect which provider owns a model string.
 */
export function detectProvider(model: string): ProviderName {
  if (/^claude/i.test(model))                         return 'anthropic';
  if (/^gpt|^o[1-9]|^chatgpt/i.test(model))          return 'openai';
  if (/^gemini/i.test(model))                         return 'gemini';
  if (/^grok/i.test(model))                           return 'xai';
  if (/^deepseek/i.test(model))                       return 'deepseek';
  if (/^local/i.test(model))                          return 'local';

  // Fall back to default configured provider
  return getModelConfig().defaultProvider;
}

/**
 * Check whether tool calling is natively supported for this model.
 * Models without native tool calling use generic JSON prompting.
 */
export function supportsNativeToolCalling(model: string): boolean {
  const provider = detectProvider(model);
  // All major providers support tool calling; local models may not
  return provider !== 'local';
}
