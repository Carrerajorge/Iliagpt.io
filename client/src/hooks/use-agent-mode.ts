import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

export type AgentModeStatus = 'idle' | 'queued' | 'planning' | 'running' | 'verifying' | 'paused' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'replanning';

export interface AgentPlanStep {
  index: number;
  toolName: string;
  description: string;
  input: any;
  expectedOutput: string;
}

export interface AgentPlan {
  objective: string;
  steps: AgentPlanStep[];
  estimatedTime: string;
}

export interface AgentStep {
  stepIndex: number;
  toolName: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  output?: any;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface Artifact {
  type: string;
  name: string;
  data: any;
}

export interface AgentRunResponse {
  id: string;
  chatId: string;
  status: AgentModeStatus;
  plan?: AgentPlan;
  steps: AgentStep[];
  artifacts: Artifact[];
  summary?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface AgentModeState {
  runId: string | null;
  status: AgentModeStatus;
  plan: AgentPlan | null;
  steps: AgentStep[];
  artifacts: Artifact[];
  summary: string | null;
  error: string | null;
  progress: { current: number; total: number };
  createdChatId: string | null;
}

const initialState: AgentModeState = {
  runId: null,
  status: 'idle',
  plan: null,
  steps: [],
  artifacts: [],
  summary: null,
  error: null,
  progress: { current: 0, total: 0 },
  createdChatId: null
};

export function useAgentMode(chatId: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [state, setState] = useState<AgentModeState>(initialState);
  const lastMessageRef = useRef<string | null>(null);
  const lastAttachmentsRef = useRef<any[] | undefined>(undefined);
  const initializedForChatRef = useRef<string | null>(null);

  const isPollingActive = ['queued', 'planning', 'running', 'verifying', 'replanning', 'cancelling'].includes(state.status);

  // Fetch active run for the current chat when chatId changes
  const { data: chatRunData } = useQuery<AgentRunResponse | null>({
    queryKey: ['/api/agent/runs/chat', chatId],
    queryFn: async () => {
      if (!chatId || chatId.startsWith("pending-")) return null;
      const res = await fetch(`/api/agent/runs/chat/${chatId}`, {
        credentials: 'include'
      });
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`Failed to fetch chat runs: ${res.status}`);
      }
      return res.json();
    },
    enabled: !!user && !!chatId && !chatId.startsWith("pending-") && !state.runId,
    staleTime: 5000
  });

  // Initialize state from chat run data if we don't have a runId yet
  useEffect(() => {
    if (chatRunData && !state.runId && initializedForChatRef.current !== chatId) {
      initializedForChatRef.current = chatId;
      const completedSteps = chatRunData.steps.filter(s => s.status === 'succeeded' || s.status === 'failed').length;
      const totalSteps = chatRunData.plan?.steps.length || chatRunData.steps.length || 0;

      setState({
        runId: chatRunData.id,
        status: chatRunData.status,
        plan: chatRunData.plan || null,
        steps: chatRunData.steps,
        artifacts: chatRunData.artifacts || [],
        summary: chatRunData.summary || null,
        error: chatRunData.error || null,
        progress: { current: completedSteps, total: totalSteps },
        createdChatId: chatRunData.chatId
      });
    }
  }, [chatRunData, state.runId, chatId]);

  // Reset state when chatId changes
  useEffect(() => {
    if (chatId !== initializedForChatRef.current && state.runId) {
      setState(initialState);
      initializedForChatRef.current = null;
    }
  }, [chatId, state.runId]);

  const { data: runData } = useQuery<AgentRunResponse | null>({
    queryKey: ['/api/agent/runs', state.runId],
    queryFn: async () => {
      if (!state.runId) return null;
      const res = await fetch(`/api/agent/runs/${state.runId}`, {
        credentials: 'include'
      });
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`Failed to fetch run: ${res.status}`);
      }
      return res.json();
    },
    enabled: !!user && !!state.runId && isPollingActive,
    refetchInterval: isPollingActive ? 2000 : false,
    staleTime: 0
  });

  useEffect(() => {
    if (runData) {
      const completedSteps = runData.steps.filter(s => s.status === 'succeeded' || s.status === 'failed').length;
      const totalSteps = runData.plan?.steps.length || runData.steps.length || 0;

      setState(prev => ({
        ...prev,
        status: runData.status,
        plan: runData.plan || null,
        steps: runData.steps,
        artifacts: runData.artifacts || [],
        summary: runData.summary || null,
        error: runData.error || null,
        progress: { current: completedSteps, total: totalSteps }
      }));
    }
  }, [runData]);

  const startRunMutation = useMutation({
    mutationFn: async ({ message, attachments }: { message: string; attachments?: any[] }) => {
      let resolvedChatId = chatId;

      // If chatId is pending or empty, create a new chat first
      if (!chatId || chatId.startsWith("pending-") || chatId === "") {
        const chatRes = await apiRequest('POST', `/api/chats`, {
          title: message.substring(0, 50) + (message.length > 50 ? "..." : ""),
          model: "gemini-3-flash-preview",
          provider: "google"
        });
        const newChat = await chatRes.json();
        resolvedChatId = newChat.id;
      }

      const res = await apiRequest('POST', `/api/agent/runs`, {
        chatId: resolvedChatId,
        message,
        attachments
      });
      return res.json() as Promise<AgentRunResponse>;
    },
    onSuccess: (data) => {
      setState({
        runId: data.id,
        status: data.status,
        plan: data.plan || null,
        steps: data.steps || [],
        artifacts: data.artifacts || [],
        summary: data.summary || null,
        error: data.error || null,
        progress: { current: 0, total: data.plan?.steps.length || 0 },
        createdChatId: data.chatId || null
      });
      queryClient.invalidateQueries({ queryKey: ['/api/agent/runs', data.id] });
    },
    onError: (error: Error) => {
      setState(prev => ({
        ...prev,
        status: 'failed',
        error: error.message
      }));
    }
  });

  const preCancelStatusRef = useRef<AgentModeStatus>('idle');

  const cancelRunMutation = useMutation({
    mutationFn: async () => {
      if (!state.runId) throw new Error('No active run to cancel');
      preCancelStatusRef.current = state.status;
      setState(prev => ({ ...prev, status: 'cancelling' }));
      await apiRequest('POST', `/api/agent/runs/${state.runId}/cancel`);
    },
    onSuccess: () => {
      setState(prev => ({
        ...prev,
        status: 'cancelled'
      }));
      if (state.runId) {
        queryClient.invalidateQueries({ queryKey: ['/api/agent/runs', state.runId] });
      }
    },
    onError: (error: Error) => {
      console.error('Failed to cancel run:', error);
      setState(prev => ({
        ...prev,
        status: prev.status === 'cancelling' ? preCancelStatusRef.current : prev.status
      }));
    }
  });

  const pauseRunMutation = useMutation({
    mutationFn: async () => {
      if (!state.runId) throw new Error('No active run to pause');
      await apiRequest('POST', `/api/agent/runs/${state.runId}/pause`);
    },
    onSuccess: () => {
      setState(prev => ({
        ...prev,
        status: 'paused'
      }));
      if (state.runId) {
        queryClient.invalidateQueries({ queryKey: ['/api/agent/runs', state.runId] });
      }
    },
    onError: (error: Error) => {
      console.error('Failed to pause run:', error);
    }
  });

  const resumeRunMutation = useMutation({
    mutationFn: async () => {
      if (!state.runId) throw new Error('No paused run to resume');
      await apiRequest('POST', `/api/agent/runs/${state.runId}/resume`);
    },
    onSuccess: () => {
      setState(prev => ({
        ...prev,
        status: 'running'
      }));
      if (state.runId) {
        queryClient.invalidateQueries({ queryKey: ['/api/agent/runs', state.runId] });
      }
    },
    onError: (error: Error) => {
      console.error('Failed to resume run:', error);
    }
  });

  const retryRunMutation = useMutation({
    mutationFn: async () => {
      if (!lastMessageRef.current) throw new Error('No previous message to retry');

      let resolvedChatId = chatId;
      if (!chatId || chatId.startsWith("pending-") || chatId === "") {
        const chatRes = await apiRequest('POST', `/api/chats`, {
          title: lastMessageRef.current.substring(0, 50) + (lastMessageRef.current.length > 50 ? "..." : ""),
          model: "gemini-3-flash-preview",
          provider: "google"
        });
        const newChat = await chatRes.json();
        resolvedChatId = newChat.id;
      }

      const res = await apiRequest('POST', `/api/agent/runs`, {
        chatId: resolvedChatId,
        message: lastMessageRef.current,
        attachments: lastAttachmentsRef.current
      });
      return res.json() as Promise<AgentRunResponse>;
    },
    onSuccess: (data) => {
      setState({
        runId: data.id,
        status: data.status,
        plan: data.plan || null,
        steps: data.steps || [],
        artifacts: data.artifacts || [],
        summary: data.summary || null,
        error: data.error || null,
        progress: { current: 0, total: data.plan?.steps.length || 0 },
        createdChatId: data.chatId || null
      });
      queryClient.invalidateQueries({ queryKey: ['/api/agent/runs', data.id] });
    },
    onError: (error: Error) => {
      setState(prev => ({
        ...prev,
        status: 'failed',
        error: error.message
      }));
    }
  });

  const startRun = useCallback(async (message: string, attachments?: any[]): Promise<{ runId: string; chatId: string }> => {
    lastMessageRef.current = message;
    lastAttachmentsRef.current = attachments;

    const result = await startRunMutation.mutateAsync({ message, attachments });
    return { runId: result.id, chatId: result.chatId };
  }, [startRunMutation]);

  const cancelRun = useCallback(async (): Promise<void> => {
    await cancelRunMutation.mutateAsync();
  }, [cancelRunMutation]);

  const pauseRun = useCallback(async (): Promise<void> => {
    await pauseRunMutation.mutateAsync();
  }, [pauseRunMutation]);

  const resumeRun = useCallback(async (): Promise<void> => {
    await resumeRunMutation.mutateAsync();
  }, [resumeRunMutation]);

  const retryRun = useCallback(async (): Promise<void> => {
    await retryRunMutation.mutateAsync();
  }, [retryRunMutation]);

  const isRunning = ['queued', 'planning', 'running', 'verifying', 'replanning'].includes(state.status);
  const isCancellable = ['queued', 'planning', 'running', 'verifying', 'paused', 'replanning'].includes(state.status);

  const reset = useCallback(() => {
    setState(initialState);
    initializedForChatRef.current = null;
  }, []);

  return {
    runId: state.runId,
    status: state.status,
    plan: state.plan,
    steps: state.steps,
    artifacts: state.artifacts,
    summary: state.summary,
    error: state.error,
    progress: state.progress,
    createdChatId: state.createdChatId,
    startRun,
    cancelRun,
    pauseRun,
    resumeRun,
    retryRun,
    reset,
    isRunning,
    isCancellable
  };
}
