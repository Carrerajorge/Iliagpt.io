import Redis from 'ioredis';
import { Logger } from './logger';

// Cache tags for invalidation
export type CacheTag = 'user' | 'chat' | 'document' | 'settings' | 'subscription' | 'model' | 'session';

export class CacheService {
    private redis: Redis | null = null;
    private isConnected = false;
    private readonly defaultTTL = 60; // 60 seconds
    // Tag to keys mapping for invalidation
    private tagIndex = new Map<string, Set<string>>();

    constructor() {
        this.initialize();
    }

    private initialize() {
        const isTestEnv = process.env.NODE_ENV === "test";
        const allowRedisInTests = process.env.REDIS_ENABLE_IN_TESTS === "1" || process.env.REDIS_ENABLE_IN_TESTS === "true";
        if (isTestEnv && !allowRedisInTests) {
            Logger.info("[Cache] Redis disabled in test env (set REDIS_ENABLE_IN_TESTS=1 to enable)");
            this.isConnected = false;
            this.redis = null;
            return;
        }

        if (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL) {
            const msg = "[Cache] REDIS_URL must be defined in production. In-memory cache fallback is disabled for clustering compatibility.";
            Logger.error(msg);
            throw new Error(msg);
        }

        if (process.env.REDIS_URL) {
            try {
                this.redis = new Redis(process.env.REDIS_URL, {
                    maxRetriesPerRequest: 1,
                    retryStrategy: (times) => {
                        if (times > 3) return null; // Stop retrying after 3 attempts
                        return Math.min(times * 100, 2000);
                    },
                    reconnectOnError: (err) => {
                        Logger.error('[Cache] Redis reconnect error', err);
                        return false;
                    }
                });

                this.redis.on('connect', () => {
                    this.isConnected = true;
                    Logger.info('[Cache] Redis connected');
                });

                this.redis.on('error', (err) => {
                    this.isConnected = false;
                    Logger.warn('[Cache] Redis connection error (running in fallback mode):', err.message);
                });

            } catch (error: any) {
                Logger.error('[Cache] Failed to initialize Redis', error);
                this.isConnected = false;
            }
        } else {
            Logger.info('[Cache] REDIS_URL not set, running in memory-only/fallback mode (no caching)');
        }
    }

    /**
     * Get item from cache
     */
    async get<T>(key: string): Promise<T | null> {
        if (!this.isConnected || !this.redis) return null;

        try {
            const data = await this.redis.get(key);
            if (!data) return null;
            return JSON.parse(data) as T;
        } catch (error) {
            Logger.warn(`[Cache] Get error for key ${key}`, error);
            return null;
        }
    }

    /**
     * Set item in cache with optional tags for invalidation
     */
    async set(key: string, value: any, ttlSeconds: number = this.defaultTTL, tags?: CacheTag[]): Promise<void> {
        if (!this.isConnected || !this.redis) return;

        try {
            const serialized = JSON.stringify(value);
            await this.redis.setex(key, ttlSeconds, serialized);

            // Track tags for invalidation
            if (tags && tags.length > 0) {
                for (const tag of tags) {
                    const tagKey = `cache:tag:${tag}`;
                    if (!this.tagIndex.has(tagKey)) {
                        this.tagIndex.set(tagKey, new Set());
                    }
                    this.tagIndex.get(tagKey)!.add(key);

                    // Also store in Redis for distributed invalidation
                    await this.redis.sadd(tagKey, key);
                    await this.redis.expire(tagKey, ttlSeconds + 60);
                }
            }
        } catch (error) {
            Logger.warn(`[Cache] Set error for key ${key}`, error);
        }
    }

    /**
     * Delete item from cache
     */
    async delete(key: string): Promise<void> {
        if (!this.isConnected || !this.redis) return;
        try {
            await this.redis.del(key);
            // Remove from tag index
            for (const [, keys] of this.tagIndex) {
                keys.delete(key);
            }
        } catch (error) {
            Logger.warn(`[Cache] Delete error for key ${key}`, error);
        }
    }

    /**
     * Invalidate all cache entries with a specific tag
     */
    async invalidateByTag(tag: CacheTag): Promise<number> {
        if (!this.isConnected || !this.redis) return 0;

        const tagKey = `cache:tag:${tag}`;
        let deletedCount = 0;

        try {
            // Get all keys for this tag from Redis
            const keys = await this.redis.smembers(tagKey);

            if (keys.length > 0) {
                deletedCount = await this.redis.del(...keys);
                await this.redis.del(tagKey);
                Logger.info(`[Cache] Invalidated ${deletedCount} keys for tag: ${tag}`);
            }

            this.tagIndex.delete(tagKey);
        } catch (error) {
            Logger.warn(`[Cache] Invalidation error for tag ${tag}`, error);
        }

        return deletedCount;
    }

    /**
     * Invalidate cache entries matching a pattern
     */
    async invalidateByPattern(pattern: string): Promise<number> {
        if (!this.isConnected || !this.redis) return 0;

        let deletedCount = 0;

        try {
            const keys = await this.scan(pattern);
            if (keys.length > 0) {
                deletedCount = await this.redis.del(...keys);
                Logger.info(`[Cache] Invalidated ${deletedCount} keys matching: ${pattern}`);
            }
        } catch (error) {
            Logger.warn(`[Cache] Pattern invalidation error for ${pattern}`, error);
        }

        return deletedCount;
    }

    /**
     * Clear all cache entries
     */
    async flush(): Promise<void> {
        if (!this.isConnected || !this.redis) return;

        try {
            await this.redis.flushdb();
            this.tagIndex.clear();
            Logger.info('[Cache] Cache flushed');
        } catch (error) {
            Logger.warn('[Cache] Flush error', error);
        }
    }

    /**
     * Pattern: Cache-Aside (Get or Set)
     * If key exists, return it.
     * If not, execute fetchingFunction, store result, and return it.
     * 
     * @param key Cache key
     * @param ttlSeconds Time to live
     * @param fetchingFunction Function to retrieve data if cache miss
     */
    async remember<T>(
        key: string,
        ttlSeconds: number,
        fetchingFunction: () => Promise<T>
    ): Promise<T> {
        // 1. Try cache
        const cached = await this.get<T>(key);
        if (cached !== null) {
            return cached;
        }

        // 2. Fetch fresh
        const freshData = await fetchingFunction();

        // 3. Store async (don't await to block response)
        if (freshData !== undefined && freshData !== null) {
            this.set(key, freshData, ttlSeconds).catch(err =>
                Logger.warn(`[Cache] Failed to set cache for key ${key}`, err)
            );
        }

        return freshData;
    }
    async scan(pattern: string): Promise<string[]> {
        if (!this.isConnected || !this.redis) return [];

        try {
            const keys: string[] = [];
            let cursor = "0";

            do {
                const [nextCursor, matches] = await this.redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
                cursor = nextCursor;
                keys.push(...matches);
            } while (cursor !== "0");

            return keys;
        } catch (error) {
            Logger.warn(`[Cache] Scan error for pattern ${pattern}`, error);
            return [];
        }
    }
    getRedisClient(): Redis | null {
        return this.redis;
    }

    /**
     * Returns a Redis client only when we know it's currently connected.
     * Useful for optional dependencies (rate limiting, caches) where we want to
     * transparently fall back to in-memory behavior when Redis is unreachable.
     */
    getConnectedRedisClient(): Redis | null {
        if (!this.redis || !this.isConnected) return null;
        return this.redis;
    }

    isRedisConnected(): boolean {
        return this.isConnected;
    }
}

export const cache = new CacheService();
