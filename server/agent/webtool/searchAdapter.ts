import { z } from "zod";
import { searchWeb, searchScholar } from "../../services/webSearch";
import { validateOrThrow } from "../validation";
import { canonicalizeUrl } from "./canonicalizeUrl";
import { WebSearchRequestSchema, WebSearchResultSchema, type WebSearchRequest, type WebSearchResult } from "./types";

export interface ISearchAdapter {
  search(query: string, maxResults: number): Promise<WebSearchResult[]>;
  searchScholar?(query: string, maxResults: number): Promise<WebSearchResult[]>;
}

export class DuckDuckGoSearchAdapter implements ISearchAdapter {
  private readonly defaultMaxResults: number;
  
  constructor(defaultMaxResults: number = 20) {
    this.defaultMaxResults = defaultMaxResults;
  }
  
  async search(query: string, maxResults?: number): Promise<WebSearchResult[]> {
    const request: WebSearchRequest = validateOrThrow(
      WebSearchRequestSchema,
      { query, maxResults: maxResults ?? this.defaultMaxResults },
      "SearchAdapter.search"
    );
    
    try {
      const response = await searchWeb(request.query, request.maxResults);
      
      const results: WebSearchResult[] = [];
      
      for (const result of response.results) {
        try {
          const canonicalUrl = canonicalizeUrl(result.url);
          
          const webSearchResult: WebSearchResult = {
            url: result.url,
            canonicalUrl,
            title: result.title || "",
            snippet: result.snippet || "",
            authors: result.authors,
            year: result.year,
            citation: result.citation,
          };
          
          const validated = WebSearchResultSchema.safeParse(webSearchResult);
          if (validated.success) {
            results.push(validated.data);
          } else {
            console.warn(`[SearchAdapter] Invalid result from search:`, validated.error.message);
          }
        } catch (error) {
          console.warn(`[SearchAdapter] Failed to process search result:`, error);
        }
      }
      
      return results;
    } catch (error) {
      console.error(`[SearchAdapter] Search failed for query "${query}":`, error);
      throw new Error(`Search failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
  
  async searchScholar(query: string, maxResults?: number): Promise<WebSearchResult[]> {
    const request: WebSearchRequest = validateOrThrow(
      WebSearchRequestSchema,
      { query, maxResults: maxResults ?? this.defaultMaxResults, includeScholar: true },
      "SearchAdapter.searchScholar"
    );
    
    try {
      const response = await searchScholar(request.query, request.maxResults);
      
      const results: WebSearchResult[] = [];
      
      for (const result of response) {
        try {
          const canonicalUrl = canonicalizeUrl(result.url);
          
          const webSearchResult: WebSearchResult = {
            url: result.url,
            canonicalUrl,
            title: result.title || "",
            snippet: result.snippet || "",
            authors: result.authors,
            year: result.year,
            citation: result.citation,
          };
          
          const validated = WebSearchResultSchema.safeParse(webSearchResult);
          if (validated.success) {
            results.push(validated.data);
          }
        } catch (error) {
          console.warn(`[SearchAdapter] Failed to process scholar result:`, error);
        }
      }
      
      return results;
    } catch (error) {
      console.error(`[SearchAdapter] Scholar search failed for query "${query}":`, error);
      throw new Error(`Scholar search failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}

export class SearxngSearchAdapter implements ISearchAdapter {
  private readonly defaultMaxResults: number;

  constructor(defaultMaxResults: number = 20) {
    this.defaultMaxResults = defaultMaxResults;
  }

  async search(query: string, maxResults?: number): Promise<WebSearchResult[]> {
    const { searxngSearch, isSearxngAvailable } = await import("../../openclaw/fusion/v2026_4_1/searxngSearch");
    if (!isSearxngAvailable()) {
      return new DuckDuckGoSearchAdapter(this.defaultMaxResults).search(query, maxResults);
    }

    try {
      const rawResults = await searxngSearch(query, { maxResults: maxResults ?? this.defaultMaxResults });
      if (!rawResults || rawResults.length === 0) {
        console.warn(`[SearxngAdapter] SearXNG returned empty results, falling back to DuckDuckGo`);
        return new DuckDuckGoSearchAdapter(this.defaultMaxResults).search(query, maxResults);
      }
      return rawResults.map(r => ({
        url: r.url,
        canonicalUrl: canonicalizeUrl(r.url),
        title: r.title,
        snippet: r.content,
      }));
    } catch (error) {
      console.warn(`[SearxngAdapter] SearXNG failed, falling back to DuckDuckGo:`, error);
      return new DuckDuckGoSearchAdapter(this.defaultMaxResults).search(query, maxResults);
    }
  }
}

function createSearchAdapter(): ISearchAdapter {
  if (process.env.SEARXNG_HOST || process.env.SEARXNG_URL) {
    return new SearxngSearchAdapter();
  }
  return new DuckDuckGoSearchAdapter();
}

export const searchAdapter = createSearchAdapter();
