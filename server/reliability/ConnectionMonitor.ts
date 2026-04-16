/**
 * ConnectionMonitor — Periodic health monitoring for DB and Redis with auto-reconnect.
 *
 * Features:
 *   - Polls each registered connection every 30 seconds
 *   - Marks connections as healthy/unhealthy and emits events on state change
 *   - Calls the registered reconnect function when a connection goes unhealthy
 *   - Supports registering arbitrary connection probes (not just DB/Redis)
 *   - Exposes a summary health report for use in health check endpoints
 */

import { EventEmitter } from 'events';
import { Logger }       from '../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConnectionConfig {
  name         : string;
  probe        : () => Promise<void>;      // throws if unhealthy
  reconnect?   : () => Promise<void>;      // called when probe fails
  timeoutMs?   : number;                   // per-probe timeout (default 5 s)
  critical?    : boolean;                  // affects overall health status
}

export interface ConnectionStatus {
  name       : string;
  healthy    : boolean;
  lastCheck  : number;
  lastError? : string;
  uptime     : number;       // ms since last healthy state
  checkCount : number;
  failCount  : number;
}

// ─── Main class ───────────────────────────────────────────────────────────────

export class ConnectionMonitor extends EventEmitter {
  private readonly connections = new Map<string, ConnectionConfig>();
  private readonly statuses    = new Map<string, ConnectionStatus>();
  private monitorTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  // ── Register / deregister ────────────────────────────────────────────────────

  register(config: ConnectionConfig): void {
    this.connections.set(config.name, config);
    this.statuses.set(config.name, {
      name      : config.name,
      healthy   : true,      // optimistic until first check
      lastCheck : 0,
      uptime    : Date.now(),
      checkCount: 0,
      failCount : 0,
    });
    Logger.info('[ConnectionMonitor] registered connection', { name: config.name });
  }

  deregister(name: string): void {
    this.connections.delete(name);
    this.statuses.delete(name);
  }

  // ── Start / stop ─────────────────────────────────────────────────────────────

  start(intervalMs = 30_000): void {
    if (this.running) return;
    this.running     = true;
    this.monitorTimer = setInterval(() => this._checkAll(), intervalMs);
    if (typeof this.monitorTimer.unref === 'function') this.monitorTimer.unref();
    Logger.info('[ConnectionMonitor] started', { intervalMs, connections: this.connections.size });
    // Run an initial check immediately
    void this._checkAll();
  }

  stop(): void {
    if (this.monitorTimer) { clearInterval(this.monitorTimer); this.monitorTimer = null; }
    this.running = false;
  }

  // ── Health report ─────────────────────────────────────────────────────────────

  status(): ConnectionStatus[] {
    return [...this.statuses.values()];
  }

  isHealthy(name?: string): boolean {
    if (name) return this.statuses.get(name)?.healthy ?? false;
    // All critical connections must be healthy
    for (const [n, cfg] of this.connections) {
      if (cfg.critical && !this.statuses.get(n)?.healthy) return false;
    }
    return true;
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private async _checkAll(): Promise<void> {
    await Promise.allSettled([...this.connections.values()].map(cfg => this._check(cfg)));
  }

  private async _check(cfg: ConnectionConfig): Promise<void> {
    const status = this.statuses.get(cfg.name)!;
    const timeout = cfg.timeoutMs ?? 5_000;

    let healthy = false;
    let lastError: string | undefined;

    try {
      await Promise.race([
        cfg.probe(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`probe timeout (${timeout}ms)`)), timeout)),
      ]);
      healthy = true;
    } catch (err) {
      lastError = (err as Error).message;
    }

    const wasHealthy = status.healthy;
    status.healthy    = healthy;
    status.lastCheck  = Date.now();
    status.checkCount++;
    if (!healthy) {
      status.failCount++;
      status.lastError = lastError;
    }
    if (healthy && !wasHealthy) {
      status.uptime = Date.now();
    }

    // Emit state-change events
    if (healthy && !wasHealthy) {
      Logger.info('[ConnectionMonitor] connection recovered', { name: cfg.name });
      this.emit('recovered', cfg.name);
    } else if (!healthy && wasHealthy) {
      Logger.error('[ConnectionMonitor] connection unhealthy', { name: cfg.name, error: lastError });
      this.emit('unhealthy', cfg.name, lastError);

      // Attempt reconnect
      if (cfg.reconnect) {
        try { await cfg.reconnect(); } catch (e) {
          Logger.warn('[ConnectionMonitor] reconnect failed', { name: cfg.name, error: (e as Error).message });
        }
      }
    } else if (!healthy) {
      Logger.warn('[ConnectionMonitor] connection still unhealthy', { name: cfg.name, failCount: status.failCount });
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const connectionMonitor = new ConnectionMonitor();
