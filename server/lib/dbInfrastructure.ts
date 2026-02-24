/**
 * Advanced Database Infrastructure
 * Task 1: Connection pooling avanzado
 * Task 6: DataLoader for N+1 optimization
 * Task 7: Batch processing for DB operations
 * Task 10: Query caching with intelligent invalidation
 */

import { pool, poolRead, db, dbRead } from '../db';
import { Logger } from '../lib/logger';
import { Redis } from 'ioredis';
import { env } from '../config/env';
import type { SQL } from 'drizzle-orm';
import crypto from 'crypto';

// ============================================================================
// Task 1: Advanced Connection Pool Management
// ============================================================================

interface PoolStats {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
    utilizationPercent: number;
}

export function getPoolStats(): { write: PoolStats; read: PoolStats } {
    const writeStats = {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount,
        utilizationPercent: Math.round(((pool.totalCount - pool.idleCount) / pool.totalCount) * 100) || 0,
    };

    const readStats = poolRead === pool ? writeStats : {
        totalCount: poolRead.totalCount,
        idleCount: poolRead.idleCount,
        waitingCount: poolRead.waitingCount,
        utilizationPercent: Math.round(((poolRead.totalCount - poolRead.idleCount) / poolRead.totalCount) * 100) || 0,
    };

    return { write: writeStats, read: readStats };
}

// Connection warmup for cold start optimization
export async function warmupConnections(count: number = 3): Promise<void> {
    Logger.info(`[DB] Warming up ${count} connections...`);
    const warmupPromises: Promise<void>[] = [];

    for (let i = 0; i < count; i++) {
        warmupPromises.push(
            pool.connect().then(client => {
                client.query('SELECT 1');
                client.release();
            }).catch(err => {
                Logger.warn(`[DB] Warmup connection ${i + 1} failed: ${err.message}`);
            })
        );
    }

    await Promise.all(warmupPromises);
    Logger.info(`[DB] Connection warmup complete`);
}

// ============================================================================
// Task 6: DataLoader Implementation for N+1 Optimization
// ============================================================================

type BatchLoadFn<K, V> = (keys: readonly K[]) => Promise<(V | Error)[]>;

interface DataLoaderOptions {
    maxBatchSize?: number;
    batchScheduleFn?: (callback: () => void) => void;
    cacheKeyFn?: (key: any) => string;
    cache?: boolean;
}

export class DataLoader<K, V> {
    private batchLoadFn: BatchLoadFn<K, V>;
    private options: Required<DataLoaderOptions>;
    private cache: Map<string, Promise<V>> = new Map();
    private batch: { key: K; resolve: (value: V) => void; reject: (error: Error) => void }[] = [];
    private batchScheduled = false;

    constructor(batchLoadFn: BatchLoadFn<K, V>, options: DataLoaderOptions = {}) {
        this.batchLoadFn = batchLoadFn;
        this.options = {
            maxBatchSize: options.maxBatchSize ?? 100,
            batchScheduleFn: options.batchScheduleFn ?? ((cb) => process.nextTick(cb)),
            cacheKeyFn: options.cacheKeyFn ?? ((key) => JSON.stringify(key)),
            cache: options.cache ?? true,
        };
    }

    async load(key: K): Promise<V> {
        const cacheKey = this.options.cacheKeyFn(key);

        if (this.options.cache && this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey)!;
        }

        const promise = new Promise<V>((resolve, reject) => {
            this.batch.push({ key, resolve, reject });

            if (!this.batchScheduled) {
                this.batchScheduled = true;
                this.options.batchScheduleFn(() => this.dispatchBatch());
            }
        });

        if (this.options.cache) {
            this.cache.set(cacheKey, promise);
        }

        return promise;
    }

    async loadMany(keys: readonly K[]): Promise<(V | Error)[]> {
        return Promise.all(keys.map(key =>
            this.load(key).catch(error => error instanceof Error ? error : new Error(String(error)))
        ));
    }

    private async dispatchBatch(): Promise<void> {
        const batch = this.batch;
        this.batch = [];
        this.batchScheduled = false;

        if (batch.length === 0) return;

        // Split into chunks if exceeding max batch size
        const chunks: typeof batch[] = [];
        for (let i = 0; i < batch.length; i += this.options.maxBatchSize) {
            chunks.push(batch.slice(i, i + this.options.maxBatchSize));
        }

        for (const chunk of chunks) {
            try {
                const keys = chunk.map(item => item.key);
                const results = await this.batchLoadFn(keys);

                if (results.length !== keys.length) {
                    throw new Error(`DataLoader batch function returned ${results.length} results for ${keys.length} keys`);
                }

                chunk.forEach((item, index) => {
                    const result = results[index];
                    if (result instanceof Error) {
                        item.reject(result);
                    } else {
                        item.resolve(result);
                    }
                });
            } catch (error) {
                chunk.forEach(item => item.reject(error instanceof Error ? error : new Error(String(error))));
            }
        }
    }

    clear(key: K): this {
        this.cache.delete(this.options.cacheKeyFn(key));
        return this;
    }

    clearAll(): this {
        this.cache.clear();
        return this;
    }

    prime(key: K, value: V): this {
        const cacheKey = this.options.cacheKeyFn(key);
        if (!this.cache.has(cacheKey)) {
            this.cache.set(cacheKey, Promise.resolve(value));
        }
        return this;
    }
}

// ============================================================================
// Task 7: Batch Processing for Massive DB Operations
// ============================================================================

interface BatchProcessorOptions<T> {
    batchSize: number;
    concurrency: number;
    onProgress?: (processed: number, total: number) => void;
    retryAttempts?: number;
    retryDelayMs?: number;
}

interface BatchResult<R> {
    successful: R[];
    failed: { index: number; error: Error }[];
    totalProcessed: number;
    durationMs: number;
}

export async function processBatch<T, R>(
    items: T[],
    processor: (batch: T[]) => Promise<R[]>,
    options: BatchProcessorOptions<T>
): Promise<BatchResult<R>> {
    const startTime = Date.now();
    const successful: R[] = [];
    const failed: { index: number; error: Error }[] = [];

    const { batchSize, concurrency, onProgress, retryAttempts = 2, retryDelayMs = 300 } = options;

    // Create batches
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
        batches.push(items.slice(i, i + batchSize));
    }

    let processedCount = 0;

    // Process batches with concurrency control
    const processBatchWithRetry = async (batch: T[], batchIndex: number): Promise<R[]> => {
        for (let attempt = 0; attempt < retryAttempts; attempt++) {
            try {
                return await processor(batch);
            } catch (error) {
                if (attempt === retryAttempts - 1) {
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, retryDelayMs * Math.pow(2, attempt)));
            }
        }
        throw new Error('Unreachable');
    };

    // Process in concurrent chunks
    for (let i = 0; i < batches.length; i += concurrency) {
        const currentBatches = batches.slice(i, i + concurrency);

        const results = await Promise.allSettled(
            currentBatches.map((batch, idx) => processBatchWithRetry(batch, i + idx))
        );

        results.forEach((result, idx) => {
            const batchStartIndex = (i + idx) * batchSize;
            if (result.status === 'fulfilled') {
                successful.push(...result.value);
            } else {
                // Mark all items in failed batch
                const failedBatch = currentBatches[idx];
                failedBatch.forEach((_, itemIdx) => {
                    failed.push({
                        index: batchStartIndex + itemIdx,
                        error: result.reason instanceof Error ? result.reason : new Error(String(result.reason))
                    });
                });
            }
            processedCount += currentBatches[idx].length;
        });

        onProgress?.(processedCount, items.length);
    }

    return {
        successful,
        failed,
        totalProcessed: processedCount,
        durationMs: Date.now() - startTime,
    };
}

// ============================================================================
// Task 10: Query Caching with Intelligent Invalidation
// ============================================================================

interface CacheEntry<T> {
    value: T;
    expiresAt: number;
    tags: string[];
}

interface QueryCacheOptions {
    defaultTTLMs?: number;
    maxSize?: number;
    redis?: Redis | null;
}

export class QueryCache {
    private localCache: Map<string, CacheEntry<any>> = new Map();
    private redis: Redis | null;
    private options: Required<QueryCacheOptions>;
    private tagToKeys: Map<string, Set<string>> = new Map();

    constructor(options: QueryCacheOptions = {}) {
        this.options = {
            defaultTTLMs: options.defaultTTLMs ?? 60000, // 1 minute
            maxSize: options.maxSize ?? 1000,
            redis: options.redis ?? null,
        };
        this.redis = this.options.redis;

        // Periodic cleanup
        setInterval(() => this.cleanup(), 30000).unref();
    }

    private generateKey(query: string, params?: any[]): string {
        const content = JSON.stringify({ query, params });
        return `qc:${crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)}`;
    }

    async get<T>(query: string, params?: any[]): Promise<T | null> {
        const key = this.generateKey(query, params);

        // Try local cache first
        const local = this.localCache.get(key);
        if (local && local.expiresAt > Date.now()) {
            return local.value as T;
        }

        // Try Redis if available
        if (this.redis) {
            try {
                const cached = await this.redis.get(key);
                if (cached) {
                    const parsed = JSON.parse(cached) as T;
                    // Warm local cache
                    this.setLocal(key, parsed, this.options.defaultTTLMs, []);
                    return parsed;
                }
            } catch (err) {
                Logger.warn(`[QueryCache] Redis get failed: ${err}`);
            }
        }

        return null;
    }

    async set<T>(
        query: string,
        params: any[] | undefined,
        value: T,
        options: { ttlMs?: number; tags?: string[] } = {}
    ): Promise<void> {
        const key = this.generateKey(query, params);
        const ttlMs = options.ttlMs ?? this.options.defaultTTLMs;
        const tags = options.tags ?? [];

        this.setLocal(key, value, ttlMs, tags);

        // Store in Redis if available
        if (this.redis) {
            try {
                await this.redis.setex(key, Math.ceil(ttlMs / 1000), JSON.stringify(value));

                // Store tag associations in Redis
                if (tags.length > 0) {
                    const multi = this.redis.multi();
                    for (const tag of tags) {
                        multi.sadd(`tag:${tag}`, key);
                        multi.expire(`tag:${tag}`, Math.ceil(ttlMs / 1000) + 60);
                    }
                    await multi.exec();
                }
            } catch (err) {
                Logger.warn(`[QueryCache] Redis set failed: ${err}`);
            }
        }
    }

    private setLocal<T>(key: string, value: T, ttlMs: number, tags: string[]): void {
        // Evict oldest if at capacity
        if (this.localCache.size >= this.options.maxSize) {
            const oldestKey = this.localCache.keys().next().value;
            if (oldestKey) {
                this.localCache.delete(oldestKey);
            }
        }

        this.localCache.set(key, {
            value,
            expiresAt: Date.now() + ttlMs,
            tags,
        });

        // Track tag associations
        for (const tag of tags) {
            if (!this.tagToKeys.has(tag)) {
                this.tagToKeys.set(tag, new Set());
            }
            this.tagToKeys.get(tag)!.add(key);
        }
    }

    async invalidateByTag(tag: string): Promise<number> {
        let count = 0;

        // Invalidate local cache
        const localKeys = this.tagToKeys.get(tag);
        if (localKeys) {
            for (const key of localKeys) {
                this.localCache.delete(key);
                count++;
            }
            this.tagToKeys.delete(tag);
        }

        // Invalidate Redis cache
        if (this.redis) {
            try {
                const keys = await this.redis.smembers(`tag:${tag}`);
                if (keys.length > 0) {
                    await this.redis.del(...keys, `tag:${tag}`);
                    count += keys.length;
                }
            } catch (err) {
                Logger.warn(`[QueryCache] Redis invalidate failed: ${err}`);
            }
        }

        Logger.debug(`[QueryCache] Invalidated ${count} entries for tag: ${tag}`);
        return count;
    }

    async invalidateByPattern(pattern: string): Promise<number> {
        let count = 0;
        const regex = new RegExp(pattern);

        // Local cache
        for (const [key] of this.localCache) {
            if (regex.test(key)) {
                this.localCache.delete(key);
                count++;
            }
        }

        // Redis - use SCAN for production-safe iteration
        if (this.redis) {
            try {
                let cursor = '0';
                do {
                    const [newCursor, keys] = await this.redis.scan(cursor, 'MATCH', `qc:*`, 'COUNT', 100);
                    cursor = newCursor;

                    const matchingKeys = keys.filter(k => regex.test(k));
                    if (matchingKeys.length > 0) {
                        await this.redis.del(...matchingKeys);
                        count += matchingKeys.length;
                    }
                } while (cursor !== '0');
            } catch (err) {
                Logger.warn(`[QueryCache] Redis pattern invalidate failed: ${err}`);
            }
        }

        return count;
    }

    private cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.localCache) {
            if (entry.expiresAt <= now) {
                this.localCache.delete(key);
                // Clean up tag associations
                for (const tag of entry.tags) {
                    this.tagToKeys.get(tag)?.delete(key);
                }
            }
        }
    }

    getStats(): { localSize: number; hitRate?: number } {
        return {
            localSize: this.localCache.size,
        };
    }

    clear(): void {
        this.localCache.clear();
        this.tagToKeys.clear();
    }
}

// ============================================================================
// Cached Query Wrapper
// ============================================================================

const globalQueryCache = new QueryCache({
    defaultTTLMs: 60000,
    maxSize: 500,
});

export async function cachedQuery<T>(
    queryFn: () => Promise<T>,
    cacheKey: string,
    options: { ttlMs?: number; tags?: string[] } = {}
): Promise<T> {
    const cached = await globalQueryCache.get<T>(cacheKey, []);
    if (cached !== null) {
        return cached;
    }

    const result = await queryFn();
    await globalQueryCache.set(cacheKey, [], result, options);
    return result;
}

export function getGlobalQueryCache(): QueryCache {
    return globalQueryCache;
}

// ============================================================================
// Exports
// ============================================================================

export {
    db,
    dbRead,
    pool,
    poolRead,
};
