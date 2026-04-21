/**
 * Tests for the unifiedAcademicSearch → NormalisedResult adapter.
 * Verifies that author splitting and year parsing are robust.
 */

import { describe, expect, it } from "vitest";

import { PROVIDER_ADAPTER_INTERNAL } from "../services/searchBrain/providerAdapter";

describe("providerAdapter.splitAuthors", () => {
  it("splits on comma, semicolon, and 'and'", () => {
    expect(PROVIDER_ADAPTER_INTERNAL.splitAuthors("Alice, Bob; Carol and Dave")).toEqual([
      "Alice",
      "Bob",
      "Carol",
      "Dave",
    ]);
  });

  it("filters empty segments", () => {
    expect(PROVIDER_ADAPTER_INTERNAL.splitAuthors(",,  , Alice")).toEqual(["Alice"]);
  });

  it("empty input returns []", () => {
    expect(PROVIDER_ADAPTER_INTERNAL.splitAuthors(undefined)).toEqual([]);
    expect(PROVIDER_ADAPTER_INTERNAL.splitAuthors("")).toEqual([]);
  });
});

describe("providerAdapter.parseYear", () => {
  it("extracts year from YYYY-MM-DD strings", () => {
    expect(PROVIDER_ADAPTER_INTERNAL.parseYear("2023-05-17")).toBe(2023);
  });

  it("returns undefined when no plausible year", () => {
    expect(PROVIDER_ADAPTER_INTERNAL.parseYear("no year here")).toBeUndefined();
    expect(PROVIDER_ADAPTER_INTERNAL.parseYear(undefined)).toBeUndefined();
  });

  it("rejects years outside a sane range", () => {
    expect(PROVIDER_ADAPTER_INTERNAL.parseYear("1200")).toBeUndefined();
    expect(PROVIDER_ADAPTER_INTERNAL.parseYear("3000")).toBeUndefined();
  });
});

describe("providerAdapter.toNormalised", () => {
  it("maps the AcademicResult shape to NormalisedResult", () => {
    const r = PROVIDER_ADAPTER_INTERNAL.toNormalised(
      "openalex",
      {
        title: "Paper",
        authors: "Alice, Bob",
        year: "2024",
        journal: "Nature",
        doi: "10.1/x",
        url: "http://e.com",
        pdfUrl: "http://e.com/a.pdf",
        abstract: "abs",
        citations: 42,
        source: "openalex",
        openAccess: true,
        language: "en",
      },
      3
    );
    expect(r.source).toBe("openalex");
    expect(r.authors).toEqual(["Alice", "Bob"]);
    expect(r.year).toBe(2024);
    expect(r.citationCount).toBe(42);
    expect(r.providerRank).toBe(3);
    expect(r.raw).toBeDefined();
  });
});
