/**
 * ErrorHandler — Central categorized error handling with structured logging and deduplication.
 *
 * Features:
 *   - Classifies errors into categories (network, auth, validation, timeout, unknown)
 *   - Deduplicates repeated errors within a rolling window to prevent log flooding
 *   - Emits structured log entries with context, stack, and category
 *   - Tracks error frequency per category for monitoring
 *   - Provides Express error middleware integration
 */

import { EventEmitter }              from 'events';
import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { Logger }                    from '../lib/logger';

// ─── Error categories ─────────────────────────────────────────────────────────

export type ErrorCategory =
  | 'network'
  | 'timeout'
  | 'auth'
  | 'validation'
  | 'rate_limit'
  | 'not_found'
  | 'internal'
  | 'unknown';

export interface CategorizedError {
  category   : ErrorCategory;
  message    : string;
  code?      : string;
  statusCode : number;
  retryable  : boolean;
  context?   : Record<string, unknown>;
  stack?     : string;
  timestamp  : number;
  fingerprint: string;
}

// ─── Dedup window ─────────────────────────────────────────────────────────────

interface DedupEntry {
  count    : number;
  firstSeen: number;
  lastSeen : number;
}

const DEDUP_WINDOW_MS = 60_000; // suppress duplicate logs within 1 minute
const MAX_DEDUP_CACHE = 500;

// ─── Main class ───────────────────────────────────────────────────────────────

class ErrorHandlerService extends EventEmitter {
  private readonly dedupCache = new Map<string, DedupEntry>();
  private readonly counts     = new Map<ErrorCategory, number>();

  // ── Classification ──────────────────────────────────────────────────────────

  classify(err: unknown, context?: Record<string, unknown>): CategorizedError {
    const raw = err instanceof Error ? err : new Error(String(err));
    const msg = raw.message.toLowerCase();

    let category  : ErrorCategory = 'unknown';
    let statusCode = 500;
    let retryable  = false;
    let code       : string | undefined;

    // Inspect common error shapes
    const anyErr = err as Record<string, unknown>;
    if (typeof anyErr.status === 'number')     statusCode = anyErr.status as number;
    if (typeof anyErr.statusCode === 'number') statusCode = anyErr.statusCode as number;
    if (typeof anyErr.code === 'string')       code       = anyErr.code as string;

    if (msg.includes('timeout') || msg.includes('timed out') || code === 'ETIMEDOUT') {
      category  = 'timeout'; statusCode = statusCode === 500 ? 504 : statusCode; retryable = true;
    } else if (msg.includes('unauthorized') || msg.includes('forbidden') || statusCode === 401 || statusCode === 403) {
      category  = 'auth'; statusCode = statusCode === 500 ? 401 : statusCode;
    } else if (msg.includes('rate limit') || msg.includes('overloaded') || statusCode === 429) {
      category  = 'rate_limit'; statusCode = 429; retryable = true;
    } else if (msg.includes('not found') || statusCode === 404) {
      category  = 'not_found'; statusCode = 404;
    } else if (msg.includes('validation') || msg.includes('invalid') || statusCode === 400) {
      category  = 'validation'; statusCode = statusCode === 500 ? 400 : statusCode;
    } else if (msg.includes('econnrefused') || msg.includes('network') || msg.includes('enotfound') || code === 'ECONNREFUSED') {
      category  = 'network'; retryable = true;
    } else if (statusCode >= 500) {
      category  = 'internal';
    }

    const fingerprint = this._fingerprint(category, raw.message);

    return {
      category,
      message    : raw.message,
      code,
      statusCode,
      retryable,
      context,
      stack      : raw.stack,
      timestamp  : Date.now(),
      fingerprint,
    };
  }

  // ── Handle (log + dedup + emit) ─────────────────────────────────────────────

  handle(err: unknown, context?: Record<string, unknown>): CategorizedError {
    const categorized = this.classify(err, context);
    const now         = Date.now();

    // Frequency tracking
    this.counts.set(categorized.category, (this.counts.get(categorized.category) ?? 0) + 1);

    // Deduplication
    const existing = this.dedupCache.get(categorized.fingerprint);
    if (existing && now - existing.firstSeen < DEDUP_WINDOW_MS) {
      existing.count++;
      existing.lastSeen = now;
      if (existing.count === 5 || existing.count === 20 || existing.count % 100 === 0) {
        Logger.warn('[ErrorHandler] repeated error', {
          fingerprint: categorized.fingerprint,
          count      : existing.count,
          category   : categorized.category,
          message    : categorized.message,
        });
      }
      return categorized;
    }

    // Evict stale entries if cache is full
    if (this.dedupCache.size >= MAX_DEDUP_CACHE) {
      const oldest = [...this.dedupCache.entries()]
        .sort(([, a], [, b]) => a.lastSeen - b.lastSeen)
        .slice(0, 50);
      for (const [k] of oldest) this.dedupCache.delete(k);
    }

    this.dedupCache.set(categorized.fingerprint, { count: 1, firstSeen: now, lastSeen: now });

    const logFn = categorized.statusCode >= 500 ? Logger.error.bind(Logger) : Logger.warn.bind(Logger);
    logFn('[ErrorHandler] error', {
      category   : categorized.category,
      statusCode : categorized.statusCode,
      retryable  : categorized.retryable,
      message    : categorized.message,
      code       : categorized.code,
      context    : categorized.context,
    });

    this.emit('error_handled', categorized);
    return categorized;
  }

  // ── Express middleware ───────────────────────────────────────────────────────

  middleware(): ErrorRequestHandler {
    return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
      const categorized = this.handle(err, {
        method: req.method,
        path  : req.path,
        query : req.query as Record<string, unknown>,
      });

      if (res.headersSent) return;

      res.status(categorized.statusCode).json({
        error    : categorized.category,
        message  : categorized.statusCode < 500 ? categorized.message : 'Internal server error',
        retryable: categorized.retryable,
        code     : categorized.code,
      });
    };
  }

  // ── Stats ────────────────────────────────────────────────────────────────────

  stats(): Record<string, unknown> {
    return {
      dedupCacheSize: this.dedupCache.size,
      counts        : Object.fromEntries(this.counts),
    };
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private _fingerprint(category: ErrorCategory, message: string): string {
    // Normalize numbers/UUIDs out of message so similar errors collapse
    const normalized = message
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<uuid>')
      .replace(/\b\d+\b/g, '<n>')
      .slice(0, 120);
    return `${category}:${normalized}`;
  }
}

export const errorHandler = new ErrorHandlerService();
