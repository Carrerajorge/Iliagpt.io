/**
 * Universal LLM Provider System - Core Types
 * Standardized interfaces for all AI provider interactions
 */

// ─────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────

export enum ProviderStatus {
  HEALTHY = "healthy",
  DEGRADED = "degraded",
  UNAVAILABLE = "unavailable",
  RATE_LIMITED = "rate_limited",
  INITIALIZING = "initializing",
}

export enum ModelCapability {
  CHAT = "chat",
  VISION = "vision",
  CODE = "code",
  EMBEDDING = "embedding",
  REASONING = "reasoning",
  FUNCTION_CALLING = "function_calling",
  SEARCH = "search",
  AUDIO = "audio",
  VIDEO = "video",
  LONG_CONTEXT = "long_context",
}

export enum MessageRole {
  SYSTEM = "system",
  USER = "user",
  ASSISTANT = "assistant",
  TOOL = "tool",
  FUNCTION = "function",
}

export enum FinishReason {
  STOP = "stop",
  LENGTH = "length",
  TOOL_CALL = "tool_call",
  CONTENT_FILTER = "content_filter",
  ERROR = "error",
}

export enum RoutingStrategy {
  COST_OPTIMIZED = "cost_optimized",
  QUALITY_FIRST = "quality_first",
  BALANCED = "balanced",
  SPEED_FIRST = "speed_first",
}

// ─────────────────────────────────────────────
// Message Types
// ─────────────────────────────────────────────

export interface ITextContent {
  type: "text";
  text: string;
}

export interface IImageContent {
  type: "image";
  url?: string;
  base64?: string;
  mimeType?: string;
}

export interface IToolCallContent {
  type: "tool_call";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface IToolResultContent {
  type: "tool_result";
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export type MessageContent =
  | string
  | ITextContent
  | IImageContent
  | IToolCallContent
  | IToolResultContent
  | Array<ITextContent | IImageContent | IToolCallContent | IToolResultContent>;

export interface IChatMessage {
  role: MessageRole;
  content: MessageContent;
  name?: string;
  toolCallId?: string;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────
// Tool / Function Calling Types
// ─────────────────────────────────────────────

export interface IToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, IToolParameter>;
  required?: string[];
  items?: IToolParameter;
}

export interface ITool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, IToolParameter>;
    required?: string[];
  };
}

export interface IToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// ─────────────────────────────────────────────
// Request / Response Types
// ─────────────────────────────────────────────

export interface IChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
  tools?: ITool[];
  toolChoice?: "auto" | "none" | "required" | { name: string };
  systemPrompt?: string;
  responseFormat?: "text" | "json" | { type: "json_schema"; schema: unknown };
  seed?: number;
  userId?: string;
  stream?: boolean;
  timeout?: number;
  metadata?: Record<string, unknown>;
}

export interface IUsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
}

export interface IChatResponse {
  id: string;
  model: string;
  provider: string;
  content: string;
  toolCalls?: IToolCall[];
  finishReason: FinishReason;
  usage: IUsageStats;
  cost?: number;
  latencyMs: number;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface IStreamChunk {
  id: string;
  delta: string;
  toolCallDelta?: Partial<IToolCall>;
  finishReason?: FinishReason;
  usage?: IUsageStats;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────
// Model Info
// ─────────────────────────────────────────────

export interface IModelPricing {
  inputPerMillion: number;   // USD per million input tokens
  outputPerMillion: number;  // USD per million output tokens
  cachedInputPerMillion?: number;
  imagePerUnit?: number;     // USD per image
  embeddingPerMillion?: number;
}

export interface IModelInfo {
  id: string;
  name: string;
  provider: string;
  capabilities: ModelCapability[];
  contextWindow: number;
  maxOutputTokens?: number;
  pricing: IModelPricing;
  isDeprecated?: boolean;
  releaseDate?: Date;
  knowledgeCutoff?: Date;
  description?: string;
}

// ─────────────────────────────────────────────
// Provider Config & Health
// ─────────────────────────────────────────────

export interface IProviderConfig {
  id: string;
  name: string;
  apiKey?: string;
  baseUrl?: string;
  organizationId?: string;
  projectId?: string;
  region?: string;
  timeout?: number;
  maxRetries?: number;
  rateLimitRpm?: number;     // requests per minute
  rateLimitTpm?: number;     // tokens per minute
  defaultModel?: string;
  customHeaders?: Record<string, string>;
  enabled?: boolean;
}

export interface IProviderHealth {
  providerId: string;
  status: ProviderStatus;
  latencyMs?: number;
  errorRate?: number;         // 0-1
  lastCheckedAt: Date;
  lastSuccessAt?: Date;
  lastErrorAt?: Date;
  lastError?: string;
  consecutiveErrors: number;
  requestCount: number;
  successCount: number;
}

// ─────────────────────────────────────────────
// Cost Reporting
// ─────────────────────────────────────────────

export interface ICostEntry {
  requestId: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  timestamp: Date;
  userId?: string;
  sessionId?: string;
}

export interface ICostReport {
  period: { start: Date; end: Date };
  totalCost: number;
  byProvider: Record<string, number>;
  byModel: Record<string, number>;
  byUser?: Record<string, number>;
  totalRequests: number;
  totalTokens: number;
  entries: ICostEntry[];
}

// ─────────────────────────────────────────────
// Embedding Types
// ─────────────────────────────────────────────

export interface IEmbeddingOptions {
  model?: string;
  dimensions?: number;
  userId?: string;
}

export interface IEmbeddingResponse {
  id: string;
  provider: string;
  model: string;
  embeddings: number[][];
  usage: { totalTokens: number };
  cost?: number;
  latencyMs: number;
}

// ─────────────────────────────────────────────
// Provider Interface
// ─────────────────────────────────────────────

export interface IProvider {
  readonly id: string;
  readonly name: string;
  readonly config: IProviderConfig;
  readonly health: IProviderHealth;

  chat(messages: IChatMessage[], options?: IChatOptions): Promise<IChatResponse>;
  stream(messages: IChatMessage[], options?: IChatOptions): AsyncIterable<IStreamChunk>;
  embed(texts: string[], options?: IEmbeddingOptions): Promise<IEmbeddingResponse>;
  listModels(): Promise<IModelInfo[]>;
  checkHealth(): Promise<IProviderHealth>;
  isCapable(capability: ModelCapability): boolean;
}

// ─────────────────────────────────────────────
// Registry Events
// ─────────────────────────────────────────────

export interface IProviderEvent {
  type: "registered" | "unregistered" | "health_changed" | "error";
  providerId: string;
  timestamp: Date;
  data?: unknown;
}

// ─────────────────────────────────────────────
// Error Types
// ─────────────────────────────────────────────

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly providerId: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class RateLimitError extends ProviderError {
  constructor(
    providerId: string,
    public readonly retryAfterMs?: number,
    originalError?: unknown,
  ) {
    super("Rate limit exceeded", providerId, "RATE_LIMIT", 429, true, originalError);
    this.name = "RateLimitError";
  }
}

export class AuthenticationError extends ProviderError {
  constructor(providerId: string, originalError?: unknown) {
    super("Authentication failed", providerId, "AUTH_ERROR", 401, false, originalError);
    this.name = "AuthenticationError";
  }
}

export class ModelNotFoundError extends ProviderError {
  constructor(providerId: string, modelId: string) {
    super(`Model '${modelId}' not found`, providerId, "MODEL_NOT_FOUND", 404, false);
    this.name = "ModelNotFoundError";
  }
}

export class ContextLengthError extends ProviderError {
  constructor(providerId: string, maxTokens: number, requestedTokens: number) {
    super(
      `Context length exceeded: requested ${requestedTokens}, max ${maxTokens}`,
      providerId,
      "CONTEXT_LENGTH",
      400,
      false,
    );
    this.name = "ContextLengthError";
  }
}
