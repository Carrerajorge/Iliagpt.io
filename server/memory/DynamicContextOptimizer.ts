/**
 * DynamicContextOptimizer — relevance-based context selection.
 * Blends recency + semantic similarity + memory importance into an optimal context window.
 */

import { llmGateway } from "../lib/llmGateway"
import { Logger } from "../lib/logger"
import { pgVectorMemoryStore, type MemoryEntry } from "./PgVectorMemoryStore"

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ContextCandidate {
  content: string
  role: "user" | "assistant" | "system"
  timestamp: Date
  relevanceScore: number
  type: "recent" | "semantic" | "memory" | "system_prompt"
}

export interface OptimizedContext {
  messages: Array<{ role: string; content: string }>
  tokenCount: number
  memoriesIncluded: number
  historicalMessagesIncluded: number
  compressionApplied: boolean
}

export interface ContextOptions {
  maxTokens?: number
  recentMessageCount?: number
  semanticSearchLimit?: number
  memoryTypes?: string[]
  includeSystemPrompt?: boolean
  userId?: string
  conversationId?: string
}

// ─── Optimizer ─────────────────────────────────────────────────────────────────

class DynamicContextOptimizer {
  private readonly store = pgVectorMemoryStore

  // ── optimize ──────────────────────────────────────────────────────────────────

  async optimize(
    currentQuery: string,
    recentMessages: Array<{ role: string; content: string; timestamp?: Date }>,
    options: ContextOptions = {}
  ): Promise<OptimizedContext> {
    const {
      maxTokens = 8000,
      recentMessageCount = 6,
      semanticSearchLimit = 10,
      memoryTypes,
      includeSystemPrompt = true,
      userId,
      conversationId,
    } = options

    Logger.debug("[DynamicContextOptimizer] optimizing context", {
      queryLen: currentQuery.length,
      recentCount: recentMessages.length,
    })

    // 1. Generate query embedding once
    const queryEmbedding = this.store.generateEmbedding(currentQuery)

    // 2. Always include last N messages (recency window)
    const recentWindow = recentMessages.slice(-recentMessageCount)
    const recentCandidates: ContextCandidate[] = recentWindow.map((m, i) => ({
      content: m.content,
      role: m.role as ContextCandidate["role"],
      timestamp: m.timestamp ?? new Date(Date.now() - (recentWindow.length - i) * 60_000),
      relevanceScore: 1.0 - i * 0.02, // very slight decay for recency order
      type: "recent",
    }))

    const candidates: ContextCandidate[] = [...recentCandidates]
    let memoriesIncluded = 0
    let historicalMessagesIncluded = 0

    // 3. Retrieve relevant memories
    if (userId) {
      const memories = await this.selectMemories(queryEmbedding, {
        userId,
        conversationId,
        maxTokens,
        semanticSearchLimit,
        memoryTypes,
      })
      for (const mem of memories) {
        candidates.push({
          content: `[Memory] ${mem.content}`,
          role: "system",
          timestamp: mem.metadata.createdAt,
          relevanceScore: 0, // will be rescored below
          type: "memory",
        })
        memoriesIncluded++
      }
    }

    // 4. Retrieve relevant historical messages (older than recent window)
    if (conversationId && recentMessages.length > recentMessageCount) {
      const historical = await this.selectHistoricalMessages(
        queryEmbedding,
        conversationId,
        recentMessageCount
      )
      for (const h of historical) {
        candidates.push({
          content: h.content,
          role: h.role as ContextCandidate["role"],
          timestamp: h.timestamp,
          relevanceScore: h.score,
          type: "semantic",
        })
        historicalMessagesIncluded++
      }
    }

    // 5. Score all non-recent candidates
    for (const c of candidates) {
      if (c.type !== "recent") {
        c.relevanceScore = this.scoreCandidate(c, queryEmbedding)
      }
    }

    // 6. Fit within token budget
    let finalCandidates = candidates
    const totalTokens = candidates.reduce(
      (sum, c) => sum + this.estimateTokenCount(c.content),
      0
    )
    let compressionApplied = false

    if (totalTokens > maxTokens) {
      // Sort non-recent by relevance descending, keep recents always
      const recent = finalCandidates.filter((c) => c.type === "recent")
      const rest = finalCandidates
        .filter((c) => c.type !== "recent")
        .sort((a, b) => b.relevanceScore - a.relevanceScore)

      let budget = maxTokens - recent.reduce((s, c) => s + this.estimateTokenCount(c.content), 0)
      const selected: ContextCandidate[] = []
      for (const c of rest) {
        const t = this.estimateTokenCount(c.content)
        if (budget - t >= 0) {
          selected.push(c)
          budget -= t
        }
      }

      finalCandidates = [...recent, ...selected]

      // If still over budget, try compression
      const afterBudget = finalCandidates.reduce(
        (s, c) => s + this.estimateTokenCount(c.content),
        0
      )
      if (afterBudget > maxTokens) {
        finalCandidates = await this.compressIfNeeded(finalCandidates, maxTokens)
        compressionApplied = true
      }
    }

    // 7. Sort chronologically
    const sorted = this.chronologicalSort(finalCandidates)

    // 8. Build system prompt additions for memories
    const memoryBlock = sorted.filter((c) => c.type === "memory")
    let systemContent = ""
    if (includeSystemPrompt && memoryBlock.length > 0) {
      systemContent = this.buildSystemPromptAdditions(
        memoryBlock.map((c) => ({
          content: c.content.replace("[Memory] ", ""),
          type: "fact",
        } as MemoryEntry))
      )
    }

    // Assemble final messages array
    const messages: Array<{ role: string; content: string }> = []
    if (systemContent) {
      messages.push({ role: "system", content: systemContent })
    }
    for (const c of sorted.filter((c) => c.type !== "memory" && c.type !== "system_prompt")) {
      messages.push({ role: c.role, content: c.content })
    }

    const tokenCount = messages.reduce((s, m) => s + this.estimateTokenCount(m.content), 0)

    Logger.debug("[DynamicContextOptimizer] context built", {
      messageCount: messages.length,
      tokenCount,
      memoriesIncluded,
      historicalMessagesIncluded,
      compressionApplied,
    })

    return {
      messages,
      tokenCount,
      memoriesIncluded,
      historicalMessagesIncluded,
      compressionApplied,
    }
  }

  // ── selectMemories ────────────────────────────────────────────────────────────

  async selectMemories(
    queryEmbedding: number[],
    options: ContextOptions
  ): Promise<MemoryEntry[]> {
    const {
      userId,
      conversationId,
      semanticSearchLimit = 10,
      memoryTypes,
    } = options

    try {
      const results = await this.store.search(queryEmbedding, {
        userId,
        conversationId,
        limit: semanticSearchLimit,
        threshold: 0.65,
        types: memoryTypes as MemoryEntry["type"][] | undefined,
        minImportance: 0.2,
      })
      return results
    } catch (err) {
      Logger.warn("[DynamicContextOptimizer] memory retrieval failed", err)
      return []
    }
  }

  // ── selectHistoricalMessages ──────────────────────────────────────────────────

  async selectHistoricalMessages(
    queryEmbedding: number[],
    conversationId: string,
    excludeRecentCount: number
  ): Promise<Array<{ role: string; content: string; timestamp: Date; score: number }>> {
    try {
      const historicalMems = await this.store.search(queryEmbedding, {
        conversationId,
        threshold: 0.7,
        limit: 8,
        types: ["conversation"],
      })

      return historicalMems.map((m) => ({
        role: (m.metadata.tags ?? []).includes("assistant") ? "assistant" : "user",
        content: m.content,
        timestamp: m.metadata.createdAt,
        score: m.similarity,
      }))
    } catch (err) {
      Logger.warn("[DynamicContextOptimizer] historical message retrieval failed", err)
      return []
    }
  }

  // ── compressIfNeeded ──────────────────────────────────────────────────────────

  async compressIfNeeded(
    messages: ContextCandidate[],
    maxTokens: number
  ): Promise<ContextCandidate[]> {
    const current = messages.reduce((s, m) => s + this.estimateTokenCount(m.content), 0)
    if (current <= maxTokens) return messages

    Logger.info("[DynamicContextOptimizer] compressing context", { current, maxTokens })

    // Identify low-relevance non-recent candidates to summarize
    const recent = messages.filter((m) => m.type === "recent")
    const compressible = messages
      .filter((m) => m.type !== "recent" && m.type !== "system_prompt")
      .sort((a, b) => a.relevanceScore - b.relevanceScore)
      .slice(0, Math.ceil(messages.length * 0.4))

    if (compressible.length === 0) return messages

    const toCompress = compressible.map((m) => m.content).join("\n\n")

    try {
      const response = await llmGateway.chat(
        [
          {
            role: "user",
            content: `Summarize the following context into 2-3 key bullet points, preserving critical facts:\n\n${toCompress}`,
          },
        ],
        { maxTokens: 200, temperature: 0 }
      )

      const summaryCandidate: ContextCandidate = {
        content: `[Summarized context]\n${response.content}`,
        role: "system",
        timestamp: new Date(),
        relevanceScore: 0.5,
        type: "system_prompt",
      }

      const compressibleIds = new Set(compressible.map((m) => m.content))
      const kept = messages.filter((m) => !compressibleIds.has(m.content))
      return [...kept, summaryCandidate]
    } catch (err) {
      Logger.warn("[DynamicContextOptimizer] compression failed", err)
      // Fall back: remove lowest-scoring entries
      const excess = current - maxTokens
      let removed = 0
      const result: ContextCandidate[] = []
      for (const m of [...messages].sort((a, b) => a.relevanceScore - b.relevanceScore)) {
        if (removed < excess && m.type !== "recent") {
          removed += this.estimateTokenCount(m.content)
          continue
        }
        result.push(m)
      }
      return result
    }
  }

  // ── estimateTokenCount ────────────────────────────────────────────────────────

  estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4)
  }

  // ── buildSystemPromptAdditions ────────────────────────────────────────────────

  buildSystemPromptAdditions(memories: MemoryEntry[], userProfile?: unknown): string {
    if (memories.length === 0) return ""

    const lines: string[] = ["## What I know about you:"]
    for (const mem of memories.slice(0, 15)) {
      lines.push(`- ${mem.content}`)
    }

    if (userProfile) {
      lines.push("\n## Your preferences:")
      const profile = userProfile as Record<string, unknown>
      if (profile.communicationStyle) {
        const style = profile.communicationStyle as Record<string, unknown>
        lines.push(`- Preferred length: ${style.preferredLength}`)
        lines.push(`- Technical level: ${style.technicalLevel}/5`)
      }
    }

    return lines.join("\n")
  }

  // ── scoreCandidate ────────────────────────────────────────────────────────────

  private scoreCandidate(candidate: ContextCandidate, queryEmbedding: number[]): number {
    const now = Date.now()
    const ageMs = now - candidate.timestamp.getTime()
    const ageDays = ageMs / (1000 * 60 * 60 * 24)

    // Recency component (exponential decay, half-life 7 days)
    const recencyScore = Math.exp(-0.1 * ageDays)

    // Memory type gets a base boost
    const typeBoost = candidate.type === "memory" ? 0.2 : 0

    // Semantic score: approximate using simple text overlap with query embedding
    // (true cosine would require keeping query text — we use relevanceScore from search)
    const semanticScore = candidate.relevanceScore > 0 ? candidate.relevanceScore : 0.3

    return Math.min(1, recencyScore * 0.3 + semanticScore * 0.5 + typeBoost + 0.2)
  }

  // ── chronologicalSort ─────────────────────────────────────────────────────────

  private chronologicalSort(candidates: ContextCandidate[]): ContextCandidate[] {
    return [...candidates].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    )
  }
}

export const dynamicContextOptimizer = new DynamicContextOptimizer()
