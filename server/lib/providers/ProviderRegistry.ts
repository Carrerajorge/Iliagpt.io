/**
 * UNIVERSAL PROVIDER REGISTRY
 *
 * Central registry that manages all LLM provider instances.
 * Supports dynamic registration, auto-discovery from environment,
 * provider health monitoring, and intelligent routing.
 */

import { EventEmitter } from "events";
import { BaseProvider, type ModelInfo, type ProviderHealthStatus, type ProviderConfig } from "./BaseProvider";
import { OpenAIProvider } from "./OpenAIProvider";
import { AnthropicProvider } from "./AnthropicProvider";
import { GoogleProvider } from "./GoogleProvider";
import { XAIProvider } from "./XAIProvider";
import { DeepSeekProvider } from "./DeepSeekProvider";
import { MistralProvider } from "./MistralProvider";
import { CohereProvider } from "./CohereProvider";
import { GroqProvider } from "./GroqProvider";
import { PerplexityProvider } from "./PerplexityProvider";

export interface ProviderEntry {
  provider: BaseProvider;
  priority: number;
  enabled: boolean;
  registeredAt: number;
}

export interface RoutingDecision {
  provider: BaseProvider;
  model: string;
  reason: string;
  alternatives: Array<{ provider: string; model: string }>;
}

type RoutingStrategy = "cost" | "speed" | "quality" | "balanced" | "failover";

export class ProviderRegistry extends EventEmitter {
  private providers: Map<string, ProviderEntry> = new Map();
  private modelToProvider: Map<string, string> = new Map();
  private allModelsCache: ModelInfo[] | null = null;
  private allModelsCacheTime: number = 0;
  private readonly MODELS_CACHE_TTL = 300000; // 5 min

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  // ===== Registration =====

  register(provider: BaseProvider, priority: number = 50, enabled: boolean = true): void {
    const existing = this.providers.get(provider.name);
    if (existing) {
      existing.provider.destroy();
    }
    this.providers.set(provider.name, { provider, priority, enabled, registeredAt: Date.now() });
    this.allModelsCache = null; // Invalidate cache
    this.emit("providerRegistered", { name: provider.name, priority, enabled });
    console.log(`[ProviderRegistry] Registered: ${provider.displayName} (priority=${priority}, enabled=${enabled})`);
  }

  unregister(name: string): boolean {
    const entry = this.providers.get(name);
    if (entry) {
      entry.provider.destroy();
      this.providers.delete(name);
      this.allModelsCache = null;
      this.emit("providerUnregistered", { name });
      return true;
    }
    return false;
  }

  // ===== Auto-Discovery =====

  async autoDiscover(): Promise<string[]> {
    const discovered: string[] = [];

    const builtinProviders: Array<{ factory: () => BaseProvider; priority: number }> = [
      { factory: () => new XAIProvider(), priority: 90 },
      { factory: () => new OpenAIProvider(), priority: 80 },
      { factory: () => new AnthropicProvider(), priority: 85 },
      { factory: () => new GoogleProvider(), priority: 75 },
      { factory: () => new DeepSeekProvider(), priority: 60 },
      { factory: () => new MistralProvider(), priority: 55 },
      { factory: () => new CohereProvider(), priority: 50 },
      { factory: () => new GroqProvider(), priority: 70 },
      { factory: () => new PerplexityProvider(), priority: 65 },
    ];

    // Auto-discover OpenAI-compatible providers from env
    const customEndpoints = this.discoverCustomEndpoints();
    for (const ep of customEndpoints) {
      builtinProviders.push({
        factory: () => new OpenAIProvider({ apiKey: ep.apiKey, baseUrl: ep.baseUrl }),
        priority: 40,
      });
    }

    for (const { factory, priority } of builtinProviders) {
      try {
        const provider = factory();
        if (provider.isConfigured()) {
          this.register(provider, priority);
          discovered.push(provider.name);
        }
      } catch (err) {
        console.warn(`[ProviderRegistry] Failed to initialize provider:`, err);
      }
    }

    console.log(`[ProviderRegistry] Auto-discovered ${discovered.length} providers: [${discovered.join(", ")}]`);
    return discovered;
  }

  private discoverCustomEndpoints(): Array<{ name: string; baseUrl: string; apiKey: string }> {
    const endpoints: Array<{ name: string; baseUrl: string; apiKey: string }> = [];

    // Scan env vars for patterns like PROVIDER_<NAME>_BASE_URL + PROVIDER_<NAME>_API_KEY
    for (const [key, value] of Object.entries(process.env)) {
      const match = key.match(/^PROVIDER_(\w+)_BASE_URL$/);
      if (match && value) {
        const name = match[1].toLowerCase();
        const apiKey = process.env[`PROVIDER_${match[1]}_API_KEY`];
        if (apiKey) {
          endpoints.push({ name, baseUrl: value, apiKey });
        }
      }
    }

    // Also check well-known alternatives
    if (process.env.TOGETHER_API_KEY) {
      endpoints.push({ name: "together", baseUrl: "https://api.together.xyz/v1", apiKey: process.env.TOGETHER_API_KEY });
    }
    if (process.env.FIREWORKS_API_KEY) {
      endpoints.push({ name: "fireworks", baseUrl: "https://api.fireworks.ai/inference/v1", apiKey: process.env.FIREWORKS_API_KEY });
    }
    if (process.env.OPENROUTER_API_KEY) {
      endpoints.push({ name: "openrouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY });
    }
    if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST) {
      endpoints.push({ name: "ollama", baseUrl: process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || "http://localhost:11434/v1", apiKey: "ollama" });
    }
    if (process.env.LMSTUDIO_BASE_URL) {
      endpoints.push({ name: "lmstudio", baseUrl: process.env.LMSTUDIO_BASE_URL || "http://localhost:1234/v1", apiKey: "lm-studio" });
    }

    return endpoints;
  }

  // ===== Provider Access =====

  get(name: string): BaseProvider | undefined {
    const entry = this.providers.get(name);
    return entry?.enabled ? entry.provider : undefined;
  }

  getAll(): BaseProvider[] {
    return Array.from(this.providers.values())
      .filter((e) => e.enabled)
      .sort((a, b) => b.priority - a.priority)
      .map((e) => e.provider);
  }

  getEnabled(): string[] {
    return this.getAll().map((p) => p.name);
  }

  isAvailable(name: string): boolean {
    const entry = this.providers.get(name);
    return !!(entry?.enabled && entry.provider.isConfigured());
  }

  // ===== Model Discovery =====

  async getAllModels(forceRefresh: boolean = false): Promise<ModelInfo[]> {
    if (!forceRefresh && this.allModelsCache && Date.now() - this.allModelsCacheTime < this.MODELS_CACHE_TTL) {
      return this.allModelsCache;
    }

    const allModels: ModelInfo[] = [];
    const providers = this.getAll();

    const results = await Promise.allSettled(providers.map((p) => p.listModels()));

    results.forEach((result, idx) => {
      if (result.status === "fulfilled") {
        for (const model of result.value) {
          allModels.push(model);
          this.modelToProvider.set(model.id.toLowerCase(), providers[idx].name);
        }
      }
    });

    this.allModelsCache = allModels;
    this.allModelsCacheTime = Date.now();
    return allModels;
  }

  getProviderForModel(modelId: string): BaseProvider | undefined {
    const providerName = this.modelToProvider.get(modelId.toLowerCase());
    if (providerName) return this.get(providerName);

    // Heuristic detection
    const normalized = modelId.toLowerCase();
    if (normalized.includes("gpt") || normalized.includes("o1") || normalized.includes("o3") || normalized.includes("o4")) return this.get("openai");
    if (normalized.includes("claude")) return this.get("anthropic");
    if (normalized.includes("gemini")) return this.get("gemini");
    if (normalized.includes("grok")) return this.get("xai");
    if (normalized.includes("deepseek")) return this.get("deepseek");
    if (normalized.includes("mistral") || normalized.includes("codestral") || normalized.includes("pixtral")) return this.get("mistral");
    if (normalized.includes("command")) return this.get("cohere");
    if (normalized.includes("llama") || normalized.includes("mixtral") || normalized.includes("gemma")) return this.get("groq");
    if (normalized.includes("sonar")) return this.get("perplexity");

    // Try OpenAI-compatible (OpenRouter) for slash-format models
    if (normalized.includes("/")) return this.get("openai");

    return undefined;
  }

  // ===== Intelligent Routing =====

  async route(modelId: string, strategy: RoutingStrategy = "balanced"): Promise<RoutingDecision> {
    const primary = this.getProviderForModel(modelId);
    const alternatives: Array<{ provider: string; model: string }> = [];

    if (primary && primary.status !== "unavailable") {
      // Build alternatives list
      const allProviders = this.getAll().filter((p) => p.name !== primary.name && p.status !== "unavailable");
      for (const alt of allProviders.slice(0, 3)) {
        const models = await alt.listModels().catch(() => []);
        const suitable = models.find((m) => this.isModelSuitable(m, modelId, strategy));
        if (suitable) alternatives.push({ provider: alt.name, model: suitable.id });
      }

      return { provider: primary, model: modelId, reason: "primary_match", alternatives };
    }

    // Primary unavailable - find alternative
    const allProviders = this.getAll().filter((p) => p.status !== "unavailable");
    for (const alt of allProviders) {
      const models = await alt.listModels().catch(() => []);
      const suitable = this.findBestAlternative(models, modelId, strategy);
      if (suitable) {
        return { provider: alt, model: suitable.id, reason: "fallback", alternatives: [] };
      }
    }

    throw new Error(`No available provider for model: ${modelId}`);
  }

  private isModelSuitable(model: ModelInfo, requestedModel: string, strategy: RoutingStrategy): boolean {
    const requested = requestedModel.toLowerCase();
    const modelCategory = model.category;

    if (requested.includes("reason") && modelCategory !== "reasoning") return false;
    if (requested.includes("code") && modelCategory !== "code" && modelCategory !== "chat") return false;
    if (requested.includes("vision") && !model.capabilities.vision) return false;

    return true;
  }

  private findBestAlternative(models: ModelInfo[], requestedModel: string, strategy: RoutingStrategy): ModelInfo | null {
    const scored = models.map((m) => ({
      model: m,
      score: this.scoreModel(m, strategy),
    })).sort((a, b) => b.score - a.score);

    return scored[0]?.model || null;
  }

  private scoreModel(model: ModelInfo, strategy: RoutingStrategy): number {
    let score = 50;
    switch (strategy) {
      case "cost":
        score += Math.max(0, 100 - model.inputPricePerMillion * 10);
        break;
      case "speed":
        if (model.tags?.includes("fast")) score += 30;
        if (model.tier === "free") score += 20;
        break;
      case "quality":
        if (model.tier === "premium") score += 40;
        if (model.tier === "enterprise") score += 50;
        score += model.contextWindow > 100000 ? 20 : 0;
        break;
      case "balanced":
        if (model.tier === "standard") score += 20;
        score += Math.max(0, 50 - model.inputPricePerMillion * 5);
        if (model.tags?.includes("fast")) score += 10;
        break;
      case "failover":
        if (model.tier !== "free") score += 10;
        break;
    }
    return score;
  }

  // ===== Health =====

  async healthCheckAll(): Promise<Map<string, ProviderHealthStatus>> {
    const results = new Map<string, ProviderHealthStatus>();
    const providers = this.getAll();

    await Promise.allSettled(
      providers.map(async (p) => {
        await p.healthCheck();
        results.set(p.name, p.getHealth());
      })
    );

    return results;
  }

  getHealthSummary(): Record<string, ProviderHealthStatus> {
    const summary: Record<string, ProviderHealthStatus> = {};
    for (const [name, entry] of this.providers) {
      if (entry.enabled) {
        summary[name] = entry.provider.getHealth();
      }
    }
    return summary;
  }

  // ===== Lifecycle =====

  destroy(): void {
    for (const [, entry] of this.providers) {
      entry.provider.destroy();
    }
    this.providers.clear();
    this.modelToProvider.clear();
    this.allModelsCache = null;
    this.removeAllListeners();
  }

  getStats(): {
    totalProviders: number;
    enabledProviders: number;
    configuredProviders: number;
    totalModels: number;
  } {
    const entries = Array.from(this.providers.values());
    return {
      totalProviders: entries.length,
      enabledProviders: entries.filter((e) => e.enabled).length,
      configuredProviders: entries.filter((e) => e.provider.isConfigured()).length,
      totalModels: this.allModelsCache?.length || 0,
    };
  }
}

// Singleton
export const providerRegistry = new ProviderRegistry();
