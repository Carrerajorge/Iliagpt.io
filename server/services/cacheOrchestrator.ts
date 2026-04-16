/**
 * Multi-tier Cache Orchestrator
 * 
 * Implements L0/L1/L2 cache strategy:
 * - L0: In-memory Map (session, ~10ms)
 * - L1: Redis/Upstash (~50ms, cross-instance)
 * - L2: PostgreSQL (persistent)
 * 
 * Features:
 * - Read-through caching
 * - Write-through with async L1 update
 * - TTL management
 * - Cache invalidation
 */

import { Redis } from '@upstash/redis';
import { storage } from '../storage';
import type { Chat, ChatMessage } from '../../shared/schema';

// ============================================================================
// CONFIGURATION
// ============================================================================

const L0_MAX_SIZE = 1000; // Max items in memory
const L0_TTL_MS = 5 * 60 * 1000; // 5 minutes
const L1_TTL_SECONDS = 3600; // 1 hour
const CACHE_KEY_PREFIX = 'iliagpt:v1:';

// ============================================================================
// L0: IN-MEMORY CACHE
// ============================================================================

interface L0CacheEntry<T> {
    value: T;
    expiresAt: number;
}

class L0Cache<T> {
    private cache = new Map<string, L0CacheEntry<T>>();
    private maxSize: number;
    private ttlMs: number;

    constructor(maxSize = L0_MAX_SIZE, ttlMs = L0_TTL_MS) {
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
    }

    get(key: string): T | null {
        const entry = this.cache.get(key);
        if (!entry) return null;

        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }

        return entry.value;
    }

    set(key: string, value: T, ttlMs?: number): void {
        // Evict oldest if at capacity
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey) this.cache.delete(firstKey);
        }

        this.cache.set(key, {
            value,
            expiresAt: Date.now() + (ttlMs || this.ttlMs)
        });
    }

    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    invalidatePattern(pattern: string): number {
        let count = 0;
        const keys = Array.from(this.cache.keys());
        for (const key of keys) {
            if (key.includes(pattern)) {
                this.cache.delete(key);
                count++;
            }
        }
        return count;
    }

    clear(): void {
        this.cache.clear();
    }

    size(): number {
        return this.cache.size;
    }

    stats(): { size: number; maxSize: number } {
        return { size: this.cache.size, maxSize: this.maxSize };
    }
}

// ============================================================================
// L1: REDIS CACHE
// ============================================================================

let redisClient: Redis | null = null;
let redisAvailable = false;

function getRedisClient(): Redis | null {
    if (redisClient) return redisClient;

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
        console.log('[Cache] No REDIS_URL configured, L1 cache disabled');
        return null;
    }

    try {
        // Parse Upstash Redis URL to extract components
        // Format: rediss://default:TOKEN@HOST:PORT
        const url = new URL(redisUrl);
        const token = url.password;
        const restUrl = `https://${url.hostname}`;

        redisClient = new Redis({
            url: restUrl,
            token: token
        });
        redisAvailable = true;
        console.log('[Cache] L1 Redis connected');
        return redisClient;
    } catch (error) {
        console.error('[Cache] Failed to connect to Redis:', error);
        return null;
    }
}

async function l1Get<T>(key: string): Promise<T | null> {
    const redis = getRedisClient();
    if (!redis) return null;

    try {
        const data = await redis.get<T>(`${CACHE_KEY_PREFIX}${key}`);
        return data;
    } catch (error) {
        console.warn('[Cache] L1 get error:', error);
        return null;
    }
}

async function l1Set<T>(key: string, value: T, ttlSeconds = L1_TTL_SECONDS): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis) return false;

    try {
        await redis.setex(`${CACHE_KEY_PREFIX}${key}`, ttlSeconds, value);
        return true;
    } catch (error) {
        console.warn('[Cache] L1 set error:', error);
        return false;
    }
}

async function l1Delete(key: string): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis) return false;

    try {
        await redis.del(`${CACHE_KEY_PREFIX}${key}`);
        return true;
    } catch (error) {
        console.warn('[Cache] L1 delete error:', error);
        return false;
    }
}

async function l1DeletePattern(pattern: string): Promise<number> {
    const redis = getRedisClient();
    if (!redis) return 0;

    try {
        // For Upstash, we need to scan and delete
        const keys = await redis.keys(`${CACHE_KEY_PREFIX}${pattern}*`);
        if (keys.length === 0) return 0;

        await redis.del(...keys);
        return keys.length;
    } catch (error) {
        console.warn('[Cache] L1 deletePattern error:', error);
        return 0;
    }
}

// ============================================================================
// L0 INSTANCES
// ============================================================================

const chatCache = new L0Cache<Chat>();
const messageCache = new L0Cache<ChatMessage[]>();
const chatListCache = new L0Cache<Chat[]>();

// ============================================================================
// CACHE ORCHESTRATOR - PUBLIC API
// ============================================================================

export interface CacheStats {
    l0: { chats: number; messages: number; chatLists: number };
    l1Available: boolean;
    l2: 'postgres';
}

/**
 * Get a chat with multi-tier caching
 */
export async function getCachedChat(chatId: string): Promise<Chat | null> {
    const cacheKey = `chat:${chatId}`;

    // L0: In-memory
    const l0Result = chatCache.get(cacheKey);
    if (l0Result) {
        console.log(`[Cache] L0 hit for chat ${chatId}`);
        return l0Result;
    }

    // L1: Redis
    const l1Result = await l1Get<Chat>(cacheKey);
    if (l1Result) {
        console.log(`[Cache] L1 hit for chat ${chatId}`);
        chatCache.set(cacheKey, l1Result);
        return l1Result;
    }

    // L2: Database
    const l2Result = await storage.getChat(chatId);
    if (l2Result) {
        console.log(`[Cache] L2 hit for chat ${chatId}`);
        chatCache.set(cacheKey, l2Result);
        l1Set(cacheKey, l2Result); // Async, don't await
    }

    return l2Result ?? null;
}

/**
 * Get chat messages with multi-tier caching
 */
export async function getCachedMessages(chatId: string): Promise<ChatMessage[]> {
    const cacheKey = `messages:${chatId}`;

    // L0
    const l0Result = messageCache.get(cacheKey);
    if (l0Result) {
        console.log(`[Cache] L0 hit for messages ${chatId}`);
        return l0Result;
    }

    // L1
    const l1Result = await l1Get<ChatMessage[]>(cacheKey);
    if (l1Result) {
        console.log(`[Cache] L1 hit for messages ${chatId}`);
        messageCache.set(cacheKey, l1Result);
        return l1Result;
    }

    // L2
    const l2Result = await storage.getChatMessages(chatId);
    console.log(`[Cache] L2 hit for messages ${chatId}`);
    messageCache.set(cacheKey, l2Result);
    l1Set(cacheKey, l2Result); // Async

    return l2Result;
}

/**
 * Get user's chat list with caching
 */
export async function getCachedChatList(userId: string): Promise<Chat[]> {
    const cacheKey = `chatlist:${userId}`;

    // L0 only for chat lists (short TTL)
    const l0Result = chatListCache.get(cacheKey);
    if (l0Result) {
        return l0Result;
    }

    // L2 (skip L1 for lists - they change frequently)
    const l2Result = await storage.getChats(userId);
    chatListCache.set(cacheKey, l2Result, 30000); // 30s TTL for lists

    return l2Result;
}

/**
 * Invalidate cache after chat update
 */
export async function invalidateChatCache(chatId: string, userId?: string): Promise<void> {
    const chatKey = `chat:${chatId}`;
    const messagesKey = `messages:${chatId}`;

    // L0
    chatCache.delete(chatKey);
    messageCache.delete(messagesKey);

    if (userId) {
        chatListCache.delete(`chatlist:${userId}`);
    }

    // L1
    await Promise.all([
        l1Delete(chatKey),
        l1Delete(messagesKey)
    ]);

    console.log(`[Cache] Invalidated cache for chat ${chatId}`);
}

/**
 * Invalidate user's entire chat list cache
 */
export function invalidateChatListCache(userId: string): void {
    chatListCache.delete(`chatlist:${userId}`);
}

/**
 * Warm cache for a chat (preload)
 */
export async function warmChatCache(chatId: string): Promise<void> {
    await Promise.all([
        getCachedChat(chatId),
        getCachedMessages(chatId)
    ]);
}

/**
 * Get cache statistics
 */
export function getCacheStats(): CacheStats {
    return {
        l0: {
            chats: chatCache.size(),
            messages: messageCache.size(),
            chatLists: chatListCache.size()
        },
        l1Available: redisAvailable,
        l2: 'postgres'
    };
}

/**
 * Clear all caches (for testing)
 */
export async function clearAllCaches(): Promise<void> {
    chatCache.clear();
    messageCache.clear();
    chatListCache.clear();

    await l1DeletePattern('*');

    console.log('[Cache] All caches cleared');
}

/**
 * Health check for cache system
 */
export async function cacheHealthCheck(): Promise<{
    l0: 'ok';
    l1: 'ok' | 'unavailable' | 'error';
    l2: 'ok';
}> {
    let l1Status: 'ok' | 'unavailable' | 'error' = 'unavailable';

    const redis = getRedisClient();
    if (redis) {
        try {
            await redis.ping();
            l1Status = 'ok';
        } catch {
            l1Status = 'error';
        }
    }

    return {
        l0: 'ok',
        l1: l1Status,
        l2: 'ok'
    };
}

export default {
    getCachedChat,
    getCachedMessages,
    getCachedChatList,
    invalidateChatCache,
    invalidateChatListCache,
    warmChatCache,
    getCacheStats,
    clearAllCaches,
    cacheHealthCheck
};
