/**
 * Zustand State Management Store (#1)
 * Centralized state management replacing fragmented hooks
 */

import { create } from 'zustand';
import { devtools, persist, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// ============================================
// TYPES
// ============================================

interface Message {
    id: string;
    chatId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    metadata?: Record<string, any>;
}

interface Chat {
    id: string;
    title: string;
    projectId?: string;
    model: string;
    createdAt: Date;
    updatedAt: Date;
    messageCount: number;
}

interface ChatState {
    // Data
    chats: Map<string, Chat>;
    messages: Map<string, Message[]>;
    activeChat: string | null;

    // UI State
    isLoading: boolean;
    isStreaming: boolean;
    streamingContent: string;
    error: string | null;

    // Actions
    setActiveChat: (chatId: string | null) => void;
    addChat: (chat: Chat) => void;
    updateChat: (chatId: string, updates: Partial<Chat>) => void;
    deleteChat: (chatId: string) => void;
    addMessage: (chatId: string, message: Message) => void;
    updateMessage: (chatId: string, messageId: string, content: string) => void;
    deleteMessage: (chatId: string, messageId: string) => void;
    setStreaming: (isStreaming: boolean, content?: string) => void;
    appendStreamContent: (content: string) => void;
    setError: (error: string | null) => void;
    setLoading: (isLoading: boolean) => void;
    reset: () => void;
}

// ============================================
// CHAT STORE
// ============================================

export const useChatStore = create<ChatState>()(
    devtools(
        subscribeWithSelector(
            immer((set, get) => ({
                // Initial state
                chats: new Map(),
                messages: new Map(),
                activeChat: null,
                isLoading: false,
                isStreaming: false,
                streamingContent: '',
                error: null,

                // Actions
                setActiveChat: (chatId) => set((state) => {
                    state.activeChat = chatId;
                }),

                addChat: (chat) => set((state) => {
                    state.chats.set(chat.id, chat);
                    state.messages.set(chat.id, []);
                }),

                updateChat: (chatId, updates) => set((state) => {
                    const chat = state.chats.get(chatId);
                    if (chat) {
                        state.chats.set(chatId, { ...chat, ...updates, updatedAt: new Date() });
                    }
                }),

                deleteChat: (chatId) => set((state) => {
                    state.chats.delete(chatId);
                    state.messages.delete(chatId);
                    if (state.activeChat === chatId) {
                        state.activeChat = null;
                    }
                }),

                addMessage: (chatId, message) => set((state) => {
                    const messages = state.messages.get(chatId) || [];
                    messages.push(message);
                    state.messages.set(chatId, messages);

                    const chat = state.chats.get(chatId);
                    if (chat) {
                        chat.messageCount = messages.length;
                        chat.updatedAt = new Date();
                    }
                }),

                updateMessage: (chatId, messageId, content) => set((state) => {
                    const messages = state.messages.get(chatId);
                    if (messages) {
                        const message = messages.find(m => m.id === messageId);
                        if (message) {
                            message.content = content;
                        }
                    }
                }),

                deleteMessage: (chatId, messageId) => set((state) => {
                    const messages = state.messages.get(chatId);
                    if (messages) {
                        const index = messages.findIndex(m => m.id === messageId);
                        if (index !== -1) {
                            messages.splice(index, 1);
                        }
                    }
                }),

                setStreaming: (isStreaming, content = '') => set((state) => {
                    state.isStreaming = isStreaming;
                    state.streamingContent = content;
                }),

                appendStreamContent: (content) => set((state) => {
                    state.streamingContent += content;
                }),

                setError: (error) => set((state) => {
                    state.error = error;
                }),

                setLoading: (isLoading) => set((state) => {
                    state.isLoading = isLoading;
                }),

                reset: () => set((state) => {
                    state.chats = new Map();
                    state.messages = new Map();
                    state.activeChat = null;
                    state.isLoading = false;
                    state.isStreaming = false;
                    state.streamingContent = '';
                    state.error = null;
                }),
            }))
        ),
        { name: 'chat-store' }
    )
);

// ============================================
// SETTINGS STORE
// ============================================

interface SettingsState {
    theme: 'light' | 'dark' | 'system';
    language: string;
    model: string;
    temperature: number;
    maxTokens: number;
    streamingEnabled: boolean;
    soundEnabled: boolean;
    notificationsEnabled: boolean;
    compactMode: boolean;

    setTheme: (theme: 'light' | 'dark' | 'system') => void;
    setLanguage: (language: string) => void;
    setModel: (model: string) => void;
    setTemperature: (temperature: number) => void;
    setMaxTokens: (maxTokens: number) => void;
    toggleStreaming: () => void;
    toggleSound: () => void;
    toggleNotifications: () => void;
    toggleCompactMode: () => void;
    resetSettings: () => void;
}

const DEFAULT_SETTINGS = {
    theme: 'system' as const,
    language: 'es',
    model: 'grok-3-fast',
    temperature: 0.7,
    maxTokens: 4096,
    streamingEnabled: true,
    soundEnabled: true,
    notificationsEnabled: true,
    compactMode: false,
};

export const useSettingsStore = create<SettingsState>()(
    devtools(
        persist(
            immer((set) => ({
                ...DEFAULT_SETTINGS,

                setTheme: (theme) => set((state) => { state.theme = theme; }),
                setLanguage: (language) => set((state) => { state.language = language; }),
                setModel: (model) => set((state) => { state.model = model; }),
                setTemperature: (temperature) => set((state) => { state.temperature = temperature; }),
                setMaxTokens: (maxTokens) => set((state) => { state.maxTokens = maxTokens; }),
                toggleStreaming: () => set((state) => { state.streamingEnabled = !state.streamingEnabled; }),
                toggleSound: () => set((state) => { state.soundEnabled = !state.soundEnabled; }),
                toggleNotifications: () => set((state) => { state.notificationsEnabled = !state.notificationsEnabled; }),
                toggleCompactMode: () => set((state) => { state.compactMode = !state.compactMode; }),
                resetSettings: () => set(() => DEFAULT_SETTINGS),
            })),
            { name: 'settings-storage' }
        ),
        { name: 'settings-store' }
    )
);

// ============================================
// UI STORE
// ============================================

interface UIState {
    sidebarOpen: boolean;
    sidebarWidth: number;
    activeModal: string | null;
    modalData: Record<string, any>;
    toasts: Array<{ id: string; type: string; message: string }>;

    toggleSidebar: () => void;
    setSidebarWidth: (width: number) => void;
    openModal: (modalId: string, data?: Record<string, any>) => void;
    closeModal: () => void;
    addToast: (type: string, message: string) => void;
    removeToast: (id: string) => void;
}

export const useUIStore = create<UIState>()(
    devtools(
        immer((set) => ({
            sidebarOpen: true,
            sidebarWidth: 280,
            activeModal: null,
            modalData: {},
            toasts: [],

            toggleSidebar: () => set((state) => { state.sidebarOpen = !state.sidebarOpen; }),
            setSidebarWidth: (width) => set((state) => { state.sidebarWidth = width; }),
            openModal: (modalId, data = {}) => set((state) => {
                state.activeModal = modalId;
                state.modalData = data;
            }),
            closeModal: () => set((state) => {
                state.activeModal = null;
                state.modalData = {};
            }),
            addToast: (type, message) => set((state) => {
                state.toasts.push({ id: crypto.randomUUID(), type, message });
            }),
            removeToast: (id) => set((state) => {
                state.toasts = state.toasts.filter(t => t.id !== id);
            }),
        })),
        { name: 'ui-store' }
    )
);

// ============================================
// SELECTORS
// ============================================

export const selectActiveChat = (state: ChatState) =>
    state.activeChat ? state.chats.get(state.activeChat) : null;

export const selectActiveChatMessages = (state: ChatState) =>
    state.activeChat ? state.messages.get(state.activeChat) || [] : [];

export const selectChatList = (state: ChatState) =>
    Array.from(state.chats.values()).sort((a, b) =>
        b.updatedAt.getTime() - a.updatedAt.getTime()
    );

export const selectIsTyping = (state: ChatState) =>
    state.isStreaming && state.streamingContent.length > 0;
