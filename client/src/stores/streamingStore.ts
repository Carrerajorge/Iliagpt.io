import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';

export type StreamingStatus = 'idle' | 'started' | 'streaming' | 'completed' | 'failed' | 'aborted';

export interface StreamingRun {
  chatId: string;
  chatTitle?: string;
  runId: string;
  requestId?: string;
  status: StreamingStatus;
  content: string;
  lastSeq: number;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export interface BackgroundNotification {
  id: string;
  chatId: string;
  chatTitle: string;
  preview: string;
  type: 'completed' | 'failed';
  timestamp: number;
  dismissed: boolean;
}

interface StreamingState {
  runs: Map<string, StreamingRun>;
  pendingBadges: Record<string, number>;
  notifications: BackgroundNotification[];

  // Run management
  startRun: (chatId: string, runId?: string, requestId?: string, chatTitle?: string) => void;
  updateStatus: (chatId: string, status: StreamingStatus) => void;
  appendContent: (chatId: string, chunk: string, seq: number) => boolean;
  getContent: (chatId: string) => string;
  completeRun: (chatId: string, activeChatId: string | null, chatTitle?: string) => void;
  failRun: (chatId: string, error: string, activeChatId: string | null, chatTitle?: string) => void;
  abortRun: (chatId: string) => void;
  clearRun: (chatId: string) => void;

  // Badge management
  clearBadge: (chatId: string) => void;
  clearAllBadges: () => void;

  // Notification management
  addNotification: (notification: Omit<BackgroundNotification, 'id' | 'timestamp' | 'dismissed'>) => void;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;

  // Queries
  isProcessing: (chatId: string) => boolean;
  getProcessingChatIds: () => string[];
  getRun: (chatId: string) => StreamingRun | undefined;
}

export const useStreamingStore = create<StreamingState>((set, get) => ({
  runs: new Map(),
  pendingBadges: {},
  notifications: [],

  startRun: (chatId: string, runId?: string, requestId?: string, chatTitle?: string) => {
    const id = runId || `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((state) => {
      const newRuns = new Map(state.runs);
      newRuns.set(chatId, {
        chatId,
        chatTitle,
        runId: id,
        requestId,
        status: 'started',
        content: '',
        lastSeq: -1,
        startedAt: Date.now(),
      });
      return { runs: newRuns };
    });
  },

  updateStatus: (chatId: string, status: StreamingStatus) => {
    set((state) => {
      const run = state.runs.get(chatId);
      if (!run) return state;

      const newRuns = new Map(state.runs);
      newRuns.set(chatId, { ...run, status });
      return { runs: newRuns };
    });
  },

  appendContent: (chatId: string, chunk: string, seq: number) => {
    const state = get();
    const run = state.runs.get(chatId);

    // Idempotency: skip if seq already processed
    if (!run || seq <= run.lastSeq) {
      return false;
    }

    set((s) => {
      const currentRun = s.runs.get(chatId);
      if (!currentRun || seq <= currentRun.lastSeq) return s;

      const newRuns = new Map(s.runs);
      newRuns.set(chatId, {
        ...currentRun,
        content: currentRun.content + chunk,
        lastSeq: seq,
        status: 'streaming',
      });
      return { runs: newRuns };
    });
    return true;
  },

  getContent: (chatId: string) => {
    const run = get().runs.get(chatId);
    return run?.content || '';
  },

  completeRun: (chatId: string, activeChatId: string | null, chatTitle?: string) => {
    set((state) => {
      const run = state.runs.get(chatId);
      if (!run) return state;

      const newRuns = new Map(state.runs);
      newRuns.set(chatId, {
        ...run,
        status: 'completed',
        completedAt: Date.now(),
        chatTitle: chatTitle || run.chatTitle,
      });

      const isBackground = chatId !== activeChatId;
      const newBadges = isBackground
        ? { ...state.pendingBadges, [chatId]: (state.pendingBadges[chatId] || 0) + 1 }
        : state.pendingBadges;

      // Add notification if completing in background
      const newNotifications = isBackground
        ? [
          ...state.notifications,
          {
            id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            chatId,
            chatTitle: chatTitle || run.chatTitle || 'Chat',
            preview: run.content.slice(0, 100),
            type: 'completed' as const,
            timestamp: Date.now(),
            dismissed: false,
          },
        ]
        : state.notifications;

      return { runs: newRuns, pendingBadges: newBadges, notifications: newNotifications };
    });
  },

  failRun: (chatId: string, error: string, activeChatId: string | null, chatTitle?: string) => {
    set((state) => {
      const run = state.runs.get(chatId);
      if (!run) return state;

      const newRuns = new Map(state.runs);
      newRuns.set(chatId, {
        ...run,
        status: 'failed',
        completedAt: Date.now(),
        error,
        chatTitle: chatTitle || run.chatTitle,
      });

      const isBackground = chatId !== activeChatId;
      const newBadges = isBackground
        ? { ...state.pendingBadges, [chatId]: (state.pendingBadges[chatId] || 0) + 1 }
        : state.pendingBadges;

      const newNotifications = isBackground
        ? [
          ...state.notifications,
          {
            id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            chatId,
            chatTitle: chatTitle || run.chatTitle || 'Chat',
            preview: `Error: ${error.slice(0, 80)}`,
            type: 'failed' as const,
            timestamp: Date.now(),
            dismissed: false,
          },
        ]
        : state.notifications;

      return { runs: newRuns, pendingBadges: newBadges, notifications: newNotifications };
    });
  },

  abortRun: (chatId: string) => {
    set((state) => {
      const run = state.runs.get(chatId);
      if (!run) return state;

      const newRuns = new Map(state.runs);
      newRuns.set(chatId, {
        ...run,
        status: 'aborted',
        completedAt: Date.now(),
      });

      return { runs: newRuns };
    });
  },

  clearRun: (chatId: string) => {
    set((state) => {
      const newRuns = new Map(state.runs);
      newRuns.delete(chatId);
      return { runs: newRuns };
    });
  },

  clearBadge: (chatId: string) => {
    set((state) => {
      const newBadges = { ...state.pendingBadges };
      delete newBadges[chatId];
      return { pendingBadges: newBadges };
    });
  },

  clearAllBadges: () => {
    set({ pendingBadges: {} });
  },

  addNotification: (notification) => {
    set((state) => ({
      notifications: [
        ...state.notifications,
        {
          ...notification,
          id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          dismissed: false,
        },
      ],
    }));
  },

  dismissNotification: (id: string) => {
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, dismissed: true } : n
      ),
    }));
  },

  clearNotifications: () => {
    set({ notifications: [] });
  },

  isProcessing: (chatId: string) => {
    const run = get().runs.get(chatId);
    return run ? ['started', 'streaming'].includes(run.status) : false;
  },

  getProcessingChatIds: () => {
    const runs = get().runs;
    const processingIds: string[] = [];
    runs.forEach((run, cid) => {
      if (['started', 'streaming'].includes(run.status)) {
        processingIds.push(cid);
      }
    });
    return processingIds;
  },

  getRun: (chatId: string) => {
    return get().runs.get(chatId);
  },
}));

// Selectors
const selectProcessingChatIds = (state: StreamingState): string[] => {
  const ids: string[] = [];
  state.runs.forEach((run, chatId) => {
    if (['started', 'streaming'].includes(run.status)) {
      ids.push(chatId);
    }
  });
  return ids;
};

const selectPendingBadges = (state: StreamingState): Record<string, number> => state.pendingBadges;

const selectNotifications = (state: StreamingState): BackgroundNotification[] =>
  state.notifications.filter((n) => !n.dismissed);

// Hooks
export function useProcessingChatIds(): string[] {
  return useStreamingStore(useShallow(selectProcessingChatIds));
}

export function usePendingBadges(): Record<string, number> {
  return useStreamingStore(useShallow(selectPendingBadges));
}

export function useNotifications(): BackgroundNotification[] {
  return useStreamingStore(useShallow(selectNotifications));
}

export function useChatIsProcessing(chatId: string | null | undefined): boolean {
  return useStreamingStore((state) => {
    if (!chatId) return false;
    const run = state.runs.get(chatId);
    return run ? ['started', 'streaming'].includes(run.status) : false;
  });
}

export function useChatStreamContent(chatId: string | null | undefined): string {
  return useStreamingStore((state) => {
    if (!chatId) return '';
    return state.runs.get(chatId)?.content || '';
  });
}
