import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromptSuggestions } from "./prompt-suggestions";

describe("PromptSuggestions", () => {
  it("renders without crashing (currently returns null)", () => {
    const onSelect = vi.fn();
    const { container } = render(<PromptSuggestions onSelect={onSelect} />);
    // Component currently returns null — no visible output
    expect(container.innerHTML).toBe("");
  });

  it("does not call onSelect when rendered", () => {
    const onSelect = vi.fn();
    render(<PromptSuggestions onSelect={onSelect} />);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("accepts hasAttachment prop without error", () => {
    const onSelect = vi.fn();
    const { container } = render(<PromptSuggestions onSelect={onSelect} hasAttachment />);
    expect(container.innerHTML).toBe("");
  });
});
