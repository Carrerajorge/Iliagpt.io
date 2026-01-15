/**
 * ConversationStreamRouter v1.0
 * 
 * Routing estricto por conversation_id + request_id con streaming idempotente.
 * 
 * Regla de oro: un response_event solo puede asociarse al conversation_id + request_id originales.
 * Nunca al "chat activo" que el usuario tenga abierto en ese momento.
 * 
 * Invariante: response.conversation_id MUST == request.conversation_id
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';

export interface StreamChunk {
  seq: number;
  content: string;
  timestamp: number;
}

export type StreamStatus = 
  | 'idle'
  | 'started'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'reconnecting';

export interface StreamRun {
  requestId: string;
  conversationId: string;
  assistantMessageId: string;
  userMessageId: string;
  status: StreamStatus;
  startedAt: number;
  completedAt?: number;
  error?: string;
  
  chunks: Map<number, StreamChunk>;
  lastSeq: number;
  content: string;
  
  pendingChunks: StreamChunk[];
  
  metadata?: Record<string, unknown>;
}

export interface ResponseStartedEvent {
  type: 'response.started';
  requestId: string;
  conversationId: string;
  assistantMessageId: string;
  userMessageId: string;
  metadata?: Record<string, unknown>;
}

export interface ResponseDeltaEvent {
  type: 'response.delta';
  requestId: string;
  conversationId: string;
  assistantMessageId: string;
  seq: number;
  textDelta: string;
}

export interface ResponseCompletedEvent {
  type: 'response.completed';
  requestId: string;
  conversationId: string;
  assistantMessageId: string;
  finalContent?: string;
}

export interface ResponseErrorEvent {
  type: 'response.error';
  requestId: string;
  conversationId: string;
  code: string;
  message: string;
}

export type StreamEvent = 
  | ResponseStartedEvent 
  | ResponseDeltaEvent 
  | ResponseCompletedEvent 
  | ResponseErrorEvent;

interface ConversationStreamState {
  runs: Map<string, StreamRun>;
  
  runsByConversation: Map<string, Set<string>>;
  
  pendingBadges: Map<string, number>;
  
  activeChatId: string | null;
  
  getRunKey: (conversationId: string, requestId: string) => string;
  
  startRun: (event: ResponseStartedEvent) => void;
  
  appendDelta: (event: ResponseDeltaEvent) => boolean;
  
  completeRun: (event: ResponseCompletedEvent) => void;
  
  failRun: (event: ResponseErrorEvent) => void;
  
  abortRun: (conversationId: string, requestId: string) => void;
  
  getRunContent: (conversationId: string, requestId: string) => string;
  
  getActiveRunForConversation: (conversationId: string) => StreamRun | undefined;
  
  getStreamingContentForConversation: (conversationId: string) => string;
  
  setActiveChatId: (chatId: string | null) => void;
  
  clearBadge: (conversationId: string) => void;
  
  clearAllBadges: () => void;
  
  cleanup: (olderThanMs?: number) => void;
  
  isProcessing: (conversationId: string) => boolean;
  
  getProcessingConversationIds: () => string[];
}

const MAX_PENDING_CHUNKS = 100;
const MAX_OUT_OF_ORDER_WAIT_MS = 5000;

export const useConversationStreamRouter = create<ConversationStreamState>((set, get) => ({
  runs: new Map(),
  runsByConversation: new Map(),
  pendingBadges: new Map(),
  activeChatId: null,
  
  getRunKey: (conversationId: string, requestId: string) => {
    return `${conversationId}::${requestId}`;
  },
  
  startRun: (event: ResponseStartedEvent) => {
    const key = get().getRunKey(event.conversationId, event.requestId);
    
    set((state) => {
      if (state.runs.has(key)) {
        return state;
      }
      
      const newRun: StreamRun = {
        requestId: event.requestId,
        conversationId: event.conversationId,
        assistantMessageId: event.assistantMessageId,
        userMessageId: event.userMessageId,
        status: 'started',
        startedAt: Date.now(),
        chunks: new Map(),
        lastSeq: 0,
        content: '',
        pendingChunks: [],
        metadata: event.metadata,
      };
      
      const newRuns = new Map(state.runs);
      newRuns.set(key, newRun);
      
      const newRunsByConv = new Map(state.runsByConversation);
      const convRuns = newRunsByConv.get(event.conversationId) ?? new Set();
      convRuns.add(key);
      newRunsByConv.set(event.conversationId, convRuns);
      
      return {
        runs: newRuns,
        runsByConversation: newRunsByConv,
      };
    });
  },
  
  appendDelta: (event: ResponseDeltaEvent) => {
    const key = get().getRunKey(event.conversationId, event.requestId);
    
    const state = get();
    const run = state.runs.get(key);
    
    if (!run) {
      console.warn(`[StreamRouter] Delta for unknown run: ${key}`);
      return false;
    }
    
    if (run.chunks.has(event.seq)) {
      return true;
    }
    
    set((state) => {
      const run = state.runs.get(key);
      if (!run) return state;
      
      const newRuns = new Map(state.runs);
      const updatedRun = { ...run };
      
      updatedRun.chunks = new Map(run.chunks);
      updatedRun.chunks.set(event.seq, {
        seq: event.seq,
        content: event.textDelta,
        timestamp: Date.now(),
      });
      
      if (event.seq === run.lastSeq + 1) {
        let nextSeq = event.seq;
        let newContent = run.content + event.textDelta;
        
        while (updatedRun.chunks.has(nextSeq + 1)) {
          nextSeq++;
          const nextChunk = updatedRun.chunks.get(nextSeq)!;
          newContent += nextChunk.content;
        }
        
        updatedRun.lastSeq = nextSeq;
        updatedRun.content = newContent;
        updatedRun.status = 'streaming';
        
        updatedRun.pendingChunks = updatedRun.pendingChunks.filter(
          c => c.seq > nextSeq
        );
      } else {
        updatedRun.pendingChunks = [
          ...run.pendingChunks,
          { seq: event.seq, content: event.textDelta, timestamp: Date.now() }
        ].slice(-MAX_PENDING_CHUNKS);
      }
      
      newRuns.set(key, updatedRun);
      
      return { runs: newRuns };
    });
    
    return true;
  },
  
  completeRun: (event: ResponseCompletedEvent) => {
    const key = get().getRunKey(event.conversationId, event.requestId);
    
    set((state) => {
      const run = state.runs.get(key);
      if (!run) return state;
      
      const newRuns = new Map(state.runs);
      const updatedRun = {
        ...run,
        status: 'completed' as StreamStatus,
        completedAt: Date.now(),
        content: event.finalContent ?? run.content,
      };
      
      newRuns.set(key, updatedRun);
      
      const shouldShowBadge = event.conversationId !== state.activeChatId;
      const newBadges = new Map(state.pendingBadges);
      if (shouldShowBadge) {
        newBadges.set(
          event.conversationId,
          (newBadges.get(event.conversationId) ?? 0) + 1
        );
      }
      
      return {
        runs: newRuns,
        pendingBadges: newBadges,
      };
    });
  },
  
  failRun: (event: ResponseErrorEvent) => {
    const key = get().getRunKey(event.conversationId, event.requestId);
    
    set((state) => {
      const run = state.runs.get(key);
      if (!run) {
        const newRun: StreamRun = {
          requestId: event.requestId,
          conversationId: event.conversationId,
          assistantMessageId: '',
          userMessageId: '',
          status: 'failed',
          startedAt: Date.now(),
          completedAt: Date.now(),
          error: `${event.code}: ${event.message}`,
          chunks: new Map(),
          lastSeq: 0,
          content: '',
          pendingChunks: [],
        };
        
        const newRuns = new Map(state.runs);
        newRuns.set(key, newRun);
        
        return { runs: newRuns };
      }
      
      const newRuns = new Map(state.runs);
      newRuns.set(key, {
        ...run,
        status: 'failed',
        completedAt: Date.now(),
        error: `${event.code}: ${event.message}`,
      });
      
      const shouldShowBadge = event.conversationId !== state.activeChatId;
      const newBadges = new Map(state.pendingBadges);
      if (shouldShowBadge) {
        newBadges.set(
          event.conversationId,
          (newBadges.get(event.conversationId) ?? 0) + 1
        );
      }
      
      return {
        runs: newRuns,
        pendingBadges: newBadges,
      };
    });
  },
  
  abortRun: (conversationId: string, requestId: string) => {
    const key = get().getRunKey(conversationId, requestId);
    
    set((state) => {
      const run = state.runs.get(key);
      if (!run) return state;
      
      const newRuns = new Map(state.runs);
      newRuns.set(key, {
        ...run,
        status: 'aborted',
        completedAt: Date.now(),
      });
      
      return { runs: newRuns };
    });
  },
  
  getRunContent: (conversationId: string, requestId: string) => {
    const key = get().getRunKey(conversationId, requestId);
    const run = get().runs.get(key);
    return run?.content ?? '';
  },
  
  getActiveRunForConversation: (conversationId: string) => {
    const state = get();
    const runKeys = state.runsByConversation.get(conversationId);
    if (!runKeys) return undefined;
    
    const keysArray = Array.from(runKeys);
    for (const key of keysArray) {
      const run = state.runs.get(key);
      if (run && ['started', 'streaming', 'reconnecting'].includes(run.status)) {
        return run;
      }
    }
    
    return undefined;
  },
  
  getStreamingContentForConversation: (conversationId: string) => {
    const activeRun = get().getActiveRunForConversation(conversationId);
    return activeRun?.content ?? '';
  },
  
  setActiveChatId: (chatId: string | null) => {
    set({ activeChatId: chatId });
    
    if (chatId) {
      set((state) => {
        const newBadges = new Map(state.pendingBadges);
        newBadges.delete(chatId);
        return { pendingBadges: newBadges };
      });
    }
  },
  
  clearBadge: (conversationId: string) => {
    set((state) => {
      const newBadges = new Map(state.pendingBadges);
      newBadges.delete(conversationId);
      return { pendingBadges: newBadges };
    });
  },
  
  clearAllBadges: () => {
    set({ pendingBadges: new Map() });
  },
  
  cleanup: (olderThanMs = 3600000) => {
    const now = Date.now();
    
    set((state) => {
      const newRuns = new Map(state.runs);
      const newRunsByConv = new Map(state.runsByConversation);
      
      const entries = Array.from(state.runs.entries());
      for (const [key, run] of entries) {
        const isOld = run.completedAt 
          ? now - run.completedAt > olderThanMs
          : now - run.startedAt > olderThanMs * 2;
        
        const isTerminal = ['completed', 'failed', 'aborted'].includes(run.status);
        
        if (isOld && isTerminal) {
          newRuns.delete(key);
          
          const convRuns = newRunsByConv.get(run.conversationId);
          if (convRuns) {
            convRuns.delete(key);
            if (convRuns.size === 0) {
              newRunsByConv.delete(run.conversationId);
            }
          }
        }
      }
      
      return {
        runs: newRuns,
        runsByConversation: newRunsByConv,
      };
    });
  },
  
  isProcessing: (conversationId: string) => {
    const activeRun = get().getActiveRunForConversation(conversationId);
    return activeRun !== undefined;
  },
  
  getProcessingConversationIds: () => {
    const state = get();
    const processingIds: string[] = [];
    
    const convIds = Array.from(state.runsByConversation.keys());
    for (const conversationId of convIds) {
      if (state.isProcessing(conversationId)) {
        processingIds.push(conversationId);
      }
    }
    
    return processingIds;
  },
}));


export function useConversationStreamContent(conversationId: string | null | undefined): string {
  return useConversationStreamRouter((state) => {
    if (!conversationId) return '';
    return state.getStreamingContentForConversation(conversationId);
  });
}

export function useConversationIsProcessing(conversationId: string | null | undefined): boolean {
  return useConversationStreamRouter((state) => {
    if (!conversationId) return false;
    return state.isProcessing(conversationId);
  });
}

export function useConversationActiveRun(conversationId: string | null | undefined): StreamRun | undefined {
  return useConversationStreamRouter((state) => {
    if (!conversationId) return undefined;
    return state.getActiveRunForConversation(conversationId);
  });
}

export function useConversationPendingBadges(): Map<string, number> {
  return useConversationStreamRouter(useShallow((state) => state.pendingBadges));
}

export function useProcessingConversationIds(): string[] {
  return useConversationStreamRouter(useShallow((state) => state.getProcessingConversationIds()));
}


export function processStreamEvent(event: StreamEvent): void {
  const router = useConversationStreamRouter.getState();
  
  switch (event.type) {
    case 'response.started':
      router.startRun(event);
      break;
    case 'response.delta':
      router.appendDelta(event);
      break;
    case 'response.completed':
      router.completeRun(event);
      break;
    case 'response.error':
      router.failRun(event);
      break;
  }
}

export function validateStreamEvent(event: unknown): event is StreamEvent {
  if (!event || typeof event !== 'object') return false;
  
  const e = event as any;
  
  if (!e.type || !e.requestId || !e.conversationId) {
    console.error('[StreamRouter] Invalid event: missing required fields', event);
    return false;
  }
  
  switch (e.type) {
    case 'response.started':
      return typeof e.assistantMessageId === 'string' && typeof e.userMessageId === 'string';
    case 'response.delta':
      return typeof e.seq === 'number' && typeof e.textDelta === 'string';
    case 'response.completed':
      return true;
    case 'response.error':
      return typeof e.code === 'string' && typeof e.message === 'string';
    default:
      return false;
  }
}


let cleanupInterval: NodeJS.Timeout | null = null;

export function startStreamRouterCleanup(intervalMs = 300000): void {
  if (cleanupInterval) return;
  
  cleanupInterval = setInterval(() => {
    useConversationStreamRouter.getState().cleanup();
  }, intervalMs);
}

export function stopStreamRouterCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
