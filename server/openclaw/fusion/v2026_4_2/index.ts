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
    initialized.push('background-control-plane');
  }

  if (features.crossModelToolFallback) {
    initialized.push('cross-model-tool-fallback');
  }

  if (features.chatConcurrentRuntime) {
    initialized.push('chat-concurrent-runtime');
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
    initialized.push('cron-tools-allowlist');
  }

  if (features.minimaxAutoEnable) {
    initialized.push('minimax-auto-enable');
  }

  if (features.agentCompaction) {
    initialized.push('agent-compaction');
  }

  if (features.internetAccess) {
    initialized.push('internet-access');
  }

  Logger.info(`[OpenClaw v${OPENCLAW_VERSION}] Fusion initialized: [${initialized.join(', ')}]`);
  return initialized;
}
