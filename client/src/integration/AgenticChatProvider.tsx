/**
 * AgenticChatProvider.tsx
 *
 * React Context provider that bridges the new agentic system with the
 * existing Zustand stores (useAgentStore, useStreamingStore).
 *
 * Responsibilities:
 *  - Tracks the active chat ID and per-chat agentic mode preference
 *  - Surfaces live tool calls, agent steps and agent status for the UI
 *  - Exposes background task counts from useBackgroundTasks
 *  - Manages terminal panel open/close state
 *  - Provides sendAgenticMessage and cancelCurrentRun actions
 *  - Persists isAgenticMode and thinkingMode to localStorage per chatId
 *  - Auto-enables agentic mode when the first tool call arrives
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAgentStore } from '@/stores/agent-store';
import { useStreamingStore } from '@/stores/streamingStore';
import { useBackgroundTasks, type BackgroundTask } from '@/hooks/useBackgroundTasks';
import { useAgenticChat, type ToolCall } from '@/hooks/useAgenticChat';
import type { AgentStep } from '@/stores/agent-store';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ThinkingMode = 'fast' | 'balanced' | 'deep' | 'creative';

export type AgentRunStatus =
  | 'idle'
  | 'starting'
  | 'queued'
  | 'planning'
  | 'running'
  | 'verifying'
  | 'paused'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'replanning';

export interface AgenticChatContextType {
  // Current session
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;

  // Agentic state for current chat
  isAgenticMode: boolean;
  toggleAgenticMode: () => void;
  agenticEnabled: boolean; // global feature toggle

  // Tool calls & steps (live)
  activeToolCalls: ToolCall[];
  agentSteps: AgentStep[];
  agentStatus: AgentRunStatus;

  // Background tasks
  backgroundTasks: BackgroundTask[];
  taskCount: number;
  runningTaskCount: number;

  // Terminal
  terminalOpen: boolean;
  setTerminalOpen: (open: boolean) => void;
  activeTerminalSessionId: string | null;

  // UI state
  taskPanelOpen: boolean;
  setTaskPanelOpen: (open: boolean) => void;

  // Actions
  sendAgenticMessage: (text: string, chatId: string, files?: File[]) => Promise<void>;
  cancelCurrentRun: () => void;

  // Streaming
  isStreaming: boolean;
  streamingChatId: string | null;

  // Thinking mode
  thinkingMode: ThinkingMode;
  setThinkingMode: (mode: ThinkingMode) => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const UNSET_SENTINEL: AgenticChatContextType = null as unknown as AgenticChatContextType;

export const AgenticChatContext = createContext<AgenticChatContextType>(UNSET_SENTINEL);

// ─── localStorage helpers ────────────────────────────────────────────────────

const LS_AGENTIC_KEY = (chatId: string) => `agentic_mode_${chatId}`;
const LS_THINKING_KEY = (chatId: string) => `thinking_mode_${chatId}`;
const LS_GLOBAL_AGENTIC = 'agentic_global_enabled';

function readAgenticMode(chatId: string): boolean {
  try {
    return localStorage.getItem(LS_AGENTIC_KEY(chatId)) === 'true';
  } catch {
    return false;
  }
}

function writeAgenticMode(chatId: string, value: boolean): void {
  try {
    localStorage.setItem(LS_AGENTIC_KEY(chatId), String(value));
  } catch {
    // storage not available
  }
}

function readThinkingMode(chatId: string): ThinkingMode {
  try {
    const stored = localStorage.getItem(LS_THINKING_KEY(chatId));
    if (stored === 'fast' || stored === 'balanced' || stored === 'deep' || stored === 'creative') {
      return stored;
    }
  } catch {
    // storage not available
  }
  return 'balanced';
}

function writeThinkingMode(chatId: string, value: ThinkingMode): void {
  try {
    localStorage.setItem(LS_THINKING_KEY(chatId), value);
  } catch {
    // storage not available
  }
}

function readGlobalAgentic(): boolean {
  try {
    const stored = localStorage.getItem(LS_GLOBAL_AGENTIC);
    // Default to true (enabled) if never set
    return stored !== 'false';
  } catch {
    return true;
  }
}

// ─── Provider ────────────────────────────────────────────────────────────────

interface AgenticChatProviderProps {
  children: React.ReactNode;
  chatId?: string;
}

export function AgenticChatProvider({ children, chatId: initialChatId }: AgenticChatProviderProps) {
  // ── Active chat ────────────────────────────────────────────────────────────
  const [activeChatId, setActiveChatIdRaw] = useState<string | null>(initialChatId ?? null);

  const setActiveChatId = useCallback((id: string | null) => {
    setActiveChatIdRaw(id);
  }, []);

  // ── Agentic mode (per chat, persisted) ────────────────────────────────────
  const [isAgenticMode, setIsAgenticModeRaw] = useState<boolean>(() =>
    activeChatId ? readAgenticMode(activeChatId) : false
  );

  // Sync when activeChatId changes
  useEffect(() => {
    if (activeChatId) {
      setIsAgenticModeRaw(readAgenticMode(activeChatId));
    }
  }, [activeChatId]);

  const toggleAgenticMode = useCallback(() => {
    setIsAgenticModeRaw((prev) => {
      const next = !prev;
      if (activeChatId) writeAgenticMode(activeChatId, next);
      return next;
    });
  }, [activeChatId]);

  // ── Global agentic enable flag ─────────────────────────────────────────────
  const [agenticEnabled] = useState<boolean>(readGlobalAgentic);

  // ── Thinking mode (per chat, persisted) ───────────────────────────────────
  const [thinkingMode, setThinkingModeRaw] = useState<ThinkingMode>(() =>
    activeChatId ? readThinkingMode(activeChatId) : 'balanced'
  );

  useEffect(() => {
    if (activeChatId) {
      setThinkingModeRaw(readThinkingMode(activeChatId));
    }
  }, [activeChatId]);

  const setThinkingMode = useCallback(
    (mode: ThinkingMode) => {
      setThinkingModeRaw(mode);
      if (activeChatId) writeThinkingMode(activeChatId, mode);
    },
    [activeChatId]
  );

  // ── Existing Zustand stores ────────────────────────────────────────────────
  const agentStore = useAgentStore();
  const streamingStore = useStreamingStore();

  // Derive current run from agent store
  const currentRun = useMemo(
    () => (activeChatId ? agentStore.getRunByChatId(activeChatId) : null),
    [activeChatId, agentStore]
  );

  const agentStatus: AgentRunStatus = (currentRun?.status as AgentRunStatus) ?? 'idle';
  const agentSteps: AgentStep[] = currentRun?.steps ?? [];

  // Streaming state
  const isStreaming: boolean = activeChatId
    ? (streamingStore as unknown as Record<string, boolean>)[`isStreaming_${activeChatId}`] ?? false
    : false;

  const streamingChatId: string | null = activeChatId && isStreaming ? activeChatId : null;

  // ── Agentic chat hook ──────────────────────────────────────────────────────
  const {
    state: agenticState,
    sendMessage: agenticSendMessage,
  } = useAgenticChat({
    chatId: activeChatId ?? '',
    endpoint: '/api/chat/stream',
  });

  // Active tool calls derived from hook
  const activeToolCalls: ToolCall[] = agenticState.currentToolCall ? [agenticState.currentToolCall] : [];
  const agenticIsStreaming = agenticState.isStreaming;

  // Auto-enable agentic mode when any tool call arrives
  const prevToolCallCountRef = useRef<number>(0);
  useEffect(() => {
    if (activeToolCalls.length > prevToolCallCountRef.current && !isAgenticMode && activeChatId) {
      setIsAgenticModeRaw(true);
      writeAgenticMode(activeChatId, true);
    }
    prevToolCallCountRef.current = activeToolCalls.length;
  }, [activeToolCalls.length, isAgenticMode, activeChatId]);

  // ── Background tasks ───────────────────────────────────────────────────────
  const {
    tasks: backgroundTasks,
    runningCount,
  } = useBackgroundTasks(activeChatId ?? '');
  const taskCount = backgroundTasks.length;
  const runningTaskCount = runningCount;

  // ── Terminal state ─────────────────────────────────────────────────────────
  const [terminalOpen, setTerminalOpen] = useState<boolean>(false);
  const [activeTerminalSessionId, setActiveTerminalSessionId] = useState<string | null>(null);

  // When terminal opens ensure a session id exists
  useEffect(() => {
    if (terminalOpen && !activeTerminalSessionId) {
      setActiveTerminalSessionId(`terminal_${activeChatId ?? 'global'}_${Date.now()}`);
    }
    if (!terminalOpen) {
      setActiveTerminalSessionId(null);
    }
  }, [terminalOpen, activeChatId, activeTerminalSessionId]);

  // ── Task panel ─────────────────────────────────────────────────────────────
  const [taskPanelOpen, setTaskPanelOpen] = useState<boolean>(false);

  // ── sendAgenticMessage ─────────────────────────────────────────────────────
  const sendAgenticMessage = useCallback(
    async (text: string, chatId: string, files?: File[]) => {
      // Ensure active chat is set
      if (chatId !== activeChatId) {
        setActiveChatIdRaw(chatId);
      }

      // Create or update the run in agentStore
      const existingRun = agentStore.getRunByChatId(chatId);
      const runEntry = Object.entries(agentStore.runs).find(([, run]) => run.chatId === chatId);
      const runMessageId = runEntry?.[0] || `agentic-${chatId}-${Date.now()}`;
      if (!existingRun) {
        agentStore.createRun(chatId, text, runMessageId);
      } else {
        agentStore.updateRun(runMessageId, { status: 'starting' });
      }

      try {
        await agenticSendMessage(text, files);
        // On success, mark run as completed if it didn't self-complete
        const run = agentStore.getRunByChatId(chatId);
        if (run && run.status !== 'completed' && run.status !== 'failed') {
          agentStore.completeRun(runMessageId, 'Agentic message completed');
        }
      } catch (err) {
        agentStore.failRun(runMessageId, err instanceof Error ? err.message : 'Unknown error');
        throw err;
      }
    },
    [activeChatId, agenticSendMessage, agentStore]
  );

  // ── cancelCurrentRun ──────────────────────────────────────────────────────
  const cancelCurrentRun = useCallback(() => {
    if (!activeChatId) return;
    streamingStore.abortRun(activeChatId);
    // Update agent store status
    const run = agentStore.getRunByChatId(activeChatId);
    if (run) {
      agentStore.updateRun(activeChatId, { status: 'cancelling' });
    }
  }, [activeChatId, agentStore, streamingStore]);

  // ── Context value ──────────────────────────────────────────────────────────
  const contextValue = useMemo<AgenticChatContextType>(
    () => ({
      activeChatId,
      setActiveChatId,
      isAgenticMode,
      toggleAgenticMode,
      agenticEnabled,
      activeToolCalls,
      agentSteps,
      agentStatus,
      backgroundTasks,
      taskCount,
      runningTaskCount,
      terminalOpen,
      setTerminalOpen,
      activeTerminalSessionId,
      taskPanelOpen,
      setTaskPanelOpen,
      sendAgenticMessage,
      cancelCurrentRun,
      isStreaming: agenticIsStreaming || isStreaming,
      streamingChatId,
      thinkingMode,
      setThinkingMode,
    }),
    [
      activeChatId,
      setActiveChatId,
      isAgenticMode,
      toggleAgenticMode,
      agenticEnabled,
      activeToolCalls,
      agentSteps,
      agentStatus,
      backgroundTasks,
      taskCount,
      runningTaskCount,
      terminalOpen,
      setTerminalOpen,
      activeTerminalSessionId,
      taskPanelOpen,
      setTaskPanelOpen,
      sendAgenticMessage,
      cancelCurrentRun,
      agenticIsStreaming,
      isStreaming,
      streamingChatId,
      thinkingMode,
      setThinkingMode,
    ]
  );

  return (
    <AgenticChatContext.Provider value={contextValue}>
      {children}
    </AgenticChatContext.Provider>
  );
}

// ─── Consumer hook ────────────────────────────────────────────────────────────

/**
 * useAgenticChatContext
 *
 * Must be called inside <AgenticChatProvider>. Throws a descriptive error
 * if used outside the provider tree so the issue is immediately obvious
 * during development.
 */
export function useAgenticChatContext(): AgenticChatContextType {
  const ctx = useContext(AgenticChatContext);
  if (ctx === UNSET_SENTINEL) {
    throw new Error(
      'useAgenticChatContext must be used inside <AgenticChatProvider>. ' +
        'Wrap your app or chat page with <AgenticChatProvider> before using this hook.'
    );
  }
  return ctx;
}
