import { create } from "zustand";
import type {
  SuperAgentState,
  SuperAgentPhase,
  SuperAgentSource,
  SuperAgentArtifact,
  SuperAgentContract,
  SuperAgentVerify,
  SuperAgentFinal,
  SuperAgentProgress,
  SuperAgentToolCall,
  SuperAgentToolResult,
} from "@/hooks/use-super-agent";

const createInitialState = (): SuperAgentState => ({
  sessionId: null,
  runId: null,
  isRunning: false,
  phase: "idle",
  contract: null,
  sources: [],
  sourcesTarget: 100,
  artifacts: [],
  toolCalls: [],
  toolResults: [],
  verify: null,
  final: null,
  error: null,
  iteration: 0,
  progress: null,
  thoughts: [],
  narration: "",
});

interface SuperAgentStore {
  runs: Record<string, SuperAgentState>;
  
  getRunByMessageId: (messageId: string) => SuperAgentState | null;
  
  startRun: (messageId: string, sourcesTarget?: number) => void;
  updateState: (messageId: string, updates: Partial<SuperAgentState>) => void;
  setContract: (messageId: string, contract: SuperAgentContract) => void;
  addSource: (messageId: string, source: SuperAgentSource) => void;
  updateSource: (messageId: string, sourceId: string, updates: Partial<SuperAgentSource>) => void;
  addArtifact: (messageId: string, artifact: SuperAgentArtifact) => void;
  addToolCall: (messageId: string, toolCall: SuperAgentToolCall) => void;
  addToolResult: (messageId: string, toolResult: SuperAgentToolResult) => void;
  setProgress: (messageId: string, progress: SuperAgentProgress) => void;
  setVerify: (messageId: string, verify: SuperAgentVerify) => void;
  completeRun: (messageId: string, final: SuperAgentFinal) => void;
  failRun: (messageId: string, error: string) => void;
  cancelRun: (messageId: string) => void;
  clearRun: (messageId: string) => void;
  clearAllRuns: () => void;
}

export const useSuperAgentStore = create<SuperAgentStore>()((set, get) => ({
  runs: {},
  
  getRunByMessageId: (messageId: string) => {
    return get().runs[messageId] || null;
  },
  
  startRun: (messageId: string, sourcesTarget: number = 100) => {
    set(state => ({
      runs: {
        ...state.runs,
        [messageId]: {
          ...createInitialState(),
          isRunning: true,
          phase: "planning",
          sourcesTarget,
        },
      },
    }));
  },
  
  updateState: (messageId: string, updates: Partial<SuperAgentState>) => {
    set(state => {
      const existing = state.runs[messageId];
      if (!existing) return state;
      return {
        runs: {
          ...state.runs,
          [messageId]: { ...existing, ...updates },
        },
      };
    });
  },
  
  setContract: (messageId: string, contract: SuperAgentContract) => {
    set(state => {
      const existing = state.runs[messageId];
      if (!existing) return state;
      return {
        runs: {
          ...state.runs,
          [messageId]: {
            ...existing,
            contract,
            sourcesTarget: contract.requirements.min_sources || existing.sourcesTarget,
            phase: "planning",
          },
        },
      };
    });
  },
  
  addSource: (messageId: string, source: SuperAgentSource) => {
    set(state => {
      const existing = state.runs[messageId];
      if (!existing) return state;
      const existingIndex = existing.sources.findIndex(s => s.id === source.id);
      let newSources: SuperAgentSource[];
      if (existingIndex >= 0) {
        newSources = [...existing.sources];
        newSources[existingIndex] = source;
      } else {
        newSources = [...existing.sources, source];
      }
      return {
        runs: {
          ...state.runs,
          [messageId]: {
            ...existing,
            sources: newSources,
            phase: existing.phase === "planning" ? "signals" : existing.phase,
          },
        },
      };
    });
  },
  
  updateSource: (messageId: string, sourceId: string, updates: Partial<SuperAgentSource>) => {
    set(state => {
      const existing = state.runs[messageId];
      if (!existing) return state;
      const newSources = existing.sources.map(s =>
        s.id === sourceId ? { ...s, ...updates } : s
      );
      return {
        runs: {
          ...state.runs,
          [messageId]: { ...existing, sources: newSources },
        },
      };
    });
  },
  
  addArtifact: (messageId: string, artifact: SuperAgentArtifact) => {
    set(state => {
      const existing = state.runs[messageId];
      if (!existing) return state;
      const existingIndex = existing.artifacts.findIndex(a => a.id === artifact.id);
      if (existingIndex >= 0) return state;
      return {
        runs: {
          ...state.runs,
          [messageId]: {
            ...existing,
            artifacts: [...existing.artifacts, artifact],
            phase: "creating",
          },
        },
      };
    });
  },
  
  addToolCall: (messageId: string, toolCall: SuperAgentToolCall) => {
    set(state => {
      const existing = state.runs[messageId];
      if (!existing) return state;
      return {
        runs: {
          ...state.runs,
          [messageId]: {
            ...existing,
            toolCalls: [...existing.toolCalls, toolCall],
          },
        },
      };
    });
  },
  
  addToolResult: (messageId: string, toolResult: SuperAgentToolResult) => {
    set(state => {
      const existing = state.runs[messageId];
      if (!existing) return state;
      return {
        runs: {
          ...state.runs,
          [messageId]: {
            ...existing,
            toolResults: [...existing.toolResults, toolResult],
          },
        },
      };
    });
  },
  
  setProgress: (messageId: string, progress: SuperAgentProgress) => {
    set(state => {
      const existing = state.runs[messageId];
      if (!existing) return state;
      return {
        runs: {
          ...state.runs,
          [messageId]: {
            ...existing,
            progress,
            phase: progress.phase || existing.phase,
          },
        },
      };
    });
  },
  
  setVerify: (messageId: string, verify: SuperAgentVerify) => {
    set(state => {
      const existing = state.runs[messageId];
      if (!existing) return state;
      return {
        runs: {
          ...state.runs,
          [messageId]: {
            ...existing,
            verify,
            phase: "verifying",
          },
        },
      };
    });
  },
  
  completeRun: (messageId: string, final: SuperAgentFinal) => {
    set(state => {
      const existing = state.runs[messageId];
      if (!existing) return state;
      return {
        runs: {
          ...state.runs,
          [messageId]: {
            ...existing,
            final,
            phase: "completed",
            isRunning: false,
          },
        },
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
          [messageId]: {
            ...existing,
            error,
            phase: "error",
            isRunning: false,
          },
        },
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
          [messageId]: {
            ...existing,
            isRunning: false,
            phase: existing.phase === "completed" ? "completed" : "idle",
          },
        },
      };
    });
  },
  
  clearRun: (messageId: string) => {
    set(state => {
      const { [messageId]: removed, ...rest } = state.runs;
      return { runs: rest };
    });
  },
  
  clearAllRuns: () => {
    set({ runs: {} });
  },
}));

export const useSuperAgentRun = (messageId: string) => {
  return useSuperAgentStore(state => state.runs[messageId] || null);
};
