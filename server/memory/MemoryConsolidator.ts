/**
 * MemoryConsolidator — end-of-conversation extraction, deduplication, and storage.
 * Extracts facts, decisions, action items, and preferences; resolves conflicts.
 */

import { llmGateway } from "../lib/llmGateway"
import { Logger } from "../lib/logger"
import { pgVectorMemoryStore, type MemoryEntry } from "./PgVectorMemoryStore"

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ConsolidationInput {
  conversationId: string
  userId: string
  messages: Array<{ role: "user" | "assistant"; content: string; timestamp?: Date }>
  existingMemories?: MemoryEntry[]
}

export interface ExtractedFact {
  content: string
  confidence: number
  type: "entity" | "relationship" | "event" | "property"
  importance: number
  conflictsWithId?: string
}

export interface ExtractedDecision {
  content: string
  confidence: number
  rationale?: string
  importance: number
}

export interface ActionItem {
  description: string
  dueDate?: Date
  priority: "low" | "medium" | "high"
  status: "pending"
}

export interface PreferenceSignal {
  key: string
  value: string
  confidence: number
  source: "explicit" | "inferred"
}

export interface ConsolidationResult {
  facts: ExtractedFact[]
  decisions: ExtractedDecision[]
  actionItems: ActionItem[]
  preferences: PreferenceSignal[]
  consolidated: MemoryEntry[]
  merged: number
  deleted: number
}

// ─── Consolidator ──────────────────────────────────────────────────────────────

class MemoryConsolidator {
  private readonly store = pgVectorMemoryStore

  // ── consolidate ───────────────────────────────────────────────────────────────

  async consolidate(input: ConsolidationInput): Promise<ConsolidationResult> {
    const { conversationId, userId, messages, existingMemories } = input
    Logger.info("[MemoryConsolidator] starting consolidation", {
      userId,
      conversationId,
      messageCount: messages.length,
    })

    // 1. Extract structured data from conversation
    let extracted: Awaited<ReturnType<typeof this.extractFromMessages>>
    try {
      extracted = await this.extractFromMessages(messages)
    } catch (err) {
      Logger.error("[MemoryConsolidator] extraction failed", err)
      return {
        facts: [],
        decisions: [],
        actionItems: [],
        preferences: [],
        consolidated: [],
        merged: 0,
        deleted: 0,
      }
    }

    // 2. Load existing memories if not provided
    const existing =
      existingMemories ??
      (await this.store.getByUser(userId, { limit: 200 }))

    const created: MemoryEntry[] = []
    let merged = 0
    let deleted = 0

    // 3. Process facts
    for (const fact of extracted.facts) {
      const scored = await this.scoreImportance(fact.content, messages.map((m) => m.content).join(" "))
      fact.importance = scored

      const conflict = await this.detectConflicts(fact, existing)
      if (conflict) {
        const resolution = await this.resolveConflict(fact, conflict)
        if (resolution === "keep_new") {
          await this.store.delete(conflict.id)
          deleted++
          const stored = await this.storeMemory(fact, userId, conversationId)
          created.push(stored)
        } else if (resolution === "merge") {
          const mergedContent = `${conflict.content} | Updated: ${fact.content}`
          await this.store.updateImportance(conflict.id, Math.max(conflict.importance, fact.importance))
          merged++
        }
        // keep_old: do nothing
      } else {
        const stored = await this.storeMemory(fact, userId, conversationId)
        created.push(stored)
      }
    }

    // 4. Process decisions
    for (const decision of extracted.decisions) {
      const scored = await this.scoreImportance(decision.content, "")
      decision.importance = scored
      const entry = await this.store.store({
        userId,
        conversationId,
        content: decision.content,
        type: "fact",
        embedding: this.store.generateEmbedding(decision.content),
        importance: decision.importance,
        metadata: {
          source: conversationId,
          tags: ["decision"],
          createdAt: new Date(),
          lastAccessedAt: new Date(),
          accessCount: 0,
        },
      })
      created.push(entry)
    }

    // 5. Process action items (stored as notes)
    for (const action of extracted.actions) {
      const content = `ACTION: ${action.description}${action.dueDate ? ` (due: ${action.dueDate.toDateString()})` : ""} [priority: ${action.priority}]`
      const entry = await this.store.store({
        userId,
        conversationId,
        content,
        type: "note",
        embedding: this.store.generateEmbedding(content),
        importance: action.priority === "high" ? 0.8 : action.priority === "medium" ? 0.6 : 0.4,
        metadata: {
          source: conversationId,
          tags: ["action-item", action.priority],
          createdAt: new Date(),
          lastAccessedAt: new Date(),
          accessCount: 0,
        },
      })
      created.push(entry)
    }

    // 6. Process preferences (stored as preference type)
    for (const pref of extracted.preferences) {
      const existing = await this.store.searchByText(pref.key, {
        userId,
        types: ["preference"],
        threshold: 0.85,
        limit: 1,
      })
      if (existing.length > 0 && pref.source === "explicit") {
        await this.store.updateImportance(existing[0].id, 0.9)
        merged++
      } else {
        const content = `User preference: ${pref.key} = ${pref.value}`
        const entry = await this.store.store({
          userId,
          conversationId,
          content,
          type: "preference",
          embedding: this.store.generateEmbedding(content),
          importance: pref.source === "explicit" ? 0.9 : 0.5,
          metadata: {
            source: pref.source,
            tags: ["preference"],
            createdAt: new Date(),
            lastAccessedAt: new Date(),
            accessCount: 0,
          },
        })
        created.push(entry)
      }
    }

    Logger.info("[MemoryConsolidator] consolidation complete", {
      userId,
      created: created.length,
      merged,
      deleted,
    })

    return {
      facts: extracted.facts,
      decisions: extracted.decisions,
      actionItems: extracted.actions,
      preferences: extracted.preferences,
      consolidated: created,
      merged,
      deleted,
    }
  }

  // ── extractFromMessages ───────────────────────────────────────────────────────

  async extractFromMessages(
    messages: ConsolidationInput["messages"]
  ): Promise<{
    facts: ExtractedFact[]
    decisions: ExtractedDecision[]
    actions: ActionItem[]
    preferences: PreferenceSignal[]
  }> {
    const formatted = this.formatMessagesForLLM(messages)

    const prompt = `You are a memory extraction system. Analyze this conversation and extract structured information.

Return ONLY valid JSON with this exact structure:
{
  "facts": [
    { "content": "string", "confidence": 0.0-1.0, "type": "entity|relationship|event|property", "importance": 0.0-1.0 }
  ],
  "decisions": [
    { "content": "string", "confidence": 0.0-1.0, "rationale": "string", "importance": 0.0-1.0 }
  ],
  "actions": [
    { "description": "string", "priority": "low|medium|high", "dueDateHint": "string or null" }
  ],
  "preferences": [
    { "key": "string", "value": "string", "confidence": 0.0-1.0, "source": "explicit|inferred" }
  ]
}

Rules:
- facts: concrete, verifiable statements about entities, relationships, or properties
- decisions: choices made during the conversation
- actions: tasks the user needs to do or asked to track
- preferences: user style/behavior preferences (explicit: stated directly; inferred: implied)
- Only include items with confidence >= 0.5
- Keep content concise (< 200 chars each)

CONVERSATION:
${formatted}`

    const response = await llmGateway.chat(
      [{ role: "user", content: prompt }],
      { maxTokens: 1200, temperature: 0 }
    )

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error("No JSON in LLM response")
      const data = JSON.parse(jsonMatch[0]) as {
        facts?: Array<{ content: string; confidence: number; type: string; importance: number }>
        decisions?: Array<{ content: string; confidence: number; rationale?: string; importance: number }>
        actions?: Array<{ description: string; priority: string; dueDateHint?: string | null }>
        preferences?: Array<{ key: string; value: string; confidence: number; source: string }>
      }

      const facts: ExtractedFact[] = (data.facts ?? [])
        .filter((f) => f.confidence >= 0.5)
        .map((f) => ({
          content: f.content,
          confidence: f.confidence,
          type: (f.type as ExtractedFact["type"]) ?? "property",
          importance: f.importance ?? 0.5,
        }))

      const decisions: ExtractedDecision[] = (data.decisions ?? [])
        .filter((d) => d.confidence >= 0.5)
        .map((d) => ({
          content: d.content,
          confidence: d.confidence,
          rationale: d.rationale,
          importance: d.importance ?? 0.6,
        }))

      const actions: ActionItem[] = (data.actions ?? []).map((a) => ({
        description: a.description,
        priority: (a.priority as ActionItem["priority"]) ?? "medium",
        status: "pending" as const,
        dueDate: a.dueDateHint ? this.parseDateHint(a.dueDateHint) : undefined,
      }))

      const preferences: PreferenceSignal[] = (data.preferences ?? [])
        .filter((p) => p.confidence >= 0.5)
        .map((p) => ({
          key: p.key,
          value: p.value,
          confidence: p.confidence,
          source: (p.source as PreferenceSignal["source"]) ?? "inferred",
        }))

      return { facts, decisions, actions, preferences }
    } catch (err) {
      Logger.warn("[MemoryConsolidator] failed to parse LLM extraction", err)
      return { facts: [], decisions: [], actions: [], preferences: [] }
    }
  }

  // ── scoreImportance ───────────────────────────────────────────────────────────

  async scoreImportance(fact: string, context: string): Promise<number> {
    let score = 0.4 // base

    // Length as proxy for specificity
    if (fact.length > 80) score += 0.05

    // Frequency in context
    const words = fact.toLowerCase().split(/\s+/).filter((w) => w.length > 4)
    for (const word of words) {
      if (context.toLowerCase().includes(word)) score += 0.02
    }

    // Named entity heuristic (capitalized words)
    const namedEntities = (fact.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) ?? []).length
    score += namedEntities * 0.03

    // Numeric data present
    if (/\d/.test(fact)) score += 0.05

    // Explicit markers
    if (/\b(important|critical|must|always|never|remember|key)\b/i.test(fact)) score += 0.15
    if (/\b(maybe|perhaps|might|could)\b/i.test(fact)) score -= 0.1

    return Math.max(0.1, Math.min(1.0, score))
  }

  // ── detectConflicts ───────────────────────────────────────────────────────────

  async detectConflicts(
    newFact: ExtractedFact,
    existing: MemoryEntry[]
  ): Promise<MemoryEntry | null> {
    if (existing.length === 0) return null

    const similar = await this.store.searchByText(newFact.content, {
      threshold: 0.88,
      limit: 3,
    })

    for (const candidate of similar) {
      if (!existing.find((e) => e.id === candidate.id)) continue
      // Check if they say contradictory things using simple heuristics
      if (this.areContradictory(newFact.content, candidate.content)) {
        return candidate
      }
    }
    return null
  }

  private areContradictory(a: string, b: string): boolean {
    // Simple heuristic: both mention the same subject but one contains negation
    const negationPattern = /\b(not|never|no|isn't|aren't|wasn't|weren't|don't|doesn't|didn't)\b/i
    const aHasNeg = negationPattern.test(a)
    const bHasNeg = negationPattern.test(b)
    if (aHasNeg !== bHasNeg) {
      // One has negation, check word overlap
      const aWords = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 4))
      const bWords = b.toLowerCase().split(/\W+/).filter((w) => w.length > 4)
      const overlap = bWords.filter((w) => aWords.has(w)).length
      return overlap >= 2
    }
    return false
  }

  // ── resolveConflict ───────────────────────────────────────────────────────────

  async resolveConflict(
    newFact: ExtractedFact,
    existing: MemoryEntry
  ): Promise<"keep_new" | "keep_old" | "merge"> {
    // Higher confidence + less accessed → replace
    if (newFact.confidence > 0.8 && existing.metadata.accessCount < 3) {
      return "keep_new"
    }
    // Well-accessed existing memory → merge
    if (existing.metadata.accessCount >= 5) {
      return "merge"
    }
    // Newer fact with higher importance → replace
    if (newFact.importance > existing.importance * 1.2) {
      return "keep_new"
    }
    // Default: keep old, preserve knowledge
    return "keep_old"
  }

  // ── runBatchConsolidation ─────────────────────────────────────────────────────

  async runBatchConsolidation(
    userId: string,
    dryRun: boolean = false
  ): Promise<ConsolidationResult> {
    Logger.info("[MemoryConsolidator] batch consolidation", { userId, dryRun })

    // Fetch low-importance memories to consolidate
    const entries = await this.store.getByUser(userId, { limit: 500 })
    const lowImportance = entries.filter((e) => e.importance < 0.3 && e.type === "fact")

    if (lowImportance.length < 5) {
      return {
        facts: [],
        decisions: [],
        actionItems: [],
        preferences: [],
        consolidated: [],
        merged: 0,
        deleted: 0,
      }
    }

    if (dryRun) {
      Logger.info("[MemoryConsolidator] dry run — would consolidate", { count: lowImportance.length })
      return {
        facts: [],
        decisions: [],
        actionItems: [],
        preferences: [],
        consolidated: [],
        merged: 0,
        deleted: lowImportance.length,
      }
    }

    // Deduplicate by semantic similarity
    const toDelete: string[] = []
    const processed = new Set<string>()

    for (let i = 0; i < lowImportance.length; i++) {
      if (processed.has(lowImportance[i].id)) continue
      const similar = await this.store.searchByText(lowImportance[i].content, {
        userId,
        threshold: 0.92,
        limit: 5,
      })
      const duplicates = similar.filter(
        (s) => s.id !== lowImportance[i].id && !processed.has(s.id)
      )
      for (const dup of duplicates) {
        toDelete.push(dup.id)
        processed.add(dup.id)
      }
      processed.add(lowImportance[i].id)
    }

    for (const id of toDelete) {
      await this.store.delete(id)
    }

    Logger.info("[MemoryConsolidator] batch complete", { deleted: toDelete.length })
    return {
      facts: [],
      decisions: [],
      actionItems: [],
      preferences: [],
      consolidated: [],
      merged: 0,
      deleted: toDelete.length,
    }
  }

  // ── private helpers ───────────────────────────────────────────────────────────

  private async storeMemory(
    fact: ExtractedFact,
    userId: string,
    conversationId: string
  ): Promise<MemoryEntry> {
    return this.store.store({
      userId,
      conversationId,
      content: fact.content,
      type: fact.type === "entity" ? "entity" : "fact",
      embedding: this.store.generateEmbedding(fact.content),
      importance: fact.importance,
      metadata: {
        source: conversationId,
        tags: [fact.type],
        createdAt: new Date(),
        lastAccessedAt: new Date(),
        accessCount: 0,
      },
    })
  }

  private formatMessagesForLLM(messages: ConsolidationInput["messages"]): string {
    return messages
      .map((m) => `[${m.role.toUpperCase()}]: ${m.content}`)
      .join("\n---\n")
  }

  private parseDateHint(hint: string): Date | undefined {
    if (!hint) return undefined
    const parsed = new Date(hint)
    if (!isNaN(parsed.getTime())) return parsed
    // Relative hints
    const now = new Date()
    if (/tomorrow/i.test(hint)) {
      now.setDate(now.getDate() + 1)
      return now
    }
    if (/next week/i.test(hint)) {
      now.setDate(now.getDate() + 7)
      return now
    }
    if (/next month/i.test(hint)) {
      now.setMonth(now.getMonth() + 1)
      return now
    }
    return undefined
  }
}

export const memoryConsolidator = new MemoryConsolidator()
