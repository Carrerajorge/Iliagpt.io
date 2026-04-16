/**
 * Capability: Availability
 * Tests provider health checks, circuit breakers, fallback chains, and latency tracking.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, TEST_PROVIDERS, type ProviderConfig } from './_setup/providerMatrix';
import { createLLMClientMock, sleep } from './_setup/testHelpers';

vi.mock('../../server/db', () => ({ db: {} }));

type ProviderHealth = 'healthy' | 'degraded' | 'unavailable';

interface ProviderStatus {
  name: string;
  health: ProviderHealth;
  latencyP50: number;
  latencyP95: number;
  errorRate: number;
  consecutiveFailures: number;
  circuitOpen: boolean;
  lastChecked: Date;
}

interface FallbackResult {
  usedProvider: string;
  attemptCount: number;
  totalLatency_ms: number;
  successful: boolean;
}

class AvailabilityMonitor {
  private statuses = new Map<string, ProviderStatus>();
  private readonly failureThreshold = 3;
  private readonly recoveryTimeMs = 5 * 60 * 1000; // 5 min
  private circuitOpenTimes = new Map<string, number>();

  initialize(providers: ProviderConfig[]): void {
    for (const p of providers) {
      this.statuses.set(p.name, {
        name: p.name,
        health: 'healthy',
        latencyP50: 300,
        latencyP95: 800,
        errorRate: 0,
        consecutiveFailures: 0,
        circuitOpen: false,
        lastChecked: new Date(),
      });
    }
  }

  recordSuccess(providerName: string, latency_ms: number): void {
    const status = this.statuses.get(providerName);
    if (!status) return;
    status.consecutiveFailures = 0;
    status.circuitOpen = false;
    status.latencyP50 = Math.round(status.latencyP50 * 0.8 + latency_ms * 0.2);
    status.health = latency_ms > 2000 ? 'degraded' : 'healthy';
    status.lastChecked = new Date();
    this.statuses.set(providerName, status);
  }

  recordFailure(providerName: string): void {
    const status = this.statuses.get(providerName);
    if (!status) return;
    status.consecutiveFailures++;
    if (status.consecutiveFailures >= this.failureThreshold) {
      status.circuitOpen = true;
      status.health = 'unavailable';
      this.circuitOpenTimes.set(providerName, Date.now());
    }
    status.lastChecked = new Date();
    this.statuses.set(providerName, status);
  }

  isAvailable(providerName: string): boolean {
    const status = this.statuses.get(providerName);
    if (!status) return false;
    if (!status.circuitOpen) return true;

    // Check recovery time (half-open probe)
    const openTime = this.circuitOpenTimes.get(providerName) ?? 0;
    if (Date.now() - openTime > this.recoveryTimeMs) {
      // Allow one probe
      return true;
    }
    return false;
  }

  getStatus(providerName: string): ProviderStatus | undefined {
    return this.statuses.get(providerName);
  }

  getHealthyProviders(): string[] {
    return Array.from(this.statuses.values())
      .filter((s) => s.health !== 'unavailable' && !s.circuitOpen)
      .map((s) => s.name);
  }

  async tryWithFallback(
    providers: string[],
    operation: (providerName: string) => Promise<string>,
  ): Promise<FallbackResult> {
    const start = Date.now();
    for (let i = 0; i < providers.length; i++) {
      const providerName = providers[i];
      if (!this.isAvailable(providerName)) continue;

      try {
        const result = await operation(providerName);
        this.recordSuccess(providerName, Date.now() - start);
        return {
          usedProvider: providerName,
          attemptCount: i + 1,
          totalLatency_ms: Date.now() - start,
          successful: true,
        };
      } catch {
        this.recordFailure(providerName);
      }
    }
    return { usedProvider: 'none', attemptCount: providers.length, totalLatency_ms: Date.now() - start, successful: false };
  }
}

runWithEachProvider('Availability', (provider: ProviderConfig) => {
  let monitor: AvailabilityMonitor;

  mockProviderEnv(provider);

  beforeEach(() => {
    monitor = new AvailabilityMonitor();
    monitor.initialize(TEST_PROVIDERS);
  });

  it('initializes all providers as healthy', () => {
    for (const p of TEST_PROVIDERS) {
      expect(monitor.getStatus(p.name)?.health).toBe('healthy');
    }
  });

  it('marks provider as available initially', () => {
    expect(monitor.isAvailable(provider.name)).toBe(true);
  });

  it('records success and updates latency', () => {
    monitor.recordSuccess(provider.name, 250);
    const status = monitor.getStatus(provider.name);
    expect(status?.consecutiveFailures).toBe(0);
    expect(status?.circuitOpen).toBe(false);
  });

  it('opens circuit after 3 consecutive failures', () => {
    monitor.recordFailure(provider.name);
    monitor.recordFailure(provider.name);
    monitor.recordFailure(provider.name);
    const status = monitor.getStatus(provider.name);
    expect(status?.circuitOpen).toBe(true);
    expect(status?.health).toBe('unavailable');
  });

  it('blocks requests when circuit is open', () => {
    for (let i = 0; i < 3; i++) monitor.recordFailure(provider.name);
    // Circuit just opened, not yet in recovery window
    // Re-check: isAvailable returns true for half-open probe immediately after opening
    // (recovery window has passed since openTime ≈ now and Date.now() - openTime ~0 vs 5min)
    // So circuit will NOT be available (0 < 300000)
    expect(monitor.isAvailable(provider.name)).toBe(false);
  });

  it('resets failure counter on success', () => {
    monitor.recordFailure(provider.name);
    monitor.recordFailure(provider.name);
    monitor.recordSuccess(provider.name, 200);
    expect(monitor.getStatus(provider.name)?.consecutiveFailures).toBe(0);
  });

  it('marks degraded for high-latency provider', () => {
    monitor.recordSuccess(provider.name, 3000);
    expect(monitor.getStatus(provider.name)?.health).toBe('degraded');
  });

  it('lists healthy providers', () => {
    const healthy = monitor.getHealthyProviders();
    expect(healthy.length).toBe(TEST_PROVIDERS.length);
  });

  it('excludes unavailable providers from healthy list', () => {
    for (let i = 0; i < 3; i++) monitor.recordFailure(provider.name);
    const healthy = monitor.getHealthyProviders();
    expect(healthy).not.toContain(provider.name);
  });

  it('falls back to secondary provider when primary is down', async () => {
    const providers = TEST_PROVIDERS.map((p) => p.name);
    const primaryName = providers[0];

    // Take down the first provider
    for (let i = 0; i < 3; i++) monitor.recordFailure(primaryName);

    const result = await monitor.tryWithFallback(providers, async (name) => {
      if (name === primaryName) throw new Error('Primary down');
      return `success from ${name}`;
    });

    expect(result.successful).toBe(true);
    expect(result.usedProvider).not.toBe(primaryName);
    expect(result.attemptCount).toBeGreaterThan(1);
  });

  it('returns failed result when all providers are down', async () => {
    const providerNames = [provider.name];
    for (let i = 0; i < 3; i++) monitor.recordFailure(provider.name);

    const result = await monitor.tryWithFallback(providerNames, async () => {
      throw new Error('All down');
    });

    expect(result.successful).toBe(false);
  });

  it('measures total latency on fallback', async () => {
    const result = await monitor.tryWithFallback([provider.name], async () => 'ok');
    expect(result.totalLatency_ms).toBeGreaterThanOrEqual(0);
  });
});
