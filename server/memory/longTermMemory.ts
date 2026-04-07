/**
 * Long-Term Memory Service
 *
 * Extracts, stores, and retrieves user-specific facts/preferences/objectives
 * from conversations using LLM-based analysis and vector similarity search.
 */

import { db } from "../db";
import { userMemories } from "@shared/schema";
import { eq, and, desc, sql, count } from "drizzle-orm";
import { generateEmbeddingsBatch } from "../embeddingService";
import { llmGateway } from "../lib/llmGateway";
import { createLogger } from "../utils/logger";
import crypto from "crypto";

const log = createLogger("long-term-memory");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryFact {
  id: string;
  userId: string;
  fact: string;
  category: "preference" | "personal" | "work" | "knowledge" | "instruction";
  importance: number; // 0-1, higher = more referenced
  mentionCount: number;
  embedding?: number[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ExtractedFact {
  fact: string;
  category: MemoryFact["category"];
  confidence: number;
}

export interface ConversationMessage {
  role: string;
  content: string;
}

export interface RecallOptions {
  limit?: number;
  category?: string;
}

export interface ListMemoriesOptions {
  category?: string;
  limit?: number;
  offset?: number;
}

// Re-export schema type for consumers that need the raw DB shape
export type UserMemory = typeof userMemories.$inferSelect;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TENANT_ID = "default";
const DEFAULT_RECALL_LIMIT = 5;
const DEFAULT_LIST_LIMIT = 50;
const RECENCY_HALF_LIFE_DAYS = 30;
const SIMILARITY_DEDUP_THRESHOLD = 0.85;

const EXTRACTION_SYSTEM_PROMPT = `Extract key facts about the user from this conversation. Return JSON array:
[{"fact": "...", "category": "preference|personal|work|knowledge|instruction", "confidence": 0.0-1.0}]
Only extract facts that would be useful in future conversations.
Ignore greetings, acknowledgments, and transient details.

Categories:
- preference: user likes/dislikes, style choices, tool preferences
- personal: name, biographical info, personal details
- work: job title, company, projects, professional details
- knowledge: technical expertise, domain knowledge
- instruction: explicit requests about how the assistant should behave

Rules:
- Extract only facts clearly stated or strongly implied by the user (not the assistant).
- Maximum 10 facts per extraction.
- Each fact must be self-contained and understandable without context.
- Return ONLY the JSON array, no other text.`;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class LongTermMemoryService {
  /**
   * Analyze conversation messages and extract key facts about the user.
   */
  async extractFacts(
    messages: Array<{ role: string; content: string }>,
    userId: string,
  ): Promise<ExtractedFact[]> {
    if (!messages.length) return [];

    // Build a condensed transcript for the LLM
    const transcript = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n")
      .slice(0, 6000); // keep within token budget

    try {
      const response = await llmGateway.chat(
        [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          { role: "user", content: transcript },
        ],
        {
          temperature: 0.1,
          maxTokens: 1500,
          requestId: `mem-extract-${userId}-${Date.now()}`,
        },
      );

      const facts = this.parseExtractedFacts(response.content);

      // Filter out low-confidence facts
      return facts.filter((f) => f.confidence > 0.6);
    } catch (err) {
      log.error("Failed to extract facts", { userId, error: err });
      return [];
    }
  }

  /**
   * Store extracted facts with embeddings into the database.
   * For each fact, checks if a similar fact exists (cosine similarity > 0.85).
   * If exists: increment mentionCount, update importance.
   * If new: insert with mentionCount=1, importance=0.1.
   */
  async storeFacts(
    userId: string,
    facts: ExtractedFact[],
    conversationId?: string,
  ): Promise<void> {
    if (facts.length === 0) return;

    const factTexts = facts.map((f) => f.fact);
    const embeddings = await generateEmbeddingsBatch(factTexts);

    for (let i = 0; i < facts.length; i++) {
      const fact = facts[i];
      const embedding = embeddings[i];
      const contentHash = this.computeContentHash(fact.fact);

      try {
        // Check if similar fact already exists using cosine similarity
        const embeddingLiteral = `[${embedding.join(",")}]`;
        const similarityExpr = sql<number>`1 - (${userMemories.embedding} <=> ${embeddingLiteral}::vector)`;

        const existing = await db
          .select({
            id: userMemories.id,
            accessCount: userMemories.accessCount,
            similarity: similarityExpr,
          })
          .from(userMemories)
          .where(
            and(
              eq(userMemories.userId, userId),
              eq(userMemories.isActive, true),
            ),
          )
          .orderBy(desc(similarityExpr))
          .limit(1);

        const topMatch = existing[0];
        const similarity = topMatch ? Number(topMatch.similarity) || 0 : 0;

        if (topMatch && similarity > SIMILARITY_DEDUP_THRESHOLD) {
          // Similar fact exists: increment access count, update importance
          const newCount = (topMatch.accessCount ?? 0) + 1;
          const newImportance = Math.min(1, newCount / 10);

          await db
            .update(userMemories)
            .set({
              accessCount: newCount,
              salienceScore: newImportance,
              updatedAt: sql`now()`,
            })
            .where(eq(userMemories.id, topMatch.id));

          log.info("Updated existing memory", {
            userId,
            memoryId: topMatch.id,
            similarity,
            newCount,
          });
        } else {
          // New fact: insert
          await db
            .insert(userMemories)
            .values({
              tenantId: DEFAULT_TENANT_ID,
              userId,
              conversationId: conversationId ?? null,
              fact: fact.fact,
              category: fact.category,
              confidence: fact.confidence,
              evidence: "",
              scope: "global",
              contentHash,
              embedding,
              salienceScore: 0.1,
              recencyScore: 1.0,
              accessCount: 1,
              isActive: true,
              tags: [],
              metadata: {},
            })
            .onConflictDoNothing({
              target: [userMemories.userId, userMemories.contentHash],
            });

          log.info("Stored new memory", { userId, fact: fact.fact });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("unique") && !message.includes("duplicate")) {
          log.error("Failed to store fact", { userId, fact: fact.fact, error: message });
        }
      }
    }
  }

  /**
   * Recall memories relevant to a query using vector similarity search.
   * Results are ordered by (similarity * 0.6 + importance * 0.4).
   */
  async recallMemories(
    userId: string,
    query: string,
    limit: number = DEFAULT_RECALL_LIMIT,
  ): Promise<MemoryFact[]> {
    const [queryEmbedding] = await generateEmbeddingsBatch([query]);

    const embeddingLiteral = `[${queryEmbedding.join(",")}]`;
    const similarityExpr = sql<number>`1 - (${userMemories.embedding} <=> ${embeddingLiteral}::vector)`;

    const results = await db
      .select({
        id: userMemories.id,
        userId: userMemories.userId,
        fact: userMemories.fact,
        category: userMemories.category,
        salienceScore: userMemories.salienceScore,
        accessCount: userMemories.accessCount,
        createdAt: userMemories.createdAt,
        updatedAt: userMemories.updatedAt,
        similarity: similarityExpr,
      })
      .from(userMemories)
      .where(
        and(
          eq(userMemories.userId, userId),
          eq(userMemories.isActive, true),
        ),
      )
      .orderBy(desc(similarityExpr))
      .limit(limit * 3); // fetch extra for scoring

    // Compute combined score: similarity * 0.6 + importance * 0.4
    const scored = results.map((r) => {
      const similarity = Number(r.similarity) || 0;
      const importance = r.salienceScore ?? 0.1;
      const combinedScore = similarity * 0.6 + importance * 0.4;
      return { ...r, combinedScore, importance };
    });

    scored.sort((a, b) => b.combinedScore - a.combinedScore);
    const top = scored.slice(0, limit);

    // Update access counts for returned memories
    if (top.length > 0) {
      const ids = top.map((m) => m.id);
      await db
        .update(userMemories)
        .set({
          accessCount: sql`${userMemories.accessCount} + 1`,
          lastAccessedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(userMemories.userId, userId),
            sql`${userMemories.id} = ANY(${ids}::varchar[])`,
          ),
        );
    }

    return top.map((r) => this.toMemoryFact(r));
  }

  /**
   * Build a memory context string from relevant memories for system prompt injection.
   * Returns empty string when no relevant memories are found.
   */
  async buildMemoryContext(
    userId: string,
    userMessage: string,
  ): Promise<string> {
    const memories = await this.recallMemories(userId, userMessage);
    if (memories.length === 0) return "";

    const lines = memories.map(
      (m) => `- [${m.category}] ${m.fact}`,
    );

    return [
      "## Memory about this user",
      ...lines,
    ].join("\n");
  }

  /**
   * Delete a specific memory for a user (soft-delete).
   */
  async deleteMemory(id: string, userId: string): Promise<boolean> {
    const result = await db
      .update(userMemories)
      .set({ isActive: false, updatedAt: sql`now()` })
      .where(
        and(eq(userMemories.id, id), eq(userMemories.userId, userId)),
      )
      .returning({ id: userMemories.id });

    return result.length > 0;
  }

  /**
   * Get all memories for a user, sorted by importance (salience score) descending.
   */
  async getUserMemories(
    userId: string,
    options: ListMemoriesOptions = {},
  ): Promise<MemoryFact[]> {
    const { category, limit = DEFAULT_LIST_LIMIT, offset = 0 } = options;

    const conditions = [
      eq(userMemories.userId, userId),
      eq(userMemories.isActive, true),
    ];
    if (category) {
      conditions.push(eq(userMemories.category, category));
    }
    const whereClause = and(...conditions);

    const memories = await db
      .select()
      .from(userMemories)
      .where(whereClause)
      .orderBy(desc(userMemories.salienceScore))
      .limit(limit)
      .offset(offset);

    return memories.map((m) => this.toMemoryFact(m));
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Parse the LLM response into ExtractedFact[]. Handles edge cases gracefully.
   */
  parseExtractedFacts(content: string): ExtractedFact[] {
    try {
      const arrayMatch = content.match(/\[[\s\S]*\]/);
      if (!arrayMatch) return [];

      const parsed = JSON.parse(arrayMatch[0]);
      if (!Array.isArray(parsed)) return [];

      const validCategories = new Set<MemoryFact["category"]>([
        "preference", "personal", "work", "knowledge", "instruction",
      ]);

      return parsed
        .filter(
          (item: unknown): item is Record<string, unknown> =>
            typeof item === "object" && item !== null && "fact" in item,
        )
        .map((item) => ({
          fact: String(item.fact).slice(0, 500),
          category: validCategories.has(String(item.category) as MemoryFact["category"])
            ? (String(item.category) as MemoryFact["category"])
            : "knowledge",
          confidence: typeof item.confidence === "number"
            ? Math.max(0, Math.min(1, item.confidence))
            : 0.8,
        }))
        .slice(0, 10);
    } catch {
      return [];
    }
  }

  /**
   * Compute SHA-256 content hash for deduplication.
   */
  computeContentHash(fact: string): string {
    const normalized = fact.toLowerCase().trim().replace(/\s+/g, " ");
    return crypto.createHash("sha256").update(normalized).digest("hex");
  }

  /**
   * Compute exponential recency decay factor.
   */
  computeRecencyDecay(createdAtMs: number, nowMs: number): number {
    const ageMs = Math.max(0, nowMs - createdAtMs);
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
  }

  /**
   * Convert a DB row (or scored result) to the MemoryFact interface.
   */
  private toMemoryFact(row: {
    id: string;
    userId: string;
    fact: string;
    category: string;
    salienceScore?: number | null;
    accessCount?: number | null;
    importance?: number;
    createdAt: Date;
    updatedAt: Date;
  }): MemoryFact {
    return {
      id: row.id,
      userId: row.userId,
      fact: row.fact,
      category: row.category as MemoryFact["category"],
      importance: row.importance ?? row.salienceScore ?? 0.1,
      mentionCount: row.accessCount ?? 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

export const longTermMemory = new LongTermMemoryService();

// Convenience re-exports for direct function-style usage
export const extractFacts = longTermMemory.extractFacts.bind(longTermMemory);
export const storeFacts = longTermMemory.storeFacts.bind(longTermMemory);
export const recallMemories = longTermMemory.recallMemories.bind(longTermMemory);
export const buildMemoryContext = longTermMemory.buildMemoryContext.bind(longTermMemory);
export const deleteMemory = longTermMemory.deleteMemory.bind(longTermMemory);
export const getUserMemories = longTermMemory.getUserMemories.bind(longTermMemory);
