import crypto from "crypto";

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  halfOpenMaxCalls: number;
  resetTimeoutMs: number;
  monitorIntervalMs: number;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  exponentialBase: number;
  jitterFactor: number;
}

export interface HealthCheckResult {
  healthy: boolean;
  latencyMs: number;
  errorMessage?: string;
  lastCheckedAt: string;
  consecutiveFailures: number;
}

export type CircuitState = "closed" | "open" | "half_open";

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private successCount = 0;
  private halfOpenCalls = 0;
  private lastFailureTime = 0;
  private lastStateChange = Date.now();
  private readonly name: string;
  private readonly config: CircuitBreakerConfig;

  constructor(name: string, config?: Partial<CircuitBreakerConfig>) {
    this.name = name;
    this.config = {
      failureThreshold: config?.failureThreshold ?? 5,
      successThreshold: config?.successThreshold ?? 3,
      halfOpenMaxCalls: config?.halfOpenMaxCalls ?? 3,
      resetTimeoutMs: config?.resetTimeoutMs ?? 30000,
      monitorIntervalMs: config?.monitorIntervalMs ?? 60000,
    };
  }

  getState(): CircuitState {
    if (this.state === "open") {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.config.resetTimeoutMs) {
        this.transitionTo("half_open");
      }
    }
    return this.state;
  }

  canExecute(): boolean {
    const currentState = this.getState();
    if (currentState === "closed") return true;
    if (currentState === "open") return false;
    return this.halfOpenCalls < this.config.halfOpenMaxCalls;
  }

  recordExecutionStart(): void {
    const currentState = this.getState();
    if (currentState === "half_open") {
      this.halfOpenCalls++;
    }
  }

  recordSuccess(): void {
    const currentState = this.getState();
    if (currentState === "half_open") {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo("closed");
      }
    } else if (currentState === "closed") {
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
  }

  recordFailure(): void {
    this.lastFailureTime = Date.now();
    const currentState = this.getState();
    
    if (currentState === "half_open") {
      this.transitionTo("open");
    } else if (currentState === "closed") {
      this.failureCount++;
      if (this.failureCount >= this.config.failureThreshold) {
        this.transitionTo("open");
      }
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    if (newState === "closed") {
      this.failureCount = 0;
      this.successCount = 0;
      this.halfOpenCalls = 0;
    } else if (newState === "half_open") {
      this.successCount = 0;
      this.halfOpenCalls = 0;
    }

    console.log(`[CircuitBreaker] ${this.name}: ${oldState} -> ${newState}`);
  }

  getMetrics() {
    return {
      name: this.name,
      state: this.getState(),
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastStateChange: this.lastStateChange,
      config: this.config,
    };
  }

  reset(): void {
    this.transitionTo("closed");
  }
}

export class ExponentialBackoff {
  private readonly config: RetryConfig;
  private attemptCount = 0;

  constructor(config?: Partial<RetryConfig>) {
    this.config = {
      maxRetries: config?.maxRetries ?? 3,
      baseDelayMs: config?.baseDelayMs ?? 1000,
      maxDelayMs: config?.maxDelayMs ?? 30000,
      exponentialBase: config?.exponentialBase ?? 2,
      jitterFactor: config?.jitterFactor ?? 0.2,
    };
  }

  shouldRetry(): boolean {
    return this.attemptCount < this.config.maxRetries;
  }

  getNextDelay(): number {
    const baseDelay = this.config.baseDelayMs * Math.pow(this.config.exponentialBase, this.attemptCount);
    const cappedDelay = Math.min(baseDelay, this.config.maxDelayMs);
    const jitter = cappedDelay * this.config.jitterFactor * (Math.random() - 0.5) * 2;
    this.attemptCount++;
    return Math.max(0, cappedDelay + jitter);
  }

  reset(): void {
    this.attemptCount = 0;
  }

  getAttemptCount(): number {
    return this.attemptCount;
  }
}

export interface ResilienceWrapperOptions {
  circuitBreaker?: CircuitBreaker;
  retryConfig?: Partial<RetryConfig>;
  timeoutMs?: number;
  fallback?: () => Promise<unknown>;
  onRetry?: (attempt: number, error: Error) => void;
  onCircuitOpen?: () => void;
}

export async function withResilience<T>(
  operation: () => Promise<T>,
  options: ResilienceWrapperOptions = {}
): Promise<{ success: boolean; data?: T; error?: string; attempts: number; circuitState?: CircuitState }> {
  const { circuitBreaker, retryConfig, timeoutMs = 30000, fallback, onRetry, onCircuitOpen } = options;
  const backoff = new ExponentialBackoff(retryConfig);

  if (circuitBreaker && !circuitBreaker.canExecute()) {
    onCircuitOpen?.();
    if (fallback) {
      try {
        const result = await fallback();
        return { success: false, data: result as T, error: "Circuit breaker open, fallback used", attempts: 0, circuitState: circuitBreaker.getState() };
      } catch (e) {
        return { success: false, error: "Circuit open and fallback failed", attempts: 0, circuitState: circuitBreaker.getState() };
      }
    }
    return { success: false, error: "Circuit breaker open", attempts: 0, circuitState: circuitBreaker.getState() };
  }

  let lastError: Error | undefined;
  let attempts = 0;

  while (true) {
    if (circuitBreaker && !circuitBreaker.canExecute()) {
      onCircuitOpen?.();
      if (fallback) {
        try {
          const result = await fallback();
          return { success: false, data: result as T, error: "Circuit opened during retries, fallback used", attempts, circuitState: circuitBreaker.getState() };
        } catch (e) {
          return { success: false, error: "Circuit opened during retries and fallback failed", attempts, circuitState: circuitBreaker.getState() };
        }
      }
      return { success: false, error: "Circuit breaker opened during retries", attempts, circuitState: circuitBreaker.getState() };
    }

    attempts++;
    circuitBreaker?.recordExecutionStart();
    try {
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error("Operation timed out")), timeoutMs)
        ),
      ]);

      circuitBreaker?.recordSuccess();
      return { success: true, data: result, attempts, circuitState: circuitBreaker?.getState() };
    } catch (error: any) {
      lastError = error;
      circuitBreaker?.recordFailure();

      if (!backoff.shouldRetry()) {
        break;
      }

      onRetry?.(attempts, error);
      const delay = backoff.getNextDelay();
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  if (fallback) {
    try {
      const result = await fallback();
      return { success: false, data: result as T, error: `All retries exhausted, fallback used: ${lastError?.message}`, attempts, circuitState: circuitBreaker?.getState() };
    } catch (e) {
      return { success: false, error: `All retries failed: ${lastError?.message}. Fallback also failed.`, attempts, circuitState: circuitBreaker?.getState() };
    }
  }

  return { success: false, error: lastError?.message || "Unknown error", attempts, circuitState: circuitBreaker?.getState() };
}

export class HealthCheckManager {
  private healthStatus: Map<string, HealthCheckResult> = new Map();
  private healthChecks: Map<string, () => Promise<boolean>> = new Map();
  private checkIntervalMs = 60000;
  private intervalId?: NodeJS.Timeout;

  registerHealthCheck(name: string, check: () => Promise<boolean>): void {
    this.healthChecks.set(name, check);
    this.healthStatus.set(name, {
      healthy: true,
      latencyMs: 0,
      lastCheckedAt: new Date().toISOString(),
      consecutiveFailures: 0,
    });
  }

  async runHealthCheck(name: string): Promise<HealthCheckResult> {
    const check = this.healthChecks.get(name);
    if (!check) {
      return { healthy: false, latencyMs: 0, errorMessage: "No health check registered", lastCheckedAt: new Date().toISOString(), consecutiveFailures: -1 };
    }

    const start = Date.now();
    const currentStatus = this.healthStatus.get(name);
    
    try {
      const healthy = await Promise.race([
        check(),
        new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error("Health check timeout")), 5000)),
      ]);

      const result: HealthCheckResult = {
        healthy,
        latencyMs: Date.now() - start,
        lastCheckedAt: new Date().toISOString(),
        consecutiveFailures: healthy ? 0 : (currentStatus?.consecutiveFailures || 0) + 1,
      };

      this.healthStatus.set(name, result);
      return result;
    } catch (error: any) {
      const result: HealthCheckResult = {
        healthy: false,
        latencyMs: Date.now() - start,
        errorMessage: error.message,
        lastCheckedAt: new Date().toISOString(),
        consecutiveFailures: (currentStatus?.consecutiveFailures || 0) + 1,
      };

      this.healthStatus.set(name, result);
      return result;
    }
  }

  async runAllHealthChecks(): Promise<Map<string, HealthCheckResult>> {
    const results = new Map<string, HealthCheckResult>();
    const checks = Array.from(this.healthChecks.keys()).map(async (name) => {
      const result = await this.runHealthCheck(name);
      results.set(name, result);
    });

    await Promise.all(checks);
    return results;
  }

  getHealthStatus(name?: string): HealthCheckResult | Map<string, HealthCheckResult> | undefined {
    if (name) {
      return this.healthStatus.get(name);
    }
    return new Map(this.healthStatus);
  }

  getOverallHealth(): { healthy: boolean; unhealthyServices: string[]; totalServices: number } {
    const unhealthyServices: string[] = [];
    for (const [name, status] of this.healthStatus) {
      if (!status.healthy) {
        unhealthyServices.push(name);
      }
    }
    return {
      healthy: unhealthyServices.length === 0,
      unhealthyServices,
      totalServices: this.healthStatus.size,
    };
  }

  startPeriodicChecks(intervalMs?: number): void {
    if (intervalMs) this.checkIntervalMs = intervalMs;
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      this.runAllHealthChecks().catch(console.error);
    }, this.checkIntervalMs);
  }

  stopPeriodicChecks(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }
}

export class RateLimiterAdvanced {
  private buckets: Map<string, { tokens: number; lastRefill: number }> = new Map();
  private config: Map<string, { tokensPerSecond: number; maxTokens: number }> = new Map();

  configure(name: string, tokensPerSecond: number, maxTokens: number): void {
    this.config.set(name, { tokensPerSecond, maxTokens });
    this.buckets.set(name, { tokens: maxTokens, lastRefill: Date.now() });
  }

  tryAcquire(name: string, tokens: number = 1): boolean {
    const config = this.config.get(name);
    if (!config) {
      this.configure(name, 10, 100);
      return this.tryAcquire(name, tokens);
    }

    const bucket = this.buckets.get(name)!;
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    const refillTokens = elapsed * config.tokensPerSecond;

    bucket.tokens = Math.min(config.maxTokens, bucket.tokens + refillTokens);
    bucket.lastRefill = now;

    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens;
      return true;
    }

    return false;
  }

  getTokens(name: string): number {
    const bucket = this.buckets.get(name);
    if (!bucket) return 0;
    
    const config = this.config.get(name);
    if (!config) return bucket.tokens;

    const elapsed = (Date.now() - bucket.lastRefill) / 1000;
    const refillTokens = elapsed * config.tokensPerSecond;
    return Math.min(config.maxTokens, bucket.tokens + refillTokens);
  }

  async waitForToken(name: string, tokens: number = 1, maxWaitMs: number = 10000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      if (this.tryAcquire(name, tokens)) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return false;
  }
}

export interface BulkheadConfig {
  maxConcurrent: number;
  maxQueue: number;
  queueTimeoutMs: number;
}

export class Bulkhead {
  private active = 0;
  private queue: Array<{ resolve: (value: boolean) => void; timeout: NodeJS.Timeout }> = [];
  private readonly config: BulkheadConfig;
  private readonly name: string;

  constructor(name: string, config?: Partial<BulkheadConfig>) {
    this.name = name;
    this.config = {
      maxConcurrent: config?.maxConcurrent ?? 10,
      maxQueue: config?.maxQueue ?? 50,
      queueTimeoutMs: config?.queueTimeoutMs ?? 30000,
    };
  }

  async acquire(): Promise<boolean> {
    if (this.active < this.config.maxConcurrent) {
      this.active++;
      return true;
    }

    if (this.queue.length >= this.config.maxQueue) {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        const index = this.queue.findIndex(item => item.resolve === resolve);
        if (index !== -1) {
          this.queue.splice(index, 1);
          resolve(false);
        }
      }, this.config.queueTimeoutMs);

      this.queue.push({ resolve, timeout });
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      clearTimeout(next.timeout);
      next.resolve(true);
    } else {
      this.active = Math.max(0, this.active - 1);
    }
  }

  getMetrics() {
    return {
      name: this.name,
      active: this.active,
      queued: this.queue.length,
      config: this.config,
    };
  }
}

export class ResourcePool<T> {
  private available: T[] = [];
  private inUse: Set<T> = new Set();
  private factory: () => Promise<T>;
  private destroyer: (resource: T) => Promise<void>;
  private maxSize: number;
  private minSize: number;

  constructor(
    factory: () => Promise<T>,
    destroyer: (resource: T) => Promise<void>,
    options?: { maxSize?: number; minSize?: number }
  ) {
    this.factory = factory;
    this.destroyer = destroyer;
    this.maxSize = options?.maxSize ?? 10;
    this.minSize = options?.minSize ?? 2;
  }

  async initialize(): Promise<void> {
    for (let i = 0; i < this.minSize; i++) {
      const resource = await this.factory();
      this.available.push(resource);
    }
  }

  async acquire(): Promise<T | null> {
    if (this.available.length > 0) {
      const resource = this.available.pop()!;
      this.inUse.add(resource);
      return resource;
    }

    if (this.inUse.size < this.maxSize) {
      const resource = await this.factory();
      this.inUse.add(resource);
      return resource;
    }

    return null;
  }

  release(resource: T): void {
    if (this.inUse.has(resource)) {
      this.inUse.delete(resource);
      this.available.push(resource);
    }
  }

  async destroy(): Promise<void> {
    for (const resource of this.available) {
      await this.destroyer(resource);
    }
    for (const resource of this.inUse) {
      await this.destroyer(resource);
    }
    this.available = [];
    this.inUse.clear();
  }

  getMetrics() {
    return {
      available: this.available.length,
      inUse: this.inUse.size,
      total: this.available.length + this.inUse.size,
      maxSize: this.maxSize,
    };
  }
}

export const globalCircuitBreakers = new Map<string, CircuitBreaker>();
export const globalHealthManager = new HealthCheckManager();
export const globalRateLimiter = new RateLimiterAdvanced();
export const globalBulkheads = new Map<string, Bulkhead>();

export function getOrCreateCircuitBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
  if (!globalCircuitBreakers.has(name)) {
    globalCircuitBreakers.set(name, new CircuitBreaker(name, config));
  }
  return globalCircuitBreakers.get(name)!;
}

export function getOrCreateBulkhead(name: string, config?: Partial<BulkheadConfig>): Bulkhead {
  if (!globalBulkheads.has(name)) {
    globalBulkheads.set(name, new Bulkhead(name, config));
  }
  return globalBulkheads.get(name)!;
}

export function getAllResilienceMetrics() {
  return {
    circuitBreakers: Array.from(globalCircuitBreakers.values()).map(cb => cb.getMetrics()),
    bulkheads: Array.from(globalBulkheads.values()).map(b => b.getMetrics()),
    health: globalHealthManager.getOverallHealth(),
  };
}
