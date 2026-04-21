/**
 * SearchOrchestrator — WebGLM three-phase pipeline.
 *
 *   1. decomposeQuery   → 3-5 bilingual sub-queries
 *   2. parallelRetrieve → Promise.allSettled over (sub-query × source)
 *                         with per-provider timeout + dedupe
 *   3. rerankResults    → LLM-scored top-K with composite weights
 *
 * All dependencies (LLM client, retriever) are injected via
 * `SearchBrainDeps` so tests can substitute deterministic stubs.
 * Production wiring lives in `index.ts`.
 */

import { decomposeQuery } from "./queryDecomposer";
import { rerankResults } from "./llmReranker";
import type {
  DecomposedQuery,
  NormalisedResult,
  SearchBrainOptions,
  SearchBrainProviderTrace,
  SearchBrainResponse,
  SearchBrainSource,
  SearchBrainWeights,
} from "./types";
import { DEFAULT_ACADEMIC_SOURCES, DEFAULT_WEIGHTS } from "./types";

// ─── Utilities ────────────────────────────────────────────────────────────

function normaliseTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/\p{P}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Dedupe by DOI first (authoritative); for results without DOI fall
 * back to normalised title. Later entries lose. When titles collide
 * we keep the result with higher citation count / better score.
 */
export function dedupeResults(results: NormalisedResult[]): NormalisedResult[] {
  const byDoi = new Map<string, NormalisedResult>();
  const byTitle = new Map<string, NormalisedResult>();
  const order: NormalisedResult[] = [];

  const keep = (r: NormalisedResult) => {
    const key = r.doi ? `doi:${r.doi.toLowerCase()}` : null;
    const tkey = r.title ? `t:${normaliseTitle(r.title)}` : null;

    if (key) {
      const prev = byDoi.get(key);
      if (prev) {
        merge(prev, r);
        return;
      }
      byDoi.set(key, r);
    }
    if (tkey) {
      const prev = byTitle.get(tkey);
      if (prev) {
        merge(prev, r);
        return;
      }
      byTitle.set(tkey, r);
    }
    order.push(r);
  };

  for (const r of results) keep(r);
  return order;
}

/**
 * When two entries collapse into one, preserve the richer fields
 * (longer abstract, better URLs, higher citations).
 */
function merge(keep: NormalisedResult, drop: NormalisedResult): void {
  if (!keep.abstract && drop.abstract) keep.abstract = drop.abstract;
  if (!keep.pdfUrl && drop.pdfUrl) keep.pdfUrl = drop.pdfUrl;
  if (!keep.doi && drop.doi) keep.doi = drop.doi;
  if (drop.citationCount && drop.citationCount > (keep.citationCount ?? 0)) {
    keep.citationCount = drop.citationCount;
  }
  if (drop.openAccess && !keep.openAccess) keep.openAccess = true;
}

// ─── Parallel retrieval ───────────────────────────────────────────────────

async function parallelRetrieve(args: {
  subqueries: DecomposedQuery[];
  sources: SearchBrainSource[];
  maxPerSource: number;
  timeoutMs: number;
  mailto?: string;
  retrieveFrom: NonNullable<Parameters<typeof runPhase2>[0]["retrieveFrom"]>;
}): Promise<{ results: NormalisedResult[]; traces: SearchBrainProviderTrace[] }> {
  const { subqueries, sources, maxPerSource, timeoutMs, mailto, retrieveFrom } = args;

  // One task per (source × sub-query). Each source's traces are
  // aggregated across its sub-queries so the caller sees one row per
  // source in the response.
  type Task = Promise<{ source: SearchBrainSource; hits: NormalisedResult[]; durationMs: number; error?: string }>;
  const tasks: Task[] = [];
  for (const source of sources) {
    for (const sq of subqueries) {
      tasks.push(
        (async () => {
          const t0 = Date.now();
          try {
            const hits = await retrieveFrom({
              source,
              query: sq.text,
              maxResults: maxPerSource,
              mailto,
              timeoutMs,
            });
            return { source, hits, durationMs: Date.now() - t0 };
          } catch (err) {
            return {
              source,
              hits: [],
              durationMs: Date.now() - t0,
              error: (err as Error)?.message ?? String(err),
            };
          }
        })()
      );
    }
  }

  const settled = await Promise.allSettled(tasks);
  const perSource = new Map<
    SearchBrainSource,
    { ok: boolean; count: number; durationMs: number; error?: string }
  >();
  const pooled: NormalisedResult[] = [];

  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    const { source, hits, durationMs, error } = s.value;
    const agg = perSource.get(source) ?? { ok: true, count: 0, durationMs: 0 };
    agg.count += hits.length;
    agg.durationMs = Math.max(agg.durationMs, durationMs);
    if (error && !agg.error) {
      agg.error = error;
      agg.ok = false;
    }
    perSource.set(source, agg);
    pooled.push(...hits);
  }

  const traces: SearchBrainProviderTrace[] = sources.map((source) => {
    const agg = perSource.get(source) ?? { ok: false, count: 0, durationMs: 0, error: "no results" };
    return {
      source,
      ok: agg.ok && agg.count > 0,
      count: agg.count,
      durationMs: agg.durationMs,
      error: agg.error,
    };
  });

  return { results: dedupeResults(pooled), traces };
}

// ─── Main entrypoint ──────────────────────────────────────────────────────

/**
 * Run the full three-phase SearchBrain pipeline. The retrieve
 * implementation MUST be passed in (via options.__deps.retrieveFrom or
 * as a second argument) — the orchestrator does not import the provider
 * adapter directly so tests stay purely deterministic.
 */
export async function runSearchBrain(
  options: SearchBrainOptions,
  opts: {
    retrieveFrom: NonNullable<Parameters<typeof runPhase2>[0]["retrieveFrom"]>;
  }
): Promise<SearchBrainResponse> {
  const deps = options.__deps;
  const now = deps?.now ?? (() => Date.now());
  const t0 = now();

  const sources = sanitiseSources(options);
  const mailto = options.mailto;
  const weights: SearchBrainWeights = { ...DEFAULT_WEIGHTS, ...(options.weights ?? {}) };
  const maxResults = Math.min(Math.max(options.maxResults ?? 10, 1), 50);
  const timeoutMs = options.timeoutMs ?? 8000;

  // Phase 1 — Query Decomposition
  const p1Start = now();
  const decomposed = await decomposeQuery({
    query: options.query,
    language: options.language,
    userId: options.userId,
    deps,
  });
  const decompositionMs = now() - p1Start;

  // Phase 2 — Parallel Multi-Source Retrieval
  const p2Start = now();
  const retrieveFrom = deps?.retrieveFrom ?? opts.retrieveFrom;
  const { results: deduped, traces } = await parallelRetrieve({
    subqueries: decomposed.length > 0 ? decomposed : [{ text: options.query, language: "en" }],
    sources,
    maxPerSource: Math.max(10, Math.ceil(maxResults / Math.max(1, sources.length) + 5)),
    timeoutMs,
    mailto,
    retrieveFrom,
  });
  const retrievalMs = now() - p2Start;

  // Phase 3 — LLM Reranking (optional)
  const p3Start = now();
  let ranked = deduped;
  let reranked = false;
  if (options.rerank !== false && deps?.callLLM) {
    const result = await rerankResults({
      query: options.query,
      results: deduped,
      weights,
      userId: options.userId,
      deps,
    });
    ranked = result.results;
    reranked = result.reranked;
  } else {
    // Fallback sort: providerRank asc + citations desc.
    ranked = [...deduped].sort((a, b) => {
      const pa = a.providerRank ?? Number.MAX_SAFE_INTEGER;
      const pb = b.providerRank ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return (b.citationCount ?? 0) - (a.citationCount ?? 0);
    });
  }
  const rerankingMs = now() - p3Start;

  return {
    query: options.query,
    decomposed,
    results: ranked.slice(0, maxResults),
    timings: {
      decompositionMs,
      retrievalMs,
      rerankingMs,
      totalMs: now() - t0,
    },
    providers: traces,
    reranked,
    weights,
  };
}

function sanitiseSources(options: SearchBrainOptions): SearchBrainSource[] {
  const requested = options.sources && options.sources.length > 0
    ? options.sources
    : [...DEFAULT_ACADEMIC_SOURCES];
  // Scraping sources (scopus / wos) must be opted-in explicitly.
  return requested.filter((s) => {
    if (s === "scopus" || s === "wos") return options.enableScrapingProviders === true;
    return true;
  });
}

// ─── Type helper: forward-ref for parallelRetrieve's retrieveFrom ─────────

// This wrapper exists purely so TypeScript can quote the signature for
// parallelRetrieve without circularity in the .d.ts.
function runPhase2(args: {
  retrieveFrom: (a: {
    source: SearchBrainSource;
    query: string;
    maxResults: number;
    mailto?: string;
    timeoutMs?: number;
  }) => Promise<NormalisedResult[]>;
}): unknown {
  return args;
}
void runPhase2;

export const ORCHESTRATOR_INTERNAL = { normaliseTitle, merge, parallelRetrieve, sanitiseSources };
