/**
 * webOrchestrator — parallel web search across SearXNG + DuckDuckGo +
 * Wikipedia, with dedupe by normalised URL. Simpler than the academic
 * orchestrator because web results have no DOI and no reliable
 * citation count, so there's no LLM-based reranking here — the
 * provider order is already quality-sorted.
 *
 * The orchestrator DOES accept the same dependency-injection seam
 * (fetcher fn) so tests stay deterministic.
 */

import { searchSearxng, searchDuckDuckGo, searchWikipedia } from "./webProviders";
import type { WebResult } from "./webProviders";

export type WebSource = "searxng" | "duckduckgo" | "wikipedia";

export const DEFAULT_WEB_SOURCES: ReadonlyArray<WebSource> = ["wikipedia", "duckduckgo", "searxng"];

export interface WebOrchestratorOptions {
  query: string;
  sources?: WebSource[];
  maxResults?: number;
  timeoutMs?: number;
  /** Language hint for Wikipedia ("en" / "es" / …). */
  language?: string;
  /** Test hook. */
  providerFns?: Partial<Record<WebSource, (query: string, max: number, timeoutMs: number, language?: string) => Promise<WebResult[]>>>;
}

export interface WebOrchestratorTrace {
  source: WebSource;
  ok: boolean;
  count: number;
  durationMs: number;
  error?: string;
}

export interface WebOrchestratorResponse {
  query: string;
  results: WebResult[];
  providers: WebOrchestratorTrace[];
  totalMs: number;
}

/** Normalise URL for dedupe: strip fragment, lowercase host, drop trailing slash. */
export function normaliseUrlForDedupe(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    let s = u.toString();
    // Drop trailing slash on root path.
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return url.trim().toLowerCase();
  }
}

export function dedupeWebResults(results: WebResult[]): WebResult[] {
  const seen = new Map<string, WebResult>();
  const order: WebResult[] = [];
  for (const r of results) {
    const key = normaliseUrlForDedupe(r.url);
    if (seen.has(key)) continue;
    seen.set(key, r);
    order.push(r);
  }
  return order;
}

export async function runWebSearch(options: WebOrchestratorOptions): Promise<WebOrchestratorResponse> {
  const { query } = options;
  const start = Date.now();
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return { query: "", results: [], providers: [], totalMs: 0 };
  }
  const sources = options.sources && options.sources.length > 0 ? options.sources : [...DEFAULT_WEB_SOURCES];
  const maxResults = Math.min(Math.max(options.maxResults ?? 15, 1), 50);
  const perProvider = Math.ceil(maxResults * 1.5);
  const timeoutMs = options.timeoutMs ?? 8000;
  const language = options.language;

  const tasks = sources.map(async (source): Promise<{ source: WebSource; hits: WebResult[]; durationMs: number; error?: string }> => {
    const t0 = Date.now();
    try {
      const fn = options.providerFns?.[source] ?? defaultProviderFn(source);
      const hits = await fn(query, perProvider, timeoutMs, language);
      return { source, hits, durationMs: Date.now() - t0 };
    } catch (err) {
      return {
        source,
        hits: [],
        durationMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  const settled = await Promise.allSettled(tasks);
  const pool: WebResult[] = [];
  const providers: WebOrchestratorTrace[] = [];
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    const { source, hits, durationMs, error } = s.value;
    providers.push({ source, ok: !error && hits.length > 0, count: hits.length, durationMs, error });
    pool.push(...hits);
  }

  const deduped = dedupeWebResults(pool).slice(0, maxResults);
  return { query, results: deduped, providers, totalMs: Date.now() - start };
}

function defaultProviderFn(
  source: WebSource
): (query: string, max: number, timeoutMs: number, language?: string) => Promise<WebResult[]> {
  switch (source) {
    case "searxng":
      return (q, max, t) => searchSearxng({ query: q, maxResults: max, timeoutMs: t });
    case "duckduckgo":
      return (q, max, t) => searchDuckDuckGo({ query: q, maxResults: max, timeoutMs: t });
    case "wikipedia":
      return (q, max, t, lang) => searchWikipedia({ query: q, maxResults: Math.min(max, 5), timeoutMs: t, language: lang });
  }
}

export const WEB_ORCHESTRATOR_INTERNAL = { normaliseUrlForDedupe, dedupeWebResults };
