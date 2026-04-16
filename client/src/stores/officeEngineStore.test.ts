import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { useOfficeEngineStore } from "./officeEngineStore";

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  readonly close = vi.fn();

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const current = this.listeners.get(type) || new Set();
    current.add(listener);
    this.listeners.set(type, current);
  }

  trigger(type: string, payload?: unknown) {
    const data = payload === undefined ? "" : JSON.stringify(payload);
    for (const listener of this.listeners.get(type) || []) {
      listener({ data } as MessageEvent);
    }
  }
}

describe("useOfficeEngineStore.subscribe", () => {
  const originalEventSource = globalThis.EventSource;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    FakeEventSource.instances = [];
    useOfficeEngineStore.setState({ runs: new Map(), activeRunId: null });
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalEventSource) {
      vi.stubGlobal("EventSource", originalEventSource);
    } else {
      vi.unstubAllGlobals();
    }
    if (originalFetch) {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("hydrates a succeeded run via the polling fallback when SSE closes early", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          run: { status: "succeeded" },
          artifacts: [
            {
              id: "artifact-1",
              kind: "exported",
              name: "document.docx",
              mimeType:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            },
          ],
        }),
      })) as unknown as typeof fetch,
    );

    useOfficeEngineStore.getState().subscribe("office-run-1");
    FakeEventSource.instances.at(-1)?.trigger("error");

    await waitFor(() => {
      const run = useOfficeEngineStore.getState().runs.get("office-run-1");
      expect(run?.status).toBe("succeeded");
      // Polling seeds a step with the `poll-seed-` prefix (new contract).
      expect(run?.steps[0]?.id).toMatch(/^poll-seed-office-run-1/);
      expect(run?.steps[0]?.artifact?.downloadUrl).toBe(
        "/api/office-engine/runs/office-run-1/artifacts/exported",
      );
    });
  });

  it("artifact-on-disk wins over weird run status (promotes to succeeded)", async () => {
    // DB reports status=running but there's an exported artifact → succeeded.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          run: { status: "running" },
          artifacts: [
            { id: "a", kind: "exported", name: "x.docx", mimeType: "application/docx" },
          ],
        }),
      })) as unknown as typeof fetch,
    );

    useOfficeEngineStore.getState().subscribe("office-run-weird");
    FakeEventSource.instances.at(-1)?.trigger("error");

    await waitFor(() => {
      const run = useOfficeEngineStore.getState().runs.get("office-run-weird");
      expect(run?.status).toBe("succeeded");
    });
  });

  it("does NOT flip to failed when DB reports running and no artifact yet", async () => {
    // Simulate a run that's actually still processing. Polling should keep it
    // in "running" state, NOT mark it failed.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          run: { status: "running" },
          artifacts: [],
        }),
      })) as unknown as typeof fetch,
    );

    useOfficeEngineStore.getState().subscribe("office-run-keep-running");
    FakeEventSource.instances.at(-1)?.trigger("error");

    // Give the polling loop a chance to run at least once.
    await new Promise((r) => setTimeout(r, 50));
    const run = useOfficeEngineStore.getState().runs.get("office-run-keep-running");
    expect(run?.status).toBe("running");
    expect(run?.error).toBeUndefined();
  });

  it("finalizes as failed when DB explicitly reports failed status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          run: { status: "failed", errorMessage: "UNPACK_FAILED: corrupt zip" },
          artifacts: [],
        }),
      })) as unknown as typeof fetch,
    );

    useOfficeEngineStore.getState().subscribe("office-run-failed-db");
    FakeEventSource.instances.at(-1)?.trigger("error");

    await waitFor(() => {
      const run = useOfficeEngineStore.getState().runs.get("office-run-failed-db");
      expect(run?.status).toBe("failed");
      expect(run?.error).toBe("UNPACK_FAILED: corrupt zip");
    });
  });

  it("ignores transient fetch failures and keeps polling (no premature failed)", async () => {
    // First call fails with 500, should keep trying (no flip to failed).
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) return { ok: false, json: async () => ({}) } as Response;
        return {
          ok: true,
          json: async () => ({
            run: { status: "succeeded" },
            artifacts: [
              { id: "a", kind: "exported", name: "x.docx", mimeType: "application/docx" },
            ],
          }),
        } as Response;
      }) as unknown as typeof fetch,
    );

    useOfficeEngineStore.getState().subscribe("office-run-transient");
    FakeEventSource.instances.at(-1)?.trigger("error");

    await waitFor(() => {
      const run = useOfficeEngineStore.getState().runs.get("office-run-transient");
      expect(run?.status).toBe("succeeded");
    });
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("does not downgrade a succeeded run when a late failure arrives after a valid artifact", () => {
    useOfficeEngineStore.setState({
      runs: new Map([
        [
          "office-run-late-error",
          {
            runId: "office-run-late-error",
            status: "succeeded",
            steps: [
              {
                id: "export",
                type: "export",
                title: "Documento listo",
                status: "completed",
                artifact: {
                  id: "artifact-1",
                  name: "administracion.docx",
                  type: "docx",
                  mimeType:
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                  downloadUrl: "/api/office-engine/runs/office-run-late-error/artifacts/exported",
                  previewUrl: "/api/office-engine/runs/office-run-late-error/artifacts/preview",
                },
              },
            ],
          },
        ],
      ]),
      activeRunId: "office-run-late-error",
    });

    useOfficeEngineStore
      .getState()
      .finishRun("office-run-late-error", "failed", "EventSource error");

    const run = useOfficeEngineStore.getState().runs.get("office-run-late-error");
    expect(run?.status).toBe("succeeded");
    expect(run?.error).toBeUndefined();
  });
});
