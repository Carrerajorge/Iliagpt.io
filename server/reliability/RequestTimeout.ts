/**
 * RequestTimeout — Express middleware enforcing per-request timeouts.
 *
 * Features:
 *   - Default 180 s for normal requests, 300 s for streaming (SSE / chunked)
 *   - Sends a 503 JSON response on timeout if headers not yet sent
 *   - Sets `req.timedOut = true` so downstream code can check
 *   - Attaches an AbortSignal to `req.signal` so handlers can propagate cancellation
 *   - Automatically cleared on `res.finish` / `res.close`
 */

import type { Request, Response, NextFunction } from 'express';
import { Logger } from '../lib/logger';

// Extend Express Request with custom fields
declare global {
  namespace Express {
    interface Request {
      timedOut?: boolean;
      signal?  : AbortSignal;
    }
  }
}

export interface TimeoutOptions {
  normalMs   ?: number;    // default 180_000
  streamingMs?: number;    // default 300_000
  onTimeout  ?: (req: Request, res: Response) => void;
}

// ─── Detect streaming requests ─────────────────────────────────────────────────

function isStreaming(req: Request): boolean {
  const accept = req.headers['accept'] ?? '';
  return (
    accept.includes('text/event-stream') ||
    accept.includes('application/x-ndjson') ||
    req.path.includes('/stream') ||
    req.path.includes('/agentic')
  );
}

// ─── Middleware factory ────────────────────────────────────────────────────────

export function requestTimeout(opts: TimeoutOptions = {}) {
  const normalMs    = opts.normalMs    ?? 180_000;
  const streamingMs = opts.streamingMs ?? 300_000;

  return (req: Request, res: Response, next: NextFunction): void => {
    const timeoutMs = isStreaming(req) ? streamingMs : normalMs;

    // Attach AbortController so handlers can observe cancellation
    const controller = new AbortController();
    req.signal = controller.signal;

    const timer = setTimeout(() => {
      req.timedOut = true;
      controller.abort();

      Logger.warn('[RequestTimeout] request timed out', {
        method   : req.method,
        path     : req.path,
        timeoutMs,
        streaming: isStreaming(req),
      });

      if (opts.onTimeout) {
        opts.onTimeout(req, res);
        return;
      }

      if (!res.headersSent) {
        res.status(503).json({
          error    : 'timeout',
          message  : 'Request timed out',
          retryable: true,
        });
      }
    }, timeoutMs);

    // Don't let the timer keep the event loop alive
    if (typeof timer.unref === 'function') timer.unref();

    // Clear on response completion
    const clear = () => clearTimeout(timer);
    res.once('finish', clear);
    res.once('close',  clear);

    next();
  };
}
