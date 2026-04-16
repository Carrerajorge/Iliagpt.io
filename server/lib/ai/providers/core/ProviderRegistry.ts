/**
 * ProviderRegistry — Singleton registry for all LLM providers
 *
 * Features:
 * - Runtime hot-swap (add/remove providers without restart)
 * - Periodic health monitoring with configurable intervals
 * - Event emission for provider status changes
 * - Capability-based provider lookup
 */

import EventEmitter from "events";
import { type BaseProvider } from "./BaseProvider.js";
import {
  type IModelInfo,
  type IProvider,
  type IProviderEvent,
  type IProviderHealth,
  ModelCapability,
  ProviderError,
  ProviderStatus,
} from "./types.js";

// ─────────────────────────────────────────────
// Registry Configuration
// ─────────────────────────────────────────────

export interface RegistryConfig {
  healthCheckIntervalMs: number;   // How often to run health checks
  healthCheckTimeoutMs: number;    // Timeout for individual health checks
  autoEvictUnhealthy: boolean;     // Auto-disable consistently unhealthy providers
  maxConsecutiveFailuresBeforeEvict: number;
}

const DEFAULT_REGISTRY_CONFIG: RegistryConfig = {
  healthCheckIntervalMs: 60_000,     // 1 minute
  healthCheckTimeoutMs: 10_000,      // 10 seconds
  autoEvictUnhealthy: false,
  maxConsecutiveFailuresBeforeEvict: 10,
};

// ─────────────────────────────────────────────
// ProviderRegistry
// ─────────────────────────────────────────────

export class ProviderRegistry extends EventEmitter {
  private static _instance: ProviderRegistry | null = null;

  private readonly _providers = new Map<string, BaseProvider>();
  private readonly _disabledProviders = new Set<string>();
  private _healthCheckTimer?: ReturnType<typeof setInterval>;
  private readonly _config: RegistryConfig;

  private constructor(config: Partial<RegistryConfig> = {}) {
    super();
    this._config = { ...DEFAULT_REGISTRY_CONFIG, ...config };
    this.startHealthMonitoring();
  }

  static getInstance(config?: Partial<RegistryConfig>): ProviderRegistry {
    if (!ProviderRegistry._instance) {
      ProviderRegistry._instance = new ProviderRegistry(config);
    }
    return ProviderRegistry._instance;
  }

  /** Reset singleton — for testing only */
  static resetInstance(): void {
    if (ProviderRegistry._instance) {
      ProviderRegistry._instance.stopHealthMonitoring();
      ProviderRegistry._instance = null;
    }
  }

  // ─── Registration ───

  register(provider: BaseProvider): void {
    const existing = this._providers.get(provider.id);
    if (existing) {
      console.warn(`[ProviderRegistry] Provider '${provider.id}' is being replaced (hot-swap).`);
    }

    // Forward provider health events to registry
    provider.on("health_changed", (data: unknown) => {
      const event: IProviderEvent = {
        type: "health_changed",
        providerId: provider.id,
        timestamp: new Date(),
        data,
      };
      this.emit("provider_event", event);

      if (
        this._config.autoEvictUnhealthy &&
        provider.health.consecutiveErrors >= this._config.maxConsecutiveFailuresBeforeEvict
      ) {
        console.error(
          `[ProviderRegistry] Auto-evicting '${provider.id}' after ${provider.health.consecutiveErrors} consecutive failures.`,
        );
        this._disabledProviders.add(provider.id);
        this.emitEvent("health_changed", provider.id, { disabled: true });
      }
    });

    this._providers.set(provider.id, provider);
    this._disabledProviders.delete(provider.id);

    console.log(`[ProviderRegistry] Registered provider '${provider.id}' (${provider.name}).`);
    this.emitEvent("registered", provider.id);
  }

  unregister(providerId: string): boolean {
    const provider = this._providers.get(providerId);
    if (!provider) return false;

    provider.removeAllListeners();
    this._providers.delete(providerId);
    this._disabledProviders.delete(providerId);

    console.log(`[ProviderRegistry] Unregistered provider '${providerId}'.`);
    this.emitEvent("unregistered", providerId);
    return true;
  }

  enable(providerId: string): void {
    this._disabledProviders.delete(providerId);
  }

  disable(providerId: string): void {
    this._disabledProviders.add(providerId);
  }

  // ─── Lookup ───

  getProvider(providerId: string): BaseProvider {
    const provider = this._providers.get(providerId);
    if (!provider) {
      throw new ProviderError(
        `Provider '${providerId}' not registered`,
        providerId,
        "PROVIDER_NOT_FOUND",
      );
    }
    if (this._disabledProviders.has(providerId)) {
      throw new ProviderError(
        `Provider '${providerId}' is disabled`,
        providerId,
        "PROVIDER_DISABLED",
      );
    }
    return provider;
  }

  tryGetProvider(providerId: string): BaseProvider | undefined {
    if (this._disabledProviders.has(providerId)) return undefined;
    return this._providers.get(providerId);
  }

  listProviders(): IProvider[] {
    return Array.from(this._providers.values()).filter(
      (p) => !this._disabledProviders.has(p.id),
    );
  }

  listAllProviders(): IProvider[] {
    return Array.from(this._providers.values());
  }

  hasProvider(providerId: string): boolean {
    return this._providers.has(providerId) && !this._disabledProviders.has(providerId);
  }

  /**
   * Find providers that support a specific capability.
   * Optionally filter by health status.
   */
  getProvidersByCapability(
    capability: ModelCapability,
    requireHealthy = true,
  ): BaseProvider[] {
    return Array.from(this._providers.values()).filter((p) => {
      if (this._disabledProviders.has(p.id)) return false;
      if (requireHealthy && p.health.status === ProviderStatus.UNAVAILABLE) return false;
      return p.isCapable(capability);
    });
  }

  /**
   * Find a provider that has a specific model available.
   */
  async getProviderForModel(modelId: string): Promise<BaseProvider | undefined> {
    for (const provider of this._providers.values()) {
      if (this._disabledProviders.has(provider.id)) continue;
      const models = await provider.listModels().catch(() => []);
      if (models.some((m) => m.id === modelId)) return provider;
    }
    return undefined;
  }

  /**
   * Get all models across all healthy providers.
   */
  async getAllModels(): Promise<IModelInfo[]> {
    const modelSets = await Promise.allSettled(
      Array.from(this._providers.values())
        .filter((p) => !this._disabledProviders.has(p.id))
        .map((p) => p.listModels()),
    );

    const models: IModelInfo[] = [];
    for (const result of modelSets) {
      if (result.status === "fulfilled") models.push(...result.value);
    }
    return models;
  }

  // ─── Health ───

  getHealthStatus(): Record<string, IProviderHealth> {
    const status: Record<string, IProviderHealth> = {};
    for (const [id, provider] of this._providers) {
      status[id] = {
        ...provider.health,
        status: this._disabledProviders.has(id) ? ProviderStatus.UNAVAILABLE : provider.health.status,
      };
    }
    return status;
  }

  getHealthySummary(): {
    total: number;
    healthy: number;
    degraded: number;
    unavailable: number;
    disabled: number;
  } {
    let healthy = 0;
    let degraded = 0;
    let unavailable = 0;
    const disabled = this._disabledProviders.size;

    for (const [id, provider] of this._providers) {
      if (this._disabledProviders.has(id)) continue;
      switch (provider.health.status) {
        case ProviderStatus.HEALTHY:
          healthy++;
          break;
        case ProviderStatus.DEGRADED:
        case ProviderStatus.RATE_LIMITED:
          degraded++;
          break;
        default:
          unavailable++;
      }
    }

    return { total: this._providers.size, healthy, degraded, unavailable, disabled };
  }

  async runHealthChecks(): Promise<Record<string, IProviderHealth>> {
    const results: Record<string, IProviderHealth> = {};
    const checks = Array.from(this._providers.entries()).map(async ([id, provider]) => {
      try {
        const health = await Promise.race([
          provider.checkHealth(),
          this.timeout(this._config.healthCheckTimeoutMs, id),
        ]);
        results[id] = health;
      } catch (err) {
        results[id] = {
          ...provider.health,
          status: ProviderStatus.UNAVAILABLE,
          lastError: err instanceof Error ? err.message : "Health check timeout",
          lastCheckedAt: new Date(),
        };
      }
    });

    await Promise.allSettled(checks);
    return results;
  }

  // ─── Health Monitoring ───

  private startHealthMonitoring(): void {
    if (this._healthCheckTimer) return;
    this._healthCheckTimer = setInterval(async () => {
      try {
        const results = await this.runHealthChecks();
        this.emit("health_check_complete", results);
      } catch (err) {
        console.error("[ProviderRegistry] Health check cycle failed:", err);
      }
    }, this._config.healthCheckIntervalMs);

    // Don't block process exit
    if (this._healthCheckTimer.unref) {
      this._healthCheckTimer.unref();
    }
  }

  stopHealthMonitoring(): void {
    if (this._healthCheckTimer) {
      clearInterval(this._healthCheckTimer);
      this._healthCheckTimer = undefined;
    }
  }

  // ─── Helpers ───

  private timeout(ms: number, providerId: string): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Health check timed out for '${providerId}' after ${ms}ms`)),
        ms,
      ),
    );
  }

  private emitEvent(
    type: IProviderEvent["type"],
    providerId: string,
    data?: unknown,
  ): void {
    const event: IProviderEvent = {
      type,
      providerId,
      timestamp: new Date(),
      data,
    };
    this.emit("provider_event", event);
  }
}

// Convenience export for the singleton instance
export const providerRegistry = ProviderRegistry.getInstance();
