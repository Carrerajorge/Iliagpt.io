/**
 * agenticBootstrap
 *
 * Initializes all agentic subsystems at server startup in dependency order:
 *
 *   1. Model wiring      — detect available LLM providers
 *   2. Tool wiring       — register and wire all built-in tools
 *   3. BackgroundTaskManager — start task worker pool
 *   4. Agentic routes    — mount /api/agentic and /api/terminal
 *   5. Chat interceptor  — register agentic triage before existing chatAiRouter
 *   6. Health check      — validate critical subsystems
 *
 * Each subsystem is initialized with `try/catch`.  A subsystem failure logs
 * a WARNING and continues — the server never crashes on optional subsystems.
 */

import type { Express } from 'express';
import { Logger }       from '../lib/logger';
import { initModelWiring, getModelConfig } from './modelWiring';
import { wireTools }    from './toolWiring';
import { registerChatInterceptor } from './chatIntegration';
import { createAgenticChatRouter } from '../routes/agenticChatRouter';
import { createTerminalRouter }    from '../routes/terminalRouter';

// ─── Subsystem initializers ───────────────────────────────────────────────────

async function initModels(): Promise<boolean> {
  try {
    initModelWiring();
    const cfg = getModelConfig();
    Logger.info('[Bootstrap] model wiring ready', {
      defaultModel: cfg.defaultModel,
      providers   : cfg.fallbackChain,
    });
    return true;
  } catch (err) {
    Logger.warn('[Bootstrap] model wiring failed — using "auto" fallback', {
      error: (err as Error).message,
    });
    return false;
  }
}

async function initTools(): Promise<boolean> {
  try {
    await wireTools();
    return true;
  } catch (err) {
    Logger.warn('[Bootstrap] tool wiring failed', { error: (err as Error).message });
    return false;
  }
}

async function initBackgroundTaskManager(): Promise<boolean> {
  try {
    const { backgroundTaskManager } = await import('../tasks/BackgroundTaskManager');
    const stats = backgroundTaskManager.stats();
    Logger.info('[Bootstrap] BackgroundTaskManager ready', stats);
    return true;
  } catch (err) {
    Logger.warn('[Bootstrap] BackgroundTaskManager init failed', { error: (err as Error).message });
    return false;
  }
}

async function initTerminalManager(): Promise<boolean> {
  try {
    const { terminalSessionManager } = await import('../agentic/tools/TerminalSession');
    const stats = terminalSessionManager.stats();
    Logger.info('[Bootstrap] TerminalSessionManager ready', stats);
    return true;
  } catch (err) {
    Logger.warn('[Bootstrap] TerminalSessionManager init failed', { error: (err as Error).message });
    return false;
  }
}

async function initCodeExecutor(): Promise<boolean> {
  try {
    const { codeExecutor } = await import('../agentic/tools/CodeExecutor');
    const availability = await codeExecutor.checkLanguageAvailability();
    const supported    = Object.entries(availability)
      .filter(([, v]) => v)
      .map(([k]) => k);
    Logger.info('[Bootstrap] CodeExecutor ready', { languages: supported });
    return true;
  } catch (err) {
    Logger.warn('[Bootstrap] CodeExecutor init failed', { error: (err as Error).message });
    return false;
  }
}

// ─── Route registration ───────────────────────────────────────────────────────

function mountRoutes(app: Express): void {
  try {
    app.use('/api/agentic',  createAgenticChatRouter());
    app.use('/api/terminal', createTerminalRouter());
    Logger.info('[Bootstrap] agentic routes mounted', {
      routes: ['/api/agentic', '/api/terminal'],
    });
  } catch (err) {
    Logger.warn('[Bootstrap] route mounting failed', { error: (err as Error).message });
  }
}

// ─── Health check ─────────────────────────────────────────────────────────────

interface SubsystemStatus {
  name   : string;
  ok     : boolean;
  detail?: string;
}

async function runHealthChecks(): Promise<SubsystemStatus[]> {
  const results: SubsystemStatus[] = [];

  // LLM connectivity
  try {
    const cfg = getModelConfig();
    const anyProvider = cfg.fallbackChain.length > 0;
    results.push({
      name  : 'llm_providers',
      ok    : anyProvider,
      detail: anyProvider ? cfg.fallbackChain.join(', ') : 'no providers configured',
    });
  } catch (e) {
    results.push({ name: 'llm_providers', ok: false, detail: (e as Error).message });
  }

  // Redis (optional — tasks use in-memory fallback if unavailable)
  try {
    const { redis } = await import('../lib/redis');
    await redis.ping();
    results.push({ name: 'redis', ok: true, detail: 'connected' });
  } catch {
    results.push({ name: 'redis', ok: false, detail: 'unavailable (in-memory fallback active)' });
  }

  // Tool registry
  try {
    const { globalToolRegistry } = await import('../agentic/toolCalling/ToolRegistry');
    const count = globalToolRegistry.list().length;
    results.push({ name: 'tool_registry', ok: count > 0, detail: `${count} tools registered` });
  } catch (e) {
    results.push({ name: 'tool_registry', ok: false, detail: (e as Error).message });
  }

  return results;
}

// ─── Master bootstrap function ────────────────────────────────────────────────

export interface BootstrapResult {
  ok         : boolean;
  subsystems : Record<string, boolean>;
  healthChecks: SubsystemStatus[];
}

export async function bootstrapAgenticSystem(app: Express): Promise<BootstrapResult> {
  Logger.info('[Bootstrap] starting agentic system bootstrap…');
  const start = Date.now();

  const [
    modelsOk,
    toolsOk,
    tasksOk,
    terminalOk,
    codeOk,
  ] = await Promise.all([
    initModels(),
    initTools(),
    initBackgroundTaskManager(),
    initTerminalManager(),
    initCodeExecutor(),
  ]);

  // Mount routes (must run after tools are wired)
  mountRoutes(app);

  // Register agentic interceptor on the existing chat stream endpoint.
  // This MUST run after existing routes are registered so it can sit in
  // front of the chatAiRouter without replacing it.
  try {
    registerChatInterceptor(app);
  } catch (err) {
    Logger.warn('[Bootstrap] chat interceptor registration failed', {
      error: (err as Error).message,
    });
  }

  const healthChecks = await runHealthChecks();
  const healthOk     = healthChecks.every(h => h.ok || h.name === 'redis');

  const subsystems: Record<string, boolean> = {
    models  : modelsOk,
    tools   : toolsOk,
    tasks   : tasksOk,
    terminal: terminalOk,
    code    : codeOk,
    routes  : true,
    health  : healthOk,
  };

  const allOk = Object.values(subsystems).every(Boolean);

  Logger.info('[Bootstrap] agentic system ready', {
    ok        : allOk,
    durationMs: Date.now() - start,
    subsystems,
    health    : healthChecks,
  });

  if (!allOk) {
    const failed = Object.entries(subsystems)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    Logger.warn('[Bootstrap] some subsystems degraded', { failed });
  }

  return { ok: allOk, subsystems, healthChecks };
}
