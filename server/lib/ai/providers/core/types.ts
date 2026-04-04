/**
 * Universal LLM Provider System — Core Types & Interfaces
 * Shared contracts used by every provider, router, and consumer.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export enum ProviderStatus {
  Active = 'active',
  Degraded = 'degraded',
  Unavailable = 'unavailable',
  RateLimited = 'rate_limited',
  Initializing = 'initializing',
}

export enum ModelCapability {
  Chat = 'chat',
  Completion = 'completion',
  Embedding = 'embedding',
  ImageGeneration = 'image_generation',
  ImageUnderstanding = 'image_understanding',
  AudioTranscription = 'audio_transcription',
  AudioGeneration = 'audio_generation',
  FunctionCalling = 'function_calling',
  JsonMode = 'json_mode',
  Streaming = 'streaming',
  LongContext = 'long_context',
  Reasoning = 'reasoning',
  CodeGeneration = 'code_generation',
}

export enum RoutingStrategy {
  Cheapest = 'cheapest',
  Fastest = 'fastest',
  Balanced = 'balanced',
  HighestQuality = 'highest_quality',
  Random = 'random',
}

export enum MessageRole {
  System = 'system',
  User = 'user',
  Assistant = 'assistant',
  Tool = 'tool',
}

// ─── Message & Request Types ──────────────────────────────────────────────────

export interface IToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface IToolResult {
  tool_call_id: string;
  content: string;
}

export interface IChatMessage {
  role: MessageRole;
  content: string | IChatMessageContent[];
  name?: string;
  tool_calls?: IToolCall[];
  tool_call_id?: string; // for tool results
}

export interface IChatMessageContent {
  type: 'text' | 'image_url' | 'image_base64';
  text?: string;
  image_url?: { url: string; detail?: 'low' | 'high' | 'auto' };
  image_base64?: { data: string; media_type: string };
}

export interface ITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

export interface IChatRequest {
  messages: IChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string | string[];
  tools?: ITool[];
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  responseFormat?: { type: 'text' | 'json_object' | 'json_schema'; schema?: unknown };
  stream?: boolean;
  metadata?: Record<string, unknown>;
}

export interface IEmbedRequest {
  input: string | string[];
  model?: string;
  dimensions?: number;
}

// ─── Response Types ───────────────────────────────────────────────────────────

export interface ITokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
}

export interface IChatResponse {
  id: string;
  content: string;
  role: MessageRole.Assistant;
  model: string;
  provider: string;
  usage: ITokenUsage;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  toolCalls?: IToolCall[];
  latencyMs: number;
  cost?: number;
  metadata?: Record<string, unknown>;
}

export interface IEmbedResponse {
  embeddings: number[][];
  model: string;
  provider: string;
  usage: Pick<ITokenUsage, 'promptTokens' | 'totalTokens'>;
}

// ─── Streaming Types ──────────────────────────────────────────────────────────

export type IStreamChunkType = 'delta' | 'tool_call_delta' | 'usage' | 'done' | 'error';

export interface IStreamChunkBase {
  type: IStreamChunkType;
  id: string;
  model: string;
  provider: string;
}

export interface IStreamDeltaChunk extends IStreamChunkBase {
  type: 'delta';
  delta: string;
  finishReason: null;
}

export interface IStreamToolCallDeltaChunk extends IStreamChunkBase {
  type: 'tool_call_delta';
  toolCallIndex: number;
  toolCallId?: string;
  functionName?: string;
  argumentsDelta: string;
  finishReason: null;
}

export interface IStreamUsageChunk extends IStreamChunkBase {
  type: 'usage';
  usage: ITokenUsage;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
}

export interface IStreamDoneChunk extends IStreamChunkBase {
  type: 'done';
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export interface IStreamErrorChunk extends IStreamChunkBase {
  type: 'error';
  error: string;
  finishReason: null;
}

export type IStreamChunk =
  | IStreamDeltaChunk
  | IStreamToolCallDeltaChunk
  | IStreamUsageChunk
  | IStreamDoneChunk
  | IStreamErrorChunk;

// ─── Provider Config & Model Info ─────────────────────────────────────────────

export interface IProviderConfig {
  name: string;
  apiKey?: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  defaultModel?: string;
  timeout?: number;           // ms, default 60000
  maxRetries?: number;        // default 3
  rateLimitRpm?: number;      // requests per minute cap
  rateLimitTpm?: number;      // tokens per minute cap
  headers?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface IModelPricing {
  inputPerMillion: number;   // USD per 1M input tokens
  outputPerMillion: number;  // USD per 1M output tokens
  cachedInputPerMillion?: number;
}

export interface IModelInfo {
  id: string;
  name: string;
  provider: string;
  capabilities: ModelCapability[];
  contextWindow: number;
  maxOutputTokens: number;
  pricing: IModelPricing;
  latencyClass: 'ultra_fast' | 'fast' | 'medium' | 'slow';
  qualityScore: number;       // 0-1 normalized quality estimate
  metadata?: Record<string, unknown>;
}

// ─── Provider Interface ───────────────────────────────────────────────────────

export interface IProvider {
  readonly name: string;
  readonly status: ProviderStatus;

  initialize(config: IProviderConfig): Promise<void>;
  chat(request: IChatRequest): Promise<IChatResponse>;
  stream(request: IChatRequest): AsyncGenerator<IStreamChunk>;
  embed(request: IEmbedRequest): Promise<IEmbedResponse>;
  listModels(): Promise<IModelInfo[]>;
  healthCheck(): Promise<boolean>;
  getTokenCount(text: string, model?: string): number;
  dispose(): Promise<void>;
}

// ─── Health & Monitoring ──────────────────────────────────────────────────────

export interface IProviderHealth {
  provider: string;
  status: ProviderStatus;
  latencyMs: number;
  successRate: number; // 0-1, rolling 5 min window
  errorRate: number;
  lastChecked: Date;
  lastError?: string;
}

export interface IRegistryEntry {
  provider: IProvider;
  config: IProviderConfig;
  health: IProviderHealth;
  models: IModelInfo[];
  registeredAt: Date;
}

// ─── Routing ──────────────────────────────────────────────────────────────────

export interface IRoutingContext {
  request: IChatRequest;
  strategy: RoutingStrategy;
  budgetUsd?: number;
  requiredCapabilities?: ModelCapability[];
  preferredProviders?: string[];
  excludedProviders?: string[];
  maxLatencyMs?: number;
  complexityScore?: number; // 0-1
}

export interface IRoutingDecision {
  provider: string;
  model: string;
  estimatedCostUsd: number;
  estimatedLatencyMs: number;
  rationale: string;
  fallbacks: Array<{ provider: string; model: string }>;
}

// ─── Consensus ────────────────────────────────────────────────────────────────

export interface IConsensusRequest {
  request: IChatRequest;
  providers: string[];         // provider names to query
  votingStrategy: 'majority' | 'best_of_n' | 'fusion';
  fusionModel?: string;        // provider:model for fusion synthesis
  timeoutMs?: number;
}

export interface IConsensusResponse {
  finalResponse: IChatResponse;
  responses: IChatResponse[];
  agreement: number;           // 0-1 semantic similarity across responses
  strategy: string;
  totalCostUsd: number;
}

// ─── Error Types ──────────────────────────────────────────────────────────────

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class RateLimitError extends ProviderError {
  constructor(
    provider: string,
    public readonly retryAfterMs?: number,
  ) {
    super(`Rate limit exceeded for provider ${provider}`, provider, 'RATE_LIMIT', true, 429);
    this.name = 'RateLimitError';
  }
}

export class AuthenticationError extends ProviderError {
  constructor(provider: string) {
    super(`Authentication failed for provider ${provider}`, provider, 'AUTH_FAILED', false, 401);
    this.name = 'AuthenticationError';
  }
}

export class ModelNotFoundError extends ProviderError {
  constructor(provider: string, model: string) {
    super(`Model ${model} not found on provider ${provider}`, provider, 'MODEL_NOT_FOUND', false, 404);
    this.name = 'ModelNotFoundError';
  }
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly budgetUsd: number,
    public readonly estimatedCostUsd: number,
  ) {
    super(`Estimated cost $${estimatedCostUsd.toFixed(4)} exceeds budget $${budgetUsd.toFixed(4)}`);
    this.name = 'BudgetExceededError';
  }
}
