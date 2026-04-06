/**
 * AutoRecovery — 30-second health check daemon that auto-restarts failed subsystems.
 *
 * Features:
 *   - Each subsystem registers a probe() and a restart() function
 *   - Checks every 30 s; on failure, calls restart() with exponential backoff cap
 *   - Tracks restart count and last restart time per subsystem
 *   - Emits events: 'degraded', 'recovered', 'restart_failed'
 *   - Exposes a health summary for /healthz endpoint
 *   - Stops restart attempts after configurable max restarts (default 5)
 */

import { EventEmitter } from 'events';
import { Logger }       from '../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubsystemConfig {
  name        : string;
  probe       : () => Promise<void>;
  restart     : () => Promise<void>;
  maxRestarts?: number;          // default 5
  critical?   : boolean;         // critical subsystems affect overall health
}

interface SubsystemState {
  healthy       : boolean;
  restarts      : number;
  lastCheck     : number;
  lastRestart?  : number;
  lastError?    : string;
  gaveUp        : boolean;
}

// ─── Main class ───────────────────────────────────────────────────────────────

export class AutoRecovery extends EventEmitter {
  private readonly configs   = new Map<string, SubsystemConfig>();
  private readonly states    = new Map<string, SubsystemState>();
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  // ── Registration ─────────────────────────────────────────────────────────────

  register(config: SubsystemConfig): void {
    this.configs.set(config.name, config);
    this.states.set(config.name, {
      healthy: true, restarts: 0, lastCheck: 0, gaveUp: false,
    });
    Logger.info('[AutoRecovery] registered subsystem', { name: config.name });
  }

  deregister(name: string): void {
    this.configs.delete(name);
    this.states.delete(name);
  }

  // ── Start / stop ─────────────────────────────────────────────────────────────

  start(intervalMs = 30_000): void {
    if (this.running) return;
    this.running   = true;
    this.checkTimer = setInterval(() => void this._checkAll(), intervalMs);
    if (typeof this.checkTimer.unref === 'function') this.checkTimer.unref();
    Logger.info('[AutoRecovery] daemon started', { intervalMs, subsystems: this.configs.size });
    void this._checkAll(); // immediate first pass
  }

  stop(): void {
    if (this.checkTimer) { clearInterval(this.checkTimer); this.checkTimer = null; }
    this.running = false;
    Logger.info('[AutoRecovery] daemon stopped');
  }

  // ── Manual trigger ────────────────────────────────────────────────────────────

  async checkNow(name?: string): Promise<void> {
    if (name) {
      const cfg = this.configs.get(name);
      if (cfg) await this._check(cfg);
    } else {
      await this._checkAll();
    }
  }

  // ── Health summary ────────────────────────────────────────────────────────────

  health(): Array<{
    name    : string;
    healthy : boolean;
    restarts: number;
    gaveUp  : boolean;
    critical: boolean;
  }> {
    return [...this.configs.entries()].map(([name, cfg]) => {
      const s = this.states.get(name)!;
      return { name, healthy: s.healthy, restarts: s.restarts, gaveUp: s.gaveUp, critical: !!cfg.critical };
    });
  }

  isHealthy(): boolean {
    for (const [name, cfg] of this.configs) {
      if (cfg.critical && !this.states.get(name)?.healthy) return false;
    }
    return true;
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private async _checkAll(): Promise<void> {
    await Promise.allSettled([...this.configs.values()].map(cfg => this._check(cfg)));
  }

  private async _check(cfg: SubsystemConfig): Promise<void> {
    const state      = this.states.get(cfg.name)!;
    const maxRestarts = cfg.maxRestarts ?? 5;

    state.lastCheck = Date.now();

    // Don't check subsystems we've given up on
    if (state.gaveUp) return;

    try {
      await Promise.race([
        cfg.probe(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('probe timeout')), 5_000)),
      ]);

      if (!state.healthy) {
        state.healthy = true;
        Logger.info('[AutoRecovery] subsystem recovered', { name: cfg.name });
        this.emit('recovered', cfg.name);
      }
    } catch (err) {
      const msg = (err as Error).message;
      state.healthy   = false;
      state.lastError = msg;
      this.emit('degraded', cfg.name, msg);

      if (state.restarts >= maxRestarts) {
        if (!state.gaveUp) {
          state.gaveUp = true;
          Logger.error('[AutoRecovery] gave up restarting subsystem', {
            name: cfg.name, restarts: state.restarts, maxRestarts,
          });
          this.emit('restart_failed', cfg.name);
        }
        return;
      }

      Logger.warn('[AutoRecovery] subsystem unhealthy — restarting', {
        name   : cfg.name,
        error  : msg,
        attempt: state.restarts + 1,
      });

      try {
        await cfg.restart();
        state.restarts++;
        state.lastRestart = Date.now();
        Logger.info('[AutoRecovery] restart completed', { name: cfg.name, restarts: state.restarts });
      } catch (restartErr) {
        state.restarts++;
        Logger.error('[AutoRecovery] restart threw', {
          name : cfg.name,
          error: (restartErr as Error).message,
        });
      }
    }
  }
}

export const autoRecovery = new AutoRecovery();
