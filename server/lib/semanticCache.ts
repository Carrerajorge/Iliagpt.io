/**
 * Semantic Cache for LLM Responses
 * Uses embeddings for semantic similarity matching with LSH indexing.
 */
import { generateEmbedding, generateEmbeddingsBatch, cosineSimilarity } from "../embeddingService";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import * as crypto from "crypto";
import { cache } from "./cache";

const PERSISTENCE_PREFIX = "semantic_cache:";

const DEFAULT_SIMILARITY_THRESHOLD = 0.92;
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_MAX_ENTRIES = 10000;
const LSH_NUM_TABLES = 10;
const LSH_NUM_HASH_FUNCTIONS = 8;
const TEMPERATURE_TOLERANCE = 0.05;

export interface CacheEntry {
  id: string;
  query: string;
  queryEmbedding: number[];
  response: string;
  model: string;
  temperature: number;
  createdAt: Date;
  hitCount: number;
  lastAccessedAt: Date;
}

export interface CacheStats {
  cacheHitRate: number;
  avgSimilarityScore: number;
  entriesCount: number;
  evictedEntries: number;
  totalQueries: number;
  totalHits: number;
  totalMisses: number;
  lshBuckets: number;
  memoryEstimateBytes: number;
}

export interface SemanticCacheConfig {
  similarityThreshold?: number;
  ttlMs?: number;
  maxEntries?: number;
  lshNumTables?: number;
  lshNumHashFunctions?: number;
  temperatureTolerance?: number;
  enablePersistence?: boolean;
}

interface LSHBucket {
  entries: Set<string>;
}

interface LSHTable {
  buckets: Map<string, LSHBucket>;
  randomVectors: number[][];
}

class SemanticCache {
  private entries: Map<string, CacheEntry> = new Map();
  private lshTables: LSHTable[] = [];
  private config: Required<SemanticCacheConfig>;
  private stats = {
    totalQueries: 0,
    totalHits: 0,
    totalMisses: 0,
    evictedEntries: 0,
    totalSimilaritySum: 0,
    similarityMeasurements: 0,
  };
  private accessOrder: string[] = [];
  private embeddingDimension = 1536;
  private pendingEmbeddings: Map<string, Promise<number[]>> = new Map();

  constructor(config: SemanticCacheConfig = {}) {
    this.config = {
      similarityThreshold: config.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD,
      ttlMs: config.ttlMs ?? DEFAULT_TTL_MS,
      maxEntries: config.maxEntries ?? DEFAULT_MAX_ENTRIES,
      lshNumTables: config.lshNumTables ?? LSH_NUM_TABLES,
      lshNumHashFunctions: config.lshNumHashFunctions ?? LSH_NUM_HASH_FUNCTIONS,
      temperatureTolerance: config.temperatureTolerance ?? TEMPERATURE_TOLERANCE,
      enablePersistence: config.enablePersistence ?? false,
    };

    this.initializeLSH();
    this.startCleanupInterval();

    // Warmup from Redis asynchronously
    this.loadFromPersistence().catch(err => {
      console.error("[SemanticCache] Failed to load persistence:", err);
    });
  }

  private async loadFromPersistence(): Promise<void> {
    if (!this.config.enablePersistence) return;

    console.log("[SemanticCache] Loading from persistence...");
    const keys = await cache.scan(`${PERSISTENCE_PREFIX}*`);

    let loadedCount = 0;
    for (const key of keys) {
      const entry = await cache.get<CacheEntry>(key);
      if (entry) {
        // Hydrate dates properly
        entry.createdAt = new Date(entry.createdAt);
        entry.lastAccessedAt = new Date(entry.lastAccessedAt);

        if (!this.isExpired(entry)) {
          this.entries.set(entry.id, entry);
          this.indexEntry(entry);
          this.accessOrder.push(entry.id);
          loadedCount++;
        }
      }
    }

    if (loadedCount > 0) {
      console.log(`[SemanticCache] Hydrated ${loadedCount} entries from Redis`);
    }
  }

  private initializeLSH(): void {
    this.lshTables = [];
    for (let t = 0; t < this.config.lshNumTables; t++) {
      const randomVectors: number[][] = [];
      for (let h = 0; h < this.config.lshNumHashFunctions; h++) {
        randomVectors.push(this.generateRandomVector(this.embeddingDimension));
      }
      this.lshTables.push({
        buckets: new Map(),
        randomVectors,
      });
    }
  }

  private generateRandomVector(dimension: number): number[] {
    const vector = new Array(dimension);
    for (let i = 0; i < dimension; i++) {
      vector[i] = (Math.random() * 2 - 1);
    }
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return vector.map(v => v / magnitude);
  }

  private computeLSHHash(embedding: number[], table: LSHTable): string {
    const bits: number[] = [];
    for (const rv of table.randomVectors) {
      let dot = 0;
      for (let i = 0; i < embedding.length && i < rv.length; i++) {
        dot += embedding[i] * rv[i];
      }
      bits.push(dot >= 0 ? 1 : 0);
    }
    return bits.join("");
  }

  private indexEntry(entry: CacheEntry): void {
    for (const table of this.lshTables) {
      const hash = this.computeLSHHash(entry.queryEmbedding, table);
      let bucket = table.buckets.get(hash);
      if (!bucket) {
        bucket = { entries: new Set() };
        table.buckets.set(hash, bucket);
      }
      bucket.entries.add(entry.id);
    }
  }

  private removeFromIndex(entryId: string, embedding: number[]): void {
    for (const table of this.lshTables) {
      const hash = this.computeLSHHash(embedding, table);
      const bucket = table.buckets.get(hash);
      if (bucket) {
        bucket.entries.delete(entryId);
        if (bucket.entries.size === 0) {
          table.buckets.delete(hash);
        }
      }
    }
  }

  private findCandidates(queryEmbedding: number[]): Set<string> {
    const candidates = new Set<string>();
    for (const table of this.lshTables) {
      const hash = this.computeLSHHash(queryEmbedding, table);
      const bucket = table.buckets.get(hash);
      if (bucket) {
        Array.from(bucket.entries).forEach((entryId) => {
          candidates.add(entryId);
        });
      }
    }
    return candidates;
  }

  private generateEntryId(): string {
    return `sc_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
  }

  private async getOrGenerateEmbedding(query: string): Promise<number[]> {
    const cacheKey = crypto.createHash("md5").update(query).digest("hex");

    const pending = this.pendingEmbeddings.get(cacheKey);
    if (pending) {
      return pending;
    }

    const promise = generateEmbedding(query);
    this.pendingEmbeddings.set(cacheKey, promise);

    try {
      const result = await promise;
      return result;
    } finally {
      this.pendingEmbeddings.delete(cacheKey);
    }
  }

  private isTemperatureCompatible(entryTemp: number, queryTemp: number): boolean {
    return Math.abs(entryTemp - queryTemp) <= this.config.temperatureTolerance;
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.createdAt.getTime() > this.config.ttlMs;
  }

  private evictLRU(count: number = 1): void {
    for (let i = 0; i < count && this.accessOrder.length > 0; i++) {
      const oldestId = this.accessOrder.shift();
      if (oldestId) {
        const entry = this.entries.get(oldestId);
        if (entry) {
          this.removeFromIndex(oldestId, entry.queryEmbedding);
          this.entries.delete(oldestId);
          this.stats.evictedEntries++;

          if (this.config.enablePersistence) {
            cache.delete(`${PERSISTENCE_PREFIX}${oldestId}`).catch(console.error);
          }
        }
      }
    }
  }

  private updateAccessOrder(entryId: string): void {
    const idx = this.accessOrder.indexOf(entryId);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }
    this.accessOrder.push(entryId);
  }

  private cleanupExpired(): void {
    const now = Date.now();
    const toRemove: string[] = [];

    Array.from(this.entries.entries()).forEach(([id, entry]) => {
      if (now - entry.createdAt.getTime() > this.config.ttlMs) {
        toRemove.push(id);
      }
    });

    for (const id of toRemove) {
      const entry = this.entries.get(id);
      if (entry) {
        this.removeFromIndex(id, entry.queryEmbedding);
        this.entries.delete(id);

        if (this.config.enablePersistence) {
          cache.delete(`${PERSISTENCE_PREFIX}${id}`).catch(console.error);
        }

        const accessIdx = this.accessOrder.indexOf(id);
        if (accessIdx !== -1) {
          this.accessOrder.splice(accessIdx, 1);
        }
      }
    }

    if (toRemove.length > 0) {
      console.log(`[SemanticCache] Cleaned up ${toRemove.length} expired entries`);
    }
  }

  private startCleanupInterval(): void {
    setInterval(() => {
      this.cleanupExpired();
    }, 60000);
  }

  async get(
    query: string,
    model: string,
    temperature: number
  ): Promise<CacheEntry | null> {
    this.stats.totalQueries++;

    try {
      const queryEmbedding = await this.getOrGenerateEmbedding(query);

      const candidates = this.findCandidates(queryEmbedding);

      if (candidates.size === 0) {
        Array.from(this.entries.entries()).forEach(([id, entry]) => {
          if (!this.isExpired(entry) && entry.model === model) {
            candidates.add(id);
          }
        });
      }

      let bestMatch: CacheEntry | null = null;
      let bestSimilarity = 0;

      const candidateArray = Array.from(candidates);
      for (const candidateId of candidateArray) {
        const entry = this.entries.get(candidateId);
        if (!entry) continue;

        if (this.isExpired(entry)) {
          this.removeFromIndex(candidateId, entry.queryEmbedding);
          this.entries.delete(candidateId);
          continue;
        }

        if (entry.model !== model) continue;
        if (!this.isTemperatureCompatible(entry.temperature, temperature)) continue;

        const similarity = cosineSimilarity(queryEmbedding, entry.queryEmbedding);

        this.stats.totalSimilaritySum += similarity;
        this.stats.similarityMeasurements++;

        if (similarity >= this.config.similarityThreshold && similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestMatch = entry;
        }
      }

      if (bestMatch) {
        this.stats.totalHits++;
        bestMatch.hitCount++;
        bestMatch.lastAccessedAt = new Date();
        this.updateAccessOrder(bestMatch.id);

        console.log(
          `[SemanticCache] HIT: similarity=${bestSimilarity.toFixed(4)}, model=${model}, hitCount=${bestMatch.hitCount}`
        );

        return bestMatch;
      }

      this.stats.totalMisses++;
      return null;
    } catch (error: any) {
      console.error(`[SemanticCache] Error in get: ${error.message}`);
      this.stats.totalMisses++;
      return null;
    }
  }

  async set(
    query: string,
    response: string,
    model: string,
    temperature: number
  ): Promise<void> {
    try {
      if (this.entries.size >= this.config.maxEntries) {
        const toEvict = Math.max(1, Math.floor(this.config.maxEntries * 0.1));
        this.evictLRU(toEvict);
      }

      const queryEmbedding = await this.getOrGenerateEmbedding(query);

      const entry: CacheEntry = {
        id: this.generateEntryId(),
        query,
        queryEmbedding,
        response,
        model,
        temperature,
        createdAt: new Date(),
        hitCount: 0,
        lastAccessedAt: new Date(),
      };

      this.entries.set(entry.id, entry);
      this.indexEntry(entry);
      this.accessOrder.push(entry.id);

      console.log(
        `[SemanticCache] SET: query length=${query.length}, model=${model}, total entries=${this.entries.size}`
      );

      if (this.config.enablePersistence) {
        // Store in Redis with TTL matching config
        await cache.set(
          `${PERSISTENCE_PREFIX}${entry.id}`,
          entry,
          Math.floor(this.config.ttlMs / 1000)
        );
      }
    } catch (error: any) {
      console.error(`[SemanticCache] Error in set: ${error.message}`);
    }
  }

  async invalidate(query: string): Promise<boolean> {
    try {
      const queryEmbedding = await this.getOrGenerateEmbedding(query);
      const candidates = this.findCandidates(queryEmbedding);

      let invalidated = false;

      const candidateArray = Array.from(candidates);
      for (const candidateId of candidateArray) {
        const entry = this.entries.get(candidateId);
        if (!entry) continue;

        const similarity = cosineSimilarity(queryEmbedding, entry.queryEmbedding);

        if (similarity >= 0.98) {
          this.removeFromIndex(candidateId, entry.queryEmbedding);
          this.entries.delete(candidateId);
          const accessIdx = this.accessOrder.indexOf(candidateId);
          if (accessIdx !== -1) {
            this.accessOrder.splice(accessIdx, 1);
          }
          invalidated = true;
        }
      }

      return invalidated;
    } catch (error: any) {
      console.error(`[SemanticCache] Error in invalidate: ${error.message}`);
      return false;
    }
  }

  clear(): void {
    this.entries.clear();
    this.accessOrder = [];
    this.initializeLSH();
    this.stats = {
      totalQueries: 0,
      totalHits: 0,
      totalMisses: 0,
      evictedEntries: 0,
      totalSimilaritySum: 0,
      similarityMeasurements: 0,
    };
    console.log("[SemanticCache] Cache cleared");

    if (this.config.enablePersistence) {
      // Note: Efficient clearing of pattern in Redis is hard without Lua. 
      // For now allowing Redis TTL to expire them, or manual scan to delete.
      // Future improvement: use a SET in Redis to track all keys.
    }
  }

  getStats(): CacheStats {
    let lshBucketCount = 0;
    for (const table of this.lshTables) {
      lshBucketCount += table.buckets.size;
    }

    const avgSimilarity = this.stats.similarityMeasurements > 0
      ? this.stats.totalSimilaritySum / this.stats.similarityMeasurements
      : 0;

    const hitRate = this.stats.totalQueries > 0
      ? this.stats.totalHits / this.stats.totalQueries
      : 0;

    let memoryEstimate = 0;
    Array.from(this.entries.values()).forEach((entry) => {
      memoryEstimate += entry.query.length * 2;
      memoryEstimate += entry.response.length * 2;
      memoryEstimate += entry.queryEmbedding.length * 8;
      memoryEstimate += 200;
    });

    return {
      cacheHitRate: hitRate,
      avgSimilarityScore: avgSimilarity,
      entriesCount: this.entries.size,
      evictedEntries: this.stats.evictedEntries,
      totalQueries: this.stats.totalQueries,
      totalHits: this.stats.totalHits,
      totalMisses: this.stats.totalMisses,
      lshBuckets: lshBucketCount,
      memoryEstimateBytes: memoryEstimate,
    };
  }

  async batchSet(
    items: Array<{ query: string; response: string; model: string; temperature: number }>
  ): Promise<void> {
    if (items.length === 0) return;

    const queries = items.map(item => item.query);
    const embeddings = await generateEmbeddingsBatch(queries);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const embedding = embeddings[i];

      if (this.entries.size >= this.config.maxEntries) {
        this.evictLRU(1);
      }

      const entry: CacheEntry = {
        id: this.generateEntryId(),
        query: item.query,
        queryEmbedding: embedding,
        response: item.response,
        model: item.model,
        temperature: item.temperature,
        createdAt: new Date(),
        hitCount: 0,
        lastAccessedAt: new Date(),
      };

      this.entries.set(entry.id, entry);
      this.indexEntry(entry);
      this.accessOrder.push(entry.id);
    }

    console.log(`[SemanticCache] Batch SET: ${items.length} entries added`);
  }

  getConfig(): Required<SemanticCacheConfig> {
    return { ...this.config };
  }

  updateConfig(newConfig: Partial<SemanticCacheConfig>): void {
    if (newConfig.similarityThreshold !== undefined) {
      this.config.similarityThreshold = newConfig.similarityThreshold;
    }
    if (newConfig.ttlMs !== undefined) {
      this.config.ttlMs = newConfig.ttlMs;
    }
    if (newConfig.temperatureTolerance !== undefined) {
      this.config.temperatureTolerance = newConfig.temperatureTolerance;
    }
  }
}

let semanticCacheInstance: SemanticCache | null = null;

export function getSemanticCache(config?: SemanticCacheConfig): SemanticCache {
  if (!semanticCacheInstance) {
    // Enable persistence by default for P2
    const finalConfig = {
      ...config,
      enablePersistence: config?.enablePersistence ?? true
    };
    semanticCacheInstance = new SemanticCache(finalConfig);
    console.log("[SemanticCache] Instance created with config:", {
      similarityThreshold: finalConfig.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD,
      ttlMs: config?.ttlMs ?? DEFAULT_TTL_MS,
      maxEntries: config?.maxEntries ?? DEFAULT_MAX_ENTRIES,
    });
  }
  return semanticCacheInstance;
}

export function resetSemanticCache(): void {
  if (semanticCacheInstance) {
    semanticCacheInstance.clear();
  }
  semanticCacheInstance = null;
}

export interface SemanticCacheMiddlewareOptions {
  extractQuery?: (req: Request) => string | null;
  extractModel?: (req: Request) => string;
  extractTemperature?: (req: Request) => number;
  shouldCache?: (req: Request) => boolean;
  cacheConfig?: SemanticCacheConfig;
}

export function semanticCacheMiddleware(
  options: SemanticCacheMiddlewareOptions = {}
): RequestHandler {
  const {
    extractQuery = (req) => {
      const body = req.body;
      if (body?.messages && Array.isArray(body.messages)) {
        const lastUserMsg = body.messages.filter((m: any) => m.role === "user").pop();
        return typeof lastUserMsg?.content === "string" ? lastUserMsg.content : null;
      }
      return body?.query || body?.prompt || null;
    },
    extractModel = (req) => req.body?.model || "default",
    extractTemperature = (req) => req.body?.temperature ?? 0.7,
    shouldCache = (req) => req.method === "POST",
    cacheConfig,
  } = options;

  const cache = getSemanticCache(cacheConfig);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!shouldCache(req)) {
      return next();
    }

    const query = extractQuery(req);
    if (!query || query.length < 10) {
      return next();
    }

    const model = extractModel(req);
    const temperature = extractTemperature(req);

    try {
      const cached = await cache.get(query, model, temperature);

      if (cached) {
        res.setHeader("X-Semantic-Cache", "HIT");
        res.setHeader("X-Cache-Similarity", cached.hitCount.toString());
        res.json({
          content: cached.response,
          cached: true,
          cacheHitCount: cached.hitCount,
        });
        return;
      }

      const originalJson = res.json.bind(res);
      let responseCaptured = false;

      res.json = function (body: any): Response {
        if (!responseCaptured && body && (body.content || body.response || body.text)) {
          responseCaptured = true;
          const responseText = body.content || body.response || body.text;

          if (typeof responseText === "string" && responseText.length > 0) {
            cache.set(query, responseText, model, temperature).catch((err) => {
              console.error("[SemanticCache Middleware] Error caching response:", err.message);
            });
          }
        }

        res.setHeader("X-Semantic-Cache", "MISS");
        return originalJson(body);
      };

      next();
    } catch (error: any) {
      console.error("[SemanticCache Middleware] Error:", error.message);
      next();
    }
  };
}

export { SemanticCache };
