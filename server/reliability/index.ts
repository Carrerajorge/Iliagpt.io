/**
 * reliability/index — Bootstrap all reliability subsystems.
 *
 * Call bootstrapReliability(app) once from agenticBootstrap.ts (or server/index.ts)
 * to activate all reliability features:
 *
 *   1. ErrorHandler   — categorized error handling + Express error middleware
 *   2. ErrorReporter  — frequency tracking + periodic flush
 *   3. RedisFallback  — transparent Redis with in-memory fallback
 *   4. ConnectionMonitor — DB/Redis health polling + auto-reconnect
 *   5. AutoRecovery   — subsystem health daemon
 *   6. DeadLetterQueue — DB-backed DLQ for failed tasks
 *   7. RequestTimeout — Express per-request timeout middleware
 *
 * The other modules (ConcurrencySemaphore, CircuitBreaker, RetryWithJitter,
 * InputValidator, ResourceCleaner) are imported directly by consumers and need
 * no global bootstrap.
 */

import type { Express } from 'express';
import { Logger }       from '../lib/logger';

// ─── Re-exports (consumers import from here) ──────────────────────────────────

export { errorHandler }         from './ErrorHandler';
export { toolSemaphore, ConcurrencySemaphore } from './ConcurrencySemaphore';
export {
  validateBody, validateQuery,
  ChatStreamSchema, SpawnTaskSchema, ToolInputSchema, MessageSchema,
  sanitizeString, formatZodError,
} from './InputValidator';
export { redisFallback }        from './RedisFallback';
export { resourceCleaner }      from './ResourceCleaner';
export { connectionMonitor }    from './ConnectionMonitor';
export { requestTimeout }       from './RequestTimeout';
export { circuitBreaker, CircuitOpenError } from './CircuitBreaker';
export { retryWithJitter, retryLLM, retryDB, isRetryableError } from './RetryWithJitter';
export { autoRecovery }         from './AutoRecovery';
export { errorReporter }        from './ErrorReporter';
export { deadLetterQueue }      from './DeadLetterQueue';

// ─── Bootstrap result ─────────────────────────────────────────────────────────

export interface ReliabilityBootstrapResult {
  ok        : boolean;
  subsystems: Record<string, boolean>;
}

// ─── Master bootstrap ─────────────────────────────────────────────────────────

export async function bootstrapReliability(app: Express): Promise<ReliabilityBootstrapResult> {
  Logger.info('[Reliability] bootstrapping reliability layer…');
  const start = Date.now();

  const subsystems: Record<string, boolean> = {};

  // 1. ErrorReporter
  try {
    const { errorReporter } = await import('./ErrorReporter');
    errorReporter.start();
    subsystems.errorReporter = true;
  } catch (err) {
    Logger.warn('[Reliability] ErrorReporter failed', { error: (err as Error).message });
    subsystems.errorReporter = false;
  }

  // 2. Redis fallback
  try {
    const { redisFallback } = await import('./RedisFallback');
    await redisFallback.init();
    subsystems.redis = true;
  } catch (err) {
    Logger.warn('[Reliability] RedisFallback failed', { error: (err as Error).message });
    subsystems.redis = false;
  }

  // 3. Dead letter queue
  try {
    const { deadLetterQueue } = await import('./DeadLetterQueue');
    await deadLetterQueue.init();
    subsystems.dlq = true;
  } catch (err) {
    Logger.warn('[Reliability] DeadLetterQueue failed', { error: (err as Error).message });
    subsystems.dlq = false;
  }

  // 4. Connection monitor
  try {
    const { connectionMonitor } = await import('./ConnectionMonitor');
    // Register DB probe if pool is available
    try {
      const { db } = await import('../db');
      connectionMonitor.register({
        name     : 'postgres',
        critical : true,
        probe    : async () => { await db.query('SELECT 1'); },
        reconnect: async () => { /* pool auto-reconnects */ },
      });
    } catch { /* db not available */ }

    // Register Redis probe
    try {
      const { redisFallback } = await import('./RedisFallback');
      connectionMonitor.register({
        name    : 'redis',
        critical: false,
        probe   : async () => { await redisFallback.ping(); },
      });
    } catch { /* redis not available */ }

    connectionMonitor.start(30_000);
    subsystems.connectionMonitor = true;
  } catch (err) {
    Logger.warn('[Reliability] ConnectionMonitor failed', { error: (err as Error).message });
    subsystems.connectionMonitor = false;
  }

  // 5. Auto recovery
  try {
    const { autoRecovery } = await import('./AutoRecovery');
    autoRecovery.start(30_000);
    subsystems.autoRecovery = true;
  } catch (err) {
    Logger.warn('[Reliability] AutoRecovery failed', { error: (err as Error).message });
    subsystems.autoRecovery = false;
  }

  // 6. Request timeout middleware (prepend — must be early in stack)
  try {
    const { requestTimeout } = await import('./RequestTimeout');
    app.use(requestTimeout({ normalMs: 180_000, streamingMs: 300_000 }));
    subsystems.requestTimeout = true;
  } catch (err) {
    Logger.warn('[Reliability] RequestTimeout middleware failed', { error: (err as Error).message });
    subsystems.requestTimeout = false;
  }

  // 7. ErrorHandler middleware (append — must be last in stack)
  try {
    const { errorHandler } = await import('./ErrorHandler');
    app.use(errorHandler.middleware());
    subsystems.errorHandler = true;
  } catch (err) {
    Logger.warn('[Reliability] ErrorHandler middleware failed', { error: (err as Error).message });
    subsystems.errorHandler = false;
  }

  const ok = Object.values(subsystems).every(Boolean);
  Logger.info('[Reliability] bootstrap complete', {
    ok, durationMs: Date.now() - start, subsystems,
  });

  return { ok, subsystems };
}
