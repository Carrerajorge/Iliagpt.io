import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { HTTP_HEADERS, TIMEOUTS, LIMITS } from "../lib/constants";
import { sanitizePlainText, sanitizeSearchQuery } from "../lib/textSanitizers";

export interface SearchOptions {
  maxResults?: number;
  timeout?: number;
  sources?: string[];
}

export interface DeepSearchOptions extends SearchOptions {
  maxContentLength?: number;
  concurrencyLimit?: number;
  extractContent?: boolean;
}

export interface EnhancedSearchResult {
  url: string;
  title: string;
  snippet: string;
  source: string;
  score?: number;
}

export interface DeepSearchResult extends EnhancedSearchResult {
  content?: string;
  extractedAt?: string;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

interface SearchAdapter {
  name: string;
  isAvailable(): boolean;
  search(query: string, maxResults: number, timeout: number): Promise<EnhancedSearchResult[]>;
}

const HIGH_AUTHORITY_DOMAINS = [
  "wikipedia.org", "github.com", "stackoverflow.com", "mozilla.org",
  "developer.mozilla.org", "microsoft.com", "google.com", "apple.com",
  "amazon.com", "bbc.com", "nytimes.com", "reuters.com", "nature.com",
  "arxiv.org", "ieee.org", "acm.org", "sciencedirect.com", "springer.com",
  "gov", "edu", "ac.uk"
];

const MEDIUM_AUTHORITY_DOMAINS = [
  "medium.com", "dev.to", "hackernews.com", "reddit.com", "quora.com",
  "linkedin.com", "twitter.com", "facebook.com", "youtube.com"
];

function log(level: "info" | "warn" | "error" | "debug", message: string, data?: Record<string, any>): void {
  const timestamp = new Date().toISOString();
  const logData = { timestamp, level, component: "EnhancedWebSearch", message, ...data };
  if (level === "error") {
    console.error(JSON.stringify(logData));
  } else if (level === "warn") {
    console.warn(JSON.stringify(logData));
  } else if (level === "debug" && process.env.DEBUG) {
    console.log(JSON.stringify(logData));
  } else if (level === "info") {
    console.log(JSON.stringify(logData));
  }
}

function calculateQualityScore(result: EnhancedSearchResult): number {
  let score = 50;

  try {
    const url = new URL(result.url);
    const domain = url.hostname.toLowerCase();

    if (HIGH_AUTHORITY_DOMAINS.some(d => domain.includes(d) || domain.endsWith(`.${d}`))) {
      score += 30;
    } else if (MEDIUM_AUTHORITY_DOMAINS.some(d => domain.includes(d))) {
      score += 15;
    }

    if (url.protocol === "https:") {
      score += 5;
    }
  } catch {
    score -= 10;
  }

  if (result.title && result.title.length > 10 && result.title.length < 200) {
    score += 10;
  }

  if (result.snippet) {
    if (result.snippet.length > 50) score += 5;
    if (result.snippet.length > 100) score += 5;
    if (result.snippet.length > 200) score += 5;
  }

  return Math.min(100, Math.max(0, score));
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        log("warn", `Retry attempt ${attempt + 1}/${maxRetries}`, { delay, error: lastError.message });
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

function getHeaders(): Record<string, string> {
  return {
    "User-Agent": HTTP_HEADERS.USER_AGENT,
    "Accept": HTTP_HEADERS.ACCEPT_HTML,
    "Accept-Language": HTTP_HEADERS.ACCEPT_LANGUAGE
  };
}

class SearXNGAdapter implements SearchAdapter {
  name = "searxng";

  isAvailable(): boolean {
    return !!process.env.SEARXNG_URL;
  }

  async search(query: string, maxResults: number, timeout: number): Promise<EnhancedSearchResult[]> {
    const baseUrl = process.env.SEARXNG_URL;
    if (!baseUrl) {
      throw new Error("SEARXNG_URL not configured");
    }

    const url = new URL("/search", baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("categories", "general");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url.toString(), {
        headers: {
          ...getHeaders(),
          "Accept": "application/json"
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`SearXNG request failed: ${response.status}`);
      }

      const data = await response.json();
      const results: EnhancedSearchResult[] = [];

      if (data.results && Array.isArray(data.results)) {
        for (const item of data.results.slice(0, maxResults)) {
          if (item.url && item.title) {
            const result: EnhancedSearchResult = {
              url: item.url,
              title: item.title,
              snippet: item.content || "",
              source: this.name
            };
            result.score = calculateQualityScore(result);
            results.push(result);
          }
        }
      }

      log("info", "SearXNG search completed", { query, resultCount: results.length });
      return results;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
}

class BraveSearchAdapter implements SearchAdapter {
  name = "brave";
  private apiEndpoint = "https://api.search.brave.com/res/v1/web/search";

  isAvailable(): boolean {
    return !!process.env.BRAVE_API_KEY;
  }

  async search(query: string, maxResults: number, timeout: number): Promise<EnhancedSearchResult[]> {
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
      throw new Error("BRAVE_API_KEY not configured");
    }

    const url = new URL(this.apiEndpoint);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(Math.min(maxResults, 20)));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url.toString(), {
        headers: {
          "Accept": "application/json",
          "X-Subscription-Token": apiKey
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Brave Search request failed: ${response.status}`);
      }

      const data = await response.json();
      const results: EnhancedSearchResult[] = [];

      if (data.web?.results && Array.isArray(data.web.results)) {
        for (const item of data.web.results.slice(0, maxResults)) {
          if (item.url && item.title) {
            const result: EnhancedSearchResult = {
              url: item.url,
              title: item.title,
              snippet: item.description || "",
              source: this.name
            };
            result.score = calculateQualityScore(result);
            results.push(result);
          }
        }
      }

      log("info", "Brave search completed", { query, resultCount: results.length });
      return results;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
}

class DuckDuckGoAdapter implements SearchAdapter {
  name = "duckduckgo";

  isAvailable(): boolean {
    return true;
  }

  async search(query: string, maxResults: number, timeout: number): Promise<EnhancedSearchResult[]> {
    // Apply specialized search dorks based on simple heuristics
    let isNews = false;
    let modifiedQuery = query;
    const lowerQuery = query.toLowerCase();

    if (lowerQuery.includes("noticia") || lowerQuery.includes("news") || lowerQuery.includes("última hora")) {
      isNews = true;
    } else if (lowerQuery.includes("legal") || lowerQuery.includes("ley ") || lowerQuery.includes("jurisprudencia") || lowerQuery.includes("sentencia")) {
      modifiedQuery += " (site:gov OR site:edu OR site:org)";
    } else if (lowerQuery.includes("financiero") || lowerQuery.includes("bolsa") || lowerQuery.includes("acciones") || lowerQuery.includes("financial")) {
      modifiedQuery += " (site:bloomberg.com OR site:reuters.com OR site:ft.com OR site:wsj.com)";
    } else if (lowerQuery.includes("dataset") || lowerQuery.includes("estadística") || lowerQuery.includes("datos") || lowerQuery.includes("statistics")) {
      modifiedQuery += " (site:gov OR site:org OR filetype:csv OR filetype:json)";
    }

    const searchUrl = isNews
      ? `https://html.duckduckgo.com/html/?q=${encodeURIComponent(modifiedQuery)}&iar=news`
      : `https://html.duckduckgo.com/html/?q=${encodeURIComponent(modifiedQuery)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      // Small randomized delay to avoid aggressive rate limiting
      await sleep(500 + Math.random() * 1000);

      log("info", `[DuckDuckGo] Executing basic HTML search: ${modifiedQuery}`);

      const response = await withRetry(() => fetch(searchUrl, {
        headers: getHeaders(),
        signal: controller.signal
      }), 3, 1000);

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`DuckDuckGo request failed: ${response.status}`);
      }

      const html = await response.text();
      const dom = new JSDOM(html);
      const doc = dom.window.document;
      const results: EnhancedSearchResult[] = [];

      for (const resultEl of Array.from(doc.querySelectorAll(".result")).slice(0, maxResults)) {
        const titleEl = resultEl.querySelector(".result__title a");
        const snippetEl = resultEl.querySelector(".result__snippet");

        if (titleEl) {
          const href = titleEl.getAttribute("href") || "";
          let url = href;

          if (href.includes("uddg=")) {
            const match = href.match(/uddg=([^&]+)/);
            if (match) url = decodeURIComponent(match[1]);
          }

          if (url && !url.includes("duckduckgo.com")) {
            const result: EnhancedSearchResult = {
              url,
              title: titleEl.textContent?.trim() || "",
              snippet: snippetEl?.textContent?.trim() || "",
              source: this.name
            };
            result.score = calculateQualityScore(result);
            results.push(result);
          }
        }
      }

      log("info", "DuckDuckGo search completed", { query, resultCount: results.length });
      return results;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
}

async function fetchPageContent(
  url: string,
  timeout: number = TIMEOUTS.PAGE_FETCH,
  maxLength: number = 50000
): Promise<{ title: string; content: string } | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: getHeaders()
    });

    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return null;

    const html = await response.text();
    const dom = new JSDOM(html, { url });

    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (article?.textContent) {
      const content = article.textContent.replace(/\s+/g, " ").trim();
      return {
        title: article.title || "",
        content: content.slice(0, maxLength)
      };
    }

    const doc = dom.window.document;
    const fallbackContent = doc.body?.textContent?.replace(/\s+/g, " ").trim() || "";
    return {
      title: doc.title || "",
      content: fallbackContent.slice(0, maxLength)
    };
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

async function runWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const promise = fn(item).then(result => {
      results.push(result);
    });

    executing.push(promise);

    if (executing.length >= limit) {
      await Promise.race(executing);
      executing.splice(0, executing.findIndex(p => p === promise) + 1);
    }
  }

  await Promise.all(executing);
  return results;
}

export class SearchOrchestrator {
  private adapters: SearchAdapter[] = [];
  private cache: Map<string, CacheEntry<EnhancedSearchResult[]>> = new Map();
  private deepCache: Map<string, CacheEntry<DeepSearchResult[]>> = new Map();
  private cacheTTL: number;

  /**
   * Sanitize and harden web search query input
   */
  private sanitizeQuery(raw: string): string {
    return sanitizeSearchQuery(raw, 500);
  }

  /**
   * Sanitize a search result to prevent XSS in downstream rendering
   */
  private sanitizeResult(result: EnhancedSearchResult): EnhancedSearchResult {
    return {
      ...result,
      title: sanitizePlainText(result.title || "", { maxLen: 500 }),
      snippet: sanitizePlainText(result.snippet || "", { maxLen: 2000 }),
      url: result.url || "",
      source: sanitizePlainText(result.source || "", { maxLen: 100 }),
    };
  }

  constructor(cacheTTLMs: number = 5 * 60 * 1000) {
    this.cacheTTL = cacheTTLMs;
    this.adapters = [
      new SearXNGAdapter(),
      new BraveSearchAdapter(),
      new DuckDuckGoAdapter()
    ];

    log("info", "SearchOrchestrator initialized", {
      adapters: this.adapters.map(a => ({ name: a.name, available: a.isAvailable() })),
      cacheTTL: this.cacheTTL
    });
  }

  private getCacheKey(query: string, options?: SearchOptions): string {
    return `${query}:${options?.maxResults || 10}:${(options?.sources || []).join(",")}`;
  }

  private getFromCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
    const entry = cache.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      log("debug", "Cache hit", { key });
      return entry.data;
    }
    if (entry) {
      cache.delete(key);
    }
    return null;
  }

  private setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
    cache.set(key, {
      data,
      expiresAt: Date.now() + this.cacheTTL
    });
  }

  private cleanExpiredCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
    for (const [key, entry] of this.deepCache.entries()) {
      if (entry.expiresAt <= now) {
        this.deepCache.delete(key);
      }
    }
  }

  private deduplicateByUrl(results: EnhancedSearchResult[]): EnhancedSearchResult[] {
    const seen = new Set<string>();
    const deduplicated: EnhancedSearchResult[] = [];

    for (const result of results) {
      const normalizedUrl = result.url.toLowerCase().replace(/\/$/, "");
      if (!seen.has(normalizedUrl)) {
        seen.add(normalizedUrl);
        deduplicated.push(result);
      }
    }

    return deduplicated;
  }

  private getAvailableAdapters(sources?: string[]): SearchAdapter[] {
    let available = this.adapters.filter(a => a.isAvailable());

    if (sources && sources.length > 0) {
      available = available.filter(a => sources.includes(a.name));
    }

    return available;
  }

  async search(query: string, options?: SearchOptions): Promise<EnhancedSearchResult[]> {
    const startTime = Date.now();
    const maxResults = Math.max(1, Math.min(100, options?.maxResults || LIMITS.MAX_SEARCH_RESULTS));
    const timeout = Math.max(1000, Math.min(30000, options?.timeout || 15000));

    // Sanitize query input
    const sanitizedQuery = this.sanitizeQuery(query);
    if (!sanitizedQuery) {
      log("warn", "Empty query after sanitization");
      return [];
    }
    const cacheKey = this.getCacheKey(sanitizedQuery, options);
    const cached = this.getFromCache(this.cache, cacheKey);
    if (cached) {
      return cached;
    }

    const adapters = this.getAvailableAdapters(options?.sources);

    if (adapters.length === 0) {
      log("error", "No search adapters available", { requestedSources: options?.sources });
      return [];
    }

    log("info", "Starting search", { query: sanitizedQuery, maxResults, adapters: adapters.map(a => a.name) });

    let results: EnhancedSearchResult[] = [];
    let lastError: Error | null = null;

    for (const adapter of adapters) {
      try {
        results = await withRetry(
          () => adapter.search(sanitizedQuery, maxResults, timeout),
          2,
          500
        );

        if (results.length > 0) {
          log("info", "Search successful", {
            adapter: adapter.name,
            resultCount: results.length,
            durationMs: Date.now() - startTime
          });
          break;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        log("warn", `Adapter ${adapter.name} failed, trying next`, { error: lastError.message });
      }
    }

    if (results.length === 0 && lastError) {
      log("error", "All search adapters failed", { error: lastError.message });
    }

    // Sanitize all results to prevent XSS
    results = results.map(r => this.sanitizeResult(r));
    results = this.deduplicateByUrl(results);
    results.sort((a, b) => (b.score || 0) - (a.score || 0));
    results = results.slice(0, maxResults);

    this.setCache(this.cache, cacheKey, results);

    if (this.cache.size > 100) {
      this.cleanExpiredCache();
    }

    return results;
  }

  async deepSearch(query: string, options?: DeepSearchOptions): Promise<DeepSearchResult[]> {
    const startTime = Date.now();
    const maxResults = Math.max(1, Math.min(50, options?.maxResults || LIMITS.MAX_SEARCH_RESULTS));
    const maxContentLength = Math.max(1000, Math.min(50000, options?.maxContentLength || 10000));
    const concurrencyLimit = Math.max(1, Math.min(10, options?.concurrencyLimit || 3));
    const extractContent = options?.extractContent !== false;

    const cacheKey = `deep:${this.getCacheKey(query, options)}`;
    const cached = this.getFromCache(this.deepCache, cacheKey);
    if (cached) {
      return cached;
    }

    log("info", "Starting deep search", { query, maxResults, concurrencyLimit });

    const searchResults = await this.search(query, {
      maxResults: maxResults + 5,
      timeout: options?.timeout,
      sources: options?.sources
    });

    if (!extractContent) {
      const results: DeepSearchResult[] = searchResults.slice(0, maxResults).map(r => ({
        ...r,
        extractedAt: new Date().toISOString()
      }));
      this.setCache(this.deepCache, cacheKey, results);
      return results;
    }

    const urlsToFetch = searchResults
      .filter(r => r.url && r.url.startsWith("http"))
      .slice(0, maxResults);

    const fetchResults = await runWithConcurrencyLimit(
      urlsToFetch,
      concurrencyLimit,
      async (result): Promise<DeepSearchResult> => {
        try {
          const content = await fetchPageContent(
            result.url,
            options?.timeout || TIMEOUTS.PAGE_FETCH,
            maxContentLength
          );

          return {
            ...result,
            content: content?.content,
            extractedAt: new Date().toISOString()
          };
        } catch {
          return {
            ...result,
            extractedAt: new Date().toISOString()
          };
        }
      }
    );

    const results = fetchResults
      .filter((r): r is DeepSearchResult => r !== null)
      .sort((a, b) => (b.score || 0) - (a.score || 0));

    log("info", "Deep search completed", {
      query,
      totalResults: results.length,
      withContent: results.filter(r => r.content).length,
      durationMs: Date.now() - startTime
    });

    this.setCache(this.deepCache, cacheKey, results);

    if (this.deepCache.size > 50) {
      this.cleanExpiredCache();
    }

    return results;
  }

  getAvailableSources(): string[] {
    return this.adapters.filter(a => a.isAvailable()).map(a => a.name);
  }

  clearCache(): void {
    this.cache.clear();
    this.deepCache.clear();
    log("info", "Cache cleared");
  }
}

export const searchOrchestrator = new SearchOrchestrator();
