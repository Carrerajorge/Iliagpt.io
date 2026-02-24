import { EventEmitter } from "events";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { retrievalPlanner, type QueryPlan, type PlannedQuery } from "./retrievalPlanner";
import { ConcurrencyPool, type PoolTask, type PoolResult } from "./concurrencyPool";
import { responseCache, ResponseCache } from "./responseCache";
import { relevanceFilter, type FilteredContent } from "./relevanceFilter";
import { searchAdapter, type ISearchAdapter } from "./searchAdapter";
import { fetchAdapter, type IFetchAdapter } from "./fetchAdapter";
import { browserAdapter, type IBrowserAdapter } from "./browserAdapter";
import { canonicalizeUrl, extractDomain } from "./canonicalizeUrl";
import { calculateQualityScore } from "./qualityScorer";
import { hashContent } from "./hashContent";
import { sandboxSecurity } from "../sandboxSecurity";
import { metricsCollector } from "../metricsCollector";
import type { WebSearchResult, FetchResult, BrowseResult, QualityScore } from "./types";

export interface FastFirstOptions {
  fetchTimeoutMs: number;
  browserTimeoutMs: number;
  maxConcurrency: number;
  maxQueries: number;
  maxResultsPerQuery: number;
  maxTotalResults: number;
  minRelevanceScore: number;
  enableCache: boolean;
  enablePrefetch: boolean;
  streamResults: boolean;
}

export interface RetrievedSource {
  url: string;
  canonicalUrl: string;
  title: string;
  content: string;
  snippet: string;
  relevanceScore: number;
  qualityScore: QualityScore;
  fetchMethod: "cache" | "fetch" | "browser";
  timing: {
    fetchMs: number;
    extractMs: number;
    totalMs: number;
  };
  filteredContent?: FilteredContent;
  contentHash: string;
}

export interface FastFirstResult {
  success: boolean;
  query: string;
  queryPlan: QueryPlan;
  sources: RetrievedSource[];
  metrics: {
    totalDurationMs: number;
    searchDurationMs: number;
    fetchDurationMs: number;
    processDurationMs: number;
    cacheHitRate: number;
    sourcesCount: number;
    averageRelevanceScore: number;
  };
  errors: { url: string; error: string; stage: string }[];
}

const DEFAULT_OPTIONS: FastFirstOptions = {
  fetchTimeoutMs: 3000,
  browserTimeoutMs: 8000,
  maxConcurrency: 6,
  maxQueries: 4,
  maxResultsPerQuery: 5,
  maxTotalResults: 10,
  minRelevanceScore: 0.15,
  enableCache: true,
  enablePrefetch: true,
  streamResults: true,
};

const SPA_INDICATORS = [
  "react", "angular", "vue", "next", "nuxt", "gatsby",
  "application/javascript", "text/javascript",
  "__NEXT_DATA__", "__NUXT__", "window.__INITIAL_STATE__",
];

export class FastFirstPipeline extends EventEmitter {
  private options: FastFirstOptions;
  private searchAdapter: ISearchAdapter;
  private fetchAdapter: IFetchAdapter;
  private browserAdapter: IBrowserAdapter;
  private cache: ResponseCache;

  constructor(
    options: Partial<FastFirstOptions> = {},
    search?: ISearchAdapter,
    fetch?: IFetchAdapter,
    browser?: IBrowserAdapter
  ) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.searchAdapter = search || searchAdapter;
    this.fetchAdapter = fetch || fetchAdapter;
    this.browserAdapter = browser || browserAdapter;
    this.cache = responseCache;
  }

  async retrieve(prompt: string): Promise<FastFirstResult> {
    const startTime = Date.now();
    const errors: FastFirstResult["errors"] = [];
    
    const queryPlan = retrievalPlanner.plan(prompt, this.options.maxQueries);
    this.emit("plan", queryPlan);
    
    const searchStartTime = Date.now();
    const searchResults = await this.executeParallelSearch(queryPlan, errors);
    const searchDurationMs = Date.now() - searchStartTime;
    
    const dedupedUrls = this.deduplicateUrls(searchResults);
    
    const fetchStartTime = Date.now();
    const sources = await this.fetchWithFastFirst(dedupedUrls, queryPlan, errors);
    const fetchDurationMs = Date.now() - fetchStartTime;
    
    const processStartTime = Date.now();
    const filteredSources = this.filterAndRank(sources, queryPlan);
    const processDurationMs = Date.now() - processStartTime;
    
    const cacheStats = this.cache.getStats();
    const avgRelevance = filteredSources.length > 0
      ? filteredSources.reduce((sum, s) => sum + s.relevanceScore, 0) / filteredSources.length
      : 0;
    
    const result: FastFirstResult = {
      success: filteredSources.length > 0,
      query: prompt,
      queryPlan,
      sources: filteredSources.slice(0, this.options.maxTotalResults),
      metrics: {
        totalDurationMs: Date.now() - startTime,
        searchDurationMs,
        fetchDurationMs,
        processDurationMs,
        cacheHitRate: cacheStats.hitRate,
        sourcesCount: filteredSources.length,
        averageRelevanceScore: avgRelevance,
      },
      errors,
    };
    
    this.recordMetrics(result);
    this.emit("complete", result);
    
    return result;
  }

  async *retrieveStreaming(prompt: string): AsyncGenerator<RetrievedSource, FastFirstResult> {
    const startTime = Date.now();
    const errors: FastFirstResult["errors"] = [];
    const sources: RetrievedSource[] = [];
    
    const queryPlan = retrievalPlanner.plan(prompt, this.options.maxQueries);
    this.emit("plan", queryPlan);
    
    const searchStartTime = Date.now();
    const searchResults = await this.executeParallelSearch(queryPlan, errors);
    const searchDurationMs = Date.now() - searchStartTime;
    
    const dedupedUrls = this.deduplicateUrls(searchResults);
    
    const fetchStartTime = Date.now();
    
    for await (const source of this.fetchWithFastFirstStreaming(dedupedUrls, queryPlan, errors)) {
      sources.push(source);
      yield source;
      this.emit("source", source);
      
      if (sources.length >= this.options.maxTotalResults) {
        break;
      }
    }
    
    const fetchDurationMs = Date.now() - fetchStartTime;
    
    const cacheStats = this.cache.getStats();
    const avgRelevance = sources.length > 0
      ? sources.reduce((sum, s) => sum + s.relevanceScore, 0) / sources.length
      : 0;
    
    const result: FastFirstResult = {
      success: sources.length > 0,
      query: prompt,
      queryPlan,
      sources,
      metrics: {
        totalDurationMs: Date.now() - startTime,
        searchDurationMs,
        fetchDurationMs,
        processDurationMs: 0,
        cacheHitRate: cacheStats.hitRate,
        sourcesCount: sources.length,
        averageRelevanceScore: avgRelevance,
      },
      errors,
    };
    
    this.recordMetrics(result);
    this.emit("complete", result);
    
    return result;
  }

  private async executeParallelSearch(
    queryPlan: QueryPlan,
    errors: FastFirstResult["errors"]
  ): Promise<Map<string, WebSearchResult>> {
    const allResults = new Map<string, WebSearchResult>();
    
    const pool = new ConcurrencyPool<WebSearchResult[]>({
      maxConcurrency: 3,
      defaultTimeout: 5000,
    });
    
    const tasks: PoolTask<WebSearchResult[]>[] = queryPlan.queries.map((q, idx) => ({
      id: `search-${idx}`,
      priority: q.priority,
      execute: async () => {
        const results = await this.searchAdapter.search(q.query, this.options.maxResultsPerQuery);
        return results;
      },
    }));
    
    const results = await pool.executeAll(tasks);
    
    for (const result of results) {
      if (result.success && result.result) {
        for (const searchResult of result.result) {
          if (!allResults.has(searchResult.url)) {
            allResults.set(searchResult.url, searchResult);
          }
        }
      } else if (result.error) {
        errors.push({ url: "", error: result.error, stage: "search" });
      }
    }
    
    return allResults;
  }

  private deduplicateUrls(searchResults: Map<string, WebSearchResult>): WebSearchResult[] {
    const canonicalMap = new Map<string, WebSearchResult>();
    
    for (const result of searchResults.values()) {
      try {
        const canonical = canonicalizeUrl(result.url);
        const domain = extractDomain(canonical);
        
        if (!sandboxSecurity.isHostAllowed(domain)) {
          continue;
        }
        
        if (!canonicalMap.has(canonical)) {
          canonicalMap.set(canonical, result);
        }
      } catch {
        continue;
      }
    }
    
    return Array.from(canonicalMap.values());
  }

  private async fetchWithFastFirst(
    urls: WebSearchResult[],
    queryPlan: QueryPlan,
    errors: FastFirstResult["errors"]
  ): Promise<RetrievedSource[]> {
    const sources: RetrievedSource[] = [];
    
    const pool = new ConcurrencyPool<RetrievedSource | null>({
      maxConcurrency: this.options.maxConcurrency,
      defaultTimeout: this.options.browserTimeoutMs + 1000,
    });
    
    const tasks: PoolTask<RetrievedSource | null>[] = urls.map((searchResult, idx) => ({
      id: `fetch-${idx}`,
      priority: 10 - idx,
      execute: () => this.fetchSingleUrl(searchResult, queryPlan, errors),
    }));
    
    const results = await pool.executeAll(tasks);
    
    for (const result of results) {
      if (result.success && result.result) {
        sources.push(result.result);
      }
    }
    
    return sources;
  }

  private async *fetchWithFastFirstStreaming(
    urls: WebSearchResult[],
    queryPlan: QueryPlan,
    errors: FastFirstResult["errors"]
  ): AsyncGenerator<RetrievedSource> {
    const pool = new ConcurrencyPool<RetrievedSource | null>({
      maxConcurrency: this.options.maxConcurrency,
      defaultTimeout: this.options.browserTimeoutMs + 1000,
    });
    
    const tasks: PoolTask<RetrievedSource | null>[] = urls.map((searchResult, idx) => ({
      id: `fetch-${idx}`,
      priority: 10 - idx,
      execute: () => this.fetchSingleUrl(searchResult, queryPlan, errors),
    }));
    
    for await (const result of pool.executeStreaming(tasks)) {
      if (result.success && result.result) {
        yield result.result;
      }
    }
  }

  private async fetchSingleUrl(
    searchResult: WebSearchResult,
    queryPlan: QueryPlan,
    errors: FastFirstResult["errors"]
  ): Promise<RetrievedSource | null> {
    const startTime = Date.now();
    const url = searchResult.url;
    
    try {
      const canonicalUrl = canonicalizeUrl(url);
      const domain = extractDomain(canonicalUrl);
      
      if (!sandboxSecurity.isHostAllowed(domain)) {
        errors.push({ url, error: `Host ${domain} not in sandbox allowlist`, stage: "security" });
        return null;
      }
      
      const urlHash = ResponseCache.hashUrl(canonicalUrl);
      
      if (this.options.enableCache) {
        const cached = this.cache.get(urlHash, queryPlan.queryHash);
        if (cached) {
          const filtered = relevanceFilter.filter(
            cached.content,
            queryPlan.originalPrompt,
            queryPlan.entities
          );
          
          return {
            url,
            canonicalUrl,
            title: cached.title || searchResult.title,
            content: cached.content,
            snippet: searchResult.snippet,
            relevanceScore: filtered.overallScore,
            qualityScore: calculateQualityScore(canonicalUrl, {}, cached.content.length),
            fetchMethod: "cache",
            timing: {
              fetchMs: 0,
              extractMs: Date.now() - startTime,
              totalMs: Date.now() - startTime,
            },
            filteredContent: filtered,
            contentHash: hashContent(cached.content),
          };
        }
      }
      
      const conditionalHeaders = this.cache.getConditionalHeaders(canonicalUrl);
      
      let content: string | undefined;
      let title: string | undefined;
      let fetchMethod: "fetch" | "browser" = "fetch";
      let fetchMs = 0;
      
      const fetchResult = await this.fetchAdapter.fetch(url, {
        timeout: this.options.fetchTimeoutMs,
        retries: 1,
        headers: conditionalHeaders || undefined,
      });
      
      fetchMs = fetchResult.timing.durationMs;
      
      if (fetchResult.status === 304 && this.options.enableCache) {
        const cached = this.cache.handleNotModified(canonicalUrl);
        if (cached) {
          content = cached.content;
          title = cached.title;
        }
      } else if (fetchResult.success && fetchResult.content) {
        const extracted = this.extractReadableContent(fetchResult.content);
        content = extracted.content;
        title = extracted.title;
        
        if (this.needsBrowser(fetchResult.content, content)) {
          const browseResult = await this.browserAdapter.browse(url, {
            timeout: this.options.browserTimeoutMs,
            waitStrategy: "networkidle",
            extractContent: true,
          });
          
          if (browseResult.success && browseResult.content) {
            content = browseResult.content;
            title = browseResult.title || title;
            fetchMethod = "browser";
            fetchMs = browseResult.timing.totalMs;
          }
        }
        
        if (content && this.options.enableCache) {
          this.cache.set(canonicalUrl, content, {
            title,
            etag: fetchResult.headers["etag"],
            lastModified: fetchResult.headers["last-modified"],
            contentType: fetchResult.contentType,
            fetchMethod,
            queryHash: queryPlan.queryHash,
          });
        }
      } else {
        const browseResult = await this.browserAdapter.browse(url, {
          timeout: this.options.browserTimeoutMs,
          waitStrategy: "networkidle",
          extractContent: true,
        });
        
        if (browseResult.success && browseResult.content) {
          content = browseResult.content;
          title = browseResult.title;
          fetchMethod = "browser";
          fetchMs = browseResult.timing.totalMs;
          
          if (this.options.enableCache) {
            this.cache.set(canonicalUrl, content, {
              title,
              fetchMethod: "browser",
              queryHash: queryPlan.queryHash,
            });
          }
        }
      }
      
      if (!content || content.length < 100) {
        return null;
      }
      
      const extractMs = Date.now() - startTime - fetchMs;
      
      const filtered = relevanceFilter.filter(
        content,
        queryPlan.originalPrompt,
        queryPlan.entities
      );
      
      return {
        url,
        canonicalUrl,
        title: title || searchResult.title,
        content,
        snippet: searchResult.snippet,
        relevanceScore: filtered.overallScore,
        qualityScore: calculateQualityScore(canonicalUrl, {}, content.length),
        fetchMethod,
        timing: {
          fetchMs,
          extractMs,
          totalMs: Date.now() - startTime,
        },
        filteredContent: filtered,
        contentHash: hashContent(content),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push({ url, error: errorMessage, stage: "fetch" });
      return null;
    }
  }

  private extractReadableContent(html: string): { content: string; title: string } {
    try {
      const dom = new JSDOM(html, { url: "https://example.com" });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      
      if (article) {
        return {
          content: article.textContent || "",
          title: article.title || "",
        };
      }
      
      const textContent = dom.window.document.body?.textContent || "";
      const title = dom.window.document.title || "";
      
      return { content: textContent, title };
    } catch {
      return { content: "", title: "" };
    }
  }

  private needsBrowser(html: string, extractedContent: string): boolean {
    const lowerHtml = html.toLowerCase();
    
    const hasSpaIndicators = SPA_INDICATORS.some(indicator => 
      lowerHtml.includes(indicator.toLowerCase())
    );
    
    const hasMinimalContent = extractedContent.length < 200;
    
    const hasHeavyJs = (html.match(/<script/gi) || []).length > 10;
    
    const hasNoSSRContent = !html.includes("data-reactroot") &&
                           !html.includes("data-server-rendered") &&
                           (lowerHtml.includes("__next") || lowerHtml.includes("__nuxt"));
    
    return hasSpaIndicators && (hasMinimalContent || hasHeavyJs || hasNoSSRContent);
  }

  private filterAndRank(sources: RetrievedSource[], queryPlan: QueryPlan): RetrievedSource[] {
    return sources
      .filter(s => s.relevanceScore >= this.options.minRelevanceScore)
      .sort((a, b) => {
        const relevanceDiff = b.relevanceScore - a.relevanceScore;
        if (Math.abs(relevanceDiff) > 0.1) {
          return relevanceDiff;
        }
        
        return b.qualityScore.total - a.qualityScore.total;
      });
  }

  private recordMetrics(result: FastFirstResult): void {
    metricsCollector.record({
      toolName: "web_retrieve_fast",
      latencyMs: result.metrics.totalDurationMs,
      success: result.success,
      timestamp: new Date(),
      metadata: {
        sourcesCount: result.metrics.sourcesCount,
        cacheHitRate: result.metrics.cacheHitRate,
        avgRelevance: result.metrics.averageRelevanceScore,
      },
    });
  }
}

export const fastFirstPipeline = new FastFirstPipeline();
