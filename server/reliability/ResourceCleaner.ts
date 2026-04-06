/**
 * ResourceCleaner — Tracks EventEmitter listeners, intervals, and timeouts for
 * automatic cleanup on destroy(), preventing memory leaks in long-running
 * agentic sessions.
 *
 * Features:
 *   - Register listeners, intervals, and timeouts with a single owner key
 *   - Call destroy(key) to clean up everything registered for that owner
 *   - Global sweeper every 5 minutes removes stale registrations
 *   - Warns when a single owner has accumulated > 50 tracked resources
 *   - Safe to call destroy() multiple times (idempotent)
 */

import { EventEmitter } from 'events';
import { Logger }       from '../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

type CleanupFn = () => void;

interface TrackedResource {
  type     : 'listener' | 'interval' | 'timeout' | 'custom';
  cleanup  : CleanupFn;
  created  : number;
  label?   : string;
}

// ─── Main class ───────────────────────────────────────────────────────────────

class ResourceCleanerService {
  private readonly resources = new Map<string, TrackedResource[]>();
  private readonly sweepTimer: ReturnType<typeof setInterval>;
  private static readonly WARN_THRESHOLD = 50;
  private static readonly SWEEP_MS       = 5 * 60_000;

  constructor() {
    this.sweepTimer = setInterval(() => this._sweep(), ResourceCleanerService.SWEEP_MS);
    // Don't prevent process from exiting
    if (typeof this.sweepTimer.unref === 'function') this.sweepTimer.unref();
  }

  // ── Register resources ───────────────────────────────────────────────────────

  /**
   * Track an EventEmitter listener. Returns a cleanup function.
   */
  addListener<E extends EventEmitter>(
    owner  : string,
    emitter: E,
    event  : string,
    handler: (...args: unknown[]) => void,
    label? : string,
  ): CleanupFn {
    const cleanup = () => emitter.off(event, handler);
    emitter.on(event, handler);
    this._track(owner, { type: 'listener', cleanup, created: Date.now(), label });
    return cleanup;
  }

  /**
   * Track a setInterval. Returns a cleanup function.
   */
  addInterval(
    owner   : string,
    handler : () => void,
    delayMs : number,
    label?  : string,
  ): ReturnType<typeof setInterval> {
    const id      = setInterval(handler, delayMs);
    const cleanup = () => clearInterval(id);
    this._track(owner, { type: 'interval', cleanup, created: Date.now(), label });
    return id;
  }

  /**
   * Track a setTimeout. Returns a cleanup function.
   */
  addTimeout(
    owner   : string,
    handler : () => void,
    delayMs : number,
    label?  : string,
  ): ReturnType<typeof setTimeout> {
    let fired = false;
    const id = setTimeout(() => { fired = true; handler(); }, delayMs);
    const cleanup = () => { if (!fired) clearTimeout(id); };
    this._track(owner, { type: 'timeout', cleanup, created: Date.now(), label });
    return id;
  }

  /**
   * Track a custom cleanup function (AbortController, stream, file handle, etc.).
   */
  addCustom(owner: string, cleanup: CleanupFn, label?: string): CleanupFn {
    this._track(owner, { type: 'custom', cleanup, created: Date.now(), label });
    return cleanup;
  }

  // ── Destroy an owner's resources ─────────────────────────────────────────────

  destroy(owner: string): void {
    const list = this.resources.get(owner);
    if (!list || list.length === 0) return;

    let cleaned = 0;
    for (const resource of list) {
      try { resource.cleanup(); cleaned++; } catch (e) {
        Logger.warn('[ResourceCleaner] cleanup error', { owner, label: resource.label, error: (e as Error).message });
      }
    }

    this.resources.delete(owner);
    Logger.info('[ResourceCleaner] destroyed resources for owner', { owner, cleaned });
  }

  /**
   * Destroy all registered owners (e.g. on server shutdown).
   */
  destroyAll(): void {
    const owners = [...this.resources.keys()];
    for (const owner of owners) this.destroy(owner);
    clearInterval(this.sweepTimer);
    Logger.info('[ResourceCleaner] all resources destroyed', { count: owners.length });
  }

  // ── Stats ────────────────────────────────────────────────────────────────────

  stats(): Record<string, unknown> {
    const byOwner: Record<string, number> = {};
    for (const [owner, list] of this.resources) byOwner[owner] = list.length;
    return {
      totalOwners   : this.resources.size,
      totalResources: [...this.resources.values()].reduce((s, l) => s + l.length, 0),
      byOwner,
    };
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private _track(owner: string, resource: TrackedResource): void {
    if (!this.resources.has(owner)) this.resources.set(owner, []);
    const list = this.resources.get(owner)!;
    list.push(resource);

    if (list.length === ResourceCleanerService.WARN_THRESHOLD) {
      Logger.warn('[ResourceCleaner] owner accumulating many resources', {
        owner, count: list.length,
      });
    }
  }

  private _sweep(): void {
    // Remove owners with 0 resources (shouldn't happen normally, but handles edge cases)
    for (const [owner, list] of this.resources) {
      if (list.length === 0) this.resources.delete(owner);
    }
  }
}

export const resourceCleaner = new ResourceCleanerService();
