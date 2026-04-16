/* ------------------------------------------------------------------ *
 *  connectorRequestDedup.ts — Request deduplication, smart caching,
 *  in-flight coalescing, and time-window batching.
 *  Standalone module — no imports from other kernel files.
 * ------------------------------------------------------------------ */

// ─── Types ──────────────────────────────────────────────────────────

export interface CacheEntry<T> {
  key: string;
  value: T;
  createdAt: number;
  expiresAt: number;
  staleAt: number;
  tags: string[];
  connectorId: string;
  hitCount: number;
  lastAccessedAt: number;
  size: number;
  isRevalidating: boolean;
}

export interface CacheConfig {
  /** Default TTL in ms */
  ttlMs: number;
  /** Stale-while-revalidate window in ms (added on top of TTL) */
  staleWhileRevalidateMs: number;
  /** Max entries in the cache */
  maxEntries: number;
  /** Max total size in bytes (approximate) */
  maxSizeBytes: number;
  /** Enable stale-while-revalidate */
  enableSwr: boolean;
}

export interface CacheStats {
  hits: number;
  misses: number;
  staleHits: number;
  evictions: number;
  totalEntries: number;
  totalSizeBytes: number;
  hitRate: number;
  avgHitCount: number;
  oldestEntryAge: number;
}

export interface DedupStats {
  totalRequests: number;
  deduplicatedRequests: number;
  cacheMisses: number;
  cacheHits: number;
  coalescedRequests: number;
  dedupRate: number;
}

export interface CoalesceWindow<T> {
  batchId: string;
  connectorId: string;
  requests: Array<{
    fingerprint: string;
    userId: string;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    addedAt: number;
  }>;
  openedAt: number;
  windowMs: number;
  maxBatchSize: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface FingerprintConfig {
  /** Fields to exclude from fingerprint computation */
  excludeFields: string[];
  /** Whether to normalize string values (lowercase, trim) */
  normalizeStrings: boolean;
  /** Whether to sort object keys for deterministic hashing */
  sortKeys: boolean;
  /** Custom salt to add to fingerprints */
  salt: string;
}

// ─── Default Configs ────────────────────────────────────────────────

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  ttlMs: 300000,          // 5 minutes
  staleWhileRevalidateMs: 60000,  // 1 minute
  maxEntries: 1000,
  maxSizeBytes: 50 * 1024 * 1024, // 50 MB
  enableSwr: true,
};

export const DEFAULT_FINGERPRINT_CONFIG: FingerprintConfig = {
  excludeFields: ['timestamp', 'requestId', 'nonce', 'trace_id'],
  normalizeStrings: true,
  sortKeys: true,
  salt: '',
};

// ─── RequestFingerprinter ───────────────────────────────────────────

export class RequestFingerprinter {
  private config: FingerprintConfig;

  constructor(config: Partial<FingerprintConfig> = {}) {
    this.config = { ...DEFAULT_FINGERPRINT_CONFIG, ...config };
  }

  /**
   * Compute an FNV-1a based fingerprint for the given request data.
   */
  fingerprint(data: Record<string, unknown>): string {
    const normalized = this.normalize(data);
    const serialized = JSON.stringify(normalized);
    return this.fnv1a(this.config.salt + serialized);
  }

  /**
   * Compute fingerprint for a combination of method, path, and body.
   */
  fingerprintRequest(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    headers?: Record<string, string>,
  ): string {
    const parts: Record<string, unknown> = {
      __method: method.toUpperCase(),
      __path: path,
    };
    if (body) {
      parts.__body = body;
    }
    if (headers) {
      // Only include non-excluded header fields
      const filtered: Record<string, string> = {};
      for (const [k, v] of Object.entries(headers)) {
        if (!this.config.excludeFields.includes(k.toLowerCase())) {
          filtered[k.toLowerCase()] = v;
        }
      }
      if (Object.keys(filtered).length > 0) {
        parts.__headers = filtered;
      }
    }
    return this.fingerprint(parts);
  }

  /**
   * Normalize the data for consistent fingerprinting.
   */
  private normalize(data: unknown): unknown {
    if (data === null || data === undefined) return null;

    if (typeof data === 'string') {
      return this.config.normalizeStrings ? data.trim().toLowerCase() : data;
    }

    if (typeof data === 'number' || typeof data === 'boolean') {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.normalize(item));
    }

    if (typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      const keys = Object.keys(obj).filter(
        (k) => !this.config.excludeFields.includes(k),
      );
      if (this.config.sortKeys) {
        keys.sort();
      }
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        result[key] = this.normalize(obj[key]);
      }
      return result;
    }

    return String(data);
  }

  /**
   * FNV-1a hash — fast, non-cryptographic, good distribution.
   */
  private fnv1a(str: string): string {
    let hash = 0x811c9dc5; // FNV offset basis (32-bit)
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      // FNV prime: 16777619
      hash = Math.imul(hash, 16777619);
    }
    // Convert to unsigned 32-bit hex
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
}

// ─── ConnectorSmartCache ────────────────────────────────────────────

export class ConnectorSmartCache {
  private entries: Map<string, CacheEntry<unknown>> = new Map();
  private tagIndex: Map<string, Set<string>> = new Map();      // tag → keys
  private connectorIndex: Map<string, Set<string>> = new Map(); // connectorId → keys
  private config: CacheConfig;

  // Stats
  private hits: number = 0;
  private misses: number = 0;
  private staleHits: number = 0;
  private evictions: number = 0;
  private totalSizeBytes: number = 0;

  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      (this.cleanupTimer as NodeJS.Timeout).unref();
    }
  }

  /* ── get ──────────────────────────────────────────────────────── */

  get<T>(key: string): { value: T; stale: boolean } | null {
    const entry = this.entries.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      this.misses++;
      return null;
    }

    const now = Date.now();

    // Completely expired (past stale window)
    if (now > entry.expiresAt + (this.config.enableSwr ? this.config.staleWhileRevalidateMs : 0)) {
      this.removeEntry(key);
      this.misses++;
      return null;
    }

    // Stale but within revalidation window
    if (now > entry.expiresAt) {
      entry.hitCount++;
      entry.lastAccessedAt = now;
      this.staleHits++;
      return { value: entry.value, stale: true };
    }

    // Fresh
    entry.hitCount++;
    entry.lastAccessedAt = now;
    this.hits++;
    return { value: entry.value, stale: false };
  }

  /* ── set ──────────────────────────────────────────────────────── */

  set<T>(
    key: string,
    value: T,
    options?: {
      ttlMs?: number;
      tags?: string[];
      connectorId?: string;
    },
  ): void {
    // If key already exists, remove old entry metrics
    if (this.entries.has(key)) {
      this.removeEntry(key);
    }

    // Evict if needed
    this.ensureCapacity();

    const now = Date.now();
    const ttl = options?.ttlMs ?? this.config.ttlMs;
    const size = this.estimateSize(value);

    const entry: CacheEntry<T> = {
      key,
      value,
      createdAt: now,
      expiresAt: now + ttl,
      staleAt: now + ttl,
      tags: options?.tags ?? [],
      connectorId: options?.connectorId ?? '',
      hitCount: 0,
      lastAccessedAt: now,
      size,
      isRevalidating: false,
    };

    this.entries.set(key, entry as CacheEntry<unknown>);
    this.totalSizeBytes += size;

    // Index tags
    for (const tag of entry.tags) {
      let tagSet = this.tagIndex.get(tag);
      if (!tagSet) {
        tagSet = new Set();
        this.tagIndex.set(tag, tagSet);
      }
      tagSet.add(key);
    }

    // Index connector
    if (entry.connectorId) {
      let connSet = this.connectorIndex.get(entry.connectorId);
      if (!connSet) {
        connSet = new Set();
        this.connectorIndex.set(entry.connectorId, connSet);
      }
      connSet.add(key);
    }
  }

  /* ── invalidateByTag ──────────────────────────────────────────── */

  invalidateByTag(tag: string): number {
    const keys = this.tagIndex.get(tag);
    if (!keys) return 0;
    let count = 0;
    for (const key of Array.from(keys)) {
      this.removeEntry(key);
      count++;
    }
    this.tagIndex.delete(tag);
    return count;
  }

  /* ── invalidateByConnector ────────────────────────────────────── */

  invalidateByConnector(connectorId: string): number {
    const keys = this.connectorIndex.get(connectorId);
    if (!keys) return 0;
    let count = 0;
    for (const key of Array.from(keys)) {
      this.removeEntry(key);
      count++;
    }
    this.connectorIndex.delete(connectorId);
    return count;
  }

  /* ── invalidate ───────────────────────────────────────────────── */

  invalidate(key: string): boolean {
    if (!this.entries.has(key)) return false;
    this.removeEntry(key);
    return true;
  }

  /* ── markRevalidating ─────────────────────────────────────────── */

  markRevalidating(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.isRevalidating) return false;
    entry.isRevalidating = true;
    return true;
  }

  /* ── completeRevalidation ─────────────────────────────────────── */

  completeRevalidation<T>(
    key: string,
    newValue: T,
    ttlMs?: number,
  ): void {
    const entry = this.entries.get(key);
    if (!entry) return;

    const now = Date.now();
    const ttl = ttlMs ?? this.config.ttlMs;

    this.totalSizeBytes -= entry.size;
    const newSize = this.estimateSize(newValue);

    entry.value = newValue;
    entry.expiresAt = now + ttl;
    entry.staleAt = now + ttl;
    entry.size = newSize;
    entry.isRevalidating = false;
    entry.lastAccessedAt = now;

    this.totalSizeBytes += newSize;
  }

  /* ── getStats ─────────────────────────────────────────────────── */

  getStats(): CacheStats {
    const totalRequests = this.hits + this.misses + this.staleHits;
    let totalHitCount = 0;
    let oldestAge = 0;
    const now = Date.now();

    for (const entry of Array.from(this.entries.values())) {
      totalHitCount += entry.hitCount;
      const age = now - entry.createdAt;
      if (age > oldestAge) oldestAge = age;
    }

    return {
      hits: this.hits,
      misses: this.misses,
      staleHits: this.staleHits,
      evictions: this.evictions,
      totalEntries: this.entries.size,
      totalSizeBytes: this.totalSizeBytes,
      hitRate: totalRequests > 0 ? (this.hits + this.staleHits) / totalRequests : 0,
      avgHitCount: this.entries.size > 0 ? totalHitCount / this.entries.size : 0,
      oldestEntryAge: oldestAge,
    };
  }

  /* ── has ──────────────────────────────────────────────────────── */

  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    const now = Date.now();
    const maxExpiry = entry.expiresAt + (this.config.enableSwr ? this.config.staleWhileRevalidateMs : 0);
    return now <= maxExpiry;
  }

  /* ── clear ────────────────────────────────────────────────────── */

  clear(): void {
    this.entries.clear();
    this.tagIndex.clear();
    this.connectorIndex.clear();
    this.totalSizeBytes = 0;
    this.hits = 0;
    this.misses = 0;
    this.staleHits = 0;
    this.evictions = 0;
  }

  /* ── destroy ──────────────────────────────────────────────────── */

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clear();
  }

  /* ── size ─────────────────────────────────────────────────────── */

  size(): number {
    return this.entries.size;
  }

  /* ── internals ────────────────────────────────────────────────── */

  private removeEntry(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;

    this.totalSizeBytes -= entry.size;
    this.entries.delete(key);

    // Remove from tag index
    for (const tag of entry.tags) {
      const tagSet = this.tagIndex.get(tag);
      if (tagSet) {
        tagSet.delete(key);
        if (tagSet.size === 0) this.tagIndex.delete(tag);
      }
    }

    // Remove from connector index
    if (entry.connectorId) {
      const connSet = this.connectorIndex.get(entry.connectorId);
      if (connSet) {
        connSet.delete(key);
        if (connSet.size === 0) this.connectorIndex.delete(entry.connectorId);
      }
    }
  }

  private ensureCapacity(): void {
    // Evict by count
    while (this.entries.size >= this.config.maxEntries) {
      this.evictLru();
    }
    // Evict by size
    while (this.totalSizeBytes >= this.config.maxSizeBytes && this.entries.size > 0) {
      this.evictLru();
    }
  }

  private evictLru(): void {
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;
    for (const [key, entry] of Array.from(this.entries.entries())) {
      if (entry.lastAccessedAt < oldestAccess) {
        oldestAccess = entry.lastAccessedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.removeEntry(oldestKey);
      this.evictions++;
    }
  }

  private cleanup(): void {
    const now = Date.now();
    const toRemove: string[] = [];
    for (const [key, entry] of Array.from(this.entries.entries())) {
      const maxExpiry = entry.expiresAt + (this.config.enableSwr ? this.config.staleWhileRevalidateMs : 0);
      if (now > maxExpiry) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      this.removeEntry(key);
    }
  }

  private estimateSize(value: unknown): number {
    try {
      const json = JSON.stringify(value);
      return json ? json.length * 2 : 64; // rough UTF-16 estimate
    } catch {
      return 1024; // fallback
    }
  }
}

// ─── InFlightDeduplicator ───────────────────────────────────────────

export class InFlightDeduplicator {
  private inFlight: Map<string, Promise<unknown>> = new Map();
  private stats = {
    totalRequests: 0,
    deduplicatedRequests: 0,
  };

  /**
   * Execute a function, deduplicating concurrent calls with the same fingerprint.
   * If a call with the same fingerprint is already in flight, the same promise is returned.
   */
  async execute<T>(
    fingerprint: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    this.stats.totalRequests++;

    const existing = this.inFlight.get(fingerprint);
    if (existing) {
      this.stats.deduplicatedRequests++;
      return existing as Promise<T>;
    }

    const promise = fn().finally(() => {
      this.inFlight.delete(fingerprint);
    });

    this.inFlight.set(fingerprint, promise);
    return promise;
  }

  /**
   * Check if a request with the given fingerprint is already in flight.
   */
  isInFlight(fingerprint: string): boolean {
    return this.inFlight.has(fingerprint);
  }

  /**
   * Get the number of currently in-flight requests.
   */
  getInFlightCount(): number {
    return this.inFlight.size;
  }

  /**
   * Get all in-flight fingerprints.
   */
  getInFlightFingerprints(): string[] {
    return Array.from(this.inFlight.keys());
  }

  /**
   * Get dedup stats.
   */
  getStats(): { totalRequests: number; deduplicatedRequests: number; dedupRate: number } {
    return {
      ...this.stats,
      dedupRate: this.stats.totalRequests > 0
        ? this.stats.deduplicatedRequests / this.stats.totalRequests
        : 0,
    };
  }

  /**
   * Reset stats.
   */
  resetStats(): void {
    this.stats.totalRequests = 0;
    this.stats.deduplicatedRequests = 0;
  }

  /**
   * Clear all in-flight entries (does NOT reject pending promises).
   */
  clear(): void {
    this.inFlight.clear();
  }
}

// ─── RequestCoalescer ───────────────────────────────────────────────

export class RequestCoalescer<T = unknown> {
  private windows: Map<string, CoalesceWindow<T>> = new Map();
  private batchHandler: ((
    connectorId: string,
    fingerprints: string[],
  ) => Promise<Map<string, T>>) | null = null;
  private defaultWindowMs: number;
  private defaultMaxBatchSize: number;
  private batchIdCounter: number = 0;

  constructor(options?: { windowMs?: number; maxBatchSize?: number }) {
    this.defaultWindowMs = options?.windowMs ?? 50;
    this.defaultMaxBatchSize = options?.maxBatchSize ?? 20;
  }

  /**
   * Register the batch handler that processes coalesced requests.
   */
  onBatch(
    handler: (connectorId: string, fingerprints: string[]) => Promise<Map<string, T>>,
  ): void {
    this.batchHandler = handler;
  }

  /**
   * Submit a request for coalescing. Returns a promise that resolves when the
   * batch is processed and this request's result is available.
   */
  submit(
    connectorId: string,
    fingerprint: string,
    userId: string,
    windowMs?: number,
    maxBatchSize?: number,
  ): Promise<T> {
    const key = connectorId;
    let window = this.windows.get(key);

    return new Promise<T>((resolve, reject) => {
      if (!window) {
        window = {
          batchId: `batch_${++this.batchIdCounter}`,
          connectorId,
          requests: [],
          openedAt: Date.now(),
          windowMs: windowMs ?? this.defaultWindowMs,
          maxBatchSize: maxBatchSize ?? this.defaultMaxBatchSize,
          timer: null,
        };
        this.windows.set(key, window);
      }

      window.requests.push({
        fingerprint,
        userId,
        resolve,
        reject,
        addedAt: Date.now(),
      });

      // If batch is full, flush immediately
      if (window.requests.length >= window.maxBatchSize) {
        this.flushWindow(key);
        return;
      }

      // Start timer if not already running
      if (!window.timer) {
        const capturedKey = key;
        window.timer = setTimeout(() => {
          this.flushWindow(capturedKey);
        }, window.windowMs);
      }
    });
  }

  /**
   * Get current window sizes per connector.
   */
  getWindowSizes(): Map<string, number> {
    const result = new Map<string, number>();
    for (const [key, window] of Array.from(this.windows.entries())) {
      result.set(key, window.requests.length);
    }
    return result;
  }

  /**
   * Get active window count.
   */
  getActiveWindowCount(): number {
    return this.windows.size;
  }

  /**
   * Force flush all windows.
   */
  flushAll(): void {
    for (const key of Array.from(this.windows.keys())) {
      this.flushWindow(key);
    }
  }

  /**
   * Clear all windows (rejects pending promises).
   */
  clear(): void {
    for (const [, window] of Array.from(this.windows.entries())) {
      if (window.timer) clearTimeout(window.timer);
      for (const req of window.requests) {
        req.reject(new Error('Coalescer cleared'));
      }
    }
    this.windows.clear();
  }

  /* ── internals ────────────────────────────────────────────────── */

  private flushWindow(key: string): void {
    const window = this.windows.get(key);
    if (!window) return;

    if (window.timer) {
      clearTimeout(window.timer);
      window.timer = null;
    }

    this.windows.delete(key);

    if (window.requests.length === 0) return;

    if (!this.batchHandler) {
      for (const req of window.requests) {
        req.reject(new Error('No batch handler registered'));
      }
      return;
    }

    // Deduplicate fingerprints (fair round-robin by user)
    const uniqueFingerprints: string[] = [];
    const seen = new Set<string>();
    // Round-robin: sort by addedAt, then interleave users
    const byUser: Map<string, typeof window.requests> = new Map();
    for (const req of window.requests) {
      let userList = byUser.get(req.userId);
      if (!userList) {
        userList = [];
        byUser.set(req.userId, userList);
      }
      userList.push(req);
    }

    // Interleave
    const userLists = Array.from(byUser.values());
    let maxLen = 0;
    for (const ul of userLists) {
      if (ul.length > maxLen) maxLen = ul.length;
    }
    for (let i = 0; i < maxLen; i++) {
      for (const ul of userLists) {
        if (i < ul.length && !seen.has(ul[i].fingerprint)) {
          seen.add(ul[i].fingerprint);
          uniqueFingerprints.push(ul[i].fingerprint);
        }
      }
    }

    // Execute batch
    this.batchHandler(window.connectorId, uniqueFingerprints)
      .then((results) => {
        for (const req of window.requests) {
          const result = results.get(req.fingerprint);
          if (result !== undefined) {
            req.resolve(result);
          } else {
            req.reject(new Error(`No result for fingerprint ${req.fingerprint}`));
          }
        }
      })
      .catch((err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        for (const req of window.requests) {
          req.reject(error);
        }
      });
  }
}

// ─── DedupManager (facade) ──────────────────────────────────────────

export class DedupManager {
  readonly fingerprinter: RequestFingerprinter;
  readonly cache: ConnectorSmartCache;
  readonly deduplicator: InFlightDeduplicator;
  readonly coalescer: RequestCoalescer;

  private stats: DedupStats = {
    totalRequests: 0,
    deduplicatedRequests: 0,
    cacheMisses: 0,
    cacheHits: 0,
    coalescedRequests: 0,
    dedupRate: 0,
  };

  constructor(options?: {
    cacheConfig?: Partial<CacheConfig>;
    fingerprintConfig?: Partial<FingerprintConfig>;
    coalesceWindowMs?: number;
    coalesceMaxBatchSize?: number;
  }) {
    this.fingerprinter = new RequestFingerprinter(options?.fingerprintConfig);
    this.cache = new ConnectorSmartCache(options?.cacheConfig);
    this.deduplicator = new InFlightDeduplicator();
    this.coalescer = new RequestCoalescer({
      windowMs: options?.coalesceWindowMs,
      maxBatchSize: options?.coalesceMaxBatchSize,
    });
  }

  /**
   * Execute a request with cache → dedup → fresh fetch → cache store pipeline.
   */
  async execute<T>(
    connectorId: string,
    requestData: Record<string, unknown>,
    fetcher: () => Promise<T>,
    options?: {
      cacheTtlMs?: number;
      cacheTags?: string[];
      bypassCache?: boolean;
      method?: string;
      path?: string;
    },
  ): Promise<T> {
    this.stats.totalRequests++;

    const fingerprint = options?.method && options?.path
      ? this.fingerprinter.fingerprintRequest(options.method, options.path, requestData)
      : this.fingerprinter.fingerprint(requestData);

    const cacheKey = `${connectorId}::${fingerprint}`;

    // Step 1: Check cache (unless bypass)
    if (!options?.bypassCache) {
      const cached = this.cache.get<T>(cacheKey);
      if (cached) {
        this.stats.cacheHits++;
        if (cached.stale && this.cache.markRevalidating(cacheKey)) {
          // Stale-while-revalidate: return stale, revalidate in background
          this.revalidateInBackground(cacheKey, connectorId, fetcher, options);
        }
        this.updateDedupRate();
        return cached.value;
      }
    }

    this.stats.cacheMisses++;

    // Step 2: In-flight deduplication
    const result = await this.deduplicator.execute<T>(fingerprint, async () => {
      const dedupStats = this.deduplicator.getStats();
      if (dedupStats.deduplicatedRequests > 0) {
        this.stats.deduplicatedRequests++;
      }

      // Step 3: Fresh fetch
      const freshResult = await fetcher();

      // Step 4: Store in cache
      this.cache.set(cacheKey, freshResult, {
        ttlMs: options?.cacheTtlMs,
        tags: options?.cacheTags,
        connectorId,
      });

      return freshResult;
    });

    this.updateDedupRate();
    return result;
  }

  /**
   * Invalidate cache entries for a connector.
   */
  invalidateConnector(connectorId: string): number {
    return this.cache.invalidateByConnector(connectorId);
  }

  /**
   * Invalidate cache entries by tag.
   */
  invalidateByTag(tag: string): number {
    return this.cache.invalidateByTag(tag);
  }

  /**
   * Get combined stats.
   */
  getStats(): DedupStats {
    return { ...this.stats };
  }

  /**
   * Get cache stats.
   */
  getCacheStats(): CacheStats {
    return this.cache.getStats();
  }

  /**
   * Reset all stats.
   */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      deduplicatedRequests: 0,
      cacheMisses: 0,
      cacheHits: 0,
      coalescedRequests: 0,
      dedupRate: 0,
    };
    this.deduplicator.resetStats();
  }

  /**
   * Clear everything (cache + in-flight + coalescer).
   */
  clear(): void {
    this.cache.clear();
    this.deduplicator.clear();
    this.coalescer.clear();
    this.resetStats();
  }

  /**
   * Destroy (cleanup timers).
   */
  destroy(): void {
    this.cache.destroy();
    this.deduplicator.clear();
    this.coalescer.clear();
  }

  /* ── internals ────────────────────────────────────────────────── */

  private revalidateInBackground<T>(
    cacheKey: string,
    _connectorId: string,
    fetcher: () => Promise<T>,
    options?: { cacheTtlMs?: number },
  ): void {
    fetcher()
      .then((fresh) => {
        this.cache.completeRevalidation(cacheKey, fresh, options?.cacheTtlMs);
      })
      .catch(() => {
        // Revalidation failed — keep stale entry, just clear the flag
        const entry = (this.cache as unknown as { entries: Map<string, CacheEntry<unknown>> }).entries?.get(cacheKey);
        if (entry) entry.isRevalidating = false;
      });
  }

  private updateDedupRate(): void {
    this.stats.dedupRate = this.stats.totalRequests > 0
      ? (this.stats.cacheHits + this.stats.deduplicatedRequests) / this.stats.totalRequests
      : 0;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────

export const dedupManager = new DedupManager();
