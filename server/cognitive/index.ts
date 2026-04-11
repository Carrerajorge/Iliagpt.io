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
  ProviderStreamChunk,
  NormalizedProviderRequest,
  CognitiveStreamEvent,
} from "./types";

// Intent router
export { classifyIntent, evaluateRules } from "./intentRouter";

// Output validator
export { validateOutput, type ValidateOutputOptions } from "./outputValidator";

// Context enrichment layer (Turn C)
export type {
  ContextChunk,
  ContextSourceKind,
  ContextBundle,
  ContextTelemetry,
  MemoryRecord,
  MemoryStore,
  DocumentChunkRecord,
  DocumentStore,
  ContextEnricherOptions,
} from "./context";
export { enrichContext, renderContextBundle } from "./contextEnricher";
export {
  InMemoryMemoryStore,
  InMemoryDocumentStore,
  tokenizeForContext,
  scoreQueryAgainst,
  type InMemoryMemoryStoreOptions,
  type InMemoryDocumentStoreOptions,
  type InMemoryDocument,
} from "./contextStores";

// Tool execution layer (Turn D)
export type {
  ToolExecutionContext,
  ToolExecutionOutcome,
  ToolExecutionErrorCode,
  ToolHandler,
  RegisteredTool,
  ToolRegistry,
} from "./tools";
export {
  InMemoryToolRegistry,
  DEFAULT_TOOL_TIMEOUT_MS,
  serializeToolOutcomeForModel,
} from "./tools";
export type { ToolExecutionOutcomeLike } from "./types";

// Rate limit + circuit breaker layer (Turn E)
export type {
  RateLimiter,
  RateLimitCheckResult,
  TokenBucketOptions,
} from "./rateLimit";
export {
  InMemoryTokenBucketLimiter,
  UnboundedRateLimiter,
  defaultRateLimitKey,
} from "./rateLimit";
export type {
  CircuitBreakerState,
  CircuitBreakerOptions,
  CircuitBreakerStatus,
  CircuitBreakerRegistryOptions,
} from "./circuitBreaker";
export {
  CircuitBreaker,
  CircuitBreakerRegistry,
} from "./circuitBreaker";

// OpenTelemetry tracing facade (Turn F)
export {
  getCognitiveTracer,
  resetCognitiveTracerCache,
  withCognitiveSpan,
  withCognitiveSpanSync,
  CognitiveSpanNames,
  CognitiveAttributes,
  COGNITIVE_TRACER_NAME,
  COGNITIVE_TRACER_VERSION,
  type CognitiveSpanName,
  type CognitiveAttributeKey,
} from "./tracing";

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
  StreamingMockAdapter,
  type StreamingMockAdapterOptions,
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
