import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface ManagedAgentPreset {
  key: string;
  name: string;
  description: string;
  icon: string;
  model: string;
}

export interface ManagedAgentSession {
  sessionId: string;
  agentId: string;
  environmentId?: string;
  presetKey: string;
  chatId: string;
  status: "idle" | "running" | "terminated";
  createdAt: number;
}

interface ManagedAgentStore {
  // Presets (loaded from API)
  presets: ManagedAgentPreset[];
  presetsLoaded: boolean;
  loadPresets: () => Promise<void>;

  // Selection state
  selectedPresetKey: string | null;
  setSelectedPresetKey: (key: string | null) => void;

  // Active sessions per chat
  sessions: Record<string, ManagedAgentSession>;
  setSession: (chatId: string, session: ManagedAgentSession) => void;
  getSession: (chatId: string) => ManagedAgentSession | null;
  updateSessionStatus: (chatId: string, status: ManagedAgentSession["status"]) => void;
  clearSession: (chatId: string) => void;
}

export const useManagedAgentStore = create<ManagedAgentStore>()(
  persist(
    (set, get) => ({
      presets: [],
      presetsLoaded: false,
      loadPresets: async () => {
        if (get().presetsLoaded) return;
        try {
          const res = await fetch("/api/managed-agents/presets", { credentials: "include" });
          if (!res.ok) return;
          const data = await res.json();
          set({ presets: data.presets || [], presetsLoaded: true });
        } catch {
          // Silently fail — presets are optional
        }
      },

      selectedPresetKey: null,
      setSelectedPresetKey: (key) => set({ selectedPresetKey: key }),

      sessions: {},
      setSession: (chatId, session) =>
        set((state) => ({ sessions: { ...state.sessions, [chatId]: session } })),
      getSession: (chatId) => get().sessions[chatId] ?? null,
      updateSessionStatus: (chatId, status) =>
        set((state) => {
          const existing = state.sessions[chatId];
          if (!existing) return state;
          return { sessions: { ...state.sessions, [chatId]: { ...existing, status } } };
        }),
      clearSession: (chatId) =>
        set((state) => {
          const { [chatId]: _, ...rest } = state.sessions;
          return { sessions: rest };
        }),
    }),
    {
      name: "iliagpt-managed-agents",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        selectedPresetKey: state.selectedPresetKey,
        sessions: state.sessions,
      }),
    },
  ),
);
