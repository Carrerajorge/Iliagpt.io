import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { Logger } from '../lib/logger';

export interface CacheEntry {
  key: string;
  queryHash: string;
  queryEmbedding: number[];
  response: string;
  modelId: string;
  strategy: string;
  createdAt: Date;
  lastAccessedAt: Date;
  accessCount: number;
  similarity?: number;
  expiresAt?: Date;
  userId?: string;
  size: number;
}

export interface PartialCacheEntry {
  originalKey: string;
  relevantSection: string;
  sectionScore: number;
  sourceEntry: CacheEntry;
}

export interface CacheConfig {
  maxEntries: number;
  maxSizeBytes: number;
  semanticThreshold: number;
  partialThreshold: number;
  ttlMs: number;
  enableSemanticCache: boolean;
  enablePartialCache: boolean;
  perUserIsolation: boolean;
}

export interface CacheStats {
  entries: number;
  totalSizeBytes: number;
  hitRate: number;
  semanticHitRate: number;
  partialHitRate: number;
  totalRequests: number;
  totalHits: number;
  semanticHits: number;
  partialHits: number;
  costSavedUsd: number;
  avgLatencySavedMs: number;
}

const DEFAULT_CONFIG: CacheConfig = {
  maxEntries: 1000,
  maxSizeBytes: 100_000_000,
  semanticThreshold: 0.95,
  partialThreshold: 0.7,
  ttlMs: 3_600_000,
  enableSemanticCache: true,
  enablePartialCache: true,
  perUserIsolation: false,
};

const ESTIMATED_LATENCY_SAVED_MS = 800;
const ESTIMATED_COST_PER_TOKEN_USD = 0.000002;
const AVG_TOKENS_PER_RESPONSE = 300;

export class SmartCache extends EventEmitter {
  private store: Map<string, CacheEntry> = new Map();
  private config: CacheConfig;
  private totalRequests = 0;
  private totalHits = 0;
  private semanticHits = 0;
  private partialHits = 0;
  private totalSizeBytes = 0;
  private costSavedUsd = 0;

  constructor(config?: Partial<CacheConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get(query: string, queryEmbedding: number[], userId?: string): CacheEntry | PartialCacheEntry | null {
    this.totalRequests++;

    const hash = this._computeHash(query);
    const exactKey = this._makeKey(hash, userId);

    // Exact key match
    const exactEntry = this.store.get(exactKey);
    if (exactEntry) {
      if (this._isExpired(exactEntry)) {
        this.store.delete(exactKey);
        this.totalSizeBytes -= exactEntry.size;
      } else {
        exactEntry.lastAccessedAt = new Date();
        exactEntry.accessCount++;
        this.totalHits++;
        this.costSavedUsd += AVG_TOKENS_PER_RESPONSE * ESTIMATED_COST_PER_TOKEN_USD;
        this.emit('cache:hit', { key: exactKey, type: 'exact' });
        Logger.debug('Cache exact hit', { key: exactKey });
        return { ...exactEntry };
      }
    }

    if (this.config.enableSemanticCache && queryEmbedding.length > 0) {
      // Semantic search
      let bestSemantic: CacheEntry | null = null;
      let bestSemanticSim = -1;

      for (const entry of this.store.values()) {
        if (this._isExpired(entry)) continue;
        if (this.config.perUserIsolation && entry.userId !== userId) continue;
        if (entry.queryEmbedding.length !== queryEmbedding.length) continue;

        const sim = this._cosineSimilarity(queryEmbedding, entry.queryEmbedding);
        if (sim > bestSemanticSim) {
          bestSemanticSim = sim;
          bestSemantic = entry;
        }
      }

      if (bestSemantic !== null && bestSemanticSim >= this.config.semanticThreshold) {
        bestSemantic.lastAccessedAt = new Date();
        bestSemantic.accessCount++;
        this.totalHits++;
        this.semanticHits++;
        this.costSavedUsd += AVG_TOKENS_PER_RESPONSE * ESTIMATED_COST_PER_TOKEN_USD;
        this.emit('cache:hit', { key: bestSemantic.key, type: 'semantic', similarity: bestSemanticSim });
        Logger.debug('Cache semantic hit', { similarity: bestSemanticSim });
        return { ...bestSemantic, similarity: bestSemanticSim };
      }

      // Partial match
      if (this.config.enablePartialCache) {
        let bestPartial: CacheEntry | null = null;
        let bestPartialSim = -1;

        for (const entry of this.store.values()) {
          if (this._isExpired(entry)) continue;
          if (this.config.perUserIsolation && entry.userId !== userId) continue;
          if (entry.queryEmbedding.length !== queryEmbedding.length) continue;

          const sim = this._cosineSimilarity(queryEmbedding, entry.queryEmbedding);
          if (sim >= this.config.partialThreshold && sim > bestPartialSim) {
            bestPartialSim = sim;
            bestPartial = entry;
          }
        }

        if (bestPartial !== null) {
          bestPartial.lastAccessedAt = new Date();
          bestPartial.accessCount++;
          this.totalHits++;
          this.partialHits++;
          this.costSavedUsd += (AVG_TOKENS_PER_RESPONSE / 2) * ESTIMATED_COST_PER_TOKEN_USD;

          const section = this._extractRelevantSection(bestPartial.response, queryEmbedding, bestPartial.queryEmbedding);
          const partial: PartialCacheEntry = {
            originalKey: bestPartial.key,
            relevantSection: section,
            sectionScore: bestPartialSim,
            sourceEntry: { ...bestPartial },
          };
          this.emit('cache:hit', { key: bestPartial.key, type: 'partial', similarity: bestPartialSim });
          Logger.debug('Cache partial hit', { similarity: bestPartialSim });
          return partial;
        }
      }
    }

    this.emit('cache:miss', { query: query.slice(0, 50) });
    return null;
  }

  set(
    query: string,
    queryEmbedding: number[],
    response: string,
    modelId: string,
    strategy: string,
    userId?: string,
    ttlMs?: number,
  ): CacheEntry {
    const hash = this._computeHash(query);
    const key = this._makeKey(hash, userId);
    const size = Buffer.byteLength(response, 'utf8');
    const effectiveTtl = ttlMs ?? this.config.ttlMs;

    const entry: CacheEntry = {
      key,
      queryHash: hash,
      queryEmbedding,
      response,
      modelId,
      strategy,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      accessCount: 0,
      userId,
      size,
      expiresAt: effectiveTtl > 0 ? new Date(Date.now() + effectiveTtl) : undefined,
    };

    // Evict if needed before adding
    if (
      this.store.size >= this.config.maxEntries ||
      this.totalSizeBytes + size > this.config.maxSizeBytes
    ) {
      this._evictLRU(size);
    }

    this.store.set(key, entry);
    this.totalSizeBytes += size;

    this.emit('cache:set', { key, modelId, size });
    Logger.debug('Cache entry set', { key, size, modelId });
    return { ...entry };
  }

  invalidate(pattern: string | RegExp): number {
    let removed = 0;
    const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

    for (const [key, entry] of this.store.entries()) {
      if (re.test(key)) {
        this.totalSizeBytes -= entry.size;
        this.store.delete(key);
        removed++;
      }
    }

    this.emit('cache:invalidated', { pattern: String(pattern), removed });
    Logger.info('Cache invalidated by pattern', { pattern: String(pattern), removed });
    return removed;
  }

  invalidateUser(userId: string): number {
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (entry.userId === userId) {
        this.totalSizeBytes -= entry.size;
        this.store.delete(key);
        removed++;
      }
    }
    this.emit('cache:invalidated', { userId, removed });
    Logger.info('Cache invalidated for user', { userId, removed });
    return removed;
  }

  invalidateModel(modelId: string): number {
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (entry.modelId === modelId) {
        this.totalSizeBytes -= entry.size;
        this.store.delete(key);
        removed++;
      }
    }
    this.emit('cache:invalidated', { modelId, removed });
    Logger.info('Cache invalidated for model', { modelId, removed });
    return removed;
  }

  warm(queries: Array<{
    query: string;
    embedding: number[];
    response: string;
    modelId: string;
    strategy: string;
  }>): void {
    for (const q of queries) {
      this.set(q.query, q.embedding, q.response, q.modelId, q.strategy);
    }
    Logger.info('Cache warmed', { count: queries.length });
  }

  private _computeHash(query: string): string {
    return createHash('sha256').update(query).digest('hex');
  }

  private _makeKey(hash: string, userId?: string): string {
    if (this.config.perUserIsolation && userId) {
      return `${userId}:${hash}`;
    }
    return hash;
  }

  private _cosineSimilarity(a: number[], b: number[]): number {
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
    return denom === 0 ? 0 : dot / denom;
  }

  private _extractRelevantSection(
    response: string,
    queryEmbedding: number[],
    entryEmbedding: number[],
  ): string {
    const paragraphs = response.split(/\n{2,}/);
    if (paragraphs.length <= 1) return response;

    // Score paragraphs by their relative position and basic keyword density
    // We approximate keyword relevance by using a pseudo-IDF weighting based on length
    const scored = paragraphs.map((para, idx) => {
      const words = para.toLowerCase().split(/\W+/).filter(Boolean);
      const uniqueWords = new Set(words);

      // Boost for paragraphs that are longer and information-dense
      const densityScore = uniqueWords.size / Math.max(1, words.length);
      // Slight positional bias toward earlier paragraphs
      const positionScore = 1 - (idx / paragraphs.length) * 0.2;
      // Cosine alignment as a proxy for relevance — use a lightweight proxy:
      // compare the ratio of the entry embedding magnitude to determine if the query is aligned
      const embeddingBoost = this._cosineSimilarity(queryEmbedding, entryEmbedding) * 0.5;

      return { para, score: densityScore * positionScore + embeddingBoost };
    });

    scored.sort((a, b) => b.score - a.score);
    const half = Math.max(1, Math.ceil(paragraphs.length / 2));
    return scored.slice(0, half).map(s => s.para).join('\n\n');
  }

  private _evictLRU(neededBytes = 0): void {
    const entries = Array.from(this.store.entries())
      .sort((a, b) => a[1].lastAccessedAt.getTime() - b[1].lastAccessedAt.getTime());

    let freedBytes = 0;
    let evicted = 0;

    for (const [key, entry] of entries) {
      if (
        this.store.size < this.config.maxEntries &&
        this.totalSizeBytes - freedBytes + neededBytes <= this.config.maxSizeBytes
      ) {
        break;
      }
      this.store.delete(key);
      freedBytes += entry.size;
      evicted++;
      this.emit('cache:evicted', { key, size: entry.size });
    }

    this.totalSizeBytes -= freedBytes;
    if (evicted > 0) {
      Logger.debug('Cache LRU eviction', { evicted, freedBytes });
    }
  }

  private _isExpired(entry: CacheEntry): boolean {
    if (!entry.expiresAt) return false;
    return Date.now() > entry.expiresAt.getTime();
  }

  getStats(): CacheStats {
    return {
      entries: this.store.size,
      totalSizeBytes: this.totalSizeBytes,
      hitRate: this.totalRequests > 0 ? this.totalHits / this.totalRequests : 0,
      semanticHitRate: this.totalRequests > 0 ? this.semanticHits / this.totalRequests : 0,
      partialHitRate: this.totalRequests > 0 ? this.partialHits / this.totalRequests : 0,
      totalRequests: this.totalRequests,
      totalHits: this.totalHits,
      semanticHits: this.semanticHits,
      partialHits: this.partialHits,
      costSavedUsd: this.costSavedUsd,
      avgLatencySavedMs: this.totalHits > 0 ? ESTIMATED_LATENCY_SAVED_MS : 0,
    };
  }

  getTopEntries(limit = 20): CacheEntry[] {
    return Array.from(this.store.values())
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, limit)
      .map(e => ({ ...e }));
  }

  clear(): void {
    this.store.clear();
    this.totalSizeBytes = 0;
    Logger.info('SmartCache cleared');
  }

  exportEntries(): CacheEntry[] {
    return Array.from(this.store.values()).map(e => ({ ...e }));
  }

  importEntries(entries: CacheEntry[]): void {
    for (const entry of entries) {
      if (this._isExpired(entry)) continue;
      this.store.set(entry.key, { ...entry });
      this.totalSizeBytes += entry.size;
    }

    if (
      this.store.size > this.config.maxEntries ||
      this.totalSizeBytes > this.config.maxSizeBytes
    ) {
      this._evictLRU();
    }

    Logger.info('Cache entries imported', { count: entries.length });
  }
}
