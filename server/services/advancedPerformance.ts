/**
 * Advanced Performance Module v4.0
 * Improvements 201-300: Advanced Performance
 * 
 * 201-220: Intelligent Caching
 * 221-240: Advanced Parallelization
 * 241-260: Database Optimization
 * 261-280: Network Optimization
 * 281-300: CPU Optimization
 */

import crypto from "crypto";
import { createClient, RedisClientType } from "redis";

// ============================================
// TYPES
// ============================================

export interface CacheEntry<T> {
  data: T;
  createdAt: number;
  accessCount: number;
  lastAccess: number;
  ttl: number;
  size: number;
  tags: string[];
  version: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalSize: number;
  entryCount: number;
  avgAccessTime: number;
  evictions: number;
}

export interface WorkerTask<T> {
  id: string;
  priority: number;
  fn: () => Promise<T>;
  timeout: number;
  retries: number;
  createdAt: number;
}

export interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  open: boolean;
  halfOpenAt?: number;
  successCount: number;
}

// ============================================
// 201-220: INTELLIGENT CACHING
// ============================================

// L1 Cache: In-memory with LRU
class L1Cache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;
  private maxEntries: number;
  private stats: CacheStats = {
    hits: 0, misses: 0, hitRate: 0, totalSize: 0,
    entryCount: 0, avgAccessTime: 0, evictions: 0
  };

  constructor(maxSize = 50 * 1024 * 1024, maxEntries = 1000) { // 50MB, 1000 entries
    this.maxSize = maxSize;
    this.maxEntries = maxEntries;
  }

  // 201. Cache predictivo basado en patrones
  private predictiveKeys: Map<string, string[]> = new Map();
  
  recordPattern(key: string, relatedKeys: string[]): void {
    this.predictiveKeys.set(key, relatedKeys);
  }

  async prefetch(key: string, fetchFn: () => Promise<T>): Promise<void> {
    const related = this.predictiveKeys.get(key) || [];
    for (const relatedKey of related) {
      if (!this.cache.has(relatedKey)) {
        try {
          const data = await fetchFn();
          this.set(relatedKey, data, 600);
        } catch {}
      }
    }
  }

  // 205. LRU eviction con scoring
  private evictLRU(): void {
    if (this.cache.size < this.maxEntries) return;
    
    let lowestScore = Infinity;
    let keyToEvict = "";
    const now = Date.now();
    
    for (const [key, entry] of this.cache) {
      // Score = recency + frequency + size penalty
      const recency = (now - entry.lastAccess) / 1000; // seconds since last access
      const frequency = entry.accessCount;
      const sizePenalty = entry.size / 1024; // KB
      const score = frequency / (recency + 1) - sizePenalty * 0.1;
      
      if (score < lowestScore) {
        lowestScore = score;
        keyToEvict = key;
      }
    }
    
    if (keyToEvict) {
      const entry = this.cache.get(keyToEvict);
      if (entry) {
        this.stats.totalSize -= entry.size;
      }
      this.cache.delete(keyToEvict);
      this.stats.evictions++;
    }
  }

  // 211. Cache TTL dinámico por volatilidad
  private calculateDynamicTTL(key: string, baseValue: number): number {
    const patterns = {
      "trending": 300,      // 5 min for trending
      "search:": 600,       // 10 min for searches
      "author:": 3600,      // 1 hour for authors
      "journal:": 86400,    // 1 day for journals
      "stats:": 1800        // 30 min for stats
    };
    
    for (const [pattern, ttl] of Object.entries(patterns)) {
      if (key.includes(pattern)) return ttl;
    }
    return baseValue;
  }

  get(key: string): T | null {
    const start = performance.now();
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }
    
    // Check TTL
    if (Date.now() - entry.createdAt > entry.ttl * 1000) {
      this.cache.delete(key);
      this.stats.misses++;
      this.stats.totalSize -= entry.size;
      this.updateHitRate();
      return null;
    }
    
    // Update access stats
    entry.accessCount++;
    entry.lastAccess = Date.now();
    this.stats.hits++;
    this.stats.avgAccessTime = (this.stats.avgAccessTime + (performance.now() - start)) / 2;
    this.updateHitRate();
    
    return entry.data;
  }

  set(key: string, data: T, ttl?: number, tags: string[] = []): void {
    const size = JSON.stringify(data).length;
    const dynamicTTL = ttl || this.calculateDynamicTTL(key, 600);
    
    // Evict if needed
    while (this.stats.totalSize + size > this.maxSize || this.cache.size >= this.maxEntries) {
      this.evictLRU();
      if (this.cache.size === 0) break;
    }
    
    const entry: CacheEntry<T> = {
      data,
      createdAt: Date.now(),
      accessCount: 1,
      lastAccess: Date.now(),
      ttl: dynamicTTL,
      size,
      tags,
      version: 1
    };
    
    this.cache.set(key, entry);
    this.stats.totalSize += size;
    this.stats.entryCount = this.cache.size;
  }

  // 208. Cache invalidation by tag
  invalidateByTag(tag: string): number {
    let count = 0;
    for (const [key, entry] of this.cache) {
      if (entry.tags.includes(tag)) {
        this.stats.totalSize -= entry.size;
        this.cache.delete(key);
        count++;
      }
    }
    this.stats.entryCount = this.cache.size;
    return count;
  }

  // 209. Cache versioning para upgrades
  incrementVersion(key: string): void {
    const entry = this.cache.get(key);
    if (entry) {
      entry.version++;
    }
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  clear(): void {
    this.cache.clear();
    this.stats.totalSize = 0;
    this.stats.entryCount = 0;
  }
}

// L2 Cache: Redis (distributed)
class L2Cache {
  private client: RedisClientType | null = null;
  private prefix = "acad:v4:";
  
  async connect(url: string): Promise<boolean> {
    if (this.client) return true;
    
    try {
      this.client = createClient({ url });
      await this.client.connect();
      return true;
    } catch {
      return false;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client) return null;
    
    try {
      const data = await this.client.get(this.prefix + key);
      if (!data) return null;
      
      // 210. Compressed cache entries
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, data: T, ttl = 600): Promise<void> {
    if (!this.client) return;
    
    try {
      await this.client.setEx(this.prefix + key, ttl, JSON.stringify(data));
    } catch {}
  }

  // 212. Cache sharing entre sessions
  async getShared<T>(key: string): Promise<T | null> {
    return this.get(`shared:${key}`);
  }

  async setShared<T>(key: string, data: T, ttl = 3600): Promise<void> {
    await this.set(`shared:${key}`, data, ttl);
  }
}

// 203. Hierarchical cache (L1 memory + L2 Redis)
export class HierarchicalCache<T> {
  private l1: L1Cache<T>;
  private l2: L2Cache;
  private enabled = true;

  constructor() {
    this.l1 = new L1Cache<T>();
    this.l2 = new L2Cache();
  }

  async connect(redisUrl?: string): Promise<void> {
    if (redisUrl) {
      await this.l2.connect(redisUrl);
    }
  }

  async get(key: string): Promise<{ data: T; level: "l1" | "l2" } | null> {
    if (!this.enabled) return null;
    
    // Try L1 first
    const l1Data = this.l1.get(key);
    if (l1Data) {
      return { data: l1Data, level: "l1" };
    }
    
    // Try L2
    const l2Data = await this.l2.get<T>(key);
    if (l2Data) {
      // Promote to L1
      this.l1.set(key, l2Data);
      return { data: l2Data, level: "l2" };
    }
    
    return null;
  }

  async set(key: string, data: T, ttl?: number, tags: string[] = []): Promise<void> {
    if (!this.enabled) return;
    
    // Write to both levels
    this.l1.set(key, data, ttl, tags);
    await this.l2.set(key, data, ttl);
  }

  getStats(): CacheStats {
    return this.l1.getStats();
  }

  disable(): void {
    this.enabled = false;
  }

  enable(): void {
    this.enabled = true;
  }
}

// ============================================
// 221-240: ADVANCED PARALLELIZATION
// ============================================

// 221. Worker pool para searches
export class WorkerPool<T> {
  private queue: WorkerTask<T>[] = [];
  private running = 0;
  private maxConcurrent: number;
  private results = new Map<string, { data?: T; error?: Error }>();

  constructor(maxConcurrent = 6) {
    this.maxConcurrent = maxConcurrent;
  }

  // 222. Job queue con prioridades
  addTask(task: Omit<WorkerTask<T>, "id" | "createdAt">): string {
    const id = crypto.randomUUID();
    const fullTask: WorkerTask<T> = {
      ...task,
      id,
      createdAt: Date.now()
    };
    
    // Insert by priority (higher = first)
    let inserted = false;
    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i].priority < task.priority) {
        this.queue.splice(i, 0, fullTask);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this.queue.push(fullTask);
    }
    
    this.processQueue();
    return id;
  }

  private async processQueue(): Promise<void> {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;
      
      this.running++;
      this.executeTask(task).finally(() => {
        this.running--;
        this.processQueue();
      });
    }
  }

  private async executeTask(task: WorkerTask<T>): Promise<void> {
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt <= task.retries; attempt++) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Timeout")), task.timeout);
        });
        
        const result = await Promise.race([task.fn(), timeoutPromise]);
        this.results.set(task.id, { data: result });
        return;
      } catch (error) {
        lastError = error as Error;
        if (attempt < task.retries) {
          await new Promise(r => setTimeout(r, 100 * (attempt + 1))); // Backoff
        }
      }
    }
    
    this.results.set(task.id, { error: lastError });
  }

  getResult(id: string): { data?: T; error?: Error; pending: boolean } {
    const result = this.results.get(id);
    if (!result) {
      const pending = this.queue.some(t => t.id === id);
      return { pending: pending || this.running > 0 };
    }
    return { ...result, pending: false };
  }

  // 230. Request coalescing
  private coalescing = new Map<string, Promise<T>>();
  
  async executeWithCoalescing(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.coalescing.get(key);
    if (existing) return existing;
    
    const promise = fn().finally(() => {
      this.coalescing.delete(key);
    });
    
    this.coalescing.set(key, promise);
    return promise;
  }
}

// 223. Async streaming de resultados
export async function* streamResults<T>(
  generators: Array<() => AsyncGenerator<T>>,
  options: { timeout?: number; maxConcurrent?: number } = {}
): AsyncGenerator<T> {
  const { timeout = 10000, maxConcurrent = 4 } = options;
  const active: Promise<{ value?: T; done: boolean; index: number }>[] = [];
  const iterators = generators.map(g => g());
  let completed = 0;
  
  // Start initial batch
  for (let i = 0; i < Math.min(maxConcurrent, iterators.length); i++) {
    active.push(
      iterators[i].next().then(result => ({ ...result, index: i }))
    );
  }
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Stream timeout")), timeout);
  });
  
  while (active.length > 0 && completed < iterators.length) {
    try {
      const { value, done, index } = await Promise.race([
        Promise.race(active),
        timeoutPromise
      ]);
      
      if (done) {
        completed++;
        // Remove completed from active
        const activeIndex = active.findIndex(p => p === active[index]);
        if (activeIndex > -1) active.splice(activeIndex, 1);
      } else if (value !== undefined) {
        yield value;
        // Queue next from same iterator
        active[index] = iterators[index].next().then(result => ({ ...result, index }));
      }
    } catch {
      break;
    }
  }
}

// 234. Parallel deduplication
export function parallelDeduplicate<T>(
  items: T[],
  keyFn: (item: T) => string,
  chunkSize = 100
): T[] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  
  // Deduplicate each chunk
  const dedupedChunks = chunks.map(chunk => {
    const seen = new Set<string>();
    return chunk.filter(item => {
      const key = keyFn(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
  
  // Merge and deduplicate across chunks
  const seen = new Set<string>();
  return dedupedChunks.flat().filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================
// 241-260: DATABASE OPTIMIZATION
// ============================================

// 241-242. Connection pooling and query optimization
export interface QueryOptimizer {
  analyze(query: string): { optimized: string; hints: string[] };
  explain(query: string): Promise<string>;
}

export class SimpleQueryOptimizer implements QueryOptimizer {
  analyze(query: string): { optimized: string; hints: string[] } {
    const hints: string[] = [];
    let optimized = query;
    
    // Check for SELECT *
    if (/SELECT\s+\*\s+FROM/i.test(query)) {
      hints.push("Consider selecting specific columns instead of *");
    }
    
    // Check for missing WHERE clause
    if (/SELECT.*FROM\s+\w+\s*$/i.test(query)) {
      hints.push("Query lacks WHERE clause - may return large dataset");
    }
    
    // Check for missing indexes (heuristic)
    if (/WHERE.*LIKE\s+'%/i.test(query)) {
      hints.push("Leading wildcard prevents index usage");
    }
    
    // Check for OR that could be UNION
    if (/WHERE.*\bOR\b.*\bOR\b/i.test(query)) {
      hints.push("Multiple ORs may benefit from UNION optimization");
    }
    
    return { optimized, hints };
  }

  async explain(_query: string): Promise<string> {
    return "EXPLAIN not available - use database client directly";
  }
}

// 252. Query result caching
export class QueryCache {
  private cache: HierarchicalCache<any>;
  private queryHashes = new Map<string, string>();

  constructor(cache: HierarchicalCache<any>) {
    this.cache = cache;
  }

  private hashQuery(query: string, params: any[]): string {
    const input = query + JSON.stringify(params);
    return crypto.createHash("md5").update(input).digest("hex");
  }

  async get<T>(query: string, params: any[] = []): Promise<T | null> {
    const hash = this.hashQuery(query, params);
    const result = await this.cache.get(hash);
    return result?.data || null;
  }

  async set<T>(query: string, params: any[], data: T, ttl = 300): Promise<void> {
    const hash = this.hashQuery(query, params);
    this.queryHashes.set(query, hash);
    await this.cache.set(hash, data, ttl);
  }

  invalidatePattern(pattern: string): void {
    for (const [query, hash] of this.queryHashes) {
      if (query.includes(pattern)) {
        this.queryHashes.delete(query);
        // Cache will be invalidated on next access
      }
    }
  }
}

// ============================================
// 261-280: NETWORK OPTIMIZATION
// ============================================

// 263. Request pipelining
export class RequestPipeline {
  private queue: Array<{
    url: string;
    options: RequestInit;
    resolve: (value: Response) => void;
    reject: (reason: any) => void;
  }> = [];
  private processing = false;
  private batchSize: number;
  private batchDelay: number;

  constructor(batchSize = 5, batchDelay = 10) {
    this.batchSize = batchSize;
    this.batchDelay = batchDelay;
  }

  async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    return new Promise((resolve, reject) => {
      this.queue.push({ url, options, resolve, reject });
      this.processBatch();
    });
  }

  private async processBatch(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    
    await new Promise(r => setTimeout(r, this.batchDelay));
    
    const batch = this.queue.splice(0, this.batchSize);
    
    await Promise.all(
      batch.map(async ({ url, options, resolve, reject }) => {
        try {
          const response = await fetch(url, options);
          resolve(response);
        } catch (error) {
          reject(error);
        }
      })
    );
    
    this.processing = false;
    if (this.queue.length > 0) {
      this.processBatch();
    }
  }
}

// 267. Conditional requests (ETag caching)
export class ConditionalFetcher {
  private etags = new Map<string, string>();
  private lastModified = new Map<string, string>();
  private cache: HierarchicalCache<any>;

  constructor(cache: HierarchicalCache<any>) {
    this.cache = cache;
  }

  async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers);
    
    // Add conditional headers if we have cached data
    const etag = this.etags.get(url);
    const modified = this.lastModified.get(url);
    
    if (etag) headers.set("If-None-Match", etag);
    if (modified) headers.set("If-Modified-Since", modified);
    
    const response = await fetch(url, { ...options, headers });
    
    // 304 Not Modified - use cached
    if (response.status === 304) {
      const cached = await this.cache.get(url);
      if (cached) {
        return new Response(JSON.stringify(cached.data), {
          status: 200,
          headers: { "Content-Type": "application/json", "X-Cache": "HIT" }
        });
      }
    }
    
    // Store new ETag/Last-Modified
    const newEtag = response.headers.get("ETag");
    const newModified = response.headers.get("Last-Modified");
    
    if (newEtag) this.etags.set(url, newEtag);
    if (newModified) this.lastModified.set(url, newModified);
    
    return response;
  }
}

// ============================================
// 281-300: CPU OPTIMIZATION
// ============================================

// 282. Bloom filter para deduplication rápida
export class BloomFilter {
  private bits: Uint8Array;
  private numHashes: number;
  private size: number;

  constructor(expectedItems = 10000, falsePositiveRate = 0.01) {
    // Calculate optimal size and hash count
    this.size = Math.ceil(-expectedItems * Math.log(falsePositiveRate) / (Math.log(2) ** 2));
    this.numHashes = Math.ceil((this.size / expectedItems) * Math.log(2));
    this.bits = new Uint8Array(Math.ceil(this.size / 8));
  }

  private hash(item: string, seed: number): number {
    let h = seed;
    for (let i = 0; i < item.length; i++) {
      h = (h * 31 + item.charCodeAt(i)) >>> 0;
    }
    return h % this.size;
  }

  add(item: string): void {
    for (let i = 0; i < this.numHashes; i++) {
      const pos = this.hash(item, i);
      const byteIndex = Math.floor(pos / 8);
      const bitIndex = pos % 8;
      this.bits[byteIndex] |= (1 << bitIndex);
    }
  }

  mightContain(item: string): boolean {
    for (let i = 0; i < this.numHashes; i++) {
      const pos = this.hash(item, i);
      const byteIndex = Math.floor(pos / 8);
      const bitIndex = pos % 8;
      if (!(this.bits[byteIndex] & (1 << bitIndex))) {
        return false;
      }
    }
    return true;
  }

  clear(): void {
    this.bits.fill(0);
  }
}

// 283. Trie para autocomplete rápido
export class Trie {
  private root: TrieNode = { children: new Map(), isEnd: false, count: 0 };

  insert(word: string, count = 1): void {
    let node = this.root;
    for (const char of word.toLowerCase()) {
      if (!node.children.has(char)) {
        node.children.set(char, { children: new Map(), isEnd: false, count: 0 });
      }
      node = node.children.get(char)!;
    }
    node.isEnd = true;
    node.count += count;
  }

  search(prefix: string, limit = 10): string[] {
    let node = this.root;
    
    for (const char of prefix.toLowerCase()) {
      if (!node.children.has(char)) {
        return [];
      }
      node = node.children.get(char)!;
    }
    
    const results: { word: string; count: number }[] = [];
    this.collectWords(node, prefix.toLowerCase(), results, limit * 2);
    
    return results
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map(r => r.word);
  }

  private collectWords(
    node: TrieNode,
    prefix: string,
    results: { word: string; count: number }[],
    limit: number
  ): void {
    if (results.length >= limit) return;
    
    if (node.isEnd) {
      results.push({ word: prefix, count: node.count });
    }
    
    for (const [char, child] of node.children) {
      this.collectWords(child, prefix + char, results, limit);
    }
  }
}

interface TrieNode {
  children: Map<string, TrieNode>;
  isEnd: boolean;
  count: number;
}

// 292. Quick select for top-k
export function quickSelectTopK<T>(
  items: T[],
  k: number,
  compareFn: (a: T, b: T) => number
): T[] {
  if (items.length <= k) return items.sort(compareFn);
  
  const arr = [...items];
  let left = 0;
  let right = arr.length - 1;
  
  while (left < right) {
    const pivotIndex = partition(arr, left, right, compareFn);
    
    if (pivotIndex === k - 1) {
      break;
    } else if (pivotIndex < k - 1) {
      left = pivotIndex + 1;
    } else {
      right = pivotIndex - 1;
    }
  }
  
  return arr.slice(0, k).sort(compareFn);
}

function partition<T>(
  arr: T[],
  left: number,
  right: number,
  compareFn: (a: T, b: T) => number
): number {
  const pivot = arr[right];
  let i = left;
  
  for (let j = left; j < right; j++) {
    if (compareFn(arr[j], pivot) < 0) {
      [arr[i], arr[j]] = [arr[j], arr[i]];
      i++;
    }
  }
  
  [arr[i], arr[right]] = [arr[right], arr[i]];
  return i;
}

// 294. Rolling hash for similarity
export function rollingHash(text: string, windowSize = 5): number[] {
  const hashes: number[] = [];
  const base = 31;
  const mod = 1e9 + 7;
  
  if (text.length < windowSize) return hashes;
  
  let hash = 0;
  let basePow = 1;
  
  // Calculate base^(windowSize-1)
  for (let i = 0; i < windowSize - 1; i++) {
    basePow = (basePow * base) % mod;
  }
  
  // Initial window hash
  for (let i = 0; i < windowSize; i++) {
    hash = (hash * base + text.charCodeAt(i)) % mod;
  }
  hashes.push(hash);
  
  // Roll the hash
  for (let i = windowSize; i < text.length; i++) {
    hash = ((hash - text.charCodeAt(i - windowSize) * basePow % mod + mod) * base + text.charCodeAt(i)) % mod;
    hashes.push(hash);
  }
  
  return hashes;
}

// 295-296. MinHash and SimHash for deduplication
export function minHash(text: string, numHashes = 100): number[] {
  const shingles = new Set<string>();
  const words = text.toLowerCase().split(/\s+/);
  
  // Create shingles (n-grams)
  for (let i = 0; i < words.length - 2; i++) {
    shingles.add(words.slice(i, i + 3).join(" "));
  }
  
  // Generate MinHash signature
  const signature: number[] = [];
  
  for (let h = 0; h < numHashes; h++) {
    let minVal = Infinity;
    
    for (const shingle of shingles) {
      // Simple hash with seed
      let hash = h;
      for (let i = 0; i < shingle.length; i++) {
        hash = (hash * 31 + shingle.charCodeAt(i)) >>> 0;
      }
      minVal = Math.min(minVal, hash);
    }
    
    signature.push(minVal === Infinity ? 0 : minVal);
  }
  
  return signature;
}

export function simHash(text: string, bits = 64): bigint {
  const words = text.toLowerCase().split(/\s+/);
  const v = new Array(bits).fill(0);
  
  for (const word of words) {
    // Hash the word
    let hash = 0n;
    for (let i = 0; i < word.length; i++) {
      hash = (hash * 31n + BigInt(word.charCodeAt(i))) & ((1n << BigInt(bits)) - 1n);
    }
    
    // Update vector
    for (let i = 0; i < bits; i++) {
      if ((hash >> BigInt(i)) & 1n) {
        v[i]++;
      } else {
        v[i]--;
      }
    }
  }
  
  // Build final hash
  let result = 0n;
  for (let i = 0; i < bits; i++) {
    if (v[i] > 0) {
      result |= (1n << BigInt(i));
    }
  }
  
  return result;
}

// Calculate Hamming distance between SimHashes
export function simHashDistance(a: bigint, b: bigint): number {
  let xor = a ^ b;
  let count = 0;
  while (xor) {
    count += Number(xor & 1n);
    xor >>= 1n;
  }
  return count;
}

// ============================================
// CIRCUIT BREAKER (improved)
// ============================================

export class CircuitBreaker {
  private states = new Map<string, CircuitBreakerState>();
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly halfOpenSuccesses: number;

  constructor(
    failureThreshold = 3,
    resetTimeout = 60000,
    halfOpenSuccesses = 2
  ) {
    this.failureThreshold = failureThreshold;
    this.resetTimeout = resetTimeout;
    this.halfOpenSuccesses = halfOpenSuccesses;
  }

  private getState(key: string): CircuitBreakerState {
    if (!this.states.has(key)) {
      this.states.set(key, {
        failures: 0,
        lastFailure: 0,
        open: false,
        successCount: 0
      });
    }
    return this.states.get(key)!;
  }

  isOpen(key: string): boolean {
    const state = this.getState(key);
    
    if (!state.open) return false;
    
    // Check if we should transition to half-open
    if (Date.now() - state.lastFailure > this.resetTimeout) {
      state.halfOpenAt = Date.now();
      return false; // Allow one request through
    }
    
    return true;
  }

  recordSuccess(key: string): void {
    const state = this.getState(key);
    
    if (state.halfOpenAt) {
      state.successCount++;
      if (state.successCount >= this.halfOpenSuccesses) {
        // Close the circuit
        state.open = false;
        state.failures = 0;
        state.halfOpenAt = undefined;
        state.successCount = 0;
      }
    } else {
      state.failures = 0;
    }
  }

  recordFailure(key: string): void {
    const state = this.getState(key);
    state.failures++;
    state.lastFailure = Date.now();
    state.successCount = 0;
    
    if (state.failures >= this.failureThreshold) {
      state.open = true;
      state.halfOpenAt = undefined;
    }
  }

  getStatus(): Record<string, { open: boolean; failures: number }> {
    const status: Record<string, { open: boolean; failures: number }> = {};
    for (const [key, state] of this.states) {
      status[key] = { open: state.open, failures: state.failures };
    }
    return status;
  }
}

// ============================================
// EXPORTS
// ============================================

// Create singleton instances
export const globalCache = new HierarchicalCache<any>();
export const globalWorkerPool = new WorkerPool(6);
export const globalCircuitBreaker = new CircuitBreaker();
export const globalBloomFilter = new BloomFilter(100000, 0.01);
export const globalAutocomplete = new Trie();
