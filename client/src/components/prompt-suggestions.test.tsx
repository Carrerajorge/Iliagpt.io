import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PromptSuggestions } from "./prompt-suggestions";

describe("PromptSuggestions", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => store.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
          store.set(key, value);
        }),
        removeItem: vi.fn((key: string) => {
          store.delete(key);
        }),
        clear: vi.fn(() => {
          store.clear();
        }),
      },
    });
  });

  it("emits structured metadata for the research workflow", () => {
    const onSelect = vi.fn();

    render(<PromptSuggestions onSelect={onSelect} />);

    fireEvent.click(screen.getByText("Investigar antes de actuar"));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedTool: "web",
        latencyMode: "deep",
      }),
    );

    expect(window.localStorage.getItem("promptWorkflowRecents")).toBe(
      JSON.stringify(["research-first"]),
    );
  });

  it("shows recent workflows when available", () => {
    window.localStorage.setItem(
      "promptWorkflowRecents",
      JSON.stringify(["quality-gate", "research-first"]),
    );

    render(<PromptSuggestions onSelect={vi.fn()} />);

    expect(screen.getByText("Recientes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /revisión técnica estricta/i })).toBeInTheDocument();
  });

  it("supports attachment workflows with document output metadata", () => {
    const onSelect = vi.fn();

    render(<PromptSuggestions onSelect={onSelect} hasAttachment />);

    fireEvent.click(screen.getByText("Convertir en presentación"));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedDocTool: "ppt",
        latencyMode: "auto",
      }),
    );
  });
});
