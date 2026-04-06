import { useState, useCallback, useRef, useEffect } from "react";
import { apiFetch } from "@/lib/apiClient";
import {
  ClientMessage,
  MessageStatus,
  SendMessageRequest,
  SendMessageResponse,
  MessageAttachment,
  generateClientMessageId,
  saveDraft,
  loadDraft,
  clearDraft,
  getNextRetryDelay,
  canRetry,
  createPendingMessage,
} from "@shared/messageLifecycle";

interface UseSendMessageOptions {
  conversationId: string | null;
  onMessageAccepted?: (data: SendMessageResponse) => void;
  onMessageFailed?: (error: Error, message: ClientMessage) => void;
  onNavigateToConversation?: (conversationId: string) => void;
}

interface UseSendMessageReturn {
  sendMessage: (text: string, attachments?: MessageAttachment[]) => Promise<void>;
  retryMessage: (clientMessageId: string) => Promise<void>;
  cancelMessage: (clientMessageId: string) => void;
  pendingMessage: ClientMessage | null;
  isSending: boolean;
  error: string | null;
  clearError: () => void;
  draftText: string;
  setDraftText: (text: string) => void;
  loadDraftForConversation: () => string | null;
}

export function useSendMessage(options: UseSendMessageOptions): UseSendMessageReturn {
  const { conversationId, onMessageAccepted, onMessageFailed, onNavigateToConversation } = options;
  
  const [pendingMessage, setPendingMessage] = useState<ClientMessage | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftText, setDraftText] = useState<string>("");
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const updateMessageStatus = useCallback((clientMessageId: string, updates: Partial<ClientMessage>) => {
    setPendingMessage(prev => {
      if (!prev || prev.clientMessageId !== clientMessageId) return prev;
      return { ...prev, ...updates };
    });
  }, []);

  const executeSend = useCallback(async (
    message: ClientMessage,
    isRetry: boolean = false
  ): Promise<void> => {
    const { clientMessageId, text, attachments, retryCount } = message;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    const status: MessageStatus = isRetry ? "sending" : "sending";
    updateMessageStatus(clientMessageId, { status });
    setIsSending(true);
    setError(null);

    saveDraft(conversationId, { text, attachments });

    try {
      const request: SendMessageRequest = {
        clientMessageId,
        conversationId,
        text,
        attachments: attachments?.map(a => ({
          id: a.id,
          name: a.name,
          mimeType: a.mimeType,
          size: a.size,
          storagePath: a.storagePath,
        })),
      };

      const response = await apiFetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: abortControllerRef.current.signal,
      });

      const data: SendMessageResponse = await response.json();

      if (!data.accepted) {
        const errorCode = data.error?.code || "UNKNOWN_ERROR";
        const errorMessage = data.error?.message || "No se pudo enviar el mensaje";
        const retryable = data.error?.retryable ?? false;

        updateMessageStatus(clientMessageId, {
          status: retryable ? "failed_retryable" : "failed_terminal",
          errorCode,
          errorMessage,
        });

        if (retryable && canRetry(retryable ? "failed_retryable" : "failed_terminal", retryCount)) {
          const delay = getNextRetryDelay(retryCount);
          updateMessageStatus(clientMessageId, { retryCount: retryCount + 1 });
          
          retryTimeoutRef.current = setTimeout(() => {
            setPendingMessage(prev => prev && executeSend({ ...prev, retryCount: retryCount + 1 }, true));
          }, delay);
          return;
        }

        setError(errorMessage);
        onMessageFailed?.(new Error(errorMessage), message);
        return;
      }

      updateMessageStatus(clientMessageId, {
        status: "accepted",
        serverMessageId: data.serverMessageId,
        streamId: data.streamId,
        conversationId: data.conversationId,
      });

      clearDraft(conversationId);

      if (data.conversationId && data.conversationId !== conversationId) {
        onNavigateToConversation?.(data.conversationId);
      }

      onMessageAccepted?.(data);

    } catch (err: any) {
      if (err.name === "AbortError") {
        updateMessageStatus(clientMessageId, { status: "cancelled" });
        return;
      }

      const errorMessage = err?.message || "Error de conexión";
      updateMessageStatus(clientMessageId, {
        status: "failed_retryable",
        errorCode: "NETWORK_ERROR",
        errorMessage,
      });

      if (canRetry("failed_retryable", retryCount)) {
        const delay = getNextRetryDelay(retryCount);
        updateMessageStatus(clientMessageId, { retryCount: retryCount + 1 });
        
        retryTimeoutRef.current = setTimeout(() => {
          setPendingMessage(prev => prev && executeSend({ ...prev, retryCount: retryCount + 1 }, true));
        }, delay);
        return;
      }

      setError(errorMessage);
      onMessageFailed?.(err, message);
    } finally {
      setIsSending(false);
    }
  }, [conversationId, onMessageAccepted, onMessageFailed, onNavigateToConversation, updateMessageStatus]);

  const sendMessage = useCallback(async (
    text: string,
    attachments: MessageAttachment[] = []
  ): Promise<void> => {
    if (!text.trim() && attachments.length === 0) {
      return;
    }

    const message = createPendingMessage(text.trim(), conversationId, attachments);
    setPendingMessage(message);
    
    await executeSend(message);
  }, [conversationId, executeSend]);

  const retryMessage = useCallback(async (clientMessageId: string): Promise<void> => {
    if (!pendingMessage || pendingMessage.clientMessageId !== clientMessageId) {
      return;
    }

    const retriedMessage: ClientMessage = {
      ...pendingMessage,
      clientMessageId: generateClientMessageId(),
      status: "draft",
      retryCount: 0,
    };

    setPendingMessage(retriedMessage);
    await executeSend(retriedMessage);
  }, [pendingMessage, executeSend]);

  const cancelMessage = useCallback((clientMessageId: string) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }

    setPendingMessage(prev => {
      if (!prev || prev.clientMessageId !== clientMessageId) return prev;
      return { ...prev, status: "cancelled" as MessageStatus };
    });
    setIsSending(false);
  }, []);

  const loadDraftForConversation = useCallback((): string | null => {
    const draft = loadDraft(conversationId);
    if (draft?.text) {
      setDraftText(draft.text);
      return draft.text;
    }
    return null;
  }, [conversationId]);

  const setDraftTextWithSave = useCallback((text: string) => {
    setDraftText(text);
    saveDraft(conversationId, { text });
  }, [conversationId]);

  return {
    sendMessage,
    retryMessage,
    cancelMessage,
    pendingMessage,
    isSending,
    error,
    clearError,
    draftText,
    setDraftText: setDraftTextWithSave,
    loadDraftForConversation,
  };
}
