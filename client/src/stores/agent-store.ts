import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { pollingManager } from "@/lib/polling-manager";

export type AgentRunStatus = 'idle' | 'starting' | 'queued' | 'planning' | 'running' | 'verifying' | 'paused' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'replanning';

export interface AgentEvent {
  type: 'action' | 'observation' | 'error' | 'thinking';
  content: any;
  timestamp: number;
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

export interface AgentRunState {
  runId: string | null;
  chatId: string;
  status: AgentRunStatus;
  steps: AgentStep[];
  eventStream: AgentEvent[];
  summary: string | null;
  error: string | null;
  userMessage: string;
  createdAt: number;
}

interface AgentStore {
  runs: Record<string, AgentRunState>;
  activePolling: Set<string>;
  skipHydrationUntil: number;

  getRunByChatId: (chatId: string) => AgentRunState | null;
  getRunByRunId: (runId: string) => AgentRunState | null;

  createRun: (chatId: string, userMessage: string, messageId: string) => void;
  updateRun: (messageId: string, updates: Partial<AgentRunState>) => void;
  setRunId: (messageId: string, runId: string, chatId: string) => void;
  completeRun: (messageId: string, summary: string) => void;
  failRun: (messageId: string, error: string) => void;
  cancelRun: (messageId: string) => void;

  startPolling: (messageId: string) => void;
  stopPolling: (messageId: string) => void;
  isPolling: (messageId: string) => boolean;

  clearRun: (messageId: string) => void;
  clearAllRuns: () => void;
  blockRehydration: () => void;
}

export const useAgentStore = create<AgentStore>()(
  persist(
    (set, get) => ({
      runs: {},
      activePolling: new Set(),
      skipHydrationUntil: 0,

      getRunByChatId: (chatId: string) => {
        const runs = Object.values(get().runs);
        return runs.find(r => r.chatId === chatId && ['starting', 'queued', 'planning', 'running'].includes(r.status)) || null;
      },

      getRunByRunId: (runId: string) => {
        const runs = Object.values(get().runs);
        return runs.find(r => r.runId === runId) || null;
      },

      createRun: (chatId: string, userMessage: string, messageId: string) => {
        set(state => ({
          runs: {
            ...state.runs,
            [messageId]: {
              runId: null,
              chatId,
              status: 'starting',
              steps: [],
              eventStream: [],
              summary: null,
              error: null,
              userMessage,
              createdAt: Date.now()
            }
          }
        }));
      },

      updateRun: (messageId: string, updates: Partial<AgentRunState>) => {
        set(state => {
          const existing = state.runs[messageId];
          if (!existing) return state;
          return {
            runs: {
              ...state.runs,
              [messageId]: { ...existing, ...updates }
            }
          };
        });
      },

      setRunId: (messageId: string, runId: string, chatId: string) => {
        set(state => {
          const existing = state.runs[messageId];
          if (!existing) return state;
          // Don't overwrite terminal states (cancelled, failed, completed)
          if (['cancelled', 'failed', 'completed'].includes(existing.status)) {
            return state;
          }
          return {
            runs: {
              ...state.runs,
              [messageId]: { ...existing, runId, chatId, status: 'running' }
            }
          };
        });
      },

      completeRun: (messageId: string, summary: string) => {
        set(state => {
          const existing = state.runs[messageId];
          if (!existing) return state;
          return {
            runs: {
              ...state.runs,
              [messageId]: { ...existing, status: 'completed', summary }
            },
            activePolling: new Set(Array.from(state.activePolling).filter(id => id !== messageId))
          };
        });
      },

      failRun: (messageId: string, error: string) => {
        set(state => {
          const existing = state.runs[messageId];
          if (!existing) return state;
          return {
            runs: {
              ...state.runs,
              [messageId]: { ...existing, status: 'failed', error }
            },
            activePolling: new Set(Array.from(state.activePolling).filter(id => id !== messageId))
          };
        });
      },

      cancelRun: (messageId: string) => {
        set(state => {
          const existing = state.runs[messageId];
          if (!existing) return state;
          return {
            runs: {
              ...state.runs,
              [messageId]: { ...existing, status: 'cancelled' }
            },
            activePolling: new Set(Array.from(state.activePolling).filter(id => id !== messageId))
          };
        });
      },

      startPolling: (messageId: string) => {
        set(state => ({
          activePolling: new Set([...Array.from(state.activePolling), messageId])
        }));
      },

      stopPolling: (messageId: string) => {
        set(state => ({
          activePolling: new Set(Array.from(state.activePolling).filter(id => id !== messageId))
        }));
      },

      isPolling: (messageId: string) => {
        return get().activePolling.has(messageId);
      },

      clearRun: (messageId: string) => {
        set(state => {
          const { [messageId]: removed, ...rest } = state.runs;
          return {
            runs: rest,
            activePolling: new Set(Array.from(state.activePolling).filter(id => id !== messageId))
          };
        });
      },

      clearAllRuns: () => {
        set({ runs: {}, activePolling: new Set(), skipHydrationUntil: Date.now() + 5000 });
      },

      blockRehydration: () => {
        set({ skipHydrationUntil: Date.now() + 5000 });
      }
    }),
    {
      name: 'sira-agent-runs',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ runs: state.runs, skipHydrationUntil: state.skipHydrationUntil }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.activePolling = new Set();

          if (Date.now() < state.skipHydrationUntil) {
            state.runs = {};
            state.skipHydrationUntil = 0;
            return;
          }

          setTimeout(() => {
            const currentState = useAgentStore.getState();
            if (Date.now() < currentState.skipHydrationUntil) {
              return;
            }

            Object.entries(state.runs).forEach(([messageId, run]) => {
              if (run.runId && ['starting', 'queued', 'planning', 'running'].includes(run.status)) {
                pollingManager.handleHydratedRun(messageId, run.runId, run.status);
              }
            });
          }, 0);
        }
      }
    }
  )
);

export const useAgentRun = (messageId: string) => {
  return useAgentStore(state => state.runs[messageId] || null);
};
