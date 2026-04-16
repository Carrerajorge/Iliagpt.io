import { useEffect, useRef, useCallback } from "react";
import { useAgentStore, useAgentRun } from "@/stores/agent-store";
import { pollingManager } from "@/lib/polling-manager";
import { apiFetch } from "@/lib/apiClient";

// Global map of AbortControllers for pending agent start requests
const pendingAgentStartControllers = new Map<string, AbortController>();

export function abortPendingAgentStart(messageId: string): void {
  const controller = pendingAgentStartControllers.get(messageId);
  if (controller) {
    controller.abort();
    pendingAgentStartControllers.delete(messageId);
  }
}

export function useAgentPolling(messageId: string | null) {
  const agentRun = useAgentRun(messageId || "");
  const hasValidMessageId = Boolean(messageId && messageId.length > 0);
  const runId = agentRun?.runId || null;
  const status = agentRun?.status || null;
  
  const lastStartedRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hasValidMessageId || !messageId || !runId) {
      return;
    }
    
    const isActiveStatus = ['starting', 'queued', 'planning', 'running', 'verifying', 'replanning'].includes(status || '');
    
    if (isActiveStatus && runId !== lastStartedRunIdRef.current) {
      lastStartedRunIdRef.current = runId;
      pollingManager.start(messageId, runId);
    }
    
  }, [hasValidMessageId, messageId, runId, status]);

  useEffect(() => {
    return () => {
      if (lastStartedRunIdRef.current) {
        pollingManager.cancel(lastStartedRunIdRef.current);
        lastStartedRunIdRef.current = null;
      }
    };
  }, []);

  return {
    isPolling: runId ? pollingManager.isPolling(runId) : false,
  };
}

export function useStartAgentRun() {
  const { createRun, setRunId, failRun, cancelRun } = useAgentStore();
  
  const startRun = useCallback(async (
    chatId: string,
    userMessage: string,
    messageId: string,
    attachments?: any[]
  ): Promise<{ runId: string; chatId: string } | null> => {
    // Create AbortController for this request
    const abortController = new AbortController();
    pendingAgentStartControllers.set(messageId, abortController);
    
    createRun(chatId, userMessage, messageId);
    
    try {
      let resolvedChatId = chatId;
      
      if (!chatId || chatId.startsWith("pending-") || chatId === "") {
        const chatRes = await apiFetch('/api/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          signal: abortController.signal,
          body: JSON.stringify({
            title: userMessage.substring(0, 50) + (userMessage.length > 50 ? "..." : ""),
            model: "gemini-3-flash-preview",
            provider: "google"
          })
        });
        if (!chatRes.ok) throw new Error('Inicia sesión para usar el modo agente');
        const newChat = await chatRes.json();
        resolvedChatId = newChat.id;
      }
      
      // Check if run was cancelled while waiting for chat creation
      const currentRun = useAgentStore.getState().runs[messageId];
      if (currentRun?.status === 'cancelled') {
        pendingAgentStartControllers.delete(messageId);
        return null;
      }
      
      const runRes = await apiFetch('/api/agent/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: abortController.signal,
        body: JSON.stringify({
          chatId: resolvedChatId,
          message: userMessage,
          attachments
        })
      });
      
      if (!runRes.ok) throw new Error('Error al iniciar el agente');
      const runData = await runRes.json();
      
      // Check again if cancelled while waiting for API response
      const runAfterApi = useAgentStore.getState().runs[messageId];
      if (runAfterApi?.status === 'cancelled') {
        pendingAgentStartControllers.delete(messageId);
        // Attempt to cancel the backend run that was just created
        try {
          await apiFetch(`/api/agent/runs/${runData.id}/cancel`, {
            method: 'POST',
            credentials: 'include'
          });
        } catch {
          // Best effort cancellation
        }
        return null;
      }
      
      setRunId(messageId, runData.id, runData.chatId);
      
      // Verify state is still active after setRunId before starting polling
      const stateAfterSetRunId = useAgentStore.getState().runs[messageId];
      if (stateAfterSetRunId?.status && !['cancelled', 'failed', 'completed'].includes(stateAfterSetRunId.status)) {
        pollingManager.start(messageId, runData.id);
      }
      
      pendingAgentStartControllers.delete(messageId);
      return { runId: runData.id, chatId: runData.chatId };
      
    } catch (error: any) {
      pendingAgentStartControllers.delete(messageId);
      // Handle abort errors gracefully - don't fail the run, it was user-initiated
      if (error.name === 'AbortError') {
        cancelRun(messageId);
        return null;
      }
      failRun(messageId, error.message);
      return null;
    }
  }, [createRun, setRunId, failRun, cancelRun]);
  
  return { startRun };
}

export function useCancelAgentRun() {
  const { cancelRun, stopPolling } = useAgentStore();
  
  const cancel = useCallback(async (messageId: string, runId: string) => {
    pollingManager.cancel(runId);
    stopPolling(messageId);
    
    try {
      await apiFetch(`/api/agent/runs/${runId}/cancel`, {
        method: 'POST',
        credentials: 'include'
      });
      cancelRun(messageId);
      return true;
    } catch (error) {
      console.error('[AgentPolling] Failed to cancel run:', error);
      return false;
    }
  }, [cancelRun, stopPolling]);
  
  return { cancel };
}
