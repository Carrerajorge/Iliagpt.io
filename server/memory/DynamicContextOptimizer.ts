/**
 * DynamicContextOptimizer — replaces naive "last N messages" with relevance-based selection.
 * Combines recent messages + semantically relevant historical messages within a token budget.
 */

import { createLogger } from "../utils/logger";
import { pgVectorMemoryStore } from "./PgVectorMemoryStore";

const logger = createLogger("DynamicContextOptimizer");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: Date;
  tokenCount?: number;
}

export interface OptimizedContext {
  messages: ChatMessage[];
  systemMemories: string[];
  tokenCount: number;
  strategy: "recent_only" | "semantic_blend" | "full";
  droppedMessages: number;
  includedHistoricalMessages: number;
}

export interface ContextOptimizerConfig {
  maxTotalTokens: number;
  systemPromptTokenBudget: number; // fraction of total for system prompt
  recentWindowSize: number;         // always include these last N messages
  semanticWindowSize: number;       // additional relevant messages from history
  minRelevanceSimilarity: number;
  modelContextWindow?: number;
}

// ─── Token Estimation ─────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  // Approximation: ~4 characters per token for English
  return Math.ceil(text.length / 4);
}

function countMessageTokens(msg: ChatMessage): number {
  if (msg.tokenCount) return msg.tokenCount;
  return estimateTokens(msg.content) + 4; // 4 for role/format overhead
}

// ─── Model Context Sizes ──────────────────────────────────────────────────────

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "claude-sonnet-4-6": 200_000,
  "claude-opus-4-6": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
  "gpt-4o": 128_000,
  "gpt-4-turbo": 128_000,
  "gemini-1.5-pro": 1_000_000,
  "gemini-1.5-flash": 1_000_000,
};

function getContextWindow(model?: string): number {
  if (!model) return 128_000;
  return MODEL_CONTEXT_WINDOWS[model] ?? 128_000;
}

// ─── Maximum Marginal Relevance ───────────────────────────────────────────────

interface ScoredMessage {
  message: ChatMessage;
  relevance: number;
  index: number;
}

function applyMMR(
  candidates: ScoredMessage[],
  selected: ScoredMessage[],
  lambda: number = 0.7,
  limit: number = 10
): ScoredMessage[] {
  // Simplified MMR without embeddings — uses keyword overlap as proxy for similarity
  const result: ScoredMessage[] = [...selected];
  const remaining = [...candidates];

  while (result.length < limit && remaining.length > 0) {
    let bestScore = -Infinity;
    let bestIdx = 0;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]!;

      // Relevance to query
      const relevanceScore = candidate.relevance;

      // Redundancy with already selected
      let maxSimilarity = 0;
      for (const sel of result) {
        const sim = keywordSimilarity(candidate.message.content, sel.message.content);
        maxSimilarity = Math.max(maxSimilarity, sim);
      }

      const mmrScore = lambda * relevanceScore - (1 - lambda) * maxSimilarity;

      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    result.push(remaining[bestIdx]!);
    remaining.splice(bestIdx, 1);
  }

  return result;
}

function keywordSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const setB = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }

  return intersection / Math.sqrt(setA.size * setB.size);
}

// ─── DynamicContextOptimizer ──────────────────────────────────────────────────

export class DynamicContextOptimizer {
  private config: ContextOptimizerConfig;

  constructor(config: Partial<ContextOptimizerConfig> = {}) {
    this.config = {
      maxTotalTokens: config.maxTotalTokens ?? 100_000,
      systemPromptTokenBudget: config.systemPromptTokenBudget ?? 0.15,
      recentWindowSize: config.recentWindowSize ?? 6,
      semanticWindowSize: config.semanticWindowSize ?? 8,
      minRelevanceSimilarity: config.minRelevanceSimilarity ?? 0.55,
      modelContextWindow: config.modelContextWindow,
    };
  }

  async optimize(
    currentMessages: ChatMessage[],
    conversationHistory: ChatMessage[],
    options: {
      userId?: string;
      conversationId?: string;
      newUserMessage?: string;
      model?: string;
      systemPromptTokens?: number;
    } = {}
  ): Promise<OptimizedContext> {
    const contextWindow = options.model
      ? getContextWindow(options.model)
      : this.config.maxTotalTokens;

    const systemBudget = Math.floor(contextWindow * this.config.systemPromptTokenBudget);
    const availableForMessages = contextWindow - (options.systemPromptTokens ?? systemBudget) - 2_000; // reserve for response

    // If everything fits — no optimization needed
    const allMessages = [...conversationHistory, ...currentMessages];
    const totalTokens = allMessages.reduce((s, m) => s + countMessageTokens(m), 0);

    if (totalTokens <= availableForMessages) {
      return {
        messages: allMessages,
        systemMemories: [],
        tokenCount: totalTokens,
        strategy: "full",
        droppedMessages: 0,
        includedHistoricalMessages: conversationHistory.length,
      };
    }

    // ── Recent window — always include last N messages ─────────────────────

    const recentMessages = currentMessages.slice(-this.config.recentWindowSize);
    const recentTokens = recentMessages.reduce((s, m) => s + countMessageTokens(m), 0);
    const remainingBudget = availableForMessages - recentTokens;

    if (remainingBudget <= 500) {
      return {
        messages: recentMessages,
        systemMemories: [],
        tokenCount: recentTokens,
        strategy: "recent_only",
        droppedMessages: allMessages.length - recentMessages.length,
        includedHistoricalMessages: 0,
      };
    }

    // ── Semantic search for relevant historical context ────────────────────

    const query = options.newUserMessage ?? currentMessages[currentMessages.length - 1]?.content ?? "";
    let relevantHistorical: ChatMessage[] = [];

    if (query && conversationHistory.length > 0) {
      // Search stored memories first
      const storedMemories = await pgVectorMemoryStore.search({
        query,
        userId: options.userId,
        conversationId: options.conversationId,
        limit: this.config.semanticWindowSize,
        minSimilarity: this.config.minRelevanceSimilarity,
      });

      // Convert stored memories to chat-like messages for context
      const memoryMessages: ChatMessage[] = storedMemories
        .filter((m) => m.importance >= 0.4)
        .map((m) => ({
          role: "system" as const,
          content: `[Memory: ${m.memoryType}] ${m.content}`,
          tokenCount: estimateTokens(m.content) + 20,
        }));

      // Keyword-based relevance scoring for in-conversation history
      const scored: ScoredMessage[] = conversationHistory
        .filter((m) => m.role === "user") // prioritize user messages
        .map((m, i) => ({
          message: m,
          relevance: keywordSimilarity(query, m.content),
          index: i,
        }))
        .filter((s) => s.relevance > 0.15)
        .sort((a, b) => b.relevance - a.relevance);

      const selectedScored = applyMMR(scored, [], 0.7, this.config.semanticWindowSize);
      const selectedMessages = selectedScored.map((s) => s.message);

      // Combine memory messages and historical messages
      const combined = [...memoryMessages, ...selectedMessages];
      let usedTokens = 0;
      const fitting: ChatMessage[] = [];

      for (const msg of combined) {
        const t = countMessageTokens(msg);
        if (usedTokens + t <= remainingBudget) {
          fitting.push(msg);
          usedTokens += t;
        } else break;
      }

      relevantHistorical = fitting;
    }

    // ── Retrieve system memories for the response ─────────────────────────

    const systemMemories: string[] = [];
    if (options.userId && query) {
      const userMems = await pgVectorMemoryStore.search({
        query,
        userId: options.userId,
        memoryType: "preference",
        limit: 3,
        minSimilarity: 0.5,
      });
      for (const mem of userMems) {
        systemMemories.push(mem.content);
      }
    }

    // ── Combine final message list ─────────────────────────────────────────

    const finalMessages = [...relevantHistorical, ...recentMessages];
    const finalTokens = finalMessages.reduce((s, m) => s + countMessageTokens(m), 0);

    logger.debug(
      `Context optimizer: ${allMessages.length} total → ${finalMessages.length} selected ` +
      `(${recentMessages.length} recent + ${relevantHistorical.length} historical), ${finalTokens} tokens`
    );

    return {
      messages: finalMessages,
      systemMemories,
      tokenCount: finalTokens,
      strategy: "semantic_blend",
      droppedMessages: allMessages.length - finalMessages.length,
      includedHistoricalMessages: relevantHistorical.length,
    };
  }

  reconfigure(config: Partial<ContextOptimizerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  estimateFit(messages: ChatMessage[], model?: string): { fits: boolean; tokenCount: number; overflowBy: number } {
    const contextWindow = getContextWindow(model);
    const tokenCount = messages.reduce((s, m) => s + countMessageTokens(m), 0);
    const fits = tokenCount <= contextWindow * 0.85; // 85% to leave room for response
    return { fits, tokenCount, overflowBy: Math.max(0, tokenCount - contextWindow) };
  }
}

export const dynamicContextOptimizer = new DynamicContextOptimizer();
