/**
 * Embeddings Cache Service (#46)
 * Cache embeddings to reduce API costs and latency
 */

import crypto from 'crypto';

interface CachedEmbedding {
    vector: number[];
    model: string;
    dimension: number;
    createdAt: Date;
    accessCount: number;
    lastAccessed: Date;
}

interface CacheStats {
    hits: number;
    misses: number;
    size: number;
    evictions: number;
}

// LRU Cache implementation
class EmbeddingsCache {
    private cache: Map<string, CachedEmbedding>;
    private maxSize: number;
    private stats: CacheStats;

    constructor(maxSize: number = 10000) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.stats = { hits: 0, misses: 0, size: 0, evictions: 0 };
    }

    /**
     * Generate cache key from text and model
     */
    private generateKey(text: string, model: string): string {
        // Normalize text for consistent keying
        const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
        const hash = crypto.createHash('sha256')
            .update(`${model}:${normalized}`)
            .digest('hex');
        return hash;
    }

    /**
     * Get embedding from cache
     */
    get(text: string, model: string): number[] | null {
        const key = this.generateKey(text, model);
        const entry = this.cache.get(key);

        if (entry) {
            // Update access tracking
            entry.accessCount++;
            entry.lastAccessed = new Date();

            // Move to end (most recently used)
            this.cache.delete(key);
            this.cache.set(key, entry);

            this.stats.hits++;
            return entry.vector;
        }

        this.stats.misses++;
        return null;
    }

    /**
     * Store embedding in cache
     */
    set(text: string, model: string, vector: number[]): void {
        const key = this.generateKey(text, model);

        // Evict if at capacity
        if (this.cache.size >= this.maxSize) {
            this.evictLRU();
        }

        this.cache.set(key, {
            vector,
            model,
            dimension: vector.length,
            createdAt: new Date(),
            accessCount: 1,
            lastAccessed: new Date(),
        });

        this.stats.size = this.cache.size;
    }

    /**
     * Evict least recently used entry
     */
    private evictLRU(): void {
        // Map maintains insertion order, so first item is oldest
        const firstKey = this.cache.keys().next().value;
        if (firstKey) {
            this.cache.delete(firstKey);
            this.stats.evictions++;
        }
    }

    /**
     * Batch get embeddings
     */
    batchGet(texts: string[], model: string): { cached: Map<string, number[]>; missing: string[] } {
        const cached = new Map<string, number[]>();
        const missing: string[] = [];

        for (const text of texts) {
            const vector = this.get(text, model);
            if (vector) {
                cached.set(text, vector);
            } else {
                missing.push(text);
            }
        }

        return { cached, missing };
    }

    /**
     * Batch set embeddings
     */
    batchSet(texts: string[], vectors: number[][], model: string): void {
        if (texts.length !== vectors.length) {
            throw new Error('Texts and vectors arrays must have same length');
        }

        for (let i = 0; i < texts.length; i++) {
            this.set(texts[i], model, vectors[i]);
        }
    }

    /**
     * Clear cache
     */
    clear(): void {
        this.cache.clear();
        this.stats = { hits: 0, misses: 0, size: 0, evictions: 0 };
    }

    /**
     * Get cache statistics
     */
    getStats(): CacheStats & { hitRate: number } {
        const total = this.stats.hits + this.stats.misses;
        return {
            ...this.stats,
            hitRate: total > 0 ? this.stats.hits / total : 0,
        };
    }

    /**
     * Prune old entries
     */
    prune(maxAge: number = 7 * 24 * 60 * 60 * 1000): number {
        const now = Date.now();
        let pruned = 0;

        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.lastAccessed.getTime() > maxAge) {
                this.cache.delete(key);
                pruned++;
            }
        }

        this.stats.size = this.cache.size;
        return pruned;
    }
}

// Singleton instance
const embeddingsCache = new EmbeddingsCache();

/**
 * Get or compute embedding with caching
 */
export async function getCachedEmbedding(
    text: string,
    model: string,
    computeFn: (text: string) => Promise<number[]>
): Promise<number[]> {
    // Check cache first
    const cached = embeddingsCache.get(text, model);
    if (cached) {
        return cached;
    }

    // Compute embedding
    const vector = await computeFn(text);

    // Store in cache
    embeddingsCache.set(text, model, vector);

    return vector;
}

/**
 * Batch get or compute embeddings
 */
export async function getCachedEmbeddingsBatch(
    texts: string[],
    model: string,
    computeFn: (texts: string[]) => Promise<number[][]>
): Promise<Map<string, number[]>> {
    // Check cache for existing embeddings
    const { cached, missing } = embeddingsCache.batchGet(texts, model);

    if (missing.length === 0) {
        return cached;
    }

    // Compute missing embeddings
    const newVectors = await computeFn(missing);

    // Store new embeddings in cache
    embeddingsCache.batchSet(missing, newVectors, model);

    // Merge results
    for (let i = 0; i < missing.length; i++) {
        cached.set(missing[i], newVectors[i]);
    }

    return cached;
}

/**
 * Get cache statistics
 */
export function getEmbeddingsCacheStats() {
    return embeddingsCache.getStats();
}

/**
 * Clear embeddings cache
 */
export function clearEmbeddingsCache() {
    embeddingsCache.clear();
}

/**
 * Prune old embeddings
 */
export function pruneOldEmbeddings(maxAgeDays: number = 7) {
    return embeddingsCache.prune(maxAgeDays * 24 * 60 * 60 * 1000);
}

// Periodic pruning
setInterval(() => {
    const pruned = pruneOldEmbeddings(7);
    if (pruned > 0) {
        console.log(`Pruned ${pruned} old embeddings from cache`);
    }
}, 24 * 60 * 60 * 1000); // Daily

// Export cache instance for testing
export { embeddingsCache };
