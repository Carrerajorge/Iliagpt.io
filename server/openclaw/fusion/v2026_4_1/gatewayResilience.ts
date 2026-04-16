import { Logger } from '../../../lib/logger';

export interface FacadeHealth {
  name: string;
  healthy: boolean;
  lastError?: string;
  lastErrorAt?: number;
  consecutiveFailures: number;
  totalRequests: number;
  totalFailures: number;
}

class GatewayResilienceManager {
  private facades: Map<string, FacadeHealth> = new Map();
  private maxConsecutiveFailures = 3;
  private recoveryCheckIntervalMs = 30_000;
  private recoveryTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.recoveryTimer = setInterval(() => this.checkRecovery(), this.recoveryCheckIntervalMs);
  }

  registerFacade(name: string): void {
    if (!this.facades.has(name)) {
      this.facades.set(name, {
        name,
        healthy: true,
        consecutiveFailures: 0,
        totalRequests: 0,
        totalFailures: 0,
      });
    }
  }

  isFacadeHealthy(name: string): boolean {
    const facade = this.facades.get(name);
    return facade ? facade.healthy : true;
  }

  recordSuccess(name: string): void {
    const facade = this.facades.get(name);
    if (!facade) return;

    facade.totalRequests++;
    facade.consecutiveFailures = 0;
    if (!facade.healthy) {
      facade.healthy = true;
      Logger.info(`[GatewayResilience] Facade "${name}" recovered`);
    }
  }

  recordFailure(name: string, error: string): void {
    const facade = this.facades.get(name);
    if (!facade) return;

    facade.totalRequests++;
    facade.totalFailures++;
    facade.consecutiveFailures++;
    facade.lastError = error;
    facade.lastErrorAt = Date.now();

    if (facade.consecutiveFailures >= this.maxConsecutiveFailures && facade.healthy) {
      facade.healthy = false;
      Logger.warn(`[GatewayResilience] Facade "${name}" marked unhealthy after ${facade.consecutiveFailures} consecutive failures: ${error}`);
    }
  }

  async executeWithResilience<T>(
    facadeName: string,
    fn: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T | null> {
    if (!this.isFacadeHealthy(facadeName)) {
      Logger.warn(`[GatewayResilience] Skipping unhealthy facade "${facadeName}"`);
      if (fallback) return fallback();
      return null;
    }

    try {
      const result = await fn();
      this.recordSuccess(facadeName);
      return result;
    } catch (error: any) {
      this.recordFailure(facadeName, error.message || String(error));
      if (fallback) {
        try {
          return await fallback();
        } catch (fallbackError: any) {
          Logger.error(`[GatewayResilience] Fallback for "${facadeName}" also failed: ${fallbackError.message}`);
        }
      }
      return null;
    }
  }

  private checkRecovery(): void {
    const now = Date.now();
    for (const facade of this.facades.values()) {
      if (!facade.healthy && facade.lastErrorAt && (now - facade.lastErrorAt > 60_000)) {
        facade.healthy = true;
        facade.consecutiveFailures = 0;
        Logger.info(`[GatewayResilience] Facade "${facade.name}" auto-recovered after cooldown`);
      }
    }
  }

  getHealthReport(): FacadeHealth[] {
    return Array.from(this.facades.values());
  }

  destroy(): void {
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }
}

let instance: GatewayResilienceManager | null = null;

export function getGatewayResilience(): GatewayResilienceManager {
  if (!instance) {
    instance = new GatewayResilienceManager();
  }
  return instance;
}

export function initGatewayResilience(): void {
  const mgr = getGatewayResilience();
  mgr.registerFacade('http-api');
  mgr.registerFacade('websocket');
  mgr.registerFacade('streaming');
  mgr.registerFacade('auth');
  Logger.info('[OpenClaw:GatewayResilience] HTTP resilience initialized (failing facades skipped instead of returning 500)');
}
