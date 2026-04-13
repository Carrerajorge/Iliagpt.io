import { createLogger } from '../../../utils/logger';

const log = createLogger('openclaw-minimax');

export interface MiniMaxModel {
  id: string;
  name: string;
  contextWindow: number;
  supportsVision: boolean;
  supportsAudio: boolean;
  tier: 'fast' | 'balanced' | 'powerful';
  endpoint: string;
}

const MINIMAX_CATALOG: MiniMaxModel[] = [
  {
    id: 'minimax-text-01',
    name: 'MiniMax Text-01',
    contextWindow: 1_000_000,
    supportsVision: false,
    supportsAudio: false,
    tier: 'balanced',
    endpoint: 'https://api.minimaxi.chat/v1/text/chatcompletion_v2',
  },
  {
    id: 'minimax-speech-01',
    name: 'MiniMax Speech-01',
    contextWindow: 32_768,
    supportsVision: false,
    supportsAudio: true,
    tier: 'fast',
    endpoint: 'https://api.minimaxi.chat/v1/t2a_v2',
  },
  {
    id: 'abab6.5s-chat',
    name: 'ABAB 6.5S',
    contextWindow: 245_760,
    supportsVision: false,
    supportsAudio: false,
    tier: 'fast',
    endpoint: 'https://api.minimaxi.chat/v1/text/chatcompletion_v2',
  },
  {
    id: 'abab6.5g-chat',
    name: 'ABAB 6.5G',
    contextWindow: 8_192,
    supportsVision: false,
    supportsAudio: false,
    tier: 'powerful',
    endpoint: 'https://api.minimaxi.chat/v1/text/chatcompletion_v2',
  },
];

const enabledModels = new Map<string, MiniMaxModel>();
let initialized = false;

function hasMiniMaxKey(): boolean {
  return !!(process.env.MINIMAX_API_KEY || process.env.MINIMAX_GROUP_ID);
}

export function initMinimaxAutoEnable(): void {
  if (initialized) return;
  initialized = true;

  if (!hasMiniMaxKey()) {
    log.info('[OpenClaw:MiniMax] No API key found — MiniMax models disabled');
    return;
  }

  for (const model of MINIMAX_CATALOG) {
    enabledModels.set(model.id, model);
  }

  log.info(`[OpenClaw:MiniMax] Auto-enabled ${enabledModels.size} MiniMax models`);
}

export function getMiniMaxModels(): MiniMaxModel[] {
  return Array.from(enabledModels.values());
}

export function isMiniMaxEnabled(): boolean {
  return enabledModels.size > 0;
}

export function getMiniMaxStatus(): {
  enabled: boolean;
  modelCount: number;
  hasApiKey: boolean;
} {
  return {
    enabled: isMiniMaxEnabled(),
    modelCount: enabledModels.size,
    hasApiKey: hasMiniMaxKey(),
  };
}
