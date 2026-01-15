/**
 * useRoutedStreaming - Hook para streaming con conversation affinity
 * 
 * Proporciona streaming content para un chat específico usando el
 * ConversationStreamRouter, garantizando que el contenido siempre
 * vaya al chat correcto independientemente del chat activo.
 */

import { useEffect, useCallback, useRef } from 'react';
import {
  useConversationStreamRouter,
  useConversationStreamContent,
  useConversationIsProcessing,
  useConversationActiveRun,
  startStreamRouterCleanup,
  stopStreamRouterCleanup,
} from '@/stores/conversationStreamRouter';
import {
  startStreamingRun,
  appendStreamingDelta,
  completeStreamingRun,
  failStreamingRun,
  failStreamingRunWithContext,
  generateRequestId,
} from '@/lib/streamEventAdapter';
import {
  initStreamBroadcast,
  destroyStreamBroadcast,
  broadcastActiveChatChange,
  broadcastRunAborted,
} from '@/lib/streamBroadcast';

let globalInitialized = false;

export function initializeStreamingInfrastructure(): void {
  if (globalInitialized) return;
  
  initStreamBroadcast();
  startStreamRouterCleanup();
  globalInitialized = true;
  
  console.log('[RoutedStreaming] Infrastructure initialized');
}

export function destroyStreamingInfrastructure(): void {
  if (!globalInitialized) return;
  
  destroyStreamBroadcast();
  stopStreamRouterCleanup();
  globalInitialized = false;
}

export interface StreamingSession {
  requestId: string;
  assistantMessageId: string;
  appendDelta: (text: string) => void;
  complete: (finalContent?: string) => void;
  fail: (code: string, message: string) => void;
}

export function useRoutedStreaming(conversationId: string | null | undefined) {
  const streamingContent = useConversationStreamContent(conversationId);
  const isProcessing = useConversationIsProcessing(conversationId);
  const activeRun = useConversationActiveRun(conversationId);
  const setActiveChatId = useConversationStreamRouter(s => s.setActiveChatId);
  const abortRun = useConversationStreamRouter(s => s.abortRun);

  useEffect(() => {
    if (conversationId) {
      setActiveChatId(conversationId);
      broadcastActiveChatChange(conversationId);
    }
    
    return () => {
    };
  }, [conversationId, setActiveChatId]);

  const startSession = useCallback((userMessageId: string): StreamingSession => {
    if (!conversationId) {
      throw new Error('[RoutedStreaming] Cannot start session without conversationId');
    }

    const requestId = generateRequestId();
    const assistantMessageId = startStreamingRun(conversationId, requestId, userMessageId);

    return {
      requestId,
      assistantMessageId,
      appendDelta: (text: string) => appendStreamingDelta(requestId, text),
      complete: (finalContent?: string) => completeStreamingRun(requestId, finalContent),
      fail: (code: string, message: string) => failStreamingRun(requestId, code, message),
    };
  }, [conversationId]);

  const abortCurrentRun = useCallback(() => {
    if (!conversationId || !activeRun) return;
    
    abortRun(conversationId, activeRun.requestId);
    broadcastRunAborted(conversationId, activeRun.requestId);
  }, [conversationId, activeRun, abortRun]);

  return {
    streamingContent,
    isProcessing,
    activeRun,
    
    startSession,
    abortCurrentRun,
    
    requestId: activeRun?.requestId ?? null,
    assistantMessageId: activeRun?.assistantMessageId ?? null,
    status: activeRun?.status ?? 'idle',
    error: activeRun?.error ?? null,
  };
}

export function useStreamingBadges() {
  const pendingBadges = useConversationStreamRouter(s => s.pendingBadges);
  const clearBadge = useConversationStreamRouter(s => s.clearBadge);
  const clearAllBadges = useConversationStreamRouter(s => s.clearAllBadges);

  const getBadgeCount = useCallback((conversationId: string): number => {
    return pendingBadges.get(conversationId) ?? 0;
  }, [pendingBadges]);

  const hasBadges = useCallback((): boolean => {
    return pendingBadges.size > 0;
  }, [pendingBadges]);

  const getTotalBadgeCount = useCallback((): number => {
    let total = 0;
    for (const count of pendingBadges.values()) {
      total += count;
    }
    return total;
  }, [pendingBadges]);

  return {
    pendingBadges,
    getBadgeCount,
    hasBadges,
    getTotalBadgeCount,
    clearBadge,
    clearAllBadges,
  };
}

export function useGlobalStreamingState() {
  const processingIds = useConversationStreamRouter(s => s.getProcessingConversationIds());
  const activeChatId = useConversationStreamRouter(s => s.activeChatId);

  return {
    processingConversationIds: processingIds,
    activeChatId,
    hasActiveStreams: processingIds.length > 0,
  };
}
