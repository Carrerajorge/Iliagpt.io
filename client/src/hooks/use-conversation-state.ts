import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { HydratedConversationState } from "@shared/schema";
import { apiFetch } from "@/lib/apiClient";

export interface AddMessagePayload {
  role: "user" | "assistant" | "system";
  content: string;
  chatMessageId?: string;
  tokenCount?: number;
  attachmentIds?: string[];
  imageIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface AddArtifactPayload {
  artifactType: string;
  mimeType: string;
  storageUrl: string;
  fileName?: string;
  fileSize?: number;
  messageId?: string;
  extractedText?: string;
  metadata?: Record<string, unknown>;
}

export interface AddImagePayload {
  prompt: string;
  imageUrl: string;
  model: string;
  mode?: "generate" | "edit_last" | "edit_specific";
  messageId?: string;
  parentImageId?: string;
  thumbnailUrl?: string;
  base64Preview?: string;
  width?: number;
  height?: number;
}

export interface UpdateContextPayload {
  summary?: string;
  entities?: Array<{
    name: string;
    type: string;
    mentions?: number;
    lastMentioned?: string;
  }>;
  userPreferences?: Record<string, unknown>;
  topics?: string[];
  sentiment?: "positive" | "negative" | "neutral";
}

async function fetchConversationState(chatId: string): Promise<HydratedConversationState | null> {
  const response = await apiFetch(`/api/memory/chats/${chatId}/state`, {
    credentials: "include",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch conversation state: ${response.status}`);
  }

  return response.json();
}

async function createConversationState(chatId: string): Promise<HydratedConversationState> {
  const response = await apiFetch(`/api/memory/chats/${chatId}/state`, {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Failed to create conversation state: ${response.status}`);
  }

  return response.json();
}

async function addMessage(chatId: string, payload: AddMessagePayload): Promise<HydratedConversationState> {
  const response = await apiFetch(`/api/memory/chats/${chatId}/state/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed to add message: ${response.status}`);
  }

  return response.json();
}

async function addArtifact(chatId: string, payload: AddArtifactPayload): Promise<HydratedConversationState> {
  const response = await apiFetch(`/api/memory/chats/${chatId}/state/artifacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed to add artifact: ${response.status}`);
  }

  return response.json();
}

async function addImage(chatId: string, payload: AddImagePayload): Promise<HydratedConversationState> {
  const response = await apiFetch(`/api/memory/chats/${chatId}/state/images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed to add image: ${response.status}`);
  }

  return response.json();
}

async function updateContext(chatId: string, payload: UpdateContextPayload): Promise<HydratedConversationState> {
  const response = await apiFetch(`/api/memory/chats/${chatId}/state/context`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed to update context: ${response.status}`);
  }

  return response.json();
}

async function createSnapshot(chatId: string, description?: string): Promise<{ version: number; chatId: string }> {
  const response = await apiFetch(`/api/memory/chats/${chatId}/state/snapshot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ description }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create snapshot: ${response.status}`);
  }

  return response.json();
}

async function getLatestImage(chatId: string): Promise<{
  id: string;
  imageUrl: string;
  base64Preview: string | null;
  prompt: string;
} | null> {
  const response = await apiFetch(`/api/memory/chats/${chatId}/state/latest-image`, {
    credentials: "include",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to get latest image: ${response.status}`);
  }

  return response.json();
}

export function useConversationState(chatId: string | null | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["conversationState", chatId];

  const isRealChatId = !!chatId && !chatId.startsWith("pending-") && !chatId.startsWith("new-chat-");

  const {
    data: state,
    isLoading: rawIsLoading,
    error,
    refetch,
  } = useQuery<HydratedConversationState | null>({
    queryKey,
    queryFn: () => (chatId ? fetchConversationState(chatId) : Promise.resolve(null)),
    enabled: isRealChatId,
    staleTime: 1000 * 60 * 2,
    retry: 1,
  });

  const isLoading = isRealChatId ? rawIsLoading : false;

  const addMessageMutation = useMutation({
    mutationFn: (payload: AddMessagePayload) => {
      if (!chatId) throw new Error("No chatId provided");
      return addMessage(chatId, payload);
    },
    onSuccess: (newState) => {
      queryClient.setQueryData(queryKey, newState);
    },
  });

  const addArtifactMutation = useMutation({
    mutationFn: (payload: AddArtifactPayload) => {
      if (!chatId) throw new Error("No chatId provided");
      return addArtifact(chatId, payload);
    },
    onSuccess: (newState) => {
      queryClient.setQueryData(queryKey, newState);
    },
  });

  const addImageMutation = useMutation({
    mutationFn: (payload: AddImagePayload) => {
      if (!chatId) throw new Error("No chatId provided");
      return addImage(chatId, payload);
    },
    onSuccess: (newState) => {
      queryClient.setQueryData(queryKey, newState);
    },
  });

  const updateContextMutation = useMutation({
    mutationFn: (payload: UpdateContextPayload) => {
      if (!chatId) throw new Error("No chatId provided");
      return updateContext(chatId, payload);
    },
    onSuccess: (newState) => {
      queryClient.setQueryData(queryKey, newState);
    },
  });

  const createSnapshotMutation = useMutation({
    mutationFn: (description?: string) => {
      if (!chatId) throw new Error("No chatId provided");
      return createSnapshot(chatId, description);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const refreshState = useCallback(() => {
    if (chatId) {
      return refetch();
    }
  }, [chatId, refetch]);

  const initializeState = useCallback(async () => {
    if (!chatId) return null;
    const newState = await createConversationState(chatId);
    queryClient.setQueryData(queryKey, newState);
    return newState;
  }, [chatId, queryClient, queryKey]);

  const getLatestImageForChat = useCallback(async () => {
    if (!chatId) return null;
    return getLatestImage(chatId);
  }, [chatId]);

  return {
    state,
    isLoading,
    error: error as Error | null,
    refreshState,
    initializeState,
    addMessage: addMessageMutation.mutateAsync,
    addArtifact: addArtifactMutation.mutateAsync,
    addImage: addImageMutation.mutateAsync,
    updateContext: updateContextMutation.mutateAsync,
    createSnapshot: createSnapshotMutation.mutateAsync,
    getLatestImage: getLatestImageForChat,
    isAddingMessage: addMessageMutation.isPending,
    isAddingArtifact: addArtifactMutation.isPending,
    isAddingImage: addImageMutation.isPending,
  };
}

export function useConversationStateActions() {
  const queryClient = useQueryClient();

  const invalidateState = useCallback((chatId: string) => {
    queryClient.invalidateQueries({ queryKey: ["conversationState", chatId] });
  }, [queryClient]);

  const prefetchState = useCallback(async (chatId: string) => {
    await queryClient.prefetchQuery({
      queryKey: ["conversationState", chatId],
      queryFn: () => fetchConversationState(chatId),
      staleTime: 1000 * 60 * 2,
    });
  }, [queryClient]);

  return {
    invalidateState,
    prefetchState,
  };
}
