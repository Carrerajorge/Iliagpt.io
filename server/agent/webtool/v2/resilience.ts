import { z } from "zod";
import { createHash } from "crypto";
import { EventEmitter } from "events";

export const JitterTypeSchema = z.enum(["full", "decorrelated"]);
export type JitterType = z.infer<typeof JitterTypeSchema>;

export const BackoffConfigSchema = z.object({
  baseMs: z.number().int().positive().default(100),
  maxMs: z.number().int().positive().default(10000),
  multiplier: z.number().positive().default(2),
  jitterType: JitterTypeSchema.default("full"),
});
export type BackoffConfig = z.infer<typeof BackoffConfigSchema>;

export const HedgeConfigSchema = z.object({
  hedgeDelayMs: z.number().int().nonnegative().default(100),
  maxConcurrentHedges: z.number().int().positive().default(10),
  maxHedgePercentage: z.number().min(0).max(1).default(0.1),
  windowMs: z.number().int().positive().default(60000),
});
export type HedgeConfig = z.infer<typeof HedgeConfigSchema>;

export const HedgeMetricsSchema = z.object({
  hedgeTriggeredCount: z.number(),
  hedgeWonCount: z.number(),
  totalRequests: z.number(),
  latencyImprovementMs: z.number(),
  currentConcurrentHedges: z.number(),
  hedgeRatio: z.number(),
});
export type HedgeMetrics = z.infer<typeof HedgeMetricsSchema>;

export const DeduplicatorConfigSchema = z.object({
  ttlMs: z.number().int().positive().default(100),
  maxPendingKeys: z.number().int().positive().default(10000),
  cleanupIntervalMs: z.number().int().positive().default(5000),
});
export type DeduplicatorConfig = z.infer<typeof DeduplicatorConfigSchema>;

export const ErrorTypeForRetrySchema = z.enum([
  "network",
  "timeout",
  "rate_limit",
  "server_error",
  "unknown",
]);
export type ErrorTypeForRetry = z.infer<typeof ErrorTypeForRetrySchema>;

export const RetryPolicyConfigSchema = z.object({
  maxRetriesByErrorType: z.record(ErrorTypeForRetrySchema, z.number().int().nonnegative()).default({
    network: 3,
    timeout: 2,
    rate_limit: 1,
    server_error: 2,
    unknown: 1,
  }),
  backoffConfig: BackoffConfigSchema.default({}),
  retryableStatusCodes: z.array(z.number()).default([429, 500, 502, 503, 504, 408]),
});
export type RetryPolicyConfig = z.infer<typeof RetryPolicyConfigSchema>;

const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
  baseMs: 100,
  maxMs: 10000,
  multiplier: 2,
  jitterType: "full",
};

export class BackoffWithJitter {
  private config: BackoffConfig;
  private previousDelay: number;

  constructor(config: Partial<BackoffConfig> = {}) {
    this.config = { ...DEFAULT_BACKOFF_CONFIG, ...config };
    this.previousDelay = this.config.baseMs;
  }

  getDelay(attempt: number): number {
    if (attempt < 0) {
      throw new Error("Attempt must be non-negative");
    }

    if (this.config.jitterType === "decorrelated") {
      return this.getDecorrelatedDelay();
    }

    return this.getFullJitterDelay(attempt);
  }

  private getFullJitterDelay(attempt: number): number {
    const exponentialDelay = this.config.baseMs * Math.pow(this.config.multiplier, attempt);
    const cappedDelay = Math.min(exponentialDelay, this.config.maxMs);
    const jitteredDelay = Math.random() * cappedDelay;
    return Math.floor(jitteredDelay);
  }

  private getDecorrelatedDelay(): number {
    const minDelay = this.config.baseMs;
    const maxDelay = Math.min(this.previousDelay * 3, this.config.maxMs);
    const delay = minDelay + Math.random() * (maxDelay - minDelay);
    this.previousDelay = delay;
    return Math.floor(delay);
  }

  reset(): void {
    this.previousDelay = this.config.baseMs;
  }

  getConfig(): BackoffConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<BackoffConfig>): void {
    this.config = { ...this.config, ...config };
    this.reset();
  }
}

interface HedgeState {
  triggeredAt: number;
  primaryStartedAt: number;
  primaryCompletedAt?: number;
  hedgeCompletedAt?: number;
  hedgeWon: boolean;
}

const DEFAULT_HEDGE_CONFIG: HedgeConfig = {
  hedgeDelayMs: 100,
  maxConcurrentHedges: 10,
  maxHedgePercentage: 0.1,
  windowMs: 60000,
};

export class HedgedRequestManager extends EventEmitter {
  private config: HedgeConfig;
  private concurrentHedges: number = 0;
  private requestTimestamps: number[] = [];
  private hedgeTimestamps: number[] = [];
  private hedgeWonCount: number = 0;
  private totalLatencyImprovement: number = 0;
  private activeHedges: Map<string, AbortController> = new Map();

  constructor(config: Partial<HedgeConfig> = {}) {
    super();
    this.config = { ...DEFAULT_HEDGE_CONFIG, ...config };
  }

  async executeWithHedge<T>(
    primaryFn: (signal?: AbortSignal) => Promise<T>,
    hedgeFn: (signal?: AbortSignal) => Promise<T>,
    options: { requestId?: string } = {}
  ): Promise<T> {
    const requestId = options.requestId || this.generateRequestId();
    const startTime = Date.now();

    this.recordRequest();

    if (!this.canStartHedge()) {
      return primaryFn();
    }

    const primaryController = new AbortController();
    const hedgeController = new AbortController();

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let hedgeTriggered = false;
      let primaryResult: { value: T; time: number } | null = null;
      let hedgeResult: { value: T; time: number } | null = null;

      const settle = (value: T, source: "primary" | "hedge") => {
        if (settled) return;
        settled = true;

        primaryController.abort();
        hedgeController.abort();
        this.activeHedges.delete(requestId);

        if (hedgeTriggered) {
          this.concurrentHedges = Math.max(0, this.concurrentHedges - 1);

          if (source === "hedge" && primaryResult) {
            this.hedgeWonCount++;
            const improvement = primaryResult.time - (Date.now() - startTime);
            if (improvement > 0) {
              this.totalLatencyImprovement += improvement;
            }
            this.emit("hedge_won", { requestId, improvementMs: improvement });
          }
        }

        resolve(value);
      };

      const handleError = (error: any, source: "primary" | "hedge") => {
        if (settled) return;

        if (source === "primary" && !hedgeTriggered) {
          settled = true;
          reject(error);
          return;
        }

        if (source === "primary" && hedgeResult) {
          settle(hedgeResult.value, "hedge");
          return;
        }

        if (source === "hedge" && primaryResult) {
          settle(primaryResult.value, "primary");
          return;
        }

        if (source === "primary" && !primaryResult && !hedgeResult) {
          settled = true;
          reject(error);
        }
      };

      primaryFn(primaryController.signal)
        .then((value) => {
          primaryResult = { value, time: Date.now() - startTime };
          settle(value, "primary");
        })
        .catch((error) => {
          if (error.name === "AbortError") return;
          handleError(error, "primary");
        });

      const hedgeTimeout = setTimeout(() => {
        if (settled) return;

        hedgeTriggered = true;
        this.concurrentHedges++;
        this.recordHedge();
        this.activeHedges.set(requestId, hedgeController);
        this.emit("hedge_triggered", { requestId });

        hedgeFn(hedgeController.signal)
          .then((value) => {
            hedgeResult = { value, time: Date.now() - startTime };
            if (!settled) {
              settle(value, "hedge");
            }
          })
          .catch((error) => {
            if (error.name === "AbortError") return;
            handleError(error, "hedge");
          });
      }, this.config.hedgeDelayMs);

      primaryController.signal.addEventListener("abort", () => {
        clearTimeout(hedgeTimeout);
      });
    });
  }

  private canStartHedge(): boolean {
    if (this.concurrentHedges >= this.config.maxConcurrentHedges) {
      return false;
    }

    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    this.requestTimestamps = this.requestTimestamps.filter((t) => t > windowStart);
    this.hedgeTimestamps = this.hedgeTimestamps.filter((t) => t > windowStart);

    const totalRequests = this.requestTimestamps.length;
    const totalHedges = this.hedgeTimestamps.length;

    if (totalRequests === 0) {
      return true;
    }

    const currentRatio = totalHedges / totalRequests;
    return currentRatio < this.config.maxHedgePercentage;
  }

  private recordRequest(): void {
    this.requestTimestamps.push(Date.now());
  }

  private recordHedge(): void {
    this.hedgeTimestamps.push(Date.now());
  }

  private generateRequestId(): string {
    return createHash("sha256")
      .update(`${Date.now()}-${Math.random()}`)
      .digest("hex")
      .slice(0, 16);
  }

  cancelHedge(requestId: string): boolean {
    const controller = this.activeHedges.get(requestId);
    if (controller) {
      controller.abort();
      this.activeHedges.delete(requestId);
      this.concurrentHedges = Math.max(0, this.concurrentHedges - 1);
      return true;
    }
    return false;
  }

  getMetrics(): HedgeMetrics {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    const recentRequests = this.requestTimestamps.filter((t) => t > windowStart).length;
    const recentHedges = this.hedgeTimestamps.filter((t) => t > windowStart).length;

    return {
      hedgeTriggeredCount: recentHedges,
      hedgeWonCount: this.hedgeWonCount,
      totalRequests: recentRequests,
      latencyImprovementMs: this.totalLatencyImprovement,
      currentConcurrentHedges: this.concurrentHedges,
      hedgeRatio: recentRequests > 0 ? recentHedges / recentRequests : 0,
    };
  }

  setHedgeDelay(delayMs: number): void {
    this.config.hedgeDelayMs = delayMs;
  }

  getConfig(): HedgeConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<HedgeConfig>): void {
    this.config = { ...this.config, ...config };
  }

  reset(): void {
    for (const controller of this.activeHedges.values()) {
      controller.abort();
    }
    this.activeHedges.clear();
    this.concurrentHedges = 0;
    this.requestTimestamps = [];
    this.hedgeTimestamps = [];
    this.hedgeWonCount = 0;
    this.totalLatencyImprovement = 0;
  }
}

interface PendingRequest<T> {
  key: string;
  promise: Promise<T>;
  createdAt: number;
  subscriberCount: number;
}

const DEFAULT_DEDUPLICATOR_CONFIG: DeduplicatorConfig = {
  ttlMs: 100,
  maxPendingKeys: 10000,
  cleanupIntervalMs: 5000,
};

export class RequestDeduplicator {
  private pending: Map<string, PendingRequest<any>> = new Map();
  private config: DeduplicatorConfig;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private dedupeCount: number = 0;
  private missCount: number = 0;

  constructor(config: Partial<DeduplicatorConfig> = {}) {
    this.config = { ...DEFAULT_DEDUPLICATOR_CONFIG, ...config };
    this.startCleanup();
  }

  async dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hashedKey = this.hashKey(key);
    const now = Date.now();

    const existing = this.pending.get(hashedKey);
    if (existing && now - existing.createdAt < this.config.ttlMs) {
      existing.subscriberCount++;
      this.dedupeCount++;
      return existing.promise;
    }

    if (this.pending.size >= this.config.maxPendingKeys) {
      this.evictOldest();
    }

    this.missCount++;

    const promise = fn().finally(() => {
      setTimeout(() => {
        const current = this.pending.get(hashedKey);
        if (current && current.promise === promise) {
          this.pending.delete(hashedKey);
        }
      }, this.config.ttlMs);
    });

    const pendingRequest: PendingRequest<T> = {
      key: hashedKey,
      promise,
      createdAt: now,
      subscriberCount: 1,
    };

    this.pending.set(hashedKey, pendingRequest);

    return promise;
  }

  private hashKey(key: string): string {
    return createHash("sha256").update(key).digest("hex").slice(0, 24);
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, request] of this.pending) {
      if (request.createdAt < oldestTime) {
        oldestTime = request.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.pending.delete(oldestKey);
    }
  }

  private startCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.cleanupTimer = setInterval(() => this.cleanup(), this.config.cleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, request] of this.pending) {
      if (now - request.createdAt > this.config.ttlMs * 2) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.pending.delete(key);
    }
  }

  isPending(key: string): boolean {
    const hashedKey = this.hashKey(key);
    const existing = this.pending.get(hashedKey);
    if (!existing) return false;
    return Date.now() - existing.createdAt < this.config.ttlMs;
  }

  getStats(): {
    pendingCount: number;
    dedupeCount: number;
    missCount: number;
    dedupeRatio: number;
  } {
    const total = this.dedupeCount + this.missCount;
    return {
      pendingCount: this.pending.size,
      dedupeCount: this.dedupeCount,
      missCount: this.missCount,
      dedupeRatio: total > 0 ? this.dedupeCount / total : 0,
    };
  }

  getConfig(): DeduplicatorConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<DeduplicatorConfig>): void {
    this.config = { ...this.config, ...config };
    this.startCleanup();
  }

  clear(): void {
    this.pending.clear();
  }

  resetStats(): void {
    this.dedupeCount = 0;
    this.missCount = 0;
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.pending.clear();
  }
}

const DEFAULT_RETRY_POLICY_CONFIG: RetryPolicyConfig = {
  maxRetriesByErrorType: {
    network: 3,
    timeout: 2,
    rate_limit: 1,
    server_error: 2,
    unknown: 1,
  },
  backoffConfig: DEFAULT_BACKOFF_CONFIG,
  retryableStatusCodes: [429, 500, 502, 503, 504, 408],
};

export class RetryPolicy {
  private config: RetryPolicyConfig;
  private backoff: BackoffWithJitter;

  constructor(config: Partial<RetryPolicyConfig> = {}) {
    this.config = {
      ...DEFAULT_RETRY_POLICY_CONFIG,
      ...config,
      maxRetriesByErrorType: {
        ...DEFAULT_RETRY_POLICY_CONFIG.maxRetriesByErrorType,
        ...config.maxRetriesByErrorType,
      },
      backoffConfig: {
        ...DEFAULT_RETRY_POLICY_CONFIG.backoffConfig,
        ...config.backoffConfig,
      },
    };
    this.backoff = new BackoffWithJitter(this.config.backoffConfig);
  }

  shouldRetry(error: Error | { statusCode?: number; code?: string }, attempt: number): boolean {
    const errorType = this.categorizeError(error);
    const maxRetries = this.config.maxRetriesByErrorType[errorType] ?? 0;
    return attempt < maxRetries;
  }

  getDelay(error: Error | { statusCode?: number; code?: string }, attempt: number): number {
    const errorType = this.categorizeError(error);

    if (errorType === "rate_limit") {
      const retryAfter = this.extractRetryAfter(error);
      if (retryAfter !== undefined) {
        return retryAfter * 1000;
      }
      return Math.min(this.backoff.getDelay(attempt) * 2, this.config.backoffConfig.maxMs);
    }

    if (errorType === "timeout") {
      return this.backoff.getDelay(attempt) * 0.5;
    }

    return this.backoff.getDelay(attempt);
  }

  private categorizeError(error: Error | { statusCode?: number; code?: string; message?: string }): ErrorTypeForRetry {
    const statusCode = (error as any).statusCode;
    const code = (error as any).code;
    const message = (error as any).message || "";

    if (statusCode === 429) {
      return "rate_limit";
    }

    if (statusCode && statusCode >= 500 && statusCode < 600) {
      return "server_error";
    }

    if (statusCode === 408 || code === "ETIMEDOUT" || message.toLowerCase().includes("timeout")) {
      return "timeout";
    }

    const networkCodes = new Set([
      "ECONNRESET",
      "ECONNREFUSED",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ENETUNREACH",
      "EHOSTUNREACH",
    ]);

    if (code && networkCodes.has(code.toUpperCase())) {
      return "network";
    }

    const lowerMessage = message.toLowerCase();
    if (
      lowerMessage.includes("network") ||
      lowerMessage.includes("connection") ||
      lowerMessage.includes("socket")
    ) {
      return "network";
    }

    return "unknown";
  }

  private extractRetryAfter(error: any): number | undefined {
    const retryAfter = error.retryAfter || error.headers?.["retry-after"];
    if (!retryAfter) return undefined;

    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds) && seconds > 0) {
      return seconds;
    }

    const date = Date.parse(retryAfter);
    if (!isNaN(date)) {
      const delayMs = date - Date.now();
      if (delayMs > 0) {
        return Math.ceil(delayMs / 1000);
      }
    }

    return undefined;
  }

  isRetryableStatusCode(statusCode: number): boolean {
    return this.config.retryableStatusCodes.includes(statusCode);
  }

  getMaxRetries(errorType: ErrorTypeForRetry): number {
    return this.config.maxRetriesByErrorType[errorType] ?? 0;
  }

  reset(): void {
    this.backoff.reset();
  }

  getConfig(): RetryPolicyConfig {
    return {
      ...this.config,
      maxRetriesByErrorType: { ...this.config.maxRetriesByErrorType },
      backoffConfig: { ...this.config.backoffConfig },
    };
  }

  updateConfig(config: Partial<RetryPolicyConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      maxRetriesByErrorType: {
        ...this.config.maxRetriesByErrorType,
        ...config.maxRetriesByErrorType,
      },
      backoffConfig: {
        ...this.config.backoffConfig,
        ...config.backoffConfig,
      },
    };
    this.backoff = new BackoffWithJitter(this.config.backoffConfig);
  }
}

export const backoffWithJitter = new BackoffWithJitter();
export const hedgedRequestManager = new HedgedRequestManager();
export const requestDeduplicator = new RequestDeduplicator();
export const retryPolicy = new RetryPolicy();
