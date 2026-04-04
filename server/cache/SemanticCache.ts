import crypto from 'crypto';
import Redis from 'ioredis';
import { Logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheHit {
  response: string;
  similarity: number;
  /** Seconds since the entry was stored */
  age: number;
  metadata: unknown;
}

export interface SemanticCacheStats {
  totalEntries: number;
  hits: number;
  misses: number;
  hitRate: number;
  avgSimilarityOnHit: number;
  exactHits: number;
  approximateHits: number;
}

interface SemanticCacheOptions {
  similarityThreshold: number;
  ttl: number;               // seconds
  maxEntries: number;
  embeddingDimensions: number;
}

interface StoredEntry {
  prompt: string;
  response: string;
  embedding: number[];
  metadata: unknown;
  createdAt: number;       // Unix timestamp (seconds)
}

// ---------------------------------------------------------------------------
// Redis key helpers
// ---------------------------------------------------------------------------

const KEY_PREFIX = 'semantic_cache';
const INDEX_KEY = `${KEY_PREFIX}:index`;      // ZSET: member = hash, score = createdAt
const STATS_KEY = `${KEY_PREFIX}:stats`;      // HASH: hits, misses, exactHits, approxHits, totalSimilarity

function entryKey(hash: string): string {
  return `${KEY_PREFIX}:${hash}`;
}

// ---------------------------------------------------------------------------
// SemanticCache
// ---------------------------------------------------------------------------

export class SemanticCache {
  private readonly redis: Redis;
  private readonly threshold: number;
  private readonly ttl: number;
  private readonly maxEntries: number;
  private readonly embeddingDim: number;

  constructor(options: SemanticCacheOptions) {
    this.redis = new Redis(process.env.REDIS_URL as string);
    this.threshold = options.similarityThreshold;
    this.ttl = options.ttl;
    this.maxEntries = options.maxEntries;
    this.embeddingDim = options.embeddingDimensions;

    this.redis.on('error', (err) =>
      Logger.error('[SemanticCache] Redis error', err),
    );

    Logger.info('[SemanticCache] Initialised', {
      threshold: this.threshold,
      ttl: this.ttl,
      maxEntries: this.maxEntries,
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Store a prompt/response pair together with its embedding.
   */
  async set(
    prompt: string,
    response: string,
    embedding: number[],
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    this.assertEmbeddingDimension(embedding);

    const normalised = this.normalisePrompt(prompt);
    const hash = this.hashPrompt(normalised);
    const key = entryKey(hash);
    const now = Math.floor(Date.now() / 1000);

    const entry: StoredEntry = {
      prompt: normalised,
      response,
      embedding,
      metadata,
      createdAt: now,
    };

    const pipeline = this.redis.pipeline();

    // Store full entry as a JSON string in a plain key
    pipeline.set(key, JSON.stringify(entry), 'EX', this.ttl);

    // Add to sorted-set index (score = createdAt for age-based eviction)
    pipeline.zadd(INDEX_KEY, now, hash);
    pipeline.expire(INDEX_KEY, this.ttl * 2);

    await pipeline.exec();

    // Enforce maxEntries cap (evict oldest)
    await this.evictIfNeeded();

    Logger.info('[SemanticCache] Entry stored', { hash, prompt: normalised.slice(0, 60) });
  }

  /**
   * Retrieve a cached response.
   * First checks for an exact prompt match, then falls back to cosine
   * similarity scan across all live entries.
   */
  async get(prompt: string, embedding: number[]): Promise<CacheHit | null> {
    this.assertEmbeddingDimension(embedding);

    const normalised = this.normalisePrompt(prompt);
    const hash = this.hashPrompt(normalised);

    // ---- Exact match -------------------------------------------------------
    const exactHit = await this.fetchEntry(hash);
    if (exactHit) {
      await this.recordHit(1, true);
      Logger.info('[SemanticCache] Exact hit', { hash });
      return {
        response: exactHit.response,
        similarity: 1,
        age: Math.floor(Date.now() / 1000) - exactHit.createdAt,
        metadata: exactHit.metadata,
      };
    }

    // ---- Approximate nearest-neighbour ------------------------------------
    const allHashes = await this.redis.zrange(INDEX_KEY, 0, -1);
    if (allHashes.length === 0) {
      await this.recordMiss();
      return null;
    }

    let bestSimilarity = -Infinity;
    let bestEntry: StoredEntry | null = null;

    // Fetch all entries in a single pipeline
    const pipeline = this.redis.pipeline();
    for (const h of allHashes) {
      pipeline.get(entryKey(h));
    }
    const results = await pipeline.exec();

    if (!results) {
      await this.recordMiss();
      return null;
    }

    for (const [err, raw] of results) {
      if (err || !raw || typeof raw !== 'string') continue;

      let entry: StoredEntry;
      try {
        entry = JSON.parse(raw) as StoredEntry;
      } catch {
        continue;
      }

      if (
        !Array.isArray(entry.embedding) ||
        entry.embedding.length !== this.embeddingDim
      ) {
        continue;
      }

      const sim = this.cosineSimilarity(embedding, entry.embedding);
      if (sim > bestSimilarity) {
        bestSimilarity = sim;
        bestEntry = entry;
      }
    }

    if (bestEntry && bestSimilarity >= this.threshold) {
      await this.recordHit(bestSimilarity, false);
      Logger.info('[SemanticCache] Approximate hit', { similarity: bestSimilarity.toFixed(4) });
      return {
        response: bestEntry.response,
        similarity: bestSimilarity,
        age: Math.floor(Date.now() / 1000) - bestEntry.createdAt,
        metadata: bestEntry.metadata,
      };
    }

    await this.recordMiss();
    return null;
  }

  /**
   * Delete entries whose stored (normalised) prompt matches a simple glob
   * pattern. Returns the number of deleted entries.
   */
  async invalidate(promptPattern: string): Promise<number> {
    const allHashes = await this.redis.zrange(INDEX_KEY, 0, -1);
    if (allHashes.length === 0) return 0;

    const regex = this.patternToRegex(promptPattern);
    let deleted = 0;

    for (const hash of allHashes) {
      const raw = await this.redis.get(entryKey(hash));
      if (!raw) {
        // Already expired — clean up index
        await this.redis.zrem(INDEX_KEY, hash);
        continue;
      }
      try {
        const entry: StoredEntry = JSON.parse(raw);
        if (regex.test(entry.prompt)) {
          const pipeline = this.redis.pipeline();
          pipeline.del(entryKey(hash));
          pipeline.zrem(INDEX_KEY, hash);
          await pipeline.exec();
          deleted++;
        }
      } catch {
        // Corrupt entry — remove it
        await this.redis.del(entryKey(hash));
        await this.redis.zrem(INDEX_KEY, hash);
      }
    }

    Logger.info('[SemanticCache] Invalidated entries', { pattern: promptPattern, deleted });
    return deleted;
  }

  /** Aggregate statistics about cache performance. */
  async getStats(): Promise<SemanticCacheStats> {
    const [statsRaw, totalEntries] = await Promise.all([
      this.redis.hgetall(STATS_KEY),
      this.redis.zcard(INDEX_KEY),
    ]);

    const hits = parseInt(statsRaw?.hits ?? '0', 10);
    const misses = parseInt(statsRaw?.misses ?? '0', 10);
    const exactHits = parseInt(statsRaw?.exactHits ?? '0', 10);
    const approximateHits = parseInt(statsRaw?.approximateHits ?? '0', 10);
    const totalSimilarity = parseFloat(statsRaw?.totalSimilarity ?? '0');
    const total = hits + misses;

    return {
      totalEntries,
      hits,
      misses,
      hitRate: total > 0 ? hits / total : 0,
      avgSimilarityOnHit: hits > 0 ? totalSimilarity / hits : 0,
      exactHits,
      approximateHits,
    };
  }

  /**
   * Pre-populate the cache with a batch of prompt/response/embedding triples.
   * Useful at startup to restore persisted embeddings.
   */
  async warmUp(
    entries: Array<{ prompt: string; response: string; embedding: number[] }>,
  ): Promise<void> {
    Logger.info('[SemanticCache] Starting warm-up', { count: entries.length });

    for (const entry of entries) {
      try {
        await this.set(entry.prompt, entry.response, entry.embedding);
      } catch (err) {
        Logger.error('[SemanticCache] Warm-up entry failed', err);
      }
    }

    Logger.info('[SemanticCache] Warm-up complete');
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Cosine similarity between two equal-length numeric vectors.
   * Returns a value in [-1, 1]; higher is more similar.
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error(
        `cosineSimilarity: dimension mismatch (${a.length} vs ${b.length})`,
      );
    }

    let dot = 0;
    let magA = 0;
    let magB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }

    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    if (denom === 0) return 0;
    return dot / denom;
  }

  /** Lower-case, trim, collapse internal whitespace. */
  private normalisePrompt(prompt: string): string {
    return prompt.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /** SHA-256 of the normalised prompt string (hex). */
  private hashPrompt(normalised: string): string {
    return crypto.createHash('sha256').update(normalised, 'utf8').digest('hex');
  }

  private async fetchEntry(hash: string): Promise<StoredEntry | null> {
    const raw = await this.redis.get(entryKey(hash));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredEntry;
    } catch {
      return null;
    }
  }

  /** Evict the oldest entries when the index exceeds maxEntries. */
  private async evictIfNeeded(): Promise<void> {
    const count = await this.redis.zcard(INDEX_KEY);
    if (count <= this.maxEntries) return;

    const excess = count - this.maxEntries;
    // ZRANGE with lowest scores = oldest entries
    const toEvict = await this.redis.zrange(INDEX_KEY, 0, excess - 1);
    if (toEvict.length === 0) return;

    const pipeline = this.redis.pipeline();
    for (const hash of toEvict) {
      pipeline.del(entryKey(hash));
      pipeline.zrem(INDEX_KEY, hash);
    }
    await pipeline.exec();

    Logger.info('[SemanticCache] Evicted old entries', { evicted: toEvict.length });
  }

  private async recordHit(similarity: number, exact: boolean): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.hincrbyfloat(STATS_KEY, 'hits', 1);
    pipeline.hincrbyfloat(STATS_KEY, 'totalSimilarity', similarity);
    pipeline.hincrbyfloat(STATS_KEY, exact ? 'exactHits' : 'approximateHits', 1);
    await pipeline.exec();
  }

  private async recordMiss(): Promise<void> {
    await this.redis.hincrbyfloat(STATS_KEY, 'misses', 1);
  }

  private assertEmbeddingDimension(embedding: number[]): void {
    if (embedding.length !== this.embeddingDim) {
      throw new Error(
        `[SemanticCache] Expected embedding dimension ${this.embeddingDim}, got ${embedding.length}`,
      );
    }
  }

  /**
   * Converts a simple glob-style pattern (only * wildcard) into a RegExp.
   */
  private patternToRegex(pattern: string): RegExp {
    const escaped = pattern
      .toLowerCase()
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp(escaped);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const semanticCache = new SemanticCache({
  similarityThreshold: parseFloat(process.env.SEMANTIC_CACHE_THRESHOLD ?? '0.92'),
  ttl: parseInt(process.env.SEMANTIC_CACHE_TTL ?? '3600', 10),
  maxEntries: parseInt(process.env.SEMANTIC_CACHE_MAX_ENTRIES ?? '10000', 10),
  embeddingDimensions: parseInt(
    process.env.SEMANTIC_CACHE_EMBEDDING_DIM ?? '1536',
    10,
  ),
});
