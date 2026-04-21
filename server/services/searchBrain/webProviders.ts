/**
 * webProviders — general web search layer for SearchBrain.
 *
 * Three complementary back-ends, none requires a paid API key:
 *
 *   - searxng:      rotates across public SearXNG instances that
 *                   expose JSON. Because individual instances go down
 *                   / rate-limit without warning, we fail-over to the
 *                   next instance in the list until one returns.
 *   - duckduckgo:   HTML scraping of the lite endpoint. Lightweight,
 *                   stable markup, but no rate-limit budget info — we
 *                   keep the request cap low (1 page per call).
 *   - wikipedia:    the REST summary endpoint after an OpenSearch
 *                   candidate lookup. Authoritative encyclopedic
 *                   context; cheap and well-rate-limited.
 *
 * All three normalise into WebResult. The orchestrator fan-outs in
 * parallel and dedupes by URL. Individual provider failures produce
 * an empty array + a trace entry — never an exception that kills the
 * request.
 */

import { load as cheerioLoad } from "cheerio";

const USER_AGENT = "IliaGPT-SearchBrain/1.0 (+https://iliagpt.io; responsible web retrieval)";

export interface WebResult {
  /** Stable provider tag used by the orchestrator for per-source traces. */
  source: "searxng" | "duckduckgo" | "wikipedia";
  title: string;
  url: string;
  snippet?: string;
  /** Optional host name extracted from URL for grouping/display. */
  host?: string;
  /** Provider-assigned rank within its own list (0-indexed). */
  providerRank?: number;
}

// ─── SearXNG rotation ─────────────────────────────────────────────────────

/**
 * Default rotation list. All instances are public + have JSON output
 * enabled at time of writing. Callers can override via options.instances.
 *
 * Instances sometimes IP-ban scrapers; we keep the list short and
 * identify ourselves explicitly. Operators who self-host their own
 * SearXNG should pass { instances: ["https://your.searx.local"] }.
 */
export const DEFAULT_SEARXNG_INSTANCES = [
  "https://searx.be",
  "https://search.brave4u.com",
  "https://priv.au",
  "https://searx.tiekoetter.com",
];

export interface SearxngOptions {
  query: string;
  maxResults?: number;
  timeoutMs?: number;
  instances?: string[];
  fetcher?: (url: string, init: { timeoutMs: number }) => Promise<Response | null>;
}

export async function searchSearxng(options: SearxngOptions): Promise<WebResult[]> {
  const { query } = options;
  if (!query || typeof query !== "string" || query.trim().length === 0) return [];
  const maxResults = options.maxResults ?? 20;
  const timeoutMs = options.timeoutMs ?? 8000;
  const instances = options.instances ?? DEFAULT_SEARXNG_INSTANCES;
  const fetcher = options.fetcher ?? defaultJsonFetcher;

  for (const baseUrl of instances) {
    const url = `${stripTrailingSlash(baseUrl)}/search?q=${encodeURIComponent(query)}&format=json`;
    const res = await fetcher(url, { timeoutMs });
    if (!res || !res.ok) continue;
    try {
      const json = (await res.json()) as unknown;
      const parsed = parseSearxngJson(json, maxResults);
      if (parsed.length > 0) return parsed;
    } catch {
      // Malformed JSON — try next instance.
    }
  }
  return [];
}

export function parseSearxngJson(json: unknown, maxResults: number): WebResult[] {
  const out: WebResult[] = [];
  if (!isRecord(json) || !Array.isArray(json.results)) return out;
  for (const row of json.results) {
    if (out.length >= maxResults) break;
    if (!isRecord(row)) continue;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const urlStr = typeof row.url === "string" ? row.url.trim() : "";
    if (!title || !urlStr) continue;
    out.push({
      source: "searxng",
      title,
      url: urlStr,
      snippet: typeof row.content === "string" ? row.content.slice(0, 500) : undefined,
      host: safeHost(urlStr),
      providerRank: out.length,
    });
  }
  return out;
}

// ─── DuckDuckGo HTML ──────────────────────────────────────────────────────

export interface DuckDuckGoOptions {
  query: string;
  maxResults?: number;
  timeoutMs?: number;
  fetcher?: (url: string, init: { timeoutMs: number }) => Promise<Response | null>;
}

export async function searchDuckDuckGo(options: DuckDuckGoOptions): Promise<WebResult[]> {
  const { query } = options;
  if (!query || typeof query !== "string" || query.trim().length === 0) return [];
  const maxResults = options.maxResults ?? 20;
  const timeoutMs = options.timeoutMs ?? 8000;
  const fetcher = options.fetcher ?? defaultHtmlFetcher;

  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetcher(url, { timeoutMs });
  if (!res || !res.ok) return [];
  const html = await res.text();
  return parseDuckDuckGoHtml(html, maxResults);
}

export function parseDuckDuckGoHtml(html: string, maxResults: number): WebResult[] {
  const $ = cheerioLoad(html);
  const out: WebResult[] = [];
  $("div.result, div.web-result").each((_, el) => {
    if (out.length >= maxResults) return;
    const node = $(el);
    const anchor = node.find("a.result__a, a.result__url, h2 a").first();
    const title = anchor.text().trim();
    let href = anchor.attr("href") || "";
    // DuckDuckGo's HTML endpoint wraps target URLs in a redirect, e.g.
    // //duckduckgo.com/l/?uddg=<encoded>. Unwrap so callers see the real host.
    href = unwrapDuckDuckGoRedirect(href);
    if (!title || !href) return;
    const snippet = node.find(".result__snippet").first().text().trim();
    out.push({
      source: "duckduckgo",
      title,
      url: href,
      snippet: snippet ? snippet.slice(0, 500) : undefined,
      host: safeHost(href),
      providerRank: out.length,
    });
  });
  return out;
}

function unwrapDuckDuckGoRedirect(href: string): string {
  if (!href) return href;
  if (href.startsWith("//")) href = `https:${href}`;
  try {
    const u = new URL(href);
    if (/duckduckgo\.com/.test(u.hostname) && u.searchParams.has("uddg")) {
      const real = u.searchParams.get("uddg");
      if (real) return decodeURIComponent(real);
    }
  } catch {
    // Malformed URL — pass through unchanged.
  }
  return href;
}

// ─── Wikipedia ────────────────────────────────────────────────────────────

export interface WikipediaOptions {
  query: string;
  maxResults?: number;
  timeoutMs?: number;
  language?: string;
  fetcher?: (url: string, init: { timeoutMs: number }) => Promise<Response | null>;
}

export async function searchWikipedia(options: WikipediaOptions): Promise<WebResult[]> {
  const { query } = options;
  if (!query || typeof query !== "string" || query.trim().length === 0) return [];
  const maxResults = options.maxResults ?? 5;
  const timeoutMs = options.timeoutMs ?? 8000;
  const lang = options.language ?? "en";
  const fetcher = options.fetcher ?? defaultJsonFetcher;

  // Step 1 — OpenSearch for candidate titles.
  const openSearchUrl = `https://${lang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(
    query
  )}&limit=${maxResults}&namespace=0&format=json`;
  const listRes = await fetcher(openSearchUrl, { timeoutMs });
  if (!listRes || !listRes.ok) return [];
  let titles: string[];
  try {
    const body = (await listRes.json()) as unknown;
    titles = parseOpenSearchTitles(body, maxResults);
  } catch {
    return [];
  }
  if (titles.length === 0) return [];

  // Step 2 — fetch summary per title in parallel (page summary endpoint).
  const summaries = await Promise.all(
    titles.map(async (title, rank) => {
      const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const res = await fetcher(url, { timeoutMs });
      if (!res || !res.ok) return null;
      try {
        const json = (await res.json()) as unknown;
        return parseWikipediaSummary(json, title, rank);
      } catch {
        return null;
      }
    })
  );
  return summaries.filter((x): x is WebResult => x !== null);
}

export function parseOpenSearchTitles(body: unknown, maxResults: number): string[] {
  if (!Array.isArray(body) || body.length < 2) return [];
  const candidates = body[1];
  if (!Array.isArray(candidates)) return [];
  const out: string[] = [];
  for (const t of candidates) {
    if (typeof t === "string" && t.trim()) out.push(t.trim());
    if (out.length >= maxResults) break;
  }
  return out;
}

export function parseWikipediaSummary(json: unknown, title: string, rank: number): WebResult | null {
  if (!isRecord(json)) return null;
  const pageUrl =
    isRecord(json.content_urls) && isRecord(json.content_urls.desktop) && typeof json.content_urls.desktop.page === "string"
      ? json.content_urls.desktop.page
      : typeof json.content_urls === "object" && json.content_urls !== null
        ? undefined
        : undefined;
  const extract = typeof json.extract === "string" ? json.extract : "";
  const url = pageUrl || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  return {
    source: "wikipedia",
    title: typeof json.title === "string" ? json.title : title,
    url,
    snippet: extract ? extract.slice(0, 600) : undefined,
    host: safeHost(url),
    providerRank: rank,
  };
}

// ─── Shared helpers ───────────────────────────────────────────────────────

async function defaultJsonFetcher(url: string, init: { timeoutMs: number }): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function defaultHtmlFetcher(url: string, init: { timeoutMs: number }): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: controller.signal,
    });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

export const WEB_PROVIDERS_INTERNAL = {
  parseSearxngJson,
  parseDuckDuckGoHtml,
  unwrapDuckDuckGoRedirect,
  parseOpenSearchTitles,
  parseWikipediaSummary,
  safeHost,
};
