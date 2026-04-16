/**
 * ConnectorAdaptiveThrottler — Dynamic request throttling that adjusts
 * based on real-time API response signals (429 headers, latency spikes,
 * error rates) to stay just under provider rate limits.
 *
 * Features:
 *  1. Token bucket with dynamic refill rate
 *  2. AIMD (Additive Increase Multiplicative Decrease) congestion control
 *  3. Retry-After header parsing and enforcement
 *  4. Backpressure propagation to callers
 *  5. Per-user fair queuing to prevent one user from starving others
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface ThrottleConfig {
  /** Initial tokens per second */
  initialRate: number;
  /** Maximum tokens per second (hard ceiling) */
  maxRate: number;
  /** Minimum tokens per second (floor to prevent starvation) */
  minRate: number;
  /** Burst size (max tokens that can accumulate) */
  burstSize: number;
  /** Additive increase per successful request */
  additiveIncrease: number;
  /** Multiplicative decrease factor on throttle signal (0-1) */
  multiplicativeDecrease: number;
  /** Window for rate calculation (ms) */
  windowMs: number;
  /** If true, queue requests instead of rejecting */
  queueEnabled: boolean;
  /** Max queue depth */
  maxQueueSize: number;
  /** Max wait time for queued requests (ms) */
  maxQueueWaitMs: number;
}

export interface ThrottleDecision {
  allowed: boolean;
  waitMs: number;
  queuePosition?: number;
  currentRate: number;
  tokensRemaining: number;
  reason: string;
}

export interface ThrottleState {
  connectorId: string;
  currentRate: number;
  maxRate: number;
  tokensRemaining: number;
  burstSize: number;
  queueDepth: number;
  totalAllowed: number;
  totalThrottled: number;
  totalQueueTimeouts: number;
  retryAfterMs?: number;
  lastRateAdjustment: number;
  congestionLevel: "none" | "light" | "moderate" | "severe";
}

export interface BackpressureSignal {
  connectorId: string;
  signalType: "rate_limit" | "latency_spike" | "error_burst" | "retry_after";
  severity: number; // 0-1
  retryAfterMs?: number;
  timestamp: number;
}

export interface FairQueueEntry {
  userId: string;
  connectorId: string;
  operationId: string;
  enqueuedAt: number;
  resolve: (decision: ThrottleDecision) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface UserFairness {
  userId: string;
  connectorId: string;
  requestsInWindow: number;
  lastRequest: number;
  fairShareTokens: number;
}

// ─── Default Config ──────────────────────────────────────────────────

export const DEFAULT_THROTTLE_CONFIG: ThrottleConfig = {
  initialRate: 60, // 60 req/s
  maxRate: 200,
  minRate: 1,
  burstSize: 30,
  additiveIncrease: 0.5,
  multiplicativeDecrease: 0.5,
  windowMs: 60_000,
  queueEnabled: true,
  maxQueueSize: 100,
  maxQueueWaitMs: 30_000,
};

// ─── Token Bucket ────────────────────────────────────────────────────

class TokenBucket {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number; // tokens per second
  private lastRefill: number;

  constructor(maxTokens: number, refillRate: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  tryConsume(count = 1): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  getTokens(): number {
    this.refill();
    return this.tokens;
  }

  getWaitMs(count = 1): number {
    this.refill();
    if (this.tokens >= count) return 0;
    const needed = count - this.tokens;
    return Math.ceil((needed / this.refillRate) * 1000);
  }

  setRefillRate(rate: number): void {
    this.refill();
    this.refillRate = rate;
  }

  setMaxTokens(max: number): void {
    this.maxTokens = max;
    if (this.tokens > max) this.tokens = max;
  }

  getRefillRate(): number {
    return this.refillRate;
  }

  getMaxTokens(): number {
    return this.maxTokens;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.lastRefill = now;

    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
  }
}

// ─── AIMD Controller ─────────────────────────────────────────────────

class AimdController {
  private currentRate: number;
  private readonly maxRate: number;
  private readonly minRate: number;
  private readonly additiveIncrease: number;
  private readonly multiplicativeDecrease: number;
  private consecutiveSuccesses = 0;
  private readonly increaseThreshold = 10; // increase after N consecutive successes

  constructor(
    initialRate: number,
    maxRate: number,
    minRate: number,
    additiveIncrease: number,
    multiplicativeDecrease: number
  ) {
    this.currentRate = initialRate;
    this.maxRate = maxRate;
    this.minRate = minRate;
    this.additiveIncrease = additiveIncrease;
    this.multiplicativeDecrease = multiplicativeDecrease;
  }

  onSuccess(): void {
    this.consecutiveSuccesses++;
    if (this.consecutiveSuccesses >= this.increaseThreshold) {
      this.currentRate = Math.min(this.maxRate, this.currentRate + this.additiveIncrease);
      this.consecutiveSuccesses = 0;
    }
  }

  onThrottle(): void {
    this.consecutiveSuccesses = 0;
    this.currentRate = Math.max(
      this.minRate,
      this.currentRate * this.multiplicativeDecrease
    );
  }

  onLatencySpike(severity: number): void {
    // Proportional decrease based on severity (0-1)
    const factor = 1 - severity * (1 - this.multiplicativeDecrease);
    this.currentRate = Math.max(this.minRate, this.currentRate * factor);
    this.consecutiveSuccesses = 0;
  }

  getRate(): number {
    return this.currentRate;
  }

  setRate(rate: number): void {
    this.currentRate = Math.max(this.minRate, Math.min(this.maxRate, rate));
  }
}

// ─── Fair Queue ──────────────────────────────────────────────────────

class FairQueue {
  private queues = new Map<string, FairQueueEntry[]>(); // connectorId → queue
  private userCounters = new Map<string, number>(); // userId:connectorId → count in window

  enqueue(entry: FairQueueEntry): number {
    const { connectorId } = entry;
    if (!this.queues.has(connectorId)) {
      this.queues.set(connectorId, []);
    }
    const queue = this.queues.get(connectorId)!;
    queue.push(entry);

    const userKey = `${entry.userId}:${connectorId}`;
    this.userCounters.set(userKey, (this.userCounters.get(userKey) ?? 0) + 1);

    return queue.length;
  }

  /** Dequeue in fair round-robin order across users */
  dequeue(connectorId: string): FairQueueEntry | undefined {
    const queue = this.queues.get(connectorId);
    if (!queue || queue.length === 0) return undefined;

    // Find user with lowest request count (fair share)
    let bestIdx = 0;
    let bestCount = Infinity;

    for (let i = 0; i < queue.length; i++) {
      const userKey = `${queue[i].userId}:${connectorId}`;
      const count = this.userCounters.get(userKey) ?? 0;
      if (count < bestCount) {
        bestCount = count;
        bestIdx = i;
      }
    }

    const entry = queue.splice(bestIdx, 1)[0];
    return entry;
  }

  getDepth(connectorId: string): number {
    return (this.queues.get(connectorId) ?? []).length;
  }

  removeTimedOut(connectorId: string): FairQueueEntry[] {
    const queue = this.queues.get(connectorId);
    if (!queue) return [];

    const now = Date.now();
    const timedOut: FairQueueEntry[] = [];
    const remaining: FairQueueEntry[] = [];

    for (const entry of queue) {
      if (now - entry.enqueuedAt > DEFAULT_THROTTLE_CONFIG.maxQueueWaitMs) {
        timedOut.push(entry);
      } else {
        remaining.push(entry);
      }
    }

    this.queues.set(connectorId, remaining);
    return timedOut;
  }

  clear(connectorId: string): FairQueueEntry[] {
    const queue = this.queues.get(connectorId) ?? [];
    this.queues.delete(connectorId);
    return queue;
  }
}

// ─── Adaptive Throttler ──────────────────────────────────────────────

export class ConnectorAdaptiveThrottler {
  private buckets = new Map<string, TokenBucket>();
  private controllers = new Map<string, AimdController>();
  private configs = new Map<string, ThrottleConfig>();
  private fairQueue = new FairQueue();
  private retryAfters = new Map<string, number>(); // connectorId → retryAfter expiry
  private totalAllowed = new Map<string, number>();
  private totalThrottled = new Map<string, number>();
  private totalQueueTimeouts = new Map<string, number>();
  private drainIntervals = new Map<string, ReturnType<typeof setInterval>>();

  /** Configure throttling for a connector */
  configure(connectorId: string, config: Partial<ThrottleConfig>): void {
    const merged = { ...DEFAULT_THROTTLE_CONFIG, ...config };
    this.configs.set(connectorId, merged);

    const bucket = new TokenBucket(merged.burstSize, merged.initialRate);
    this.buckets.set(connectorId, bucket);

    const controller = new AimdController(
      merged.initialRate,
      merged.maxRate,
      merged.minRate,
      merged.additiveIncrease,
      merged.multiplicativeDecrease
    );
    this.controllers.set(connectorId, controller);

    // Start queue drain if queue enabled
    if (merged.queueEnabled && !this.drainIntervals.has(connectorId)) {
      const interval = setInterval(() => this.drainQueue(connectorId), 100);
      this.drainIntervals.set(connectorId, interval);
    }
  }

  /** Request permission to make an API call */
  tryAcquire(connectorId: string, userId?: string): ThrottleDecision {
    const config = this.configs.get(connectorId) ?? DEFAULT_THROTTLE_CONFIG;

    // Ensure bucket exists
    if (!this.buckets.has(connectorId)) {
      this.configure(connectorId, config);
    }

    // Check retry-after
    const retryAfterExpiry = this.retryAfters.get(connectorId);
    if (retryAfterExpiry && Date.now() < retryAfterExpiry) {
      const waitMs = retryAfterExpiry - Date.now();
      this.incrementThrottled(connectorId);
      return {
        allowed: false,
        waitMs,
        currentRate: this.controllers.get(connectorId)?.getRate() ?? 0,
        tokensRemaining: 0,
        reason: `Retry-After enforced, wait ${waitMs}ms`,
      };
    }

    const bucket = this.buckets.get(connectorId)!;

    if (bucket.tryConsume()) {
      this.incrementAllowed(connectorId);
      return {
        allowed: true,
        waitMs: 0,
        currentRate: this.controllers.get(connectorId)?.getRate() ?? config.initialRate,
        tokensRemaining: bucket.getTokens(),
        reason: "Token available",
      };
    }

    // No token available
    const waitMs = bucket.getWaitMs();
    this.incrementThrottled(connectorId);

    return {
      allowed: false,
      waitMs,
      currentRate: this.controllers.get(connectorId)?.getRate() ?? config.initialRate,
      tokensRemaining: 0,
      reason: `Rate limited, wait ${waitMs}ms`,
    };
  }

  /** Record a backpressure signal from the API */
  recordSignal(signal: BackpressureSignal): void {
    const controller = this.controllers.get(signal.connectorId);
    const bucket = this.buckets.get(signal.connectorId);
    if (!controller || !bucket) return;

    switch (signal.signalType) {
      case "rate_limit":
        controller.onThrottle();
        if (signal.retryAfterMs) {
          this.retryAfters.set(signal.connectorId, Date.now() + signal.retryAfterMs);
        }
        break;

      case "retry_after":
        if (signal.retryAfterMs) {
          this.retryAfters.set(signal.connectorId, Date.now() + signal.retryAfterMs);
        }
        controller.onThrottle();
        break;

      case "latency_spike":
        controller.onLatencySpike(signal.severity);
        break;

      case "error_burst":
        controller.onThrottle();
        break;
    }

    // Update bucket refill rate
    bucket.setRefillRate(controller.getRate());

    console.log(
      JSON.stringify({
        event: "throttle_signal",
        connectorId: signal.connectorId,
        signalType: signal.signalType,
        severity: signal.severity,
        newRate: controller.getRate().toFixed(1),
        timestamp: new Date().toISOString(),
      })
    );
  }

  /** Record a successful request (allows rate to increase) */
  recordSuccess(connectorId: string): void {
    const controller = this.controllers.get(connectorId);
    const bucket = this.buckets.get(connectorId);
    if (!controller || !bucket) return;

    controller.onSuccess();
    bucket.setRefillRate(controller.getRate());
  }

  /** Get throttle state for a connector */
  getState(connectorId: string): ThrottleState {
    const config = this.configs.get(connectorId) ?? DEFAULT_THROTTLE_CONFIG;
    const controller = this.controllers.get(connectorId);
    const bucket = this.buckets.get(connectorId);
    const currentRate = controller?.getRate() ?? config.initialRate;

    // Determine congestion level
    let congestionLevel: ThrottleState["congestionLevel"] = "none";
    const rateRatio = currentRate / config.maxRate;
    if (rateRatio < 0.25) congestionLevel = "severe";
    else if (rateRatio < 0.5) congestionLevel = "moderate";
    else if (rateRatio < 0.75) congestionLevel = "light";

    const retryAfterExpiry = this.retryAfters.get(connectorId);

    return {
      connectorId,
      currentRate,
      maxRate: config.maxRate,
      tokensRemaining: bucket?.getTokens() ?? 0,
      burstSize: config.burstSize,
      queueDepth: this.fairQueue.getDepth(connectorId),
      totalAllowed: this.totalAllowed.get(connectorId) ?? 0,
      totalThrottled: this.totalThrottled.get(connectorId) ?? 0,
      totalQueueTimeouts: this.totalQueueTimeouts.get(connectorId) ?? 0,
      retryAfterMs:
        retryAfterExpiry && Date.now() < retryAfterExpiry
          ? retryAfterExpiry - Date.now()
          : undefined,
      lastRateAdjustment: Date.now(),
      congestionLevel,
    };
  }

  /** Get all connector throttle states */
  getAllStates(): ThrottleState[] {
    const connectorIds = new Set([
      ...Array.from(this.buckets.keys()),
      ...Array.from(this.configs.keys()),
    ]);
    return Array.from(connectorIds).map((id) => this.getState(id));
  }

  /** Stop throttler for a connector */
  stop(connectorId: string): void {
    const interval = this.drainIntervals.get(connectorId);
    if (interval) {
      clearInterval(interval);
      this.drainIntervals.delete(connectorId);
    }

    // Reject all queued requests
    const entries = this.fairQueue.clear(connectorId);
    for (const entry of entries) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Throttler stopped"));
    }
  }

  /** Stop all throttlers */
  stopAll(): void {
    for (const connectorId of Array.from(this.drainIntervals.keys())) {
      this.stop(connectorId);
    }
  }

  // ─── Private ─────────────────────────────────────────────────────

  private drainQueue(connectorId: string): void {
    // Remove timed-out entries
    const timedOut = this.fairQueue.removeTimedOut(connectorId);
    for (const entry of timedOut) {
      clearTimeout(entry.timer);
      this.incrementQueueTimeout(connectorId);
      entry.reject(new Error("Queue wait timeout exceeded"));
    }

    // Try to process queued entries
    const bucket = this.buckets.get(connectorId);
    if (!bucket) return;

    while (this.fairQueue.getDepth(connectorId) > 0) {
      if (!bucket.tryConsume()) break;

      const entry = this.fairQueue.dequeue(connectorId);
      if (!entry) break;

      clearTimeout(entry.timer);
      this.incrementAllowed(connectorId);

      const controller = this.controllers.get(connectorId);
      entry.resolve({
        allowed: true,
        waitMs: Date.now() - entry.enqueuedAt,
        currentRate: controller?.getRate() ?? 0,
        tokensRemaining: bucket.getTokens(),
        reason: "Dequeued after wait",
      });
    }
  }

  private incrementAllowed(connectorId: string): void {
    this.totalAllowed.set(connectorId, (this.totalAllowed.get(connectorId) ?? 0) + 1);
  }

  private incrementThrottled(connectorId: string): void {
    this.totalThrottled.set(connectorId, (this.totalThrottled.get(connectorId) ?? 0) + 1);
  }

  private incrementQueueTimeout(connectorId: string): void {
    this.totalQueueTimeouts.set(
      connectorId,
      (this.totalQueueTimeouts.get(connectorId) ?? 0) + 1
    );
  }
}

// ─── Retry-After Parser ──────────────────────────────────────────────

export function parseRetryAfterHeader(value: string | undefined | null): number | undefined {
  if (!value) return undefined;

  // Check if it's a number (seconds)
  const seconds = parseInt(value, 10);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  // Check if it's an HTTP-date
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    const ms = date.getTime() - Date.now();
    return ms > 0 ? ms : undefined;
  }

  return undefined;
}

// ─── Singleton ───────────────────────────────────────────────────────

export const adaptiveThrottler = new ConnectorAdaptiveThrottler();
