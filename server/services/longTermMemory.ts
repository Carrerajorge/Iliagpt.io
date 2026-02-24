/**
 * Long-Term Memory Layer - ILIAGPT PRO 3.0
 * 
 * Persistent memory across conversations for personalized AI experience.
 * Stores user preferences, facts, and interaction patterns.
 */

import { db } from "../db";
import { eq, desc, sql, and, gte } from "drizzle-orm";

// ============== Types ==============

export interface UserMemory {
    id: string;
    userId: string;
    type: MemoryType;
    key: string;
    value: string;
    confidence: number;
    source: MemorySource;
    metadata: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
    accessCount: number;
    lastAccessedAt: Date;
    expiresAt?: Date;
}

export type MemoryType =
    | "fact"           // User mentioned facts (name, job, location)
    | "preference"     // User preferences (language, style, etc)
    | "context"        // Ongoing project/task context
    | "skill"          // User's demonstrated skills/knowledge
    | "interaction"    // Interaction patterns
    | "goal"           // User's stated goals
    | "relationship"   // People/orgs user mentions
    | "custom";

export type MemorySource =
    | "explicit"       // User directly stated
    | "inferred"       // AI inferred from conversation
    | "system"         // System detected
    | "imported";      // Imported from external source

export interface MemorySearchResult {
    memory: UserMemory;
    relevance: number;
    matchType: "exact" | "semantic" | "partial";
}

export interface MemoryConfig {
    maxMemoriesPerUser?: number;
    defaultTTL?: number;
    inferenceEnabled?: boolean;
    confidenceThreshold?: number;
}

// ============== In-Memory Store ==============
// Production would use Redis + PostgreSQL

const memoryStore = new Map<string, Map<string, UserMemory>>();

function getUserStore(userId: string): Map<string, UserMemory> {
    if (!memoryStore.has(userId)) {
        memoryStore.set(userId, new Map());
    }
    return memoryStore.get(userId)!;
}

// ============== Memory Operations ==============

export class LongTermMemory {
    private config: Required<MemoryConfig>;

    constructor(config: MemoryConfig = {}) {
        this.config = {
            maxMemoriesPerUser: config.maxMemoriesPerUser ?? 1000,
            defaultTTL: config.defaultTTL ?? 1000 * 60 * 60 * 24 * 365, // 1 year
            inferenceEnabled: config.inferenceEnabled ?? true,
            confidenceThreshold: config.confidenceThreshold ?? 0.6,
        };
    }

    // ======== Core Operations ========

    /**
     * Store a memory
     */
    async remember(
        userId: string,
        type: MemoryType,
        key: string,
        value: string,
        options: {
            confidence?: number;
            source?: MemorySource;
            metadata?: Record<string, any>;
            ttl?: number;
        } = {}
    ): Promise<UserMemory> {
        const store = getUserStore(userId);
        const memoryId = `${type}:${key}`;

        const existing = store.get(memoryId);
        const now = new Date();

        const memory: UserMemory = {
            id: memoryId,
            userId,
            type,
            key,
            value,
            confidence: options.confidence ?? 0.8,
            source: options.source ?? "explicit",
            metadata: options.metadata ?? {},
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            accessCount: (existing?.accessCount ?? 0) + 1,
            lastAccessedAt: now,
            expiresAt: options.ttl
                ? new Date(now.getTime() + options.ttl)
                : new Date(now.getTime() + this.config.defaultTTL),
        };

        // Update confidence if existing
        if (existing) {
            memory.confidence = Math.min(0.99, existing.confidence + 0.05);
        }

        store.set(memoryId, memory);

        // Enforce max memories
        if (store.size > this.config.maxMemoriesPerUser) {
            this.pruneOldest(userId, store.size - this.config.maxMemoriesPerUser);
        }

        return memory;
    }

    /**
     * Recall a specific memory
     */
    async recall(
        userId: string,
        type: MemoryType,
        key: string
    ): Promise<UserMemory | null> {
        const store = getUserStore(userId);
        const memoryId = `${type}:${key}`;
        const memory = store.get(memoryId);

        if (!memory) return null;

        // Check expiration
        if (memory.expiresAt && memory.expiresAt < new Date()) {
            store.delete(memoryId);
            return null;
        }

        // Update access stats
        memory.accessCount++;
        memory.lastAccessedAt = new Date();

        return memory;
    }

    /**
     * Search memories
     */
    async search(
        userId: string,
        query: string,
        options: {
            types?: MemoryType[];
            limit?: number;
            minConfidence?: number;
        } = {}
    ): Promise<MemorySearchResult[]> {
        const store = getUserStore(userId);
        const results: MemorySearchResult[] = [];
        const queryLower = query.toLowerCase();
        const queryWords = queryLower.split(/\s+/);

        for (const memory of store.values()) {
            // Filter by type
            if (options.types && !options.types.includes(memory.type)) continue;

            // Filter by confidence
            if (memory.confidence < (options.minConfidence ?? this.config.confidenceThreshold)) continue;

            // Check expiration
            if (memory.expiresAt && memory.expiresAt < new Date()) continue;

            // Calculate relevance
            let relevance = 0;
            let matchType: "exact" | "semantic" | "partial" = "partial";

            const keyLower = memory.key.toLowerCase();
            const valueLower = memory.value.toLowerCase();

            // Exact match
            if (keyLower === queryLower || valueLower.includes(queryLower)) {
                relevance = 1.0;
                matchType = "exact";
            } else {
                // Word match
                const matchingWords = queryWords.filter(w =>
                    keyLower.includes(w) || valueLower.includes(w)
                );
                relevance = matchingWords.length / queryWords.length;
                matchType = relevance > 0.5 ? "semantic" : "partial";
            }

            if (relevance > 0) {
                results.push({ memory, relevance, matchType });
            }
        }

        // Sort by relevance
        results.sort((a, b) => b.relevance - a.relevance);

        return results.slice(0, options.limit ?? 10);
    }

    /**
     * Get all memories of a type
     */
    async getByType(
        userId: string,
        type: MemoryType,
        limit?: number
    ): Promise<UserMemory[]> {
        const store = getUserStore(userId);
        const memories: UserMemory[] = [];

        for (const memory of store.values()) {
            if (memory.type === type) {
                if (!memory.expiresAt || memory.expiresAt > new Date()) {
                    memories.push(memory);
                }
            }
        }

        return memories
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
            .slice(0, limit ?? 100);
    }

    /**
     * Forget a memory
     */
    async forget(userId: string, type: MemoryType, key: string): Promise<boolean> {
        const store = getUserStore(userId);
        return store.delete(`${type}:${key}`);
    }

    /**
     * Forget all memories of a type
     */
    async forgetType(userId: string, type: MemoryType): Promise<number> {
        const store = getUserStore(userId);
        let count = 0;

        for (const [id, memory] of store) {
            if (memory.type === type) {
                store.delete(id);
                count++;
            }
        }

        return count;
    }

    /**
     * Clear all user memories
     */
    async clearAll(userId: string): Promise<void> {
        memoryStore.delete(userId);
    }

    // ======== Inference ========

    /**
     * Extract facts from conversation
     */
    async extractFacts(
        userId: string,
        message: string,
        aiResponse: string
    ): Promise<UserMemory[]> {
        if (!this.config.inferenceEnabled) return [];

        const extracted: UserMemory[] = [];

        // Name patterns
        const nameMatch = message.match(/(?:me llamo|my name is|soy)\s+([A-Z][a-záéíóú]+)/i);
        if (nameMatch) {
            const memory = await this.remember(userId, "fact", "name", nameMatch[1], {
                source: "inferred",
                confidence: 0.9,
            });
            extracted.push(memory);
        }

        // Job patterns
        const jobMatch = message.match(/(?:trabajo como|work as|soy)\s+(\w+(?:\s+\w+)?)/i);
        if (jobMatch) {
            const memory = await this.remember(userId, "fact", "occupation", jobMatch[1], {
                source: "inferred",
                confidence: 0.75,
            });
            extracted.push(memory);
        }

        // Location patterns
        const locationMatch = message.match(/(?:vivo en|live in|from)\s+([A-Z][a-záéíóú]+(?:\s+[A-Z][a-záéíóú]+)?)/i);
        if (locationMatch) {
            const memory = await this.remember(userId, "fact", "location", locationMatch[1], {
                source: "inferred",
                confidence: 0.7,
            });
            extracted.push(memory);
        }

        // Preference patterns
        const prefMatch = message.match(/(?:prefiero|prefer|me gusta)\s+(\w+(?:\s+\w+){0,3})/i);
        if (prefMatch) {
            const memory = await this.remember(userId, "preference", "general", prefMatch[1], {
                source: "inferred",
                confidence: 0.6,
            });
            extracted.push(memory);
        }

        return extracted;
    }

    /**
     * Build context from memories
     */
    async buildContext(
        userId: string,
        query: string,
        maxTokens: number = 500
    ): Promise<string> {
        const relevantMemories = await this.search(userId, query, { limit: 10 });
        const facts = await this.getByType(userId, "fact", 5);
        const prefs = await this.getByType(userId, "preference", 3);

        const parts: string[] = [];

        if (facts.length > 0) {
            parts.push("**User Facts:**");
            for (const f of facts) {
                parts.push(`- ${f.key}: ${f.value}`);
            }
        }

        if (prefs.length > 0) {
            parts.push("\n**Preferences:**");
            for (const p of prefs) {
                parts.push(`- ${p.key}: ${p.value}`);
            }
        }

        if (relevantMemories.length > 0) {
            parts.push("\n**Relevant Context:**");
            for (const r of relevantMemories.slice(0, 5)) {
                parts.push(`- ${r.memory.key}: ${r.memory.value}`);
            }
        }

        let context = parts.join("\n");

        // Truncate if too long
        if (context.length > maxTokens * 4) {
            context = context.slice(0, maxTokens * 4) + "...";
        }

        return context;
    }

    // ======== Utilities ========

    private pruneOldest(userId: string, count: number): void {
        const store = getUserStore(userId);
        const sorted = [...store.entries()]
            .sort((a, b) => a[1].lastAccessedAt.getTime() - b[1].lastAccessedAt.getTime());

        for (let i = 0; i < count && i < sorted.length; i++) {
            store.delete(sorted[i][0]);
        }
    }

    /**
     * Get memory statistics
     */
    async getStats(userId: string): Promise<{
        total: number;
        byType: Record<MemoryType, number>;
        avgConfidence: number;
        oldestMemory: Date | null;
    }> {
        const store = getUserStore(userId);
        const byType: Record<string, number> = {};
        let totalConfidence = 0;
        let oldest: Date | null = null;

        for (const memory of store.values()) {
            byType[memory.type] = (byType[memory.type] || 0) + 1;
            totalConfidence += memory.confidence;
            if (!oldest || memory.createdAt < oldest) {
                oldest = memory.createdAt;
            }
        }

        return {
            total: store.size,
            byType: byType as Record<MemoryType, number>,
            avgConfidence: store.size > 0 ? totalConfidence / store.size : 0,
            oldestMemory: oldest,
        };
    }
}

// ============== Singleton ==============

let memoryInstance: LongTermMemory | null = null;

export function getLongTermMemory(config?: MemoryConfig): LongTermMemory {
    if (!memoryInstance) {
        memoryInstance = new LongTermMemory(config);
    }
    return memoryInstance;
}

export default LongTermMemory;
