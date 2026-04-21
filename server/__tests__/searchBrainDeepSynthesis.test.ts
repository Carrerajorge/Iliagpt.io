/**
 * Tests for the deep-synthesis path: passage numbering, APA formatter,
 * LLM synthesis, inline-citation rescue, and fallback behaviour.
 */

import { describe, expect, it, vi } from "vitest";
import {
  synthesiseDeepAnswer,
  DEEP_SYNTHESIS_INTERNAL,
} from "../services/searchBrain/deepSynthesis";
import type { NormalisedResult } from "../services/searchBrain/types";
import type { WebResult } from "../services/searchBrain/webProviders";

function academic(i: number, extra: Partial<NormalisedResult> = {}): NormalisedResult {
  return {
    source: "openalex",
    title: `Paper ${i}`,
    authors: [`Author ${i} A`, `Author ${i} B`],
    year: 2020 + i,
    journal: `Journal ${i}`,
    url: `https://a.example/${i}`,
    doi: `10.1/${i}`,
    abstract: `Abstract ${i} with more detail.`,
    ...extra,
  };
}

function web(i: number): WebResult {
  return {
    source: "wikipedia",
    title: `Topic ${i}`,
    url: `https://wiki.example/${i}`,
    snippet: `Encyclopedic context ${i}`,
  };
}

function mockLLM(content: string) {
  return vi.fn(async () => ({ content }));
}

// ─── APA formatter ───────────────────────────────────────────────────────

describe("formatApaAuthors", () => {
  const fn = DEEP_SYNTHESIS_INTERNAL.formatApaAuthors;

  it("single author", () => {
    expect(fn(["García, J."])).toBe("García, J.");
  });

  it("two authors uses '&'", () => {
    expect(fn(["García, J.", "López, M."])).toBe("García, J., & López, M.");
  });

  it("three authors joined with comma + &", () => {
    expect(fn(["A", "B", "C"])).toBe("A, B, & C");
  });

  it("empty input returns empty string", () => {
    expect(fn(undefined)).toBe("");
    expect(fn([])).toBe("");
  });
});

describe("formatApaReference", () => {
  it("academic: authors. (year). title. *journal*. doi url", () => {
    const ref = DEEP_SYNTHESIS_INTERNAL.formatApaReference({
      number: 1, type: "academic", source: "openalex",
      title: "Effects of melatonin",
      url: "https://e/x", doi: "10.1/mel",
      authors: ["García, J.", "López, M."],
      year: 2023, journal: "Rev. Med.",
    });
    expect(ref).toContain("García, J., & López, M.");
    expect(ref).toContain("(2023).");
    expect(ref).toContain("Effects of melatonin.");
    expect(ref).toContain("*Rev. Med.*");
    expect(ref).toContain("https://doi.org/10.1/mel");
  });

  it("web: title. (n.d.). *host*. url", () => {
    const ref = DEEP_SYNTHESIS_INTERNAL.formatApaReference({
      number: 2, type: "web", source: "wikipedia",
      title: "Melatonin", url: "https://en.wikipedia.org/wiki/Melatonin",
    });
    expect(ref).toContain("Melatonin.");
    expect(ref).toContain("(n.d.).");
    expect(ref).toContain("*en.wikipedia.org*");
    expect(ref).toContain("https://en.wikipedia.org/wiki/Melatonin");
  });
});

describe("extractInlineCitations", () => {
  const fn = DEEP_SYNTHESIS_INTERNAL.extractInlineCitations;
  it("finds bracketed numbers within range", () => {
    expect(fn("Foo [1] and [3] and [99].", 5)).toEqual([1, 3]);
  });
  it("dedupes + sorts ascending", () => {
    expect(fn("[2] and [1] and [2].", 5)).toEqual([1, 2]);
  });
});

describe("parseUsedCitations", () => {
  it("accepts numeric or numeric-string and filters out-of-range", () => {
    expect(DEEP_SYNTHESIS_INTERNAL.parseUsedCitations([1, "2", 9, "bad"], 3)).toEqual([1, 2]);
  });
});

// ─── synthesiseDeepAnswer ────────────────────────────────────────────────

describe("synthesiseDeepAnswer", () => {
  it("emits LLM answer + references only for cited passages", async () => {
    const callLLM = mockLLM(
      JSON.stringify({ answer: "Body with [1] and [3].", used: [1, 3] })
    );
    const out = await synthesiseDeepAnswer({
      query: "q",
      academic: [academic(1), academic(2)],
      web: [web(3)],
      deps: { callLLM },
    });
    expect(out.synthesised).toBe(true);
    expect(out.usedCitations).toEqual([1, 3]);
    expect(out.references.map((r) => r.number)).toEqual([1, 3]);
    expect(out.references[0]!.type).toBe("academic");
    expect(out.references[1]!.type).toBe("web");
  });

  it("backfills used citations from inline [N] when LLM omits `used`", async () => {
    const callLLM = mockLLM(
      JSON.stringify({ answer: "The study found [2]." })
    );
    const out = await synthesiseDeepAnswer({
      query: "q",
      academic: [academic(1), academic(2)],
      web: [],
      deps: { callLLM },
    });
    expect(out.usedCitations).toEqual([2]);
  });

  it("fallback when LLM is absent: deterministic answer + all passages", async () => {
    const out = await synthesiseDeepAnswer({
      query: "q",
      academic: [academic(1), academic(2)],
      web: [],
    });
    expect(out.synthesised).toBe(false);
    expect(out.usedCitations.length).toBeGreaterThan(0);
  });

  it("fallback when LLM returns malformed JSON", async () => {
    const callLLM = mockLLM("not json at all");
    const out = await synthesiseDeepAnswer({
      query: "q",
      academic: [academic(1)],
      web: [],
      deps: { callLLM },
    });
    expect(out.synthesised).toBe(false);
  });

  it("zero passages → 'sources do not clearly answer' answer", async () => {
    const callLLM = mockLLM(JSON.stringify({ answer: "x", used: [] }));
    const out = await synthesiseDeepAnswer({
      query: "q",
      academic: [],
      web: [],
      deps: { callLLM },
    });
    expect(out.passages).toHaveLength(0);
    expect(out.answer).toContain("do not clearly answer");
  });

  it("caps academic + web contributions", async () => {
    const many = Array.from({ length: 20 }, (_, i) => academic(i));
    const out = await synthesiseDeepAnswer({
      query: "q",
      academic: many,
      web: [],
      academicLimit: 3,
      webLimit: 0,
    });
    expect(out.passages).toHaveLength(3);
    expect(out.passages.every((p) => p.type === "academic")).toBe(true);
  });
});
