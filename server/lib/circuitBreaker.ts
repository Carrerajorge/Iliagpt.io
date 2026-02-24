import { EventEmitter } from "events";
import { createLogger } from "./structuredLogger";
import { recordConnectorUsage } from "./connectorMetrics";

const logger = createLogger("tenant-circuit-breaker");
const LEGACY_TENANT_ID = "__legacy__";

// ===== Types =====
export enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
  resetTimeout: number;
}

export interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  consecutiveSuccesses: number;
  totalRequests: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  lastStateChange: number;
  lastActivityTime: number;
  openedAt: number | null;
  tenantId: string;
  provider: string;
}

export interface CircuitBreakerStateTransition {
  tenantId: string;
  provider: string;
  fromState: CircuitState;
  toState: CircuitState;
  failures?: number;
}

export interface CircuitBreakerEvents {
  circuit_opened: CircuitBreakerStateTransition & { failures: number };
  circuit_closed: CircuitBreakerStateTransition;
  circuit_half_open: CircuitBreakerStateTransition;
}

// ===== Configuration Defaults =====
const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 3,
  timeout: 30000, // 30s in OPEN before HALF_OPEN
  resetTimeout: 300000, // 5 minutes of inactivity resets stats
};

// ===== Event Emitter =====
class CircuitBreakerEventEmitter extends EventEmitter {
  emit<K extends keyof CircuitBreakerEvents>(
    event: K,
    payload: CircuitBreakerEvents[K]
  ): boolean {
    return super.emit(event, payload);
  }

  on<K extends keyof CircuitBreakerEvents>(
    event: K,
    listener: (payload: CircuitBreakerEvents[K]) => void
  ): this {
    return super.on(event, listener);
  }

  once<K extends keyof CircuitBreakerEvents>(
    event: K,
    listener: (payload: CircuitBreakerEvents[K]) => void
  ): this {
    return super.once(event, listener);
  }
}

export const circuitBreakerEvents = new CircuitBreakerEventEmitter();
circuitBreakerEvents.setMaxListeners(1000);

type LegacyStateObserver = (fromState: CircuitState, toState: CircuitState) => void;

const legacyStateObserverRegistry = new Map<string, Set<LegacyStateObserver>>();
let isLegacyStateRouterInstalled = false;

function getLegacyStateObserverKey(tenantId: string, provider: string): string {
  return `${tenantId}:${provider}`;
}

function ensureLegacyStateRouter(): void {
  if (isLegacyStateRouterInstalled) return;

  const dispatchStateTransition = (transition: CircuitBreakerStateTransition) => {
    const observers = legacyStateObserverRegistry.get(
      getLegacyStateObserverKey(transition.tenantId, transition.provider)
    );
    if (!observers || observers.size === 0) return;

    for (const observer of observers) {
      try {
        observer(transition.fromState, transition.toState);
      } catch (err) {
        logger.error("Failed to notify legacy state observer", {
          tenantId: transition.tenantId,
          provider: transition.provider,
          fromState: transition.fromState,
          toState: transition.toState,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };

  circuitBreakerEvents.on("circuit_opened", (payload) => {
    dispatchStateTransition(payload);
  });
  circuitBreakerEvents.on("circuit_closed", (payload) => {
    dispatchStateTransition(payload);
  });
  circuitBreakerEvents.on("circuit_half_open", (payload) => {
    dispatchStateTransition(payload);
  });

  isLegacyStateRouterInstalled = true;
}

function registerLegacyStateObserver(
  tenantId: string,
  provider: string,
  observer: LegacyStateObserver
): () => void {
  ensureLegacyStateRouter();

  const key = getLegacyStateObserverKey(tenantId, provider);
  let observers = legacyStateObserverRegistry.get(key);
  if (!observers) {
    observers = new Set();
    legacyStateObserverRegistry.set(key, observers);
  }

  observers.add(observer);

  return () => {
    const currentObservers = legacyStateObserverRegistry.get(key);
    if (!currentObservers) return;

    currentObservers.delete(observer);
    if (currentObservers.size === 0) {
      legacyStateObserverRegistry.delete(key);
    }
  };
}

// ===== Error Class =====
export class CircuitBreakerOpenError extends Error {
  constructor(
    message: string,
    public readonly tenantId: string,
    public readonly provider: string
  ) {
    super(message);
    this.name = "CircuitBreakerOpenError";
  }
}

// ===== Tenant Circuit Breaker =====
export class TenantCircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private consecutiveSuccesses: number = 0;
  private totalRequests: number = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private lastStateChange: number = Date.now();
  private lastActivityTime: number = Date.now();
  private openedAt: number | null = null;
  private halfOpenAttempts: number = 0;

  constructor(
    public readonly tenantId: string,
    public readonly provider: string,
    private readonly config: CircuitBreakerConfig = DEFAULT_CONFIG
  ) { }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.lastActivityTime = Date.now();
    this.checkResetTimeout();
    this.checkStateTransition();

    if (!this.canExecute()) {
      throw new CircuitBreakerOpenError(
        `Circuit breaker is OPEN for tenant ${this.tenantId}, provider ${this.provider}`,
        this.tenantId,
        this.provider
      );
    }

    this.totalRequests++;

    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenAttempts++;
    }

    const startTime = Date.now();
    try {
      const result = await operation();
      this.recordSuccess();
      recordConnectorUsage(`cb:${this.tenantId}:${this.provider}` as any, Date.now() - startTime, true);
      return result;
    } catch (error) {
      this.recordFailure();
      recordConnectorUsage(`cb:${this.tenantId}:${this.provider}` as any, Date.now() - startTime, false);
      throw error;
    }
  }

  private canExecute(): boolean {
    this.checkStateTransition();

    if (this.state === CircuitState.CLOSED) {
      return true;
    }

    if (this.state === CircuitState.OPEN) {
      return false;
    }

    // HALF_OPEN: allow limited requests to test if service recovered
    return true;
  }

  private checkStateTransition(): void {
    if (this.state === CircuitState.OPEN && this.openedAt) {
      const timeSinceOpen = Date.now() - this.openedAt;
      if (timeSinceOpen >= this.config.timeout) {
        this.transitionTo(CircuitState.HALF_OPEN);
      }
    }
  }

  private checkResetTimeout(): void {
    const timeSinceActivity = Date.now() - this.lastActivityTime;
    if (timeSinceActivity >= this.config.resetTimeout) {
      this.resetStats();
    }
  }

  private resetStats(): void {
    this.failures = 0;
    this.successes = 0;
    this.consecutiveSuccesses = 0;
    this.halfOpenAttempts = 0;
    if (this.state !== CircuitState.CLOSED) {
      this.transitionTo(CircuitState.CLOSED);
    }
  }

  public recordSuccess(): void {
    this.successes++;
    this.consecutiveSuccesses++;
    this.lastSuccessTime = Date.now();
    this.lastActivityTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Decay failures on success in closed state
      this.failures = Math.max(0, this.failures - 1);
    }
  }

  public recordFailure(): void {
    this.failures++;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = Date.now();
    this.lastActivityTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in HALF_OPEN immediately opens circuit
      this.transitionTo(CircuitState.OPEN);
    } else if (this.state === CircuitState.CLOSED) {
      if (this.failures >= this.config.failureThreshold) {
        this.transitionTo(CircuitState.OPEN);
      }
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    if (oldState === newState) return;

    this.state = newState;
    this.lastStateChange = Date.now();

    if (newState === CircuitState.OPEN) {
      this.openedAt = Date.now();
      this.halfOpenAttempts = 0;
      circuitBreakerEvents.emit("circuit_opened", {
        tenantId: this.tenantId,
        provider: this.provider,
        fromState: oldState,
        toState: newState,
        failures: this.failures,
      });
      logger.warn(`Circuit OPENED`, {
        tenantId: this.tenantId,
        provider: this.provider,
        failures: this.failures,
      });
    } else if (newState === CircuitState.HALF_OPEN) {
      this.halfOpenAttempts = 0;
      this.consecutiveSuccesses = 0;
      circuitBreakerEvents.emit("circuit_half_open", {
        tenantId: this.tenantId,
        provider: this.provider,
        fromState: oldState,
        toState: newState,
      });
      logger.info(`Circuit HALF_OPEN`, {
        tenantId: this.tenantId,
        provider: this.provider,
      });
    } else if (newState === CircuitState.CLOSED) {
      this.openedAt = null;
      this.failures = 0;
      this.consecutiveSuccesses = 0;
      this.halfOpenAttempts = 0;
      circuitBreakerEvents.emit("circuit_closed", {
        tenantId: this.tenantId,
        provider: this.provider,
        fromState: oldState,
        toState: newState,
      });
      logger.info(`Circuit CLOSED`, {
        tenantId: this.tenantId,
        provider: this.provider,
      });
    }
  }

  getState(): CircuitState {
    this.checkStateTransition();
    return this.state;
  }

  getStats(): CircuitStats {
    this.checkStateTransition();
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      consecutiveSuccesses: this.consecutiveSuccesses,
      totalRequests: this.totalRequests,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      lastStateChange: this.lastStateChange,
      lastActivityTime: this.lastActivityTime,
      openedAt: this.openedAt,
      tenantId: this.tenantId,
      provider: this.provider,
    };
  }

  reset(): void {
    this.failures = 0;
    this.successes = 0;
    this.consecutiveSuccesses = 0;
    this.totalRequests = 0;
    this.lastFailureTime = null;
    this.lastSuccessTime = null;
    this.openedAt = null;
    this.halfOpenAttempts = 0;
    this.lastActivityTime = Date.now();

    if (this.state !== CircuitState.CLOSED) {
      this.transitionTo(CircuitState.CLOSED);
    }
    this.lastStateChange = Date.now();
  }

  forceOpen(): void {
    if (this.state !== CircuitState.OPEN) {
      this.transitionTo(CircuitState.OPEN);
    }
  }

  forceClose(): void {
    if (this.state !== CircuitState.CLOSED) {
      this.transitionTo(CircuitState.CLOSED);
    }
  }

  getLastActivityTime(): number {
    return this.lastActivityTime;
  }
}

// ===== LRU Entry for Registry =====
interface LRUEntry {
  key: string;
  breaker: TenantCircuitBreaker;
  prev: LRUEntry | null;
  next: LRUEntry | null;
}

// ===== Circuit Breaker Registry =====
export class CircuitBreakerRegistry {
  private breakers: Map<string, LRUEntry> = new Map();
  private head: LRUEntry | null = null;
  private tail: LRUEntry | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  private readonly maxBreakers: number;
  private readonly staleTimeoutMs: number;
  private readonly cleanupIntervalMs: number;
  private readonly defaultConfig: CircuitBreakerConfig;

  constructor(options?: {
    maxBreakers?: number;
    staleTimeoutMs?: number;
    cleanupIntervalMs?: number;
    defaultConfig?: Partial<CircuitBreakerConfig>;
  }) {
    this.maxBreakers = options?.maxBreakers ?? 10000;
    this.staleTimeoutMs = options?.staleTimeoutMs ?? 300000; // 5 minutes
    this.cleanupIntervalMs = options?.cleanupIntervalMs ?? 300000; // 5 minutes
    this.defaultConfig = { ...DEFAULT_CONFIG, ...options?.defaultConfig };

    this.startCleanupInterval();
  }

  private generateKey(tenantId: string, provider: string): string {
    return `${tenantId}:${provider}`;
  }

  getBreaker(
    tenantId: string,
    provider: string,
    config?: Partial<CircuitBreakerConfig>
  ): TenantCircuitBreaker {
    const key = this.generateKey(tenantId, provider);
    const entry = this.breakers.get(key);

    if (entry) {
      this.moveToHead(entry);
      return entry.breaker;
    }

    // Evict if at capacity
    if (this.breakers.size >= this.maxBreakers) {
      this.evictLRU();
    }

    const breaker = new TenantCircuitBreaker(
      tenantId,
      provider,
      { ...this.defaultConfig, ...config }
    );

    const newEntry: LRUEntry = {
      key,
      breaker,
      prev: null,
      next: null,
    };

    this.breakers.set(key, newEntry);
    this.addToHead(newEntry);

    return breaker;
  }

  private addToHead(entry: LRUEntry): void {
    entry.prev = null;
    entry.next = this.head;

    if (this.head) {
      this.head.prev = entry;
    }

    this.head = entry;

    if (!this.tail) {
      this.tail = entry;
    }
  }

  private removeEntry(entry: LRUEntry): void {
    if (entry.prev) {
      entry.prev.next = entry.next;
    } else {
      this.head = entry.next;
    }

    if (entry.next) {
      entry.next.prev = entry.prev;
    } else {
      this.tail = entry.prev;
    }

    entry.prev = null;
    entry.next = null;
  }

  private moveToHead(entry: LRUEntry): void {
    if (entry === this.head) return;
    this.removeEntry(entry);
    this.addToHead(entry);
  }

  private evictLRU(): void {
    if (!this.tail) return;

    const evictedKey = this.tail.key;
    const evictedEntry = this.tail;

    this.removeEntry(evictedEntry);
    this.breakers.delete(evictedKey);

    logger.debug(`Evicted LRU breaker: ${evictedKey}`);
  }

  getAllStats(): Record<string, CircuitStats> {
    const stats: Record<string, CircuitStats> = {};

    Array.from(this.breakers.entries()).forEach(([key, entry]) => {
      stats[key] = entry.breaker.getStats();
    });

    return stats;
  }

  resetAll(): void {
    Array.from(this.breakers.values()).forEach((entry) => {
      entry.breaker.reset();
    });
    logger.info(`Reset all ${this.breakers.size} breakers`);
  }

  cleanupStale(): number {
    const now = Date.now();
    const staleKeys: string[] = [];

    Array.from(this.breakers.entries()).forEach(([key, entry]) => {
      const timeSinceActivity = now - entry.breaker.getLastActivityTime();
      if (timeSinceActivity >= this.staleTimeoutMs) {
        staleKeys.push(key);
      }
    });

    for (const key of staleKeys) {
      const entry = this.breakers.get(key);
      if (entry) {
        this.removeEntry(entry);
        this.breakers.delete(key);
      }
    }

    if (staleKeys.length > 0) {
      logger.info(`Cleaned up ${staleKeys.length} stale breakers`);
    }

    return staleKeys.length;
  }

  private startCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanupStale();
    }, this.cleanupIntervalMs);

    // Don't prevent process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  getSize(): number {
    return this.breakers.size;
  }

  hasBreaker(tenantId: string, provider: string): boolean {
    return this.breakers.has(this.generateKey(tenantId, provider));
  }

  removeBreaker(tenantId: string, provider: string): boolean {
    const key = this.generateKey(tenantId, provider);
    const entry = this.breakers.get(key);

    if (entry) {
      this.removeEntry(entry);
      this.breakers.delete(key);
      return true;
    }

    return false;
  }

  getMetrics(): {
    totalBreakers: number;
    maxBreakers: number;
    byState: Record<CircuitState, number>;
    oldestActivity: number | null;
    newestActivity: number | null;
  } {
    const byState: Record<CircuitState, number> = {
      [CircuitState.CLOSED]: 0,
      [CircuitState.OPEN]: 0,
      [CircuitState.HALF_OPEN]: 0,
    };

    let oldestActivity: number | null = null;
    let newestActivity: number | null = null;

    Array.from(this.breakers.values()).forEach((entry) => {
      const stats = entry.breaker.getStats();
      byState[stats.state]++;

      if (oldestActivity === null || stats.lastActivityTime < oldestActivity) {
        oldestActivity = stats.lastActivityTime;
      }
      if (newestActivity === null || stats.lastActivityTime > newestActivity) {
        newestActivity = stats.lastActivityTime;
      }
    });

    return {
      totalBreakers: this.breakers.size,
      maxBreakers: this.maxBreakers,
      byState,
      oldestActivity,
      newestActivity,
    };
  }
}

// ===== Global Registry Instance =====
const globalRegistry = new CircuitBreakerRegistry();

export function getCircuitBreaker(
  tenantId: string,
  provider: string,
  config?: Partial<CircuitBreakerConfig>
): TenantCircuitBreaker {
  return globalRegistry.getBreaker(tenantId, provider, config);
}

export function getGlobalRegistry(): CircuitBreakerRegistry {
  return globalRegistry;
}

export { DEFAULT_CONFIG as DEFAULT_CIRCUIT_BREAKER_CONFIG };

// ===== Legacy Compatibility Layer =====
// Re-export for backward compatibility with existing code

export interface ServiceCircuitConfig {
  name: string;
  failureThreshold?: number;
  resetTimeout?: number;
  halfOpenMaxCalls?: number;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  fallback?: () => Promise<any>;
  onSuccess?: (latencyMs: number) => void;
  onFailure?: (error: Error, latencyMs: number) => void;
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

export interface ServiceCallResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
  statusCode?: number;
  responseBody?: unknown;
  responseContentType?: string | null;
  retryAfter?: number;
  retryable?: boolean;
  latencyMs: number;
  fromFallback?: boolean;
  circuitState: CircuitState;
  retryCount?: number;
}

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Operation ${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

function calculateRetryDelay(attempt: number, baseDelay: number): number {
  const jitter = Math.random() * 0.3 * baseDelay;
  return Math.min(baseDelay * Math.pow(2, attempt) + jitter, 10000);
}

export class ServiceCircuitBreaker<T = any> {
  private breaker: TenantCircuitBreaker;
  private unregisterLegacyStateObserver?: () => void;
  private config: Required<Omit<ServiceCircuitConfig, "fallback" | "onSuccess" | "onFailure" | "onStateChange">> &
    Pick<ServiceCircuitConfig, "fallback" | "onSuccess" | "onFailure" | "onStateChange">;
  private metrics: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    timeouts: number;
    fallbackCalls: number;
    totalLatencyMs: number;
    lastCallTime: number;
  };

  constructor(config: ServiceCircuitConfig) {
    this.config = {
      name: config.name,
      failureThreshold: config.failureThreshold ?? 5,
      resetTimeout: config.resetTimeout ?? 60000,
      halfOpenMaxCalls: config.halfOpenMaxCalls ?? 2,
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      retries: config.retries ?? DEFAULT_RETRIES,
      retryDelay: config.retryDelay ?? DEFAULT_RETRY_DELAY,
      fallback: config.fallback,
      onSuccess: config.onSuccess,
      onFailure: config.onFailure,
      onStateChange: config.onStateChange,
    };

    this.breaker = getCircuitBreaker("__legacy__", this.config.name, {
      failureThreshold: this.config.failureThreshold,
      successThreshold: 3,
      timeout: this.config.resetTimeout,
      resetTimeout: 300000,
    });

    if (this.config.onStateChange) {
      this.unregisterLegacyStateObserver = registerLegacyStateObserver(
        LEGACY_TENANT_ID,
        this.config.name,
        (fromState, toState) => {
          this.config.onStateChange?.(fromState, toState);
        }
      );
    }

    this.metrics = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      timeouts: 0,
      fallbackCalls: 0,
      totalLatencyMs: 0,
      lastCallTime: 0,
    };
  }

  async call(fn: () => Promise<T>, operationName?: string): Promise<ServiceCallResult<T>> {
    const startTime = Date.now();
    const opName = operationName || this.config.name;
    let retryCount = 0;

    this.metrics.totalCalls++;
    this.metrics.lastCallTime = startTime;

    try {
      const result = await this.breaker.execute(async () => {
        let lastError: Error | undefined;

        for (let attempt = 0; attempt <= this.config.retries; attempt++) {
          try {
            if (attempt > 0) {
              retryCount = attempt;
              const delay = calculateRetryDelay(attempt - 1, this.config.retryDelay);
              logger.debug(`Retrying ${opName}, attempt ${attempt + 1}`, { delay });
              await sleep(delay);
            }

            const data = await withTimeout(fn(), this.config.timeout, opName);
            return data;
          } catch (error: any) {
            lastError = error;

            if (error.message?.includes("timed out")) {
              this.metrics.timeouts++;
            }

            if (attempt === this.config.retries) {
              throw error;
            }

            logger.warn(`Attempt ${attempt + 1} failed for ${opName}`, {
              error: error.message,
              remainingRetries: this.config.retries - attempt,
            });
          }
        }

        throw lastError || new Error(`All retries exhausted for ${opName}`);
      });

      const latencyMs = Date.now() - startTime;
      this.metrics.successfulCalls++;
      this.metrics.totalLatencyMs += latencyMs;

      recordConnectorUsage(this.config.name as any, latencyMs, true);
      this.config.onSuccess?.(latencyMs);

      return {
        success: true,
        data: result,
        latencyMs,
        circuitState: this.breaker.getState(),
        retryCount: retryCount > 0 ? retryCount : undefined,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      this.metrics.failedCalls++;
      this.metrics.totalLatencyMs += latencyMs;

      recordConnectorUsage(this.config.name as any, latencyMs, false);
      this.config.onFailure?.(error, latencyMs);

      if (error instanceof CircuitBreakerOpenError) {
        logger.warn(`Circuit open for ${opName}`, {
          state: this.breaker.getState(),
        });
      } else {
        logger.error(`Service call failed: ${opName}`, {
          error: error.message,
          latencyMs,
          retryCount,
        });
      }

      if (this.config.fallback) {
        try {
          const fallbackData = await this.config.fallback();
          this.metrics.fallbackCalls++;

          return {
            success: true,
            data: fallbackData,
            latencyMs: Date.now() - startTime,
            fromFallback: true,
            circuitState: this.breaker.getState(),
          };
        } catch (fallbackError: any) {
          logger.error(`Fallback failed for ${opName}`, { error: fallbackError.message });
        }
      }

      return {
        success: false,
        error: error.message,
        errorCode: error.code,
        statusCode: error.statusCode,
        responseBody: error.responseBody,
        responseContentType: error.responseContentType,
        retryAfter: error.retryAfter,
        retryable: error.retryable,
        latencyMs,
        circuitState: this.breaker.getState(),
        retryCount: retryCount > 0 ? retryCount : undefined,
      };
    }
  }

  getState(): CircuitState {
    return this.breaker.getState();
  }

  getStats() {
    const breakerStats = this.breaker.getStats();
    return {
      ...breakerStats,
      ...this.metrics,
      averageLatencyMs: this.metrics.totalCalls > 0
        ? Math.round(this.metrics.totalLatencyMs / this.metrics.totalCalls)
        : 0,
      successRate: this.metrics.totalCalls > 0
        ? ((this.metrics.successfulCalls / this.metrics.totalCalls) * 100).toFixed(2) + "%"
        : "N/A",
    };
  }

  reset(): void {
    this.breaker.reset();
    logger.info(`Circuit breaker reset: ${this.config.name}`);
  }

  destroy(): void {
    this.unregisterLegacyStateObserver?.();
    this.unregisterLegacyStateObserver = undefined;
  }
}

const serviceBreakers = new Map<string, ServiceCircuitBreaker>();

export function createServiceCircuitBreaker<T = any>(config: ServiceCircuitConfig): ServiceCircuitBreaker<T> {
  const existing = serviceBreakers.get(config.name);
  if (existing) {
    return existing as ServiceCircuitBreaker<T>;
  }

  const breaker = new ServiceCircuitBreaker<T>(config);
  serviceBreakers.set(config.name, breaker);
  return breaker;
}

export function getServiceCircuitBreaker(name: string): ServiceCircuitBreaker | undefined {
  return serviceBreakers.get(name);
}

export function getAllServiceCircuitBreakers(): Map<string, ServiceCircuitBreaker> {
  return new Map(serviceBreakers);
}

export const llmCircuitBreaker = createServiceCircuitBreaker({
  name: "llm-gateway",
  failureThreshold: 5,
  resetTimeout: 30000,
  timeout: 60000,
  retries: 2,
  retryDelay: 1000,
});

export const xaiCircuitBreaker = createServiceCircuitBreaker({
  name: "xai-api",
  failureThreshold: 5,
  resetTimeout: 60000,
  timeout: 60000,
  retries: 2,
  retryDelay: 1000,
});

export const geminiCircuitBreaker = createServiceCircuitBreaker({
  name: "gemini-api",
  failureThreshold: 5,
  resetTimeout: 60000,
  timeout: 60000,
  retries: 2,
  retryDelay: 1000,
});

// Alias for backward compatibility
export { CircuitBreakerOpenError as CircuitBreakerError };
