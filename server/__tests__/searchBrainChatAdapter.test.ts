/**
 * Tests for the SearchBrain → chatService adapter.
 *
 * We verify:
 *   - NormalisedResult → WebSource mapping preserves every field
 *     the frontend SourcesPanel reads (url, title, domain, favicon,
 *     snippet, date, siteName, canonicalUrl, metadata.*).
 *   - The prompt-injection block has the exact shape chatService
 *     expects: numbered entries, Autores/Año/Título/Journal/DOI/URL/
 *     Resumen/Cita APA 7 lines, raw URL visible (no markdown wrap).
 *   - Empty-result path returns null so caller can fall back.
 */

import { describe, expect, it, vi } from "vitest";
import { CHAT_ADAPTER_INTERNAL, runSearchBrainForChat } from "../services/searchBrain/chatAdapter";
import type { NormalisedResult } from "../services/searchBrain/types";

// Module-mock searchAcademic so the adapter runs without network.
vi.mock("../services/searchBrain/index", () => ({
  searchAcademic: vi.fn(),
}));
import { searchAcademic } from "../services/searchBrain/index";

function paper(overrides: Partial<NormalisedResult> = {}): NormalisedResult {
  return {
    source: "openalex",
    title: "Paper Title",
    authors: ["Smith, J.", "Doe, A."],
    year: 2024,
    journal: "Nature",
    doi: "10.1/abc",
    url: "https://example.org/paper",
    pdfUrl: "https://example.org/paper.pdf",
    abstract: "A paper about something important.",
    citationCount: 42,
    openAccess: true,
    ...overrides,
  };
}

// ─── toWebSource ─────────────────────────────────────────────────────────

describe("toWebSource", () => {
  it("maps every field the SourcesPanel renders", () => {
    const ws = CHAT_ADAPTER_INTERNAL.toWebSource(paper());
    expect(ws).toMatchObject({
      url: "https://example.org/paper",
      title: "Paper Title",
      domain: "example.org",
      favicon: "https://www.google.com/s2/favicons?domain=example.org&sz=64",
      date: "2024",
      siteName: "Nature",
      canonicalUrl: "https://example.org/paper",
      source: { name: "OpenAlex", domain: "example.org" },
    });
    expect(ws?.snippet).toBeTruthy();
    expect(ws?.metadata).toMatchObject({
      provider: "openalex",
      year: 2024,
      journal: "Nature",
      doi: "10.1/abc",
      citationCount: 42,
      openAccess: true,
      pdfUrl: "https://example.org/paper.pdf",
      authors: ["Smith, J.", "Doe, A."],
    });
  });

  it("falls back to DOI URL when no direct URL", () => {
    const ws = CHAT_ADAPTER_INTERNAL.toWebSource(paper({ url: "", doi: "10.1/nodirect" }));
    expect(ws?.url).toBe("https://doi.org/10.1/nodirect");
  });

  it("returns null when paper has neither URL nor DOI", () => {
    const ws = CHAT_ADAPTER_INTERNAL.toWebSource(paper({ url: "", doi: undefined }));
    expect(ws).toBeNull();
  });

  it("pretty-prints the provider name", () => {
    expect(CHAT_ADAPTER_INTERNAL.prettyProviderName("semantic")).toBe("Semantic Scholar");
    expect(CHAT_ADAPTER_INTERNAL.prettyProviderName("scielo")).toBe("SciELO");
    expect(CHAT_ADAPTER_INTERNAL.prettyProviderName("unknown")).toBe("unknown");
  });

  it("trims snippet to 200 chars with ellipsis", () => {
    const long = "x".repeat(500);
    const ws = CHAT_ADAPTER_INTERNAL.toWebSource(paper({ abstract: long }));
    expect(ws?.snippet?.length).toBeLessThanOrEqual(200);
    expect(ws?.snippet?.endsWith("…")).toBe(true);
  });

  it("handles invalid URLs gracefully", () => {
    const ws = CHAT_ADAPTER_INTERNAL.toWebSource(paper({ url: "not a url" }));
    expect(ws?.domain).toBe("unknown");
  });
});

// ─── buildPromptInjection ────────────────────────────────────────────────

describe("buildPromptInjection", () => {
  it("lists providers, numbers each entry, and keeps the raw URL visible", () => {
    const block = CHAT_ADAPTER_INTERNAL.buildPromptInjection(
      [
        paper({ source: "openalex", title: "P1", pdfUrl: "https://example.org/p1.pdf" }),
        paper({ source: "scielo", title: "P2", pdfUrl: undefined, url: "https://www.scielo.br/p2" }),
      ],
      [
        { source: "openalex", ok: true, count: 1 },
        { source: "scielo", ok: true, count: 1 },
        { source: "crossref", ok: true, count: 0 }, // filtered out (count=0)
      ],
    );
    // Header includes the active providers (OpenAlex + SciELO), not CrossRef.
    expect(block).toContain("OpenAlex");
    expect(block).toContain("SciELO");
    expect(block).not.toContain("CrossRef");
    // Raw URL shown on its own line — NOT markdown-wrapped.
    expect(block).toContain("URL: https://example.org/p1.pdf");
    expect(block).toContain("URL: https://www.scielo.br/p2");
    expect(block).toContain("[1] Autores:");
    expect(block).toContain("[2] Autores:");
    expect(block).toContain("Cita APA 7:");
  });

  it("uses the direct URL over the DOI-built URL when both present", () => {
    const block = CHAT_ADAPTER_INTERNAL.buildPromptInjection(
      [paper({ pdfUrl: undefined, url: "https://direct/", doi: "10.1/ignored" })],
      [{ source: "openalex", ok: true, count: 1 }],
    );
    expect(block).toContain("URL: https://direct/");
  });
});

// ─── APA ──────────────────────────────────────────────────────────────────

describe("formatApaAuthors", () => {
  it("single author", () => {
    expect(CHAT_ADAPTER_INTERNAL.formatApaAuthors(["Smith, J."])).toBe("Smith, J.");
  });
  it("two authors joined with &", () => {
    expect(CHAT_ADAPTER_INTERNAL.formatApaAuthors(["Smith, J.", "Doe, A."])).toBe("Smith, J., & Doe, A.");
  });
  it("empty / undefined → empty string", () => {
    expect(CHAT_ADAPTER_INTERNAL.formatApaAuthors(undefined)).toBe("");
    expect(CHAT_ADAPTER_INTERNAL.formatApaAuthors([])).toBe("");
  });
  it("many authors: first 19 + last with ellipsis", () => {
    const many = Array.from({ length: 25 }, (_, i) => `Author${i}`);
    const out = CHAT_ADAPTER_INTERNAL.formatApaAuthors(many);
    expect(out).toContain("Author0");
    expect(out).toContain("…");
    expect(out).toContain("Author24");
  });
});

describe("buildApa", () => {
  it("includes authors, year, title, journal, DOI link", () => {
    const s = CHAT_ADAPTER_INTERNAL.buildApa(paper());
    expect(s).toMatch(/Smith, J., & Doe, A\./);
    expect(s).toMatch(/\(2024\)/);
    expect(s).toMatch(/\*Nature\*/);
    expect(s).toMatch(/https:\/\/doi\.org\/10\.1\/abc/);
  });
});

// ─── runSearchBrainForChat (integration) ─────────────────────────────────

describe("runSearchBrainForChat", () => {
  const searchAcademicMock = vi.mocked(searchAcademic);

  beforeEach(() => {
    searchAcademicMock.mockReset();
  });

  it("returns a ChatAdapterResult on success", async () => {
    searchAcademicMock.mockResolvedValue({
      query: "q",
      decomposed: [],
      results: [paper()],
      providers: [
        { source: "openalex", ok: true, count: 1, durationMs: 50 },
        { source: "crossref", ok: true, count: 0, durationMs: 30 },
      ],
      reranked: true,
      timings: { decompositionMs: 10, retrievalMs: 40, rerankingMs: 5, totalMs: 55 },
      weights: { rerank: 1, providerRank: 0.3, citations: 0.2, openAccessBoost: 0.1 },
      cache: { hit: false },
    });
    const out = await runSearchBrainForChat({ query: "q" });
    expect(out).not.toBeNull();
    expect(out!.webSources).toHaveLength(1);
    expect(out!.providersUsed).toEqual(["openalex"]);
    expect(out!.webSearchInfo).toContain("Artículos académicos encontrados");
  });

  it("returns null when SearchBrain throws (caller falls back)", async () => {
    searchAcademicMock.mockRejectedValue(new Error("pipeline down"));
    const out = await runSearchBrainForChat({ query: "q" });
    expect(out).toBeNull();
  });

  it("returns null when results are empty", async () => {
    searchAcademicMock.mockResolvedValue({
      query: "q",
      decomposed: [],
      results: [],
      providers: [],
      reranked: false,
      timings: { decompositionMs: 0, retrievalMs: 0, rerankingMs: 0, totalMs: 0 },
      weights: { rerank: 1, providerRank: 0.3, citations: 0.2, openAccessBoost: 0.1 },
      cache: { hit: false },
    });
    const out = await runSearchBrainForChat({ query: "q" });
    expect(out).toBeNull();
  });

  it("exposes cache metadata (hit=true) when a cache hit powered the result", async () => {
    searchAcademicMock.mockResolvedValue({
      query: "q",
      decomposed: [],
      results: [paper()],
      providers: [{ source: "openalex", ok: true, count: 1, durationMs: 1 }],
      reranked: true,
      timings: { decompositionMs: 0, retrievalMs: 0, rerankingMs: 0, totalMs: 2 },
      weights: { rerank: 1, providerRank: 0.3, citations: 0.2, openAccessBoost: 0.1 },
      cache: { hit: true, matchedBy: "exact", source: "redis" },
    });
    const out = await runSearchBrainForChat({ query: "q" });
    expect(out?.cache).toEqual({ hit: true, matchedBy: "exact", source: "redis" });
  });
});
