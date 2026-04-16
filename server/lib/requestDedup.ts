/**
 * Request deduplication to prevent duplicate concurrent requests.
 * Coalesces identical in-flight requests to single execution.
 */
import * as crypto from "crypto";

const DEDUP_TTL_MS = parseInt(process.env.DEDUP_TTL_MS || "30000", 10);
const DEDUP_MAX_PENDING = parseInt(process.env.DEDUP_MAX_PENDING || "1000", 10);
const DEDUP_CLEANUP_INTERVAL_MS = parseInt(process.env.DEDUP_CLEANUP_INTERVAL_MS || "60000", 10);

interface PendingRequest<T> {
  promise: Promise<T>;
  startedAt: number;
  subscriberCount: number;
}

interface DedupStats {
  coalescedRequests: number;
  uniqueRequests: number;
  activeInflight: number;
  totalSaved: number;
  averageSubscribers: number;
}

class RequestDeduplicator {
  private static instance: RequestDeduplicator | null = null;
  private pendingRequests = new Map<string, PendingRequest<unknown>>();
  private stats = {
    coalescedRequests: 0,
    uniqueRequests: 0,
    totalSubscribers: 0,
  };
  private cleanupInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.startCleanup();
  }

  static getInstance(): RequestDeduplicator {
    if (!RequestDeduplicator.instance) {
      RequestDeduplicator.instance = new RequestDeduplicator();
    }
    return RequestDeduplicator.instance;
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const entries = Array.from(this.pendingRequests.entries());
      for (const [key, pending] of entries) {
        if (now - pending.startedAt > DEDUP_TTL_MS * 2) {
          this.pendingRequests.delete(key);
        }
      }
    }, DEDUP_CLEANUP_INTERVAL_MS);

    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  generateKey(
    method: string,
    path: string,
    params?: Record<string, unknown>,
    body?: unknown
  ): string {
    const parts = [method.toUpperCase(), path];

    if (params && Object.keys(params).length > 0) {
      const sortedParams = Object.keys(params)
        .sort()
        .map((k) => `${k}=${JSON.stringify(params[k])}`)
        .join("&");
      parts.push(sortedParams);
    }

    if (body !== undefined && body !== null) {
      parts.push(JSON.stringify(body));
    }

    return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
  }

  async dedupe<T>(key: string, executor: () => Promise<T>): Promise<T> {
    const existing = this.pendingRequests.get(key) as PendingRequest<T> | undefined;

    if (existing) {
      existing.subscriberCount++;
      this.stats.coalescedRequests++;
      this.stats.totalSubscribers++;

      console.log(
        JSON.stringify({
          level: "debug",
          event: "REQUEST_DEDUP_COALESCED",
          key: key.substring(0, 16),
          subscribers: existing.subscriberCount,
          timestamp: new Date().toISOString(),
        })
      );

      return existing.promise;
    }

    if (this.pendingRequests.size >= DEDUP_MAX_PENDING) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "REQUEST_DEDUP_LIMIT_REACHED",
          limit: DEDUP_MAX_PENDING,
          timestamp: new Date().toISOString(),
        })
      );
      return executor();
    }

    this.stats.uniqueRequests++;

    const promise = executor().finally(() => {
      this.pendingRequests.delete(key);
    });

    const pending: PendingRequest<T> = {
      promise,
      startedAt: Date.now(),
      subscriberCount: 1,
    };

    this.pendingRequests.set(key, pending as PendingRequest<unknown>);

    return promise;
  }

  async dedupeWithTimeout<T>(
    key: string,
    executor: () => Promise<T>,
    timeoutMs: number = DEDUP_TTL_MS
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Request deduplication timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    return Promise.race([this.dedupe(key, executor), timeoutPromise]);
  }

  isInflight(key: string): boolean {
    return this.pendingRequests.has(key);
  }

  getInflightCount(): number {
    return this.pendingRequests.size;
  }

  getStats(): DedupStats {
    const activeInflight = this.pendingRequests.size;
    const avgSubscribers =
      this.stats.uniqueRequests > 0
        ? this.stats.totalSubscribers / this.stats.uniqueRequests
        : 0;

    return {
      coalescedRequests: this.stats.coalescedRequests,
      uniqueRequests: this.stats.uniqueRequests,
      activeInflight,
      totalSaved: this.stats.coalescedRequests,
      averageSubscribers: Math.round(avgSubscribers * 100) / 100,
    };
  }

  resetStats(): void {
    this.stats = {
      coalescedRequests: 0,
      uniqueRequests: 0,
      totalSubscribers: 0,
    };
  }

  cancelInflight(key: string): boolean {
    return this.pendingRequests.delete(key);
  }

  clearAll(): void {
    this.pendingRequests.clear();
  }

  close(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.pendingRequests.clear();
  }
}

export const requestDedup = RequestDeduplicator.getInstance();

export function dedupe<T>(key: string, executor: () => Promise<T>): Promise<T> {
  return requestDedup.dedupe(key, executor);
}

export function dedupeRequest<T>(
  method: string,
  path: string,
  executor: () => Promise<T>,
  options: {
    params?: Record<string, unknown>;
    body?: unknown;
    timeout?: number;
  } = {}
): Promise<T> {
  const key = requestDedup.generateKey(method, path, options.params, options.body);

  if (options.timeout) {
    return requestDedup.dedupeWithTimeout(key, executor, options.timeout);
  }

  return requestDedup.dedupe(key, executor);
}

export function createDedupedFunction<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  keyGenerator: (...args: TArgs) => string
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => {
    const key = keyGenerator(...args);
    return requestDedup.dedupe(key, () => fn(...args));
  };
}

export function getDedupStats(): DedupStats {
  return requestDedup.getStats();
}
