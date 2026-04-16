/**
 * RetryWithJitter — Exponential backoff with full jitter for resilient retries.
 *
 * Features:
 *   - Full jitter (random between 0 and cap) prevents thundering herd
 *   - Configurable base, multiplier, max delay, and max attempts
 *   - Optional `shouldRetry` predicate to filter which errors warrant retry
 *   - Emits attempt events for observability
 *   - Respects AbortSignal — stops retrying if signal is aborted
 */

import { Logger } from '../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RetryOptions {
  maxAttempts  ?: number;                          // default 3
  baseDelayMs  ?: number;                          // default 500 ms
  maxDelayMs   ?: number;                          // default 30 000 ms
  multiplier   ?: number;                          // default 2
  jitter       ?: boolean;                         // default true (full jitter)
  shouldRetry  ?: (err: unknown, attempt: number) => boolean;
  onRetry      ?: (err: unknown, attempt: number, delayMs: number) => void;
  signal       ?: AbortSignal;
  label        ?: string;
}

export interface RetryResult<T> {
  value     : T;
  attempts  : number;
}

// ─── Core retry function ──────────────────────────────────────────────────────

export async function retryWithJitter<T>(
  fn  : () => Promise<T>,
  opts: RetryOptions = {},
): Promise<RetryResult<T>> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs  = opts.maxDelayMs  ?? 30_000;
  const multiplier  = opts.multiplier  ?? 2;
  const useJitter   = opts.jitter      ?? true;
  const label       = opts.label       ?? 'operation';

  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.signal?.aborted) {
      throw new Error(`Retry aborted after attempt ${attempt - 1} (signal aborted)`);
    }

    try {
      const value = await fn();
      if (attempt > 1) {
        Logger.info('[RetryWithJitter] succeeded after retry', { label, attempt });
      }
      return { value, attempts: attempt };
    } catch (err) {
      lastErr = err;

      const shouldRetry = opts.shouldRetry ? opts.shouldRetry(err, attempt) : true;
      if (!shouldRetry || attempt === maxAttempts) break;

      // Exponential backoff with optional full jitter
      const expDelay = Math.min(baseDelayMs * Math.pow(multiplier, attempt - 1), maxDelayMs);
      const delayMs  = useJitter ? Math.random() * expDelay : expDelay;

      opts.onRetry?.(err, attempt, delayMs);
      Logger.warn('[RetryWithJitter] retrying after error', {
        label,
        attempt,
        maxAttempts,
        delayMs : Math.round(delayMs),
        error   : (err as Error).message,
      });

      await sleep(delayMs, opts.signal);
    }
  }

  throw lastErr;
}

// ─── Default predicate for LLM/network retries ───────────────────────────────

export function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('rate_limit') ||
    msg.includes('overloaded')  ||
    msg.includes('timeout')     ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset')   ||
    msg.includes('503')          ||
    msg.includes('529')
  );
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

/** Retry an LLM call with sensible defaults for provider rate limits. */
export function retryLLM<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<RetryResult<T>> {
  return retryWithJitter(fn, {
    maxAttempts: 3,
    baseDelayMs: 2_000,
    maxDelayMs : 8_000,
    shouldRetry: isRetryableError,
    signal,
    label      : 'llm_call',
  });
}

/** Retry a DB or Redis operation with fast backoff. */
export function retryDB<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<RetryResult<T>> {
  return retryWithJitter(fn, {
    maxAttempts: 5,
    baseDelayMs: 100,
    maxDelayMs : 5_000,
    signal,
    label      : 'db_call',
  });
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(id); reject(new Error('Aborted')); }, { once: true });
  });
}
