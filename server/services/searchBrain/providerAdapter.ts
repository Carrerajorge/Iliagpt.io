/**
 * providerAdapter — bridges SearchBrain's normalised contract to the
 * existing `unifiedAcademicSearch` module so we don't duplicate the
 * 1400-line provider library.
 *
 * Each unifiedAcademicSearch provider returns its own AcademicResult
 * shape; this file translates that into `NormalisedResult` while
 * preserving the original in `raw` for export + debugging.
 *
 * Scopus and WoS live there as scraping fallbacks; we expose them
 * behind `enableScrapingProviders` (caller decides). Redalyc is
 * implemented natively in `redalycProvider.ts` because the existing
 * module doesn't ship a Redalyc connector.
 */

import type { AcademicResult, SearchOptions } from "../unifiedAcademicSearch";
import {
  searchScielo,
  searchScholar,
  searchOpenAlex,
  searchSemanticScholar,
  searchCrossRef,
  searchCORE,
  searchDOAJ,
  searchPubMed,
  searchArXiv,
  searchBASE,
  searchScopus,
  searchWOS,
} from "../unifiedAcademicSearch";
import { searchRedalyc } from "./redalycProvider";
import type { NormalisedResult, SearchBrainSource } from "./types";

// ─── Normalisation ────────────────────────────────────────────────────────

function splitAuthors(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;]| and /i)
    .map((a) => a.trim())
    .filter(Boolean);
}

function parseYear(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = raw.match(/\d{4}/);
  if (!m) return undefined;
  const n = Number(m[0]);
  if (!Number.isFinite(n) || n < 1500 || n > 2100) return undefined;
  return n;
}

function toNormalised(
  source: SearchBrainSource,
  result: AcademicResult,
  rank: number
): NormalisedResult {
  return {
    source,
    title: result.title,
    authors: splitAuthors(result.authors),
    year: parseYear(result.year),
    journal: result.journal,
    doi: result.doi,
    url: result.url,
    pdfUrl: result.pdfUrl,
    abstract: result.abstract,
    citationCount: result.citations,
    language: result.language,
    openAccess: result.openAccess,
    providerScore: typeof result.score === "number" ? result.score : undefined,
    providerRank: rank,
    raw: result,
  };
}

// ─── Dispatch table ───────────────────────────────────────────────────────

type ProviderFn = (query: string, options?: SearchOptions) => Promise<AcademicResult[]>;

/**
 * Map SearchBrainSource → provider fn in unifiedAcademicSearch.
 * Missing entries (e.g. redalyc) are handled by the native branch.
 */
const WRAPPED: Partial<Record<SearchBrainSource, ProviderFn>> = {
  scielo: searchScielo,
  openalex: searchOpenAlex,
  semantic: searchSemanticScholar,
  crossref: searchCrossRef,
  core: searchCORE,
  doaj: searchDOAJ,
  pubmed: searchPubMed,
  arxiv: searchArXiv,
  base: searchBASE,
  scopus: searchScopus,
  wos: searchWOS,
};

// Scholar wrapping kept for completeness even though SearchBrain doesn't
// ship it in DEFAULT_ACADEMIC_SOURCES (Scholar has no real API and we
// prefer OpenAlex for coverage).
void searchScholar;

/**
 * Run a single (source, query) retrieval and normalise the output.
 * Adds per-provider timeout via Promise.race so a slow provider doesn't
 * block the fan-out; the orchestrator's Promise.allSettled catches the
 * rejection and records it as a failed trace.
 */
export async function retrieveFromProvider(args: {
  source: SearchBrainSource;
  query: string;
  maxResults: number;
  mailto?: string;
  timeoutMs?: number;
}): Promise<NormalisedResult[]> {
  const { source, query, maxResults } = args;
  const timeoutMs = args.timeoutMs ?? 8000;

  const options: SearchOptions = {
    maxResults,
    timeout: timeoutMs,
  };

  let results: AcademicResult[];
  if (source === "redalyc") {
    results = await withTimeout(
      searchRedalyc({ query, maxResults, timeoutMs }),
      timeoutMs
    );
  } else {
    const fn = WRAPPED[source];
    if (!fn) return [];
    results = await withTimeout(fn(query, options), timeoutMs);
  }

  return results.map((r, i) => toNormalised(source, r, i));
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<T>([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`provider timeout after ${ms}ms`)),
          ms
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const PROVIDER_ADAPTER_INTERNAL = {
  splitAuthors,
  parseYear,
  toNormalised,
};
