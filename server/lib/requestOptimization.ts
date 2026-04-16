/**
 * Request Coalescing and Deduplication
 * Task 25: Request coalescing para queries duplicados
 * Task 27: Sistema de prefetch para datos predecibles
 * Task 28: Speculative execution para paths calientes
 */

import { Logger } from './logger';
import { EventEmitter } from 'events';

// ============================================================================
// Task 25: Request Coalescing
// ============================================================================

interface PendingRequest<T> {
    promise: Promise<T>;
    resolvers: Array<(value: T) => void>;
    rejecters: Array<(error: Error) => void>;
    createdAt: number;
}

/**
 * Coalesces identical concurrent requests into a single execution
 * Prevents the "thundering herd" problem
 */
class RequestCoalescer<T = any> {
    private pending: Map<string, PendingRequest<T>> = new Map();
    private stats = { coalesced: 0, executed: 0 };
    private ttlMs: number;

    constructor(ttlMs: number = 100) {
        this.ttlMs = ttlMs;
    }

    async execute(key: string, fn: () => Promise<T>): Promise<T> {
        const existing = this.pending.get(key);

        // If there's a pending request and it's still fresh, coalesce
        if (existing && (Date.now() - existing.createdAt) < this.ttlMs) {
            this.stats.coalesced++;
            return new Promise((resolve, reject) => {
                existing.resolvers.push(resolve);
                existing.rejecters.push(reject);
            });
        }

        // Create new pending request
        this.stats.executed++;
        const resolvers: Array<(value: T) => void> = [];
        const rejecters: Array<(error: Error) => void> = [];

        const promise = fn();

        this.pending.set(key, {
            promise,
            resolvers,
            rejecters,
            createdAt: Date.now(),
        });

        try {
            const result = await promise;

            // Resolve all coalesced requests
            resolvers.forEach(resolve => resolve(result));

            return result;
        } catch (error) {
            // Reject all coalesced requests
            const err = error instanceof Error ? error : new Error(String(error));
            rejecters.forEach(reject => reject(err));
            throw error;
        } finally {
            this.pending.delete(key);
        }
    }

    getStats(): { coalesced: number; executed: number; pending: number; saveRatio: string } {
        const total = this.stats.coalesced + this.stats.executed;
        return {
            coalesced: this.stats.coalesced,
            executed: this.stats.executed,
            pending: this.pending.size,
            saveRatio: total > 0 ? `${Math.round((this.stats.coalesced / total) * 100)}%` : '0%',
        };
    }

    clear(): void {
        this.pending.clear();
    }
}

export const requestCoalescer = new RequestCoalescer();

// ============================================================================
// Task 27: Prefetch System
// ============================================================================

interface PrefetchConfig<T> {
    key: string;
    fetcher: () => Promise<T>;
    ttlMs: number;
    priority?: number;
}

interface PrefetchEntry<T> {
    data: T;
    fetchedAt: number;
    ttlMs: number;
    hitCount: number;
}

class PrefetchManager<T = any> extends EventEmitter {
    private cache: Map<string, PrefetchEntry<T>> = new Map();
    private fetchers: Map<string, PrefetchConfig<T>> = new Map();
    private prefetchQueue: PrefetchConfig<T>[] = [];
    private isPrefetching = false;
    private maxCacheSize: number;

    constructor(maxCacheSize: number = 100) {
        super();
        this.maxCacheSize = maxCacheSize;

        // Periodic cleanup
        setInterval(() => this.cleanup(), 60000).unref();
    }

    register(config: PrefetchConfig<T>): void {
        this.fetchers.set(config.key, config);
    }

    async get(key: string): Promise<T | null> {
        const cached = this.cache.get(key);

        if (cached) {
            // Check if still valid
            if (Date.now() - cached.fetchedAt < cached.ttlMs) {
                cached.hitCount++;
                return cached.data;
            }
            // Expired, remove and trigger background refresh
            this.cache.delete(key);
            this.schedulePrefetch(key);
        }

        return null;
    }

    async getOrFetch(key: string): Promise<T> {
        const cached = await this.get(key);
        if (cached !== null) return cached;

        const config = this.fetchers.get(key);
        if (!config) {
            throw new Error(`No fetcher registered for key: ${key}`);
        }

        const data = await config.fetcher();
        this.set(key, data, config.ttlMs);
        return data;
    }

    set(key: string, data: T, ttlMs: number): void {
        // Evict oldest if at capacity
        if (this.cache.size >= this.maxCacheSize) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) this.cache.delete(oldestKey);
        }

        this.cache.set(key, {
            data,
            fetchedAt: Date.now(),
            ttlMs,
            hitCount: 0,
        });
    }

    schedulePrefetch(key: string): void {
        const config = this.fetchers.get(key);
        if (!config) return;

        // Avoid duplicates in queue
        if (!this.prefetchQueue.some(c => c.key === key)) {
            this.prefetchQueue.push(config);
            this.prefetchQueue.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
            this.processPrefetchQueue();
        }
    }

    private async processPrefetchQueue(): Promise<void> {
        if (this.isPrefetching || this.prefetchQueue.length === 0) return;

        this.isPrefetching = true;

        while (this.prefetchQueue.length > 0) {
            const config = this.prefetchQueue.shift()!;

            try {
                const data = await config.fetcher();
                this.set(config.key, data, config.ttlMs);
                this.emit('prefetched', { key: config.key });
            } catch (error: any) {
                Logger.warn(`[Prefetch] Failed to prefetch ${config.key}: ${error.message}`);
                this.emit('prefetchFailed', { key: config.key, error: error.message });
            }
        }

        this.isPrefetching = false;
    }

    prefetchAll(keys?: string[]): void {
        const targetKeys = keys ?? Array.from(this.fetchers.keys());
        targetKeys.forEach(key => this.schedulePrefetch(key));
    }

    private cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.cache) {
            if (now - entry.fetchedAt > entry.ttlMs) {
                this.cache.delete(key);
            }
        }
    }

    getStats(): {
        cacheSize: number;
        registeredFetchers: number;
        queuedPrefetches: number;
        topHits: Array<{ key: string; hits: number }>;
    } {
        const topHits = Array.from(this.cache.entries())
            .map(([key, entry]) => ({ key, hits: entry.hitCount }))
            .sort((a, b) => b.hits - a.hits)
            .slice(0, 5);

        return {
            cacheSize: this.cache.size,
            registeredFetchers: this.fetchers.size,
            queuedPrefetches: this.prefetchQueue.length,
            topHits,
        };
    }
}

export const prefetchManager = new PrefetchManager();

// ============================================================================
// Task 28: Speculative Execution
// ============================================================================

interface SpeculativePath<T> {
    condition: () => boolean | Promise<boolean>;
    execute: () => Promise<T>;
    probability?: number;  // 0-1, likelihood this path will be taken
}

interface SpeculativeResult<T> {
    result: T;
    wasSpeculative: boolean;
    savedTimeMs?: number;
}

/**
 * Executes likely paths speculatively to reduce latency
 */
class SpeculativeExecutor {
    private activeSpeculations: Map<string, Promise<any>> = new Map();
    private stats = { hits: 0, misses: 0, savedMs: 0 };

    /**
     * Speculatively execute a function if there's a high probability it will be needed
     */
    async speculate<T>(
        key: string,
        paths: SpeculativePath<T>[],
        fallback: () => Promise<T>
    ): Promise<SpeculativeResult<T>> {
        // Check if we already have a speculative result
        const existing = this.activeSpeculations.get(key);
        if (existing) {
            try {
                const startTime = Date.now();
                const result = await existing;
                const savedTime = Date.now() - startTime;

                this.stats.hits++;
                this.stats.savedMs += savedTime;
                this.activeSpeculations.delete(key);

                return { result, wasSpeculative: true, savedTimeMs: savedTime };
            } catch {
                // Speculation failed, fall through to normal execution
                this.activeSpeculations.delete(key);
            }
        }

        // Check which path to take
        for (const path of paths.sort((a, b) => (b.probability ?? 0.5) - (a.probability ?? 0.5))) {
            const shouldExecute = await path.condition();
            if (shouldExecute) {
                const result = await path.execute();
                return { result, wasSpeculative: false };
            }
        }

        // No speculative path matched, use fallback
        this.stats.misses++;
        const result = await fallback();
        return { result, wasSpeculative: false };
    }

    /**
     * Pre-execute a likely-needed operation
     */
    preExecute<T>(key: string, fn: () => Promise<T>): void {
        if (this.activeSpeculations.has(key)) return;

        const speculation = fn().catch(error => {
            Logger.debug(`[SpeculativeExec] Pre-execution failed for ${key}: ${error.message}`);
            throw error;
        });

        this.activeSpeculations.set(key, speculation);

        // Auto-cleanup after timeout
        setTimeout(() => {
            this.activeSpeculations.delete(key);
        }, 30000);
    }

    /**
     * Check if there's a pending speculation
     */
    hasPending(key: string): boolean {
        return this.activeSpeculations.has(key);
    }

    getStats(): { hits: number; misses: number; hitRate: string; savedMs: number; pending: number } {
        const total = this.stats.hits + this.stats.misses;
        return {
            hits: this.stats.hits,
            misses: this.stats.misses,
            hitRate: total > 0 ? `${Math.round((this.stats.hits / total) * 100)}%` : '0%',
            savedMs: this.stats.savedMs,
            pending: this.activeSpeculations.size,
        };
    }

    clear(): void {
        this.activeSpeculations.clear();
    }
}

export const speculativeExecutor = new SpeculativeExecutor();

// ============================================================================
// Hot Path Optimizer
// ============================================================================

interface HotPath {
    pattern: string | RegExp;
    preExecute?: () => Promise<void>;
    prefetchKeys?: string[];
}

/**
 * Optimizes frequently accessed paths with prefetching and speculation
 */
class HotPathOptimizer {
    private paths: HotPath[] = [];
    private accessCounts: Map<string, number> = new Map();
    private threshold = 100; // Accesses to consider "hot"

    register(path: HotPath): void {
        this.paths.push(path);
    }

    recordAccess(path: string): void {
        const count = (this.accessCounts.get(path) ?? 0) + 1;
        this.accessCounts.set(path, count);

        // If path becomes hot, trigger optimizations
        if (count === this.threshold) {
            this.optimizePath(path);
        }
    }

    private optimizePath(pathStr: string): void {
        const matching = this.paths.find(p => {
            if (typeof p.pattern === 'string') {
                return pathStr.includes(p.pattern);
            }
            return p.pattern.test(pathStr);
        });

        if (matching) {
            Logger.info(`[HotPath] Optimizing hot path: ${pathStr}`);

            if (matching.preExecute) {
                matching.preExecute().catch(err => {
                    Logger.warn(`[HotPath] Pre-execution failed: ${err.message}`);
                });
            }

            if (matching.prefetchKeys) {
                matching.prefetchKeys.forEach(key => prefetchManager.schedulePrefetch(key));
            }
        }
    }

    getHotPaths(limit: number = 10): Array<{ path: string; accesses: number }> {
        return Array.from(this.accessCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([path, accesses]) => ({ path, accesses }));
    }
}

export const hotPathOptimizer = new HotPathOptimizer();

// ============================================================================
// Exports
// ============================================================================

export { RequestCoalescer, PrefetchManager, SpeculativeExecutor, HotPathOptimizer };
