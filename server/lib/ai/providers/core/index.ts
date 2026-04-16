/**
 * Universal Provider System — Main Entry Point
 *
 * Automatically registers providers based on available environment variables.
 * Import this file once at app startup to initialize the provider system.
 */

export * from "./types.js";
export * from "./BaseProvider.js";
export { ProviderRegistry, providerRegistry } from "./ProviderRegistry.js";

// Provider Implementations
export { OpenAIProvider } from "../implementations/OpenAIProvider.js";
export { AnthropicProvider } from "../implementations/AnthropicProvider.js";
export { GoogleProvider } from "../implementations/GoogleProvider.js";
export { XAIProvider } from "../implementations/XAIProvider.js";
export { MistralProvider } from "../implementations/MistralProvider.js";
export { CohereProvider } from "../implementations/CohereProvider.js";
export { DeepSeekProvider } from "../implementations/DeepSeekProvider.js";
export { GroqProvider } from "../implementations/GroqProvider.js";
export { TogetherProvider } from "../implementations/TogetherProvider.js";
export { PerplexityProvider } from "../implementations/PerplexityProvider.js";
export { FireworksProvider } from "../implementations/FireworksProvider.js";
export { OpenRouterProvider } from "../implementations/OpenRouterProvider.js";
export { OllamaProvider } from "../implementations/OllamaProvider.js";
export { LMStudioProvider } from "../implementations/LMStudioProvider.js";
export { AzureOpenAIProvider } from "../implementations/AzureOpenAIProvider.js";

import { ProviderRegistry } from "./ProviderRegistry.js";
import { OpenAIProvider } from "../implementations/OpenAIProvider.js";
import { AnthropicProvider } from "../implementations/AnthropicProvider.js";
import { GoogleProvider } from "../implementations/GoogleProvider.js";
import { XAIProvider } from "../implementations/XAIProvider.js";
import { MistralProvider } from "../implementations/MistralProvider.js";
import { CohereProvider } from "../implementations/CohereProvider.js";
import { DeepSeekProvider } from "../implementations/DeepSeekProvider.js";
import { GroqProvider } from "../implementations/GroqProvider.js";
import { TogetherProvider } from "../implementations/TogetherProvider.js";
import { PerplexityProvider } from "../implementations/PerplexityProvider.js";
import { FireworksProvider } from "../implementations/FireworksProvider.js";
import { OpenRouterProvider } from "../implementations/OpenRouterProvider.js";
import { OllamaProvider } from "../implementations/OllamaProvider.js";
import { LMStudioProvider } from "../implementations/LMStudioProvider.js";
import { AzureOpenAIProvider } from "../implementations/AzureOpenAIProvider.js";

/**
 * Initialize the provider registry from environment variables.
 * Call this once during application startup.
 *
 * @returns The initialized registry with all configured providers
 */
export function initializeProviders(): ProviderRegistry {
  const registry = ProviderRegistry.getInstance();
  const env = process.env;

  // ─── Cloud Providers ───

  if (env.OPENAI_API_KEY) {
    registry.register(new OpenAIProvider({
      apiKey: env.OPENAI_API_KEY,
      organizationId: env.OPENAI_ORG_ID,
      baseUrl: env.OPENAI_BASE_URL,
    }));
  }

  if (env.ANTHROPIC_API_KEY) {
    registry.register(new AnthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      baseUrl: env.ANTHROPIC_BASE_URL,
    }));
  }

  if (env.GOOGLE_GENERATIVE_AI_API_KEY ?? env.GEMINI_API_KEY) {
    registry.register(new GoogleProvider({
      apiKey: (env.GOOGLE_GENERATIVE_AI_API_KEY ?? env.GEMINI_API_KEY) as string,
    }));
  }

  if (env.XAI_API_KEY) {
    registry.register(new XAIProvider({
      apiKey: env.XAI_API_KEY,
    }));
  }

  if (env.MISTRAL_API_KEY) {
    registry.register(new MistralProvider({
      apiKey: env.MISTRAL_API_KEY,
    }));
  }

  if (env.COHERE_API_KEY) {
    registry.register(new CohereProvider({
      apiKey: env.COHERE_API_KEY,
    }));
  }

  if (env.DEEPSEEK_API_KEY) {
    registry.register(new DeepSeekProvider({
      apiKey: env.DEEPSEEK_API_KEY,
    }));
  }

  if (env.GROQ_API_KEY) {
    registry.register(new GroqProvider({
      apiKey: env.GROQ_API_KEY,
    }));
  }

  if (env.TOGETHER_API_KEY) {
    registry.register(new TogetherProvider({
      apiKey: env.TOGETHER_API_KEY,
    }));
  }

  if (env.PERPLEXITY_API_KEY) {
    registry.register(new PerplexityProvider({
      apiKey: env.PERPLEXITY_API_KEY,
    }));
  }

  if (env.FIREWORKS_API_KEY) {
    registry.register(new FireworksProvider({
      apiKey: env.FIREWORKS_API_KEY,
    }));
  }

  if (env.OPENROUTER_API_KEY) {
    registry.register(new OpenRouterProvider({
      apiKey: env.OPENROUTER_API_KEY,
    }));
  }

  // ─── Azure OpenAI ───

  if (env.AZURE_OPENAI_API_KEY && env.AZURE_OPENAI_ENDPOINT) {
    registry.register(new AzureOpenAIProvider({
      apiKey: env.AZURE_OPENAI_API_KEY,
      endpoint: env.AZURE_OPENAI_ENDPOINT,
      apiVersion: env.AZURE_OPENAI_API_VERSION,
    }));
  }

  // ─── Local Providers (always attempt to register, gracefully fail if not running) ───

  if (env.OLLAMA_HOST !== "disabled") {
    registry.register(new OllamaProvider({
      baseUrl: env.OLLAMA_HOST ?? "http://localhost:11434",
    }));
  }

  if (env.LM_STUDIO_HOST !== "disabled") {
    registry.register(new LMStudioProvider({
      baseUrl: env.LM_STUDIO_HOST ?? "http://localhost:1234/v1",
    }));
  }

  const summary = registry.getHealthySummary();
  console.log(
    `[ProviderRegistry] Initialized with ${summary.total} providers.`,
    `(${summary.healthy} healthy, ${summary.degraded} degraded, ${summary.unavailable} unavailable)`,
  );

  return registry;
}
