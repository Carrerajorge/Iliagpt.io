import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { OfficeStepsPanel } from "./OfficeStepsPanel";
import { useOfficeEngineStore } from "@/stores/officeEngineStore";

describe("OfficeStepsPanel", () => {
  beforeEach(() => {
    useOfficeEngineStore.setState({
      runs: new Map([
        [
          "office-run-1",
          {
            runId: "office-run-1",
            status: "succeeded",
            steps: [
              {
                id: "plan-step",
                type: "thinking",
                title: "Planificando edición DOCX",
                status: "completed",
                duration: 42,
                output: "create document from spec",
              },
              {
                id: "edit-step",
                type: "editing",
                title: "Aplicando edición",
                status: "completed",
                duration: 73,
                output: "Documento generado desde especificación",
                diff: { added: 18, removed: 0 },
              },
            ],
          },
        ],
      ]),
      activeRunId: "office-run-1",
      subscribe: vi.fn(() => () => {}),
    } as any);
  });

  it("renders the inline office timeline with outputs and diff metadata", () => {
    render(<OfficeStepsPanel runId="office-run-1" />);

    expect(screen.getByText("Office Engine — Run office-r")).toBeInTheDocument();
    expect(screen.getByText("Planificando edición DOCX")).toBeInTheDocument();
    expect(screen.getByText("Aplicando edición")).toBeInTheDocument();
    expect(screen.getByText("create document from spec")).toBeInTheDocument();
    expect(screen.getByText("+18/-0")).toBeInTheDocument();
    expect(screen.getByText("succeeded")).toBeInTheDocument();
  });

  it("shows a waiting state when the run is still unknown", () => {
    useOfficeEngineStore.setState({
      runs: new Map(),
      activeRunId: null,
      subscribe: vi.fn(() => () => {}),
    } as any);

    render(<OfficeStepsPanel runId="office-run-missing" />);

    expect(screen.getByText("Esperando eventos del run office-run-missing…")).toBeInTheDocument();
  });

  it("does not subscribe again when the run already has seeded progress", () => {
    const subscribe = vi.fn(() => () => {});
    useOfficeEngineStore.setState({
      runs: new Map([
        [
          "office-run-seeded",
          {
            runId: "office-run-seeded",
            status: "running",
            steps: [
              {
                id: "handoff",
                type: "handoff",
                title: "Derivando al Office Engine",
                status: "running",
              },
            ],
          },
        ],
      ]),
      activeRunId: "office-run-seeded",
      subscribe,
    } as any);

    render(<OfficeStepsPanel runId="office-run-seeded" />);

    expect(screen.getByText("Derivando al Office Engine")).toBeInTheDocument();
    expect(subscribe).toHaveBeenCalledWith("office-run-seeded");
  });
});
