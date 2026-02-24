/**
 * Semantic Memory Store
 * 
 * Vector-based memory search using embeddings for semantic similarity.
 * Inspired by OpenClaw's memory system - uses embeddings to find related memories
 * even when wording differs.
 * 
 * Now with database persistence!
 */

import { db } from "../db";
import { storage } from "../storage";
import { llmGateway } from "../lib/llmGateway";
import { semanticMemoryChunks } from "../../shared/schema/memory";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import * as crypto from "crypto";
import { applyMMRToHybridResults } from "./mmr";
import { applyTemporalDecayToResults } from "./temporalDecay";
import { expandQueryForFts } from "./queryExpansion";

// ============================================================================
// TYPES
// ============================================================================

export interface MemoryChunk {
    id: string;
    userId: string;
    content: string;
    type: "fact" | "preference" | "conversation" | "instruction" | "note";
    embedding?: number[];
    metadata: {
        source: string;
        createdAt: Date;
        lastAccessed: Date;
        accessCount: number;
        confidence: number;
        tags?: string[];
    };
}

export interface SearchResult {
    chunk: MemoryChunk;
    score: number;
    matchType: "semantic" | "keyword" | "hybrid";
}

export interface SemanticSearchOptions {
    limit?: number;
    minScore?: number;
    types?: MemoryChunk["type"][];
    hybridSearch?: boolean;
    keywordWeight?: number;
    vectorWeight?: number;
}

// ============================================================================
// EMBEDDING PROVIDER
// ============================================================================

class EmbeddingProvider {
    private cache = new Map<string, number[]>();
    private cacheMaxSize = 10000;
    private openAiEmbeddingModel = process.env.MEMORY_EMBEDDING_MODEL || "text-embedding-3-large";
    private voyageEmbeddingModel = process.env.VOYAGE_EMBEDDING_MODEL || "voyage-3-large";

    /**
     * Get embedding for text, with caching
     */
    async getEmbedding(text: string): Promise<number[]> {
        // Check cache first
        const cacheKey = this.hashText(text);
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        try {
            const isTestEnv = process.env.NODE_ENV === 'test' || !!process.env.VITEST_WORKER_ID || !!process.env.VITEST_POOL_ID;

            // Prefer OpenAI text-embedding-3-large for planner/RAG quality.
            if (process.env.OPENAI_API_KEY && !isTestEnv) {
                const embedding = await this.getOpenAIEmbedding(text);
                this.cacheEmbedding(cacheKey, embedding);
                return embedding;
            }

            // Secondary provider: Voyage embeddings.
            if (process.env.VOYAGE_API_KEY && !isTestEnv) {
                const embedding = await this.getVoyageEmbedding(text);
                this.cacheEmbedding(cacheKey, embedding);
                return embedding;
            }

            // Third option: Gemini embeddings.
            if (process.env.GEMINI_API_KEY && !isTestEnv) {
                const embedding = await this.getGeminiEmbedding(text);
                this.cacheEmbedding(cacheKey, embedding);
                return embedding;
            }

            // No embedding provider available - return simple TF-IDF style vector
            return this.getSimpleEmbedding(text);

        } catch (error) {
            console.warn("[EmbeddingProvider] Error getting embedding, using fallback:", error);
            return this.getSimpleEmbedding(text);
        }
    }

    private async getGeminiEmbedding(text: string): Promise<number[]> {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001"}:embedContent?key=${process.env.GEMINI_API_KEY}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content: { parts: [{ text: text.slice(0, 2048) }] }
                })
            }
        );

        if (!response.ok) {
            throw new Error(`Gemini embedding failed: ${response.status}`);
        }

        const data = await response.json();
        return data.embedding?.values || [];
    }

    private async getOpenAIEmbedding(text: string): Promise<number[]> {
        const response = await fetch("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: this.openAiEmbeddingModel,
                input: text.slice(0, 8000)
            })
        });

        if (!response.ok) {
            throw new Error(`OpenAI embedding failed: ${response.status}`);
        }

        const data = await response.json();
        return data.data?.[0]?.embedding || [];
    }

    private async getVoyageEmbedding(text: string): Promise<number[]> {
        const response = await fetch("https://api.voyageai.com/v1/embeddings", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.VOYAGE_API_KEY}`
            },
            body: JSON.stringify({
                model: this.voyageEmbeddingModel,
                input: [text.slice(0, 8000)],
                input_type: "query",
            })
        });

        if (!response.ok) {
            throw new Error(`Voyage embedding failed: ${response.status}`);
        }

        const data = await response.json();
        return data.data?.[0]?.embedding || [];
    }

    /**
     * Simple TF-IDF style embedding for fallback
     */
    private getSimpleEmbedding(text: string): number[] {
        const words = text.toLowerCase().split(/\s+/);
        const wordFreq = new Map<string, number>();

        for (const word of words) {
            wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
        }

        // Create a simple 256-dimensional vector based on character/word patterns
        const vector = new Array(256).fill(0);

        for (const [word, freq] of Array.from(wordFreq.entries())) {
            for (let i = 0; i < word.length; i++) {
                const idx = word.charCodeAt(i) % 256;
                vector[idx] += freq / words.length;
            }
        }

        // Normalize
        const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
        if (magnitude > 0) {
            for (let i = 0; i < vector.length; i++) {
                vector[i] /= magnitude;
            }
        }

        return vector;
    }

    private hashText(text: string): string {
        return crypto.createHash("md5").update(text).digest("hex");
    }

    private cacheEmbedding(key: string, embedding: number[]): void {
        if (this.cache.size >= this.cacheMaxSize) {
            // Evict oldest entries (simple FIFO)
            const keysToDelete = Array.from(this.cache.keys()).slice(0, 1000);
            for (const k of keysToDelete) {
                this.cache.delete(k);
            }
        }
        this.cache.set(key, embedding);
    }
}

// ============================================================================
// SEMANTIC MEMORY STORE
// ============================================================================

export class SemanticMemoryStore {
    private embeddingProvider = new EmbeddingProvider();
    private memoryCache = new Map<string, MemoryChunk[]>(); // In-memory cache for performance
    private memoryCacheTTL = new Map<string, number>(); // userId -> timestamp of last DB sync
    private initialized = false;
    private static CACHE_MAX_AGE_MS = 30_000; // 30 seconds

    async initialize(): Promise<void> {
        if (this.initialized) return;
        console.log("[SemanticMemoryStore] Initialized with database persistence and embedding support");
        this.initialized = true;
    }

    /**
     * Check if user cache is still fresh
     */
    private isCacheFresh(userId: string): boolean {
        const lastSync = this.memoryCacheTTL.get(userId);
        if (!lastSync) return false;
        return (Date.now() - lastSync) < SemanticMemoryStore.CACHE_MAX_AGE_MS;
    }

    /**
     * Load user memories from database into cache
     */
    private async loadUserMemories(userId: string): Promise<MemoryChunk[]> {
        // Only use cache if it's fresh (not stale)
        if (this.memoryCache.has(userId) && this.isCacheFresh(userId)) {
            return this.memoryCache.get(userId)!;
        }

        try {
            const dbMemories = await db.select().from(semanticMemoryChunks)
                .where(eq(semanticMemoryChunks.userId, userId))
                .orderBy(desc(semanticMemoryChunks.createdAt))
                .limit(500);

            const chunks: MemoryChunk[] = dbMemories.map(m => ({
                id: m.id,
                userId: m.userId,
                content: m.content,
                type: m.type as MemoryChunk["type"],
                embedding: undefined, // Will be computed on-demand
                metadata: {
                    source: m.source || "explicit",
                    createdAt: m.createdAt,
                    lastAccessed: m.lastAccessedAt,
                    accessCount: m.accessCount || 0,
                    confidence: (m.confidence || 80) / 100,
                    tags: m.tags || []
                }
            }));

            this.memoryCache.set(userId, chunks);
            this.memoryCacheTTL.set(userId, Date.now());
            return chunks;
        } catch (error) {
            console.error("[SemanticMemoryStore] Error loading from DB:", error);
            return this.memoryCache.get(userId) || [];
        }
    }

    /**
     * Store a memory with semantic embedding
     */
    async remember(
        userId: string,
        content: string,
        type: MemoryChunk["type"],
        options: {
            source?: string;
            confidence?: number;
            tags?: string[];
        } = {}
    ): Promise<MemoryChunk> {
        // Get embedding for the content
        const embedding = await this.embeddingProvider.getEmbedding(content);

        // Load existing memories
        const userChunks = await this.loadUserMemories(userId);

        // Check for duplicates by semantic similarity
        const similar = await this.findSimilar(userId, content, { limit: 1, minScore: 0.95 });
        if (similar.length > 0) {
            // Update existing instead of creating duplicate
            const existing = similar[0].chunk;
            existing.metadata.lastAccessed = new Date();
            existing.metadata.accessCount++;
            existing.metadata.confidence = Math.max(existing.metadata.confidence, options.confidence ?? 0.8);

            // Update in database
            try {
                await db.update(semanticMemoryChunks)
                    .set({
                        lastAccessedAt: new Date(),
                        accessCount: existing.metadata.accessCount,
                        confidence: Math.round(existing.metadata.confidence * 100),
                        updatedAt: new Date()
                    })
                    .where(eq(semanticMemoryChunks.id, existing.id));
            } catch (error) {
                console.error("[SemanticMemoryStore] Error updating in DB:", error);
            }

            console.log(`[SemanticMemoryStore] Updated existing memory: ${existing.id}`);
            return existing;
        }

        const chunk: MemoryChunk = {
            id: `mem_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
            userId,
            content,
            type,
            embedding,
            metadata: {
                source: options.source || "explicit",
                createdAt: new Date(),
                lastAccessed: new Date(),
                accessCount: 0,
                confidence: options.confidence ?? 0.8,
                tags: options.tags
            }
        };

        // Insert into database
        try {
            await db.insert(semanticMemoryChunks).values({
                id: chunk.id,
                userId: chunk.userId,
                content: chunk.content,
                type: chunk.type,
                source: chunk.metadata.source,
                confidence: Math.round(chunk.metadata.confidence * 100),
                accessCount: 0,
                tags: chunk.metadata.tags || [],
                metadata: {},
                lastAccessedAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date()
            });
        } catch (error) {
            console.error("[SemanticMemoryStore] Error inserting into DB:", error);
        }

        // Invalidate cache to force reload from DB on next access
        this.clearCache(userId);

        console.log(`[SemanticMemoryStore] Stored memory: ${chunk.id} (${type})`);
        return chunk;
    }

    /**
     * Semantic search for related memories
     */
    async search(
        userId: string,
        query: string,
        options: SemanticSearchOptions = {}
    ): Promise<SearchResult[]> {
        const {
            limit = 10,
            minScore = 0.3,
            types,
            hybridSearch = true,
            keywordWeight = 0.3,
            vectorWeight = 0.7
        } = options;

        const userChunks = await this.loadUserMemories(userId);
        if (userChunks.length === 0) return [];

        // Get query embedding
        const expandedQuery = expandQueryForFts(query);
        const queryEmbedding = await this.embeddingProvider.getEmbedding(query);
        const queryWords = new Set(expandedQuery.keywords.length > 0 ? expandedQuery.keywords : expandedQuery.original.toLowerCase().split(/\s+/));

        const results: SearchResult[] = [];

        for (const chunk of userChunks) {
            // Filter by type if specified
            if (types && types.length > 0 && !types.includes(chunk.type)) {
                continue;
            }

            // Compute embedding on demand if not cached
            if (!chunk.embedding) {
                chunk.embedding = await this.embeddingProvider.getEmbedding(chunk.content);
            }

            // Calculate vector similarity
            const vectorScore = chunk.embedding
                ? this.cosineSimilarity(queryEmbedding, chunk.embedding)
                : 0;

            // Calculate keyword overlap (BM25-lite)
            const chunkWords = new Set(chunk.content.toLowerCase().split(/\s+/));
            const intersection = Array.from(queryWords).filter(w => chunkWords.has(w));
            const keywordScore = intersection.length / Math.max(queryWords.size, 1);

            // Hybrid score
            const finalScore = hybridSearch
                ? (vectorWeight * vectorScore) + (keywordWeight * keywordScore)
                : vectorScore;

            if (finalScore >= minScore) {
                results.push({
                    chunk,
                    score: finalScore,
                    matchType: hybridSearch ? "hybrid" : "semantic"
                });

                // Update access metadata
                chunk.metadata.lastAccessed = new Date();
                chunk.metadata.accessCount++;
            }
        }

        // Sort by score descending and limit
        results.sort((a, b) => b.score - a.score);

        // Apply Temporal Decay & MMR from OpenClaw integration
        let finalResults = applyTemporalDecayToResults(
            results.map(r => ({ ...r, timestamp: r.chunk.metadata.createdAt })),
            { enabled: true, halfLifeDays: 30 }
        );

        finalResults = applyMMRToHybridResults(
            finalResults.map(r => ({ ...r, content: r.chunk.content, id: r.chunk.id })),
            { enabled: true, lambda: 0.7 }
        );

        const topResults = finalResults.slice(0, limit);

        // Persist access count updates to DB for matched memories
        const matchedIds = topResults.map(r => r.chunk.id);
        if (matchedIds.length > 0) {
            try {
                await db.update(semanticMemoryChunks)
                    .set({
                        lastAccessedAt: new Date(),
                        accessCount: sql`${semanticMemoryChunks.accessCount} + 1`,
                    })
                    .where(inArray(semanticMemoryChunks.id, matchedIds));
            } catch (error) {
                console.warn("[SemanticMemoryStore] Error persisting access counts:", error);
            }
        }

        return topResults;
    }

    /**
     * Find similar memories (for deduplication)
     */
    private async findSimilar(
        userId: string,
        content: string,
        options: { limit?: number; minScore?: number } = {}
    ): Promise<SearchResult[]> {
        return this.search(userId, content, {
            limit: options.limit || 5,
            minScore: options.minScore || 0.8,
            hybridSearch: false
        });
    }

    /**
     * Get all memories for a user, optionally filtered
     */
    async recall(
        userId: string,
        options: {
            types?: MemoryChunk["type"][];
            limit?: number;
            sortBy?: "recent" | "accessed" | "confidence";
        } = {}
    ): Promise<MemoryChunk[]> {
        let chunks = await this.loadUserMemories(userId);

        if (options.types && options.types.length > 0) {
            chunks = chunks.filter(c => options.types!.includes(c.type));
        }

        // Sort
        switch (options.sortBy) {
            case "recent":
                chunks.sort((a, b) =>
                    b.metadata.createdAt.getTime() - a.metadata.createdAt.getTime()
                );
                break;
            case "accessed":
                chunks.sort((a, b) =>
                    b.metadata.lastAccessed.getTime() - a.metadata.lastAccessed.getTime()
                );
                break;
            case "confidence":
                chunks.sort((a, b) => b.metadata.confidence - a.metadata.confidence);
                break;
        }

        if (options.limit) {
            chunks = chunks.slice(0, options.limit);
        }

        return chunks;
    }

    /**
     * Delete a specific memory
     */
    async forget(userId: string, memoryId: string): Promise<boolean> {
        const chunks = await this.loadUserMemories(userId);
        const index = chunks.findIndex(c => c.id === memoryId);

        if (index >= 0) {
            // Remove from database
            try {
                await db.delete(semanticMemoryChunks)
                    .where(eq(semanticMemoryChunks.id, memoryId));
            } catch (error) {
                console.error("[SemanticMemoryStore] Error deleting from DB:", error);
            }

            // Invalidate cache to force reload from DB
            this.clearCache(userId);

            console.log(`[SemanticMemoryStore] Deleted memory: ${memoryId}`);
            return true;
        }
        return false;
    }

    /**
     * Build context injection from semantic search
     */
    async buildContextFromQuery(
        userId: string,
        query: string,
        maxTokens: number = 500
    ): Promise<string | null> {
        const results = await this.search(userId, query, {
            limit: 10,
            minScore: 0.4
        });

        if (results.length === 0) return null;

        const lines: string[] = ["[Memoria Relevante]"];
        let tokenCount = 20; // Header estimate

        for (const result of results) {
            const line = `• [${result.chunk.type}] ${result.chunk.content}`;
            const lineTokens = Math.ceil(line.length / 4);

            if (tokenCount + lineTokens > maxTokens) break;

            lines.push(line);
            tokenCount += lineTokens;
        }

        return lines.length > 1 ? lines.join("\n") : null;
    }

    /**
     * Extract and store memories from conversation
     */
    async extractFromConversation(
        userId: string,
        messages: Array<{ role: string; content: string }>
    ): Promise<number> {
        let extracted = 0;

        for (const msg of messages) {
            if (msg.role !== "user") continue;

            // Extract explicit facts
            const factPatterns = [
                /(?:me llamo|my name is|soy)\s+([^\n\r\t.,]{1,40})/i,
                /(?:trabajo en|i work at)\s+([^\n\r\t.,]{1,120})/i,
                /(?:vivo en|i live in)\s+([^\n\r\t.,]{1,120})/i,
                /(?:mi email es|my email is)\s+([\w@.]{3,200})/i
            ];

            for (const pattern of factPatterns) {
                const match = msg.content.match(pattern);
                if (match) {
                    await this.remember(userId, match[0], "fact", {
                        source: "conversation",
                        confidence: 0.9
                    });
                    extracted++;
                }
            }

            // Extract preferences
            const prefPatterns = [
                /(?:prefiero|i prefer|me gusta)\s+([^\n\r\t.,]{1,160})/i,
                /(?:siempre quiero|always want)\s+([^\n\r\t.,]{1,160})/i,
                /(?:no me gusta|i don't like)\s+([^\n\r\t.,]{1,160})/i
            ];

            for (const pattern of prefPatterns) {
                const match = msg.content.match(pattern);
                if (match) {
                    await this.remember(userId, match[0], "preference", {
                        source: "conversation",
                        confidence: 0.75
                    });
                    extracted++;
                }
            }

            // Extract instructions
            const instrPatterns = [
                /(?:recuerda que|remember that)\s+([^\n\r\t.]{1,240})/i,
                /(?:siempre|always)\s+([^\n\r\t.]{1,240})/i,
                /(?:nunca|never)\s+([^\n\r\t.]{1,240})/i
            ];

            for (const pattern of instrPatterns) {
                const match = msg.content.match(pattern);
                if (match) {
                    await this.remember(userId, match[0], "instruction", {
                        source: "conversation",
                        confidence: 0.85
                    });
                    extracted++;
                }
            }
        }

        if (extracted > 0) {
            console.log(`[SemanticMemoryStore] Extracted ${extracted} memories from conversation`);
        }

        return extracted;
    }

    /**
     * Get memory statistics
     */
    async getStats(userId: string): Promise<{
        totalMemories: number;
        byType: Record<string, number>;
        avgConfidence: number;
        embeddingProvider: string;
    }> {
        const chunks = await this.loadUserMemories(userId);
        const byType: Record<string, number> = {};
        let totalConfidence = 0;

        for (const chunk of chunks) {
            byType[chunk.type] = (byType[chunk.type] || 0) + 1;
            totalConfidence += chunk.metadata.confidence;
        }

        return {
            totalMemories: chunks.length,
            byType,
            avgConfidence: chunks.length > 0 ? Math.round((totalConfidence / chunks.length) * 100) : 0,
            embeddingProvider: process.env.OPENAI_API_KEY
                ? "openai"
                : process.env.VOYAGE_API_KEY
                    ? "voyage"
                    : process.env.GEMINI_API_KEY
                        ? "gemini"
                        : "simple"
        };
    }

    /**
     * Clear user's memory cache (forces reload from DB)
     */
    clearCache(userId: string): void {
        this.memoryCache.delete(userId);
        this.memoryCacheTTL.delete(userId);
    }

    // ============================================================================
    // PRIVATE HELPERS
    // ============================================================================

    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length || a.length === 0) return 0;

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
        return magnitude > 0 ? dotProduct / magnitude : 0;
    }
}

// Singleton instance
export const semanticMemoryStore = new SemanticMemoryStore();

export default semanticMemoryStore;
