/**
 * Client-side mirror of the SearchBrain response shapes.
 *
 * These are intentionally shallow duplicates of the server types
 * (server/services/searchBrain/types.ts) so the client bundle doesn't
 * import anything from `server/`. Kept narrow on purpose — only the
 * fields the panel renders.
 */

export type AcademicSource =
  | "scielo" | "redalyc" | "openalex" | "semantic" | "crossref"
  | "core" | "doaj" | "pubmed" | "arxiv" | "base" | "scopus" | "wos";

export type WebSource = "searxng" | "duckduckgo" | "wikipedia";

export interface AcademicResultCard {
  source: AcademicSource;
  title: string;
  authors: string[];
  year?: number;
  journal?: string;
  doi?: string;
  url: string;
  pdfUrl?: string;
  abstract?: string;
  citationCount?: number;
  openAccess?: boolean;
  rerankScore?: number;
}

export interface ProviderTrace {
  source: string;
  ok: boolean;
  count: number;
  durationMs: number;
  error?: string;
}

export interface AcademicResponse {
  query: string;
  results: AcademicResultCard[];
  providers: ProviderTrace[];
  reranked: boolean;
  cache?: { hit: boolean; matchedBy?: "exact" | "semantic"; similarity?: number };
  timings?: { totalMs: number };
}

export interface WebCard {
  source: WebSource;
  title: string;
  url: string;
  snippet?: string;
  host?: string;
}

export interface DeepReference {
  number: number;
  apa: string;
  type: "academic" | "web";
  url: string;
  doi?: string;
}

export interface DeepResponse {
  query: string;
  academic: AcademicResponse;
  web: { query: string; results: WebCard[]; providers: ProviderTrace[]; totalMs: number };
  synthesis: {
    answer: string;
    references: DeepReference[];
    usedCitations: number[];
    synthesised: boolean;
  };
}

export interface ProviderCatalogEntry {
  id: string;
  name: string;
  type: "api" | "scraping";
  license?: string;
  requiresOptIn?: boolean;
  rateLimitNote?: string;
}

export interface ProviderCatalog {
  defaults: AcademicSource[];
  providers: ProviderCatalogEntry[];
  webDefaults: WebSource[];
  webProviders: ProviderCatalogEntry[];
}
