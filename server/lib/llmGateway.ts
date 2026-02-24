import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionChunk } from "openai/resources/chat/completions";
import { MODELS } from "./openai";
import { geminiChat, geminiStreamChat, GEMINI_MODELS, type GeminiChatMessage } from "./gemini";
import crypto from "crypto";
import { analyzeResponseQuality, calculateQualityScore } from "../services/responseQuality";
import { recordQualityMetric, getQualityStats, type QualityMetric, type QualityStats } from "./qualityMetrics";
import { recordConnectorUsage } from "./connectorMetrics";
import { storage } from "../storage";
import type { InsertApiLog } from "@shared/schema";

// ===== Types =====
interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: "closed" | "open" | "half-open";
  halfOpenAt: number;
  halfOpenAttempts: number;
}

interface RateLimitState {
  tokens: number;
  lastRefill: number;
}

interface LLMRequestOptions {
  model?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  userId?: string;
  requestId?: string;
  timeout?: number;
  provider?: "xai" | "gemini" | "auto";
  enableFallback?: boolean;
  skipCache?: boolean;
  disableImageGeneration?: boolean;
}

interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  requestId: string;
  latencyMs: number;
  model: string;
  provider: "xai" | "gemini";
  cached?: boolean;
  fromFallback?: boolean;
}

interface StreamChunk {
  content: string;
  sequenceId: number;
  done: boolean;
  requestId: string;
  provider?: "xai" | "gemini";
  checkpoint?: StreamCheckpoint;
}

interface StreamCheckpoint {
  requestId: string;
  sequenceId: number;
  accumulatedContent: string;
  timestamp: number;
}

interface InFlightRequest {
  promise: Promise<LLMResponse>;
  startTime: number;
}

interface TokenUsageRecord {
  requestId: string;
  userId: string;
  provider: "xai" | "gemini";
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  timestamp: number;
  latencyMs: number;
  cached: boolean;
  fromFallback: boolean;
}

// ===== Configuration =====
const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenRequests: 3,
};

const RATE_LIMIT_CONFIG = {
  tokensPerMinute: 100,
  refillRateMs: 600,
  maxBurst: 150,
};

const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  jitterFactor: 0.3,
};

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_CONTEXT_TOKENS = 8000;
const CACHE_TTL_MS = 300000; // 5 minutes
const IN_FLIGHT_TIMEOUT_MS = 120000; // 2 minutes
const TOKEN_HISTORY_MAX = 1000;

// ===== Provider Mapping =====
const PROVIDER_MODELS = {
  xai: {
    default: MODELS.TEXT,
    vision: MODELS.VISION,
  },
  gemini: {
    default: GEMINI_MODELS.FLASH_PREVIEW,
    pro: GEMINI_MODELS.PRO,
    flash: GEMINI_MODELS.FLASH,
  },
};

const KNOWN_GEMINI_MODELS = new Set([
  GEMINI_MODELS.FLASH_PREVIEW.toLowerCase(),
  GEMINI_MODELS.FLASH.toLowerCase(),
  GEMINI_MODELS.PRO.toLowerCase(),
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-2.0-pro",
]);

const KNOWN_XAI_MODELS = new Set([
  MODELS.TEXT.toLowerCase(),
  MODELS.VISION.toLowerCase(),
  "grok-4-1-fast-non-reasoning",
  "grok-4-fast-reasoning",
  "grok-4-fast-non-reasoning",
  "grok-4-0709",
  "grok-3-fast",
]);

function detectProviderFromModel(model: string | undefined): "xai" | "gemini" | null {
  if (!model) return null;
  
  const normalizedModel = model.toLowerCase();
  
  if (KNOWN_GEMINI_MODELS.has(normalizedModel)) {
    return "gemini";
  }
  if (KNOWN_XAI_MODELS.has(normalizedModel)) {
    return "xai";
  }
  
  if (/gemini/i.test(model)) {
    return "gemini";
  }
  if (/grok/i.test(model)) {
    return "xai";
  }
  
  return null;
}

class LLMGateway {
  private xaiClient: OpenAI;
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private rateLimitByUser: Map<string, RateLimitState> = new Map();
  private requestCache: Map<string, { response: LLMResponse; expiresAt: number }> = new Map();
  private inFlightRequests: Map<string, InFlightRequest> = new Map();
  private streamCheckpoints: Map<string, StreamCheckpoint> = new Map();
  private tokenUsageHistory: TokenUsageRecord[] = [];
  
  private metrics: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    totalLatencyMs: number;
    totalTokens: number;
    rateLimitHits: number;
    circuitBreakerOpens: number;
    cacheHits: number;
    fallbackSuccesses: number;
    deduplicatedRequests: number;
    streamRecoveries: number;
    byProvider: {
      xai: { requests: number; tokens: number; failures: number };
      gemini: { requests: number; tokens: number; failures: number };
    };
  };

  constructor() {
    this.xaiClient = new OpenAI({
      baseURL: "https://api.x.ai/v1",
      apiKey: process.env.XAI_API_KEY,
    });

    // Initialize circuit breakers for each provider
    this.circuitBreakers.set("xai", this.createCircuitBreaker());
    this.circuitBreakers.set("gemini", this.createCircuitBreaker());

    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalLatencyMs: 0,
      totalTokens: 0,
      rateLimitHits: 0,
      circuitBreakerOpens: 0,
      cacheHits: 0,
      fallbackSuccesses: 0,
      deduplicatedRequests: 0,
      streamRecoveries: 0,
      byProvider: {
        xai: { requests: 0, tokens: 0, failures: 0 },
        gemini: { requests: 0, tokens: 0, failures: 0 },
      },
    };

    // Cleanup intervals
    setInterval(() => this.cleanupCache(), 60000);
    setInterval(() => this.cleanupInFlightRequests(), 30000);
    setInterval(() => this.cleanupStreamCheckpoints(), 60000);
  }

  private createCircuitBreaker(): CircuitBreakerState {
    return {
      failures: 0,
      lastFailure: 0,
      state: "closed",
      halfOpenAt: 0,
      halfOpenAttempts: 0,
    };
  }

  // ===== API Log Persistence =====
  private persistApiLog(logData: {
    provider: string;
    model: string;
    endpoint: string;
    latencyMs: number;
    statusCode: number;
    tokensIn?: number;
    tokensOut?: number;
    errorMessage?: string;
    userId?: string;
  }): void {
    const apiLog: InsertApiLog = {
      userId: logData.userId || null,
      endpoint: logData.endpoint,
      method: "POST",
      statusCode: logData.statusCode,
      latencyMs: logData.latencyMs,
      tokensIn: logData.tokensIn || null,
      tokensOut: logData.tokensOut || null,
      model: logData.model,
      provider: logData.provider,
      requestPreview: null,
      responsePreview: null,
      errorMessage: logData.errorMessage ? logData.errorMessage.slice(0, 200) : null,
      ipAddress: null,
      userAgent: null,
    };

    storage.createApiLog(apiLog).catch((err) => {
      console.error("[LLMGateway] Failed to persist API log:", err.message);
    });
  }

  // ===== Request Deduplication =====
  private generateContentHash(messages: ChatCompletionMessageParam[], options: LLMRequestOptions): string {
    const content = JSON.stringify({
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      model: options.model,
      temperature: options.temperature,
      topP: options.topP,
      maxTokens: options.maxTokens,
    });
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 32);
  }

  private getInFlightRequest(hash: string): InFlightRequest | undefined {
    const request = this.inFlightRequests.get(hash);
    if (request && Date.now() - request.startTime < IN_FLIGHT_TIMEOUT_MS) {
      return request;
    }
    if (request) {
      this.inFlightRequests.delete(hash);
    }
    return undefined;
  }

  // ===== Cache Management =====
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getCacheKey(messages: ChatCompletionMessageParam[], options: LLMRequestOptions): string | null {
    if (options.skipCache) return null;
    
    const lastUserMessage = messages.filter(m => m.role === "user").pop();
    const lastMsgContent = typeof lastUserMessage?.content === "string" ? lastUserMessage.content : "";
    if (lastMsgContent.length < 50) {
      return null;
    }
    
    const userId = options.userId || "anonymous";
    return `${userId}:${this.generateContentHash(messages, options)}`;
  }

  private cleanupCache(): void {
    const now = Date.now();
    const entries = Array.from(this.requestCache.entries());
    for (const [key, value] of entries) {
      if (value.expiresAt < now) {
        this.requestCache.delete(key);
      }
    }
  }

  private cleanupInFlightRequests(): void {
    const now = Date.now();
    const entries = Array.from(this.inFlightRequests.entries());
    for (const [key, value] of entries) {
      if (now - value.startTime > IN_FLIGHT_TIMEOUT_MS) {
        this.inFlightRequests.delete(key);
      }
    }
  }

  private cleanupStreamCheckpoints(): void {
    const now = Date.now();
    const entries = Array.from(this.streamCheckpoints.entries());
    for (const [key, value] of entries) {
      if (now - value.timestamp > 300000) { // 5 minutes
        this.streamCheckpoints.delete(key);
      }
    }
  }

  // ===== Rate Limiting =====
  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    let state = this.rateLimitByUser.get(userId);

    if (!state) {
      state = { tokens: RATE_LIMIT_CONFIG.tokensPerMinute, lastRefill: now };
      this.rateLimitByUser.set(userId, state);
    }

    const elapsed = now - state.lastRefill;
    const refillAmount = Math.floor(elapsed / RATE_LIMIT_CONFIG.refillRateMs);
    
    if (refillAmount > 0) {
      state.tokens = Math.min(
        RATE_LIMIT_CONFIG.maxBurst,
        state.tokens + refillAmount
      );
      state.lastRefill = now;
    }

    if (state.tokens > 0) {
      state.tokens--;
      return true;
    }

    this.metrics.rateLimitHits++;
    return false;
  }

  // ===== Circuit Breaker =====
  private checkCircuitBreaker(provider: "xai" | "gemini"): boolean {
    const now = Date.now();
    const cb = this.circuitBreakers.get(provider)!;

    if (cb.state === "open") {
      if (now >= cb.halfOpenAt) {
        cb.state = "half-open";
        cb.halfOpenAttempts = 0;
        cb.failures = 0;
        console.log(`[LLMGateway] ${provider} circuit breaker transitioning to half-open`);
      } else {
        return false;
      }
    }

    if (cb.state === "half-open") {
      if (cb.halfOpenAttempts >= CIRCUIT_BREAKER_CONFIG.halfOpenRequests) {
        return false;
      }
      cb.halfOpenAttempts++;
    }

    return true;
  }

  private recordSuccess(provider: "xai" | "gemini"): void {
    const cb = this.circuitBreakers.get(provider)!;
    
    if (cb.state === "half-open") {
      if (cb.halfOpenAttempts >= CIRCUIT_BREAKER_CONFIG.halfOpenRequests) {
        cb.state = "closed";
        cb.halfOpenAttempts = 0;
        console.log(`[LLMGateway] ${provider} circuit breaker closed after successful probes`);
      }
    }
    cb.failures = 0;
    this.metrics.successfulRequests++;
    this.metrics.byProvider[provider].requests++;
  }

  private recordFailure(provider: "xai" | "gemini"): void {
    const cb = this.circuitBreakers.get(provider)!;
    cb.failures++;
    cb.lastFailure = Date.now();
    this.metrics.failedRequests++;
    this.metrics.byProvider[provider].failures++;

    if (cb.state === "half-open") {
      cb.state = "open";
      cb.halfOpenAt = Date.now() + CIRCUIT_BREAKER_CONFIG.resetTimeoutMs;
      cb.halfOpenAttempts = 0;
      this.metrics.circuitBreakerOpens++;
      console.error(`[LLMGateway] ${provider} circuit breaker re-opened from half-open`);
    } else if (cb.failures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
      cb.state = "open";
      cb.halfOpenAt = Date.now() + CIRCUIT_BREAKER_CONFIG.resetTimeoutMs;
      this.metrics.circuitBreakerOpens++;
      console.error(`[LLMGateway] ${provider} circuit breaker opened`);
    }
  }

  // ===== Retry Logic =====
  private calculateRetryDelay(attempt: number): number {
    const baseDelay = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);
    const jitter = baseDelay * RETRY_CONFIG.jitterFactor * Math.random();
    return Math.min(baseDelay + jitter, RETRY_CONFIG.maxDelayMs);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ===== Context Truncation =====
  truncateContext(messages: ChatCompletionMessageParam[], maxTokens: number = MAX_CONTEXT_TOKENS): ChatCompletionMessageParam[] {
    let totalEstimatedTokens = messages.reduce((sum, msg) => {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      return sum + Math.ceil(content.length / 4);
    }, 0);

    if (totalEstimatedTokens <= maxTokens) {
      return messages;
    }

    const systemMessages = messages.filter((m) => m.role === "system");
    const otherMessages = messages.filter((m) => m.role !== "system");

    const truncated: ChatCompletionMessageParam[] = [...systemMessages];
    let remainingTokens = maxTokens - systemMessages.reduce((sum, msg) => {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      return sum + Math.ceil(content.length / 4);
    }, 0);

    for (let i = otherMessages.length - 1; i >= 0; i--) {
      const msg = otherMessages[i];
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      const msgTokens = Math.ceil(content.length / 4);
      
      if (msgTokens <= remainingTokens) {
        truncated.splice(systemMessages.length, 0, msg);
        remainingTokens -= msgTokens;
      } else if (remainingTokens > 100) {
        const truncatedContent = content.slice(0, remainingTokens * 4);
        truncated.splice(systemMessages.length, 0, {
          ...msg,
          content: truncatedContent + "... [truncated]",
        } as ChatCompletionMessageParam);
        break;
      }
    }

    console.log(`[LLMGateway] Truncated context from ${totalEstimatedTokens} to ~${maxTokens - remainingTokens} tokens`);
    return truncated;
  }

  // ===== Message Conversion =====
  private convertToGeminiMessages(messages: ChatCompletionMessageParam[]): { messages: GeminiChatMessage[]; systemInstruction?: string } {
    const systemMsg = messages.find(m => m.role === "system");
    const systemInstruction = systemMsg && typeof systemMsg.content === "string" ? systemMsg.content : undefined;
    
    const geminiMessages: GeminiChatMessage[] = messages
      .filter(m => m.role !== "system")
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
      }));
    
    return { messages: geminiMessages, systemInstruction };
  }

  // ===== Provider Selection =====
  private selectProvider(options: LLMRequestOptions): "xai" | "gemini" {
    if (options.provider && options.provider !== "auto") {
      return options.provider;
    }
    
    // Auto-detect provider based on model name using robust patterns
    const detectedProvider = detectProviderFromModel(options.model);
    if (detectedProvider) {
      return detectedProvider;
    }
    
    // Check circuit breaker states
    const xaiAvailable = this.checkCircuitBreaker("xai");
    const geminiAvailable = this.checkCircuitBreaker("gemini");
    
    if (xaiAvailable && process.env.XAI_API_KEY) {
      return "xai";
    }
    if (geminiAvailable && process.env.GEMINI_API_KEY) {
      return "gemini";
    }
    
    // Default to xai if both are available or unavailable
    return "xai";
  }

  // ===== Token Usage Tracking =====
  private recordTokenUsage(record: TokenUsageRecord): void {
    this.tokenUsageHistory.push(record);
    if (this.tokenUsageHistory.length > TOKEN_HISTORY_MAX) {
      this.tokenUsageHistory.shift();
    }
    this.metrics.totalTokens += record.totalTokens;
    this.metrics.byProvider[record.provider].tokens += record.totalTokens;
  }

  getTokenUsageStats(since?: number): {
    total: number;
    byProvider: Record<string, number>;
    byUser: Record<string, number>;
    recentRequests: number;
  } {
    const cutoff = since || Date.now() - 3600000; // Last hour by default
    const relevant = this.tokenUsageHistory.filter(r => r.timestamp >= cutoff);
    
    const byProvider: Record<string, number> = { xai: 0, gemini: 0 };
    const byUser: Record<string, number> = {};
    let total = 0;
    
    for (const record of relevant) {
      total += record.totalTokens;
      byProvider[record.provider] += record.totalTokens;
      byUser[record.userId] = (byUser[record.userId] || 0) + record.totalTokens;
    }
    
    return { total, byProvider, byUser, recentRequests: relevant.length };
  }

  // ===== Main Chat Method with Multi-Provider Fallback =====
  async chat(
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions = {}
  ): Promise<LLMResponse> {
    const requestId = options.requestId || this.generateRequestId();
    const startTime = Date.now();
    const userId = options.userId || "anonymous";
    const enableFallback = options.enableFallback !== false;
    const timeout = options.timeout || DEFAULT_TIMEOUT_MS;

    this.metrics.totalRequests++;

    // Check cache first
    const cacheKey = this.getCacheKey(messages, options);
    if (cacheKey) {
      const cached = this.requestCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        this.metrics.cacheHits++;
        console.log(`[LLMGateway] ${requestId} cache hit`);
        return { ...cached.response, cached: true, requestId };
      }
    }

    // Check for duplicate in-flight request
    const contentHash = this.generateContentHash(messages, options);
    const inFlight = this.getInFlightRequest(contentHash);
    if (inFlight) {
      this.metrics.deduplicatedRequests++;
      console.log(`[LLMGateway] ${requestId} deduplicated (waiting for existing request)`);
      return inFlight.promise;
    }

    // Rate limit check
    if (!this.checkRateLimit(userId)) {
      throw new Error(`Rate limit exceeded for user ${userId}`);
    }

    // Truncate context
    const truncatedMessages = this.truncateContext(messages, options.maxTokens ? options.maxTokens * 2 : MAX_CONTEXT_TOKENS);

    // Create the request promise
    const requestPromise = this.executeWithFallback(
      truncatedMessages,
      { ...options, requestId, timeout },
      startTime,
      enableFallback
    );

    // Register as in-flight
    this.inFlightRequests.set(contentHash, { promise: requestPromise, startTime });

    try {
      const result = await requestPromise;
      
      // Cache successful response
      if (cacheKey) {
        this.requestCache.set(cacheKey, {
          response: result,
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
      }

      return result;
    } finally {
      this.inFlightRequests.delete(contentHash);
    }
  }

  private async executeWithFallback(
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions & { requestId: string; timeout: number },
    startTime: number,
    enableFallback: boolean
  ): Promise<LLMResponse> {
    // Respect explicit provider selection
    const primaryProvider = this.selectProvider(options);
    const alternateProvider: "xai" | "gemini" = primaryProvider === "xai" ? "gemini" : "xai";
    
    const providers: ("xai" | "gemini")[] = enableFallback 
      ? [primaryProvider, alternateProvider] 
      : [primaryProvider];

    let lastError: Error | null = null;

    for (const provider of providers) {
      if (!this.checkCircuitBreaker(provider)) {
        console.log(`[LLMGateway] ${options.requestId} skipping ${provider} (circuit breaker open)`);
        continue;
      }

      try {
        const result = await this.executeOnProvider(provider, messages, options, startTime);
        
        if (providers.indexOf(provider) > 0) {
          this.metrics.fallbackSuccesses++;
          console.log(`[LLMGateway] ${options.requestId} succeeded on fallback provider ${provider}`);
        }
        
        return { ...result, fromFallback: providers.indexOf(provider) > 0 };
      } catch (error: any) {
        lastError = error;
        console.warn(`[LLMGateway] ${options.requestId} failed on ${provider}: ${error.message}`);
        
        if (!enableFallback) {
          throw error;
        }
      }
    }

    throw lastError || new Error("All providers failed");
  }

  private async executeOnProvider(
    provider: "xai" | "gemini",
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions & { requestId: string; timeout: number },
    startTime: number
  ): Promise<LLMResponse> {
    const modelProvider = detectProviderFromModel(options.model);
    
    let model: string;
    if (provider === "xai") {
      model = (modelProvider === "xai") ? options.model! : MODELS.TEXT;
    } else {
      model = (modelProvider === "gemini") ? options.model! : GEMINI_MODELS.FLASH_PREVIEW;
    }
    
    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      try {
        if (provider === "xai") {
          return await this.executeXai(messages, options, model, startTime);
        } else {
          return await this.executeGemini(messages, options, model, startTime);
        }
      } catch (error: any) {
        const isRetryable =
          error.status === 429 ||
          error.status === 500 ||
          error.status === 502 ||
          error.status === 503 ||
          error.code === "ECONNRESET" ||
          error.code === "ETIMEDOUT";

        if (!isRetryable || attempt >= RETRY_CONFIG.maxRetries) {
          this.recordFailure(provider);
          throw error;
        }

        const delay = this.calculateRetryDelay(attempt);
        console.warn(`[LLMGateway] ${options.requestId} ${provider} attempt ${attempt + 1} failed, retrying in ${delay}ms`);
        await this.sleep(delay);
      }
    }

    throw new Error("Max retries exceeded");
  }

  private async executeXai(
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions & { requestId: string; timeout: number },
    model: string,
    startTime: number
  ): Promise<LLMResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout);

    try {
      const response = await this.xaiClient.chat.completions.create(
        {
          model,
          messages,
          temperature: options.temperature ?? 0.7,
          top_p: options.topP ?? 1,
          max_tokens: options.maxTokens,
        },
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);

      const latencyMs = Date.now() - startTime;
      const content = response.choices[0]?.message?.content || "";
      const usage = response.usage;

      this.recordSuccess("xai");
      this.metrics.totalLatencyMs += latencyMs;

      const usageRecord: TokenUsageRecord = {
        requestId: options.requestId,
        userId: options.userId || "anonymous",
        provider: "xai",
        model,
        promptTokens: usage?.prompt_tokens || 0,
        completionTokens: usage?.completion_tokens || 0,
        totalTokens: usage?.total_tokens || 0,
        timestamp: Date.now(),
        latencyMs,
        cached: false,
        fromFallback: false,
      };
      this.recordTokenUsage(usageRecord);

      console.log(`[LLMGateway] ${options.requestId} xai completed in ${latencyMs}ms, tokens: ${usage?.total_tokens || 0}`);

      // Record connector usage for xai
      recordConnectorUsage("xai", latencyMs, true);

      // Persist API log to database asynchronously
      this.persistApiLog({
        provider: "xai",
        model,
        endpoint: "/chat/completions",
        latencyMs,
        statusCode: 200,
        tokensIn: usage?.prompt_tokens,
        tokensOut: usage?.completion_tokens,
        userId: options.userId,
      });

      // Analyze response quality and record metrics
      const qualityAnalysis = analyzeResponseQuality(content);
      const qualityScore = calculateQualityScore(content, usage?.total_tokens || 0, latencyMs);
      
      const qualityMetric: QualityMetric = {
        responseId: options.requestId,
        provider: "xai",
        score: qualityScore,
        tokensUsed: usage?.total_tokens || 0,
        latencyMs,
        timestamp: new Date(),
        issues: qualityAnalysis.issues,
        isComplete: qualityAnalysis.isComplete,
        hasContentIssues: qualityAnalysis.hasContentIssues,
      };
      recordQualityMetric(qualityMetric);

      return {
        content,
        usage: usage ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        } : undefined,
        requestId: options.requestId,
        latencyMs,
        model,
        provider: "xai",
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;
      // Record connector failure for xai
      recordConnectorUsage("xai", latencyMs, false);

      // Persist API error log to database asynchronously
      this.persistApiLog({
        provider: "xai",
        model,
        endpoint: "/chat/completions",
        latencyMs,
        statusCode: error.status || 500,
        errorMessage: error.message,
        userId: options.userId,
      });

      if (error.name === "AbortError") {
        throw new Error(`Request timeout after ${options.timeout}ms`);
      }
      throw error;
    }
  }

  private async executeGemini(
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions & { requestId: string; timeout: number },
    model: string,
    startTime: number
  ): Promise<LLMResponse> {
    const { messages: geminiMessages, systemInstruction } = this.convertToGeminiMessages(messages);

    if (geminiMessages.length === 0) {
      throw new Error("Gemini API error: No valid messages after conversion (contents are required)");
    }

    let response;
    try {
      response = await geminiChat(geminiMessages, {
        model: model as any,
        systemInstruction,
        temperature: options.temperature ?? 0.7,
        topP: options.topP ?? 1,
        maxOutputTokens: options.maxTokens,
      });
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      // Record connector failure for gemini
      recordConnectorUsage("gemini", latencyMs, false);

      // Persist API error log to database asynchronously
      this.persistApiLog({
        provider: "gemini",
        model,
        endpoint: "/generateContent",
        latencyMs,
        statusCode: error.status || 500,
        errorMessage: error.message,
        userId: options.userId,
      });

      throw error;
    }

    const latencyMs = Date.now() - startTime;
    
    this.recordSuccess("gemini");
    this.metrics.totalLatencyMs += latencyMs;

    // Estimate tokens for Gemini (Gemini doesn't return usage in simple API)
    const estimatedTokens = Math.ceil((JSON.stringify(messages).length + response.content.length) / 4);
    
    const usageRecord: TokenUsageRecord = {
      requestId: options.requestId,
      userId: options.userId || "anonymous",
      provider: "gemini",
      model,
      promptTokens: Math.ceil(JSON.stringify(messages).length / 4),
      completionTokens: Math.ceil(response.content.length / 4),
      totalTokens: estimatedTokens,
      timestamp: Date.now(),
      latencyMs,
      cached: false,
      fromFallback: false,
    };
    this.recordTokenUsage(usageRecord);

    console.log(`[LLMGateway] ${options.requestId} gemini completed in ${latencyMs}ms, est. tokens: ${estimatedTokens}`);

    // Record connector usage for gemini
    recordConnectorUsage("gemini", latencyMs, true);

    // Persist API log to database asynchronously
    this.persistApiLog({
      provider: "gemini",
      model,
      endpoint: "/generateContent",
      latencyMs,
      statusCode: 200,
      tokensIn: usageRecord.promptTokens,
      tokensOut: usageRecord.completionTokens,
      userId: options.userId,
    });

    // Analyze response quality and record metrics
    const qualityAnalysis = analyzeResponseQuality(response.content);
    const qualityScore = calculateQualityScore(response.content, estimatedTokens, latencyMs);
    
    const qualityMetric: QualityMetric = {
      responseId: options.requestId,
      provider: "gemini",
      score: qualityScore,
      tokensUsed: estimatedTokens,
      latencyMs,
      timestamp: new Date(),
      issues: qualityAnalysis.issues,
      isComplete: qualityAnalysis.isComplete,
      hasContentIssues: qualityAnalysis.hasContentIssues,
    };
    recordQualityMetric(qualityMetric);

    return {
      content: response.content,
      usage: {
        promptTokens: usageRecord.promptTokens,
        completionTokens: usageRecord.completionTokens,
        totalTokens: estimatedTokens,
      },
      requestId: options.requestId,
      latencyMs,
      model,
      provider: "gemini",
    };
  }

  // ===== Streaming with Checkpoints =====
  async *streamChat(
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions = {}
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const requestId = options.requestId || this.generateRequestId();
    const userId = options.userId || "anonymous";
    const enableFallback = options.enableFallback !== false;
    let sequenceId = 0;
    let accumulatedContent = "";
    let currentProvider: "xai" | "gemini" = this.selectProvider(options);

    this.metrics.totalRequests++;

    if (!this.checkRateLimit(userId)) {
      throw new Error(`Rate limit exceeded for user ${userId}`);
    }

    const truncatedMessages = this.truncateContext(messages, options.maxTokens ? options.maxTokens * 2 : MAX_CONTEXT_TOKENS);

    // Check for existing checkpoint (recovery)
    const existingCheckpoint = this.streamCheckpoints.get(requestId);
    if (existingCheckpoint) {
      sequenceId = existingCheckpoint.sequenceId;
      accumulatedContent = existingCheckpoint.accumulatedContent;
      this.metrics.streamRecoveries++;
      console.log(`[LLMGateway] ${requestId} recovering from checkpoint at seq ${sequenceId}`);
    }

    const providers: ("xai" | "gemini")[] = enableFallback ? [currentProvider, currentProvider === "xai" ? "gemini" : "xai"] : [currentProvider];

    for (const provider of providers) {
      if (!this.checkCircuitBreaker(provider)) {
        continue;
      }

      try {
        const stream = provider === "xai" 
          ? this.streamXai(truncatedMessages, options, requestId)
          : this.streamGemini(truncatedMessages, options, requestId);

        for await (const chunk of stream) {
          accumulatedContent += chunk.content;
          
          const streamChunk: StreamChunk = {
            content: chunk.content,
            sequenceId: sequenceId++,
            done: chunk.done,
            requestId,
            provider,
            checkpoint: {
              requestId,
              sequenceId,
              accumulatedContent,
              timestamp: Date.now(),
            },
          };

          // Save checkpoint periodically
          if (sequenceId % 10 === 0) {
            this.streamCheckpoints.set(requestId, streamChunk.checkpoint!);
          }

          yield streamChunk;

          if (chunk.done) {
            this.streamCheckpoints.delete(requestId);
            this.recordSuccess(provider);
            return;
          }
        }
      } catch (error: any) {
        // Save checkpoint before failing
        this.streamCheckpoints.set(requestId, {
          requestId,
          sequenceId,
          accumulatedContent,
          timestamp: Date.now(),
        });

        this.recordFailure(provider);
        console.warn(`[LLMGateway] ${requestId} stream failed on ${provider}: ${error.message}`);

        if (!enableFallback || providers.indexOf(provider) === providers.length - 1) {
          throw error;
        }
        
        console.log(`[LLMGateway] ${requestId} attempting stream fallback to next provider`);
      }
    }

    throw new Error("All providers failed during streaming");
  }

  private async *streamXai(
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions,
    requestId: string
  ): AsyncGenerator<{ content: string; done: boolean }, void, unknown> {
    const model = options.model || MODELS.TEXT;

    const stream = await this.xaiClient.chat.completions.create({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      top_p: options.topP ?? 1,
      max_tokens: options.maxTokens,
      stream: true,
    });

    let buffer = "";
    const flushThreshold = 50;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      buffer += content;

      if (buffer.length >= flushThreshold || content.includes("\n") || content.includes(".")) {
        yield { content: buffer, done: false };
        buffer = "";
      }
    }

    if (buffer) {
      yield { content: buffer, done: false };
    }

    yield { content: "", done: true };
  }

  private async *streamGemini(
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions,
    requestId: string
  ): AsyncGenerator<{ content: string; done: boolean }, void, unknown> {
    const model = options.model || GEMINI_MODELS.FLASH_PREVIEW;
    const { messages: geminiMessages, systemInstruction } = this.convertToGeminiMessages(messages);

    const stream = geminiStreamChat(geminiMessages, {
      model: model as any,
      systemInstruction,
      temperature: options.temperature ?? 0.7,
      topP: options.topP ?? 1,
      maxOutputTokens: options.maxTokens,
      responseModalities: options.disableImageGeneration ? ["text"] : undefined,
    });

    for await (const chunk of stream) {
      yield chunk;
    }
  }

  // ===== Metrics =====
  getMetrics() {
    return {
      ...this.metrics,
      averageLatencyMs:
        this.metrics.successfulRequests > 0
          ? Math.round(this.metrics.totalLatencyMs / this.metrics.successfulRequests)
          : 0,
      successRate:
        this.metrics.totalRequests > 0
          ? Math.round((this.metrics.successfulRequests / this.metrics.totalRequests) * 100)
          : 100,
      circuitBreakerStatus: {
        xai: this.circuitBreakers.get("xai")!.state,
        gemini: this.circuitBreakers.get("gemini")!.state,
      },
      cacheSize: this.requestCache.size,
      inFlightRequests: this.inFlightRequests.size,
      streamCheckpoints: this.streamCheckpoints.size,
      rateLimitedUsers: this.rateLimitByUser.size,
    };
  }

  resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalLatencyMs: 0,
      totalTokens: 0,
      rateLimitHits: 0,
      circuitBreakerOpens: 0,
      cacheHits: 0,
      fallbackSuccesses: 0,
      deduplicatedRequests: 0,
      streamRecoveries: 0,
      byProvider: {
        xai: { requests: 0, tokens: 0, failures: 0 },
        gemini: { requests: 0, tokens: 0, failures: 0 },
      },
    };
  }

  // ===== Quality Stats =====
  getQualityStats(since?: Date): QualityStats {
    return getQualityStats(since);
  }

  // ===== Health Check =====
  async healthCheck(): Promise<{
    xai: { available: boolean; latencyMs?: number; error?: string };
    gemini: { available: boolean; latencyMs?: number; error?: string };
  }> {
    const testMessage: ChatCompletionMessageParam[] = [
      { role: "user", content: "ping" }
    ];

    const results: any = { xai: { available: false }, gemini: { available: false } };

    // Test xAI
    if (process.env.XAI_API_KEY) {
      try {
        const start = Date.now();
        await this.executeXai(testMessage, { requestId: "health-xai", timeout: 10000 } as any, MODELS.TEXT, start);
        results.xai = { available: true, latencyMs: Date.now() - start };
      } catch (error: any) {
        results.xai = { available: false, error: error.message };
      }
    }

    // Test Gemini
    if (process.env.GEMINI_API_KEY) {
      try {
        const start = Date.now();
        await this.executeGemini(testMessage, { requestId: "health-gemini", timeout: 10000 } as any, GEMINI_MODELS.FLASH_PREVIEW, start);
        results.gemini = { available: true, latencyMs: Date.now() - start };
      } catch (error: any) {
        results.gemini = { available: false, error: error.message };
      }
    }

    return results;
  }

  async *streamChatWithTools(
    messages: ChatCompletionMessageParam[],
    tools: Array<{
      type: "function";
      function: {
        name: string;
        description: string;
        parameters: any;
      };
    }>,
    executeToolFn: (name: string, args: any) => Promise<any>,
    options: LLMRequestOptions & { maxToolRounds?: number } = {}
  ): AsyncGenerator<StreamChunk & { toolCall?: { name: string; args: any; result: any } }, void, unknown> {
    const requestId = options.requestId || this.generateRequestId();
    const userId = options.userId || "anonymous";
    const maxRounds = options.maxToolRounds ?? 10;
    let sequenceId = 0;
    let currentMessages = [...messages];
    
    if (!this.checkRateLimit(userId)) {
      throw new Error(`Rate limit exceeded for user ${userId}`);
    }

    for (let round = 0; round < maxRounds; round++) {
      const truncated = this.truncateContext(currentMessages, MAX_CONTEXT_TOKENS * 2);
      
      try {
        const response = await this.xaiClient.chat.completions.create({
          model: options.model || MODELS.TEXT,
          messages: truncated,
          temperature: options.temperature ?? 0.7,
          tools: tools.length > 0 ? tools : undefined,
          tool_choice: tools.length > 0 ? "auto" : undefined,
          stream: false,
        });

        const choice = response.choices[0];
        if (!choice) break;

        const toolCalls = choice.message.tool_calls;
        
        if (toolCalls && toolCalls.length > 0) {
          currentMessages.push({
            role: "assistant",
            content: choice.message.content || null,
            tool_calls: toolCalls,
          } as any);

          for (const tc of toolCalls) {
            const fnName = tc.function.name;
            let fnArgs: any = {};
            try {
              fnArgs = JSON.parse(tc.function.arguments || "{}");
            } catch {}

            yield {
              content: "",
              sequenceId: sequenceId++,
              done: false,
              requestId,
              toolCall: { name: fnName, args: fnArgs, result: null },
            };

            let toolResult: any;
            try {
              toolResult = await executeToolFn(fnName, fnArgs);
            } catch (err: any) {
              toolResult = { error: err.message };
            }

            currentMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult),
            } as any);

            yield {
              content: "",
              sequenceId: sequenceId++,
              done: false,
              requestId,
              toolCall: { name: fnName, args: fnArgs, result: toolResult },
            };
          }
          continue;
        }

        const content = choice.message.content || "";
        const words = content.split(/(\s+)/);
        for (let i = 0; i < words.length; i += 3) {
          const chunk = words.slice(i, i + 3).join("");
          if (chunk) {
            yield {
              content: chunk,
              sequenceId: sequenceId++,
              done: false,
              requestId,
            };
          }
        }

        yield { content: "", sequenceId: sequenceId++, done: true, requestId };
        return;
      } catch (error: any) {
        if (round === 0 && process.env.GEMINI_API_KEY) {
          try {
            const { messages: geminiMessages, systemInstruction } = this.convertToGeminiMessages(currentMessages);
            const stream = geminiStreamChat(geminiMessages, {
              model: GEMINI_MODELS.FLASH_PREVIEW as any,
              systemInstruction,
              temperature: options.temperature ?? 0.7,
            });
            for await (const chunk of stream) {
              yield {
                content: chunk.content,
                sequenceId: sequenceId++,
                done: chunk.done,
                requestId,
              };
              if (chunk.done) return;
            }
            return;
          } catch (geminiErr: any) {
            throw error;
          }
        }
        throw error;
      }
    }

    yield { content: "\n\n[Reached maximum tool call rounds]", sequenceId: sequenceId++, done: false, requestId };
    yield { content: "", sequenceId: sequenceId++, done: true, requestId };
  }
}

export const llmGateway = new LLMGateway();
export type { LLMRequestOptions, LLMResponse, StreamChunk, StreamCheckpoint, TokenUsageRecord };
