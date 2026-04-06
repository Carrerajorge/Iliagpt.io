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

  it("returns the research action and stores it as recent", () => {
    const onSelect = vi.fn();

    render(<PromptSuggestions onSelect={onSelect} />);

    fireEvent.click(screen.getByText("Investigar antes de actuar"));

    expect(onSelect).toHaveBeenCalledWith(
      expect.stringContaining("Investiga primero este tema o problema."),
    );
    expect(window.localStorage.getItem("promptWorkflowRecents")).toBe(
      JSON.stringify(["research-first"]),
    );
  });

  it("does not render removed workflows in the default list", () => {
    render(<PromptSuggestions onSelect={vi.fn()} />);

    expect(screen.getByRole("button", { name: /plan de implementación/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /revisión técnica estricta/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /documento técnico/i })).not.toBeInTheDocument();
  });

  it("keeps attachment presentation output available", () => {
    const onSelect = vi.fn();

    render(<PromptSuggestions onSelect={onSelect} hasAttachment />);

    fireEvent.click(screen.getByText("Convertir en presentación"));

    expect(onSelect).toHaveBeenCalledWith(
      expect.stringContaining("presentación ejecutiva"),
    );
  });
});
