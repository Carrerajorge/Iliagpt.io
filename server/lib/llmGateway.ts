import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionChunk } from "openai/resources/chat/completions";
import Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "./openai";
import { geminiChat, geminiStreamChat, GEMINI_MODELS, type GeminiChatMessage } from "./gemini";
import {
  KNOWN_XAI_MODEL_IDS,
  KNOWN_GEMINI_MODEL_IDS,
  KNOWN_LOCAL_MODEL_IDS,
  XAI_MODELS,
} from "./modelRegistry";
import crypto from "crypto";
import { analyzeResponseQuality, calculateQualityScore } from "../services/responseQuality";
import { recordQualityMetric, getQualityStats, type QualityMetric, type QualityStats } from "./qualityMetrics";
import { recordConnectorUsage } from "./connectorMetrics";
import { storage } from "../storage";
import { redis } from "./redis";
import type { InsertApiLog } from "@shared/schema";

import { getCircuitBreaker, CircuitBreakerOpenError, CircuitState } from "./circuitBreaker";
import type { ZodSchema } from "zod";
import { type AgentEvent } from "./typedStreaming";
import { costEngine } from "../services/finops/costEngine";
import { secretManager } from "../services/secretManager";

interface RateLimitState {
  tokens: number;
  lastRefill: number;
}

type LLMProvider = "xai" | "gemini" | "openai" | "anthropic" | "deepseek";
type LLMProviderOrAuto = LLMProvider | "auto";

interface LLMRequestOptions {
  model?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  userId?: string;
  requestId?: string;
  timeout?: number;
  provider?: LLMProviderOrAuto;
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
  provider: LLMProvider;
  cached?: boolean;
  fromFallback?: boolean;
}

interface StreamChunk {
  content: string;
  sequenceId: number;
  done: boolean;
  requestId: string;
  provider?: LLMProvider;
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
  provider: LLMProvider;
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
  resetTimeout: 30000,
  timeout: 30000,
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
// Streaming can hang indefinitely if a provider never yields tokens. We enforce:
// - total timeout: cap overall request time
// - idle timeout: cap time with no tokens (covers TTFT and stalled streams)
const DEFAULT_STREAM_TIMEOUT_MS = 300000; // 5 minutes
const STREAM_IDLE_TIMEOUT_MS = 60000; // 60 seconds – covers slow TTFT from Gemini/reasoning models
const MAX_CONTEXT_TOKENS = 8000;
const CACHE_TTL_MS = 300000; // 5 minutes

/** Structured result from context truncation — replaces silent truncation. */
export interface TruncationResult {
  messages: ChatCompletionMessageParam[];
  truncationApplied: boolean;
  originalTokens: number;
  finalTokens: number;
  droppedMessages: number;
  truncatedMessageCount: number;
}
const IN_FLIGHT_TIMEOUT_MS = 120000; // 2 minutes
const TOKEN_HISTORY_MAX = 1000;

// ===== Provider Mapping =====
const PROVIDER_MODELS = {
  xai: {
    default: MODELS.TEXT,
    vision: MODELS.VISION,
  },
  gemini: {
    default: GEMINI_MODELS.FLASH,
    pro: GEMINI_MODELS.PRO,
    flash: GEMINI_MODELS.FLASH,
  },
};

// Model sets sourced from the central model registry
const KNOWN_GEMINI_MODELS = KNOWN_GEMINI_MODEL_IDS;

const KNOWN_XAI_MODELS = KNOWN_XAI_MODEL_IDS;

const KNOWN_DEEPSEEK_MODELS = new Set([
  "deepseek-chat",
  "deepseek-reasoner",
]);

function detectProviderFromModel(model: string | undefined): LLMProvider | null {
  if (!model) return null;

  const normalizedModel = model.toLowerCase();

  if (KNOWN_GEMINI_MODELS.has(normalizedModel)) {
    return "gemini";
  }
  if (KNOWN_XAI_MODELS.has(normalizedModel)) {
    return "xai";
  }
  if (KNOWN_DEEPSEEK_MODELS.has(normalizedModel)) {
    return "deepseek";
  }

  // Si es un modelo local (llama3, mistral), lo ruteamos via SDK OpenAI compatible
  if (KNOWN_LOCAL_MODEL_IDS.has(normalizedModel) || normalizedModel.includes("llama") || normalizedModel.includes("mistral")) {
    return "openai";
  }

  if (/gemini/i.test(model)) {
    return "gemini";
  }
  if (/grok/i.test(model)) {
    return "xai";
  }
  if (/^claude/i.test(model)) {
    return "anthropic";
  }
  if (/deepseek/i.test(model)) {
    return "deepseek";
  }
  if (/^(gpt-|o\d|chatgpt)/i.test(model)) {
    return "openai";
  }
  if (/minimax/i.test(model)) {
    return "openai";
  }

  return null;
}

class LLMGateway {
  private xaiClient: OpenAI | null = null;
  private openaiClient: OpenAI | null = null;
  private deepseekClient: OpenAI | null = null;
  private cleanupIntervals: ReturnType<typeof setInterval>[] = [];
  private anthropicClient: Anthropic | null = null;

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
      xai: { requests: number; tokens: number; failures: number; latency?: number };
      gemini: { requests: number; tokens: number; failures: number; latency?: number };
      openai: { requests: number; tokens: number; failures: number; latency?: number };
      anthropic: { requests: number; tokens: number; failures: number; latency?: number };
      deepseek: { requests: number; tokens: number; failures: number; latency?: number };
    };
  };

  constructor() {
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
        openai: { requests: 0, tokens: 0, failures: 0 },
        anthropic: { requests: 0, tokens: 0, failures: 0 },
        deepseek: { requests: 0, tokens: 0, failures: 0 },
      },
    };

    // Cleanup intervals — store refs to prevent memory leaks on destroy
    this.cleanupIntervals.push(
      setInterval(() => this.cleanupCache(), 60000),
      setInterval(() => this.cleanupInFlightRequests(), 30000),
      setInterval(() => this.cleanupStreamCheckpoints(), 60000),
    );
  }

  /**
   * Clean up all intervals to prevent memory leaks.
   * Call this during graceful shutdown or when replacing the gateway instance.
   */
  destroy(): void {
    for (const interval of this.cleanupIntervals) {
      clearInterval(interval);
    }
    this.cleanupIntervals = [];
    this.requestCache.clear();
    this.inFlightRequests.clear();
    this.streamCheckpoints.clear();
    this.rateLimitByUser.clear();
    console.log('[LLMGateway] Destroyed: all intervals cleared and caches flushed');
  }

  /**
   * Wrap an async iterable with an idle-timeout guard.
   * If no chunk is yielded within `timeoutMs`, the stream is aborted with an error.
   */
  private async *withIdleTimeout<T>(
    source: AsyncIterable<T>,
    timeoutMs: number,
    requestId: string
  ): AsyncGenerator<T> {
    const iterator = source[Symbol.asyncIterator]();
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        iterator.next(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`[LLMGateway] ${requestId} stream idle timeout after ${timeoutMs}ms`)),
            timeoutMs
          );
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      if (result.done) return;
      yield result.value;
    }
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
  truncateContext(messages: ChatCompletionMessageParam[], maxTokens: number = MAX_CONTEXT_TOKENS): TruncationResult {
    const toText = (msg: ChatCompletionMessageParam): string =>
      typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);

    const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

    const truncateText = (text: string, budgetTokens: number): string => {
      if (budgetTokens <= 0) return "";
      const maxChars = budgetTokens * 4;
      if (text.length <= maxChars) return text;
      // Keep the beginning: system prompts and user queries usually lead with the key info.
      return text.slice(0, Math.max(0, maxChars - 16)) + "... [truncated]";
    };

    const totalEstimatedTokens = messages.reduce((sum, msg) => sum + estimateTokens(toText(msg)), 0);
    if (totalEstimatedTokens <= maxTokens) {
      return {
        messages,
        truncationApplied: false,
        originalTokens: totalEstimatedTokens,
        finalTokens: totalEstimatedTokens,
        droppedMessages: 0,
        truncatedMessageCount: 0,
      };
    }

    let truncatedMessageCount = 0;
    const systemMessages = messages.filter((m) => m.role === "system");
    const otherMessages = messages.filter((m) => m.role !== "system");

    // Gemini requires at least one non-system "content" message. If the caller built a system-only
    // request, keep as much system as possible (but the provider may still reject it).
    if (otherMessages.length === 0) {
      const out: ChatCompletionMessageParam[] = [];
      let remaining = maxTokens;
      for (const sys of systemMessages) {
        if (remaining <= 0) break;
        const text = toText(sys);
        const tokens = estimateTokens(text);
        if (tokens <= remaining) {
          out.push(sys);
          remaining -= tokens;
        } else {
          out.push({ ...sys, content: truncateText(text, remaining) } as ChatCompletionMessageParam);
          remaining = 0;
          truncatedMessageCount++;
          break;
        }
      }
      const finalTokens = maxTokens - remaining;
      console.log(`[LLMGateway] Truncated context from ${totalEstimatedTokens} to ~${finalTokens} tokens (system-only)`);
      return {
        messages: out,
        truncationApplied: true,
        originalTokens: totalEstimatedTokens,
        finalTokens,
        droppedMessages: messages.length - out.length,
        truncatedMessageCount,
      };
    }

    // Always keep at least the last user message (or last non-system message as fallback) so we never
    // send an empty contents array to Gemini after system-message extraction.
    const mustKeepIndex = (() => {
      for (let i = otherMessages.length - 1; i >= 0; i--) {
        if (otherMessages[i].role === "user") return i;
      }
      return otherMessages.length - 1;
    })();

    let mustKeep: ChatCompletionMessageParam = otherMessages[mustKeepIndex];
    const isMultimodal = Array.isArray(mustKeep.content);
    let mustKeepText = toText(mustKeep);
    let mustKeepTokens = isMultimodal
      ? 500 // Flat estimate for multimodal messages (image data is not counted as context tokens)
      : estimateTokens(mustKeepText);

    // CRITICAL: Never silently truncate the latest user message.
    // If it alone exceeds budget, pass it through intact — let the provider decide how to handle it.
    // The user's prompt integrity is more important than staying under the estimated budget.
    if (mustKeepTokens > maxTokens && !isMultimodal) {
      // Previously: truncated the user message silently. Now: keep it intact.
      console.warn(`[LLMGateway] Latest user message (${mustKeepTokens} tokens) exceeds context budget (${maxTokens}). Sending intact — provider will enforce actual limits.`);
      return {
        messages: [mustKeep],
        truncationApplied: true,
        originalTokens: totalEstimatedTokens,
        finalTokens: mustKeepTokens,
        droppedMessages: messages.length - 1,
        truncatedMessageCount: 0,
      };
    }

    // Reserve budget for the must-keep message, then spend the remainder on system + recent history.
    let remainingTokens = maxTokens - mustKeepTokens;

    const outSystem: ChatCompletionMessageParam[] = [];
    for (const sys of systemMessages) {
      if (remainingTokens <= 0) break;
      const text = toText(sys);
      const tokens = estimateTokens(text);
      if (tokens <= remainingTokens) {
        outSystem.push(sys);
        remainingTokens -= tokens;
      } else {
        outSystem.push({ ...sys, content: truncateText(text, remainingTokens) } as ChatCompletionMessageParam);
        remainingTokens = 0;
        truncatedMessageCount++;
        break;
      }
    }

    const outOthers: ChatCompletionMessageParam[] = [mustKeep];
    for (let i = mustKeepIndex - 1; i >= 0; i--) {
      if (remainingTokens <= 0) break;
      const msg = otherMessages[i];
      const text = toText(msg);
      const tokens = estimateTokens(text);

      if (tokens <= remainingTokens) {
        outOthers.unshift(msg);
        remainingTokens -= tokens;
      } else {
        // If we still have some room, include a truncated version of this message and stop.
        if (remainingTokens >= 50) {
          outOthers.unshift({ ...msg, content: truncateText(text, remainingTokens) } as ChatCompletionMessageParam);
          remainingTokens = 0;
          truncatedMessageCount++;
        }
        break;
      }
    }

    const truncated: ChatCompletionMessageParam[] = [...outSystem, ...outOthers];
    const finalTokens = maxTokens - remainingTokens;
    console.log(`[LLMGateway] Truncated context from ${totalEstimatedTokens} to ~${finalTokens} tokens (dropped ${messages.length - truncated.length} msgs, truncated ${truncatedMessageCount} msgs)`);
    return {
      messages: truncated,
      truncationApplied: true,
      originalTokens: totalEstimatedTokens,
      finalTokens,
      droppedMessages: messages.length - truncated.length,
      truncatedMessageCount,
    };
  }

  private getTruncationBudget(maxOutputTokens?: number): number {
    if (typeof maxOutputTokens !== "number" || !Number.isFinite(maxOutputTokens) || maxOutputTokens <= 0) {
      return MAX_CONTEXT_TOKENS;
    }

    // `maxTokens` is an output budget. For small outputs (e.g. 30-80 tokens), we still need enough
    // context budget to carry system prompts + the user message. Use a floor to prevent "system-only"
    // truncation that breaks Gemini (contents required).
    const scaled = Math.floor(maxOutputTokens * 16);
    return Math.min(MAX_CONTEXT_TOKENS, Math.max(800, scaled));
  }

  // ===== Message Conversion =====
  private convertToGeminiMessages(messages: ChatCompletionMessageParam[]): { messages: GeminiChatMessage[]; systemInstruction?: string } {
    const systemMsg = messages.find(m => m.role === "system");
    const systemInstruction = systemMsg && typeof systemMsg.content === "string" ? systemMsg.content : undefined;

    const geminiMessages: GeminiChatMessage[] = messages
      .filter(m => m.role !== "system")
      .map(m => {
        const role = m.role === "assistant" ? "model" : "user";

        // Handle multimodal content (array of text + image_url parts)
        if (Array.isArray(m.content)) {
          const parts: any[] = [];
          for (const part of m.content as any[]) {
            if (part.type === "text") {
              parts.push({ text: part.text });
            } else if (part.type === "image_url" && part.image_url?.url) {
              // Extract base64 from data URI for Gemini's inlineData format
              const url = part.image_url.url as string;
              const dataUriMatch = url.match(/^data:([^;]+);base64,(.+)$/);
              if (dataUriMatch) {
                parts.push({
                  inlineData: {
                    mimeType: dataUriMatch[1],
                    data: dataUriMatch[2],
                  },
                });
              } else {
                // URL-based image — Gemini supports fileUri but for simplicity add as text reference
                parts.push({ text: `[Image: ${url}]` });
              }
            }
          }
          if (parts.length === 0) parts.push({ text: "" });
          return { role, parts };
        }

        return {
          role,
          parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
        };
      });

    return { messages: geminiMessages, systemInstruction };
  }

  // ===== Provider Selection =====
  private getXaiApiKey(): string | undefined {
    try {
      return secretManager.getLLMProviderKey("xai");
    } catch {
      return undefined;
    }
  }

  private getGeminiApiKey(): string | undefined {
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  }

  private isProviderConfigured(provider: LLMProvider): boolean {
    switch (provider) {
      case "xai":
        return Boolean(this.getXaiApiKey() && this.getXaiApiKey()!.trim());
      case "gemini":
        return Boolean(this.getGeminiApiKey() && this.getGeminiApiKey()!.trim());
      case "openai":
        // Si hay un BASE_URL customizado, está preconfigurado para Local Host (Ollama/LM Studio)
        if (Boolean(process.env.OPENAI_BASE_URL)) return true;
        return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
      case "anthropic":
        return Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim());
      case "deepseek":
        return Boolean(process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.trim());
    }
  }

  // T100-7.1: Algoritmo Inteligente de Enrutamiento (Smart Routing)
  // Evalúa dinámicamente Costo, Latencia (Observabilidad) y Tasa de Errores (Breakers)
  private getSmartRoutedProviders(): LLMProvider[] {
    if (process.env.OPENAI_BASE_URL?.includes("openrouter.ai")) {
      return ["openai"];
    }
    const configured: LLMProvider[] = ["gemini", "deepseek", "xai", "openai", "anthropic"];
    const active = configured.filter((p) => this.isProviderConfigured(p));

    return active.sort((a, b) => {
      const latA = this.metrics.byProvider[a]?.latency || Infinity;
      const latB = this.metrics.byProvider[b]?.latency || Infinity;

      const errA = this.metrics.byProvider[a]?.failures || 0;
      const errB = this.metrics.byProvider[b]?.failures || 0;

      // Hardcoded tier list for cost approximation per 1M tokens (Flash/Haiku/Chat)
      // 1 = Cheapest, 5 = Most Expensive
      const costTiers: Record<LLMProvider, number> = { deepseek: 1, gemini: 2, xai: 3, openai: 4, anthropic: 5 };

      // Score Heurístico = (Costo * 1000) + Latencia_P95 + Penalización por Errores
      const scoreA = (costTiers[a] * 1000) + (latA === Infinity ? 2000 : latA) + (errA * 5000);
      const scoreB = (costTiers[b] * 1000) + (latB === Infinity ? 2000 : latB) + (errB * 5000);

      return scoreA - scoreB;
    });
  }

  private selectProvider(options: LLMRequestOptions): LLMProvider {
    if (options.provider && options.provider !== "auto") {
      // If a provider is explicitly requested but not configured (missing API key),
      // treat it as "auto" so we can still respond instead of hard-failing.
      if (this.isProviderConfigured(options.provider)) {
        return options.provider;
      }
      console.warn("[LLMGateway] Requested provider is not configured; falling back to auto.", {
        provider: options.provider,
      });
    }

    // Auto-detect provider based on model name.
    const detectedProvider = detectProviderFromModel(options.model);
    if (detectedProvider && this.isProviderConfigured(detectedProvider)) {
      return detectedProvider;
    }

    // T100-7.1: Pick the first configured provider whose circuit is not OPEN using Smart Routing.
    const smartOrder = this.getSmartRoutedProviders();
    for (const provider of smartOrder) {
      const breaker = getCircuitBreaker("system", provider);
      if (breaker.getState() !== CircuitState.OPEN) {
        return provider;
      }
    }

    // If all circuits are OPEN, fall back to the most optimal configured provider (if any).
    return smartOrder[0] || "gemini";
  }

  // ===== Token Usage Tracking =====
  private recordTokenUsage(record: TokenUsageRecord): void {
    this.tokenUsageHistory.push(record);
    if (this.tokenUsageHistory.length > TOKEN_HISTORY_MAX) {
      this.tokenUsageHistory.shift();
    }
    this.metrics.totalTokens += record.totalTokens;
    this.metrics.byProvider[record.provider].tokens += record.totalTokens;

    // T100-2: Contabilidad FinOps Inmutable Asíncrona
    costEngine.recordTokensAndCost({
      requestId: record.requestId,
      userId: record.userId,
      workspaceId: 'system', // Defaults to system for shared logic
      modelName: record.model,
      inputTokens: record.promptTokens,
      outputTokens: record.completionTokens,
      latencyMs: record.latencyMs,
      metadata: { cached: record.cached, fallback: record.fromFallback }
    }).catch(err => console.error(`[FinOps] Ledger Error:`, err));
  }

  getTokenUsageStats(since?: number): {
    total: number;
    byProvider: Record<string, number>;
    byUser: Record<string, number>;
    recentRequests: number;
  } {
    const cutoff = since || Date.now() - 3600000; // Last hour by default
    const relevant = this.tokenUsageHistory.filter(r => r.timestamp >= cutoff);

    const byProvider: Record<string, number> = { xai: 0, gemini: 0, openai: 0, anthropic: 0, deepseek: 0 };
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

    // Check cache first (Redis with in-memory fallback)
    const cacheKey = this.getCacheKey(messages, options);
    if (cacheKey) {
      try {
        const redisCached = await redis.get(cacheKey);
        if (redisCached) {
          const parsed = JSON.parse(redisCached) as { response: LLMResponse; expiresAt: number };
          if (parsed.expiresAt > Date.now()) {
            this.metrics.cacheHits++;
            console.log(`[LLMGateway] ${requestId} cache hit (Redis)`);
            return { ...parsed.response, cached: true, requestId };
          }
        }
      } catch (redisErr) {
        // Fallback to in-memory cache if Redis fails
        const cached = this.requestCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          this.metrics.cacheHits++;
          console.log(`[LLMGateway] ${requestId} cache hit (Memory Fallback)`);
          return { ...cached.response, cached: true, requestId };
        }
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

    // Truncate context (budget is independent from max output tokens; we keep a safe floor for small outputs).
    const truncationResult = this.truncateContext(messages, this.getTruncationBudget(options.maxTokens));
    const truncatedMessages = truncationResult.messages;
    if (truncationResult.truncationApplied) {
      console.log(`[LLMGateway] chat() context truncation: ${truncationResult.originalTokens} → ${truncationResult.finalTokens} tokens, dropped ${truncationResult.droppedMessages} msgs`);
    }

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

      // Cache successful response (Redis + memory)
      if (cacheKey) {
        const cacheEntry = {
          response: result,
          expiresAt: Date.now() + CACHE_TTL_MS,
        };
        this.requestCache.set(cacheKey, cacheEntry);
        try {
          // Set in Redis with PX (milliseconds)
          await redis.set(cacheKey, JSON.stringify(cacheEntry), "PX", CACHE_TTL_MS);
        } catch (err) {
          console.warn(`[LLMGateway] Failed to set cache in Redis for ${cacheKey}`, err);
        }
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
    const configuredProviders = this.getSmartRoutedProviders();
    if (configuredProviders.length === 0) {
      throw new Error(
        "No LLM providers configured. Set at least one of: XAI_API_KEY (or GROK_API_KEY/ILIAGPT_API_KEY), GEMINI_API_KEY (or GOOGLE_API_KEY), OPENAI_API_KEY, ANTHROPIC_API_KEY, DEEPSEEK_API_KEY."
      );
    }

    if (options.provider && options.provider !== "auto" && !this.isProviderConfigured(options.provider)) {
      throw new Error(`Provider '${options.provider}' requested but not configured (missing API key).`);
    }

    // T100-2: Budget Guardrails (Deny execution if wallet is fully exhausted)
    await costEngine.enforceGuardrails(options.userId || "anonymous", 0);

    // Respect explicit provider selection / auto selection.
    const selected = this.selectProvider(options);
    const primaryProvider = this.isProviderConfigured(selected) ? selected : configuredProviders[0];

    const providers: LLMProvider[] = enableFallback
      ? [primaryProvider, ...configuredProviders.filter((p) => p !== primaryProvider)]
      : [primaryProvider];

    let lastError: Error | null = null;

    for (const provider of providers) {
      const breaker = getCircuitBreaker("system", provider, CIRCUIT_BREAKER_CONFIG);
      if (breaker.getState() === CircuitState.OPEN) {
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
    provider: LLMProvider,
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions & { requestId: string; timeout: number },
    startTime: number
  ): Promise<LLMResponse> {
    const breaker = getCircuitBreaker("system", provider, CIRCUIT_BREAKER_CONFIG);

    try {
      return await breaker.execute(() => this.executeOnProviderNoBreaker(provider, messages, options, startTime));
    } catch (error) {
      throw error;
    }
  }

  private async executeOnProviderNoBreaker(
    provider: LLMProvider,
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions & { requestId: string; timeout: number },
    startTime: number
  ): Promise<LLMResponse> {
    const modelProvider = detectProviderFromModel(options.model);

    let model: string;
    if (provider === "xai") {
      model = modelProvider === "xai" ? options.model! : MODELS.TEXT;
    } else if (provider === "gemini") {
      model = modelProvider === "gemini" ? options.model! : GEMINI_MODELS.FLASH;
    } else if (provider === "openai") {
      model = modelProvider === "openai" ? options.model! : (process.env.OPENAI_MODEL || "gpt-4o-mini");
    } else if (provider === "deepseek") {
      model = modelProvider === "deepseek" ? options.model! : (process.env.DEEPSEEK_MODEL || "deepseek-chat");
    } else {
      // anthropic
      model = modelProvider === "anthropic" ? options.model! : (process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022");
    }

    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      try {
        if (provider === "gemini") {
          return await this.executeGemini(messages, options, model, startTime);
        }
        if (provider === "anthropic") {
          return await this.executeAnthropic(messages, options, model, startTime);
        }
        // xai / openai / deepseek
        return await this.executeOpenAICompatible(provider, messages, options, model, startTime);
      } catch (error: any) {
        const isRetryable =
          error.status === 429 ||
          error.status === 500 ||
          error.status === 502 ||
          error.status === 503 ||
          error.code === "ECONNRESET" ||
          error.code === "ETIMEDOUT";

        if (!isRetryable || attempt >= RETRY_CONFIG.maxRetries) {
          throw error;
        }

        const delay = this.calculateRetryDelay(attempt);
        console.warn(`[LLMGateway] ${options.requestId} ${provider} attempt ${attempt + 1} failed, retrying in ${delay}ms`);
        await this.sleep(delay);
      }
    }

    throw new Error("Max retries exceeded");
  }

  private getOpenAICompatibleClient(provider: "xai" | "openai" | "deepseek"): OpenAI {
    if (provider === "xai") {
      if (!this.xaiClient) {
        this.xaiClient = new OpenAI({
          baseURL: "https://api.x.ai/v1",
          apiKey: this.getXaiApiKey() || "missing",
        });
      }
      return this.xaiClient;
    }

    if (provider === "openai") {
      if (!this.openaiClient) {
        this.openaiClient = new OpenAI({
          apiKey: process.env.OPENAI_BASE_URL ? (process.env.OPENAI_API_KEY || "dummy-key") : secretManager.getLLMProviderKey("openai"),
          baseURL: process.env.OPENAI_BASE_URL || undefined,
        });
      }
      return this.openaiClient;
    }

    if (!this.deepseekClient) {
      this.deepseekClient = new OpenAI({
        baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
        apiKey: secretManager.getLLMProviderKey("deepseek"),
      });
    }
    return this.deepseekClient;
  }

  private async executeOpenAICompatible(
    provider: "xai" | "openai" | "deepseek",
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions & { requestId: string; timeout: number },
    model: string,
    startTime: number
  ): Promise<LLMResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout);

    try {
      const client = this.getOpenAICompatibleClient(provider);
      const response = await client.chat.completions.create(
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

      this.metrics.successfulRequests++;
      this.metrics.byProvider[provider].requests++;
      this.metrics.totalLatencyMs += latencyMs;

      const usageRecord: TokenUsageRecord = {
        requestId: options.requestId,
        userId: options.userId || "anonymous",
        provider,
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

      console.log(`[LLMGateway] ${options.requestId} ${provider} completed in ${latencyMs}ms, tokens: ${usage?.total_tokens || 0}`);

      recordConnectorUsage(provider, latencyMs, true);

      this.persistApiLog({
        provider,
        model,
        endpoint: "/chat/completions",
        latencyMs,
        statusCode: 200,
        tokensIn: usage?.prompt_tokens,
        tokensOut: usage?.completion_tokens,
        userId: options.userId,
      });

      const qualityAnalysis = analyzeResponseQuality(content);
      const qualityScore = calculateQualityScore(content, usage?.total_tokens || 0, latencyMs);

      const qualityMetric: QualityMetric = {
        responseId: options.requestId,
        provider,
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
        provider,
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;

      this.metrics.failedRequests++;
      this.metrics.byProvider[provider].failures++;

      recordConnectorUsage(provider, latencyMs, false);

      this.persistApiLog({
        provider,
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

  private getAnthropicClient(): Anthropic {
    if (!this.anthropicClient) {
      this.anthropicClient = new Anthropic({
        apiKey: secretManager.getLLMProviderKey("anthropic"),
      });
    }
    return this.anthropicClient;
  }

  private convertToAnthropicMessages(messages: ChatCompletionMessageParam[]): { system?: string; messages: Array<{ role: "user" | "assistant"; content: any }> } {
    const systemParts: string[] = [];
    const out: Array<{ role: "user" | "assistant"; content: any }> = [];

    for (const msg of messages) {
      const role = (msg as any)?.role;
      const contentRaw = (msg as any)?.content;

      // Handle multimodal content arrays (with image_url parts)
      if (Array.isArray(contentRaw) && contentRaw.some((p: any) => p?.type === "image_url")) {
        if (role === "system") {
          // Extract text only from system messages
          const text = contentRaw
            .filter((p: any) => p?.type === "text")
            .map((p: any) => p.text)
            .join("\n");
          if (text.trim()) systemParts.push(text);
          continue;
        }

        // Build Anthropic multimodal content blocks
        const anthropicContent: any[] = [];
        for (const part of contentRaw) {
          if (part?.type === "text" && part.text?.trim()) {
            anthropicContent.push({ type: "text", text: part.text });
          } else if (part?.type === "image_url" && part.image_url?.url) {
            const url = part.image_url.url as string;
            const dataUriMatch = url.match(/^data:([^;]+);base64,(.+)$/);
            if (dataUriMatch) {
              anthropicContent.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: dataUriMatch[1],
                  data: dataUriMatch[2],
                },
              });
            }
          }
        }

        if (anthropicContent.length > 0 && (role === "user" || role === "assistant")) {
          out.push({ role, content: anthropicContent });
          continue;
        }
      }

      const content = typeof contentRaw === "string"
        ? contentRaw
        : Array.isArray(contentRaw)
          ? contentRaw
            .map((part: any) => (part?.type === "text" ? part?.text : JSON.stringify(part)))
            .filter(Boolean)
            .join("\n")
          : contentRaw == null
            ? ""
            : String(contentRaw);

      if (!content.trim()) continue;

      if (role === "system") {
        systemParts.push(content);
        continue;
      }

      if (role === "assistant" || role === "user") {
        out.push({ role, content });
        continue;
      }

      // Tools/function calls are not supported directly here; keep context as user-visible text.
      out.push({ role: "user", content: `[${String(role)}] ${content}` });
    }

    return { system: systemParts.length ? systemParts.join("\n\n") : undefined, messages: out };
  }

  private async executeAnthropic(
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions & { requestId: string; timeout: number },
    model: string,
    startTime: number
  ): Promise<LLMResponse> {
    const { system, messages: anthropicMessages } = this.convertToAnthropicMessages(messages);
    if (anthropicMessages.length === 0) {
      throw new Error("Anthropic API error: No valid messages after conversion");
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout);

    try {
      const client = this.getAnthropicClient();
      const response = await client.messages.create(
        {
          model,
          system,
          messages: anthropicMessages,
          max_tokens: options.maxTokens ?? 1024,
          temperature: options.temperature ?? 0.7,
          top_p: options.topP ?? 1,
        },
        { signal: controller.signal as any }
      );

      clearTimeout(timeoutId);

      const latencyMs = Date.now() - startTime;
      const content = (response.content || [])
        .map((c: any) => (c?.type === "text" ? c.text : ""))
        .filter(Boolean)
        .join("")
        .trim();

      const promptTokens = (response.usage as any)?.input_tokens ?? 0;
      const completionTokens = (response.usage as any)?.output_tokens ?? 0;
      const totalTokens = promptTokens + completionTokens;

      this.metrics.successfulRequests++;
      this.metrics.byProvider.anthropic.requests++;
      this.metrics.totalLatencyMs += latencyMs;

      const usageRecord: TokenUsageRecord = {
        requestId: options.requestId,
        userId: options.userId || "anonymous",
        provider: "anthropic",
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        timestamp: Date.now(),
        latencyMs,
        cached: false,
        fromFallback: false,
      };
      this.recordTokenUsage(usageRecord);

      recordConnectorUsage("anthropic", latencyMs, true);

      this.persistApiLog({
        provider: "anthropic",
        model,
        endpoint: "/messages",
        latencyMs,
        statusCode: 200,
        tokensIn: promptTokens,
        tokensOut: completionTokens,
        userId: options.userId,
      });

      const qualityAnalysis = analyzeResponseQuality(content);
      const qualityScore = calculateQualityScore(content, totalTokens, latencyMs);

      const qualityMetric: QualityMetric = {
        responseId: options.requestId,
        provider: "anthropic",
        score: qualityScore,
        tokensUsed: totalTokens,
        latencyMs,
        timestamp: new Date(),
        issues: qualityAnalysis.issues,
        isComplete: qualityAnalysis.isComplete,
        hasContentIssues: qualityAnalysis.hasContentIssues,
      };
      recordQualityMetric(qualityMetric);

      return {
        content,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens,
        },
        requestId: options.requestId,
        latencyMs,
        model,
        provider: "anthropic",
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;

      this.metrics.failedRequests++;
      this.metrics.byProvider.anthropic.failures++;

      recordConnectorUsage("anthropic", latencyMs, false);

      this.persistApiLog({
        provider: "anthropic",
        model,
        endpoint: "/messages",
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

    // Gemini can consume hidden "thinking" tokens; very small output budgets can produce empty/partial
    // visible text. Enforce a safe floor so the user reliably gets an answer.
    const maxOutputTokens = typeof options.maxTokens === "number"
      ? Math.max(options.maxTokens, 256)
      : options.maxTokens;

    let response;
    try {
      response = await geminiChat(geminiMessages, {
        model: model as any,
        systemInstruction,
        temperature: options.temperature ?? 0.7,
        topP: options.topP ?? 1,
        maxOutputTokens,
      });
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      this.metrics.failedRequests++;
      this.metrics.byProvider.gemini.failures++;

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

    if (!response.content || !response.content.trim()) {
      // Treat empty output as a provider failure so fallback providers can recover.
      throw new Error("Gemini API error: Empty response content");
    }

    const latencyMs = Date.now() - startTime;

    this.metrics.successfulRequests++;
    this.metrics.byProvider.gemini.requests++;

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
  async * streamChat(
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions = {}
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const requestId = options.requestId || this.generateRequestId();
    const userId = options.userId || "anonymous";
    const enableFallback = options.enableFallback !== false;
    let sequenceId = 0;
    let accumulatedContent = "";
    const configuredProviders = this.getSmartRoutedProviders();
    if (configuredProviders.length === 0) {
      throw new Error(
        "No LLM providers configured. Set at least one of: XAI_API_KEY (or GROK_API_KEY/ILIAGPT_API_KEY), GEMINI_API_KEY (or GOOGLE_API_KEY), OPENAI_API_KEY, ANTHROPIC_API_KEY, DEEPSEEK_API_KEY."
      );
    }

    if (options.provider && options.provider !== "auto" && !this.isProviderConfigured(options.provider)) {
      throw new Error(`Provider '${options.provider}' requested but not configured (missing API key).`);
    }

    const selected = this.selectProvider(options);
    let currentProvider: LLMProvider = this.isProviderConfigured(selected) ? selected : configuredProviders[0];

    this.metrics.totalRequests++;

    if (!this.checkRateLimit(userId)) {
      throw new Error(`Rate limit exceeded for user ${userId}`);
    }

    const truncationResult = this.truncateContext(messages, this.getTruncationBudget(options.maxTokens));
    const truncatedMessages = truncationResult.messages;
    // Expose truncation metadata via options for callers to read
    (options as any).__truncationResult = truncationResult;
    if (truncationResult.truncationApplied) {
      console.log(`[LLMGateway] streamChat() context truncation: ${truncationResult.originalTokens} → ${truncationResult.finalTokens} tokens, dropped ${truncationResult.droppedMessages} msgs, truncated ${truncationResult.truncatedMessageCount} msgs`);
    }

    // Check for existing checkpoint (recovery)
    const existingCheckpoint = this.streamCheckpoints.get(requestId);
    if (existingCheckpoint) {
      sequenceId = existingCheckpoint.sequenceId;
      accumulatedContent = existingCheckpoint.accumulatedContent;
      this.metrics.streamRecoveries++;
      console.log(`[LLMGateway] ${requestId} recovering from checkpoint at seq ${sequenceId}`);
    }

    const providers: LLMProvider[] = enableFallback
      ? [currentProvider, ...configuredProviders.filter((p: LLMProvider) => p !== currentProvider)]
      : [currentProvider];

    for (const provider of providers) {
      const breaker = getCircuitBreaker("system", provider, CIRCUIT_BREAKER_CONFIG);
      if (breaker.getState() === CircuitState.OPEN) {
        continue;
      }

      try {
        const stream = provider === "gemini"
          ? this.streamGemini(truncatedMessages, options, requestId)
          : provider === "anthropic"
            ? this.streamAnthropic(truncatedMessages, options, requestId)
            : this.streamOpenAICompatible(provider, truncatedMessages, options, requestId);

        for await (const chunk of this.withIdleTimeout(stream, STREAM_IDLE_TIMEOUT_MS, requestId)) {
          accumulatedContent += chunk.content;

          // Some providers can return a "done" marker without any visible text (e.g. if the output
          // budget is too low or the response is otherwise suppressed). Treat that as a failure so
          // fallback providers can attempt recovery.
          if (chunk.done && accumulatedContent.trim().length === 0) {
            throw new Error(`Empty streamed response from provider ${provider}`);
          }

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
            getCircuitBreaker("system", provider, CIRCUIT_BREAKER_CONFIG).recordSuccess();
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

        getCircuitBreaker("system", provider, CIRCUIT_BREAKER_CONFIG).recordFailure();
        console.warn(`[LLMGateway] ${requestId} stream failed on ${provider}: ${error.message}`);

        if (!enableFallback || providers.indexOf(provider) === providers.length - 1) {
          throw error;
        }

        console.log(`[LLMGateway] ${requestId} attempting stream fallback to next provider`);
      }
    }

    throw new Error("All providers failed during streaming");
  }

  // ===== Typed Streaming (Schema Validation) =====
  async * streamStructured(
    messages: ChatCompletionMessageParam[],
    schema: ZodSchema<any>,
    options: LLMRequestOptions = {}
  ): AsyncGenerator<AgentEvent, void, unknown> {
    const requestId = options.requestId || this.generateRequestId();

    // Inject system instruction for JSON enforcement
    // We add this to the messages locally without mutating existing array
    const systemPrompt: ChatCompletionMessageParam = {
      role: "system",
      content: `You must respond with valid JSON strictly conforming to the provided schema. Do not output markdown blocks or explanations.`
    };

    const augmentedMessages = [systemPrompt, ...messages];

    // In a real implementation with "Instructor" pattern, we would:
    // 1. Accumulate the full text stream
    // 2. Parsed JSON incrementally (if possible) or at chunks
    // 3. For now, we wrap the text stream and emit "content_delta" events
    //    and then try to parse the final result to ensure validity?
    //    Wait, "Typed Streaming" in the plan implies emitting events like "ThreadRunStep"

    // Actually, for "Typed Streaming", we largely want to standardize the events THE AGENT emits.
    // So this method might be consumed by the Agent Logic, which parses raw LLM text into these events.

    // Let's implement a simpler version that wraps streamChat and emits typed events.
    // If the schema is for the FINAL output, we validate at the end.

    let currentMessages = [...augmentedMessages];
    const maxRetries = 2; // 0 = initial, 1 = first retry, 2 = second retry

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let fullContent = "";

      try {
        if (attempt > 0) {
          yield { type: "status", status: "thinking", message: `Fixing output format (Attempt ${attempt + 1})...` };
        } else {
          yield { type: "status", status: "thinking", message: "Connecting to model..." };
        }

        const stream = this.streamChat(currentMessages, options);

        let fullContent = "";

        for await (const chunk of stream) {
          fullContent += chunk.content;

          yield {
            type: "content_delta",
            delta: chunk.content,
            snapshot: fullContent // accumulation for recovery/UI
          };
        }

        yield { type: "status", status: "parsing_document", message: "Validating output schema..." };

        // Attempt to parse final content against schema
        // Only if content is expected to be JSON. If it's chat, schema might be just "z.string()"
        try {
          // Heuristic: if schema looks like an object/array, try JSON parsing
          // This is a naive check. Ideally we use structured output modes from providers.
          const firstChar = fullContent.trim()[0];
          if (firstChar === "{" || firstChar === "[") {
            const json = JSON.parse(fullContent);
            const result = schema.parse(json);
            // We could emit a "final_result" event if we had one
          }

          yield { type: "status", status: "ready" };

        } catch (validationError: any) {
          console.warn(`[LLMGateway] Schema violation on ${requestId} (attempt ${attempt + 1}):`, validationError.message);

          if (attempt === maxRetries) {
            yield {
              type: "status",
              status: "error",
              message: `Final Schema violation: ${validationError.message}`
            };
            return;
          }

          // Retry: Feed error back to LLM
          currentMessages.push({ role: "assistant", content: fullContent });
          currentMessages.push({
            role: "user",
            content: `Your response was not valid JSON or did not match the schema. Error: ${validationError.message}\n\nPlease correct your JSON.`
          });

          yield {
            type: "status",
            status: "error",
            message: `Validation failed, retrying...`
          };
        }

      } catch (error: any) {
        yield { type: "status", status: "error", message: error.message };
        return;
      }
    }
  }

  private async * streamOpenAICompatible(
    provider: "xai" | "openai" | "deepseek",
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions,
    requestId: string
  ): AsyncGenerator<{ content: string; done: boolean }, void, unknown> {
    const modelProvider = detectProviderFromModel(options.model);

    let model: string;
    if (provider === "xai") {
      model = modelProvider === "xai" ? options.model! : MODELS.TEXT;
    } else if (provider === "openai") {
      model = modelProvider === "openai" ? options.model! : (process.env.OPENAI_MODEL || "gpt-4o-mini");
    } else {
      model = modelProvider === "deepseek" ? options.model! : (process.env.DEEPSEEK_MODEL || "deepseek-chat");
    }

    const client = this.getOpenAICompatibleClient(provider);
    const controller = new AbortController();
    const totalTimeoutMs = options.timeout ?? DEFAULT_STREAM_TIMEOUT_MS;
    let abortedReason: "timeout" | "idle" | null = null;
    const totalTimeoutId = setTimeout(() => {
      abortedReason = "timeout";
      controller.abort();
    }, totalTimeoutMs);

    let idleTimeoutId: NodeJS.Timeout | null = setTimeout(() => {
      abortedReason = "idle";
      controller.abort();
    }, STREAM_IDLE_TIMEOUT_MS);

    const resetIdle = () => {
      if (idleTimeoutId) clearTimeout(idleTimeoutId);
      idleTimeoutId = setTimeout(() => {
        abortedReason = "idle";
        controller.abort();
      }, STREAM_IDLE_TIMEOUT_MS);
    };

    const stream = await client.chat.completions.create(
      {
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        top_p: options.topP ?? 1,
        max_tokens: options.maxTokens,
        stream: true,
      },
      { signal: controller.signal }
    );

    let buffer = "";
    const flushThreshold = 50;

    try {
      for await (const chunk of stream) {
        resetIdle();

        const content = chunk.choices[0]?.delta?.content || "";
        buffer += content;

        if (buffer.length >= flushThreshold || content.includes("\n") || content.includes(".")) {
          yield { content: buffer, done: false };
          buffer = "";
        }
      }
    } catch (error: any) {
      if (error?.name === "AbortError") {
        if (abortedReason === "idle") {
          throw new Error(`Stream idle timeout after ${STREAM_IDLE_TIMEOUT_MS}ms`);
        }
        throw new Error(`Stream timeout after ${totalTimeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(totalTimeoutId);
      if (idleTimeoutId) clearTimeout(idleTimeoutId);
    }

    if (buffer) {
      yield { content: buffer, done: false };
    }

    yield { content: "", done: true };
  }

  private async * streamAnthropic(
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions,
    requestId: string
  ): AsyncGenerator<{ content: string; done: boolean }, void, unknown> {
    const modelProvider = detectProviderFromModel(options.model);
    const model = modelProvider === "anthropic"
      ? options.model!
      : (process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022");

    const { system, messages: anthropicMessages } = this.convertToAnthropicMessages(messages);
    if (anthropicMessages.length === 0) {
      throw new Error("Anthropic API error: No valid messages after conversion");
    }

    const client = this.getAnthropicClient();
    const controller = new AbortController();
    const totalTimeoutMs = options.timeout ?? DEFAULT_STREAM_TIMEOUT_MS;
    let abortedReason: "timeout" | "idle" | null = null;
    const totalTimeoutId = setTimeout(() => {
      abortedReason = "timeout";
      controller.abort();
    }, totalTimeoutMs);

    let idleTimeoutId: NodeJS.Timeout | null = setTimeout(() => {
      abortedReason = "idle";
      controller.abort();
    }, STREAM_IDLE_TIMEOUT_MS);

    const resetIdle = () => {
      if (idleTimeoutId) clearTimeout(idleTimeoutId);
      idleTimeoutId = setTimeout(() => {
        abortedReason = "idle";
        controller.abort();
      }, STREAM_IDLE_TIMEOUT_MS);
    };

    const stream = await client.messages.create(
      {
        model,
        system,
        messages: anthropicMessages,
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.7,
        top_p: options.topP ?? 1,
        stream: true,
      } as any,
      { signal: controller.signal as any },
    );

    let buffer = "";
    const flushThreshold = 50;

    try {
      for await (const event of stream as any) {
        resetIdle();

        if (event?.type === "content_block_delta" && event?.delta?.type === "text_delta") {
          const text = String(event.delta.text || "");
          buffer += text;
          if (buffer.length >= flushThreshold || text.includes("\n") || text.includes(".")) {
            yield { content: buffer, done: false };
            buffer = "";
          }
        }
      }
    } catch (error: any) {
      if (error?.name === "AbortError") {
        if (abortedReason === "idle") {
          throw new Error(`Stream idle timeout after ${STREAM_IDLE_TIMEOUT_MS}ms`);
        }
        throw new Error(`Stream timeout after ${totalTimeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(totalTimeoutId);
      if (idleTimeoutId) clearTimeout(idleTimeoutId);
    }

    if (buffer) {
      yield { content: buffer, done: false };
    }

    yield { content: "", done: true };
  }

  private async * streamGemini(
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions,
    requestId: string
  ): AsyncGenerator<{ content: string; done: boolean }, void, unknown> {
    const modelProvider = detectProviderFromModel(options.model);
    const model = modelProvider === "gemini" ? options.model! : GEMINI_MODELS.FLASH;
    const { messages: geminiMessages, systemInstruction } = this.convertToGeminiMessages(messages);

    const maxOutputTokens = typeof options.maxTokens === "number"
      ? Math.max(options.maxTokens, 256)
      : options.maxTokens;

    const stream = geminiStreamChat(geminiMessages, {
      model: model as any,
      systemInstruction,
      temperature: options.temperature ?? 0.7,
      topP: options.topP ?? 1,
      maxOutputTokens,
      responseModalities: options.disableImageGeneration ? ["text"] : undefined,
    });

    const iterator = stream[Symbol.asyncIterator]();
    const totalTimeoutMs = options.timeout ?? DEFAULT_STREAM_TIMEOUT_MS;
    const totalDeadline = Date.now() + totalTimeoutMs;

    let idleTimeoutId: NodeJS.Timeout | null = null;
    const makeIdlePromise = () =>
      new Promise<never>((_, reject) => {
        idleTimeoutId = setTimeout(() => reject(new Error("__STREAM_IDLE_TIMEOUT__")), STREAM_IDLE_TIMEOUT_MS);
      });

    let idlePromise = makeIdlePromise();

    try {
      while (true) {
        const now = Date.now();
        const totalLeft = totalDeadline - now;
        if (totalLeft <= 0) {
          throw new Error(`Stream timeout after ${totalTimeoutMs}ms`);
        }

        let totalTimeoutId: NodeJS.Timeout | null = null;
        const totalPromise = new Promise<never>((_, reject) => {
          totalTimeoutId = setTimeout(() => reject(new Error("__STREAM_TOTAL_TIMEOUT__")), totalLeft);
        });

        let result: IteratorResult<{ content: string; done: boolean }>;
        try {
          result = await Promise.race([iterator.next(), idlePromise, totalPromise]);
        } finally {
          if (totalTimeoutId) clearTimeout(totalTimeoutId);
        }

        if (idleTimeoutId) clearTimeout(idleTimeoutId);
        idlePromise = makeIdlePromise();

        if (result.done) break;

        const chunk = result.value;
        yield chunk;

        if (chunk.done) break;
      }
    } catch (error: any) {
      const msg = String(error?.message || error);
      if (msg === "__STREAM_IDLE_TIMEOUT__") {
        throw new Error(`Stream idle timeout after ${STREAM_IDLE_TIMEOUT_MS}ms`);
      }
      if (msg === "__STREAM_TOTAL_TIMEOUT__") {
        throw new Error(`Stream timeout after ${totalTimeoutMs}ms`);
      }
      throw error;
    } finally {
      if (idleTimeoutId) clearTimeout(idleTimeoutId);
      // Best-effort: close underlying iterator to free resources.
      await iterator.return?.();
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
        xai: getCircuitBreaker("system", "xai").getState(),
        gemini: getCircuitBreaker("system", "gemini").getState(),
        openai: getCircuitBreaker("system", "openai").getState(),
        anthropic: getCircuitBreaker("system", "anthropic").getState(),
        deepseek: getCircuitBreaker("system", "deepseek").getState(),
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
        openai: { requests: 0, tokens: 0, failures: 0 },
        anthropic: { requests: 0, tokens: 0, failures: 0 },
        deepseek: { requests: 0, tokens: 0, failures: 0 },
      },
    };
  }

  // ===== Quality Stats =====
  getQualityStats(since?: Date): QualityStats {
    return getQualityStats(since);
  }

  // ===== Health Check =====
  async healthCheck(): Promise<Record<LLMProvider, { available: boolean; latencyMs?: number; error?: string }>> {
    const results: Record<LLMProvider, { available: boolean; latencyMs?: number; error?: string }> = {
      xai: { available: false },
      gemini: { available: false },
      openai: { available: false },
      anthropic: { available: false },
      deepseek: { available: false },
    };

    // Test xAI with quick timeout
    const xaiKey = this.getXaiApiKey();
    if (xaiKey) {
      try {
        const start = Date.now();
        const client = new OpenAI({
          baseURL: "https://api.x.ai/v1",
          apiKey: xaiKey || "missing",
          timeout: 5000,
        });
        await client.chat.completions.create({
          model: XAI_MODELS.GROK_3_MINI_FAST,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 5,
        });
        results.xai = { available: true, latencyMs: Date.now() - start };
      } catch (error: any) {
        results.xai = { available: false, error: error.message?.slice(0, 100) };
      }
    }

    // Test Gemini with quick timeout
    const geminiKey = this.getGeminiApiKey();
    if (geminiKey) {
      try {
        const start = Date.now();
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: "hi" }] }],
              generationConfig: { maxOutputTokens: 5 }
            }),
            signal: AbortSignal.timeout(5000)
          }
        );
        if (response.ok) {
          results.gemini = { available: true, latencyMs: Date.now() - start };
        } else {
          const err = await response.json().catch(() => ({}));
          results.gemini = { available: false, error: (err as any)?.error?.message?.slice(0, 100) || "API error" };
        }
      } catch (error: any) {
        results.gemini = { available: false, error: error.message?.slice(0, 100) };
      }
    }

    // Test OpenAI with quick timeout
    if (process.env.OPENAI_API_KEY) {
      try {
        const start = Date.now();
        const client = new OpenAI({
          apiKey: process.env.OPENAI_API_KEY || "missing",
          timeout: 5000,
        });
        await client.chat.completions.create({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 5,
        });
        results.openai = { available: true, latencyMs: Date.now() - start };
      } catch (error: any) {
        results.openai = { available: false, error: error.message?.slice(0, 100) };
      }
    }

    // Test DeepSeek (OpenAI-compatible) with quick timeout
    if (process.env.DEEPSEEK_API_KEY) {
      try {
        const start = Date.now();
        const client = new OpenAI({
          baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
          apiKey: process.env.DEEPSEEK_API_KEY || "missing",
          timeout: 5000,
        });
        await client.chat.completions.create({
          model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 5,
        });
        results.deepseek = { available: true, latencyMs: Date.now() - start };
      } catch (error: any) {
        results.deepseek = { available: false, error: error.message?.slice(0, 100) };
      }
    }

    // Test Anthropic with quick timeout
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const start = Date.now();
        const client = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY || "missing",
          timeout: 5000,
        });
        await client.messages.create({
          model: process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 5,
        } as any);
        results.anthropic = { available: true, latencyMs: Date.now() - start };
      } catch (error: any) {
        results.anthropic = { available: false, error: error.message?.slice(0, 100) };
      }
    }

    return results;
  }
}

export const llmGateway = new LLMGateway();
export type { LLMRequestOptions, LLMResponse, StreamChunk, StreamCheckpoint, TokenUsageRecord };
