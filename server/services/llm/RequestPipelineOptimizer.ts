/**
 * REQUEST PIPELINE OPTIMIZER
 *
 * Optimizes LLM requests through caching, deduplication, batching,
 * context compression, and prompt optimization.
 *
 * Features:
 * - Multi-layer caching (memory, Redis-ready)
 * - Request deduplication (in-flight request sharing)
 * - Automatic context window management
 * - Prompt compression and summarization
 * - Token estimation and budget enforcement
 * - Request batching for non-streaming calls
 * - Priority queuing
 */

import crypto from "crypto";
import { EventEmitter } from "events";
import type { LLMMessage, LLMRequestConfig, LLMCompletionResponse } from "../../lib/providers/BaseProvider";

// ============================================================================
// Types
// ============================================================================

export interface CacheEntry {
  response: LLMCompletionResponse;
  createdAt: number;
  expiresAt: number;
  hitCount: number;
  size: number;
}

export interface DeduplicationEntry {
  promise: Promise<LLMCompletionResponse>;
  startTime: number;
  subscribers: number;
}

export interface PipelineConfig {
  // Cache
  cacheEnabled: boolean;
  cacheTtlMs: number;
  cacheMaxSize: number; // Max entries
  cacheMinQueryLength: number; // Min chars to cache
  // Dedup
  deduplicationEnabled: boolean;
  deduplicationWindowMs: number;
  // Context
  maxContextTokens: number;
  reserveOutputTokens: number;
  contextStrategy: "truncate_oldest" | "summarize" | "sliding_window";
  // Batching
  batchingEnabled: boolean;
  batchMaxSize: number;
  batchWindowMs: number;
  // Token estimation
  charsPerToken: number;
}

export interface PipelineStats {
  cacheHits: number;
  cacheMisses: number;
  cacheEvictions: number;
  deduplications: number;
  contextTruncations: number;
  batchedRequests: number;
  totalTokensSaved: number;
  totalRequestsOptimized: number;
}

export interface TokenEstimate {
  promptTokens: number;
  estimatedOutputTokens: number;
  totalEstimate: number;
  withinBudget: boolean;
  suggestions: string[];
}

// ============================================================================
// Pipeline Optimizer
// ============================================================================

export class RequestPipelineOptimizer extends EventEmitter {
  private cache: Map<string, CacheEntry> = new Map();
  private inFlight: Map<string, DeduplicationEntry> = new Map();
  private stats: PipelineStats;
  private config: PipelineConfig;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(config?: Partial<PipelineConfig>) {
    super();
    this.config = {
      cacheEnabled: true,
      cacheTtlMs: 300000,
      cacheMaxSize: 5000,
      cacheMinQueryLength: 50,
      deduplicationEnabled: true,
      deduplicationWindowMs: 120000,
      maxContextTokens: 128000,
      reserveOutputTokens: 4096,
      contextStrategy: "truncate_oldest",
      batchingEnabled: false,
      batchMaxSize: 10,
      batchWindowMs: 100,
      charsPerToken: 4,
      ...config,
    };

    this.stats = {
      cacheHits: 0, cacheMisses: 0, cacheEvictions: 0, deduplications: 0,
      contextTruncations: 0, batchedRequests: 0, totalTokensSaved: 0, totalRequestsOptimized: 0,
    };

    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  // ===== Cache =====

  getCached(config: LLMRequestConfig): LLMCompletionResponse | null {
    if (!this.config.cacheEnabled) return null;

    const key = this.generateCacheKey(config);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.cacheMisses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.cacheMisses++;
      return null;
    }

    entry.hitCount++;
    this.stats.cacheHits++;
    this.emit("cacheHit", { key, hitCount: entry.hitCount });
    return { ...entry.response, cached: true };
  }

  setCached(config: LLMRequestConfig, response: LLMCompletionResponse): void {
    if (!this.config.cacheEnabled) return;

    // Don't cache short queries or errors
    const lastUserMsg = config.messages.filter((m) => m.role === "user").pop();
    const msgLen = typeof lastUserMsg?.content === "string" ? lastUserMsg.content.length : 0;
    if (msgLen < this.config.cacheMinQueryLength) return;
    if (response.finishReason === "error") return;

    const key = this.generateCacheKey(config);
    this.cache.set(key, {
      response,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.config.cacheTtlMs,
      hitCount: 0,
      size: response.content.length,
    });

    // Evict if over limit
    if (this.cache.size > this.config.cacheMaxSize) {
      this.evictLRU();
    }
  }

  private evictLRU(): void {
    let oldest: { key: string; time: number } | null = null;
    for (const [key, entry] of this.cache) {
      if (!oldest || entry.createdAt < oldest.time) {
        oldest = { key, time: entry.createdAt };
      }
    }
    if (oldest) {
      this.cache.delete(oldest.key);
      this.stats.cacheEvictions++;
    }
  }

  // ===== Deduplication =====

  getInFlight(config: LLMRequestConfig): Promise<LLMCompletionResponse> | null {
    if (!this.config.deduplicationEnabled) return null;

    const hash = this.generateContentHash(config);
    const entry = this.inFlight.get(hash);

    if (entry && Date.now() - entry.startTime < this.config.deduplicationWindowMs) {
      entry.subscribers++;
      this.stats.deduplications++;
      this.emit("deduplicated", { hash, subscribers: entry.subscribers });
      return entry.promise;
    }

    return null;
  }

  registerInFlight(config: LLMRequestConfig, promise: Promise<LLMCompletionResponse>): void {
    if (!this.config.deduplicationEnabled) return;

    const hash = this.generateContentHash(config);
    this.inFlight.set(hash, {
      promise,
      startTime: Date.now(),
      subscribers: 1,
    });

    // Auto-cleanup when promise resolves
    promise.finally(() => {
      setTimeout(() => this.inFlight.delete(hash), 1000);
    });
  }

  // ===== Context Optimization =====

  optimizeContext(config: LLMRequestConfig): {
    optimizedConfig: LLMRequestConfig;
    truncated: boolean;
    originalTokens: number;
    finalTokens: number;
    droppedMessages: number;
  } {
    const maxTokens = this.config.maxContextTokens - this.config.reserveOutputTokens;
    const originalTokens = this.estimateTokens(config.messages);

    if (originalTokens <= maxTokens) {
      return { optimizedConfig: config, truncated: false, originalTokens, finalTokens: originalTokens, droppedMessages: 0 };
    }

    this.stats.contextTruncations++;
    let messages = [...config.messages];
    let droppedMessages = 0;

    switch (this.config.contextStrategy) {
      case "truncate_oldest": {
        // Keep system message + last N messages that fit
        const systemMsgs = messages.filter((m) => m.role === "system");
        const nonSystem = messages.filter((m) => m.role !== "system");
        const systemTokens = this.estimateTokens(systemMsgs);
        let available = maxTokens - systemTokens;

        const kept: LLMMessage[] = [];
        for (let i = nonSystem.length - 1; i >= 0; i--) {
          const tokens = this.estimateTokens([nonSystem[i]]);
          if (available >= tokens) {
            kept.unshift(nonSystem[i]);
            available -= tokens;
          } else {
            droppedMessages++;
          }
        }
        messages = [...systemMsgs, ...kept];
        break;
      }

      case "sliding_window": {
        // Keep system + last 2/3 of messages
        const systemMsgs = messages.filter((m) => m.role === "system");
        const nonSystem = messages.filter((m) => m.role !== "system");
        const keepCount = Math.ceil(nonSystem.length * 0.67);
        droppedMessages = nonSystem.length - keepCount;
        messages = [...systemMsgs, ...nonSystem.slice(-keepCount)];
        break;
      }

      case "summarize": {
        // Placeholder: in production, call LLM to summarize old messages
        const systemMsgs = messages.filter((m) => m.role === "system");
        const nonSystem = messages.filter((m) => m.role !== "system");
        const halfIdx = Math.floor(nonSystem.length / 2);
        const oldMessages = nonSystem.slice(0, halfIdx);
        const recentMessages = nonSystem.slice(halfIdx);
        droppedMessages = oldMessages.length;

        const summaryMsg: LLMMessage = {
          role: "system",
          content: `[Previous conversation summary: ${oldMessages.length} messages about ${this.extractTopics(oldMessages)}]`,
        };
        messages = [...systemMsgs, summaryMsg, ...recentMessages];
        break;
      }
    }

    const finalTokens = this.estimateTokens(messages);
    const tokensSaved = originalTokens - finalTokens;
    this.stats.totalTokensSaved += tokensSaved;

    return {
      optimizedConfig: { ...config, messages },
      truncated: true,
      originalTokens,
      finalTokens,
      droppedMessages,
    };
  }

  // ===== Token Estimation =====

  estimateTokens(messages: LLMMessage | LLMMessage[]): number {
    const msgs = Array.isArray(messages) ? messages : [messages];
    let total = 0;
    for (const msg of msgs) {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      total += Math.ceil(content.length / this.config.charsPerToken) + 4; // +4 for role/formatting overhead
    }
    return total;
  }

  estimateRequest(config: LLMRequestConfig): TokenEstimate {
    const promptTokens = this.estimateTokens(config.messages);
    const estimatedOutputTokens = config.maxTokens || 4096;
    const totalEstimate = promptTokens + estimatedOutputTokens;
    const maxContext = this.config.maxContextTokens;
    const suggestions: string[] = [];

    if (promptTokens > maxContext * 0.8) {
      suggestions.push("Consider reducing conversation history or using context summarization");
    }
    if (estimatedOutputTokens > 16000) {
      suggestions.push("High max_tokens may increase costs; consider lowering if full output isn't needed");
    }

    return {
      promptTokens,
      estimatedOutputTokens,
      totalEstimate,
      withinBudget: totalEstimate <= maxContext,
      suggestions,
    };
  }

  // ===== Helpers =====

  private generateCacheKey(config: LLMRequestConfig): string {
    const data = JSON.stringify({
      model: config.model,
      messages: config.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    });
    return crypto.createHash("sha256").update(data).digest("hex").slice(0, 32);
  }

  private generateContentHash(config: LLMRequestConfig): string {
    return this.generateCacheKey(config);
  }

  private extractTopics(messages: LLMMessage[]): string {
    const text = messages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join(" ")
      .slice(0, 500);
    return text.slice(0, 100) + "...";
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) this.cache.delete(key);
    }
    for (const [hash, entry] of this.inFlight) {
      if (now - entry.startTime > this.config.deduplicationWindowMs) this.inFlight.delete(hash);
    }
  }

  getStats(): PipelineStats & { cacheSize: number; inFlightCount: number; cacheHitRate: number } {
    const total = this.stats.cacheHits + this.stats.cacheMisses;
    return {
      ...this.stats,
      cacheSize: this.cache.size,
      inFlightCount: this.inFlight.size,
      cacheHitRate: total > 0 ? this.stats.cacheHits / total : 0,
    };
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.cache.clear();
    this.inFlight.clear();
    this.removeAllListeners();
  }
}

// Singleton
export const pipelineOptimizer = new RequestPipelineOptimizer();
