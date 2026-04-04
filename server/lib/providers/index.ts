/**
 * UNIVERSAL LLM PROVIDER SYSTEM - Public API
 *
 * Import this module to access the provider registry and all providers.
 */

// Core types & base class
export { BaseProvider } from "./BaseProvider";
export type {
  ProviderCapabilities,
  ModelInfo,
  LLMMessage,
  ContentPart,
  ToolCall,
  ToolDefinition,
  LLMRequestConfig,
  LLMCompletionResponse,
  TokenUsage,
  StreamEvent,
  StreamEventType,
  ProviderHealthStatus,
  ProviderConfig,
  ProviderStatus,
} from "./BaseProvider";

// Provider implementations
export { OpenAIProvider } from "./OpenAIProvider";
export { AnthropicProvider } from "./AnthropicProvider";
export { GoogleProvider } from "./GoogleProvider";
export { XAIProvider } from "./XAIProvider";
export { DeepSeekProvider } from "./DeepSeekProvider";
export { MistralProvider } from "./MistralProvider";
export { CohereProvider } from "./CohereProvider";
export { GroqProvider } from "./GroqProvider";
export { PerplexityProvider } from "./PerplexityProvider";

// Registry
export { ProviderRegistry, providerRegistry } from "./ProviderRegistry";
export type { ProviderEntry, RoutingDecision } from "./ProviderRegistry";
