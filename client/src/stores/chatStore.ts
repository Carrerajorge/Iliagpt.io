
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { Message } from '@/types/chat';

// ─── Tipos de error y conexión ──────────────────────────────────────────

export type ConnectionStatus = 'online' | 'offline' | 'reconnecting';

export interface ChatErrorInfo {
  message: string;
  category?: string;
  timestamp: number;
  attempt?: number;
}

interface ChatState {
    // Messages
    messages: Message[];
    setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
    addMessage: (message: Message) => void;
    updateMessage: (id: string, updates: Partial<Message>) => void;

    // UI State
    input: string;
    setInput: (input: string) => void;
    isSidebarOpen: boolean;
    setSidebarOpen: (isOpen: boolean) => void;
    toggleSidebar: () => void;

    // Agent State
    uiPhase: 'idle' | 'thinking' | 'console' | 'done';
    setUiPhase: (phase: 'idle' | 'thinking' | 'console' | 'done') => void;
    activeRunId: string | null;
    setActiveRunId: (id: string | null) => void;

    // Streaming
    streamingContent: string;
    setStreamingContent: (content: string) => void;

    // Selection/Editing
    editingMessageId: string | null;
    setEditingMessageId: (id: string | null) => void;

    // ══════════════════════════════════════════════
    //  RESILIENCIA - Estado de errores y conexión
    // ══════════════════════════════════════════════

    /** Último error ocurrido (null si no hay) */
    lastError: ChatErrorInfo | null;
    /** Número de errores consecutivos */
    errorCount: number;
    /** Si estamos en proceso de recuperación */
    isRecovering: boolean;
    /** Estado de conexión */
    connectionStatus: ConnectionStatus;
    /** Mensaje que falló para reenviar */
    failedMessage: Message | null;
    /** Auto-reintentar cuando hay errores */
    autoRetryEnabled: boolean;

    /** Registrar un nuevo error */
    setError: (error: ChatErrorInfo | null) => void;
    /** Incrementar contador y marcar recuperación */
    incrementError: (error: ChatErrorInfo) => void;
    /** Limpiar error y resetear contadores */
    clearError: () => void;
    /** Intentar recuperar del último error (reenvía el mensaje fallido) */
    recoverFromError: () => void;
    /** Actualizar estado de conexión */
    setConnectionStatus: (status: ConnectionStatus) => void;
    /** Guardar mensaje que falló para reintento */
    setFailedMessage: (msg: Message | null) => void;
    /** Toggle auto-retry */
    toggleAutoRetry: () => void;
    /** Agregar mensaje optimista (muestra inmediatamente, sincroniza después) */
    addOptimisticMessage: (message: Message) => void;
    /** Remover mensaje optimista si falló */
    removeOptimisticMessage: (id: string) => void;

    // Actions
    resetState: () => void;
}

export const useChatStore = create<ChatState>()(
    devtools(
        (set, get) => ({
            // Initial State
            messages: [],
            input: '',
            isSidebarOpen: true,
            uiPhase: 'idle',
            activeRunId: null,
            streamingContent: '',
            editingMessageId: null,

            // Resilience initial state
            lastError: null,
            errorCount: 0,
            isRecovering: false,
            connectionStatus: navigator.onLine ? 'online' as ConnectionStatus : 'offline' as ConnectionStatus,
            failedMessage: null,
            autoRetryEnabled: true,

            // Setters
            setMessages: (messages) => set((state) => ({
                messages: typeof messages === 'function' ? messages(state.messages) : messages
            })),

            addMessage: (message) => set((state) => ({
                messages: [...state.messages, message]
            })),

            updateMessage: (id, updates) => set((state) => ({
                messages: state.messages.map(m => m.id === id ? { ...m, ...updates } : m)
            })),

            setInput: (input) => set({ input }),

            setSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),

            toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

            setUiPhase: (phase) => set({ uiPhase: phase }),

            setActiveRunId: (id) => set({ activeRunId: id }),

            setStreamingContent: (content) => set({ streamingContent: content }),

            setEditingMessageId: (id) => set({ editingMessageId: id }),

            // ── Resilience actions ──

            setError: (error) => set({ lastError: error }),

            incrementError: (error) => set((state) => ({
                lastError: error,
                errorCount: state.errorCount + 1,
                isRecovering: true,
            })),

            clearError: () => set({
                lastError: null,
                errorCount: 0,
                isRecovering: false,
                failedMessage: null,
            }),

            recoverFromError: () => {
                const state = get();
                if (!state.failedMessage || !state.autoRetryEnabled) return;

                console.log('[ChatStore] Recuperando del error — reenviando mensaje');
                const msgToResend = state.failedMessage;

                set({
                    isRecovering: true,
                    failedMessage: null,
                    errorCount: 0,
                    lastError: null,
                });

                // Re-agregar el mensaje a la lista para reenvío
                // El componente que escucha este cambio debe detectar el estado recovering
                // y re-ejecutar el envío con el mensaje guardado
                get().addMessage(msgToResend);
                get().setFailedMessage(msgToResend); // Guardar de nuevo como referencia
            },

            setConnectionStatus: (status) => set({ connectionStatus: status }),

            setFailedMessage: (msg) => set({ failedMessage: msg }),

            toggleAutoRetry: () => set((state) => ({
                autoRetryEnabled: !state.autoRetryEnabled,
            })),

            addOptimisticMessage: (message) => set((state) => ({
                messages: [...state.messages, { ...message, _optimistic: true }],
            })),

            removeOptimisticMessage: (id) => set((state) => ({
                messages: state.messages.filter(m => m.id !== id),
            })),

            resetState: () => set({
                messages: [],
                input: '',
                uiPhase: 'idle',
                activeRunId: null,
                streamingContent: '',
                editingMessageId: null,
                lastError: null,
                errorCount: 0,
                isRecovering: false,
                failedMessage: null,
                connectionStatus: navigator.onLine ? ('online' as ConnectionStatus) : ('offline' as ConnectionStatus),
            })
        }),
        { name: 'ChatStore' }
    )
);
