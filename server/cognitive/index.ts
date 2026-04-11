/**
 * Cognitive Middleware — public surface.
 *
 * Exports the entire cognitive layer in one place. Callers should
 * import from `@/server/cognitive` (or wherever the path resolves)
 * rather than reaching into individual files — this lets us
 * refactor file boundaries without breaking consumers.
 */

// Type contracts (the SHAPE LAYER)
export type {
  CognitiveIntent,
  IntentClassification,
  CognitiveRequest,
  CognitiveResponse,
  CognitiveTelemetry,
  RoutingDecision,
  ValidationReport,
  ValidationIssue,
  ValidationSeverity,
  ProviderAdapter,
  ProviderMessage,
  ProviderMessageRole,
  ProviderToolDescriptor,
  ProviderToolCall,
  ProviderResponse,
  ProviderFinishReason,
  ProviderUsage,
  NormalizedProviderRequest,
} from "./types";

// Intent router
export { classifyIntent, evaluateRules } from "./intentRouter";

// Output validator
export { validateOutput, type ValidateOutputOptions } from "./outputValidator";

// Orchestrator
export {
  CognitiveMiddleware,
  type CognitiveMiddlewareOptions,
  selectProvider,
  buildNormalizedRequest,
  callProviderWithRetry,
} from "./cognitiveMiddleware";

// Mock provider adapters (for tests + smoke tests)
export {
  EchoMockAdapter,
  ScriptedMockAdapter,
  FailingMockAdapter,
  AbortableMockAdapter,
  ToolEmittingMockAdapter,
} from "./providerAdapters/mockAdapter";

// Real provider adapters (Turn A of the cognitive roadmap)
export {
  SmartRouterAdapter,
  type SmartRouterAdapterOptions,
  type GatewayMessage,
  type GatewayRequestOptions,
  type GatewayResponse,
  type GatewayResponseUsage,
  type GatewayResponseStatus,
  type GatewayIncompleteDetails,
  type GatewayChatFn,
  mapGatewayFinishReason,
  translateGatewayResponse,
} from "./providerAdapters/smartRouterAdapter";

export {
  InHouseGptAdapter,
  type InHouseGptAdapterOptions,
} from "./providerAdapters/inHouseGptAdapter";
