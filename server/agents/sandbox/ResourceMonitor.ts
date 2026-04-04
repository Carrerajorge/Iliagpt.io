import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";

const logger = pino({ name: "ResourceMonitor" });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResourceQuota {
  /** Max heap memory in bytes */
  maxMemoryBytes: number;
  /** Max CPU time consumed per 60s window in ms */
  maxCpuTimePer60sMs: number;
  /** Max outbound network bytes per 60s window */
  maxNetworkBytesPer60s: number;
  /** Max concurrent tool calls */
  maxConcurrentCalls: number;
  /** Max total tokens per 60s window */
  maxTokensPer60s: number;
  /** Max disk write bytes per session */
  maxDiskWriteBytes: number;
}

export const DEFAULT_QUOTAS: Record<string, ResourceQuota> = {
  minimal: {
    maxMemoryBytes: 32 * 1024 * 1024,
    maxCpuTimePer60sMs: 5_000,
    maxNetworkBytesPer60s: 0,
    maxConcurrentCalls: 1,
    maxTokensPer60s: 2_000,
    maxDiskWriteBytes: 0,
  },
  standard: {
    maxMemoryBytes: 256 * 1024 * 1024,
    maxCpuTimePer60sMs: 30_000,
    maxNetworkBytesPer60s: 10 * 1024 * 1024, // 10 MB
    maxConcurrentCalls: 5,
    maxTokensPer60s: 20_000,
    maxDiskWriteBytes: 50 * 1024 * 1024, // 50 MB
  },
  trusted: {
    maxMemoryBytes: 1024 * 1024 * 1024,
    maxCpuTimePer60sMs: 120_000,
    maxNetworkBytesPer60s: 100 * 1024 * 1024, // 100 MB
    maxConcurrentCalls: 20,
    maxTokensPer60s: 100_000,
    maxDiskWriteBytes: 500 * 1024 * 1024,
  },
  admin: {
    maxMemoryBytes: 8 * 1024 * 1024 * 1024,
    maxCpuTimePer60sMs: Infinity,
    maxNetworkBytesPer60s: Infinity,
    maxConcurrentCalls: Infinity,
    maxTokensPer60s: Infinity,
    maxDiskWriteBytes: Infinity,
  },
};

export interface ResourceUsage {
  agentId: string;
  window60sStartMs: number;
  cpuTimeMs: number;
  peakMemoryBytes: number;
  networkBytesIn: number;
  networkBytesOut: number;
  concurrentCalls: number;
  tokensUsed: number;
  diskWriteBytes: number;
  totalCalls: number;
  throttledCalls: number;
  killedAt?: number;
  sampledAt: number;
}

export interface ThrottleEvent {
  eventId: string;
  agentId: string;
  resource: keyof ResourceQuota;
  current: number;
  limit: number;
  action: "throttle" | "kill" | "warn";
  timestamp: number;
}

export interface UsageReport {
  agentId: string;
  period: { from: number; to: number };
  totalCpuTimeMs: number;
  peakMemoryBytes: number;
  totalNetworkBytes: number;
  totalTokensUsed: number;
  totalCalls: number;
  throttleEvents: number;
  estimatedCostUSD: number;
}

// ─── Sliding window counter ────────────────────────────────────────────────────

class SlidingWindowCounter {
  private buckets: Array<{ ts: number; value: number }> = [];
  private readonly windowMs: number;

  constructor(windowMs = 60_000) {
    this.windowMs = windowMs;
  }

  add(value: number): void {
    const now = Date.now();
    this.buckets.push({ ts: now, value });
    this.prune(now);
  }

  total(): number {
    this.prune(Date.now());
    return this.buckets.reduce((s, b) => s + b.value, 0);
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    this.buckets = this.buckets.filter((b) => b.ts > cutoff);
  }
}

// ─── AgentResourceTracker ─────────────────────────────────────────────────────

class AgentResourceTracker {
  private cpuWindow = new SlidingWindowCounter(60_000);
  private networkWindow = new SlidingWindowCounter(60_000);
  private tokenWindow = new SlidingWindowCounter(60_000);

  private peakMemoryBytes = 0;
  private currentMemoryBytes = 0;
  private diskWriteBytes = 0;
  private concurrentCalls = 0;
  private totalCalls = 0;
  private throttledCalls = 0;
  private windowStartMs = Date.now();

  addCpuTime(ms: number): void {
    this.cpuWindow.add(ms);
  }

  addNetworkBytes(bytes: number, direction: "in" | "out" = "out"): void {
    this.networkWindow.add(bytes);
  }

  addTokens(count: number): void {
    this.tokenWindow.add(count);
  }

  setMemory(bytes: number): void {
    this.currentMemoryBytes = bytes;
    if (bytes > this.peakMemoryBytes) this.peakMemoryBytes = bytes;
  }

  addDiskWrite(bytes: number): void {
    this.diskWriteBytes += bytes;
  }

  incrementConcurrent(): void {
    this.concurrentCalls++;
    this.totalCalls++;
  }

  decrementConcurrent(): void {
    this.concurrentCalls = Math.max(0, this.concurrentCalls - 1);
  }

  incrementThrottled(): void {
    this.throttledCalls++;
  }

  getWindowUsage(): {
    cpuTimeMs: number;
    networkBytes: number;
    tokensUsed: number;
    currentMemoryBytes: number;
    peakMemoryBytes: number;
    diskWriteBytes: number;
    concurrentCalls: number;
    totalCalls: number;
    throttledCalls: number;
  } {
    return {
      cpuTimeMs: this.cpuWindow.total(),
      networkBytes: this.networkWindow.total(),
      tokensUsed: this.tokenWindow.total(),
      currentMemoryBytes: this.currentMemoryBytes,
      peakMemoryBytes: this.peakMemoryBytes,
      diskWriteBytes: this.diskWriteBytes,
      concurrentCalls: this.concurrentCalls,
      totalCalls: this.totalCalls,
      throttledCalls: this.throttledCalls,
    };
  }
}

// ─── ResourceMonitor ──────────────────────────────────────────────────────────

export class ResourceMonitor extends EventEmitter {
  private trackers = new Map<string, AgentResourceTracker>();
  private quotas = new Map<string, ResourceQuota>();
  private throttleLog: ThrottleEvent[] = [];
  private killList = new Set<string>();

  private sampleTimer: NodeJS.Timeout;
  private readonly sampleIntervalMs = 5_000;

  constructor() {
    super();
    this.sampleTimer = setInterval(
      () => this.sampleAll(),
      this.sampleIntervalMs
    );
    logger.info("[ResourceMonitor] Initialized");
  }

  // ── Agent registration ─────────────────────────────────────────────────────────

  register(
    agentId: string,
    quotaPreset: keyof typeof DEFAULT_QUOTAS = "standard",
    overrides: Partial<ResourceQuota> = {}
  ): void {
    const quota: ResourceQuota = { ...DEFAULT_QUOTAS[quotaPreset], ...overrides };
    this.quotas.set(agentId, quota);
    this.trackers.set(agentId, new AgentResourceTracker());
    logger.info({ agentId, quotaPreset }, "[ResourceMonitor] Agent registered");
  }

  unregister(agentId: string): void {
    this.trackers.delete(agentId);
    this.quotas.delete(agentId);
    this.killList.delete(agentId);
    logger.debug({ agentId }, "[ResourceMonitor] Agent unregistered");
  }

  // ── Usage recording ───────────────────────────────────────────────────────────

  recordCpuTime(agentId: string, ms: number): void {
    this.getTracker(agentId)?.addCpuTime(ms);
    this.checkCpuQuota(agentId);
  }

  recordNetworkBytes(
    agentId: string,
    bytes: number,
    direction: "in" | "out" = "out"
  ): void {
    this.getTracker(agentId)?.addNetworkBytes(bytes, direction);
    this.checkNetworkQuota(agentId);
  }

  recordTokensUsed(agentId: string, tokens: number): void {
    this.getTracker(agentId)?.addTokens(tokens);
    this.checkTokenQuota(agentId);
  }

  recordMemoryUsage(agentId: string, bytes: number): void {
    this.getTracker(agentId)?.setMemory(bytes);
    this.checkMemoryQuota(agentId);
  }

  recordDiskWrite(agentId: string, bytes: number): void {
    this.getTracker(agentId)?.addDiskWrite(bytes);
    this.checkDiskQuota(agentId);
  }

  incrementConcurrentCalls(agentId: string): boolean {
    const tracker = this.getTracker(agentId);
    const quota = this.quotas.get(agentId);

    if (!tracker || !quota) return true;

    const usage = tracker.getWindowUsage();
    if (usage.concurrentCalls >= quota.maxConcurrentCalls) {
      tracker.incrementThrottled();
      this.emitThrottle(agentId, "maxConcurrentCalls", usage.concurrentCalls, quota.maxConcurrentCalls, "throttle");
      return false; // throttled
    }

    tracker.incrementConcurrent();
    return true;
  }

  decrementConcurrentCalls(agentId: string): void {
    this.getTracker(agentId)?.decrementConcurrent();
  }

  // ── Quota checks ──────────────────────────────────────────────────────────────

  canProceed(agentId: string): boolean {
    if (this.killList.has(agentId)) return false;
    const tracker = this.getTracker(agentId);
    const quota = this.quotas.get(agentId);
    if (!tracker || !quota) return true;

    const usage = tracker.getWindowUsage();
    return (
      usage.cpuTimeMs < quota.maxCpuTimePer60sMs &&
      usage.networkBytes < quota.maxNetworkBytesPer60s &&
      usage.tokensUsed < quota.maxTokensPer60s &&
      usage.currentMemoryBytes < quota.maxMemoryBytes &&
      usage.diskWriteBytes < quota.maxDiskWriteBytes
    );
  }

  private checkCpuQuota(agentId: string): void {
    const tracker = this.getTracker(agentId);
    const quota = this.quotas.get(agentId);
    if (!tracker || !quota) return;

    const cpu = tracker.getWindowUsage().cpuTimeMs;
    const pct = cpu / quota.maxCpuTimePer60sMs;

    if (pct >= 1.0) {
      this.emitThrottle(agentId, "maxCpuTimePer60sMs", cpu, quota.maxCpuTimePer60sMs, "kill");
      this.kill(agentId, "CPU quota exceeded");
    } else if (pct >= 0.85) {
      this.emitThrottle(agentId, "maxCpuTimePer60sMs", cpu, quota.maxCpuTimePer60sMs, "warn");
    }
  }

  private checkMemoryQuota(agentId: string): void {
    const tracker = this.getTracker(agentId);
    const quota = this.quotas.get(agentId);
    if (!tracker || !quota) return;

    const mem = tracker.getWindowUsage().currentMemoryBytes;
    const pct = mem / quota.maxMemoryBytes;

    if (pct >= 1.0) {
      this.emitThrottle(agentId, "maxMemoryBytes", mem, quota.maxMemoryBytes, "kill");
      this.kill(agentId, "Memory quota exceeded");
    } else if (pct >= 0.9) {
      this.emitThrottle(agentId, "maxMemoryBytes", mem, quota.maxMemoryBytes, "warn");
    }
  }

  private checkNetworkQuota(agentId: string): void {
    const tracker = this.getTracker(agentId);
    const quota = this.quotas.get(agentId);
    if (!tracker || !quota || quota.maxNetworkBytesPer60s === Infinity) return;

    const net = tracker.getWindowUsage().networkBytes;
    if (net >= quota.maxNetworkBytesPer60s) {
      this.emitThrottle(agentId, "maxNetworkBytesPer60s", net, quota.maxNetworkBytesPer60s, "throttle");
    }
  }

  private checkTokenQuota(agentId: string): void {
    const tracker = this.getTracker(agentId);
    const quota = this.quotas.get(agentId);
    if (!tracker || !quota || quota.maxTokensPer60s === Infinity) return;

    const tokens = tracker.getWindowUsage().tokensUsed;
    if (tokens >= quota.maxTokensPer60s) {
      this.emitThrottle(agentId, "maxTokensPer60s", tokens, quota.maxTokensPer60s, "throttle");
    }
  }

  private checkDiskQuota(agentId: string): void {
    const tracker = this.getTracker(agentId);
    const quota = this.quotas.get(agentId);
    if (!tracker || !quota || quota.maxDiskWriteBytes === Infinity) return;

    const disk = tracker.getWindowUsage().diskWriteBytes;
    if (disk >= quota.maxDiskWriteBytes) {
      this.emitThrottle(agentId, "maxDiskWriteBytes", disk, quota.maxDiskWriteBytes, "kill");
      this.kill(agentId, "Disk write quota exceeded");
    }
  }

  // ── Kill switch ────────────────────────────────────────────────────────────────

  kill(agentId: string, reason: string): void {
    this.killList.add(agentId);
    logger.error({ agentId, reason }, "[ResourceMonitor] Agent KILLED");
    this.emit("agent:killed", { agentId, reason, timestamp: Date.now() });
  }

  isKilled(agentId: string): boolean {
    return this.killList.has(agentId);
  }

  revive(agentId: string): void {
    this.killList.delete(agentId);
    // Reset tracker
    this.trackers.set(agentId, new AgentResourceTracker());
    logger.info({ agentId }, "[ResourceMonitor] Agent revived");
    this.emit("agent:revived", { agentId });
  }

  // ── Sampling ──────────────────────────────────────────────────────────────────

  private sampleAll(): void {
    for (const agentId of this.trackers.keys()) {
      const usage = this.getUsage(agentId);
      if (usage) {
        this.emit("usage:sample", usage);
      }
    }
  }

  // ── Reporting ─────────────────────────────────────────────────────────────────

  getUsage(agentId: string): ResourceUsage | null {
    const tracker = this.trackers.get(agentId);
    if (!tracker) return null;

    const w = tracker.getWindowUsage();
    return {
      agentId,
      window60sStartMs: Date.now() - 60_000,
      cpuTimeMs: w.cpuTimeMs,
      peakMemoryBytes: w.peakMemoryBytes,
      networkBytesIn: 0,
      networkBytesOut: w.networkBytes,
      concurrentCalls: w.concurrentCalls,
      tokensUsed: w.tokensUsed,
      diskWriteBytes: w.diskWriteBytes,
      totalCalls: w.totalCalls,
      throttledCalls: w.throttledCalls,
      killedAt: this.killList.has(agentId) ? Date.now() : undefined,
      sampledAt: Date.now(),
    };
  }

  generateReport(agentId: string): UsageReport | null {
    const usage = this.getUsage(agentId);
    if (!usage) return null;

    // Rough cost estimate: $0.01 per 1000 tokens + $0.001 per CPU second
    const estimatedCostUSD =
      (usage.tokensUsed / 1_000) * 0.01 +
      (usage.cpuTimeMs / 1_000) * 0.001;

    return {
      agentId,
      period: { from: usage.window60sStartMs, to: Date.now() },
      totalCpuTimeMs: usage.cpuTimeMs,
      peakMemoryBytes: usage.peakMemoryBytes,
      totalNetworkBytes: usage.networkBytesOut,
      totalTokensUsed: usage.tokensUsed,
      totalCalls: usage.totalCalls,
      throttleEvents: this.throttleLog.filter(
        (e) => e.agentId === agentId
      ).length,
      estimatedCostUSD,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private getTracker(agentId: string): AgentResourceTracker | undefined {
    if (!this.trackers.has(agentId)) {
      // Auto-register with standard quota
      this.register(agentId);
    }
    return this.trackers.get(agentId);
  }

  private emitThrottle(
    agentId: string,
    resource: keyof ResourceQuota,
    current: number,
    limit: number,
    action: ThrottleEvent["action"]
  ): void {
    const event: ThrottleEvent = {
      eventId: randomUUID(),
      agentId,
      resource,
      current,
      limit,
      action,
      timestamp: Date.now(),
    };

    this.throttleLog.push(event);
    if (this.throttleLog.length > 50_000) this.throttleLog.shift();

    if (action !== "warn") {
      logger.warn(
        { agentId, resource, current, limit, action },
        "[ResourceMonitor] Resource limit breached"
      );
    }

    this.emit(`resource:${action}`, event);
    this.emit("resource:event", event);
  }

  getThrottleLog(agentId?: string, limit = 100): ThrottleEvent[] {
    const all = agentId
      ? this.throttleLog.filter((e) => e.agentId === agentId)
      : this.throttleLog;
    return all.slice(-limit).reverse();
  }

  destroy(): void {
    clearInterval(this.sampleTimer);
    this.removeAllListeners();
  }

  getGlobalStats() {
    const agents = Array.from(this.trackers.keys());
    return {
      monitoredAgents: agents.length,
      killedAgents: this.killList.size,
      totalThrottleEvents: this.throttleLog.length,
    };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────
let _monitor: ResourceMonitor | null = null;
export function getResourceMonitor(): ResourceMonitor {
  if (!_monitor) _monitor = new ResourceMonitor();
  return _monitor;
}
