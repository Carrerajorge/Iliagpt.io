import { z } from "zod";
import { createHash } from "crypto";

export const CircuitStateSchema = z.enum(["closed", "open", "half-open"]);
export type CircuitState = z.infer<typeof CircuitStateSchema>;

export const ErrorTypeSchema = z.enum([
  "timeout",
  "network",
  "rate_limit",
  "forbidden",
  "not_found",
  "server_error",
  "unknown",
]);
export type ErrorType = z.infer<typeof ErrorTypeSchema>;

export const DomainCircuitBreakerConfigSchema = z.object({
  failureThreshold: z.number().int().positive().default(5),
  resetTimeoutMs: z.number().int().positive().default(30000),
  halfOpenSuccessThreshold: z.number().int().positive().default(2),
  trackingWindowMs: z.number().int().positive().default(60000),
});
export type DomainCircuitBreakerConfig = z.infer<typeof DomainCircuitBreakerConfigSchema>;

export const DomainStatusSchema = z.object({
  state: CircuitStateSchema,
  failures: z.number(),
  lastFailure: z.number().nullable(),
  successesSinceHalfOpen: z.number(),
  lastErrorType: ErrorTypeSchema.optional(),
  openedAt: z.number().nullable(),
});
export type DomainStatus = z.infer<typeof DomainStatusSchema>;

export const NegativeCacheConfigSchema = z.object({
  ttl404Ms: z.number().int().positive().default(5 * 60 * 1000),
  ttl403Ms: z.number().int().positive().default(10 * 60 * 1000),
  ttl429Ms: z.number().int().positive().default(60 * 1000),
  maxEntries: z.number().int().positive().default(10000),
  cleanupIntervalMs: z.number().int().positive().default(60000),
});
export type NegativeCacheConfig = z.infer<typeof NegativeCacheConfigSchema>;

export const NegativeCacheEntrySchema = z.object({
  urlHash: z.string(),
  statusCode: z.number(),
  cachedAt: z.number(),
  expiresAt: z.number(),
  retryAfter: z.number().optional(),
});
export type NegativeCacheEntry = z.infer<typeof NegativeCacheEntrySchema>;

export const StaleWhileRevalidateConfigSchema = z.object({
  staleTtlMs: z.number().int().positive().default(5 * 60 * 1000),
  maxRevalidationConcurrency: z.number().int().positive().default(5),
  revalidationTimeoutMs: z.number().int().positive().default(30000),
});
export type StaleWhileRevalidateConfig = z.infer<typeof StaleWhileRevalidateConfigSchema>;

export const StaleEntryResultSchema = z.object({
  entry: z.any().nullable(),
  isStale: z.boolean(),
  needsRevalidation: z.boolean(),
});
export type StaleEntryResult = z.infer<typeof StaleEntryResultSchema>;

interface DomainState {
  failures: number;
  lastFailure: number | null;
  state: CircuitState;
  successesSinceHalfOpen: number;
  lastErrorType?: ErrorType;
  openedAt: number | null;
  failureTimestamps: number[];
}

const DEFAULT_CIRCUIT_BREAKER_CONFIG: DomainCircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenSuccessThreshold: 2,
  trackingWindowMs: 60000,
};

export class DomainCircuitBreaker {
  private domains: Map<string, DomainState> = new Map();
  private config: DomainCircuitBreakerConfig;

  constructor(config: Partial<DomainCircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  private extractDomain(urlOrDomain: string): string {
    try {
      if (urlOrDomain.includes("://")) {
        const url = new URL(urlOrDomain);
        return url.hostname.toLowerCase();
      }
      return urlOrDomain.toLowerCase();
    } catch {
      return urlOrDomain.toLowerCase();
    }
  }

  private getDomainState(domain: string): DomainState {
    const normalizedDomain = this.extractDomain(domain);
    if (!this.domains.has(normalizedDomain)) {
      this.domains.set(normalizedDomain, {
        failures: 0,
        lastFailure: null,
        state: "closed",
        successesSinceHalfOpen: 0,
        openedAt: null,
        failureTimestamps: [],
      });
    }
    return this.domains.get(normalizedDomain)!;
  }

  private pruneOldFailures(state: DomainState): void {
    const cutoff = Date.now() - this.config.trackingWindowMs;
    state.failureTimestamps = state.failureTimestamps.filter(ts => ts > cutoff);
    state.failures = state.failureTimestamps.length;
  }

  canExecute(domain: string): boolean {
    const normalizedDomain = this.extractDomain(domain);
    const state = this.getDomainState(normalizedDomain);
    const now = Date.now();

    if (state.state === "open") {
      if (state.openedAt && now - state.openedAt >= this.config.resetTimeoutMs) {
        state.state = "half-open";
        state.successesSinceHalfOpen = 0;
        console.log(`[DomainCircuitBreaker] ${normalizedDomain}: open -> half-open`);
        return true;
      }
      return false;
    }

    if (state.state === "half-open") {
      return true;
    }

    this.pruneOldFailures(state);
    return true;
  }

  recordSuccess(domain: string): void {
    const normalizedDomain = this.extractDomain(domain);
    const state = this.getDomainState(normalizedDomain);

    if (state.state === "half-open") {
      state.successesSinceHalfOpen++;
      if (state.successesSinceHalfOpen >= this.config.halfOpenSuccessThreshold) {
        state.state = "closed";
        state.failures = 0;
        state.failureTimestamps = [];
        state.openedAt = null;
        state.lastErrorType = undefined;
        console.log(`[DomainCircuitBreaker] ${normalizedDomain}: half-open -> closed (recovered)`);
      }
    } else if (state.state === "closed") {
      this.pruneOldFailures(state);
    }
  }

  recordFailure(domain: string, errorType: ErrorType = "unknown"): void {
    const normalizedDomain = this.extractDomain(domain);
    const state = this.getDomainState(normalizedDomain);
    const now = Date.now();

    state.failureTimestamps.push(now);
    state.lastFailure = now;
    state.lastErrorType = errorType;

    this.pruneOldFailures(state);

    if (state.state === "half-open") {
      state.state = "open";
      state.openedAt = now;
      console.log(`[DomainCircuitBreaker] ${normalizedDomain}: half-open -> open (failure during recovery)`);
    } else if (state.state === "closed" && state.failures >= this.config.failureThreshold) {
      state.state = "open";
      state.openedAt = now;
      console.log(`[DomainCircuitBreaker] ${normalizedDomain}: closed -> open (threshold reached: ${state.failures})`);
    }
  }

  getStatus(domain: string): DomainStatus {
    const normalizedDomain = this.extractDomain(domain);
    const state = this.getDomainState(normalizedDomain);
    this.pruneOldFailures(state);

    return {
      state: state.state,
      failures: state.failures,
      lastFailure: state.lastFailure,
      successesSinceHalfOpen: state.successesSinceHalfOpen,
      lastErrorType: state.lastErrorType,
      openedAt: state.openedAt,
    };
  }

  getAllOpenCircuits(): Array<{ domain: string; status: DomainStatus }> {
    const openCircuits: Array<{ domain: string; status: DomainStatus }> = [];

    for (const [domain, state] of this.domains) {
      if (state.state === "open" || state.state === "half-open") {
        this.pruneOldFailures(state);
        openCircuits.push({
          domain,
          status: {
            state: state.state,
            failures: state.failures,
            lastFailure: state.lastFailure,
            successesSinceHalfOpen: state.successesSinceHalfOpen,
            lastErrorType: state.lastErrorType,
            openedAt: state.openedAt,
          },
        });
      }
    }

    return openCircuits;
  }

  reset(domain?: string): void {
    if (domain) {
      const normalizedDomain = this.extractDomain(domain);
      this.domains.delete(normalizedDomain);
    } else {
      this.domains.clear();
    }
  }

  getConfig(): DomainCircuitBreakerConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<DomainCircuitBreakerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getStats(): {
    totalDomains: number;
    openCircuits: number;
    halfOpenCircuits: number;
    closedCircuits: number;
  } {
    let open = 0;
    let halfOpen = 0;
    let closed = 0;

    for (const state of this.domains.values()) {
      switch (state.state) {
        case "open":
          open++;
          break;
        case "half-open":
          halfOpen++;
          break;
        case "closed":
          closed++;
          break;
      }
    }

    return {
      totalDomains: this.domains.size,
      openCircuits: open,
      halfOpenCircuits: halfOpen,
      closedCircuits: closed,
    };
  }
}

const DEFAULT_NEGATIVE_CACHE_CONFIG: NegativeCacheConfig = {
  ttl404Ms: 5 * 60 * 1000,
  ttl403Ms: 10 * 60 * 1000,
  ttl429Ms: 60 * 1000,
  maxEntries: 10000,
  cleanupIntervalMs: 60000,
};

export class NegativeCache {
  private cache: Map<string, NegativeCacheEntry> = new Map();
  private config: NegativeCacheConfig;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<NegativeCacheConfig> = {}) {
    this.config = { ...DEFAULT_NEGATIVE_CACHE_CONFIG, ...config };
    this.startCleanup();
  }

  private startCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.cleanupTimer = setInterval(() => this.cleanup(), this.config.cleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  private hashUrl(url: string): string {
    return createHash("sha256").update(url.toLowerCase()).digest("hex").slice(0, 24);
  }

  private getTtlForStatus(statusCode: number): number {
    switch (statusCode) {
      case 404:
        return this.config.ttl404Ms;
      case 403:
        return this.config.ttl403Ms;
      case 429:
        return this.config.ttl429Ms;
      default:
        return this.config.ttl404Ms;
    }
  }

  isNegativelyCached(url: string): boolean {
    const urlHash = this.hashUrl(url);
    const entry = this.cache.get(urlHash);

    if (!entry) {
      return false;
    }

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.cache.delete(urlHash);
      return false;
    }

    return true;
  }

  getNegativeEntry(url: string): NegativeCacheEntry | null {
    const urlHash = this.hashUrl(url);
    const entry = this.cache.get(urlHash);

    if (!entry) {
      return null;
    }

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.cache.delete(urlHash);
      return null;
    }

    return { ...entry };
  }

  recordNegative(url: string, statusCode: number, retryAfter?: number): void {
    const urlHash = this.hashUrl(url);
    const now = Date.now();

    let ttlMs = this.getTtlForStatus(statusCode);

    if (statusCode === 429 && retryAfter !== undefined) {
      if (retryAfter > 0) {
        ttlMs = retryAfter * 1000;
      }
    }

    const entry: NegativeCacheEntry = {
      urlHash,
      statusCode,
      cachedAt: now,
      expiresAt: now + ttlMs,
      retryAfter: retryAfter !== undefined ? retryAfter : undefined,
    };

    if (this.cache.size >= this.config.maxEntries) {
      this.evictOldest();
    }

    this.cache.set(urlHash, entry);
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.cachedAt < oldestTime) {
        oldestTime = entry.cachedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): {
    entries: number;
    byStatusCode: Record<number, number>;
  } {
    const byStatusCode: Record<number, number> = {};

    for (const entry of this.cache.values()) {
      byStatusCode[entry.statusCode] = (byStatusCode[entry.statusCode] || 0) + 1;
    }

    return {
      entries: this.cache.size,
      byStatusCode,
    };
  }

  getConfig(): NegativeCacheConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<NegativeCacheConfig>): void {
    this.config = { ...this.config, ...config };
    this.startCleanup();
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cache.clear();
  }
}

interface StaleEntry {
  url: string;
  content: any;
  cachedAt: number;
  expiresAt: number;
  staleExpiresAt: number;
}

const DEFAULT_STALE_CONFIG: StaleWhileRevalidateConfig = {
  staleTtlMs: 5 * 60 * 1000,
  maxRevalidationConcurrency: 5,
  revalidationTimeoutMs: 30000,
};

export class StaleWhileRevalidateCache {
  private cache: Map<string, StaleEntry> = new Map();
  private revalidating: Set<string> = new Set();
  private config: StaleWhileRevalidateConfig;

  constructor(config: Partial<StaleWhileRevalidateConfig> = {}) {
    this.config = { ...DEFAULT_STALE_CONFIG, ...config };
  }

  private hashUrl(url: string): string {
    return createHash("sha256").update(url.toLowerCase()).digest("hex").slice(0, 24);
  }

  set(
    url: string,
    content: any,
    options: { ttlMs: number }
  ): void {
    const urlHash = this.hashUrl(url);
    const now = Date.now();

    const entry: StaleEntry = {
      url,
      content,
      cachedAt: now,
      expiresAt: now + options.ttlMs,
      staleExpiresAt: now + options.ttlMs + this.config.staleTtlMs,
    };

    this.cache.set(urlHash, entry);
  }

  getWithStale(url: string): StaleEntryResult {
    const urlHash = this.hashUrl(url);
    const entry = this.cache.get(urlHash);

    if (!entry) {
      return {
        entry: null,
        isStale: false,
        needsRevalidation: false,
      };
    }

    const now = Date.now();

    if (now > entry.staleExpiresAt) {
      this.cache.delete(urlHash);
      return {
        entry: null,
        isStale: false,
        needsRevalidation: false,
      };
    }

    const isStale = now > entry.expiresAt;
    const needsRevalidation = isStale && !this.revalidating.has(urlHash);

    return {
      entry: entry.content,
      isStale,
      needsRevalidation,
    };
  }

  async backgroundRevalidate(
    url: string,
    fetchFn: () => Promise<any>,
    ttlMs: number = 60000
  ): Promise<void> {
    const urlHash = this.hashUrl(url);

    if (this.revalidating.has(urlHash)) {
      return;
    }

    if (this.revalidating.size >= this.config.maxRevalidationConcurrency) {
      console.log(`[StaleWhileRevalidate] Max concurrency reached, skipping revalidation for: ${urlHash.slice(0, 8)}...`);
      return;
    }

    this.revalidating.add(urlHash);

    const revalidate = async () => {
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Revalidation timeout")), this.config.revalidationTimeoutMs);
        });

        const content = await Promise.race([fetchFn(), timeoutPromise]);

        this.set(url, content, { ttlMs });
        console.log(`[StaleWhileRevalidate] Successfully revalidated: ${urlHash.slice(0, 8)}...`);
      } catch (error) {
        console.error(`[StaleWhileRevalidate] Revalidation failed for ${urlHash.slice(0, 8)}...:`, error instanceof Error ? error.message : error);
      } finally {
        this.revalidating.delete(urlHash);
      }
    };

    setImmediate(revalidate);
  }

  isRevalidating(url: string): boolean {
    const urlHash = this.hashUrl(url);
    return this.revalidating.has(urlHash);
  }

  invalidate(url: string): boolean {
    const urlHash = this.hashUrl(url);
    return this.cache.delete(urlHash);
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): {
    entries: number;
    staleEntries: number;
    revalidatingCount: number;
  } {
    const now = Date.now();
    let staleCount = 0;

    for (const entry of this.cache.values()) {
      if (now > entry.expiresAt && now <= entry.staleExpiresAt) {
        staleCount++;
      }
    }

    return {
      entries: this.cache.size,
      staleEntries: staleCount,
      revalidatingCount: this.revalidating.size,
    };
  }

  getConfig(): StaleWhileRevalidateConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<StaleWhileRevalidateConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export const domainCircuitBreaker = new DomainCircuitBreaker();
export const negativeCache = new NegativeCache();
export const staleWhileRevalidateCache = new StaleWhileRevalidateCache();

export function categorizeHttpError(statusCode: number): ErrorType {
  if (statusCode === 429) return "rate_limit";
  if (statusCode === 403) return "forbidden";
  if (statusCode === 404) return "not_found";
  if (statusCode >= 500) return "server_error";
  if (statusCode === 0 || statusCode === 408) return "timeout";
  return "unknown";
}

export function parseRetryAfter(retryAfterHeader: string | undefined): number | undefined {
  if (!retryAfterHeader) {
    return undefined;
  }

  const seconds = parseInt(retryAfterHeader, 10);
  if (!isNaN(seconds) && seconds > 0) {
    return seconds;
  }

  const date = Date.parse(retryAfterHeader);
  if (!isNaN(date)) {
    const delayMs = date - Date.now();
    if (delayMs > 0) {
      return Math.ceil(delayMs / 1000);
    }
  }

  return undefined;
}
