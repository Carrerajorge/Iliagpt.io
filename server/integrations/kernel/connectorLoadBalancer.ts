/**
 * ConnectorLoadBalancer — Intelligent request distribution across
 * connector instances, regions, and API versions.
 *
 * Strategies: round-robin, weighted, least-connections, latency-based, random
 */

// ─── Types ───────────────────────────────────────────────────────────

export type LBStrategy = "round_robin" | "weighted" | "least_connections" | "latency_based" | "random";
export type InstanceStatus = "active" | "draining" | "inactive" | "warming_up";

export interface ConnectorInstance {
  id: string;
  connectorId: string;
  region: string;
  baseUrl: string;
  weight: number;
  status: InstanceStatus;
  maxConcurrent: number;
  currentConnections: number;
  totalRequests: number;
  totalErrors: number;
  avgLatencyMs: number;
  lastHealthCheck: number;
  metadata: Record<string, unknown>;
}

export interface LBConfig {
  strategy: LBStrategy;
  healthAware: boolean;
  maxLatencyThresholdMs: number;
  maxErrorRateThreshold: number;
  stickyEnabled: boolean;
  stickyTtlMs: number;
  latencyWeight: number;
  errorRateWeight: number;
  connectionWeight: number;
}

export interface LBDecision {
  instanceId: string;
  connectorId: string;
  region: string;
  baseUrl: string;
  strategy: LBStrategy;
  reason: string;
  score?: number;
  alternatives: number;
}

export interface LBStats {
  connectorId: string;
  totalInstances: number;
  activeInstances: number;
  totalRequests: number;
  requestDistribution: Record<string, number>;
  avgLatencyByInstance: Record<string, number>;
  errorRateByInstance: Record<string, number>;
  stickySessionCount: number;
}

export interface LatencyRecord {
  instanceId: string;
  latencyMs: number;
  timestamp: number;
  success: boolean;
}

export const DEFAULT_LB_CONFIG: LBConfig = {
  strategy: "latency_based",
  healthAware: true,
  maxLatencyThresholdMs: 15_000,
  maxErrorRateThreshold: 0.3,
  stickyEnabled: false,
  stickyTtlMs: 300_000,
  latencyWeight: 0.5,
  errorRateWeight: 0.3,
  connectionWeight: 0.2,
};

// ─── Sticky Session Store ────────────────────────────────────────────

class StickySessionStore {
  private sessions = new Map<string, { instanceId: string; expiresAt: number }>();
  private maxEntries = 5000;

  get(key: string): string | undefined {
    const entry = this.sessions.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) { this.sessions.delete(key); return undefined; }
    return entry.instanceId;
  }

  set(key: string, instanceId: string, ttlMs: number): void {
    if (this.sessions.size >= this.maxEntries) this.evictExpired();
    this.sessions.set(key, { instanceId, expiresAt: Date.now() + ttlMs });
  }

  get size(): number { return this.sessions.size; }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of Array.from(this.sessions.entries())) {
      if (now > entry.expiresAt) this.sessions.delete(key);
    }
    if (this.sessions.size >= this.maxEntries) {
      const sorted = Array.from(this.sessions.entries()).sort(([, a], [, b]) => a.expiresAt - b.expiresAt);
      const toRemove = Math.ceil(sorted.length / 4);
      for (let i = 0; i < toRemove; i++) this.sessions.delete(sorted[i][0]);
    }
  }
}

// ─── Latency Tracker ─────────────────────────────────────────────────

class LatencyTracker {
  private records = new Map<string, LatencyRecord[]>();
  private maxRecords = 200;
  private windowMs = 300_000;

  record(instanceId: string, latencyMs: number, success: boolean): void {
    if (!this.records.has(instanceId)) this.records.set(instanceId, []);
    const list = this.records.get(instanceId)!;
    list.push({ instanceId, latencyMs, timestamp: Date.now(), success });
    if (list.length > this.maxRecords) this.records.set(instanceId, list.slice(-this.maxRecords));
  }

  getAvgLatency(instanceId: string): number {
    const recs = this.getRecent(instanceId);
    if (recs.length === 0) return 0;
    return Math.round(recs.reduce((s, r) => s + r.latencyMs, 0) / recs.length);
  }

  getErrorRate(instanceId: string): number {
    const recs = this.getRecent(instanceId);
    if (recs.length === 0) return 0;
    return recs.filter((r) => !r.success).length / recs.length;
  }

  private getRecent(instanceId: string): LatencyRecord[] {
    const all = this.records.get(instanceId) ?? [];
    const cutoff = Date.now() - this.windowMs;
    return all.filter((r) => r.timestamp >= cutoff);
  }
}

// ─── Load Balancer ───────────────────────────────────────────────────

export class ConnectorLoadBalancer {
  private instances = new Map<string, ConnectorInstance[]>();
  private configs = new Map<string, LBConfig>();
  private rrCounters = new Map<string, number>();
  private stickyStore = new StickySessionStore();
  private latencyTracker = new LatencyTracker();

  registerInstance(instance: ConnectorInstance): void {
    if (!this.instances.has(instance.connectorId)) this.instances.set(instance.connectorId, []);
    const list = this.instances.get(instance.connectorId)!;
    const idx = list.findIndex((i) => i.id === instance.id);
    if (idx >= 0) list[idx] = instance; else list.push(instance);
  }

  removeInstance(connectorId: string, instanceId: string): boolean {
    const list = this.instances.get(connectorId);
    if (!list) return false;
    const idx = list.findIndex((i) => i.id === instanceId);
    if (idx >= 0) { list.splice(idx, 1); return true; }
    return false;
  }

  setConfig(connectorId: string, config: Partial<LBConfig>): void {
    this.configs.set(connectorId, { ...DEFAULT_LB_CONFIG, ...config });
  }

  select(connectorId: string, userId?: string): LBDecision | undefined {
    const config = this.configs.get(connectorId) ?? DEFAULT_LB_CONFIG;
    let candidates = this.instances.get(connectorId) ?? [];
    if (candidates.length === 0) return undefined;

    if (config.healthAware) {
      candidates = candidates.filter((inst) => {
        if (inst.status !== "active" && inst.status !== "warming_up") return false;
        if (this.latencyTracker.getErrorRate(inst.id) > config.maxErrorRateThreshold) return false;
        const avg = this.latencyTracker.getAvgLatency(inst.id);
        if (avg > 0 && avg > config.maxLatencyThresholdMs) return false;
        return true;
      });
      if (candidates.length === 0) {
        candidates = (this.instances.get(connectorId) ?? []).filter((i) => i.status === "active");
      }
    }
    if (candidates.length === 0) return undefined;

    if (config.stickyEnabled && userId) {
      const sticky = this.stickyStore.get(`${connectorId}:${userId}`);
      if (sticky) {
        const inst = candidates.find((i) => i.id === sticky);
        if (inst) return this.mkDecision(inst, "sticky_session", candidates.length, config.strategy);
      }
    }

    let selected: ConnectorInstance;
    switch (config.strategy) {
      case "round_robin": selected = this.roundRobin(connectorId, candidates); break;
      case "weighted": selected = this.weighted(candidates); break;
      case "least_connections": selected = this.leastConn(candidates); break;
      case "latency_based": selected = this.latencyBased(candidates, config); break;
      default: selected = candidates[Math.floor(Math.random() * candidates.length)];
    }

    if (config.stickyEnabled && userId) {
      this.stickyStore.set(`${connectorId}:${userId}`, selected.id, config.stickyTtlMs);
    }
    return this.mkDecision(selected, config.strategy, candidates.length, config.strategy);
  }

  recordOutcome(instanceId: string, connectorId: string, latencyMs: number, success: boolean): void {
    this.latencyTracker.record(instanceId, latencyMs, success);
    const list = this.instances.get(connectorId);
    if (!list) return;
    const inst = list.find((i) => i.id === instanceId);
    if (!inst) return;
    inst.totalRequests++;
    if (!success) inst.totalErrors++;
    inst.avgLatencyMs = inst.avgLatencyMs === 0 ? latencyMs : Math.round(inst.avgLatencyMs * 0.7 + latencyMs * 0.3);
  }

  drainInstance(connectorId: string, instanceId: string): void {
    const inst = (this.instances.get(connectorId) ?? []).find((i) => i.id === instanceId);
    if (inst) inst.status = "draining";
  }

  activateInstance(connectorId: string, instanceId: string): void {
    const inst = (this.instances.get(connectorId) ?? []).find((i) => i.id === instanceId);
    if (inst) inst.status = "active";
  }

  getStats(connectorId: string): LBStats {
    const instances = this.instances.get(connectorId) ?? [];
    const dist: Record<string, number> = {};
    const avgLat: Record<string, number> = {};
    const errRate: Record<string, number> = {};
    let total = 0;
    for (const i of instances) {
      dist[i.id] = i.totalRequests;
      avgLat[i.id] = this.latencyTracker.getAvgLatency(i.id);
      errRate[i.id] = Math.round(this.latencyTracker.getErrorRate(i.id) * 100) / 100;
      total += i.totalRequests;
    }
    return {
      connectorId, totalInstances: instances.length,
      activeInstances: instances.filter((i) => i.status === "active").length,
      totalRequests: total, requestDistribution: dist,
      avgLatencyByInstance: avgLat, errorRateByInstance: errRate,
      stickySessionCount: this.stickyStore.size,
    };
  }

  getAllStats(): LBStats[] { return Array.from(this.instances.keys()).map((id) => this.getStats(id)); }

  private roundRobin(cid: string, c: ConnectorInstance[]): ConnectorInstance {
    const n = (this.rrCounters.get(cid) ?? 0) + 1;
    this.rrCounters.set(cid, n);
    return c[n % c.length];
  }

  private weighted(c: ConnectorInstance[]): ConnectorInstance {
    const tw = c.reduce((s, i) => s + i.weight, 0);
    if (tw === 0) return c[0];
    let r = Math.random() * tw;
    for (const i of c) { r -= i.weight; if (r <= 0) return i; }
    return c[c.length - 1];
  }

  private leastConn(c: ConnectorInstance[]): ConnectorInstance {
    let best = c[0];
    let bestR = best.currentConnections / Math.max(best.maxConcurrent, 1);
    for (let i = 1; i < c.length; i++) {
      const r = c[i].currentConnections / Math.max(c[i].maxConcurrent, 1);
      if (r < bestR) { best = c[i]; bestR = r; }
    }
    return best;
  }

  private latencyBased(c: ConnectorInstance[], cfg: LBConfig): ConnectorInstance {
    let bestScore = -Infinity, best = c[0];
    for (const i of c) {
      const avgLat = this.latencyTracker.getAvgLatency(i.id);
      const errRate = this.latencyTracker.getErrorRate(i.id);
      const connRatio = i.currentConnections / Math.max(i.maxConcurrent, 1);
      const score = (avgLat === 0 ? 1 : 1 / (avgLat / 1000)) * cfg.latencyWeight +
        (1 - errRate) * cfg.errorRateWeight + (1 - connRatio) * cfg.connectionWeight;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  private mkDecision(i: ConnectorInstance, reason: string, alts: number, strategy: LBStrategy): LBDecision {
    return { instanceId: i.id, connectorId: i.connectorId, region: i.region, baseUrl: i.baseUrl, strategy, reason, alternatives: alts };
  }
}

// ─── Regional Affinity Router ────────────────────────────────────────

export class RegionalAffinityRouter {
  private userRegions = new Map<string, string>();
  private regionPriority = new Map<string, string[]>();

  setUserRegion(userId: string, region: string): void { this.userRegions.set(userId, region); }

  setRegionPriority(region: string, fallbackOrder: string[]): void { this.regionPriority.set(region, fallbackOrder); }

  getPreferredRegions(userId: string): string[] {
    const primary = this.userRegions.get(userId) ?? "us-east-1";
    return [primary, ...(this.regionPriority.get(primary) ?? [])];
  }

  sortByAffinity(userId: string, instances: ConnectorInstance[]): ConnectorInstance[] {
    const preferred = this.getPreferredRegions(userId);
    const order = new Map<string, number>();
    preferred.forEach((r, i) => order.set(r, i));
    return [...instances].sort((a, b) => (order.get(a.region) ?? 999) - (order.get(b.region) ?? 999));
  }
}

// ─── Singletons ──────────────────────────────────────────────────────

export const connectorLoadBalancer = new ConnectorLoadBalancer();
export const regionalAffinityRouter = new RegionalAffinityRouter();
