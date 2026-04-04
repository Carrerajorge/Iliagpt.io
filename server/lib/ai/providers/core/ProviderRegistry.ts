/**
 * Universal LLM Provider System — ProviderRegistry
 *
 * Singleton registry that owns the lifecycle of every registered IProvider.
 * Responsibilities:
 *
 *   • register / unregister providers
 *   • route requests to the best available provider (by composite score)
 *   • run a periodic health-check loop (setTimeout recursion, not setInterval)
 *   • emit typed events for monitoring / telemetry consumers
 *   • provide a fallback chain when a primary provider is unavailable
 *   • graceful shutdown (dispose all providers in parallel)
 *
 * Usage:
 *   import { providerRegistry } from './ProviderRegistry';
 *   providerRegistry.register(new OpenAIProvider(config));
 *   const provider = providerRegistry.getBest({ capability: ModelCapability.VISION });
 */

import { EventEmitter } from 'events';
import { Logger } from '../../logger';
import {
  type IProvider,
  type IProviderRegistry,
  type IHealthCheckResult,
  type IModelInfo,
  type StatusChangedPayload,
  ModelCapability,
  ProviderStatus,
  ProviderStatusSeverity,
  ProviderEvents,
  ProviderError,
} from './types';

// ============================================================================
// Query types for provider selection
// ============================================================================

/**
 * Criteria passed to `getBest()` to select the optimal provider.
 * All fields are optional — omitting them returns the highest-scoring
 * available provider regardless of capability or preference.
 */
export interface ProviderQuery {
  /** Bitmask of capabilities the selected provider MUST support. */
  capability?       : number;
  /** Prefer this provider name if it is currently healthy. */
  preferredProvider?: string;
  /** Explicitly exclude these provider names. */
  excludeProviders? : string[];
  /**
   * Weighting strategy:
   *   'reliability' — maximise historical uptime (default)
   *   'latency'     — minimise average response time
   *   'cost'        — placeholder for future cost-based routing
   */
  strategy?         : 'reliability' | 'latency' | 'cost';
}

/**
 * Detailed selection result — includes the winning provider and the
 * full scored list so callers can implement their own fallback iteration.
 */
export interface ProviderSelectionResult {
  provider : IProvider;
  score    : number;
  allScored: Array<{ provider: IProvider; score: number }>;
}

// ============================================================================
// Internal stored entry
// ============================================================================

interface ProviderEntry {
  provider         : IProvider;
  registeredAt     : Date;
  lastHealthCheck? : IHealthCheckResult;
}

// ============================================================================
// ProviderRegistry
// ============================================================================

class ProviderRegistry extends EventEmitter implements IProviderRegistry {
  private readonly _providers = new Map<string, ProviderEntry>();

  /** How often to run health checks (ms). Adjustable at runtime. */
  public healthCheckIntervalMs = 60_000; // 1 minute

  private _healthLoopTimer: ReturnType<typeof setTimeout> | null = null;
  private _healthLoopRunning = false;
  private _disposed = false;

  // ──────────────────────────────────────────────────────────────────────────
  // Registration
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Register a provider.  If a provider with the same name is already
   * registered it will be replaced (the old one is disposed first).
   */
  register(provider: IProvider): void {
    if (this._disposed) {
      throw new Error('[ProviderRegistry] Cannot register on a disposed registry.');
    }

    const existing = this._providers.get(provider.name);
    if (existing) {
      Logger.warn(`[Registry] Replacing existing provider "${provider.name}"`);
      // Dispose old provider asynchronously — don't await to avoid blocking.
      existing.provider.dispose().catch(err =>
        Logger.error(`[Registry] Error disposing replaced provider "${provider.name}"`, err),
      );
    }

    // Forward provider-level events to the registry so consumers only need
    // to subscribe to one EventEmitter.
    this._forwardProviderEvents(provider);

    this._providers.set(provider.name, {
      provider,
      registeredAt: new Date(),
    });

    Logger.info(`[Registry] Registered provider "${provider.name}"`);
    this.emit(ProviderEvents.REGISTERED, { provider: provider.name, timestamp: new Date() });
  }

  /**
   * Remove a provider from the registry and dispose it.
   * Returns `true` if the provider existed, `false` otherwise.
   */
  unregister(name: string): boolean {
    const entry = this._providers.get(name);
    if (!entry) return false;

    this._providers.delete(name);
    entry.provider.dispose().catch(err =>
      Logger.error(`[Registry] Error disposing provider "${name}"`, err),
    );

    Logger.info(`[Registry] Unregistered provider "${name}"`);
    this.emit(ProviderEvents.UNREGISTERED, { provider: name, timestamp: new Date() });
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Retrieval
  // ──────────────────────────────────────────────────────────────────────────

  /** Returns the provider with `name`, or `undefined`. */
  get(name: string): IProvider | undefined {
    return this._providers.get(name)?.provider;
  }

  /** Returns the provider with `name` or throws if not registered. */
  getOrThrow(name: string): IProvider {
    const p = this.get(name);
    if (!p) throw new Error(`[ProviderRegistry] Provider "${name}" is not registered.`);
    return p;
  }

  /**
   * Returns all providers whose status is ACTIVE or DEGRADED (i.e. they can
   * still accept requests), sorted by composite reliability score descending.
   */
  getHealthy(): IProvider[] {
    return this._allScoredProviders({ strategy: 'reliability' })
      .filter(s => this._isHealthy(s.provider))
      .map(s => s.provider);
  }

  /** Returns ALL registered providers sorted by score descending. */
  list(): IProvider[] {
    return this._allScoredProviders({ strategy: 'reliability' }).map(s => s.provider);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Smart routing
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Select the best provider for a given query.
   *
   * Selection algorithm:
   *  1. Filter by required capabilities (bitmask AND).
   *  2. Exclude providers listed in `excludeProviders`.
   *  3. Keep only healthy providers (ACTIVE or DEGRADED).
   *  4. If `preferredProvider` is healthy & passes filters, return it immediately.
   *  5. Score remaining candidates and return highest score.
   *
   * Throws if no provider meets the criteria.
   */
  getBest(query: ProviderQuery = {}): ProviderSelectionResult {
    const {
      capability        = ModelCapability.NONE,
      preferredProvider,
      excludeProviders  = [],
      strategy          = 'reliability',
    } = query;

    // Step 1 + 2 + 3: filter candidates.
    const candidates = Array.from(this._providers.values())
      .map(e => e.provider)
      .filter(p => !excludeProviders.includes(p.name))
      .filter(p => this._isHealthy(p))
      .filter(p => capability === ModelCapability.NONE || this._providerSupports(p, capability));

    if (candidates.length === 0) {
      const reason = capability !== ModelCapability.NONE
        ? `capability mask 0x${capability.toString(16)}`
        : 'any capability';
      throw new ProviderError({
        message  : `[Registry] No healthy provider available for ${reason}.`,
        provider : 'registry',
        requestId: 'routing',
        retryable: true,
      });
    }

    // Step 4: short-circuit to preferred.
    if (preferredProvider) {
      const preferred = candidates.find(p => p.name === preferredProvider);
      if (preferred) {
        const allScored = this._scoreProviders(candidates, strategy);
        return {
          provider : preferred,
          score    : allScored.find(s => s.provider === preferred)?.score ?? 1,
          allScored,
        };
      }
      Logger.warn(
        `[Registry] Preferred provider "${preferredProvider}" is unavailable — ` +
        `falling back to scored selection.`,
      );
    }

    // Step 5: score and pick best.
    const allScored = this._scoreProviders(candidates, strategy);
    const best      = allScored[0];

    Logger.debug(
      `[Registry] Routing to "${best.provider.name}" ` +
      `(score=${best.score.toFixed(3)}, strategy=${strategy})`,
    );

    return { provider: best.provider, score: best.score, allScored };
  }

  /**
   * Build an ordered fallback chain starting from `primaryName`.
   * Returns a list of provider names that are currently healthy, excluding
   * any names in `exclude`.  Respects the provider's own `config.fallbackChain`
   * if configured; otherwise falls back to registry-scored ordering.
   */
  buildFallbackChain(primaryName: string, exclude: string[] = []): IProvider[] {
    const primary  = this.get(primaryName);
    const excluded = new Set([primaryName, ...exclude]);

    // Use explicit chain if configured on the primary.
    if (primary?.config.fallbackChain) {
      return primary.config.fallbackChain
        .filter(name => !excluded.has(name))
        .map(name => this.get(name))
        .filter((p): p is IProvider => p !== undefined && this._isHealthy(p));
    }

    // Default: registry scoring, excluding the primary.
    return this.getHealthy().filter(p => !excluded.has(p.name));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Health-check loop
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Start the periodic health-check loop.
   * Safe to call multiple times — only one loop will run.
   */
  startHealthCheckLoop(): void {
    if (this._healthLoopRunning) return;
    this._healthLoopRunning = true;
    Logger.info(`[Registry] Health-check loop started (interval=${this.healthCheckIntervalMs}ms)`);
    this._scheduleNextHealthCheck();
  }

  /** Stop the health-check loop (does not dispose providers). */
  stopHealthCheckLoop(): void {
    if (this._healthLoopTimer) {
      clearTimeout(this._healthLoopTimer);
      this._healthLoopTimer = null;
    }
    this._healthLoopRunning = false;
    Logger.info('[Registry] Health-check loop stopped.');
  }

  /**
   * Run a single health-check round across all registered providers in parallel.
   * Updates each entry's `lastHealthCheck` and emits HEALTH_CHECK_DONE.
   */
  async runHealthChecks(): Promise<IHealthCheckResult[]> {
    const entries = Array.from(this._providers.values());
    if (entries.length === 0) return [];

    Logger.debug(`[Registry] Running health checks for ${entries.length} provider(s)…`);

    const results = await Promise.allSettled(
      entries.map(async (entry) => {
        const result = await entry.provider.healthCheck();
        entry.lastHealthCheck = result;
        return result;
      }),
    );

    const healthResults: IHealthCheckResult[] = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      // If healthCheck() itself threw, create a synthetic result.
      const name = entries[i].provider.name;
      Logger.error(`[Registry] healthCheck() threw for "${name}"`, r.reason);
      return {
        provider   : name,
        status     : ProviderStatus.UNAVAILABLE,
        latencyMs  : 0,
        checkedAt  : new Date(),
        message    : String(r.reason),
        configValid: false,
      };
    });

    this.emit(ProviderEvents.HEALTH_CHECK_DONE, healthResults);
    return healthResults;
  }

  /**
   * Return the most recent health-check result for a provider.
   * Returns `undefined` if no check has been run yet.
   */
  getLastHealthCheck(name: string): IHealthCheckResult | undefined {
    return this._providers.get(name)?.lastHealthCheck;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Model catalogue
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Aggregate model lists from all healthy providers.
   * Annotates each model with `available` = true only if the provider is
   * currently ACTIVE or DEGRADED.
   */
  async listAllModels(): Promise<IModelInfo[]> {
    const healthy = this.getHealthy();
    const results = await Promise.allSettled(healthy.map(p => p.listModels()));

    const models: IModelInfo[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        for (const model of r.value) {
          models.push({ ...model, available: this._isHealthy(healthy[i]) });
        }
      } else {
        Logger.warn(`[Registry] listModels() failed for "${healthy[i].name}"`, r.reason);
      }
    }

    return models;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Introspection / Diagnostics
  // ──────────────────────────────────────────────────────────────────────────

  /** Snapshot of all provider statuses for admin dashboards. */
  statusSnapshot(): Array<{
    name         : string;
    status       : ProviderStatus;
    score        : number;
    reliability  : number;
    avgLatencyMs : number;
    registeredAt : Date;
    lastCheck?   : IHealthCheckResult;
  }> {
    const scored = this._allScoredProviders({ strategy: 'reliability' });
    return scored.map(({ provider, score }) => {
      const entry = this._providers.get(provider.name)!;
      const p     = provider as any; // access BaseProvider getters

      return {
        name        : provider.name,
        status      : provider.status,
        score,
        reliability : p.reliabilityScore  ?? 0,
        avgLatencyMs: p.averageLatencyMs   ?? 0,
        registeredAt: entry.registeredAt,
        lastCheck   : entry.lastHealthCheck,
      };
    });
  }

  /** Returns a count breakdown by status. */
  statusCounts(): Record<ProviderStatus, number> {
    const counts = Object.fromEntries(
      Object.values(ProviderStatus).map(s => [s, 0]),
    ) as Record<ProviderStatus, number>;

    for (const entry of this._providers.values()) {
      counts[entry.provider.status]++;
    }
    return counts;
  }

  /** True if at least one provider is currently healthy. */
  get hasHealthyProvider(): boolean {
    return Array.from(this._providers.values()).some(e => this._isHealthy(e.provider));
  }

  /** Total number of registered providers. */
  get size(): number {
    return this._providers.size;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Gracefully dispose all providers and stop the health-check loop.
   * After calling this, the registry should not be used.
   */
  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;

    this.stopHealthCheckLoop();

    const names   = Array.from(this._providers.keys());
    const entries = Array.from(this._providers.values());
    this._providers.clear();

    await Promise.allSettled(entries.map(e => e.provider.dispose()));
    Logger.info(`[Registry] Disposed ${names.length} provider(s): ${names.join(', ')}`);
    this.removeAllListeners();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  private _scheduleNextHealthCheck(): void {
    if (!this._healthLoopRunning || this._disposed) return;

    this._healthLoopTimer = setTimeout(async () => {
      try {
        await this.runHealthChecks();
      } catch (err) {
        Logger.error('[Registry] Unexpected error in health-check loop', err);
      } finally {
        // Schedule the NEXT check only after this one finishes — prevents pileup.
        this._scheduleNextHealthCheck();
      }
    }, this.healthCheckIntervalMs);
  }

  /**
   * Score all providers under the given strategy and sort descending.
   *
   * Composite score formula:
   *   reliability strategy → reliability × statusWeight × (1 − latencyNorm)
   *   latency strategy     → (1 − latencyNorm) × statusWeight
   *
   * statusWeight:
   *   ACTIVE   → 1.0
   *   DEGRADED → 0.6
   *   others   → 0.0  (filtered out by callers, but score remains correct)
   */
  private _scoreProviders(
    providers: IProvider[],
    strategy : 'reliability' | 'latency' | 'cost',
  ): Array<{ provider: IProvider; score: number }> {
    if (providers.length === 0) return [];

    // Find max latency for normalisation.
    const latencies = providers.map(p => (p as any).averageLatencyMs ?? 9999);
    const maxLatency = Math.max(...latencies, 1);

    return providers
      .map((provider, i) => {
        const reliability  = (provider as any).reliabilityScore  ?? 0.5;
        const latencyNorm  = latencies[i] / maxLatency;           // 0–1, lower is better
        const statusWeight = this._statusWeight(provider.status);

        let score: number;
        switch (strategy) {
          case 'latency':
            score = (1 - latencyNorm) * statusWeight;
            break;
          case 'cost':
            // TODO: integrate real cost data from IModelInfo.pricing.
            // For now fall through to reliability.
            score = reliability * statusWeight * (1 - latencyNorm * 0.3);
            break;
          default: // 'reliability'
            score = reliability * statusWeight * (1 - latencyNorm * 0.2);
        }

        return { provider, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  private _allScoredProviders(query: Pick<ProviderQuery, 'strategy'>): Array<{ provider: IProvider; score: number }> {
    const all = Array.from(this._providers.values()).map(e => e.provider);
    return this._scoreProviders(all, query.strategy ?? 'reliability');
  }

  private _statusWeight(status: ProviderStatus): number {
    switch (status) {
      case ProviderStatus.ACTIVE      : return 1.0;
      case ProviderStatus.DEGRADED    : return 0.6;
      case ProviderStatus.RATE_LIMITED: return 0.3;
      default                         : return 0.0;
    }
  }

  private _isHealthy(provider: IProvider): boolean {
    return (
      provider.status === ProviderStatus.ACTIVE ||
      provider.status === ProviderStatus.DEGRADED
    );
  }

  /**
   * Check whether a provider has all the required capabilities.
   * Tries to call `listModels()` result first; falls back to
   * checking `provider.config.extra.capabilities` if set.
   * If neither is available, assume the provider supports everything
   * (conservative — avoids false negatives at startup).
   */
  private _providerSupports(provider: IProvider, capMask: number): boolean {
    const extra = provider.config.extra as any;
    if (typeof extra?.capabilities === 'number') {
      return (extra.capabilities & capMask) === capMask;
    }
    // No capability metadata available — assume supported.
    return true;
  }

  /** Forward typed events from an individual provider up to the registry bus. */
  private _forwardProviderEvents(provider: IProvider): void {
    provider.on(ProviderEvents.REQUEST_SUCCESS, (payload) => {
      this.emit(ProviderEvents.REQUEST_SUCCESS, payload);
    });

    provider.on(ProviderEvents.REQUEST_FAILURE, (payload) => {
      this.emit(ProviderEvents.REQUEST_FAILURE, payload);
    });

    provider.on(ProviderEvents.STATUS_CHANGED, (payload: StatusChangedPayload) => {
      this.emit(ProviderEvents.STATUS_CHANGED, payload);

      // Log at appropriate severity based on how bad the change is.
      const prevSev = ProviderStatusSeverity[payload.previous];
      const currSev = ProviderStatusSeverity[payload.current];
      const msg = `[Registry] "${payload.provider}" ${payload.previous} → ${payload.current}`;

      if (currSev > prevSev) {
        Logger.warn(msg);
      } else {
        Logger.info(msg);
      }
    });
  }
}

// ============================================================================
// Module-level singleton — the idiomatic Node.js pattern.
// Import this object everywhere; never instantiate ProviderRegistry directly.
// ============================================================================

export const providerRegistry = new ProviderRegistry();

/**
 * Convenience: register the process shutdown hooks so the registry disposes
 * cleanly on SIGTERM / SIGINT.  Call this once from server/index.ts.
 */
export function registerRegistryShutdownHooks(): void {
  const handler = async (signal: string) => {
    Logger.info(`[Registry] Received ${signal} — disposing providers…`);
    await providerRegistry.dispose();
  };

  process.once('SIGTERM', () => handler('SIGTERM'));
  process.once('SIGINT',  () => handler('SIGINT'));
}
