import { createLogger } from '../../../utils/logger';
import { subagentWorkerPool } from '../../agents/workerPool';

const log = createLogger('openclaw-ccr');

interface ChatSlot {
  chatId: string;
  userId: string;
  startedAt: number;
  model: string;
}

const activeSlots = new Map<string, ChatSlot>();
let initialized = false;

export function initChatConcurrentRuntime(): void {
  if (initialized) return;
  initialized = true;

  log.info('[OpenClaw:CCR] Chat concurrent runtime initialized (backed by subagentWorkerPool)');
}

export function acquireChatSlot(chatId: string, userId: string, model: string): boolean {
  if (!initialized) return true;

  const key = `${userId}:${chatId}`;
  if (activeSlots.has(key)) {
    log.debug(`[CCR] Slot already active for chat ${chatId}`);
    return false;
  }

  activeSlots.set(key, { chatId, userId, startedAt: Date.now(), model });
  log.debug(`[CCR] Acquired slot for chat ${chatId} (active=${activeSlots.size})`);
  return true;
}

export function releaseChatSlot(chatId: string, userId: string): void {
  const key = `${userId}:${chatId}`;
  activeSlots.delete(key);
  log.debug(`[CCR] Released slot for chat ${chatId} (active=${activeSlots.size})`);
}

export function getCcrStatus(): {
  initialized: boolean;
  activeSlots: number;
  poolRunning: number;
} {
  return {
    initialized,
    activeSlots: activeSlots.size,
    poolRunning: (subagentWorkerPool as any)['running']?.size ?? 0,
  };
}

export function stopChatConcurrentRuntime(): void {
  activeSlots.clear();
  initialized = false;
}
