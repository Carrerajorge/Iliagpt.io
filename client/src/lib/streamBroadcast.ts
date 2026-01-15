/**
 * StreamBroadcast - Sincronización multi-tab para streaming
 * 
 * Usa BroadcastChannel para sincronizar eventos de streaming entre pestañas.
 * Garantiza que todas las pestañas tengan el mismo estado del stream.
 */

import {
  StreamEvent,
  processStreamEvent,
  validateStreamEvent,
  useConversationStreamRouter,
} from '@/stores/conversationStreamRouter';

const CHANNEL_NAME = 'iliagpt-stream-sync';

interface BroadcastMessage {
  type: 'stream_event' | 'active_chat_changed' | 'run_aborted' | 'sync_request' | 'sync_response';
  payload: unknown;
  tabId: string;
  timestamp: number;
}

let channel: BroadcastChannel | null = null;
let tabId: string | null = null;
let isInitialized = false;

function getTabId(): string {
  if (!tabId) {
    tabId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  return tabId;
}

export function initStreamBroadcast(): void {
  if (isInitialized || typeof BroadcastChannel === 'undefined') {
    return;
  }

  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    
    channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
      handleBroadcastMessage(event.data);
    };

    channel.onmessageerror = (event) => {
      console.error('[StreamBroadcast] Message error:', event);
    };

    isInitialized = true;
    console.log('[StreamBroadcast] Initialized for tab:', getTabId());
  } catch (error) {
    console.warn('[StreamBroadcast] Failed to initialize:', error);
  }
}

export function destroyStreamBroadcast(): void {
  if (channel) {
    channel.close();
    channel = null;
  }
  isInitialized = false;
}

function handleBroadcastMessage(message: BroadcastMessage): void {
  if (message.tabId === getTabId()) {
    return;
  }

  switch (message.type) {
    case 'stream_event':
      if (validateStreamEvent(message.payload)) {
        processStreamEvent(message.payload as StreamEvent);
      }
      break;

    case 'active_chat_changed':
      break;

    case 'run_aborted':
      const abortPayload = message.payload as { conversationId: string; requestId: string };
      useConversationStreamRouter.getState().abortRun(
        abortPayload.conversationId,
        abortPayload.requestId
      );
      break;

    case 'sync_request':
      break;

    case 'sync_response':
      break;
  }
}

export function broadcastStreamEvent(event: StreamEvent): void {
  if (!channel || !isInitialized) return;

  try {
    const message: BroadcastMessage = {
      type: 'stream_event',
      payload: event,
      tabId: getTabId(),
      timestamp: Date.now(),
    };

    channel.postMessage(message);
  } catch (error) {
    console.warn('[StreamBroadcast] Failed to broadcast event:', error);
  }
}

export function broadcastActiveChatChange(chatId: string | null): void {
  if (!channel || !isInitialized) return;

  try {
    const message: BroadcastMessage = {
      type: 'active_chat_changed',
      payload: { chatId },
      tabId: getTabId(),
      timestamp: Date.now(),
    };

    channel.postMessage(message);
  } catch (error) {
    console.warn('[StreamBroadcast] Failed to broadcast active chat change:', error);
  }
}

export function broadcastRunAborted(conversationId: string, requestId: string): void {
  if (!channel || !isInitialized) return;

  try {
    const message: BroadcastMessage = {
      type: 'run_aborted',
      payload: { conversationId, requestId },
      tabId: getTabId(),
      timestamp: Date.now(),
    };

    channel.postMessage(message);
  } catch (error) {
    console.warn('[StreamBroadcast] Failed to broadcast run abort:', error);
  }
}

export function processAndBroadcastStreamEvent(event: StreamEvent): void {
  processStreamEvent(event);
  
  broadcastStreamEvent(event);
}
