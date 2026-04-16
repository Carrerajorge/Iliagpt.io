import { createLogger } from '../../../utils/logger';

const log = createLogger('openclaw-cmtf');

export interface ToolFallbackEntry {
  toolId: string;
  preferredModel: string;
  fallbackModels: string[];
  failureCount: number;
  lastFailedAt?: number;
  lastSucceededAt?: number;
}

const fallbackRegistry = new Map<string, ToolFallbackEntry>();
const COOLDOWN_MS = 5 * 60 * 1000;

export function registerToolFallback(
  toolId: string,
  preferredModel: string,
  fallbackModels: string[]
): void {
  fallbackRegistry.set(toolId, {
    toolId,
    preferredModel,
    fallbackModels,
    failureCount: 0,
  });
}

export function recordToolFailure(toolId: string, model: string): void {
  const entry = fallbackRegistry.get(toolId);
  if (!entry) return;
  if (entry.preferredModel === model || entry.fallbackModels.includes(model)) {
    entry.failureCount++;
    entry.lastFailedAt = Date.now();
    log.warn(`[CMTF] Tool "${toolId}" failed on model "${model}" (total: ${entry.failureCount})`);
  }
}

export function recordToolSuccess(toolId: string, model: string): void {
  const entry = fallbackRegistry.get(toolId);
  if (!entry) return;
  entry.failureCount = 0;
  entry.lastSucceededAt = Date.now();
  log.debug(`[CMTF] Tool "${toolId}" succeeded on model "${model}"`);
}

export function getPreferredModelForTool(toolId: string): string | null {
  const entry = fallbackRegistry.get(toolId);
  if (!entry) return null;

  const recentlyFailed = entry.lastFailedAt && (Date.now() - entry.lastFailedAt) < COOLDOWN_MS;
  if (!recentlyFailed || entry.failureCount === 0) return entry.preferredModel;

  const fallbackIdx = Math.min(entry.failureCount - 1, entry.fallbackModels.length - 1);
  const chosen = entry.fallbackModels[fallbackIdx] ?? entry.preferredModel;
  log.info(`[CMTF] Tool "${toolId}" routing to fallback model "${chosen}" (failures: ${entry.failureCount})`);
  return chosen;
}

export function initCrossModelToolFallback(): void {
  registerToolFallback('openclaw.web.search', 'gemini-flash', ['grok-3-mini', 'claude-haiku']);
  registerToolFallback('openclaw.code.exec', 'gpt-4o-mini', ['claude-haiku', 'gemini-flash']);
  registerToolFallback('openclaw.doc.generate', 'gpt-4o', ['claude-sonnet', 'gemini-pro']);

  log.info('[OpenClaw:CMTF] Cross-model tool fallback initialized');
}

export function getCmtfStatus(): { registeredTools: number } {
  return { registeredTools: fallbackRegistry.size };
}
