/**
 * SemanticCache: Two-tier (L1 in-memory LRU + L2 Redis) cache for LLM responses
 * with embedding-based semantic similarity matching.
 * Improvement 11 – Edge Caching for LLM Responses
 */

import { LRUCache } from "lru-cache";
import Redis from "ioredis";
import crypto from "crypto";
import { Logger } from "../lib/logger";
import { EmbeddingIndex } from "./EmbeddingIndex";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheEntry {
  prompt: string;
  response: string;
  embedding: number[];
  modelId: string;
  userId?: string;
  createdAt: Date;
  hitCount: number;
  ttl: number;
}

export interface CacheStats {
  l1Size: number;
  l1MaxSize: number;
  l2KeyCount: number;
  totalHits: number;
  l1Hits: number;
  l2Hits: number;
  misses: number;
  hitRate: number;
  avgEmbeddingDim: number;
  indexSize: number;
}

export interface SemanticCacheConfig {
  threshold?: number;
  l1Size?: number;
  defaultTTL?: number;
  redisKeyPrefix?: string;
  enableOpenAIEmbeddings?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_THRESHOLD = 0.95;
const DEFAULT_L1_SIZE = 500;
const DEFAULT_TTL = 3600; // seconds
const REDIS_PREFIX = "scache:";
const EMBEDDING_DIM = 128; // dimension of our hash-based mock embeddings

// ---------------------------------------------------------------------------
// SemanticCache
// ---------------------------------------------------------------------------

export class SemanticCache {
  private l1: LRUCache<string, CacheEntry>;
  private redis: Redis;
  private index: EmbeddingIndex;
  private threshold: number;
  private defaultTTL: number;
  private redisPrefix: string;
  private enableOpenAI: boolean;

  // Stats
  private totalHits = 0;
  private l1Hits = 0;
  private l2Hits = 0;
  private misses = 0;

  constructor(config: SemanticCacheConfig = {}) {
    this.threshold = config.threshold ?? DEFAULT_THRESHOLD;
    this.defaultTTL = config.defaultTTL ?? DEFAULT_TTL;
    this.redisPrefix = config.redisKeyPrefix ?? REDIS_PREFIX;
    this.enableOpenAI = config.enableOpenAIEmbeddings ?? !!process.env.OPENAI_API_KEY;

    const l1Size = config.l1Size ?? DEFAULT_L1_SIZE;
    this.l1 = new LRUCache<string, CacheEntry>({
      max: l1Size,
      ttl: this.defaultTTL * 1000,
      updateAgeOnGet: true,
    });

    const redisUrl = process.env.REDIS_URL;
    this.redis = redisUrl
      ? new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: null })
      : new Redis({ lazyConnect: true, maxRetriesPerRequest: null });

    this.redis.on("error", (err) =>
      Logger.error("SemanticCache redis error", err)
    );

    this.index = new EmbeddingIndex(l1Size * 2);
  }

  // -------------------------------------------------------------------------
  // Core get / set
  // -------------------------------------------------------------------------

  async get(
    prompt: string,
    modelId: string,
    userId?: string
  ): Promise<string | null> {
    const exactKey = this.buildCacheKey(prompt, modelId, userId);

    // --- L1 exact hit ---
    const l1Entry = this.l1.get(exactKey);
    if (l1Entry) {
      l1Entry.hitCount++;
      this.totalHits++;
      this.l1Hits++;
      Logger.debug("SemanticCache: L1 exact hit", { key: exactKey });
      return l1Entry.response;
    }

    // --- L2 exact hit ---
    try {
      const l2Raw = await this.redis.get(`${this.redisPrefix}${exactKey}`);
      if (l2Raw) {
        const entry = JSON.parse(l2Raw) as CacheEntry;
        entry.createdAt = new Date(entry.createdAt);
        entry.hitCount++;
        // Promote to L1
        this.l1.set(exactKey, entry);
        this.index.add(exactKey, entry.embedding, { modelId, userId });
        this.totalHits++;
        this.l2Hits++;
        Logger.debug("SemanticCache: L2 exact hit", { key: exactKey });
        return entry.response;
      }
    } catch (err) {
      Logger.warn("SemanticCache: L2 get error", err);
    }

    // --- Semantic similarity search ---
    const queryEmbedding = await this.generateEmbedding(prompt);
    const similar = await this.findSimilar(queryEmbedding, this.threshold);

    if (similar && similar.modelId === modelId) {
      similar.hitCount++;
      this.totalHits++;
      this.l1Hits++;
      Logger.debug("SemanticCache: semantic hit", {
        threshold: this.threshold,
        modelId,
      });
      return similar.response;
    }

    this.misses++;
    return null;
  }

  async set(
    prompt: string,
    response: string,
    modelId: string,
    userId?: string,
    ttl?: number
  ): Promise<void> {
    const key = this.buildCacheKey(prompt, modelId, userId);
    const entryTTL = ttl ?? this.defaultTTL;
    const embedding = await this.generateEmbedding(prompt);

    const entry: CacheEntry = {
      prompt,
      response,
      embedding,
      modelId,
      userId,
      createdAt: new Date(),
      hitCount: 0,
      ttl: entryTTL,
    };

    // Write to L1
    this.l1.set(key, entry, { ttl: entryTTL * 1000 });

    // Add to embedding index
    this.index.add(key, embedding, { modelId, userId });

    // Write to L2 (Redis)
    try {
      await this.redis.set(
        `${this.redisPrefix}${key}`,
        JSON.stringify(entry),
        "EX",
        entryTTL
      );
    } catch (err) {
      Logger.warn("SemanticCache: L2 set error", err);
    }

    Logger.debug("SemanticCache.set", { key, modelId, ttl: entryTTL });
  }

  async findSimilar(
    embedding: number[],
    threshold: number
  ): Promise<CacheEntry | null> {
    const results = this.index.search(embedding, 5, threshold);
    if (results.length === 0) return null;

    // Return the closest match that is still in L1
    for (const result of results) {
      const entry = this.l1.get(result.id);
      if (entry) return entry;

      // Try L2
      try {
        const raw = await this.redis.get(`${this.redisPrefix}${result.id}`);
        if (raw) {
          const parsed = JSON.parse(raw) as CacheEntry;
          parsed.createdAt = new Date(parsed.createdAt);
          // Promote back to L1
          this.l1.set(result.id, parsed);
          return parsed;
        }
      } catch {
        // continue
      }
    }

    return null;
  }

  async invalidate(pattern: string): Promise<void> {
    try {
      // Invalidate L1 entries matching pattern
      const regex = new RegExp(pattern);
      for (const key of this.l1.keys()) {
        if (regex.test(key)) {
          this.l1.delete(key);
          this.index.remove(key);
        }
      }

      // Invalidate L2 entries matching pattern (SCAN-based)
      let cursor = "0";
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          "MATCH",
          `${this.redisPrefix}*${pattern}*`,
          "COUNT",
          "100"
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== "0");

      Logger.info("SemanticCache.invalidate", { pattern });
    } catch (err) {
      Logger.error("SemanticCache.invalidate error", err);
    }
  }

  async getStats(): Promise<CacheStats> {
    let l2KeyCount = 0;
    try {
      // Count L2 keys with our prefix
      let cursor = "0";
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          "MATCH",
          `${this.redisPrefix}*`,
          "COUNT",
          "100"
        );
        cursor = nextCursor;
        l2KeyCount += keys.length;
      } while (cursor !== "0");
    } catch {
      l2KeyCount = -1;
    }

    const total = this.totalHits + this.misses;
    return {
      l1Size: this.l1.size,
      l1MaxSize: this.l1.max,
      l2KeyCount,
      totalHits: this.totalHits,
      l1Hits: this.l1Hits,
      l2Hits: this.l2Hits,
      misses: this.misses,
      hitRate: total > 0 ? this.totalHits / total : 0,
      avgEmbeddingDim: EMBEDDING_DIM,
      indexSize: this.index.getSize(),
    };
  }

  // -------------------------------------------------------------------------
  // Embedding generation
  // -------------------------------------------------------------------------

  private async generateEmbedding(text: string): Promise<number[]> {
    // Use OpenAI if configured
    if (this.enableOpenAI && process.env.OPENAI_API_KEY) {
      return this.generateOpenAIEmbedding(text);
    }
    return this.generateHashEmbedding(text);
  }

  private async generateOpenAIEmbedding(text: string): Promise<number[]> {
    try {
      const resp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({ input: text, model: "text-embedding-3-small" }),
      });

      if (!resp.ok) {
        throw new Error(`OpenAI embeddings API error: ${resp.status}`);
      }

      const json = (await resp.json()) as any;
      return json.data[0].embedding as number[];
    } catch (err) {
      Logger.warn("SemanticCache: OpenAI embedding failed, using hash fallback", err);
      return this.generateHashEmbedding(text);
    }
  }

  /**
   * Deterministic hash-based embedding (no external API).
   * Creates a stable EMBEDDING_DIM-dimensional unit vector from the text.
   */
  private generateHashEmbedding(text: string): number[] {
    const normalized = text.trim().toLowerCase();
    const seeds = Array.from({ length: EMBEDDING_DIM }, (_, i) => i);

    // Generate pseudo-random components using hashing with different seeds
    const components = seeds.map((seed) => {
      const hash = crypto
        .createHash("sha256")
        .update(`${seed}:${normalized}`)
        .digest();
      // Convert first 4 bytes to signed int
      const raw = hash.readInt32BE(0);
      return raw / 2_147_483_647; // normalise to [-1, 1]
    });

    // L2-normalise
    const magnitude = Math.sqrt(
      components.reduce((sum, v) => sum + v * v, 0)
    );
    return magnitude > 0 ? components.map((v) => v / magnitude) : components;
  }

  // -------------------------------------------------------------------------
  // Cosine similarity
  // -------------------------------------------------------------------------

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  // -------------------------------------------------------------------------
  // Key building
  // -------------------------------------------------------------------------

  private buildCacheKey(
    prompt: string,
    modelId: string,
    userId?: string
  ): string {
    const base = `${modelId}:${prompt}`;
    const hash = crypto
      .createHash("sha256")
      .update(userId ? `${userId}:${base}` : base)
      .digest("hex")
      .slice(0, 32);
    return hash;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const semanticCache = new SemanticCache({
  threshold: 0.95,
  l1Size: 500,
  defaultTTL: 3600,
});
