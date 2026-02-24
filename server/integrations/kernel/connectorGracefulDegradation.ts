/* ------------------------------------------------------------------ *
 *  connectorGracefulDegradation.ts — Graceful Degradation primitives:
 *  - SLO tracking (rolling window)
 *  - Stale-while-revalidate cache
 *  - Fallback chain execution
 *
 *  Standalone module — no imports from other kernel files.
 * ------------------------------------------------------------------ */

// ─── Types ──────────────────────────────────────────────────────────

export type DegradationLevel = "NORMAL" | "DEGRADED" | "CRITICAL" | "OFFLINE";

export interface SLODefinition {
  id: string;
  description: string;
  windowMs: number;
  targetAvailability?: number; // 0..1
  targetP95LatencyMs?: number;
  targetErrorRate?: number; // 0..1
}

export interface SLOStatus {
  connectorId: string;
  sloId: string;
  windowMs: number;
  samples: number;
  availability: number; // 0..1
  errorRate: number; // 0..1
  p95LatencyMs?: number;
  lastUpdated: number;
  breached: boolean;
}

export interface DegradationStatus {
  connectorId: string;
  level: DegradationLevel;
  reason: string;
  timestamp: number;
  slo?: SLOStatus[];
}

export interface FallbackStep {
  id: string;
  description?: string;
  execute: (ctx: { connectorId: string; error: unknown; attempt: number }) => Promise<unknown>;
}

export interface FallbackChain {
  id: string;
  connectorId?: string;
  steps: FallbackStep[];
}

export interface FallbackExecutionResult {
  ok: boolean;
  chainId?: string;
  stepId?: string;
  value?: unknown;
  error?: unknown;
  attempts: number;
  startedAt: number;
  completedAt: number;
}

export interface StaleEntry<T = unknown> {
  key: string;
  value: T;
  fetchedAt: number;
  staleAt: number;
  expiresAt: number;
}

// ─── Defaults ───────────────────────────────────────────────────────

export const DEFAULT_SLOS: SLODefinition[] = [
  {
    id: "availability_5m",
    description: "Availability over the last 5 minutes",
    windowMs: 5 * 60_000,
    targetAvailability: 0.99,
    targetErrorRate: 0.01,
  },
  {
    id: "latency_p95_5m",
    description: "P95 latency over the last 5 minutes",
    windowMs: 5 * 60_000,
    targetP95LatencyMs: 5_000,
  },
];

export const DEFAULT_FALLBACK_CHAINS: FallbackChain[] = [];

// ─── Helpers ────────────────────────────────────────────────────────

type OutcomeSample = { ts: number; ok: boolean; latencyMs?: number };

function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

// ─── SLO Tracker ────────────────────────────────────────────────────

export class ServiceLevelObjectiveTracker {
  private readonly slos: SLODefinition[];
  private readonly samplesByConnector: Map<string, OutcomeSample[]> = new Map();

  constructor(defs: SLODefinition[] = DEFAULT_SLOS) {
    this.slos = defs.slice();
  }

  record(connectorId: string, sample: { ok: boolean; latencyMs?: number; ts?: number }): void {
    const ts = typeof sample.ts === "number" ? sample.ts : Date.now();
    const current = this.samplesByConnector.get(connectorId) || [];
    current.push({ ts, ok: sample.ok, latencyMs: sample.latencyMs });
    this.samplesByConnector.set(connectorId, current);

    // Prevent unbounded growth in long-running servers.
    if (current.length > 5_000) {
      current.splice(0, current.length - 5_000);
    }
  }

  getStatus(connectorId: string): SLOStatus[] {
    const now = Date.now();
    const samples = this.samplesByConnector.get(connectorId) || [];

    return this.slos.map((slo) => {
      const cutoff = now - slo.windowMs;
      const windowSamples = samples.filter((s) => s.ts >= cutoff);
      const total = windowSamples.length;
      const okCount = windowSamples.reduce((acc, s) => acc + (s.ok ? 1 : 0), 0);
      const availability = total > 0 ? okCount / total : 1;
      const errorRate = total > 0 ? 1 - availability : 0;
      const latencies = windowSamples
        .map((s) => s.latencyMs)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0);
      const p95LatencyMs = percentile(latencies, 0.95);

      const breached =
        (typeof slo.targetAvailability === "number" && availability < slo.targetAvailability) ||
        (typeof slo.targetErrorRate === "number" && errorRate > slo.targetErrorRate) ||
        (typeof slo.targetP95LatencyMs === "number" &&
          typeof p95LatencyMs === "number" &&
          p95LatencyMs > slo.targetP95LatencyMs);

      return {
        connectorId,
        sloId: slo.id,
        windowMs: slo.windowMs,
        samples: total,
        availability,
        errorRate,
        p95LatencyMs,
        lastUpdated: now,
        breached,
      };
    });
  }

  getDefinitions(): SLODefinition[] {
    return this.slos.slice();
  }
}

export const sloTracker = new ServiceLevelObjectiveTracker(DEFAULT_SLOS);

// ─── Fallback Chain Manager ─────────────────────────────────────────

export class FallbackChainManager {
  private readonly chains: Map<string, FallbackChain> = new Map();

  constructor(chains: FallbackChain[] = DEFAULT_FALLBACK_CHAINS) {
    for (const c of chains) this.register(c);
  }

  register(chain: FallbackChain): void {
    this.chains.set(chain.id, chain);
  }

  get(chainId: string): FallbackChain | undefined {
    return this.chains.get(chainId);
  }

  async execute(chainId: string, ctx: { connectorId: string; error: unknown }): Promise<FallbackExecutionResult> {
    const startedAt = Date.now();
    const chain = this.chains.get(chainId);
    if (!chain) {
      return {
        ok: false,
        chainId,
        error: new Error(`Fallback chain not found: ${chainId}`),
        attempts: 0,
        startedAt,
        completedAt: Date.now(),
      };
    }

    let lastError: unknown = ctx.error;
    let attempt = 0;

    for (const step of chain.steps) {
      attempt++;
      try {
        const value = await step.execute({
          connectorId: ctx.connectorId,
          error: lastError,
          attempt,
        });
        return {
          ok: true,
          chainId,
          stepId: step.id,
          value,
          attempts: attempt,
          startedAt,
          completedAt: Date.now(),
        };
      } catch (err) {
        lastError = err;
      }
    }

    return {
      ok: false,
      chainId,
      error: lastError,
      attempts: attempt,
      startedAt,
      completedAt: Date.now(),
    };
  }
}

export const fallbackChainManager = new FallbackChainManager(DEFAULT_FALLBACK_CHAINS);

// ─── Stale-While-Revalidate Cache ───────────────────────────────────

export class StaleWhileRevalidate {
  private readonly entries: Map<string, StaleEntry<any>> = new Map();

  get<T>(key: string): StaleEntry<T> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const now = Date.now();
    if (now >= entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry as StaleEntry<T>;
  }

  set<T>(key: string, value: T, opts: { ttlMs: number; staleTtlMs?: number }): StaleEntry<T> {
    const now = Date.now();
    const ttlMs = Math.max(0, opts.ttlMs);
    const staleTtlMs = Math.max(0, typeof opts.staleTtlMs === "number" ? opts.staleTtlMs : ttlMs);

    const entry: StaleEntry<T> = {
      key,
      value,
      fetchedAt: now,
      staleAt: now + staleTtlMs,
      expiresAt: now + ttlMs,
    };
    this.entries.set(key, entry);
    return entry;
  }

  isStale(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return true;
    return Date.now() >= entry.staleAt;
  }

  purge(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (now >= entry.expiresAt) this.entries.delete(key);
    }
  }
}

export const staleWhileRevalidateCache = new StaleWhileRevalidate();

// ─── Degradation Orchestrator ───────────────────────────────────────

export class DegradationOrchestrator {
  private readonly statusByConnector: Map<string, DegradationStatus> = new Map();

  evaluate(connectorId: string): DegradationStatus {
    const statuses = sloTracker.getStatus(connectorId);
    const availability = statuses.find((s) => s.sloId.startsWith("availability"))?.availability;
    const breachedAny = statuses.some((s) => s.breached);

    let level: DegradationLevel = "NORMAL";
    let reason = "SLOs within targets";

    if (typeof availability === "number" && availability < 0.5) {
      level = "OFFLINE";
      reason = `Availability critically low (${Math.round(availability * 100)}%)`;
    } else if (breachedAny) {
      level = "DEGRADED";
      reason = "One or more SLOs breached";
    }

    const next: DegradationStatus = {
      connectorId,
      level,
      reason,
      timestamp: Date.now(),
      slo: statuses,
    };

    this.statusByConnector.set(connectorId, next);
    return next;
  }

  get(connectorId: string): DegradationStatus | undefined {
    return this.statusByConnector.get(connectorId);
  }

  getLevel(connectorId: string): DegradationLevel {
    return this.statusByConnector.get(connectorId)?.level || "NORMAL";
  }
}

export const degradationOrchestrator = new DegradationOrchestrator();

