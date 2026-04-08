import { Logger } from '../../../lib/logger';
import type { OpenClawConfig } from '../../config';

export const OPENCLAW_VERSION = '2026.4.2';
export const OPENCLAW_RELEASE_DATE = '2026-04-02T18:30:00Z';
export const OPENCLAW_COMMIT = 'd74a122';

export interface OpenClaw2026_4_2Features {
  taskBoard: boolean;
  backgroundControlPlane: boolean;
  crossModelToolFallback: boolean;
  chatConcurrentRuntime: boolean;
  searxngSearch: boolean;
  modelSwitchQueue: boolean;
  cronToolsAllowlist: boolean;
  zaiModels: boolean;
  minimaxAutoEnable: boolean;
  gatewayHttpResilience: boolean;
  telegramErrorPolicy: boolean;
  whatsappReactions: boolean;
  agentCompaction: boolean;
  internetAccess: boolean;
}

export function getEnabledFeatures(): OpenClaw2026_4_2Features {
  return {
    taskBoard: true,
    backgroundControlPlane: true,
    crossModelToolFallback: true,
    chatConcurrentRuntime: true,
    searxngSearch: true,
    modelSwitchQueue: true,
    cronToolsAllowlist: true,
    zaiModels: true,
    minimaxAutoEnable: true,
    gatewayHttpResilience: true,
    telegramErrorPolicy: process.env.ENABLE_TELEGRAM === 'true',
    whatsappReactions: process.env.ENABLE_WHATSAPP === 'true',
    agentCompaction: true,
    internetAccess: true,
  };
}

export async function initializeV2026_4_2(_config: OpenClawConfig): Promise<string[]> {
  const features = getEnabledFeatures();
  const initialized: string[] = [];

  if (features.taskBoard) {
    const { initTaskBoard } = await import('./taskBoard');
    initTaskBoard();
    initialized.push('task-board');
  }

  if (features.backgroundControlPlane) {
    // stub: needs implementation
    initialized.push('background-control-plane (stub)');
  }

  if (features.crossModelToolFallback) {
    // stub: needs implementation
    initialized.push('cross-model-tool-fallback (stub)');
  }

  if (features.chatConcurrentRuntime) {
    // stub: needs implementation
    initialized.push('chat-concurrent-runtime (stub)');
  }

  if (features.searxngSearch) {
    const { registerSearxngProvider } = await import('./searxngSearch');
    registerSearxngProvider();
    initialized.push('searxng-search');
  }

  if (features.modelSwitchQueue) {
    const { initModelSwitchQueue } = await import('./modelSwitchQueue');
    initModelSwitchQueue();
    initialized.push('model-switch-queue');
  }

  if (features.zaiModels) {
    const { registerZaiModels } = await import('./zaiModels');
    registerZaiModels();
    initialized.push('zai-models');
  }

  if (features.gatewayHttpResilience) {
    const { initGatewayResilience } = await import('./gatewayResilience');
    initGatewayResilience();
    initialized.push('gateway-resilience');
  }

  if (features.cronToolsAllowlist) {
    // stub: needs implementation
    initialized.push('cron-tools-allowlist (stub)');
  }

  if (features.minimaxAutoEnable) {
    // stub: needs implementation
    initialized.push('minimax-auto-enable (stub)');
  }

  if (features.agentCompaction) {
    // stub: needs implementation
    initialized.push('agent-compaction (stub)');
  }

  if (features.internetAccess) {
    // stub: needs implementation — actual internet access is handled by internetAccess.ts
    initialized.push('internet-access (stub)');
  }

  const real = initialized.filter(f => !f.endsWith('(stub)'));
  const stubs = initialized.filter(f => f.endsWith('(stub)'));
  Logger.info(`[OpenClaw v${OPENCLAW_VERSION}] Fusion initialized: ${real.length} active [${real.join(', ')}], ${stubs.length} stubs [${stubs.join(', ')}]`);
  return initialized;
}
