/**
 * React Query Configuration and API Hooks (#2)
 * Centralized data fetching with caching and mutations
 */

import { QueryClient, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ============================================
// QUERY CLIENT CONFIGURATION
// ============================================

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 1000 * 60 * 5, // 5 minutes
            gcTime: 1000 * 60 * 30,   // 30 minutes (formerly cacheTime)
            retry: 3,
            retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
        },
        mutations: {
            retry: 1,
        },
    },
});

// ============================================
// API BASE
// ============================================

const API_BASE = '/api';

async function apiRequest<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
        credentials: 'include',
        ...options,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Request failed' }));
        throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
}

// ============================================
// QUERY KEYS
// ============================================

export const queryKeys = {
    // Chats
    chats: ['chats'] as const,
    chat: (id: string) => ['chats', id] as const,
    chatMessages: (chatId: string) => ['chats', chatId, 'messages'] as const,

    // Projects
    projects: ['projects'] as const,
    project: (id: string) => ['projects', id] as const,
    projectChats: (projectId: string) => ['projects', projectId, 'chats'] as const,

    // User
    user: ['user'] as const,
    userSettings: ['user', 'settings'] as const,
    userMemories: ['user', 'memories'] as const,

    // Models
    models: ['models'] as const,

    // Search
    search: (query: string) => ['search', query] as const,
};

// ============================================
// CHAT HOOKS
// ============================================

interface Chat {
    id: string;
    title: string;
    projectId?: string;
    model: string;
    createdAt: string;
    updatedAt: string;
}

interface Message {
    id: string;
    chatId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
}

export function useChats() {
    return useQuery({
        queryKey: queryKeys.chats,
        queryFn: () => apiRequest<Chat[]>('/chats'),
    });
}

export function useChat(chatId: string) {
    return useQuery({
        queryKey: queryKeys.chat(chatId),
        queryFn: () => apiRequest<Chat>(`/chats/${chatId}`),
        enabled: !!chatId,
    });
}

export function useChatMessages(chatId: string) {
    return useQuery({
        queryKey: queryKeys.chatMessages(chatId),
        queryFn: () => apiRequest<Message[]>(`/chats/${chatId}/messages`),
        enabled: !!chatId,
    });
}

export function useCreateChat() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: { title?: string; projectId?: string; model?: string }) =>
            apiRequest<Chat>('/chats', {
                method: 'POST',
                body: JSON.stringify(data),
            }),
        onSuccess: (newChat) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.chats });
            // Optimistic update
            queryClient.setQueryData(queryKeys.chat(newChat.id), newChat);
        },
    });
}

export function useUpdateChat() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ chatId, ...data }: { chatId: string; title?: string }) =>
            apiRequest<Chat>(`/chats/${chatId}`, {
                method: 'PATCH',
                body: JSON.stringify(data),
            }),
        onMutate: async ({ chatId, ...updates }) => {
            // Cancel outgoing refetches
            await queryClient.cancelQueries({ queryKey: queryKeys.chat(chatId) });

            // Snapshot previous value
            const previousChat = queryClient.getQueryData<Chat>(queryKeys.chat(chatId));

            // Optimistically update
            if (previousChat) {
                queryClient.setQueryData(queryKeys.chat(chatId), {
                    ...previousChat,
                    ...updates,
                });
            }

            return { previousChat };
        },
        onError: (err, { chatId }, context) => {
            // Rollback on error
            if (context?.previousChat) {
                queryClient.setQueryData(queryKeys.chat(chatId), context.previousChat);
            }
        },
        onSettled: (_, __, { chatId }) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.chats });
        },
    });
}

export function useDeleteChat() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (chatId: string) =>
            apiRequest(`/chats/${chatId}`, { method: 'DELETE' }),
        onMutate: async (chatId) => {
            await queryClient.cancelQueries({ queryKey: queryKeys.chats });

            const previousChats = queryClient.getQueryData<Chat[]>(queryKeys.chats);

            // Optimistically remove
            if (previousChats) {
                queryClient.setQueryData(
                    queryKeys.chats,
                    previousChats.filter(c => c.id !== chatId)
                );
            }

            return { previousChats };
        },
        onError: (err, chatId, context) => {
            if (context?.previousChats) {
                queryClient.setQueryData(queryKeys.chats, context.previousChats);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.chats });
        },
    });
}

// ============================================
// MESSAGE HOOKS
// ============================================

export function useSendMessage() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ chatId, content }: { chatId: string; content: string }) =>
            apiRequest<Message>(`/chats/${chatId}/messages`, {
                method: 'POST',
                body: JSON.stringify({ content }),
            }),
        onMutate: async ({ chatId, content }) => {
            await queryClient.cancelQueries({ queryKey: queryKeys.chatMessages(chatId) });

            const previousMessages = queryClient.getQueryData<Message[]>(
                queryKeys.chatMessages(chatId)
            );

            // Optimistically add user message
            const optimisticMessage: Message = {
                id: `temp-${Date.now()}`,
                chatId,
                role: 'user',
                content,
                timestamp: new Date().toISOString(),
            };

            queryClient.setQueryData(queryKeys.chatMessages(chatId), [
                ...(previousMessages || []),
                optimisticMessage,
            ]);

            return { previousMessages, optimisticMessage };
        },
        onError: (err, { chatId }, context) => {
            if (context?.previousMessages) {
                queryClient.setQueryData(
                    queryKeys.chatMessages(chatId),
                    context.previousMessages
                );
            }
        },
        onSettled: (_, __, { chatId }) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.chatMessages(chatId) });
        },
    });
}

// ============================================
// PROJECT HOOKS
// ============================================

interface Project {
    id: string;
    name: string;
    description?: string;
    systemPrompt?: string;
    createdAt: string;
}

export function useProjects() {
    return useQuery({
        queryKey: queryKeys.projects,
        queryFn: () => apiRequest<Project[]>('/projects'),
    });
}

export function useCreateProject() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: { name: string; description?: string; systemPrompt?: string }) =>
            apiRequest<Project>('/projects', {
                method: 'POST',
                body: JSON.stringify(data),
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.projects });
        },
    });
}

// ============================================
// USER HOOKS
// ============================================

interface User {
    id: number;
    email: string;
    name: string;
    avatar?: string;
    role: string;
}

export function useUser() {
    return useQuery({
        queryKey: queryKeys.user,
        queryFn: () => apiRequest<User>('/user'),
        retry: false,
    });
}

export function useUpdateUser() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: Partial<User>) =>
            apiRequest<User>('/user', {
                method: 'PATCH',
                body: JSON.stringify(data),
            }),
        onSuccess: (updatedUser) => {
            queryClient.setQueryData(queryKeys.user, updatedUser);
        },
    });
}

// ============================================
// SEARCH HOOK WITH DEBOUNCE
// ============================================

export function useSearch(query: string, enabled = true) {
    return useQuery({
        queryKey: queryKeys.search(query),
        queryFn: () => apiRequest<{ chats: Chat[]; messages: Message[] }>(`/search?q=${encodeURIComponent(query)}`),
        enabled: enabled && query.length >= 2,
        staleTime: 1000 * 60, // 1 minute
    });
}

// ============================================
// PREFETCH UTILITIES
// ============================================

export function prefetchChat(chatId: string) {
    return queryClient.prefetchQuery({
        queryKey: queryKeys.chat(chatId),
        queryFn: () => apiRequest<Chat>(`/chats/${chatId}`),
    });
}

export function prefetchChatMessages(chatId: string) {
    return queryClient.prefetchQuery({
        queryKey: queryKeys.chatMessages(chatId),
        queryFn: () => apiRequest<Message[]>(`/chats/${chatId}/messages`),
    });
}
