/**
 * UNIVERSAL LLM PROVIDER ADAPTER SYSTEM
 *
 * Plugin-based architecture that allows ANY LLM provider to be integrated
 * without modifying core gateway code. Each provider implements the
 * ILLMProvider interface and registers itself with the ProviderRegistry.
 *
 * Supports: OpenAI, Anthropic, Google, xAI, DeepSeek, Cerebras, Mistral,
 * Cohere, Together, Fireworks, Perplexity, Groq, Ollama, LM Studio,
 * AWS Bedrock, Azure OpenAI, OpenRouter, and any OpenAI-compatible API.
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { EventEmitter } from "events";
import crypto from "crypto";

// ============================================================================
// Core Types & Interfaces
// ============================================================================

export type ProviderStatus = "available" | "degraded" | "unavailable" | "unknown";
export type StreamEventType = "token" | "tool_call" | "tool_result" | "thinking" | "error" | "done" | "metadata";

export interface ProviderCapabilities {
  streaming: boolean;
  functionCalling: boolean;
  vision: boolean;
  jsonMode: boolean;
  systemMessages: boolean;
  toolUse: boolean;
  embeddings: boolean;
  imageGeneration: boolean;
  audioTranscription: boolean;
  audioGeneration: boolean;
  codeExecution: boolean;
  webSearch: boolean;
  fileUpload: boolean;
  structuredOutput: boolean;
  reasoning: boolean;
  multimodal: boolean;
  batchApi: boolean;
  fineTuning: boolean;
  caching: boolean;
  maxContextWindow: number;
  maxOutputTokens: number;
  supportedMediaTypes: string[];
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  description: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  capabilities: Partial<ProviderCapabilities>;
  category: "chat" | "reasoning" | "code" | "vision" | "embedding" | "image" | "audio";
  tier: "free" | "standard" | "premium" | "enterprise";
  deprecated?: boolean;
  releaseDate?: string;
  tags?: string[];
}

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ContentPart {
  type: "text" | "image_url" | "audio" | "file";
  text?: string;
  imageUrl?: { url: string; detail?: "low" | "high" | "auto" };
  audioData?: { data: string; format: string };
  fileData?: { data: string; mimeType: string; name: string };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface LLMRequestConfig {
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string[];
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  responseFormat?: { type: "text" | "json_object" | "json_schema"; jsonSchema?: Record<string, unknown> };
  stream?: boolean;
  seed?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  topK?: number;
  user?: string;
  metadata?: Record<string, unknown>;
}

export interface LLMCompletionResponse {
  id: string;
  content: string;
  model: string;
  provider: string;
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | "error";
  usage: TokenUsage;
  toolCalls?: ToolCall[];
  thinking?: string;
  latencyMs: number;
  cached: boolean;
  metadata?: Record<string, unknown>;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
}

export interface StreamEvent {
  type: StreamEventType;
  content?: string;
  toolCall?: Partial<ToolCall>;
  thinking?: string;
  error?: string;
  usage?: TokenUsage;
  metadata?: Record<string, unknown>;
  sequenceId: number;
  timestamp: number;
}

export interface ProviderHealthStatus {
  provider: string;
  status: ProviderStatus;
  latencyMs: number;
  uptime: number;
  lastCheck: number;
  lastError?: string;
  requestsLastMinute: number;
  errorsLastMinute: number;
  circuitState: "closed" | "open" | "half-open";
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  defaultModel?: string;
  maxRetries?: number;
  timeout?: number;
  headers?: Record<string, string>;
  proxy?: string;
  region?: string;
}

// ============================================================================
// Abstract Base Provider
// ============================================================================

export abstract class BaseProvider extends EventEmitter {
  public readonly name: string;
  public readonly displayName: string;
  protected config: ProviderConfig;
  private _status: ProviderStatus = "unknown";
  private _lastHealthCheck: number = 0;
  private _healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private _requestCount: number = 0;
  private _errorCount: number = 0;
  private _totalLatency: number = 0;

  constructor(name: string, displayName: string, config: ProviderConfig = {}) {
    super();
    this.name = name;
    this.displayName = displayName;
    this.config = config;
  }

  // -- Abstract methods that each provider must implement --

  abstract getCapabilities(): ProviderCapabilities;
  abstract listModels(): Promise<ModelInfo[]>;
  abstract complete(config: LLMRequestConfig): Promise<LLMCompletionResponse>;
  abstract stream(config: LLMRequestConfig): AsyncGenerator<StreamEvent>;
  abstract isConfigured(): boolean;

  // -- Optional overrides --

  async embed(input: string | string[], model?: string): Promise<number[][]> {
    throw new Error(`${this.name}: Embeddings not supported`);
  }

  async generateImage(prompt: string, options?: Record<string, unknown>): Promise<{ url: string; revisedPrompt?: string }> {
    throw new Error(`${this.name}: Image generation not supported`);
  }

  async transcribeAudio(audio: Buffer, options?: Record<string, unknown>): Promise<string> {
    throw new Error(`${this.name}: Audio transcription not supported`);
  }

  // -- Health & Status --

  get status(): ProviderStatus {
    return this._status;
  }

  set status(value: ProviderStatus) {
    const prev = this._status;
    this._status = value;
    if (prev !== value) {
      this.emit("statusChange", { provider: this.name, from: prev, to: value });
    }
  }

  getHealth(): ProviderHealthStatus {
    const avgLatency = this._requestCount > 0 ? this._totalLatency / this._requestCount : 0;
    return {
      provider: this.name,
      status: this._status,
      latencyMs: Math.round(avgLatency),
      uptime: this._requestCount > 0 ? ((this._requestCount - this._errorCount) / this._requestCount) * 100 : 100,
      lastCheck: this._lastHealthCheck,
      requestsLastMinute: this._requestCount,
      errorsLastMinute: this._errorCount,
      circuitState: "closed",
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      this._lastHealthCheck = Date.now();
      if (!this.isConfigured()) {
        this.status = "unavailable";
        return false;
      }
      const models = await this.listModels();
      this.status = models.length > 0 ? "available" : "degraded";
      return this.status === "available";
    } catch {
      this.status = "unavailable";
      return false;
    }
  }

  startHealthChecks(intervalMs: number = 60000): void {
    this.stopHealthChecks();
    this._healthCheckInterval = setInterval(() => this.healthCheck(), intervalMs);
  }

  stopHealthChecks(): void {
    if (this._healthCheckInterval) {
      clearInterval(this._healthCheckInterval);
      this._healthCheckInterval = null;
    }
  }

  // -- Metrics tracking --

  recordRequest(latencyMs: number, success: boolean): void {
    this._requestCount++;
    this._totalLatency += latencyMs;
    if (!success) this._errorCount++;
  }

  resetMetrics(): void {
    this._requestCount = 0;
    this._errorCount = 0;
    this._totalLatency = 0;
  }

  // -- Message conversion helpers --

  protected convertToOpenAIFormat(messages: LLMMessage[]): ChatCompletionMessageParam[] {
    return messages.map((m) => {
      if (typeof m.content === "string") {
        return { role: m.role as "system" | "user" | "assistant", content: m.content } as ChatCompletionMessageParam;
      }
      const parts = (m.content as ContentPart[]).map((p) => {
        if (p.type === "text") return { type: "text" as const, text: p.text! };
        if (p.type === "image_url") return { type: "image_url" as const, image_url: p.imageUrl! };
        return { type: "text" as const, text: p.text || "" };
      });
      return { role: m.role as "user", content: parts } as ChatCompletionMessageParam;
    });
  }

  protected generateRequestId(): string {
    return `${this.name}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  }

  destroy(): void {
    this.stopHealthChecks();
    this.removeAllListeners();
  }
}
