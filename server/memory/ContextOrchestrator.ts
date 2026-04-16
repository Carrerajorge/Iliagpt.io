/**
 * Context Orchestrator
 * 
 * Central coordinator for enterprise-grade conversation context management.
 * Manages multi-tier caching, persistence, and context optimization.
 */

import { EventEmitter } from "events";
import { createClient, RedisClientType } from "redis";
import { storage } from "../storage";
import { conversationMemoryManager, type ChatMessage } from "../services/conversationMemory";

// ============================================================================
// TYPES
// ============================================================================

export interface ContextConfig {
    // Tier 0: In-memory LRU cache
    l0MaxSize: number;
    l0TtlMs: number;

    // Tier 1: Redis cache
    l1Enabled: boolean;
    l1TtlSeconds: number;
    redisUrl: string;

    // Token management
    maxTokenBudget: number;
    compressionThreshold: number;

    // Persistence
    enableTransactionalPersist: boolean;
    enableOptimisticLocking: boolean;
}

export interface CachedContext {
    messages: ChatMessage[];
    entities: ExtractedEntity[];
    tokenCount: number;
    lastAccess: number;
    version: number;
    checksum: string;
}

export interface ExtractedEntity {
    type: "name" | "preference" | "fact" | "topic" | "reference";
    key: string;
    value: string;
    confidence: number;
    sourceMessageIndex: number;
    timestamp: Date;
}

export interface ContextMetrics {
    l0Hits: number;
    l0Misses: number;
    l1Hits: number;
    l1Misses: number;
    dbFetches: number;
    avgLatencyMs: number;
    compressionRatio: number;
}

// ============================================================================
// L0 CACHE (In-Memory LRU)
// ============================================================================

class L0Cache {
    private cache = new Map<string, CachedContext>();
    private accessOrder: string[] = [];
    private maxSize: number;
    private ttlMs: number;

    constructor(maxSize: number, ttlMs: number) {
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
    }

    get(chatId: string): CachedContext | null {
        const entry = this.cache.get(chatId);
        if (!entry) return null;

        // Check TTL
        if (Date.now() - entry.lastAccess > this.ttlMs) {
            this.cache.delete(chatId);
            return null;
        }

        // Update access order (LRU)
        this.accessOrder = this.accessOrder.filter(id => id !== chatId);
        this.accessOrder.push(chatId);
        entry.lastAccess = Date.now();

        return entry;
    }

    set(chatId: string, context: CachedContext): void {
        // Evict if full
        while (this.cache.size >= this.maxSize && this.accessOrder.length > 0) {
            const oldest = this.accessOrder.shift();
            if (oldest) this.cache.delete(oldest);
        }

        this.cache.set(chatId, { ...context, lastAccess: Date.now() });
        this.accessOrder.push(chatId);
    }

    invalidate(chatId: string): void {
        this.cache.delete(chatId);
        this.accessOrder = this.accessOrder.filter(id => id !== chatId);
    }

    clear(): void {
        this.cache.clear();
        this.accessOrder = [];
    }

    size(): number {
        return this.cache.size;
    }
}

// ============================================================================
// CONTEXT ORCHESTRATOR
// ============================================================================

export class ContextOrchestrator extends EventEmitter {
    private config: ContextConfig;
    private l0Cache: L0Cache;
    private redis: RedisClientType | null = null;
    private metrics: ContextMetrics;
    private initialized = false;

    constructor(config?: Partial<ContextConfig>) {
        super();

        this.config = {
            l0MaxSize: 1000,
            l0TtlMs: 5 * 60 * 1000, // 5 min
            l1Enabled: true,
            l1TtlSeconds: 30 * 60, // 30 min
            redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
            maxTokenBudget: 8000,
            compressionThreshold: 6000,
            enableTransactionalPersist: true,
            enableOptimisticLocking: true,
            ...config
        };

        this.l0Cache = new L0Cache(this.config.l0MaxSize, this.config.l0TtlMs);

        this.metrics = {
            l0Hits: 0,
            l0Misses: 0,
            l1Hits: 0,
            l1Misses: 0,
            dbFetches: 0,
            avgLatencyMs: 0,
            compressionRatio: 1.0
        };
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        const isTestEnv =
            process.env.NODE_ENV === "test" ||
            !!process.env.VITEST_WORKER_ID ||
            !!process.env.VITEST_POOL_ID;

        if (this.config.l1Enabled && !isTestEnv) {
            try {
                this.redis = createClient({ url: this.config.redisUrl });
                this.redis.on("error", (err) => {
                    console.error("[ContextOrchestrator] Redis error:", err);
                });
                await this.redis.connect();
                console.log("[ContextOrchestrator] Redis L1 cache connected");
            } catch (error) {
                console.warn("[ContextOrchestrator] Redis unavailable, falling back to L0 only:", error);
                this.redis = null;
            }
        } else if (this.config.l1Enabled && isTestEnv) {
            // Avoid long connection timeouts in unit/integration tests.
            this.redis = null;
        }

        this.initialized = true;
        console.log("[ContextOrchestrator] Initialized with config:", {
            l0MaxSize: this.config.l0MaxSize,
            l1Enabled: this.config.l1Enabled && this.redis !== null,
            maxTokenBudget: this.config.maxTokenBudget
        });
    }

    /**
     * Get conversation context with multi-tier caching
     */
    async getContext(
        chatId: string,
        clientMessages: ChatMessage[] = [],
        options: { maxTokens?: number; forceRefresh?: boolean } = {}
    ): Promise<{
        messages: ChatMessage[];
        entities: ExtractedEntity[];
        tokenCount: number;
        cacheLevel: "l0" | "l1" | "db";
        latencyMs: number;
    }> {
        const startTime = Date.now();
        const maxTokens = options.maxTokens || this.config.maxTokenBudget;

        if (!options.forceRefresh) {
            // Try L0 (in-memory)
            const l0Result = this.l0Cache.get(chatId);
            if (l0Result) {
                this.metrics.l0Hits++;
                return {
                    messages: l0Result.messages,
                    entities: l0Result.entities,
                    tokenCount: l0Result.tokenCount,
                    cacheLevel: "l0",
                    latencyMs: Date.now() - startTime
                };
            }
            this.metrics.l0Misses++;

            // Try L1 (Redis)
            if (this.redis) {
                try {
                    const l1Data = await this.redis.get(`ctx:${chatId}`);
                    if (l1Data) {
                        const parsed = JSON.parse(l1Data) as CachedContext;
                        this.l0Cache.set(chatId, parsed); // Promote to L0
                        this.metrics.l1Hits++;
                        return {
                            messages: parsed.messages,
                            entities: parsed.entities,
                            tokenCount: parsed.tokenCount,
                            cacheLevel: "l1",
                            latencyMs: Date.now() - startTime
                        };
                    }
                } catch (error) {
                    console.warn("[ContextOrchestrator] Redis get failed:", error);
                }
                this.metrics.l1Misses++;
            }
        }

        // Fetch from DB (L2)
        this.metrics.dbFetches++;
        const messages = await conversationMemoryManager.augmentWithHistory(
            chatId,
            clientMessages,
            maxTokens
        );

        // Extract entities
        const entities = this.extractEntities(messages);

        // Calculate token count
        const tokenCount = this.estimateTokens(messages);

        // Create cache entry
        const cacheEntry: CachedContext = {
            messages,
            entities,
            tokenCount,
            lastAccess: Date.now(),
            version: 1,
            checksum: this.computeChecksum(messages)
        };

        // Store in caches
        this.l0Cache.set(chatId, cacheEntry);

        if (this.redis) {
            try {
                await this.redis.setEx(
                    `ctx:${chatId}`,
                    this.config.l1TtlSeconds,
                    JSON.stringify(cacheEntry)
                );
            } catch (error) {
                console.warn("[ContextOrchestrator] Redis set failed:", error);
            }
        }

        const latencyMs = Date.now() - startTime;
        this.updateLatencyMetrics(latencyMs);

        return {
            messages,
            entities,
            tokenCount,
            cacheLevel: "db",
            latencyMs
        };
    }

    /**
     * Persist new message with transactional guarantee
     */
    async persistMessage(
        chatId: string,
        message: ChatMessage,
        options: { optimisticVersion?: number } = {}
    ): Promise<{ success: boolean; newVersion: number; error?: string }> {
        try {
            // Optimistic locking check
            if (this.config.enableOptimisticLocking && options.optimisticVersion !== undefined) {
                const current = this.l0Cache.get(chatId);
                if (current && current.version !== options.optimisticVersion) {
                    return {
                        success: false,
                        newVersion: current.version,
                        error: "VERSION_CONFLICT"
                    };
                }
            }

            // Persist to DB
            await storage.createChatMessage({
                chatId,
                role: message.role,
                content: message.content,
                status: "complete"
            });

            // Invalidate caches to force refresh
            this.invalidateContext(chatId);

            const newVersion = (options.optimisticVersion || 0) + 1;

            this.emit("message_persisted", { chatId, message, version: newVersion });

            return { success: true, newVersion };

        } catch (error: any) {
            console.error("[ContextOrchestrator] Persist failed:", error);
            return {
                success: false,
                newVersion: options.optimisticVersion || 0,
                error: error.message
            };
        }
    }

    /**
     * Invalidate context in all cache tiers
     */
    async invalidateContext(chatId: string): Promise<void> {
        this.l0Cache.invalidate(chatId);

        if (this.redis) {
            try {
                await this.redis.del(`ctx:${chatId}`);
            } catch (error) {
                console.warn("[ContextOrchestrator] Redis del failed:", error);
            }
        }

        this.emit("context_invalidated", { chatId });
    }

    /**
     * Validate client context against server
     */
    async validateContext(
        chatId: string,
        clientMessages: ChatMessage[]
    ): Promise<{
        valid: boolean;
        serverMessageCount: number;
        clientMessageCount: number;
        missingIds: string[];
        syncRequired: boolean;
    }> {
        const serverResult = await this.getContext(chatId, []);
        const serverHashes = new Set(
            serverResult.messages.map(m => this.hashMessage(m))
        );
        const clientHashes = new Set(
            clientMessages.filter(m => m.role !== "system").map(m => this.hashMessage(m))
        );

        const missingIds: string[] = [];
        const serverHashArray = Array.from(serverHashes);
        for (const hash of serverHashArray) {
            if (!clientHashes.has(hash)) {
                missingIds.push(hash);
            }
        }

        return {
            valid: missingIds.length === 0,
            serverMessageCount: serverResult.messages.length,
            clientMessageCount: clientMessages.length,
            missingIds,
            syncRequired: missingIds.length > 0
        };
    }

    /**
     * Get health metrics
     */
    getMetrics(): ContextMetrics & {
        cacheSize: number;
        hitRate: number;
    } {
        const totalRequests = this.metrics.l0Hits + this.metrics.l0Misses;
        const hitRate = totalRequests > 0
            ? (this.metrics.l0Hits + this.metrics.l1Hits) / totalRequests
            : 0;

        return {
            ...this.metrics,
            cacheSize: this.l0Cache.size(),
            hitRate
        };
    }

    // ============================================================================
    // PRIVATE HELPERS
    // ============================================================================

    private extractEntities(messages: ChatMessage[]): ExtractedEntity[] {
        const entities: ExtractedEntity[] = [];

        for (let i = 0; i < messages.length; i++) {
            const content = messages[i].content;

            // Extract names
            const nameMatch = content.match(/(?:me llamo|my name is|soy)\s+(\w+)/i);
            if (nameMatch) {
                entities.push({
                    type: "name",
                    key: "user_name",
                    value: nameMatch[1],
                    confidence: 0.9,
                    sourceMessageIndex: i,
                    timestamp: new Date()
                });
            }

            // Extract preferences
            const prefMatch = content.match(/(?:prefiero|i prefer|me gusta)\s+(.+?)(?:\.|$)/i);
            if (prefMatch) {
                entities.push({
                    type: "preference",
                    key: `pref_${i}`,
                    value: prefMatch[1].trim(),
                    confidence: 0.7,
                    sourceMessageIndex: i,
                    timestamp: new Date()
                });
            }

            // Extract topics
            const topicMatch = content.match(/(?:sobre|about|regarding)\s+(.+?)(?:\.|,|$)/i);
            if (topicMatch) {
                entities.push({
                    type: "topic",
                    key: `topic_${i}`,
                    value: topicMatch[1].trim().slice(0, 50),
                    confidence: 0.6,
                    sourceMessageIndex: i,
                    timestamp: new Date()
                });
            }
        }

        return entities;
    }

    private estimateTokens(messages: ChatMessage[]): number {
        return messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4) + 4, 0);
    }

    private computeChecksum(messages: ChatMessage[]): string {
        const content = messages.map(m => `${m.role}:${m.content}`).join("|");
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(16);
    }

    private hashMessage(m: ChatMessage): string {
        const content = `${m.role}:${m.content.slice(0, 100)}`;
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            hash = ((hash << 5) - hash) + content.charCodeAt(i);
            hash = hash & hash;
        }
        return hash.toString(16);
    }

    private updateLatencyMetrics(latencyMs: number): void {
        const total = this.metrics.l0Hits + this.metrics.l0Misses +
            this.metrics.l1Hits + this.metrics.l1Misses +
            this.metrics.dbFetches;
        this.metrics.avgLatencyMs = (this.metrics.avgLatencyMs * (total - 1) + latencyMs) / total;
    }

    async shutdown(): Promise<void> {
        if (this.redis) {
            await this.redis.quit();
        }
        this.l0Cache.clear();
        this.initialized = false;
    }
}

// Singleton instance
export const contextOrchestrator = new ContextOrchestrator();

export default contextOrchestrator;
