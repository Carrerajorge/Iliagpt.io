/**
 * Universal LLM Provider System — Provider Registry (Singleton)
 *
 * Central hub for all provider instances:
 *   - register / unregister providers
 *   - periodic health monitoring with event emission
 *   - lazy model-list caching
 *   - metrics aggregation
 */

import { EventEmitter } from 'events';
import {
  IProvider,
  IProviderConfig,
  IRegistryEntry,
  IProviderHealth,
  IModelInfo,
  ProviderStatus,
  ModelCapability,
} from './types';

// ─── Event map (typed) ────────────────────────────────────────────────────────

export interface RegistryEvents {
  'provider:registered': (name: string) => void;
  'provider:unregistered': (name: string) => void;
  'health:change': (health: IProviderHealth) => void;
  'health:check': (results: IProviderHealth[]) => void;
  'error': (err: Error, provider: string) => void;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _instance: ProviderRegistry | null = null;

export class ProviderRegistry extends EventEmitter {
  private _entries = new Map<string, IRegistryEntry>();
  private _healthTimer?: NodeJS.Timeout;
  private readonly _healthIntervalMs: number;
  private readonly _modelCacheTtlMs: number;

  private constructor(
    healthIntervalMs = 60_000,
    modelCacheTtlMs = 300_000, // 5 min
  ) {
    super();
    this._healthIntervalMs = healthIntervalMs;
    this._modelCacheTtlMs = modelCacheTtlMs;
    this.setMaxListeners(50);
    this._startHealthMonitor();
  }

  static getInstance(healthIntervalMs?: number, modelCacheTtlMs?: number): ProviderRegistry {
    if (!_instance) {
      _instance = new ProviderRegistry(healthIntervalMs, modelCacheTtlMs);
    }
    return _instance;
  }

  /** For testing: reset the singleton. */
  static reset(): void {
    if (_instance) {
      _instance.destroy();
      _instance = null;
    }
  }

  // ── Registration ────────────────────────────────────────────────────────────

  async register(provider: IProvider, config: IProviderConfig): Promise<void> {
    const name = provider.name;
    if (this._entries.has(name)) {
      throw new Error(`Provider "${name}" is already registered. Unregister first.`);
    }

    await provider.initialize(config);

    const health: IProviderHealth = {
      provider: name,
      status: ProviderStatus.Initializing,
      latencyMs: 0,
      successRate: 1,
      errorRate: 0,
      lastChecked: new Date(),
    };

    const entry: IRegistryEntry = {
      provider,
      config,
      health,
      models: [],
      registeredAt: new Date(),
    };

    this._entries.set(name, entry);

    // Run first health check and model refresh asynchronously
    this._checkProviderHealth(name).catch(() => {});
    this._refreshModels(name).catch(() => {});

    this.emit('provider:registered', name);
  }

  async unregister(name: string): Promise<void> {
    const entry = this._entries.get(name);
    if (!entry) return;

    await entry.provider.dispose();
    this._entries.delete(name);
    this.emit('provider:unregistered', name);
  }

  // ── Accessors ───────────────────────────────────────────────────────────────

  getProvider(name: string): IProvider {
    const entry = this._entries.get(name);
    if (!entry) throw new Error(`Provider "${name}" not found in registry`);
    return entry.provider;
  }

  tryGetProvider(name: string): IProvider | null {
    return this._entries.get(name)?.provider ?? null;
  }

  listProviders(): string[] {
    return Array.from(this._entries.keys());
  }

  listActiveProviders(): string[] {
    return Array.from(this._entries.entries())
      .filter(([, e]) => e.health.status === ProviderStatus.Active || e.health.status === ProviderStatus.Degraded)
      .map(([name]) => name);
  }

  getHealth(name: string): IProviderHealth {
    const entry = this._entries.get(name);
    if (!entry) throw new Error(`Provider "${name}" not found`);
    return entry.health;
  }

  getAllHealth(): IProviderHealth[] {
    return Array.from(this._entries.values()).map((e) => e.health);
  }

  async getModels(name: string, forceRefresh = false): Promise<IModelInfo[]> {
    const entry = this._entries.get(name);
    if (!entry) throw new Error(`Provider "${name}" not found`);

    const age = Date.now() - entry.registeredAt.getTime();
    if (entry.models.length === 0 || forceRefresh || age > this._modelCacheTtlMs) {
      await this._refreshModels(name);
    }
    return entry.models;
  }

  async getAllModels(forceRefresh = false): Promise<IModelInfo[]> {
    const results = await Promise.allSettled(
      this.listProviders().map((name) => this.getModels(name, forceRefresh)),
    );
    return results
      .filter((r): r is PromiseFulfilledResult<IModelInfo[]> => r.status === 'fulfilled')
      .flatMap((r) => r.value);
  }

  /**
   * Find the best provider+model for a given set of capabilities.
   * Returns null if none qualify.
   */
  async findModel(
    requiredCapabilities: ModelCapability[],
    preferredProviders?: string[],
  ): Promise<{ provider: string; model: IModelInfo } | null> {
    const allModels = await this.getAllModels();

    const candidates = allModels.filter((m) =>
      requiredCapabilities.every((cap) => m.capabilities.includes(cap)),
    );

    if (candidates.length === 0) return null;

    // Prefer requested providers first, then sort by quality score
    const preferred = preferredProviders ?? [];
    candidates.sort((a, b) => {
      const aPreferred = preferred.includes(a.provider) ? 1 : 0;
      const bPreferred = preferred.includes(b.provider) ? 1 : 0;
      if (bPreferred !== aPreferred) return bPreferred - aPreferred;
      return b.qualityScore - a.qualityScore;
    });

    const best = candidates[0];
    return { provider: best.provider, model: best };
  }

  // ── Health monitoring ───────────────────────────────────────────────────────

  private _startHealthMonitor(): void {
    this._healthTimer = setInterval(async () => {
      const names = this.listProviders();
      const results = await Promise.allSettled(
        names.map((name) => this._checkProviderHealth(name)),
      );
      const healthList = results
        .map((r, i) => (r.status === 'fulfilled' ? r.value : this._entries.get(names[i])?.health))
        .filter((h): h is IProviderHealth => !!h);

      this.emit('health:check', healthList);
    }, this._healthIntervalMs);

    this._healthTimer.unref(); // Don't block process exit
  }

  private async _checkProviderHealth(name: string): Promise<IProviderHealth> {
    const entry = this._entries.get(name);
    if (!entry) throw new Error(`Provider "${name}" not found`);

    const t0 = Date.now();
    let status: ProviderStatus;
    let lastError: string | undefined;

    try {
      const ok = await entry.provider.healthCheck();
      status = ok ? ProviderStatus.Active : ProviderStatus.Unavailable;
    } catch (err) {
      status = ProviderStatus.Unavailable;
      lastError = err instanceof Error ? err.message : String(err);
      this.emit('error', err instanceof Error ? err : new Error(String(err)), name);
    }

    const latencyMs = Date.now() - t0;
    const prevStatus = entry.health.status;
    const metrics = (entry.provider as any).getMetrics?.() ?? {};

    entry.health = {
      provider: name,
      status,
      latencyMs,
      successRate: metrics.successRate ?? 1,
      errorRate: metrics.errorRate ?? 0,
      lastChecked: new Date(),
      lastError,
    };

    if (prevStatus !== status) {
      this.emit('health:change', entry.health);
    }

    return entry.health;
  }

  private async _refreshModels(name: string): Promise<void> {
    const entry = this._entries.get(name);
    if (!entry) return;

    try {
      const models = await entry.provider.listModels();
      entry.models = models.map((m) => ({ ...m, provider: name }));
    } catch {
      // Non-fatal: keep stale models
    }
  }

  // ── Aggregated stats ────────────────────────────────────────────────────────

  getStats() {
    const entries = Array.from(this._entries.values());
    const active = entries.filter((e) => e.health.status === ProviderStatus.Active).length;
    const degraded = entries.filter((e) => e.health.status === ProviderStatus.Degraded).length;
    const unavailable = entries.filter((e) => e.health.status === ProviderStatus.Unavailable).length;

    return {
      total: entries.length,
      active,
      degraded,
      unavailable,
      avgLatencyMs:
        entries.length > 0
          ? entries.reduce((s, e) => s + e.health.latencyMs, 0) / entries.length
          : 0,
    };
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  destroy(): void {
    if (this._healthTimer) {
      clearInterval(this._healthTimer);
      this._healthTimer = undefined;
    }
    this._entries.clear();
    this.removeAllListeners();
  }

  // Typed emit overloads
  emit(event: 'provider:registered', name: string): boolean;
  emit(event: 'provider:unregistered', name: string): boolean;
  emit(event: 'health:change', health: IProviderHealth): boolean;
  emit(event: 'health:check', results: IProviderHealth[]): boolean;
  emit(event: 'error', err: Error, provider: string): boolean;
  emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }
}

// Convenience export
export const registry = ProviderRegistry.getInstance();
