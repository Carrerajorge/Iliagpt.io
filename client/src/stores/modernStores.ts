/**
 * Enhanced State Management Store
 * 
 * Zustand-based modular stores for:
 * - Chat state
 * - UI state
 * - Settings
 * 
 * Replaces the monolithic use-chats hook pattern.
 */

import { create } from 'zustand';
import { persist, devtools, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// ============================================================================
// Types
// ============================================================================

export interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    requestId?: string;
    isStreaming?: boolean;
    error?: string;
    confidence?: 'high' | 'medium' | 'low';
    uncertaintyReason?: string;
}

export interface Chat {
    id: string;
    title: string;
    timestamp: number;
    messages: Message[];
    archived?: boolean;
    pinned?: boolean;
    projectId?: string;
}

// ============================================================================
// Chat Store
// ============================================================================

interface ChatState {
    chats: Map<string, Chat>;
    activeChatId: string | null;
    isLoading: boolean;
    error: string | null;

    // Actions
    setActiveChat: (chatId: string | null) => void;
    addChat: (chat: Chat) => void;
    updateChat: (chatId: string, updates: Partial<Chat>) => void;
    deleteChat: (chatId: string) => void;
    addMessage: (chatId: string, message: Message) => void;
    updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
    clearError: () => void;
}

export const useChatStore = create<ChatState>()(
    devtools(
        subscribeWithSelector((set, get) => ({
            chats: new Map(),
            activeChatId: null,
            isLoading: false,
            error: null,

            setActiveChat: (chatId) => set({ activeChatId: chatId }),

            addChat: (chat) => set((state) => {
                const newChats = new Map(state.chats);
                newChats.set(chat.id, chat);
                return { chats: newChats };
            }),

            updateChat: (chatId, updates) => set((state) => {
                const chat = state.chats.get(chatId);
                if (!chat) return state;

                const newChats = new Map(state.chats);
                newChats.set(chatId, { ...chat, ...updates });
                return { chats: newChats };
            }),

            deleteChat: (chatId) => set((state) => {
                const newChats = new Map(state.chats);
                newChats.delete(chatId);
                return {
                    chats: newChats,
                    activeChatId: state.activeChatId === chatId ? null : state.activeChatId,
                };
            }),

            addMessage: (chatId, message) => set((state) => {
                const chat = state.chats.get(chatId);
                if (!chat) return state;

                const newChats = new Map(state.chats);
                newChats.set(chatId, {
                    ...chat,
                    messages: [...chat.messages, message],
                });
                return { chats: newChats };
            }),

            updateMessage: (chatId, messageId, updates) => set((state) => {
                const chat = state.chats.get(chatId);
                if (!chat) return state;

                const newChats = new Map(state.chats);
                newChats.set(chatId, {
                    ...chat,
                    messages: chat.messages.map(m =>
                        m.id === messageId ? { ...m, ...updates } : m
                    ),
                });
                return { chats: newChats };
            }),

            clearError: () => set({ error: null }),
        })),
        { name: 'chat-store' }
    )
);

// ============================================================================
// UI Store
// ============================================================================

interface UIState {
    sidebarOpen: boolean;
    searchOpen: boolean;
    commandPaletteOpen: boolean;
    settingsOpen: boolean;
    theme: 'light' | 'dark' | 'system';

    // Actions
    toggleSidebar: () => void;
    setSidebarOpen: (open: boolean) => void;
    setSearchOpen: (open: boolean) => void;
    setCommandPaletteOpen: (open: boolean) => void;
    setSettingsOpen: (open: boolean) => void;
    setTheme: (theme: 'light' | 'dark' | 'system') => void;
    closeAllModals: () => void;
}

export const useUIStore = create<UIState>()(
    persist(
        devtools((set) => ({
            sidebarOpen: true,
            searchOpen: false,
            commandPaletteOpen: false,
            settingsOpen: false,
            theme: 'system',

            toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
            setSidebarOpen: (open) => set({ sidebarOpen: open }),
            setSearchOpen: (open) => set({ searchOpen: open }),
            setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
            setSettingsOpen: (open) => set({ settingsOpen: open }),
            setTheme: (theme) => set({ theme }),
            closeAllModals: () => set({
                searchOpen: false,
                commandPaletteOpen: false,
                settingsOpen: false,
            }),
        })),
        {
            name: 'ui-preferences',
            partialize: (state) => ({ theme: state.theme, sidebarOpen: state.sidebarOpen }),
        }
    )
);

// ============================================================================
// Sync Status Store
// ============================================================================

type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

interface SyncState {
    status: SyncStatus;
    lastSyncedAt: Date | null;
    pendingChanges: number;
    error: string | null;

    // Actions
    setStatus: (status: SyncStatus) => void;
    setSynced: () => void;
    incrementPending: () => void;
    decrementPending: () => void;
    setError: (error: string) => void;
}

export const useSyncStore = create<SyncState>()(
    devtools((set) => ({
        status: 'idle',
        lastSyncedAt: null,
        pendingChanges: 0,
        error: null,

        setStatus: (status) => set({ status, error: status !== 'error' ? null : undefined }),

        setSynced: () => set({
            status: 'idle',
            lastSyncedAt: new Date(),
            pendingChanges: 0,
            error: null,
        }),

        incrementPending: () => set((state) => ({
            pendingChanges: state.pendingChanges + 1,
            status: 'syncing',
        })),

        decrementPending: () => set((state) => ({
            pendingChanges: Math.max(0, state.pendingChanges - 1),
            status: state.pendingChanges <= 1 ? 'idle' : 'syncing',
        })),

        setError: (error) => set({ status: 'error', error }),
    }))
);

// ============================================================================
// Selectors
// ============================================================================

// Get active chat
export const selectActiveChat = (state: ChatState) =>
    state.activeChatId ? state.chats.get(state.activeChatId) : null;

// Get all chats sorted by timestamp
export const selectSortedChats = (state: ChatState) =>
    Array.from(state.chats.values()).sort((a, b) => b.timestamp - a.timestamp);

// Get pinned chats
export const selectPinnedChats = (state: ChatState) =>
    Array.from(state.chats.values())
        .filter(c => c.pinned)
        .sort((a, b) => b.timestamp - a.timestamp);
