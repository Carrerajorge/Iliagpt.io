/**
 * Universal LLM Provider System — Core Types
 *
 * All interfaces, enums, and error classes shared across every provider
 * implementation. Nothing in this file has side-effects; it is pure type
 * declarations plus error constructors.
 *
 * Design notes:
 *  - ModelCapability uses power-of-2 values so capability sets can be expressed
 *    as bitmasks: `CHAT | VISION | STREAMING` without allocating arrays.
 *  - ProviderStatus models a degradation gradient, not a binary on/off.
 *  - IStreamChunk carries both `delta` (latest token) and `accumulated` (full
 *    text so far) so consumers never need to do string concatenation themselves.
 */

import type { EventEmitter } from 'events';

// ============================================================================
// 1. Capability Bitmask
// ============================================================================

/**
 * Powers of 2 so capabilities can be combined via bitwise OR and tested via
 * bitwise AND without allocating arrays.
 *
 * @example
 *   const caps = ModelCapability.CHAT | ModelCapability.VISION;
 *   const hasVision = (caps & ModelCapability.VISION) !== 0; // true
 */
export const enum ModelCapability {
  NONE             = 0,
  CHAT             = 1 << 0,   // 1
  STREAMING        = 1 << 1,   // 2
  FUNCTION_CALLING = 1 << 2,   // 4
  JSON_MODE        = 1 << 3,   // 8
  VISION           = 1 << 4,   // 16
  EMBEDDING        = 1 << 5,   // 32
  CODE             = 1 << 6,   // 64
  REASONING        = 1 << 7,   // 128
  AUDIO_INPUT      = 1 << 8,   // 256
  AUDIO_OUTPUT     = 1 << 9,   // 512
}

/** Convenience masks for common groupings. */
export const CapabilityMasks = {
  FULL_MULTIMODAL : ModelCapability.VISION | ModelCapability.AUDIO_INPUT,
  AGENTIC         : ModelCapability.FUNCTION_CALLING | ModelCapability.JSON_MODE | ModelCapability.STREAMING,
  EMBEDDINGS_ONLY : ModelCapability.EMBEDDING,
} as const;

// ============================================================================
// 2. Provider Status (degradation gradient)
// ============================================================================

/**
 * Ordered from best → worst so numeric comparison is meaningful.
 * INITIALIZING is out-of-band; it only appears during boot.
 */
export enum ProviderStatus {
  INITIALIZING  = 'initializing',
  ACTIVE        = 'active',
  DEGRADED      = 'degraded',      // elevated latency / partial errors
  RATE_LIMITED  = 'rate_limited',  // 429s; will recover automatically
  UNAVAILABLE   = 'unavailable',   // circuit open or API unreachable
}

/** Numeric severity so you can sort/compare statuses. */
export const ProviderStatusSeverity: Record<ProviderStatus, number> = {
  [ProviderStatus.INITIALIZING] : -1,
  [ProviderStatus.ACTIVE]       : 0,
  [ProviderStatus.DEGRADED]     : 1,
  [ProviderStatus.RATE_LIMITED] : 2,
  [ProviderStatus.UNAVAILABLE]  : 3,
};

// ============================================================================
// 3. Message types
// ============================================================================

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** A single content part inside a multimodal message. */
export type IContentPart =
  | { type: 'text';       text: string }
  | { type: 'image_url';  image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
  | { type: 'audio';      audio: { data: string; format: 'wav' | 'mp3' | 'opus' } };

/**
 * Unified chat message.  Content is a string for simple text, or an array of
 * IContentPart for multimodal payloads.  `toolCallId` and `name` are used for
 * tool-result messages (role = 'tool').
 */
export interface IChatMessage {
  role       : MessageRole;
  content    : string | IContentPart[];
  name?      : string;            // assistant name or tool name
  toolCallId?: string;            // when role === 'tool'

  /** Tool calls the assistant wants to make (role === 'assistant'). */
  toolCalls?: IToolCall[];
}

export interface IToolCall {
  id       : string;
  type     : 'function';
  function : {
    name     : string;
    arguments: string;   // JSON-encoded
  };
}

export interface IToolDefinition {
  type    : 'function';
  function: {
    name       : string;
    description: string;
    parameters : Record<string, unknown>;  // JSON Schema
  };
}

// ============================================================================
// 4. Request / Response shapes
// ============================================================================

export interface IChatOptions {
  /** If omitted the provider chooses its default model. */
  model?           : string;
  temperature?     : number;
  topP?            : number;
  maxTokens?       : number;
  stop?            : string | string[];
  tools?           : IToolDefinition[];
  toolChoice?      : 'auto' | 'required' | 'none' | { type: 'function'; function: { name: string } };
  jsonMode?        : boolean;
  /** Caller-visible request identifier — propagated in responses and logs. */
  requestId?       : string;
  /** Timeout in ms; defaults to provider-level config. */
  timeoutMs?       : number;
  /** Additional provider-specific pass-through options. */
  extra?           : Record<string, unknown>;
}

export interface ITokenUsage {
  promptTokens    : number;
  completionTokens: number;
  totalTokens     : number;
  /** Tokens served from KV-cache (if provider reports it). */
  cachedTokens?   : number;
}

export type FinishReason =
  | 'stop'           // natural completion
  | 'length'         // maxTokens reached
  | 'tool_calls'     // model wants to call tools
  | 'content_filter' // blocked by provider safety layer
  | 'error'          // provider returned an error mid-stream
  | 'unknown';

export interface IChatResponse {
  content     : string;
  model       : string;
  provider    : string;
  usage       : ITokenUsage;
  finishReason: FinishReason;
  /** Wall-clock ms from sending the request to receiving the full response. */
  latencyMs   : number;
  requestId   : string;
  /** True when the response was served from a semantic / exact cache. */
  cached      : boolean;
  /** Set when this response came from a fallback provider. */
  fromFallback: boolean;
  /** Tool calls requested by the model (if any). */
  toolCalls?  : IToolCall[];
  /** Raw provider-specific metadata for debugging. */
  raw?        : unknown;
}

// ============================================================================
// 5. Streaming
// ============================================================================

/**
 * A single chunk emitted during a streaming response.
 *
 * `delta`       — the new token(s) added in this chunk.
 * `accumulated` — the full text assembled so far (saves consumers from concat).
 * `done`        — true on the final chunk; `accumulated` holds the full reply.
 */
export interface IStreamChunk {
  delta      : string;
  accumulated: string;
  done       : boolean;
  /** Set only on the final chunk. */
  usage?     : ITokenUsage;
  finishReason?: FinishReason;
  /** Tool call fragments (assembled across chunks by BaseProvider). */
  toolCallDelta?: Partial<IToolCall>;
  requestId  : string;
}

export type StreamHandler = (chunk: IStreamChunk) => void | Promise<void>;

// ============================================================================
// 6. Embedding
// ============================================================================

export interface IEmbedOptions {
  model?     : string;
  dimensions?: number;
  requestId? : string;
}

export interface IEmbedResponse {
  embeddings : number[][];   // one vector per input string
  model      : string;
  provider   : string;
  usage      : Pick<ITokenUsage, 'promptTokens' | 'totalTokens'>;
  latencyMs  : number;
  requestId  : string;
}

// ============================================================================
// 7. Model catalogue
// ============================================================================

export interface IModelPricing {
  /** Cost per 1 000 000 input tokens in USD. */
  inputPer1M  : number;
  /** Cost per 1 000 000 output tokens in USD. */
  outputPer1M : number;
  /** Cost per 1 000 000 embedding tokens (if model supports it). */
  embedPer1M? : number;
}

export interface IModelInfo {
  id            : string;
  provider      : string;
  displayName   : string;
  capabilities  : number;          // ModelCapability bitmask
  contextWindow : number;
  maxOutputTokens?: number;
  pricing       : IModelPricing;
  /** Average latency in ms-per-output-token observed by the provider. */
  latencyScore  : number;
  /** Reliability 0–1 based on recent health check history. */
  reliabilityScore: number;
  /** Whether this model is currently available (provider not degraded). */
  available     : boolean;
  /** Freeform tags for filtering, e.g. ["vision", "flagship", "latest"]. */
  tags          : string[];
}

// ============================================================================
// 8. Provider configuration
// ============================================================================

export interface IRetryPolicy {
  /** Maximum number of retry attempts after the initial call. */
  maxRetries      : number;
  /** Base delay in ms for exponential backoff. */
  baseDelayMs     : number;
  /** Multiplier applied to delay on each successive retry. */
  backoffFactor   : number;
  /** Hard cap on delay in ms regardless of backoff calculation. */
  maxDelayMs      : number;
  /** HTTP status codes that should trigger a retry (others propagate immediately). */
  retryableStatuses: number[];
}

export interface IRateLimitConfig {
  /** Requests per minute ceiling. */
  requestsPerMinute : number;
  /** Tokens per minute ceiling (0 = unlimited). */
  tokensPerMinute   : number;
  /** Concurrent in-flight request limit (0 = unlimited). */
  maxConcurrent     : number;
}

export interface IProviderConfig {
  /** Unique name used as the registry key, e.g. "openai", "xai". */
  name            : string;
  displayName     : string;
  apiKey?         : string;
  baseUrl?        : string;
  /** Default model to use when the caller does not specify one. */
  defaultModel    : string;
  timeoutMs       : number;
  retry           : IRetryPolicy;
  rateLimit       : IRateLimitConfig;
  /** Providers listed here will be tried in order if this provider fails. */
  fallbackChain?  : string[];
  /** Extra provider-specific settings. */
  extra?          : Record<string, unknown>;
}

// ============================================================================
// 9. Health check
// ============================================================================

export interface IHealthCheckResult {
  provider     : string;
  status       : ProviderStatus;
  /** Round-trip latency for the health probe in ms. */
  latencyMs    : number;
  checkedAt    : Date;
  /** Human-readable detail when status is not ACTIVE. */
  message?     : string;
  /** Whether the API key and configuration are valid (regardless of availability). */
  configValid  : boolean;
}

// ============================================================================
// 10. Core provider interface
// ============================================================================

/**
 * Every concrete provider (OpenAI, Anthropic, xAI, Gemini, …) must implement
 * this interface.  All heavy lifting for retry, rate-limiting, and telemetry
 * lives in `BaseProvider` — concrete classes only implement the actual HTTP
 * call logic inside `_chat`, `_stream`, `_embed`, and `_listModels`.
 */
export interface IProvider extends EventEmitter {
  readonly name    : string;
  readonly config  : IProviderConfig;
  status           : ProviderStatus;

  /** Full chat completion — waits for the entire response. */
  chat(messages: IChatMessage[], options?: IChatOptions): Promise<IChatResponse>;

  /**
   * Streaming chat completion.
   * Calls `onChunk` for each token chunk; resolves with the assembled
   * IChatResponse when the stream ends.
   */
  stream(
    messages : IChatMessage[],
    onChunk  : StreamHandler,
    options? : IChatOptions,
  ): Promise<IChatResponse>;

  /** Text embedding. */
  embed(texts: string[], options?: IEmbedOptions): Promise<IEmbedResponse>;

  /** Returns all models available through this provider. */
  listModels(): Promise<IModelInfo[]>;

  /** Lightweight liveness probe used by the registry health-check loop. */
  healthCheck(): Promise<IHealthCheckResult>;

  /** Gracefully close connections / flush buffers. */
  dispose(): Promise<void>;
}

// ============================================================================
// 11. Registry interfaces
// ============================================================================

export interface IProviderRegistry extends EventEmitter {
  register(provider: IProvider): void;
  unregister(name: string): boolean;
  get(name: string): IProvider | undefined;
  getOrThrow(name: string): IProvider;
  /** Returns providers that currently have ACTIVE or DEGRADED status. */
  getHealthy(): IProvider[];
  /** Returns all registered providers sorted by reliability descending. */
  list(): IProvider[];
  runHealthChecks(): Promise<IHealthCheckResult[]>;
}

// ============================================================================
// 12. Token counting utilities (used by BaseProvider)
// ============================================================================

/**
 * Very rough cl100k_base approximation: ~4 chars per token.
 * Concrete providers that have access to a tiktoken binding should override
 * BaseProvider.countTokens() for precision.
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  // ~4 characters per token for English; add a small overhead.
  return Math.ceil(text.length / 4) + 3;
}

export function estimateMessagesTokenCount(messages: IChatMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    // Role + formatting overhead (~4 tokens per message in cl100k).
    total += 4;
    if (typeof msg.content === 'string') {
      total += estimateTokenCount(msg.content);
    } else {
      for (const part of msg.content) {
        if (part.type === 'text') {
          total += estimateTokenCount(part.text);
        } else if (part.type === 'image_url') {
          // Vision models count image tokens separately; use a conservative
          // placeholder of 765 tokens (low-detail OpenAI estimate).
          total += 765;
        }
      }
    }
    if (msg.toolCalls) {
      total += estimateTokenCount(JSON.stringify(msg.toolCalls));
    }
  }
  return total;
}

// ============================================================================
// 13. Error hierarchy
// ============================================================================

/** Base class for all provider errors. */
export class ProviderError extends Error {
  public readonly provider   : string;
  public readonly requestId  : string;
  public readonly retryable  : boolean;
  public readonly statusCode?: number;
  public readonly raw?       : unknown;

  constructor(opts: {
    message    : string;
    provider   : string;
    requestId  : string;
    retryable  : boolean;
    statusCode?: number;
    raw?       : unknown;
    cause?     : unknown;
  }) {
    super(opts.message);
    this.name       = 'ProviderError';
    this.provider   = opts.provider;
    this.requestId  = opts.requestId;
    this.retryable  = opts.retryable;
    this.statusCode = opts.statusCode;
    this.raw        = opts.raw;
    if (opts.cause) (this as any).cause = opts.cause;
  }
}

/** The provider returned an authentication / authorisation error. */
export class ProviderAuthError extends ProviderError {
  constructor(opts: Omit<ConstructorParameters<typeof ProviderError>[0], 'retryable'>) {
    super({ ...opts, retryable: false });
    this.name = 'ProviderAuthError';
  }
}

/** The provider is rate-limiting this client. */
export class ProviderRateLimitError extends ProviderError {
  public readonly retryAfterMs?: number;

  constructor(opts: Omit<ConstructorParameters<typeof ProviderError>[0], 'retryable'> & { retryAfterMs?: number }) {
    super({ ...opts, retryable: true, statusCode: opts.statusCode ?? 429 });
    this.name         = 'ProviderRateLimitError';
    this.retryAfterMs = opts.retryAfterMs;
  }
}

/** The provider's context window was exceeded. */
export class ProviderContextLengthError extends ProviderError {
  constructor(opts: Omit<ConstructorParameters<typeof ProviderError>[0], 'retryable'>) {
    super({ ...opts, retryable: false, statusCode: opts.statusCode ?? 400 });
    this.name = 'ProviderContextLengthError';
  }
}

/** Provider returned 5xx or a network-level error. */
export class ProviderServerError extends ProviderError {
  constructor(opts: Omit<ConstructorParameters<typeof ProviderError>[0], 'retryable'>) {
    super({ ...opts, retryable: true });
    this.name = 'ProviderServerError';
  }
}

/** The request was refused by the provider's content safety filter. */
export class ProviderContentFilterError extends ProviderError {
  constructor(opts: Omit<ConstructorParameters<typeof ProviderError>[0], 'retryable'>) {
    super({ ...opts, retryable: false, statusCode: opts.statusCode ?? 400 });
    this.name = 'ProviderContentFilterError';
  }
}

/** A timeout elapsed before the provider responded. */
export class ProviderTimeoutError extends ProviderError {
  constructor(opts: Omit<ConstructorParameters<typeof ProviderError>[0], 'retryable'>) {
    super({ ...opts, retryable: true });
    this.name = 'ProviderTimeoutError';
  }
}

/**
 * Classify an arbitrary error caught from a provider HTTP call into the typed
 * error hierarchy.  Concrete providers may call this helper in their catch
 * blocks to avoid duplicating classification logic.
 */
export function classifyProviderError(
  err         : unknown,
  provider    : string,
  requestId   : string,
): ProviderError {
  // Already typed — just return.
  if (err instanceof ProviderError) return err;

  const e = err as any;
  const status  : number | undefined = e?.status ?? e?.statusCode ?? e?.response?.status;
  const message : string             = e?.message ?? String(err);

  if (status === 401 || status === 403) {
    return new ProviderAuthError({ message, provider, requestId, statusCode: status, raw: err });
  }
  if (status === 429) {
    const retryAfter = e?.headers?.['retry-after'];
    return new ProviderRateLimitError({
      message,
      provider,
      requestId,
      statusCode : 429,
      retryAfterMs: retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined,
      raw        : err,
    });
  }
  if (status === 400 && /context|token|length/i.test(message)) {
    return new ProviderContextLengthError({ message, provider, requestId, statusCode: 400, raw: err });
  }
  if (status === 400 && /content.filter|safety|policy/i.test(message)) {
    return new ProviderContentFilterError({ message, provider, requestId, statusCode: 400, raw: err });
  }
  if (status !== undefined && status >= 500) {
    return new ProviderServerError({ message, provider, requestId, statusCode: status, raw: err });
  }
  if (/timeout|ETIMEDOUT|ECONNRESET/i.test(message)) {
    return new ProviderTimeoutError({ message, provider, requestId, raw: err });
  }

  // Fallback: treat as potentially retryable server error.
  return new ProviderServerError({ message, provider, requestId, statusCode: status, raw: err });
}

// ============================================================================
// 14. Event names (typed constants)
// ============================================================================

export const ProviderEvents = {
  /** Emitted on every successful chat/embed call. */
  REQUEST_SUCCESS   : 'provider:request_success',
  /** Emitted when a call fails (after retries are exhausted). */
  REQUEST_FAILURE   : 'provider:request_failure',
  /** Emitted when status changes (e.g. ACTIVE → DEGRADED). */
  STATUS_CHANGED    : 'provider:status_changed',
  /** Emitted by the registry after each health-check round. */
  HEALTH_CHECK_DONE : 'registry:health_check_done',
  /** Emitted when a provider is registered. */
  REGISTERED        : 'registry:registered',
  /** Emitted when a provider is removed from the registry. */
  UNREGISTERED      : 'registry:unregistered',
} as const;

export type ProviderEventName = typeof ProviderEvents[keyof typeof ProviderEvents];

// ============================================================================
// 15. Utility types
// ============================================================================

/** Payload attached to STATUS_CHANGED events. */
export interface StatusChangedPayload {
  provider  : string;
  previous  : ProviderStatus;
  current   : ProviderStatus;
  timestamp : Date;
}

/** Payload attached to REQUEST_SUCCESS / REQUEST_FAILURE events. */
export interface RequestEventPayload {
  provider   : string;
  model      : string;
  requestId  : string;
  latencyMs  : number;
  tokenUsage?: ITokenUsage;
  error?     : ProviderError;
}
