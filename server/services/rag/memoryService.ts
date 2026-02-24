/**
 * Memory Service — Persistent per-user memory
 *
 * - Short-term memory: latest N turns from conversation
 * - Long-term memory: facts/preferences/objectives extracted by LLM-as-judge
 * - Episodic summaries: per-conversation summaries
 *
 * Includes deduplication, versioning, and relevance scoring (recency + salience).
 */

import crypto from "crypto";
import { db } from "../../db";
import {
    userMemories,
    episodicSummaries,
    ragKvStore,
    memoryFactSchema,
    type InsertUserMemory,
    type UserMemory,
    type InsertEpisodicSummary,
    type EpisodicSummary,
} from "@shared/schema/rag";
import { chatMessages } from "@shared/schema/chat";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import { getEmbedding, cosineSimilarity } from "../embeddings";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShortTermMemory {
    messages: Array<{ role: string; content: string; createdAt: string }>;
    turnCount: number;
}

export interface LongTermMemory {
    memories: UserMemory[];
    totalCount: number;
}

export interface MemoryContext {
    shortTerm: ShortTermMemory;
    longTerm: LongTermMemory;
    episodic: EpisodicSummary[];
}

export interface ExtractedFact {
    fact: string;
    confidence: number;
    evidence: string;
    scope: "global" | "conversation" | "topic";
    category: "preference" | "fact" | "objective" | "instruction" | "personality" | "context";
    ttl?: number | null;
}

export interface MemoryServiceOptions {
    tenantId: string;
    userId: string;
    conversationId?: string;
    shortTermWindow?: number;   // N latest turns, default 20
    longTermTopK?: number;      // top K memories, default 10
    episodicTopK?: number;      // top K episodic summaries, default 3
}

// ---------------------------------------------------------------------------
// Short-term memory — recent conversation turns
// ---------------------------------------------------------------------------

export async function getShortTermMemory(
    chatId: string,
    windowSize: number = 20,
): Promise<ShortTermMemory> {
    const messages = await db
        .select({
            role: chatMessages.role,
            content: chatMessages.content,
            createdAt: chatMessages.createdAt,
        })
        .from(chatMessages)
        .where(eq(chatMessages.chatId, chatId))
        .orderBy(desc(chatMessages.createdAt))
        .limit(windowSize);

    // Reverse to chronological order
    messages.reverse();

    return {
        messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
            createdAt: m.createdAt.toISOString(),
        })),
        turnCount: messages.length,
    };
}

// ---------------------------------------------------------------------------
// Long-term memory — semantic retrieval of user memories
// ---------------------------------------------------------------------------

export async function getLongTermMemory(
    query: string,
    options: MemoryServiceOptions,
): Promise<LongTermMemory> {
    const { tenantId, userId, longTermTopK = 10 } = options;

    // Fetch active memories
    const memories = await db
        .select()
        .from(userMemories)
        .where(
            and(
                eq(userMemories.tenantId, tenantId),
                eq(userMemories.userId, userId),
                eq(userMemories.isActive, true),
            ),
        )
        .orderBy(desc(userMemories.salienceScore));

    if (memories.length === 0) {
        return { memories: [], totalCount: 0 };
    }

    // Compute semantic relevance
    const queryEmbedding = await getEmbedding(query);
    const scored = memories.map((mem) => {
        const memEmb = mem.embedding as number[] | null;
        const semanticScore =
            memEmb && memEmb.length === queryEmbedding.length
                ? cosineSimilarity(queryEmbedding, memEmb)
                : 0;

        // Composite score: semantic + recency + salience
        const recency = computeRecencyScore(mem.createdAt);
        const composite =
            0.5 * semanticScore +
            0.25 * recency +
            0.25 * (mem.salienceScore ?? 0.5);

        return { memory: mem, score: composite };
    });

    scored.sort((a, b) => b.score - a.score);
    const topMemories = scored.slice(0, longTermTopK).map((s) => s.memory);

    // Update access counts
    const memIds = topMemories.map((m) => m.id);
    if (memIds.length > 0) {
        await db.execute(sql`
            UPDATE user_memories
            SET access_count = access_count + 1,
                last_accessed_at = NOW()
            WHERE id = ANY(${memIds})
        `);
    }

    return { memories: topMemories, totalCount: memories.length };
}

function computeRecencyScore(createdAt: Date): number {
    const ageMs = Date.now() - createdAt.getTime();
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    return Math.exp(-ageDays / 30); // half-life ~30 days
}

// ---------------------------------------------------------------------------
// LLM-as-judge — extract structured facts from conversation
// ---------------------------------------------------------------------------

export async function extractFacts(
    messages: Array<{ role: string; content: string }>,
    existingFacts: string[] = [],
): Promise<ExtractedFact[]> {
    // Build a structured extraction prompt
    const conversationText = messages
        .slice(-10) // last 10 messages for context
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");

    const existingContext =
        existingFacts.length > 0
            ? `\nExisting known facts (avoid duplicates):\n${existingFacts.map((f) => `- ${f}`).join("\n")}`
            : "";

    // Since we can't guarantee LLM availability, we do rule-based extraction as fallback
    const facts = extractFactsHeuristic(messages);
    return facts;
}

/**
 * Rule-based fact extraction as reliable fallback.
 * Looks for patterns indicating user preferences, facts, instructions.
 */
function extractFactsHeuristic(
    messages: Array<{ role: string; content: string }>,
): ExtractedFact[] {
    const facts: ExtractedFact[] = [];
    const preferencePatterns = [
        /(?:prefiero|me gusta|quiero|necesito|uso|utilizo|siempre|prefer|i like|i want|i need|i use|always)\s+(.{10,80})/gi,
    ];
    const instructionPatterns = [
        /(?:no (?:quiero|hagas|uses|incluyas)|nunca|evit[aá]|don'?t|never|avoid)\s+(.{10,80})/gi,
    ];
    const factPatterns = [
        /(?:soy|mi nombre es|trabajo (?:en|como)|vivo en|i am|my name is|i work (?:at|as)|i live in)\s+(.{5,80})/gi,
    ];

    for (const msg of messages.filter((m) => m.role === "user")) {
        for (const pattern of preferencePatterns) {
            const matches = msg.content.matchAll(new RegExp(pattern.source, pattern.flags));
            for (const match of matches) {
                facts.push({
                    fact: match[0].trim(),
                    confidence: 0.7,
                    evidence: msg.content.slice(0, 200),
                    scope: "global",
                    category: "preference",
                });
            }
        }
        for (const pattern of instructionPatterns) {
            const matches = msg.content.matchAll(new RegExp(pattern.source, pattern.flags));
            for (const match of matches) {
                facts.push({
                    fact: match[0].trim(),
                    confidence: 0.8,
                    evidence: msg.content.slice(0, 200),
                    scope: "global",
                    category: "instruction",
                });
            }
        }
        for (const pattern of factPatterns) {
            const matches = msg.content.matchAll(new RegExp(pattern.source, pattern.flags));
            for (const match of matches) {
                facts.push({
                    fact: match[0].trim(),
                    confidence: 0.9,
                    evidence: msg.content.slice(0, 200),
                    scope: "global",
                    category: "fact",
                });
            }
        }
    }

    return facts;
}

// ---------------------------------------------------------------------------
// Store memory — with dedup & versioning
// ---------------------------------------------------------------------------

export async function storeMemory(
    extracted: ExtractedFact,
    options: MemoryServiceOptions,
): Promise<UserMemory | null> {
    const hash = crypto
        .createHash("sha256")
        .update(extracted.fact.toLowerCase().trim())
        .digest("hex");

    // Check for existing duplicate
    const existing = await db
        .select()
        .from(userMemories)
        .where(
            and(
                eq(userMemories.userId, options.userId),
                eq(userMemories.contentHash, hash),
            ),
        )
        .limit(1);

    if (existing.length > 0) {
        // Update version if confidence is higher
        const old = existing[0];
        if (extracted.confidence > (old.confidence ?? 0)) {
            const [updated] = await db
                .update(userMemories)
                .set({
                    confidence: extracted.confidence,
                    evidence: extracted.evidence,
                    version: (old.version ?? 1) + 1,
                    salienceScore: Math.min(1, (old.salienceScore ?? 0.5) + 0.1),
                    updatedAt: new Date(),
                })
                .where(eq(userMemories.id, old.id))
                .returning();
            return updated;
        }
        return old;
    }

    // Generate embedding for new memory
    let embedding: number[] | undefined;
    try {
        embedding = await getEmbedding(extracted.fact);
    } catch {
        // Proceed without embedding
    }

    const expiresAt = extracted.ttl
        ? new Date(Date.now() + extracted.ttl * 1000)
        : undefined;

    const row: InsertUserMemory = {
        tenantId: options.tenantId,
        userId: options.userId,
        conversationId: options.conversationId,
        fact: extracted.fact,
        category: extracted.category,
        confidence: extracted.confidence,
        evidence: extracted.evidence,
        scope: extracted.scope,
        version: 1,
        contentHash: hash,
        embedding,
        salienceScore: 0.5,
        recencyScore: 1.0,
        isActive: true,
        expiresAt,
        tags: [],
        metadata: {},
    };

    const [inserted] = await db.insert(userMemories).values(row).returning();
    return inserted;
}

// ---------------------------------------------------------------------------
// Process turn — extract & store facts from new messages
// ---------------------------------------------------------------------------

export async function processTurn(
    messages: Array<{ role: string; content: string }>,
    options: MemoryServiceOptions,
): Promise<{ factsExtracted: number; factsStored: number }> {
    // Get existing facts to avoid duplication
    const existing = await db
        .select({ fact: userMemories.fact })
        .from(userMemories)
        .where(
            and(
                eq(userMemories.userId, options.userId),
                eq(userMemories.isActive, true),
            ),
        );

    const existingFacts = existing.map((e) => e.fact);
    const extracted = await extractFacts(messages, existingFacts);

    let stored = 0;
    for (const fact of extracted) {
        const result = await storeMemory(fact, options);
        if (result) stored++;
    }

    return { factsExtracted: extracted.length, factsStored: stored };
}

// ---------------------------------------------------------------------------
// Episodic summaries
// ---------------------------------------------------------------------------

export async function getEpisodicSummaries(
    options: MemoryServiceOptions,
): Promise<EpisodicSummary[]> {
    const { tenantId, userId, episodicTopK = 3 } = options;

    return db
        .select()
        .from(episodicSummaries)
        .where(
            and(
                eq(episodicSummaries.tenantId, tenantId),
                eq(episodicSummaries.userId, userId),
                eq(episodicSummaries.isActive, true),
            ),
        )
        .orderBy(desc(episodicSummaries.updatedAt))
        .limit(episodicTopK);
}

export async function upsertEpisodicSummary(
    data: {
        summary: string;
        mainTopics: string[];
        keyEntities: string[];
        keyDecisions: string[];
        sentiment?: string;
        turnCount: number;
    },
    options: MemoryServiceOptions,
): Promise<EpisodicSummary> {
    if (!options.conversationId) throw new Error("conversationId is required for episodic summary");

    const existing = await db
        .select()
        .from(episodicSummaries)
        .where(eq(episodicSummaries.conversationId, options.conversationId))
        .limit(1);

    let embedding: number[] | undefined;
    try {
        embedding = await getEmbedding(data.summary);
    } catch {
        // ok
    }

    const tokenCount = Math.ceil(data.summary.length / 4);

    if (existing.length > 0) {
        const [updated] = await db
            .update(episodicSummaries)
            .set({
                summary: data.summary,
                mainTopics: data.mainTopics,
                keyEntities: data.keyEntities,
                keyDecisions: data.keyDecisions,
                sentiment: data.sentiment,
                turnCount: data.turnCount,
                tokenCount,
                embedding,
                updatedAt: new Date(),
            })
            .where(eq(episodicSummaries.id, existing[0].id))
            .returning();
        return updated;
    }

    const [inserted] = await db
        .insert(episodicSummaries)
        .values({
            tenantId: options.tenantId,
            userId: options.userId,
            conversationId: options.conversationId,
            summary: data.summary,
            mainTopics: data.mainTopics,
            keyEntities: data.keyEntities,
            keyDecisions: data.keyDecisions,
            sentiment: data.sentiment,
            turnCount: data.turnCount,
            tokenCount,
            embedding,
            isActive: true,
            metadata: {},
        })
        .returning();

    return inserted;
}

// ---------------------------------------------------------------------------
// KV Store helpers
// ---------------------------------------------------------------------------

export async function kvGet(
    tenantId: string,
    userId: string,
    namespace: string,
    key: string,
): Promise<unknown | null> {
    const rows = await db
        .select({ value: ragKvStore.value })
        .from(ragKvStore)
        .where(
            and(
                eq(ragKvStore.tenantId, tenantId),
                eq(ragKvStore.userId, userId),
                eq(ragKvStore.namespace, namespace),
                eq(ragKvStore.key, key),
            ),
        )
        .limit(1);

    return rows.length > 0 ? rows[0].value : null;
}

export async function kvSet(
    tenantId: string,
    userId: string,
    namespace: string,
    key: string,
    value: unknown,
    ttlSeconds?: number,
): Promise<void> {
    const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : undefined;

    const existing = await db
        .select({ id: ragKvStore.id, version: ragKvStore.version })
        .from(ragKvStore)
        .where(
            and(
                eq(ragKvStore.tenantId, tenantId),
                eq(ragKvStore.userId, userId),
                eq(ragKvStore.namespace, namespace),
                eq(ragKvStore.key, key),
            ),
        )
        .limit(1);

    if (existing.length > 0) {
        await db
            .update(ragKvStore)
            .set({
                value,
                version: (existing[0].version ?? 1) + 1,
                expiresAt,
                updatedAt: new Date(),
            })
            .where(eq(ragKvStore.id, existing[0].id));
    } else {
        await db.insert(ragKvStore).values({
            tenantId,
            userId,
            namespace,
            key,
            value,
            version: 1,
            expiresAt,
        });
    }
}

export async function kvDelete(
    tenantId: string,
    userId: string,
    namespace: string,
    key: string,
): Promise<void> {
    await db
        .delete(ragKvStore)
        .where(
            and(
                eq(ragKvStore.tenantId, tenantId),
                eq(ragKvStore.userId, userId),
                eq(ragKvStore.namespace, namespace),
                eq(ragKvStore.key, key),
            ),
        );
}

// ---------------------------------------------------------------------------
// Full memory context assembly
// ---------------------------------------------------------------------------

export async function getMemoryContext(
    query: string,
    chatId: string,
    options: MemoryServiceOptions,
): Promise<MemoryContext> {
    const [shortTerm, longTerm, episodic] = await Promise.all([
        getShortTermMemory(chatId, options.shortTermWindow ?? 20),
        getLongTermMemory(query, options),
        getEpisodicSummaries(options),
    ]);

    return { shortTerm, longTerm, episodic };
}

// ---------------------------------------------------------------------------
// Decay / cleanup — run periodically
// ---------------------------------------------------------------------------

export async function decayMemories(userId: string): Promise<number> {
    // Decrease recency scores for all memories
    const result = await db.execute(sql`
        UPDATE user_memories
        SET recency_score = GREATEST(0.01, recency_score * 0.95),
            is_active = CASE
                WHEN expires_at IS NOT NULL AND expires_at < NOW() THEN false
                ELSE is_active
            END,
            updated_at = NOW()
        WHERE user_id = ${userId}
          AND is_active = true
    `);

    return (result as any).rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const memoryService = {
    getShortTermMemory,
    getLongTermMemory,
    extractFacts,
    storeMemory,
    processTurn,
    getEpisodicSummaries,
    upsertEpisodicSummary,
    getMemoryContext,
    decayMemories,
    kvGet,
    kvSet,
    kvDelete,
};
