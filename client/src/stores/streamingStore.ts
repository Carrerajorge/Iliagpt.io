import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';

export type StreamingStatus = 'idle' | 'started' | 'streaming' | 'completed' | 'failed' | 'aborted' | 'stalled' | 'reconnecting';

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
  /** Timestamp del último chunk recibido (para detectar stalling) */
  lastChunkAt?: number;
  /** Contenido acumulado antes del fallo (para recuperación parcial) */
  partialContent?: string;
  /** Número de reintentos de reconexión */
  reconnectAttempts?: number;
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

/** Configuración de monitoreo de salud de streams */
const STREAM_STALL_THRESHOLD_MS = 15_000; // 15s sin chunks = stalled
const MAX_STREAM_RECONNECT_ATTEMPTS = 3;

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

  // ══════════════════════════════════════════
  //  RESILIENCIA DE STREAMS
  // ══════════════════════════════════════════

  /** Marcar un stream como stancado */
  markStalled: (chatId: string) => void;
  /** Intentar reconectar un stream */
  reconnectStream: (chatId: string) => void;
  /** Obtener runs que están stancados */
  getStalledRuns: () => StreamingRun[];
  /** Verificar salud de todos los streams activos */
  checkStreamHealth: () => void;
  /** Limpiar monitoreo */
  destroyHealthMonitor: () => void;
}

// ─── Health Check Timer ──────────────────────────────────────────────

let _healthCheckInterval: ReturnType<typeof setInterval> | null = null;

function startStreamHealthCheck(store: () => StreamingState): void {
  if (_healthCheckInterval) return; // Ya corriendo

  _healthCheckInterval = setInterval(() => {
    try {
      const state = store();
      const now = Date.now();

      state.runs.forEach((run: StreamingRun) => {
        if (!['started', 'streaming', 'reconnecting'].includes(run.status)) return;

        const lastActivity = run.lastChunkAt ?? run.startedAt;
        const idleMs = now - lastActivity;

        if (idleMs > STREAM_STALL_THRESHOLD_MS) {
          console.warn(
            `[StreamingHealth] Stream ${run.runId} stancado por ${Math.round(idleMs / 1000)}s` +
            ` (último chunk hace ${idleMs}ms)`
          );
          store().markStalled(run.chatId);
        }
      });
    } catch (err) {
      console.error('[StreamingHealth] Error en health check:', err);
    }
  }, 5_000); // Cada 5 segundos
}

function stopStreamHealthCheck(): void {
  if (_healthCheckInterval) {
    clearInterval(_healthCheckInterval);
    _healthCheckInterval = null;
  }
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
        lastChunkAt: Date.now(),
        partialContent: '',
        reconnectAttempts: 0,
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
        lastChunkAt: Date.now(), // ← Actualizar timestamp de actividad
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

      // Guardar contenido parcial para posible recuperación
      const partialContent = run.content.length > 0 ? run.content : undefined;

      const newRuns = new Map(state.runs);
      newRuns.set(chatId, {
        ...run,
        status: 'failed',
        completedAt: Date.now(),
        error,
        chatTitle: chatTitle || run.chatTitle,
        partialContent,
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
        partialContent: run.content.length > 0 ? run.content : run.partialContent,
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

  // ══════════════════════════════════════════
  //  Acciones de resiliencia para streams
  // ══════════════════════════════════════════

  markStalled: (chatId: string) => {
    set((state) => {
      const run = state.runs.get(chatId);
      if (!run || !['started', 'streaming', 'reconnecting'].includes(run.status)) return state;

      console.warn(`[StreamingStore] Marcando stream ${chatId} como stancado`);
      const newRuns = new Map(state.runs);
      newRuns.set(chatId, { ...run, status: 'stalled' });
      return { runs: newRuns };
    });
  },

  reconnectStream: (chatId: string) => {
    set((state) => {
      const run = state.runs.get(chatId);
      if (!run) return state;

      const attempts = (run.reconnectAttempts || 0) + 1;
      if (attempts > MAX_STREAM_RECONNECT_ATTEMPTS) {
        console.warn(`[StreamingStore] Máximos intentos de reconexión (${MAX_STREAM_RECONNECT_ATTEMPTS}) para ${chatId}`);
        const newRuns = new Map(state.runs);
        newRuns.set(chatId, { ...run, status: 'failed', reconnectAttempts: attempts });
        return { runs: newRuns };
      }

      console.log(`[StreamingStore] Reconectando stream ${chatId} (intento ${attempts}/${MAX_STREAM_RECONNECT_ATTEMPTS})`);
      const newRuns = new Map(state.runs);
      newRuns.set(chatId, {
        ...run,
        status: 'reconnecting',
        reconnectAttempts: attempts,
        lastChunkAt: Date.now(),
        // Preservar contenido parcial por si la reconexión continúa desde aquí
        partialContent: run.content.length > 0 ? run.content : run.partialContent,
      });
      return { runs: newRuns };
    });
  },

  getStalledRuns: () => {
    const state = get();
    const stalled: StreamingRun[] = [];
    state.runs.forEach((run: StreamingRun) => {
      if (run.status === 'stalled') stalled.push(run);
    });
    return stalled;
  },

  checkStreamHealth: () => {
    const state = get() as StreamingState;
    const now = Date.now();

    state.runs.forEach((run, chatId) => {
      if (!['started', 'streaming', 'reconnecting'].includes(run.status)) return;

      const lastActivity = run.lastChunkAt ?? run.startedAt;
      const idleMs = now - lastActivity;

      if (idleMs > STREAM_STALL_THRESHOLD_MS) {
        get().markStalled(chatId);
      }
    });
  },

  destroyHealthMonitor: () => stopStreamHealthCheck(),
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

// ─── Iniciar health check tras definición del store ──────────────────
// Se usa getState() que está disponible tras create()
startStreamHealthCheck(() => useStreamingStore.getState());
