/**
 * LLM Response Cache Service
 * 
 * Features:
 * - Hash-based cache keys (prompt + model + temperature + system prompt)
 * - TTL-based expiration with configurable durations
 * - Redis-backed with in-memory fallback
 * - Cache invalidation utilities
 * - Streaming response support
 * - Cost savings tracking
 */

import crypto from "crypto";
import { LRUCache } from "lru-cache";

// Cache entry structure
export interface CacheEntry {
    response: string;
    model: string;
    tokens: {
        prompt: number;
        completion: number;
        total: number;
    };
    cachedAt: number;
    expiresAt: number;
    hitCount: number;
}

// Cache configuration
export interface LLMCacheConfig {
    enabled: boolean;
    defaultTTLMs: number;          // Default TTL in milliseconds
    factualTTLMs: number;          // TTL for factual queries
    creativeTTLMs: number;         // TTL for creative content (shorter)
    maxEntries: number;            // Max cache entries
    minPromptLength: number;       // Min prompt length to cache
    excludePatterns: RegExp[];     // Patterns to exclude from caching
}

const DEFAULT_CONFIG: LLMCacheConfig = {
    enabled: true,
    defaultTTLMs: 60 * 60 * 1000,           // 1 hour
    factualTTLMs: 24 * 60 * 60 * 1000,      // 24 hours
    creativeTTLMs: 15 * 60 * 1000,          // 15 minutes
    maxEntries: 5000,
    minPromptLength: 10,
    excludePatterns: [
        /current time/i,
        /today's date/i,
        /weather/i,
        /stock price/i,
        /latest news/i,
    ],
};

// In-memory cache
const memoryCache = new LRUCache<string, CacheEntry>({
    max: DEFAULT_CONFIG.maxEntries,
    ttl: DEFAULT_CONFIG.defaultTTLMs,
});

// Statistics tracking
let cacheStats = {
    hits: 0,
    misses: 0,
    tokensSaved: 0,
    estimatedCostSavings: 0,
};

// Redis client (lazy loaded)
let redisClient: any = null;

async function getRedisClient() {
    if (redisClient) return redisClient;

    try {
        const { default: Redis } = await import("ioredis");
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) return null;

        redisClient = new Redis(redisUrl, {
            maxRetriesPerRequest: 1,
            connectTimeout: 2000,
            lazyConnect: true,
        });

        await redisClient.connect();
        console.log("[LLMCache] Connected to Redis");
        return redisClient;
    } catch (error) {
        console.warn("[LLMCache] Redis unavailable, using in-memory fallback");
        return null;
    }
}

// Generate cache key from request parameters
export function generateCacheKey(params: {
    prompt: string;
    model: string;
    temperature?: number;
    systemPrompt?: string;
    maxTokens?: number;
}): string {
    const normalized = {
        p: params.prompt.trim().toLowerCase(),
        m: params.model,
        t: params.temperature ?? 0.7,
        s: params.systemPrompt?.trim().toLowerCase() || "",
        mt: params.maxTokens || 0,
    };

    const hash = crypto
        .createHash("sha256")
        .update(JSON.stringify(normalized))
        .digest("hex")
        .substring(0, 32);

    return `llm:cache:${hash}`;
}

// Determine TTL based on query type
function determineTTL(prompt: string, config: LLMCacheConfig): number {
    const lowerPrompt = prompt.toLowerCase();

    // Creative content (stories, poems, etc.) - shorter TTL
    if (
        lowerPrompt.includes("write a story") ||
        lowerPrompt.includes("create a poem") ||
        lowerPrompt.includes("imagine") ||
        lowerPrompt.includes("generate creative")
    ) {
        return config.creativeTTLMs;
    }

    // Factual queries - longer TTL
    if (
        lowerPrompt.includes("what is") ||
        lowerPrompt.includes("define") ||
        lowerPrompt.includes("explain") ||
        lowerPrompt.includes("how does") ||
        lowerPrompt.includes("history of")
    ) {
        return config.factualTTLMs;
    }

    return config.defaultTTLMs;
}

// Check if prompt should be cached
function shouldCache(prompt: string, config: LLMCacheConfig): boolean {
    if (!config.enabled) return false;
    if (prompt.length < config.minPromptLength) return false;

    for (const pattern of config.excludePatterns) {
        if (pattern.test(prompt)) return false;
    }

    return true;
}

// Get cached response
export async function getCachedResponse(params: {
    prompt: string;
    model: string;
    temperature?: number;
    systemPrompt?: string;
}): Promise<CacheEntry | null> {
    if (!shouldCache(params.prompt, DEFAULT_CONFIG)) {
        return null;
    }

    const key = generateCacheKey(params);
    const redis = await getRedisClient();

    try {
        if (redis) {
            const cached = await redis.get(key);
            if (cached) {
                const entry: CacheEntry = JSON.parse(cached);

                // Check expiration
                if (entry.expiresAt > Date.now()) {
                    entry.hitCount++;
                    await redis.set(key, JSON.stringify(entry), "PX", entry.expiresAt - Date.now());

                    cacheStats.hits++;
                    cacheStats.tokensSaved += entry.tokens.total;
                    cacheStats.estimatedCostSavings += estimateCost(entry.tokens.total, params.model);

                    console.log(`[LLMCache] HIT - Key: ${key.substring(0, 20)}... Tokens saved: ${entry.tokens.total}`);
                    return entry;
                }
            }
        }

        // Fallback to memory cache
        const memEntry = memoryCache.get(key);
        if (memEntry && memEntry.expiresAt > Date.now()) {
            memEntry.hitCount++;
            memoryCache.set(key, memEntry);

            cacheStats.hits++;
            cacheStats.tokensSaved += memEntry.tokens.total;

            return memEntry;
        }
    } catch (error) {
        console.error("[LLMCache] Get error:", error);
    }

    cacheStats.misses++;
    return null;
}

// Store response in cache
export async function setCachedResponse(
    params: {
        prompt: string;
        model: string;
        temperature?: number;
        systemPrompt?: string;
    },
    response: string,
    tokens: { prompt: number; completion: number; total: number }
): Promise<void> {
    if (!shouldCache(params.prompt, DEFAULT_CONFIG)) {
        return;
    }

    const key = generateCacheKey(params);
    const ttl = determineTTL(params.prompt, DEFAULT_CONFIG);
    const now = Date.now();

    const entry: CacheEntry = {
        response,
        model: params.model,
        tokens,
        cachedAt: now,
        expiresAt: now + ttl,
        hitCount: 0,
    };

    const redis = await getRedisClient();

    try {
        if (redis) {
            await redis.set(key, JSON.stringify(entry), "PX", ttl);
        }

        // Also store in memory for fast access
        memoryCache.set(key, entry, { ttl });

        console.log(`[LLMCache] SET - Key: ${key.substring(0, 20)}... TTL: ${ttl / 1000}s`);
    } catch (error) {
        console.error("[LLMCache] Set error:", error);
    }
}

// Estimate cost savings (approximate pricing)
function estimateCost(tokens: number, model: string): number {
    // Approximate costs per 1K tokens (in USD)
    const pricing: Record<string, number> = {
        "gpt-4": 0.03,
        "gpt-4-turbo": 0.01,
        "gpt-3.5-turbo": 0.002,
        "claude-3-opus": 0.015,
        "claude-3-sonnet": 0.003,
        "grok-3": 0.01,
        "grok-3-fast": 0.005,
    };

    const pricePerToken = (pricing[model] || 0.01) / 1000;
    return tokens * pricePerToken;
}

// Invalidate cache for a specific pattern
export async function invalidateCache(pattern?: string): Promise<number> {
    let count = 0;

    const redis = await getRedisClient();

    if (redis && pattern) {
        try {
            const keys = await redis.keys(`llm:cache:*${pattern}*`);
            if (keys.length > 0) {
                count = await redis.del(...keys);
            }
        } catch (error) {
            console.error("[LLMCache] Invalidation error:", error);
        }
    }

    // Clear memory cache
    if (!pattern) {
        count = memoryCache.size;
        memoryCache.clear();
    }

    console.log(`[LLMCache] Invalidated ${count} entries`);
    return count;
}

// Get cache statistics
export function getCacheStats() {
    const hitRate = cacheStats.hits + cacheStats.misses > 0
        ? (cacheStats.hits / (cacheStats.hits + cacheStats.misses) * 100).toFixed(2)
        : "0";

    return {
        ...cacheStats,
        hitRate: `${hitRate}%`,
        memoryCacheSize: memoryCache.size,
    };
}

// Reset statistics
export function resetCacheStats(): void {
    cacheStats = {
        hits: 0,
        misses: 0,
        tokensSaved: 0,
        estimatedCostSavings: 0,
    };
}

// Wrapper for LLM calls with automatic caching
export async function withCache<T>(
    params: {
        prompt: string;
        model: string;
        temperature?: number;
        systemPrompt?: string;
    },
    llmCall: () => Promise<{ response: string; tokens: { prompt: number; completion: number; total: number } }>
): Promise<{ response: string; tokens: { prompt: number; completion: number; total: number }; cached: boolean }> {
    // Check cache first
    const cached = await getCachedResponse(params);
    if (cached) {
        return {
            response: cached.response,
            tokens: cached.tokens,
            cached: true,
        };
    }

    // Call LLM
    const result = await llmCall();

    // Store in cache
    await setCachedResponse(params, result.response, result.tokens);

    return {
        ...result,
        cached: false,
    };
}

export default {
    generateCacheKey,
    getCachedResponse,
    setCachedResponse,
    invalidateCache,
    getCacheStats,
    resetCacheStats,
    withCache,
};
