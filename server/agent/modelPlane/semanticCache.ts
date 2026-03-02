import { EventEmitter } from "events";

export interface CacheEntry {
  key: string;
  prompt: string;
  response: string;
  modelId: string;
  embedding: number[];
  createdAt: number;
  ttlMs: number;
  hitCount: number;
  lastAccessedAt: number;
  costUsd: number;
  latencyMs: number;
  metadata: Record<string, any>;
}

export interface CacheStats {
  totalEntries: number;
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  totalCostSaved: number;
  totalApiCallsAvoided: number;
  avgLatencySavedMs: number;
  entriesByModel: Record<string, number>;
  memoryUsageEstimate: number;
}

export interface CacheLookupResult {
  hit: boolean;
  entry: CacheEntry | null;
  similarity: number;
  matchType: "exact" | "fuzzy" | "none";
}

export interface SemanticCacheConfig {
  maxSize: number;
  defaultTtlMs: number;
  similarityThreshold: number;
  exactMatchOnly: boolean;
  enableTelemetry: boolean;
  evictionPolicy: "lru" | "lfu" | "ttl";
}

function simpleTokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function buildEmbedding(text: string): number[] {
  const tokens = simpleTokenize(text);
  const dim = 64;
  const vec = new Array(dim).fill(0);

  for (const token of tokens) {
    for (let i = 0; i < token.length; i++) {
      const code = token.charCodeAt(i);
      const idx = (code * 31 + i * 7) % dim;
      vec[idx] += 1.0 / tokens.length;
      const idx2 = (code * 17 + i * 13) % dim;
      vec[idx2] += 0.5 / tokens.length;
    }
  }

  const magnitude = Math.sqrt(vec.reduce((sum: number, v: number) => sum + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < dim; i++) {
      vec[i] /= magnitude;
    }
  }

  return vec;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

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

export class SemanticCache extends EventEmitter {
  private entries: Map<string, CacheEntry> = new Map();
  private modelIndex: Map<string, Set<string>> = new Map();
  private config: SemanticCacheConfig;
  private stats: CacheStats;
  private evictionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<SemanticCacheConfig>) {
    super();
    this.config = {
      maxSize: config?.maxSize ?? 1000,
      defaultTtlMs: config?.defaultTtlMs ?? 3600_000,
      similarityThreshold: config?.similarityThreshold ?? 0.85,
      exactMatchOnly: config?.exactMatchOnly ?? false,
      enableTelemetry: config?.enableTelemetry ?? true,
      evictionPolicy: config?.evictionPolicy ?? "lru",
    };

    this.stats = {
      totalEntries: 0,
      totalHits: 0,
      totalMisses: 0,
      hitRate: 0,
      totalCostSaved: 0,
      totalApiCallsAvoided: 0,
      avgLatencySavedMs: 0,
      entriesByModel: {},
      memoryUsageEstimate: 0,
    };

    this.evictionTimer = setInterval(() => this.backgroundEvict(), 60_000);
  }

  private backgroundEvict(): void {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.entries) {
      if (now - entry.createdAt > entry.ttlMs) {
        this.removeEntry(key, entry);
        evicted++;
      }
    }

    while (this.entries.size > this.config.maxSize) {
      this.evict();
      evicted++;
    }

    if (evicted > 0 && this.config.enableTelemetry) {
      this.emit("cache:background_evict", { evicted, remaining: this.entries.size });
    }
  }

  destroy(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
  }

  lookup(prompt: string, modelId?: string): CacheLookupResult {
    const now = Date.now();
    const normalizedPrompt = prompt.trim().toLowerCase();

    for (const entry of this.entries.values()) {
      if (modelId && entry.modelId !== modelId) continue;
      if (now - entry.createdAt > entry.ttlMs) continue;

      if (entry.prompt.trim().toLowerCase() === normalizedPrompt) {
        entry.hitCount++;
        entry.lastAccessedAt = now;
        this.recordHit(entry);
        return { hit: true, entry, similarity: 1.0, matchType: "exact" };
      }
    }

    if (this.config.exactMatchOnly) {
      this.recordMiss();
      return { hit: false, entry: null, similarity: 0, matchType: "none" };
    }

    const queryEmbedding = buildEmbedding(prompt);
    let bestEntry: CacheEntry | null = null;
    let bestSimilarity = 0;

    const candidateKeys = modelId
      ? this.modelIndex.get(modelId) || new Set()
      : new Set(this.entries.keys());

    for (const key of candidateKeys) {
      const entry = this.entries.get(key);
      if (!entry) continue;
      if (now - entry.createdAt > entry.ttlMs) continue;

      const similarity = cosineSimilarity(queryEmbedding, entry.embedding);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestEntry = entry;
      }
    }

    if (bestEntry && bestSimilarity >= this.config.similarityThreshold) {
      bestEntry.hitCount++;
      bestEntry.lastAccessedAt = now;
      this.recordHit(bestEntry);
      return { hit: true, entry: bestEntry, similarity: bestSimilarity, matchType: "fuzzy" };
    }

    this.recordMiss();
    return { hit: false, entry: null, similarity: bestSimilarity, matchType: "none" };
  }

  put(
    prompt: string,
    response: string,
    modelId: string,
    options?: {
      costUsd?: number;
      latencyMs?: number;
      ttlMs?: number;
      metadata?: Record<string, any>;
    }
  ): CacheEntry {
    if (this.entries.size >= this.config.maxSize) {
      this.evict();
    }

    const key = `cache_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const entry: CacheEntry = {
      key,
      prompt,
      response,
      modelId,
      embedding: buildEmbedding(prompt),
      createdAt: now,
      ttlMs: options?.ttlMs ?? this.config.defaultTtlMs,
      hitCount: 0,
      lastAccessedAt: now,
      costUsd: options?.costUsd ?? 0,
      latencyMs: options?.latencyMs ?? 0,
      metadata: options?.metadata ?? {},
    };

    this.entries.set(key, entry);

    if (!this.modelIndex.has(modelId)) {
      this.modelIndex.set(modelId, new Set());
    }
    this.modelIndex.get(modelId)!.add(key);

    this.stats.totalEntries = this.entries.size;
    this.stats.entriesByModel[modelId] = (this.stats.entriesByModel[modelId] || 0) + 1;
    this.updateMemoryEstimate();

    if (this.config.enableTelemetry) {
      this.emit("cache:put", { key, modelId, promptLength: prompt.length });
    }

    return entry;
  }

  private evict(): void {
    if (this.entries.size === 0) return;

    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.createdAt > entry.ttlMs) {
        this.removeEntry(key, entry);
        return;
      }
    }

    let victimKey: string | null = null;
    let victimEntry: CacheEntry | null = null;

    switch (this.config.evictionPolicy) {
      case "lru": {
        let oldestAccess = Infinity;
        for (const [key, entry] of this.entries) {
          if (entry.lastAccessedAt < oldestAccess) {
            oldestAccess = entry.lastAccessedAt;
            victimKey = key;
            victimEntry = entry;
          }
        }
        break;
      }
      case "lfu": {
        let lowestHits = Infinity;
        for (const [key, entry] of this.entries) {
          if (entry.hitCount < lowestHits) {
            lowestHits = entry.hitCount;
            victimKey = key;
            victimEntry = entry;
          }
        }
        break;
      }
      case "ttl": {
        let earliestExpiry = Infinity;
        for (const [key, entry] of this.entries) {
          const expiry = entry.createdAt + entry.ttlMs;
          if (expiry < earliestExpiry) {
            earliestExpiry = expiry;
            victimKey = key;
            victimEntry = entry;
          }
        }
        break;
      }
    }

    if (victimKey && victimEntry) {
      this.removeEntry(victimKey, victimEntry);
    }
  }

  private removeEntry(key: string, entry: CacheEntry): void {
    this.entries.delete(key);
    const modelSet = this.modelIndex.get(entry.modelId);
    if (modelSet) {
      modelSet.delete(key);
      if (modelSet.size === 0) this.modelIndex.delete(entry.modelId);
    }
    this.stats.totalEntries = this.entries.size;
    if (this.stats.entriesByModel[entry.modelId]) {
      this.stats.entriesByModel[entry.modelId]--;
      if (this.stats.entriesByModel[entry.modelId] <= 0) {
        delete this.stats.entriesByModel[entry.modelId];
      }
    }
    this.updateMemoryEstimate();

    if (this.config.enableTelemetry) {
      this.emit("cache:evict", { key, modelId: entry.modelId, reason: "capacity" });
    }
  }

  private recordHit(entry: CacheEntry): void {
    this.stats.totalHits++;
    this.stats.totalApiCallsAvoided++;
    this.stats.totalCostSaved += entry.costUsd;

    const totalSaved = this.stats.avgLatencySavedMs * (this.stats.totalHits - 1) + entry.latencyMs;
    this.stats.avgLatencySavedMs = Math.round(totalSaved / this.stats.totalHits);

    this.updateHitRate();

    if (this.config.enableTelemetry) {
      this.emit("cache:hit", {
        key: entry.key,
        modelId: entry.modelId,
        costSaved: entry.costUsd,
        latencySaved: entry.latencyMs,
      });
    }
  }

  private recordMiss(): void {
    this.stats.totalMisses++;
    this.updateHitRate();

    if (this.config.enableTelemetry) {
      this.emit("cache:miss", {});
    }
  }

  private updateHitRate(): void {
    const total = this.stats.totalHits + this.stats.totalMisses;
    this.stats.hitRate = total > 0 ? Math.round((this.stats.totalHits / total) * 1000) / 1000 : 0;
  }

  private updateMemoryEstimate(): void {
    let estimate = 0;
    for (const entry of this.entries.values()) {
      estimate += entry.prompt.length * 2;
      estimate += entry.response.length * 2;
      estimate += entry.embedding.length * 8;
      estimate += 256;
    }
    this.stats.memoryUsageEstimate = estimate;
  }

  invalidateByModel(modelId: string): number {
    const modelSet = this.modelIndex.get(modelId);
    if (!modelSet) return 0;

    const keys = Array.from(modelSet);
    for (const key of keys) {
      this.entries.delete(key);
    }
    this.modelIndex.delete(modelId);

    const removed = keys.length;
    this.stats.totalEntries = this.entries.size;
    delete this.stats.entriesByModel[modelId];
    this.updateMemoryEstimate();

    if (this.config.enableTelemetry) {
      this.emit("cache:invalidate", { modelId, entriesRemoved: removed });
    }

    return removed;
  }

  invalidateByPattern(pattern: string): number {
    const regex = new RegExp(pattern, "i");
    let removed = 0;

    for (const [key, entry] of this.entries) {
      if (regex.test(entry.prompt)) {
        this.removeEntry(key, entry);
        removed++;
      }
    }

    return removed;
  }

  invalidateByAge(maxAgeMs: number): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.entries) {
      if (now - entry.createdAt > maxAgeMs) {
        this.removeEntry(key, entry);
        removed++;
      }
    }

    return removed;
  }

  invalidateAll(): void {
    this.entries.clear();
    this.modelIndex.clear();
    this.stats.totalEntries = 0;
    this.stats.entriesByModel = {};
    this.stats.memoryUsageEstimate = 0;

    if (this.config.enableTelemetry) {
      this.emit("cache:invalidate_all", {});
    }
  }

  getStats(): CacheStats {
    return { ...this.stats, entriesByModel: { ...this.stats.entriesByModel } };
  }

  getCostSavings(): {
    totalCostSaved: number;
    totalApiCallsAvoided: number;
    avgLatencySavedMs: number;
    estimatedMonthlySavings: number;
  } {
    const uptimeMs = Math.max(1, Date.now() - (this.getOldestEntryTime() || Date.now()));
    const savingsPerMs = this.stats.totalCostSaved / uptimeMs;
    const msPerMonth = 30 * 24 * 60 * 60 * 1000;

    return {
      totalCostSaved: Math.round(this.stats.totalCostSaved * 10000) / 10000,
      totalApiCallsAvoided: this.stats.totalApiCallsAvoided,
      avgLatencySavedMs: this.stats.avgLatencySavedMs,
      estimatedMonthlySavings: Math.round(savingsPerMs * msPerMonth * 100) / 100,
    };
  }

  private getOldestEntryTime(): number | null {
    let oldest: number | null = null;
    for (const entry of this.entries.values()) {
      if (oldest === null || entry.createdAt < oldest) {
        oldest = entry.createdAt;
      }
    }
    return oldest;
  }

  getEntry(key: string): CacheEntry | undefined {
    return this.entries.get(key);
  }

  listEntries(modelId?: string, limit = 50): CacheEntry[] {
    let entries = Array.from(this.entries.values());
    if (modelId) {
      entries = entries.filter((e) => e.modelId === modelId);
    }
    return entries
      .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
      .slice(0, limit);
  }

  getConfig(): SemanticCacheConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<SemanticCacheConfig>): void {
    Object.assign(this.config, updates);
  }
}

export const semanticCache = new SemanticCache();
