import { createHash } from "crypto";
import { z } from "zod";

export const CacheEntrySchema = z.object({
  url: z.string(),
  urlHash: z.string(),
  queryHash: z.string().optional(),
  tenantId: z.string().optional(),
  content: z.string(),
  title: z.string().optional(),
  etag: z.string().optional(),
  lastModified: z.string().optional(),
  contentType: z.string().optional(),
  fetchMethod: z.enum(["fetch", "browser"]),
  cachedAt: z.number(),
  expiresAt: z.number(),
  hitCount: z.number().default(0),
  lastAccessedAt: z.number(),
  ttlMs: z.number(),
});

export type CacheEntry = z.infer<typeof CacheEntrySchema>;

export interface CacheOptions {
  maxEntries: number;
  defaultTtlMs: number;
  fetchTtlMs: number;
  browserTtlMs: number;
  cleanupIntervalMs: number;
  maxMemoryMb: number;
  maxContentSizeBytes: number;
}

export interface CacheStats {
  entries: number;
  hits: number;
  misses: number;
  hitRate: number;
  memoryUsageMb: number;
  oldestEntryAge: number;
}

export interface TenantCacheStats extends CacheStats {
  tenantId: string;
}

const DEFAULT_CACHE_OPTIONS: CacheOptions = {
  maxEntries: 500,
  defaultTtlMs: 5 * 60 * 1000,
  fetchTtlMs: 10 * 60 * 1000,
  browserTtlMs: 5 * 60 * 1000,
  cleanupIntervalMs: 60 * 1000,
  maxMemoryMb: 50,
  maxContentSizeBytes: 1024 * 1024,
};

export class ResponseCache {
  private cache: Map<string, CacheEntry> = new Map();
  private queryIndex: Map<string, Set<string>> = new Map();
  private tenantIndex: Map<string, Set<string>> = new Map();
  private options: CacheOptions;
  private hits = 0;
  private misses = 0;
  private tenantHits: Map<string, number> = new Map();
  private tenantMisses: Map<string, number> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private currentMemoryBytes = 0;

  constructor(options: Partial<CacheOptions> = {}) {
    this.options = { ...DEFAULT_CACHE_OPTIONS, ...options };
    this.startCleanup();
  }

  private estimateEntrySize(entry: CacheEntry): number {
    return entry.content.length + (entry.title?.length || 0) + entry.url.length + 200;
  }

  private startCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.cleanupTimer = setInterval(() => this.cleanup(), this.options.cleanupIntervalMs);
  }

  static hashUrl(url: string): string {
    return createHash("sha256").update(url.toLowerCase()).digest("hex").slice(0, 16);
  }

  static hashQuery(query: string): string {
    const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();
    return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  }

  /**
   * Hash tenant ID for safe logging and key generation.
   * PII REDACTION: Tenant IDs may contain user identifiers - always hash before logging.
   */
  static hashTenantId(tenantId: string): string {
    return createHash("sha256").update(tenantId).digest("hex").slice(0, 12);
  }

  /**
   * Generate cache key with optional tenant namespace.
   * If tenantId is provided, prefix with "t:{hashedTenantId}:" for isolation.
   */
  private getCacheKey(urlHash: string, tenantId?: string): string {
    if (tenantId) {
      return `t:${ResponseCache.hashTenantId(tenantId)}:${urlHash}`;
    }
    return urlHash;
  }

  get(urlOrHash: string, queryHash?: string, tenantId?: string): CacheEntry | null {
    const urlHash = urlOrHash.length === 16 ? urlOrHash : ResponseCache.hashUrl(urlOrHash);
    const cacheKey = this.getCacheKey(urlHash, tenantId);
    const entry = this.cache.get(cacheKey);
    
    if (!entry) {
      this.misses++;
      if (tenantId) {
        this.tenantMisses.set(tenantId, (this.tenantMisses.get(tenantId) || 0) + 1);
      }
      return null;
    }
    
    if (Date.now() > entry.expiresAt) {
      this.currentMemoryBytes -= this.estimateEntrySize(entry);
      this.cache.delete(cacheKey);
      this.removeFromQueryIndex(cacheKey, entry.queryHash);
      this.removeFromTenantIndex(cacheKey, entry.tenantId);
      this.misses++;
      if (tenantId) {
        this.tenantMisses.set(tenantId, (this.tenantMisses.get(tenantId) || 0) + 1);
      }
      return null;
    }
    
    entry.hitCount++;
    entry.lastAccessedAt = Date.now();
    this.hits++;
    if (tenantId) {
      this.tenantHits.set(tenantId, (this.tenantHits.get(tenantId) || 0) + 1);
    }
    
    return entry;
  }

  set(
    url: string,
    content: string,
    options: {
      title?: string;
      etag?: string;
      lastModified?: string;
      contentType?: string;
      fetchMethod: "fetch" | "browser";
      queryHash?: string;
      ttlMs?: number;
      tenantId?: string;
    }
  ): boolean {
    if (content.length > this.options.maxContentSizeBytes) {
      // PII REDACTION: Log content size only, not URL or tenant details
      console.warn(`[ResponseCache] Content too large for caching: ${content.length} bytes (max: ${this.options.maxContentSizeBytes})`);
      return false;
    }
    
    const urlHash = ResponseCache.hashUrl(url);
    const cacheKey = this.getCacheKey(urlHash, options.tenantId);
    const now = Date.now();
    
    const ttlMs = options.ttlMs || 
      (options.fetchMethod === "fetch" ? this.options.fetchTtlMs : this.options.browserTtlMs);
    
    const entry: CacheEntry = {
      url,
      urlHash,
      queryHash: options.queryHash,
      tenantId: options.tenantId,
      content,
      title: options.title,
      etag: options.etag,
      lastModified: options.lastModified,
      contentType: options.contentType,
      fetchMethod: options.fetchMethod,
      cachedAt: now,
      expiresAt: now + ttlMs,
      hitCount: 0,
      lastAccessedAt: now,
      ttlMs,
    };
    
    const entrySize = this.estimateEntrySize(entry);
    const maxBytes = this.options.maxMemoryMb * 1024 * 1024;
    
    const existingEntry = this.cache.get(cacheKey);
    if (existingEntry) {
      this.currentMemoryBytes -= this.estimateEntrySize(existingEntry);
      this.removeFromTenantIndex(cacheKey, existingEntry.tenantId);
    }
    
    while (this.currentMemoryBytes + entrySize > maxBytes && this.cache.size > 0) {
      this.evictOldest();
    }
    
    if (this.cache.size >= this.options.maxEntries) {
      this.evictOldest();
    }
    
    this.cache.set(cacheKey, entry);
    this.currentMemoryBytes += entrySize;
    
    if (options.queryHash) {
      this.addToQueryIndex(cacheKey, options.queryHash);
    }
    
    if (options.tenantId) {
      this.addToTenantIndex(cacheKey, options.tenantId);
    }
    
    return true;
  }

  getConditionalHeaders(url: string, tenantId?: string): Record<string, string> | null {
    const cacheKey = this.getCacheKey(ResponseCache.hashUrl(url), tenantId);
    const entry = this.cache.get(cacheKey);
    if (!entry) {
      return null;
    }
    
    const headers: Record<string, string> = {};
    if (entry.etag) {
      headers["If-None-Match"] = entry.etag;
    }
    if (entry.lastModified) {
      headers["If-Modified-Since"] = entry.lastModified;
    }
    
    return Object.keys(headers).length > 0 ? headers : null;
  }

  handleNotModified(url: string, newTtlMs?: number, tenantId?: string): CacheEntry | null {
    const cacheKey = this.getCacheKey(ResponseCache.hashUrl(url), tenantId);
    const entry = this.cache.get(cacheKey);
    
    if (!entry) {
      return null;
    }
    
    const ttlMs = newTtlMs || entry.ttlMs;
    entry.expiresAt = Date.now() + ttlMs;
    entry.lastAccessedAt = Date.now();
    entry.hitCount++;
    this.hits++;
    if (tenantId) {
      this.tenantHits.set(tenantId, (this.tenantHits.get(tenantId) || 0) + 1);
    }
    
    return entry;
  }

  getByQuery(queryHash: string, tenantId?: string): CacheEntry[] {
    const cacheKeys = this.queryIndex.get(queryHash);
    if (!cacheKeys) {
      return [];
    }
    
    const entries: CacheEntry[] = [];
    for (const cacheKey of cacheKeys) {
      const entry = this.cache.get(cacheKey);
      if (entry && (!tenantId || entry.tenantId === tenantId)) {
        if (Date.now() <= entry.expiresAt) {
          entry.hitCount++;
          entry.lastAccessedAt = Date.now();
          this.hits++;
          if (tenantId) {
            this.tenantHits.set(tenantId, (this.tenantHits.get(tenantId) || 0) + 1);
          }
          entries.push(entry);
        }
      }
    }
    
    return entries;
  }

  prefetch(urls: string[], queryHash?: string): void {
  }

  invalidate(url: string, tenantId?: string): boolean {
    const cacheKey = this.getCacheKey(ResponseCache.hashUrl(url), tenantId);
    const entry = this.cache.get(cacheKey);
    
    if (entry) {
      this.currentMemoryBytes -= this.estimateEntrySize(entry);
      this.removeFromQueryIndex(cacheKey, entry.queryHash);
      this.removeFromTenantIndex(cacheKey, entry.tenantId);
      this.cache.delete(cacheKey);
      return true;
    }
    
    return false;
  }

  invalidateByQuery(queryHash: string): number {
    const cacheKeys = this.queryIndex.get(queryHash);
    if (!cacheKeys) {
      return 0;
    }
    
    let count = 0;
    for (const cacheKey of cacheKeys) {
      const entry = this.cache.get(cacheKey);
      if (entry) {
        this.currentMemoryBytes -= this.estimateEntrySize(entry);
        this.removeFromTenantIndex(cacheKey, entry.tenantId);
      }
      if (this.cache.delete(cacheKey)) {
        count++;
      }
    }
    
    this.queryIndex.delete(queryHash);
    return count;
  }

  /**
   * Invalidate all cache entries for a specific tenant.
   * PII REDACTION: Tenant ID is hashed internally - no raw PII in logs.
   */
  invalidateByTenant(tenantId: string): number {
    const cacheKeys = this.tenantIndex.get(tenantId);
    if (!cacheKeys) {
      return 0;
    }
    
    let count = 0;
    for (const cacheKey of cacheKeys) {
      const entry = this.cache.get(cacheKey);
      if (entry) {
        this.currentMemoryBytes -= this.estimateEntrySize(entry);
        this.removeFromQueryIndex(cacheKey, entry.queryHash);
      }
      if (this.cache.delete(cacheKey)) {
        count++;
      }
    }
    
    this.tenantIndex.delete(tenantId);
    this.tenantHits.delete(tenantId);
    this.tenantMisses.delete(tenantId);
    return count;
  }

  clear(): void {
    this.cache.clear();
    this.queryIndex.clear();
    this.tenantIndex.clear();
    this.tenantHits.clear();
    this.tenantMisses.clear();
    this.hits = 0;
    this.misses = 0;
    this.currentMemoryBytes = 0;
  }

  getStats(): CacheStats {
    const entries = this.cache.size;
    const totalRequests = this.hits + this.misses;
    
    let oldestAge = 0;
    let totalSize = 0;
    
    for (const entry of this.cache.values()) {
      const age = Date.now() - entry.cachedAt;
      if (age > oldestAge) {
        oldestAge = age;
      }
      totalSize += entry.content.length + (entry.title?.length || 0);
    }
    
    return {
      entries,
      hits: this.hits,
      misses: this.misses,
      hitRate: totalRequests > 0 ? this.hits / totalRequests : 0,
      memoryUsageMb: totalSize / (1024 * 1024),
      oldestEntryAge: oldestAge,
    };
  }

  /**
   * Get cache statistics for a specific tenant.
   * PII REDACTION: Returns stats with hashed tenant identifier for safe logging.
   */
  getStatsByTenant(tenantId: string): TenantCacheStats {
    const cacheKeys = this.tenantIndex.get(tenantId) || new Set<string>();
    const hits = this.tenantHits.get(tenantId) || 0;
    const misses = this.tenantMisses.get(tenantId) || 0;
    const totalRequests = hits + misses;
    
    let oldestAge = 0;
    let totalSize = 0;
    let entries = 0;
    
    for (const cacheKey of cacheKeys) {
      const entry = this.cache.get(cacheKey);
      if (entry && Date.now() <= entry.expiresAt) {
        entries++;
        const age = Date.now() - entry.cachedAt;
        if (age > oldestAge) {
          oldestAge = age;
        }
        totalSize += entry.content.length + (entry.title?.length || 0);
      }
    }
    
    return {
      tenantId,
      entries,
      hits,
      misses,
      hitRate: totalRequests > 0 ? hits / totalRequests : 0,
      memoryUsageMb: totalSize / (1024 * 1024),
      oldestEntryAge: oldestAge,
    };
  }

  private addToQueryIndex(cacheKey: string, queryHash: string): void {
    let hashes = this.queryIndex.get(queryHash);
    if (!hashes) {
      hashes = new Set();
      this.queryIndex.set(queryHash, hashes);
    }
    hashes.add(cacheKey);
  }

  private removeFromQueryIndex(cacheKey: string, queryHash?: string): void {
    if (!queryHash) return;
    
    const hashes = this.queryIndex.get(queryHash);
    if (hashes) {
      hashes.delete(cacheKey);
      if (hashes.size === 0) {
        this.queryIndex.delete(queryHash);
      }
    }
  }

  private addToTenantIndex(cacheKey: string, tenantId: string): void {
    let keys = this.tenantIndex.get(tenantId);
    if (!keys) {
      keys = new Set();
      this.tenantIndex.set(tenantId, keys);
    }
    keys.add(cacheKey);
  }

  private removeFromTenantIndex(cacheKey: string, tenantId?: string): void {
    if (!tenantId) return;
    
    const keys = this.tenantIndex.get(tenantId);
    if (keys) {
      keys.delete(cacheKey);
      if (keys.size === 0) {
        this.tenantIndex.delete(tenantId);
      }
    }
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessedAt < oldestAccess) {
        oldestAccess = entry.lastAccessedAt;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      const entry = this.cache.get(oldestKey);
      if (entry) {
        this.currentMemoryBytes -= this.estimateEntrySize(entry);
        this.removeFromQueryIndex(oldestKey, entry.queryHash);
        this.removeFromTenantIndex(oldestKey, entry.tenantId);
      }
      this.cache.delete(oldestKey);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    const expired: string[] = [];
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        expired.push(key);
      }
    }
    
    for (const key of expired) {
      const entry = this.cache.get(key);
      if (entry) {
        this.currentMemoryBytes -= this.estimateEntrySize(entry);
        this.removeFromQueryIndex(key, entry.queryHash);
        this.removeFromTenantIndex(key, entry.tenantId);
      }
      this.cache.delete(key);
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clear();
  }
}

export const responseCache = new ResponseCache();
