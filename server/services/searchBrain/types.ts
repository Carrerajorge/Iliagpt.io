/**
 * SearchBrain — WebGLM-inspired academic + web search orchestration.
 *
 * This module sits ON TOP of the existing multi-provider academic
 * search in `unifiedAcademicSearch.ts`. It adds the three phases the
 * WebGLM paper (Liu et al. 2023) contributes over naive multi-source
 * retrieval:
 *
 *   1. Query Decomposition — LLM rewrites the user's natural-language
 *      query into 3-5 retrieval-friendly sub-queries in ES + EN so
 *      downstream providers see the best possible search keys.
 *   2. Parallel Multi-Source Retrieval — wraps unifiedAcademicSearch
 *      behind a uniform contract, running providers concurrently with
 *      per-source timeouts and dedupe by DOI + normalised title.
 *   3. LLM Re-ranking — the top candidates are re-scored by the same
 *      LLM using a relevance rubric, keeping only the top-K.
 *
 * This file holds the SHARED TYPES. Implementation is split across
 * sibling files so each phase stays small and independently testable.
 */

// ─── Provider identifiers ─────────────────────────────────────────────────

/**
 * Every provider the orchestrator knows about. Wrapped providers
 * delegate to unifiedAcademicSearch; native providers are implemented
 * inside this module (redalyc for now).
 *
 * Note: scopus and wos are scraped and require explicit user opt-in.
 */
export type SearchBrainSource =
  | "scielo"
  | "redalyc"
  | "openalex"
  | "semantic"
  | "crossref"
  | "core"
  | "doaj"
  | "pubmed"
  | "arxiv"
  | "base"
  | "scopus"
  | "wos";

export const DEFAULT_ACADEMIC_SOURCES: ReadonlyArray<SearchBrainSource> = [
  "openalex",
  "semantic",
  "crossref",
  "arxiv",
  "pubmed",
  "scielo",
  "doaj",
];

/**
 * User-visible provider descriptor (for the GET /providers endpoint).
 */
export interface ProviderDescriptor {
  id: SearchBrainSource;
  name: string;
  type: "api" | "scraping";
  license: "CC0" | "open" | "requires-key" | "scraping-opt-in";
  requiresOptIn: boolean;
  /** Short note on rate limits / policies from the provider's own docs. */
  rateLimitNote: string;
}

// ─── Normalised result shape ──────────────────────────────────────────────

/**
 * Unified result shape across all providers. Every field that a caller
 * might display on a paper card is optional so providers can fill in
 * only what they actually return.
 *
 * Kept intentionally narrow; richer provider-native metadata lives
 * inside `raw`. Consumers that need it drill in; the orchestrator
 * operates on the top-level fields only.
 */
export interface NormalisedResult {
  source: SearchBrainSource;
  title: string;
  authors: string[];
  year?: number;
  journal?: string;
  doi?: string;
  url: string;
  pdfUrl?: string;
  abstract?: string;
  citationCount?: number;
  language?: string;
  openAccess?: boolean;
  /** Orchestrator-assigned relevance score after LLM rerank (0-10). */
  rerankScore?: number;
  /** Orchestrator-assigned provider-side relevance (heuristic, 0-1). */
  providerScore?: number;
  /** 0-indexed position within this provider's returned list. */
  providerRank?: number;
  /** Opaque provider-native payload, preserved for debugging / export. */
  raw?: unknown;
}

// ─── Orchestrator configuration ───────────────────────────────────────────

export interface SearchBrainWeights {
  /** Weight for LLM re-rank relevance score. */
  rerank: number;
  /** Weight for provider's own rank (1/(1+rank) style). */
  providerRank: number;
  /** Weight for citation count (log-scaled). */
  citations: number;
  /** Weight applied when the paper is open access. */
  openAccessBoost: number;
}

export const DEFAULT_WEIGHTS: SearchBrainWeights = {
  rerank: 1.0,
  providerRank: 0.3,
  citations: 0.2,
  openAccessBoost: 0.1,
};

/**
 * One decomposed sub-query plus which language it targets. The
 * orchestrator fans out one retrieval per (sub-query × provider)
 * combination (deduplicated on the client side).
 */
export interface DecomposedQuery {
  text: string;
  language: "es" | "en";
  rationale?: string;
}

export interface SearchBrainPhaseTimings {
  decompositionMs: number;
  retrievalMs: number;
  rerankingMs: number;
  totalMs: number;
}

export interface SearchBrainProviderTrace {
  source: SearchBrainSource;
  ok: boolean;
  count: number;
  durationMs: number;
  error?: string;
}

export interface SearchBrainResponse {
  query: string;
  decomposed: DecomposedQuery[];
  results: NormalisedResult[];
  timings: SearchBrainPhaseTimings;
  providers: SearchBrainProviderTrace[];
  /** True when the LLM reranker actually ran (vs skipped). */
  reranked: boolean;
  weights: SearchBrainWeights;
}

// ─── Options ──────────────────────────────────────────────────────────────

export interface SearchBrainOptions {
  /** The raw user query in any language. */
  query: string;
  sources?: SearchBrainSource[];
  maxResults?: number;
  /** Skip the LLM reranker — useful for fast mode / when LLM is down. */
  rerank?: boolean;
  /** "es" / "en" / "auto". Controls decomposition target language. */
  language?: "es" | "en" | "auto";
  /** Propagated to LLMGateway for rate-limit attribution. */
  userId?: string;
  /** Polite-pool email handed to providers that require one. */
  mailto?: string;
  /** Per-provider soft timeout. */
  timeoutMs?: number;
  weights?: Partial<SearchBrainWeights>;
  /**
   * When true, and Scopus / WoS scraping providers are in `sources`,
   * the orchestrator will honour them. Defaults to false — the
   * frontend forces the user to opt in explicitly from Settings.
   */
  enableScrapingProviders?: boolean;
  /** Optional overrides injected by tests. */
  __deps?: SearchBrainDeps;
}

// ─── Dependency injection seam (for tests) ────────────────────────────────

/**
 * The orchestrator pulls its dependencies through a single struct so
 * tests can substitute deterministic stubs for the LLM client and the
 * provider fan-out. Production callers leave this undefined.
 */
export interface SearchBrainDeps {
  /**
   * Runs the LLM for decomposition + reranking. Signature mirrors the
   * LLMGateway contract but trimmed to the fields SearchBrain needs.
   */
  callLLM?: (args: {
    system: string;
    user: string;
    userId?: string;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
  }) => Promise<{ content: string }>;
  /**
   * Runs a single (source, query) retrieval. Returns already-normalised
   * results; the adapter over unifiedAcademicSearch lives outside this
   * seam.
   */
  retrieveFrom?: (args: {
    source: SearchBrainSource;
    query: string;
    maxResults: number;
    mailto?: string;
    timeoutMs?: number;
  }) => Promise<NormalisedResult[]>;
  /** Clock — stubbable for deterministic timing assertions. */
  now?: () => number;
}
