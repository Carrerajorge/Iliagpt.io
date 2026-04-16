/**
 * StreamEventAdapter - Adapta eventos SSE legacy al nuevo formato de routing
 * 
 * Convierte eventos del formato actual a ResponseStartedEvent, ResponseDeltaEvent, etc.
 * para usar con el ConversationStreamRouter.
 */

import {
  ResponseStartedEvent,
  ResponseDeltaEvent,
  ResponseCompletedEvent,
  ResponseErrorEvent,
  StreamEvent,
} from '@/stores/conversationStreamRouter';
import { processAndBroadcastStreamEvent } from './streamBroadcast';

interface LegacyStreamContext {
  conversationId: string;
  requestId: string;
  userMessageId: string;
}

const activeContexts = new Map<string, LegacyStreamContext & { seq: number; assistantMessageId: string }>();

const conversationIdMigrationMap = new Map<string, string>();

export function migrateStreamContextConversationId(oldId: string, newId: string): void {
  if (oldId === newId) return;
  
  conversationIdMigrationMap.set(oldId, newId);
  
  activeContexts.forEach((ctx) => {
    if (ctx.conversationId === oldId) {
      ctx.conversationId = newId;
      console.log(`[StreamEventAdapter] Migrated context for requestId ${ctx.requestId} from ${oldId} to ${newId}`);
    }
  });
}

export function resolveConversationId(id: string): string {
  return conversationIdMigrationMap.get(id) ?? id;
}

export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function startStreamingRun(
  conversationId: string,
  requestId: string,
  userMessageId: string
): string {
  const assistantMessageId = generateMessageId();
  
  activeContexts.set(requestId, {
    conversationId,
    requestId,
    userMessageId,
    assistantMessageId,
    seq: 0,
  });

  const startEvent: ResponseStartedEvent = {
    type: 'response.started',
    requestId,
    conversationId,
    assistantMessageId,
    userMessageId,
  };

  processAndBroadcastStreamEvent(startEvent);

  return assistantMessageId;
}

export function appendStreamingDelta(
  requestId: string,
  textDelta: string
): boolean {
  const ctx = activeContexts.get(requestId);
  if (!ctx) {
    console.warn('[StreamEventAdapter] No context for requestId:', requestId);
    return false;
  }

  ctx.seq += 1;

  const deltaEvent: ResponseDeltaEvent = {
    type: 'response.delta',
    requestId,
    conversationId: ctx.conversationId,
    assistantMessageId: ctx.assistantMessageId,
    seq: ctx.seq,
    textDelta,
  };

  processAndBroadcastStreamEvent(deltaEvent);
  return true;
}

export function completeStreamingRun(
  requestId: string,
  finalContent?: string
): void {
  const ctx = activeContexts.get(requestId);
  if (!ctx) {
    console.warn('[StreamEventAdapter] No context for requestId:', requestId);
    return;
  }

  const completeEvent: ResponseCompletedEvent = {
    type: 'response.completed',
    requestId,
    conversationId: ctx.conversationId,
    assistantMessageId: ctx.assistantMessageId,
    finalContent,
  };

  processAndBroadcastStreamEvent(completeEvent);
  
  activeContexts.delete(requestId);
}

export function failStreamingRun(
  requestId: string,
  code: string,
  message: string
): void {
  const ctx = activeContexts.get(requestId);
  
  const errorEvent: ResponseErrorEvent = {
    type: 'response.error',
    requestId,
    conversationId: ctx?.conversationId ?? 'unknown',
    code,
    message,
  };

  processAndBroadcastStreamEvent(errorEvent);
  
  if (ctx) {
    activeContexts.delete(requestId);
  }
}

export function failStreamingRunWithContext(
  conversationId: string,
  requestId: string,
  code: string,
  message: string
): void {
  const errorEvent: ResponseErrorEvent = {
    type: 'response.error',
    requestId,
    conversationId,
    code,
    message,
  };

  processAndBroadcastStreamEvent(errorEvent);
  activeContexts.delete(requestId);
}

export function getActiveStreamContext(requestId: string): LegacyStreamContext | undefined {
  const ctx = activeContexts.get(requestId);
  if (!ctx) return undefined;
  
  return {
    conversationId: ctx.conversationId,
    requestId: ctx.requestId,
    userMessageId: ctx.userMessageId,
  };
}

export function hasActiveStream(requestId: string): boolean {
  return activeContexts.has(requestId);
}

export function cleanupStaleContexts(olderThanMs = 3600000): void {
  const now = Date.now();
  const staleThreshold = now - olderThanMs;
  
  const entries = Array.from(activeContexts.entries());
  for (const [requestId] of entries) {
    const timestamp = parseInt(requestId.split('_')[1] || '0', 10);
    if (timestamp < staleThreshold) {
      activeContexts.delete(requestId);
    }
  }
}
