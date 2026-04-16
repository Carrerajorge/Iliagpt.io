/**
 * ConcurrencySemaphore — Token-based concurrency limiter with a FIFO queue.
 *
 * Features:
 *   - Hard cap on simultaneous executions (default 5 for tool calls)
 *   - Queues excess work and drains automatically as slots free up
 *   - Optional per-task timeout that returns the slot if the task hangs
 *   - Emits events for queue depth monitoring
 *   - `wrap()` helper for decorating any async function
 */

import { EventEmitter } from 'events';
import { Logger }       from '../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueueEntry<T> {
  fn      : () => Promise<T>;
  resolve : (value: T | PromiseLike<T>) => void;
  reject  : (reason: unknown) => void;
  enqueued: number;
  label   : string;
}

export interface SemaphoreStats {
  running   : number;
  queued    : number;
  capacity  : number;
  completed : number;
  rejected  : number;
}

// ─── Main class ───────────────────────────────────────────────────────────────

export class ConcurrencySemaphore extends EventEmitter {
  private running   = 0;
  private completed = 0;
  private rejected  = 0;
  private readonly queue: QueueEntry<unknown>[] = [];

  constructor(
    private readonly capacity   : number = 5,
    private readonly taskTimeout: number = 120_000,   // 2 min per task
    private readonly maxQueue   : number = 100,
  ) {
    super();
  }

  // ── Run a function under the semaphore ──────────────────────────────────────

  run<T>(fn: () => Promise<T>, label = 'task'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.queue.length >= this.maxQueue) {
        this.rejected++;
        Logger.warn('[Semaphore] queue full — rejecting task', { label, maxQueue: this.maxQueue });
        reject(new Error(`Semaphore queue full (max ${this.maxQueue})`));
        return;
      }

      const entry: QueueEntry<T> = { fn, resolve, reject, enqueued: Date.now(), label };
      this.queue.push(entry as QueueEntry<unknown>);
      this.emit('queued', { label, depth: this.queue.length });
      this._drain();
    });
  }

  // ── Wrap an async function to always run through this semaphore ─────────────

  wrap<A extends unknown[], R>(fn: (...args: A) => Promise<R>, label?: string): (...args: A) => Promise<R> {
    return (...args: A) => this.run(() => fn(...args), label ?? fn.name ?? 'wrapped');
  }

  // ── Stats ────────────────────────────────────────────────────────────────────

  stats(): SemaphoreStats {
    return {
      running  : this.running,
      queued   : this.queue.length,
      capacity : this.capacity,
      completed: this.completed,
      rejected : this.rejected,
    };
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private _drain(): void {
    while (this.running < this.capacity && this.queue.length > 0) {
      const entry = this.queue.shift()!;
      this.running++;

      const waitMs = Date.now() - entry.enqueued;
      if (waitMs > 5_000) {
        Logger.warn('[Semaphore] task waited long in queue', { label: entry.label, waitMs });
      }

      this.emit('start', { label: entry.label, running: this.running });

      const timeoutId = setTimeout(() => {
        Logger.error('[Semaphore] task timeout', { label: entry.label, timeoutMs: this.taskTimeout });
        entry.reject(new Error(`Task '${entry.label}' timed out after ${this.taskTimeout}ms`));
        this._release(entry.label);
      }, this.taskTimeout);

      entry.fn()
        .then(result => {
          clearTimeout(timeoutId);
          entry.resolve(result);
          this._release(entry.label);
        })
        .catch(err => {
          clearTimeout(timeoutId);
          entry.reject(err);
          this._release(entry.label);
        });
    }
  }

  private _release(label: string): void {
    this.running  = Math.max(0, this.running - 1);
    this.completed++;
    this.emit('done', { label, running: this.running, queued: this.queue.length });
    this._drain();
  }
}

// ─── Singleton for global tool execution ─────────────────────────────────────

/** Shared semaphore limiting concurrent tool executions to 5 */
export const toolSemaphore = new ConcurrencySemaphore(5, 120_000, 100);
