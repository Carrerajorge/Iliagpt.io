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
const activePollingFallbacks = new Map<string, () => void>();

function runHasUsableArtifact(run: OfficeRunState | undefined): boolean {
  if (!run) return false;
  return run.steps.some(
    (step) =>
      step.status === "completed" &&
      Boolean(step.artifact?.downloadUrl || step.artifact?.previewUrl),
  );
}

/**
 * DB-polling fallback used when the SSE EventSource dies but the run may
 * still be in progress. Polls /runs/:id every 500ms up to 30 seconds,
 * finalizing the run ONLY when:
 *   - DB status reaches succeeded/failed/cancelled
 *   - OR an "exported" artifact exists on the run (we promote to succeeded
 *     regardless of status, because artifact-on-disk is the real source of truth)
 *   - OR the 30s budget is exhausted, in which case we finalize as "failed"
 *     with an explicit "polling timeout" reason (NOT "EventSource error").
 *
 * Returns an "unsubscribe" that the caller can use to cancel the polling.
 */
function startPollingFallback(runId: string, onFinalize: () => void): () => void {
  // Dedupe: if we already have a poller for this run, don't start another.
  const existing = activePollingFallbacks.get(runId);
  if (existing) return existing;

  const POLL_INTERVAL_MS = 500;
  const POLL_BUDGET_MS = 30_000;
  const startedAt = Date.now();
  let cancelled = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const store = useOfficeEngineStore;

  const cleanup = () => {
    cancelled = true;
    if (timeoutId !== null) clearTimeout(timeoutId);
    activePollingFallbacks.delete(runId);
  };

  const finalize = (status: OfficeRunState["status"], error?: string) => {
    if (cancelled) return;
    store.getState().finishRun(runId, status, error);
    onFinalize();
    cleanup();
  };

  const tick = async () => {
    if (cancelled) return;
    try {
      const res = await fetch(`/api/office-engine/runs/${runId}`, { credentials: "include" });
      if (res.ok) {
        const payload = await res.json();
        const run = payload?.run;
        const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
        const exportedArtifact = artifacts.find(
          (a: { kind?: string }) => a?.kind === "exported",
        );

        // PROD RULE #2 — artifact-on-disk wins, even if status is weird.
        if (exportedArtifact) {
          const hydratedRun = store.getState().runs.get(runId);
          if ((hydratedRun?.steps.length ?? 0) === 0) {
            store.getState().applyStep(runId, {
              id: `poll-seed-${runId}`,
              type: "completed",
              title: "Documento listo",
              status: "completed",
              artifact: {
                id: String(exportedArtifact.id ?? "exported"),
                name: String(exportedArtifact.name ?? "document.docx"),
                type: String(exportedArtifact.kind ?? "docx"),
                mimeType: String(
                  exportedArtifact.mimeType ?? "application/octet-stream",
                ),
                downloadUrl: `/api/office-engine/runs/${runId}/artifacts/exported`,
                previewUrl: `/api/office-engine/runs/${runId}/artifacts/preview`,
              },
            });
          }
          finalize("succeeded");
          return;
        }

        if (run?.status === "succeeded") {
          finalize("succeeded");
          return;
        }
        if (run?.status === "failed") {
          finalize("failed", run?.errorMessage ?? "Run failed per DB");
          return;
        }
        if (run?.status === "cancelled") {
          finalize("cancelled");
          return;
        }
        // running/pending → keep polling
      }
      // 4xx/5xx or unreachable → keep polling until budget exhausted
    } catch {
      // Network error → keep polling
    }

    if (Date.now() - startedAt >= POLL_BUDGET_MS) {
      // 30-second budget exhausted without a terminal state — NOW we finalize
      // as failed with a clear reason. This is the ONLY place the store marks
      // a run failed from a late connectivity problem.
      finalize("failed", "polling timeout: run did not terminate within 30s");
      return;
    }

    timeoutId = setTimeout(tick, POLL_INTERVAL_MS);
  };

  activePollingFallbacks.set(runId, cleanup);
  // Kick off the first poll immediately (don't wait 500ms).
  void tick();
  return cleanup;
}

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
  openArtifactInPanel: (
    runId: string,
    opts?: {
      exportedName?: string;
      docKind?: "docx" | "xlsx" | "pptx" | "pdf";
      mimeType?: string;
    },
  ) => void;
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
      openArtifactInPanel: (runId, opts) => {
        const docKind = opts?.docKind ?? "docx";
        const mimeByKind: Record<"docx" | "xlsx" | "pptx" | "pdf", string> = {
          docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          pdf: "application/pdf",
        };
        const mimeType = opts?.mimeType ?? mimeByKind[docKind];
        const defaultName: Record<typeof docKind, string> = {
          docx: "document.docx",
          xlsx: "workbook.xlsx",
          pptx: "presentation.pptx",
          pdf: "document.pdf",
        };
        const title = opts?.exportedName ?? defaultName[docKind];
        const previewUrl = `/api/office-engine/runs/${runId}/artifacts/preview`;
        const downloadUrl = `/api/office-engine/runs/${runId}/artifacts/exported`;
        useArtifactStore.getState().openArtifact({
          id: `office-${runId}-exported`,
          type: "office",
          title,
          content: "",
          messageId: runId,
          officeMeta: {
            runId,
            downloadUrl,
            previewUrl,
            mimeType,
            docKind,
          },
        });
      },

      finishRun: (runId, status, error) => {
        set((state) => {
          const run = state.runs.get(runId);
          if (!run) return state;
          if (run.status === "succeeded" && status === "failed") {
            return state;
          }
          if (status === "failed" && runHasUsableArtifact(run)) {
            const next = new Map(state.runs);
            next.set(runId, { ...run, status: "succeeded", error: undefined });
            return { runs: next };
          }
          const next = new Map(state.runs);
          next.set(runId, {
            ...run,
            status,
            error: status === "succeeded" ? undefined : error,
          });
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

          // CRITICAL RACE FIX — when the server closes the stream with a batch
          // of events still in the network buffer, EventSource fires `error`
          // BEFORE dispatching the trailing events (including `finished`).
          // If we close the ES or start polling immediately, we cancel the
          // pending events and lose them. Instead, delay the recovery so any
          // still-queued step/finished events have a chance to drain first.
          setTimeout(() => {
            if (finalized) return;
            const currentRun = get().runs.get(runId);
            if (currentRun?.status === "succeeded" || runHasUsableArtifact(currentRun)) {
              get().finishRun(runId, "succeeded");
              finalized = true;
              activeRunSubscriptions.delete(runId);
              es.close();
              return;
            }
            // Still not finalized after the drain window → the SSE truly died
            // before emitting `finished`. Switch to DB polling.
            activeRunSubscriptions.delete(runId);
            es.close();
            startPollingFallback(runId, () => {
              finalized = true;
            });
          }, 250);
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
