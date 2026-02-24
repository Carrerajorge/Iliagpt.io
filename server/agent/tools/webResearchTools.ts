/**
 * Web Research Tools — Separated search/fetch/extract with citation management.
 *
 * Tools:
 *   search.query  — Search the web (with domain filtering, recency)
 *   web.fetch     — Fetch a single URL (readability extraction)
 *   web.extract   — Extract structured data from a page (tables, selectors)
 *
 * All tools maintain a citation registry so the Verifier can audit sources.
 */

import { z } from "zod";
import { randomUUID } from "crypto";

/* ------------------------------------------------------------------ */
/*  Schemas                                                           */
/* ------------------------------------------------------------------ */

export const SearchQuerySchema = z.object({
  tool: z.literal("search.query"),
  query: z.string().min(1),
  maxResults: z.number().int().min(1).max(20).default(5),
  recency: z.enum(["any", "day", "week", "month", "year"]).default("any"),
  domainsAllowlist: z.array(z.string()).default([]),
  domainsDenylist: z.array(z.string()).default([]),
  academic: z.boolean().default(false),
  locale: z.string().default("es"),
});

export const WebFetchSchema = z.object({
  tool: z.literal("web.fetch"),
  url: z.string().url(),
  extractMode: z.enum(["readability", "raw", "markdown"]).default("readability"),
  maxLength: z.number().int().positive().default(10_000),
  respectRobots: z.boolean().default(true),
});

export const WebExtractSchema = z.object({
  tool: z.literal("web.extract"),
  url: z.string().url(),
  selectors: z.array(z.string()).default([]),
  extractTables: z.boolean().default(false),
  extractLinks: z.boolean().default(false),
  extractMeta: z.boolean().default(false),
  maxItems: z.number().int().positive().default(50),
});

export const WebResearchActionSchema = z.discriminatedUnion("tool", [
  SearchQuerySchema,
  WebFetchSchema,
  WebExtractSchema,
]);

export type WebResearchAction = z.infer<typeof WebResearchActionSchema>;

/* ------------------------------------------------------------------ */
/*  Citation                                                          */
/* ------------------------------------------------------------------ */

export interface Citation {
  id: string;
  url: string;
  title: string;
  snippet: string;
  domain: string;
  accessedAt: number;
  relevanceScore: number;
  metadata?: Record<string, any>;
}

/* ------------------------------------------------------------------ */
/*  Result types                                                      */
/* ------------------------------------------------------------------ */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  publishedDate?: string;
  relevanceScore: number;
}

export interface FetchResult {
  url: string;
  title: string;
  content: string;
  wordCount: number;
  language?: string;
  author?: string;
  publishedDate?: string;
}

export interface ExtractResult {
  url: string;
  tables?: Array<string[][]>;
  links?: Array<{ text: string; href: string }>;
  meta?: Record<string, string>;
  selectedContent?: Array<{ selector: string; content: string }>;
}

export interface WebResearchResult {
  success: boolean;
  tool: string;
  data: SearchResult[] | FetchResult | ExtractResult | null;
  citations: Citation[];
  error?: string;
  durationMs: number;
}

/* ------------------------------------------------------------------ */
/*  URL Cache                                                         */
/* ------------------------------------------------------------------ */

interface CacheEntry {
  content: string;
  title: string;
  fetchedAt: number;
  ttlMs: number;
}

class UrlCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize = 100;

  get(url: string): CacheEntry | null {
    const entry = this.cache.get(url);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > entry.ttlMs) {
      this.cache.delete(url);
      return null;
    }
    return entry;
  }

  set(url: string, entry: CacheEntry): void {
    if (this.cache.size >= this.maxSize) {
      // Evict oldest
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(url, entry);
  }
}

/* ------------------------------------------------------------------ */
/*  Rate Limiter                                                      */
/* ------------------------------------------------------------------ */

class DomainRateLimiter {
  private requests = new Map<string, number[]>();
  private maxPerMinute = 10;

  canRequest(domain: string): boolean {
    const now = Date.now();
    const history = this.requests.get(domain) || [];
    const recent = history.filter((t) => now - t < 60_000);
    return recent.length < this.maxPerMinute;
  }

  record(domain: string): void {
    const now = Date.now();
    const history = this.requests.get(domain) || [];
    history.push(now);
    // Keep only last minute
    this.requests.set(
      domain,
      history.filter((t) => now - t < 60_000)
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Web Research Engine                                                */
/* ------------------------------------------------------------------ */

export class WebResearchEngine {
  private citations: Map<string, Citation> = new Map();
  private cache = new UrlCache();
  private rateLimiter = new DomainRateLimiter();

  /**
   * Execute a web research action.
   */
  async execute(input: WebResearchAction): Promise<WebResearchResult> {
    const parsed = WebResearchActionSchema.parse(input);
    const start = Date.now();

    try {
      switch (parsed.tool) {
        case "search.query":
          return await this.handleSearch(parsed, start);
        case "web.fetch":
          return await this.handleFetch(parsed, start);
        case "web.extract":
          return await this.handleExtract(parsed, start);
        default:
          return { success: false, tool: "unknown", data: null, citations: [], error: "Unknown tool", durationMs: 0 };
      }
    } catch (err: any) {
      return {
        success: false,
        tool: parsed.tool,
        data: null,
        citations: [],
        error: err.message,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Get all citations accumulated during research.
   */
  getCitations(): Citation[] {
    return Array.from(this.citations.values());
  }

  /**
   * Get citations as formatted references.
   */
  getFormattedCitations(style: "inline" | "footnote" | "apa" = "inline"): string {
    const cites = this.getCitations();
    if (cites.length === 0) return "";

    switch (style) {
      case "inline":
        return cites
          .map((c, i) => `[${i + 1}] ${c.title} — ${c.url}`)
          .join("\n");
      case "footnote":
        return cites
          .map((c, i) => `[^${i + 1}]: ${c.title}. Disponible en: ${c.url} (consultado: ${new Date(c.accessedAt).toISOString().slice(0, 10)})`)
          .join("\n");
      case "apa":
        return cites
          .map((c) => `${c.domain}. (${new Date(c.accessedAt).getFullYear()}). *${c.title}*. ${c.url}`)
          .join("\n");
    }
  }

  clearCitations(): void {
    this.citations.clear();
  }

  /* -- Handlers ---------------------------------------------------- */

  private async handleSearch(
    input: z.infer<typeof SearchQuerySchema>,
    start: number
  ): Promise<WebResearchResult> {
    // Dynamic import to avoid circular deps
    const { searchWeb, searchScholar } = await import("../../services/webSearch");

    const results: SearchResult[] = [];
    const newCitations: Citation[] = [];

    try {
      const searchFn = input.academic ? searchScholar : searchWeb;
      const raw = await searchFn(input.query, input.maxResults);

      const items = Array.isArray(raw) ? raw : (raw as any)?.results || [];
      for (const item of items) {
        const domain = this.extractDomain(item.url || item.link || "");

        // Apply domain filters
        if (input.domainsAllowlist.length > 0 && !input.domainsAllowlist.some((d) => domain.includes(d))) {
          continue;
        }
        if (input.domainsDenylist.some((d) => domain.includes(d))) {
          continue;
        }

        const result: SearchResult = {
          title: item.title || "",
          url: item.url || item.link || "",
          snippet: item.snippet || item.description || "",
          domain,
          publishedDate: item.date || item.publishedDate,
          relevanceScore: item.relevance || 0.5,
        };

        results.push(result);

        // Register citation
        const citation = this.registerCitation(result.url, result.title, result.snippet, domain);
        newCitations.push(citation);
      }
    } catch (err: any) {
      console.error("[WebResearch] Search error:", err.message);
      return {
        success: false,
        tool: "search.query",
        data: results,
        citations: newCitations,
        error: err.message,
        durationMs: Date.now() - start,
      };
    }

    return {
      success: true,
      tool: "search.query",
      data: results,
      citations: newCitations,
      durationMs: Date.now() - start,
    };
  }

  private async handleFetch(
    input: z.infer<typeof WebFetchSchema>,
    start: number
  ): Promise<WebResearchResult> {
    const domain = this.extractDomain(input.url);

    // Rate limit check
    if (!this.rateLimiter.canRequest(domain)) {
      return {
        success: false,
        tool: "web.fetch",
        data: null,
        citations: [],
        error: `Rate limit exceeded for domain: ${domain}`,
        durationMs: Date.now() - start,
      };
    }

    // Check cache
    const cached = this.cache.get(input.url);
    if (cached) {
      const citation = this.registerCitation(input.url, cached.title, cached.content.slice(0, 200), domain);
      return {
        success: true,
        tool: "web.fetch",
        data: {
          url: input.url,
          title: cached.title,
          content: cached.content.slice(0, input.maxLength),
          wordCount: cached.content.split(/\s+/).length,
        } as FetchResult,
        citations: [citation],
        durationMs: Date.now() - start,
      };
    }

    this.rateLimiter.record(domain);

    try {
      // Use the existing fetchUrl service (faster, no browser overhead)
      const { fetchUrl } = await import("../../services/webSearch");

      const fetchResult = await fetchUrl(input.url, {
        extractText: input.extractMode === "readability",
        maxLength: input.maxLength,
      });

      const content = (fetchResult?.text || "").slice(0, input.maxLength);
      const title = fetchResult?.title || "";

      // Cache the result
      this.cache.set(input.url, {
        content,
        title,
        fetchedAt: Date.now(),
        ttlMs: 15 * 60_000, // 15 minutes
      });

      const citation = this.registerCitation(input.url, title, content.slice(0, 200), domain);

      return {
        success: true,
        tool: "web.fetch",
        data: {
          url: input.url,
          title,
          content,
          wordCount: content.split(/\s+/).length,
          author: undefined,
          publishedDate: fetchResult?.publishedDate,
        } as FetchResult,
        citations: [citation],
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        tool: "web.fetch",
        data: null,
        citations: [],
        error: err.message,
        durationMs: Date.now() - start,
      };
    }
  }

  private async handleExtract(
    input: z.infer<typeof WebExtractSchema>,
    start: number
  ): Promise<WebResearchResult> {
    const domain = this.extractDomain(input.url);

    if (!this.rateLimiter.canRequest(domain)) {
      return {
        success: false,
        tool: "web.extract",
        data: null,
        citations: [],
        error: `Rate limit exceeded for domain: ${domain}`,
        durationMs: Date.now() - start,
      };
    }

    this.rateLimiter.record(domain);

    try {
      const { BrowserToolApi } = await import("../browser/browserToolApi");
      const browserApi = new BrowserToolApi();

      // Open the page
      await browserApi.execute({ action: "browser.open", url: input.url, waitUntil: "networkidle" });

      const extractResult: ExtractResult = { url: input.url };

      // Extract tables
      if (input.extractTables) {
        const tableResult = await browserApi.execute({
          action: "browser.extract",
          type: "table",
          limit: input.maxItems,
        });
        if (tableResult.success && tableResult.data) {
          extractResult.tables = Array.isArray(tableResult.data) ? tableResult.data : [tableResult.data];
        }
      }

      // Extract links
      if (input.extractLinks) {
        const linkResult = await browserApi.execute({
          action: "browser.extract",
          type: "links",
          limit: input.maxItems,
        });
        if (linkResult.success && linkResult.data) {
          extractResult.links = linkResult.data;
        }
      }

      // Extract meta
      if (input.extractMeta) {
        const metaResult = await browserApi.execute({
          action: "browser.extract",
          type: "html",
          target: "head",
          limit: 50,
        });
        if (metaResult.success && typeof metaResult.data === "string") {
          // Parse meta tags from head HTML
          const metaRegex = /<meta\s+(?:name|property)="([^"]+)"\s+content="([^"]+)"/gi;
          const meta: Record<string, string> = {};
          let match;
          while ((match = metaRegex.exec(metaResult.data)) !== null) {
            meta[match[1]] = match[2];
          }
          extractResult.meta = meta;
        }
      }

      // Extract by selectors
      if (input.selectors.length > 0) {
        extractResult.selectedContent = [];
        for (const selector of input.selectors) {
          const contentResult = await browserApi.execute({
            action: "browser.extract",
            type: "text",
            target: selector,
            limit: 50,
          });
          if (contentResult.success) {
            extractResult.selectedContent.push({
              selector,
              content: typeof contentResult.data === "string" ? contentResult.data : JSON.stringify(contentResult.data),
            });
          }
        }
      }

      await browserApi.cleanup();

      const citation = this.registerCitation(
        input.url,
        "Extracted content",
        JSON.stringify(extractResult).slice(0, 200),
        domain
      );

      return {
        success: true,
        tool: "web.extract",
        data: extractResult,
        citations: [citation],
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        tool: "web.extract",
        data: null,
        citations: [],
        error: err.message,
        durationMs: Date.now() - start,
      };
    }
  }

  /* -- Citation management ----------------------------------------- */

  private registerCitation(url: string, title: string, snippet: string, domain: string): Citation {
    const existing = this.citations.get(url);
    if (existing) return existing;

    const citation: Citation = {
      id: randomUUID(),
      url,
      title,
      snippet: snippet.slice(0, 500),
      domain,
      accessedAt: Date.now(),
      relevanceScore: 0.5,
    };

    this.citations.set(url, citation);
    return citation;
  }

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return "unknown";
    }
  }
}
