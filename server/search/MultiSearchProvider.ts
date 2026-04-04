/**
 * MultiSearchProvider — unified search interface across multiple providers.
 * Implements auto-fallback, result deduplication, ranking, rate limiting,
 * and cost tracking across DuckDuckGo, Brave, Tavily, SerpAPI, Google CSE, and Bing.
 */

import { EventEmitter } from "events";
import { createLogger } from "../utils/logger";
import { AppError } from "../utils/errors";

const logger = createLogger("MultiSearchProvider");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source: string;
  score?: number;
  favicon?: string;
}

export interface SearchOptions {
  query: string;
  maxResults?: number;
  providers?: SearchProviderName[];
  mergeResults?: boolean;
  deduplicate?: boolean;
  safeSearch?: boolean;
  freshness?: "day" | "week" | "month" | "year";
  language?: string;
  region?: string;
}

export interface SearchResponse {
  results: SearchResult[];
  totalResults?: number;
  searchTime: number;
  providers: string[];
  cost: number;
  cached: boolean;
}

export type SearchProviderName =
  | "duckduckgo"
  | "brave"
  | "tavily"
  | "serpapi"
  | "google"
  | "bing";

export interface ISearchProvider {
  name: SearchProviderName;
  costPerQuery: number;
  rateLimit: number; // requests per minute
  search(options: SearchOptions): Promise<SearchResult[]>;
  isAvailable(): boolean;
}

interface RateLimiterState {
  count: number;
  windowStart: number;
}

interface ProviderStats {
  requests: number;
  failures: number;
  totalCost: number;
  avgLatencyMs: number;
}

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

class RateLimiter {
  private state = new Map<string, RateLimiterState>();

  async checkAndConsume(provider: string, limitPerMinute: number): Promise<boolean> {
    const now = Date.now();
    const s = this.state.get(provider) ?? { count: 0, windowStart: now };

    if (now - s.windowStart >= 60_000) {
      s.count = 0;
      s.windowStart = now;
    }

    if (s.count >= limitPerMinute) return false;

    s.count++;
    this.state.set(provider, s);
    return true;
  }

  getUsage(provider: string): number {
    return this.state.get(provider)?.count ?? 0;
  }
}

// ─── DuckDuckGo Provider (free) ───────────────────────────────────────────────

class DuckDuckGoProvider implements ISearchProvider {
  name: SearchProviderName = "duckduckgo";
  costPerQuery = 0;
  rateLimit = 60;

  isAvailable(): boolean {
    return true; // no API key required
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      q: options.query,
      format: "json",
      no_html: "1",
      skip_disambig: "1",
      ...(options.safeSearch === false ? { kp: "-2" } : {}),
    });

    const resp = await fetch(`https://api.duckduckgo.com/?${params}`, {
      headers: { "User-Agent": "IliaGPT/1.0 (Research Assistant)" },
      signal: AbortSignal.timeout(8_000),
    });

    if (!resp.ok) throw new AppError(`DuckDuckGo API error ${resp.status}`, 502, "SEARCH_PROVIDER_ERROR");

    const data = (await resp.json()) as {
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
      AbstractURL?: string;
      AbstractText?: string;
      AbstractSource?: string;
    };

    const results: SearchResult[] = [];

    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.AbstractSource ?? "DuckDuckGo",
        url: data.AbstractURL,
        snippet: data.AbstractText,
        source: "duckduckgo",
        score: 1.0,
      });
    }

    for (const topic of data.RelatedTopics ?? []) {
      if (topic.FirstURL && topic.Text) {
        results.push({
          title: topic.Text.split(" - ")[0] ?? topic.Text,
          url: topic.FirstURL,
          snippet: topic.Text,
          source: "duckduckgo",
          score: 0.7,
        });
      }
      if (results.length >= (options.maxResults ?? 10)) break;
    }

    return results.slice(0, options.maxResults ?? 10);
  }
}

// ─── Brave Search Provider ────────────────────────────────────────────────────

class BraveSearchProvider implements ISearchProvider {
  name: SearchProviderName = "brave";
  costPerQuery = 0.003; // $3 per 1000 queries
  rateLimit = 100;

  private apiKey: string;
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      q: options.query,
      count: String(options.maxResults ?? 10),
      ...(options.freshness ? { freshness: options.freshness } : {}),
      ...(options.language ? { search_lang: options.language } : {}),
      ...(options.region ? { country: options.region } : {}),
    });

    const resp = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": this.apiKey,
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!resp.ok) throw new AppError(`Brave API error ${resp.status}`, 502, "SEARCH_PROVIDER_ERROR");

    const data = (await resp.json()) as {
      web?: { results?: Array<{ title: string; url: string; description: string; page_age?: string }> };
    };

    return (data.web?.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
      publishedAt: r.page_age,
      source: "brave",
      score: 0.9,
    }));
  }
}

// ─── Tavily Provider ──────────────────────────────────────────────────────────

class TavilyProvider implements ISearchProvider {
  name: SearchProviderName = "tavily";
  costPerQuery = 0.01;
  rateLimit = 60;

  private apiKey: string;
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const resp = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        query: options.query,
        max_results: options.maxResults ?? 10,
        include_answer: false,
        include_raw_content: false,
        search_depth: "basic",
      }),
      signal: AbortSignal.timeout(12_000),
    });

    if (!resp.ok) throw new AppError(`Tavily API error ${resp.status}`, 502, "SEARCH_PROVIDER_ERROR");

    const data = (await resp.json()) as {
      results?: Array<{ title: string; url: string; content: string; published_date?: string; score?: number }>;
    };

    return (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      publishedAt: r.published_date,
      source: "tavily",
      score: r.score ?? 0.8,
    }));
  }
}

// ─── SerpAPI Provider ─────────────────────────────────────────────────────────

class SerpAPIProvider implements ISearchProvider {
  name: SearchProviderName = "serpapi";
  costPerQuery = 0.005;
  rateLimit = 100;

  private apiKey: string;
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      api_key: this.apiKey,
      q: options.query,
      num: String(options.maxResults ?? 10),
      engine: "google",
      ...(options.language ? { hl: options.language } : {}),
      ...(options.region ? { gl: options.region } : {}),
    });

    const resp = await fetch(`https://serpapi.com/search?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) throw new AppError(`SerpAPI error ${resp.status}`, 502, "SEARCH_PROVIDER_ERROR");

    const data = (await resp.json()) as {
      organic_results?: Array<{ title: string; link: string; snippet: string; date?: string; favicon?: string }>;
    };

    return (data.organic_results ?? []).map((r) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet,
      publishedAt: r.date,
      favicon: r.favicon,
      source: "serpapi",
      score: 0.95,
    }));
  }
}

// ─── Google Custom Search Provider ───────────────────────────────────────────

class GoogleCSEProvider implements ISearchProvider {
  name: SearchProviderName = "google";
  costPerQuery = 0.005;
  rateLimit = 100;

  private apiKey: string;
  private cseId: string;

  constructor(apiKey: string, cseId: string) {
    this.apiKey = apiKey;
    this.cseId = cseId;
  }

  isAvailable(): boolean {
    return !!(this.apiKey && this.cseId);
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      key: this.apiKey,
      cx: this.cseId,
      q: options.query,
      num: String(Math.min(options.maxResults ?? 10, 10)),
      ...(options.safeSearch === false ? { safe: "off" } : { safe: "active" }),
      ...(options.language ? { lr: `lang_${options.language}` } : {}),
    });

    const resp = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`, {
      signal: AbortSignal.timeout(8_000),
    });

    if (!resp.ok) throw new AppError(`Google CSE error ${resp.status}`, 502, "SEARCH_PROVIDER_ERROR");

    const data = (await resp.json()) as {
      items?: Array<{ title: string; link: string; snippet: string; pagemap?: { metatags?: Array<{ "article:published_time"?: string }> } }>;
    };

    return (data.items ?? []).map((item) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
      publishedAt: item.pagemap?.metatags?.[0]?.["article:published_time"],
      source: "google",
      score: 0.95,
    }));
  }
}

// ─── Bing Search Provider ─────────────────────────────────────────────────────

class BingSearchProvider implements ISearchProvider {
  name: SearchProviderName = "bing";
  costPerQuery = 0.003;
  rateLimit = 250;

  private apiKey: string;
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      q: options.query,
      count: String(options.maxResults ?? 10),
      ...(options.freshness ? { freshness: options.freshness } : {}),
      ...(options.safeSearch === false ? { safeSearch: "Off" } : { safeSearch: "Moderate" }),
      ...(options.language ? { setLang: options.language } : {}),
      ...(options.region ? { cc: options.region } : {}),
    });

    const resp = await fetch(`https://api.bing.microsoft.com/v7.0/search?${params}`, {
      headers: { "Ocp-Apim-Subscription-Key": this.apiKey },
      signal: AbortSignal.timeout(8_000),
    });

    if (!resp.ok) throw new AppError(`Bing API error ${resp.status}`, 502, "SEARCH_PROVIDER_ERROR");

    const data = (await resp.json()) as {
      webPages?: { value?: Array<{ name: string; url: string; snippet: string; dateLastCrawled?: string; datePublished?: string; thumbnailUrl?: string }> };
    };

    return (data.webPages?.value ?? []).map((r) => ({
      title: r.name,
      url: r.url,
      snippet: r.snippet,
      publishedAt: r.datePublished ?? r.dateLastCrawled,
      source: "bing",
      score: 0.9,
    }));
  }
}

// ─── MultiSearchProvider Orchestrator ────────────────────────────────────────

export interface MultiSearchConfig {
  primaryProvider?: SearchProviderName;
  fallbackProviders?: SearchProviderName[];
  apiKeys?: Partial<Record<SearchProviderName, string>>;
  googleCseId?: string;
  enableCostTracking?: boolean;
}

export class MultiSearchProvider extends EventEmitter {
  private providers = new Map<SearchProviderName, ISearchProvider>();
  private rateLimiter = new RateLimiter();
  private stats = new Map<SearchProviderName, ProviderStats>();
  private priority: SearchProviderName[] = ["brave", "tavily", "bing", "serpapi", "google", "duckduckgo"];

  constructor(config: MultiSearchConfig = {}) {
    super();

    // DuckDuckGo is always available
    this.registerProvider(new DuckDuckGoProvider());

    const keys = config.apiKeys ?? {};

    if (keys.brave) this.registerProvider(new BraveSearchProvider(keys.brave));
    if (keys.tavily) this.registerProvider(new TavilyProvider(keys.tavily));
    if (keys.serpapi) this.registerProvider(new SerpAPIProvider(keys.serpapi));
    if (keys.bing) this.registerProvider(new BingSearchProvider(keys.bing));
    if (keys.google && config.googleCseId) {
      this.registerProvider(new GoogleCSEProvider(keys.google, config.googleCseId));
    }

    if (config.primaryProvider) {
      this.priority = [
        config.primaryProvider,
        ...(config.fallbackProviders ?? []),
        ...this.priority.filter(
          (p) => p !== config.primaryProvider && !(config.fallbackProviders ?? []).includes(p)
        ),
      ];
    }

    logger.info(`MultiSearchProvider initialized with providers: ${[...this.providers.keys()].join(", ")}`);
  }

  private registerProvider(p: ISearchProvider): void {
    this.providers.set(p.name, p);
    this.stats.set(p.name, { requests: 0, failures: 0, totalCost: 0, avgLatencyMs: 0 });
  }

  async search(options: SearchOptions): Promise<SearchResponse> {
    const start = Date.now();
    const providerOrder = options.providers ?? this.priority;
    let totalCost = 0;
    const usedProviders: string[] = [];
    let lastError: Error | null = null;

    for (const name of providerOrder) {
      const provider = this.providers.get(name);
      if (!provider || !provider.isAvailable()) continue;

      const allowed = await this.rateLimiter.checkAndConsume(name, provider.rateLimit);
      if (!allowed) {
        logger.warn(`Rate limit hit for provider ${name}, trying next`);
        continue;
      }

      const stat = this.stats.get(name)!;
      const t0 = Date.now();

      try {
        stat.requests++;
        const results = await provider.search(options);
        const latency = Date.now() - t0;
        stat.avgLatencyMs = (stat.avgLatencyMs * (stat.requests - 1) + latency) / stat.requests;
        totalCost += provider.costPerQuery;
        usedProviders.push(name);

        const finalResults = options.deduplicate !== false ? this.deduplicate(results) : results;

        return {
          results: finalResults,
          searchTime: Date.now() - start,
          providers: usedProviders,
          cost: totalCost,
          cached: false,
        };
      } catch (err) {
        stat.failures++;
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn(`Provider ${name} failed: ${lastError.message}, trying fallback`);
        this.emit("providerFailure", { provider: name, error: lastError });
      }
    }

    throw new AppError(
      `All search providers failed. Last error: ${lastError?.message ?? "unknown"}`,
      503,
      "ALL_PROVIDERS_FAILED"
    );
  }

  async searchMultiProvider(options: SearchOptions, providerNames?: SearchProviderName[]): Promise<SearchResponse> {
    const names = providerNames ?? (this.priority.slice(0, 3) as SearchProviderName[]);
    const start = Date.now();
    let totalCost = 0;
    const usedProviders: string[] = [];
    const allResults: SearchResult[] = [];

    await Promise.allSettled(
      names.map(async (name) => {
        const provider = this.providers.get(name);
        if (!provider || !provider.isAvailable()) return;

        const allowed = await this.rateLimiter.checkAndConsume(name, provider.rateLimit);
        if (!allowed) return;

        try {
          const results = await provider.search({ ...options, maxResults: Math.ceil((options.maxResults ?? 10) / names.length) });
          allResults.push(...results);
          totalCost += provider.costPerQuery;
          usedProviders.push(name);
        } catch (err) {
          logger.warn(`Multi-provider ${name} failed: ${(err as Error).message}`);
        }
      })
    );

    const merged = options.mergeResults !== false
      ? this.mergeAndRank(allResults)
      : allResults;

    const deduplicated = options.deduplicate !== false ? this.deduplicate(merged) : merged;

    return {
      results: deduplicated.slice(0, options.maxResults ?? 10),
      searchTime: Date.now() - start,
      providers: usedProviders,
      cost: totalCost,
      cached: false,
    };
  }

  private deduplicate(results: SearchResult[]): SearchResult[] {
    const seen = new Set<string>();
    return results.filter((r) => {
      const key = this.normalizeUrl(r.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private normalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      u.search = "";
      u.hash = "";
      return u.toString().replace(/\/$/, "");
    } catch {
      return url;
    }
  }

  private mergeAndRank(results: SearchResult[]): SearchResult[] {
    // Reciprocal rank fusion: each result gets a score based on its position in each provider's list
    const scores = new Map<string, number>();
    const byUrl = new Map<string, SearchResult>();

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const key = this.normalizeUrl(r.url);
      const rrfScore = 1 / (60 + i + 1);
      scores.set(key, (scores.get(key) ?? 0) + rrfScore);
      if (!byUrl.has(key)) byUrl.set(key, r);
    }

    return [...byUrl.entries()]
      .sort((a, b) => (scores.get(b[0]) ?? 0) - (scores.get(a[0]) ?? 0))
      .map(([, r]) => r);
  }

  getStats(): Record<string, ProviderStats> {
    return Object.fromEntries(this.stats);
  }

  getAvailableProviders(): SearchProviderName[] {
    return [...this.providers.entries()]
      .filter(([, p]) => p.isAvailable())
      .map(([name]) => name);
  }

  getTotalCost(): number {
    return [...this.stats.values()].reduce((s, v) => s + v.totalCost, 0);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const multiSearchProvider = new MultiSearchProvider({
  apiKeys: {
    brave: process.env.BRAVE_SEARCH_API_KEY,
    tavily: process.env.TAVILY_API_KEY,
    serpapi: process.env.SERPAPI_KEY,
    bing: process.env.BING_SEARCH_API_KEY,
    google: process.env.GOOGLE_SEARCH_API_KEY,
  },
  googleCseId: process.env.GOOGLE_CSE_ID,
});
