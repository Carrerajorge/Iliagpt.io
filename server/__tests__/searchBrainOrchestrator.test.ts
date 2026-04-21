/**
 * Tests for the SearchBrain orchestrator — 3-phase WebGLM pipeline.
 *
 * Every dependency (LLM, retriever, clock) is stubbed so tests are
 * deterministic and fast. No network, no real LLM calls.
 */

import { describe, expect, it, vi } from "vitest";

import { runSearchBrain, ORCHESTRATOR_INTERNAL, dedupeResults } from "../services/searchBrain/orchestrator";
import { decomposeQuery, DECOMPOSER_INTERNAL } from "../services/searchBrain/queryDecomposer";
import { rerankResults, RERANKER_INTERNAL } from "../services/searchBrain/llmReranker";
import type { NormalisedResult, SearchBrainDeps, SearchBrainSource } from "../services/searchBrain/types";

function mockLLM(responses: string[]) {
  let i = 0;
  const calls: Array<{ system: string; user: string }> = [];
  const fn = vi.fn(async (args: { system: string; user: string }) => {
    calls.push({ system: args.system, user: args.user });
    const content = responses[Math.min(i++, responses.length - 1)] ?? "{}";
    return { content };
  });
  return { fn, calls };
}

function result(
  source: SearchBrainSource,
  title: string,
  extra: Partial<NormalisedResult> = {}
): NormalisedResult {
  return {
    source,
    title,
    authors: ["A B"],
    url: `https://example.com/${encodeURIComponent(title)}`,
    ...extra,
  };
}

// ─── Dedupe ──────────────────────────────────────────────────────────────

describe("dedupeResults", () => {
  it("merges entries sharing a DOI keeping the richer one", () => {
    const a = result("openalex", "Paper A", { doi: "10.1/abc", abstract: "", citationCount: 5 });
    const b = result("semantic", "Paper A", { doi: "10.1/abc", abstract: "long abstract", citationCount: 20 });
    const out = dedupeResults([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]!.abstract).toBe("long abstract");
    expect(out[0]!.citationCount).toBe(20);
  });

  it("merges by normalised title when DOI absent", () => {
    const a = result("openalex", "The Quick Brown Fox!");
    const b = result("crossref", "the quick brown fox");
    const out = dedupeResults([a, b]);
    expect(out).toHaveLength(1);
  });

  it("keeps distinct papers separate", () => {
    const a = result("openalex", "Paper A", { doi: "10.1/a" });
    const b = result("openalex", "Paper B", { doi: "10.1/b" });
    expect(dedupeResults([a, b])).toHaveLength(2);
  });
});

// ─── Query decomposer ────────────────────────────────────────────────────

describe("queryDecomposer", () => {
  it("falls back to the original query when LLM is absent", async () => {
    const d = await decomposeQuery({ query: "¿qué efectos tiene la melatonina?", deps: {} });
    expect(d).toHaveLength(1);
    expect(d[0]!.text).toBe("¿qué efectos tiene la melatonina?");
    expect(d[0]!.language).toBe("es"); // detected from ¿ + é
  });

  it("parses the LLM JSON payload into bilingual sub-queries", async () => {
    const { fn } = mockLLM([
      JSON.stringify({
        subqueries: [
          { text: "melatonina sueño adolescentes", language: "es", rationale: "angle 1" },
          { text: "melatonin sleep adolescents", language: "en", rationale: "angle 2" },
          { text: "efectos clinicos melatonina", language: "es" },
        ],
      }),
    ]);
    const out = await decomposeQuery({ query: "melatonina en jóvenes", deps: { callLLM: fn } });
    expect(out).toHaveLength(3);
    expect(out.some((s) => s.language === "es")).toBe(true);
    expect(out.some((s) => s.language === "en")).toBe(true);
  });

  it("rejects malformed sub-queries (missing language / empty text)", async () => {
    const raw = DECOMPOSER_INTERNAL.validateSubqueries({
      subqueries: [
        { text: "ok", language: "es" },
        { text: "", language: "en" },          // dropped: empty text
        { text: "no lang" },                   // dropped: missing language
        { text: "x", language: "de" },         // dropped: unsupported language
        { text: "y", language: "en", rationale: "a" },
      ],
    });
    expect(raw).toHaveLength(2);
  });

  it("falls back when the LLM returns invalid JSON", async () => {
    const { fn } = mockLLM(["not json at all"]);
    const out = await decomposeQuery({ query: "x", deps: { callLLM: fn } });
    expect(out).toEqual([{ text: "x", language: "en" }]);
  });

  it("detects language from accents correctly", () => {
    expect(DECOMPOSER_INTERNAL.detectLanguage("título")).toBe("es");
    expect(DECOMPOSER_INTERNAL.detectLanguage("title")).toBe("en");
    expect(DECOMPOSER_INTERNAL.detectLanguage("title", "es")).toBe("es");
  });
});

// ─── LLM reranker ────────────────────────────────────────────────────────

describe("llmReranker", () => {
  it("falls back to heuristic sort when the LLM is unavailable", async () => {
    const pool = [
      result("openalex", "P1", { providerRank: 4, citationCount: 2 }),
      result("openalex", "P2", { providerRank: 0, citationCount: 500, openAccess: true }),
    ];
    const out = await rerankResults({ query: "q", results: pool, deps: {} });
    expect(out.reranked).toBe(false);
    expect(out.results[0]!.title).toBe("P2"); // better providerRank + citations + OA
  });

  it("applies LLM scores and orders by combined score", async () => {
    const pool = [
      result("openalex", "P1", { abstract: "about cats", providerRank: 0 }),
      result("openalex", "P2", { abstract: "about dogs", providerRank: 1 }),
    ];
    const { fn } = mockLLM([
      JSON.stringify({
        scores: [
          { idx: 1, score: 2, reason: "off-topic" },
          { idx: 2, score: 9, reason: "on-topic" },
        ],
      }),
    ]);
    const out = await rerankResults({
      query: "dogs",
      results: pool,
      deps: { callLLM: fn },
    });
    expect(out.reranked).toBe(true);
    expect(out.results[0]!.title).toBe("P2");
    expect(out.results[0]!.rerankScore).toBe(9);
  });

  it("caps scores to [0, 10]", () => {
    const scores = RERANKER_INTERNAL.validateScores({
      scores: [
        { idx: 1, score: 99 },
        { idx: 2, score: -5 },
        { idx: 3, score: "bad" },
      ],
    });
    expect(scores[0]).toMatchObject({ idx: 1, score: 10 });
    expect(scores[1]).toMatchObject({ idx: 2, score: 0 });
    expect(scores).toHaveLength(2);
  });
});

// ─── Orchestrator end-to-end ─────────────────────────────────────────────

describe("runSearchBrain", () => {
  function buildDeps(overrides: Partial<SearchBrainDeps> = {}): SearchBrainDeps {
    return {
      callLLM: vi.fn(async () => ({ content: JSON.stringify({ subqueries: [{ text: "q", language: "en" }] }) })),
      retrieveFrom: vi.fn(async (args) => [
        result(args.source, `From ${args.source}: ${args.query}`, { providerRank: 0 }),
      ]),
      now: (() => {
        let t = 0;
        return () => (t += 10);
      })(),
      ...overrides,
    };
  }

  it("runs the full 3-phase pipeline and returns provider traces", async () => {
    const deps = buildDeps();
    const out = await runSearchBrain(
      {
        query: "melatonin",
        sources: ["openalex", "crossref", "arxiv"],
        maxResults: 5,
        __deps: deps,
      },
      { retrieveFrom: deps.retrieveFrom! }
    );
    expect(out.providers).toHaveLength(3);
    expect(out.providers.every((p) => p.count === 1)).toBe(true);
    expect(out.decomposed).toHaveLength(1);
    expect(out.timings.totalMs).toBeGreaterThan(0);
  });

  it("records a trace with ok=false when a provider throws", async () => {
    const deps = buildDeps({
      retrieveFrom: vi.fn(async (args) => {
        if (args.source === "crossref") throw new Error("boom");
        return [result(args.source, `hit-${args.source}`)];
      }),
    });
    const out = await runSearchBrain(
      { query: "x", sources: ["openalex", "crossref"], __deps: deps },
      { retrieveFrom: deps.retrieveFrom! }
    );
    const crossref = out.providers.find((p) => p.source === "crossref")!;
    expect(crossref.ok).toBe(false);
    expect(crossref.error).toContain("boom");
    expect(out.providers.find((p) => p.source === "openalex")!.ok).toBe(true);
  });

  it("filters out scraping providers unless enableScrapingProviders is set", () => {
    const kept = ORCHESTRATOR_INTERNAL.sanitiseSources({
      query: "x",
      sources: ["openalex", "scopus", "wos"],
      enableScrapingProviders: false,
    });
    expect(kept).toEqual(["openalex"]);
    const kept2 = ORCHESTRATOR_INTERNAL.sanitiseSources({
      query: "x",
      sources: ["openalex", "scopus", "wos"],
      enableScrapingProviders: true,
    });
    expect(kept2).toEqual(["openalex", "scopus", "wos"]);
  });

  it("skips reranking when rerank:false", async () => {
    const deps = buildDeps();
    const out = await runSearchBrain(
      { query: "q", sources: ["openalex"], rerank: false, __deps: deps },
      { retrieveFrom: deps.retrieveFrom! }
    );
    expect(out.reranked).toBe(false);
    // decomposer + retriever called but reranker NOT
    const llmCalls = (deps.callLLM as ReturnType<typeof vi.fn>).mock.calls;
    // When rerank is false the only LLM calls are for decomposition.
    for (const [args] of llmCalls) {
      expect(args.system).not.toMatch(/rerank/i);
    }
  });

  it("respects maxResults cap on the final slice", async () => {
    // Stub: each source returns 5 items → 2 sources × 5 × 1 subquery = 10 raw
    const deps = buildDeps({
      retrieveFrom: vi.fn(async (args) =>
        Array.from({ length: 5 }, (_, i) =>
          result(args.source, `${args.source}-${i}`, { providerRank: i })
        )
      ),
    });
    const out = await runSearchBrain(
      {
        query: "q",
        sources: ["openalex", "arxiv"],
        maxResults: 4,
        rerank: false,
        __deps: deps,
      },
      { retrieveFrom: deps.retrieveFrom! }
    );
    expect(out.results).toHaveLength(4);
  });

  it("uses default sources when none supplied", async () => {
    const deps = buildDeps();
    const out = await runSearchBrain(
      { query: "q", __deps: deps, rerank: false },
      { retrieveFrom: deps.retrieveFrom! }
    );
    // At least OpenAlex should appear in the default set.
    expect(out.providers.map((p) => p.source)).toContain("openalex");
  });
});
