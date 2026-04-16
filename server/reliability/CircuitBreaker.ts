/**
 * CircuitBreaker — Per-provider circuit breaker: 3 failures → open, half-open recovery.
 *
 * States:
 *   CLOSED   — normal operation; failures accumulate
 *   OPEN     — requests fail immediately without calling the provider
 *   HALF_OPEN — one test request allowed through; success → CLOSED, failure → OPEN
 *
 * Features:
 *   - Configurable failure threshold and reset timeout per circuit
 *   - Named circuits (one per LLM provider, one per external service)
 *   - EventEmitter for state-change observability
 *   - `execute()` wraps any async function under the breaker
 *   - `forceOpen()` / `forceClose()` for manual ops intervention
 */

import { EventEmitter } from 'events';
import { Logger }       from '../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold?: number;    // failures before opening (default 3)
  successThreshold?: number;    // successes in HALF_OPEN before closing (default 1)
  resetTimeoutMs  ?: number;    // ms before transitioning OPEN → HALF_OPEN (default 60 s)
  halfOpenRequests?: number;    // max concurrent requests in HALF_OPEN (default 1)
}

export interface CircuitStats {
  name          : string;
  state         : CircuitState;
  failures      : number;
  successes     : number;
  totalCalls    : number;
  lastFailureAt?: number;
  openedAt?     : number;
}

// ─── Single circuit ───────────────────────────────────────────────────────────

class Circuit extends EventEmitter {
  private state          : CircuitState = 'CLOSED';
  private failures       = 0;
  private successes      = 0;
  private totalCalls     = 0;
  private lastFailureAt? : number;
  private openedAt?      : number;
  private halfOpenActive = 0;

  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly resetTimeoutMs  : number;
  private readonly halfOpenRequests: number;

  constructor(public readonly name: string, opts: CircuitBreakerOptions = {}) {
    super();
    this.failureThreshold = opts.failureThreshold ?? 3;
    this.successThreshold = opts.successThreshold ?? 1;
    this.resetTimeoutMs   = opts.resetTimeoutMs   ?? 60_000;
    this.halfOpenRequests = opts.halfOpenRequests  ?? 1;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalCalls++;
    this._maybeTransitionToHalfOpen();

    if (this.state === 'OPEN') {
      throw new CircuitOpenError(this.name, this.openedAt, this.resetTimeoutMs);
    }

    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenActive >= this.halfOpenRequests) {
        throw new CircuitOpenError(this.name, this.openedAt, this.resetTimeoutMs);
      }
      this.halfOpenActive++;
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure(err);
      throw err;
    }
  }

  forceOpen(): void  { this._open(); }
  forceClose(): void { this._close(); }

  stats(): CircuitStats {
    return {
      name         : this.name,
      state        : this.state,
      failures     : this.failures,
      successes    : this.successes,
      totalCalls   : this.totalCalls,
      lastFailureAt: this.lastFailureAt,
      openedAt     : this.openedAt,
    };
  }

  private _onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.halfOpenActive = Math.max(0, this.halfOpenActive - 1);
      this.successes++;
      if (this.successes >= this.successThreshold) this._close();
    } else {
      this.failures = 0; // reset failure count on success in CLOSED state
    }
  }

  private _onFailure(err: unknown): void {
    this.lastFailureAt = Date.now();
    this.failures++;

    if (this.state === 'HALF_OPEN') {
      this.halfOpenActive = Math.max(0, this.halfOpenActive - 1);
      this._open();
      return;
    }

    if (this.failures >= this.failureThreshold) {
      this._open();
    }

    Logger.warn('[CircuitBreaker] failure recorded', {
      name    : this.name,
      failures: this.failures,
      threshold: this.failureThreshold,
      error   : (err as Error).message,
    });
  }

  private _open(): void {
    if (this.state === 'OPEN') return;
    this.state     = 'OPEN';
    this.openedAt  = Date.now();
    this.successes = 0;
    Logger.error('[CircuitBreaker] circuit OPENED', { name: this.name, failures: this.failures });
    this.emit('open', this.name);
  }

  private _close(): void {
    const prev     = this.state;
    this.state     = 'CLOSED';
    this.failures  = 0;
    this.successes = 0;
    this.halfOpenActive = 0;
    Logger.info('[CircuitBreaker] circuit CLOSED', { name: this.name, from: prev });
    this.emit('close', this.name);
  }

  private _maybeTransitionToHalfOpen(): void {
    if (this.state === 'OPEN' && this.openedAt && Date.now() - this.openedAt >= this.resetTimeoutMs) {
      this.state = 'HALF_OPEN';
      Logger.info('[CircuitBreaker] circuit HALF_OPEN — testing', { name: this.name });
      this.emit('half_open', this.name);
    }
  }
}

// ─── Error type ───────────────────────────────────────────────────────────────

export class CircuitOpenError extends Error {
  constructor(name: string, openedAt?: number, resetMs?: number) {
    const retryIn = openedAt && resetMs ? Math.max(0, resetMs - (Date.now() - openedAt)) : resetMs;
    super(`Circuit '${name}' is OPEN. Retry in ~${Math.ceil((retryIn ?? 60000) / 1000)}s`);
    this.name = 'CircuitOpenError';
  }
}

// ─── Registry ─────────────────────────────────────────────────────────────────

class CircuitBreakerRegistry extends EventEmitter {
  private readonly circuits = new Map<string, Circuit>();

  get(name: string, opts?: CircuitBreakerOptions): Circuit {
    if (!this.circuits.has(name)) {
      const c = new Circuit(name, opts);
      c.on('open',      n => this.emit('open', n));
      c.on('close',     n => this.emit('close', n));
      c.on('half_open', n => this.emit('half_open', n));
      this.circuits.set(name, c);
    }
    return this.circuits.get(name)!;
  }

  execute<T>(name: string, fn: () => Promise<T>, opts?: CircuitBreakerOptions): Promise<T> {
    return this.get(name, opts).execute(fn);
  }

  stats(): CircuitStats[] {
    return [...this.circuits.values()].map(c => c.stats());
  }

  forceOpen(name: string): void  { this.circuits.get(name)?.forceOpen(); }
  forceClose(name: string): void { this.circuits.get(name)?.forceClose(); }
}

export const circuitBreaker = new CircuitBreakerRegistry();
