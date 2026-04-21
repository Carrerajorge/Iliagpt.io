/**
 * Tests for the pure `splitAnswerByCitations` helper powering the
 * synthesis panel's clickable [N] markers. The full panel rendering
 * is out of scope for vitest (DOM-heavy, jsdom-only) — we'll rely on
 * Playwright smoke in a later phase for the component surface.
 */

import { describe, expect, it } from "vitest";
import { splitAnswerByCitations } from "./SearchBrainPanel";

describe("splitAnswerByCitations", () => {
  it("returns a single text part when no citations", () => {
    expect(splitAnswerByCitations("plain answer")).toEqual([
      { type: "text", value: "plain answer" },
    ]);
  });

  it("splits single citation", () => {
    expect(splitAnswerByCitations("A [1] B")).toEqual([
      { type: "text", value: "A " },
      { type: "cite", number: 1 },
      { type: "text", value: " B" },
    ]);
  });

  it("splits multiple citations back-to-back", () => {
    expect(splitAnswerByCitations("[1][2] tail")).toEqual([
      { type: "cite", number: 1 },
      { type: "cite", number: 2 },
      { type: "text", value: " tail" },
    ]);
  });

  it("empty answer → empty array", () => {
    expect(splitAnswerByCitations("")).toEqual([]);
  });

  it("ignores bracketed non-numeric", () => {
    expect(splitAnswerByCitations("A [X] B").filter((p) => p.type === "cite")).toEqual([]);
  });

  it("parses multi-digit citations", () => {
    expect(splitAnswerByCitations("[12] and [345]")).toMatchObject([
      { type: "cite", number: 12 },
      { type: "text", value: " and " },
      { type: "cite", number: 345 },
    ]);
  });
});
