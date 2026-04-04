/**
 * server/integration/index.ts
 *
 * Master entry point for the agentic integration layer.
 *
 * Usage — add ONE line to server/index.ts after registerRoutes():
 *
 *   const { integrateAgenticSystem } = await import('./integration/index');
 *   await integrateAgenticSystem(app);
 *
 * That's it.  Everything else is wired automatically.
 */

import type { Express } from 'express';
import { Logger }       from '../lib/logger';
import { bootstrapAgenticSystem, type BootstrapResult } from './agenticBootstrap';

// Re-export utilities so callers can import from a single location
export { resolveModel, detectProvider, getModelConfig, initModelWiring } from './modelWiring';
export { wireTools }                from './toolWiring';
export { bootstrapAgenticSystem }   from './agenticBootstrap';
export { createSseSession, bridgeAgenticEvents, sendSse, sseHeaders, isSessionAlive } from './streamingWiring';
export { createAgenticInterceptor, registerChatInterceptor, scoreAgenticNeed } from './chatIntegration';

// ─── Master integrate function ────────────────────────────────────────────────

let _bootstrapResult: BootstrapResult | null = null;

/**
 * Wire the full agentic capability layer into the Express app.
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function integrateAgenticSystem(app: Express): Promise<BootstrapResult> {
  if (_bootstrapResult) {
    Logger.debug('[Integration] already initialized — skipping');
    return _bootstrapResult;
  }

  Logger.info('[Integration] integrateAgenticSystem() starting…');

  try {
    _bootstrapResult = await bootstrapAgenticSystem(app);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Logger.error('[Integration] FATAL: bootstrap threw an unexpected error', { error: msg });
    // Return a degraded result rather than crashing the server
    _bootstrapResult = {
      ok         : false,
      subsystems : {},
      healthChecks: [{ name: 'bootstrap', ok: false, detail: msg }],
    };
  }

  Logger.info('[Integration] integrateAgenticSystem() complete', {
    ok: _bootstrapResult.ok,
  });

  return _bootstrapResult;
}

/**
 * Get the bootstrap result from a previous integrateAgenticSystem() call.
 * Returns null if the system has not been initialized yet.
 */
export function getIntegrationStatus(): BootstrapResult | null {
  return _bootstrapResult;
}
