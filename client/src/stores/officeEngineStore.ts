/**
 * Zustand store for an active Office Engine run.
 *
 * Subscribes to the SSE event stream at `/api/office-engine/runs/:id/events`
 * and accumulates the step timeline. Components (`OfficeStepsPanel`) read
 * from this store to show live progress; the run completion event also
 * triggers a one-shot opening of the `OfficeArtifact` in the artifact panel.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { useArtifactStore } from "./artifactStore";

const activeRunSubscriptions = new Map<string, () => void>();

export interface OfficeEngineStep {
  id: string;
  type: string;
  title: string;
  description?: string;
  status: "pending" | "running" | "completed" | "failed";
  duration?: number;
  output?: string;
  diff?: { added: number; removed: number };
  artifact?: {
    id: string;
    name: string;
    type: string;
    mimeType: string;
    downloadUrl: string;
    previewUrl?: string;
  };
}

interface OfficeRunState {
  runId: string;
  steps: OfficeEngineStep[];
  status: "running" | "succeeded" | "failed" | "cancelled";
  error?: string;
}

interface OfficeEngineStore {
  runs: Map<string, OfficeRunState>;
  activeRunId: string | null;

  startRun: (runId: string) => void;
  setActive: (runId: string | null) => void;
  applyStep: (runId: string, step: OfficeEngineStep) => void;
  finishRun: (runId: string, status: OfficeRunState["status"], error?: string) => void;

  /** Begin streaming an existing run from the server. Idempotent. */
  subscribe: (runId: string) => () => void;

  /** Seed a run as already-succeeded (used for idempotent cache hits). */
  seedSucceeded: (runId: string, exportedName?: string) => void;

  /** Open the office artifact in the global artifact panel sheet (opt-in). */
  openArtifactInPanel: (runId: string, exportedName?: string) => void;
}

export const useOfficeEngineStore = create<OfficeEngineStore>()(
  devtools(
    (set, get) => ({
      runs: new Map(),
      activeRunId: null,

      startRun: (runId) => {
        set((state) => {
          const next = new Map(state.runs);
          if (!next.has(runId)) {
            next.set(runId, { runId, steps: [], status: "running" });
          }
          return { runs: next, activeRunId: runId };
        });
      },

      setActive: (runId) => set({ activeRunId: runId }),

      applyStep: (runId, step) => {
        set((state) => {
          const run = state.runs.get(runId);
          if (!run) return state;
          const idx = run.steps.findIndex((s) => s.id === step.id);
          const next = new Map(state.runs);
          const updatedSteps =
            idx >= 0
              ? run.steps.map((s, i) => (i === idx ? { ...s, ...step } : s))
              : [...run.steps, step];
          next.set(runId, { ...run, steps: updatedSteps });
          return { runs: next };
        });
      },

      /**
       * Open the global artifact panel for a finished run. Opt-in: callers
       * (e.g. the chat integration) invoke this manually after a run finishes.
       * The standalone demo page does NOT call this — it renders OfficeArtifact
       * inline so the global sheet doesn't intercept its own download button.
       */
      openArtifactInPanel: (runId, exportedName) => {
        const previewUrl = `/api/office-engine/runs/${runId}/artifacts/preview`;
        const downloadUrl = `/api/office-engine/runs/${runId}/artifacts/exported`;
        useArtifactStore.getState().openArtifact({
          id: `office-${runId}-exported`,
          type: "office",
          title: exportedName ?? "document.docx",
          content: "",
          messageId: runId,
          officeMeta: {
            runId,
            downloadUrl,
            previewUrl,
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            docKind: "docx",
          },
        });
      },

      finishRun: (runId, status, error) => {
        set((state) => {
          const run = state.runs.get(runId);
          if (!run) return state;
          const next = new Map(state.runs);
          next.set(runId, { ...run, status, error });
          return { runs: next };
        });
      },

      subscribe: (runId) => {
        const existing = activeRunSubscriptions.get(runId);
        if (existing) {
          return existing;
        }

        const url = `/api/office-engine/runs/${runId}/events`;
        const es = new EventSource(url, { withCredentials: true });
        get().startRun(runId);

        // Track whether we already saw a `finished` event so a subsequent
        // EventSource `error` (fired by the natural server-side close) is
        // not misinterpreted as a real failure.
        let finalized = false;

        es.addEventListener("step", (ev) => {
          try {
            const parsed = JSON.parse((ev as MessageEvent).data);
            get().applyStep(runId, parsed);
          } catch {
            /* ignore malformed */
          }
        });
        es.addEventListener("finished", (ev) => {
          try {
            const parsed = JSON.parse((ev as MessageEvent).data);
            const status =
              parsed.status === "failed"
                ? "failed"
                : parsed.status === "cancelled"
                  ? "cancelled"
                  : "succeeded";
            get().finishRun(runId, status);
          } catch {
            get().finishRun(runId, "succeeded");
          }
          finalized = true;
          activeRunSubscriptions.delete(runId);
          es.close();
        });
        es.addEventListener("error", () => {
          if (finalized) return; // expected close after a synthetic finished
          get().finishRun(runId, "failed", "EventSource error");
          activeRunSubscriptions.delete(runId);
          es.close();
        });

        const unsubscribe = () => {
          activeRunSubscriptions.delete(runId);
          es.close();
        };

        activeRunSubscriptions.set(runId, unsubscribe);
        return unsubscribe;
      },

      /** Seed an idempotent run as already-succeeded without needing the SSE. */
      seedSucceeded: (runId, exportedName) => {
        const previewUrl = `/api/office-engine/runs/${runId}/artifacts/preview`;
        const downloadUrl = `/api/office-engine/runs/${runId}/artifacts/exported`;
        set((state) => {
          const next = new Map(state.runs);
          next.set(runId, {
            runId,
            status: "succeeded",
            steps: [
              {
                id: `seed-${runId}`,
                type: "completed",
                title: "Documento listo (cache)",
                status: "completed",
                artifact: {
                  id: "exported",
                  name: exportedName ?? "document.docx",
                  type: "docx",
                  mimeType:
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                  downloadUrl,
                  previewUrl,
                },
              },
            ],
          });
          return { runs: next, activeRunId: runId };
        });
      },
    }),
    { name: "office-engine-store" },
  ),
);
