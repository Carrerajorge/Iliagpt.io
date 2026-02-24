
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { Message } from '@/types/chat';

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

    // Actions
    resetState: () => void;
}

export const useChatStore = create<ChatState>()(
    devtools(
        (set) => ({
            // Initial State
            messages: [],
            input: '',
            isSidebarOpen: true,
            uiPhase: 'idle',
            activeRunId: null,
            streamingContent: '',
            editingMessageId: null,

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

            resetState: () => set({
                messages: [],
                input: '',
                uiPhase: 'idle',
                activeRunId: null,
                streamingContent: '',
                editingMessageId: null
            })
        }),
        { name: 'ChatStore' }
    )
);
