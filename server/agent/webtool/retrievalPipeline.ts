import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { validateOrThrow, validateOrDefault } from "../validation";
import { metricsCollector } from "../metricsCollector";
import { sandboxSecurity } from "../sandboxSecurity";
import { canonicalizeUrl, extractDomain } from "./canonicalizeUrl";
import { hashContent } from "./hashContent";
import { calculateQualityScore, isHighQuality } from "./qualityScorer";
import { searchAdapter, type ISearchAdapter } from "./searchAdapter";
import { fetchAdapter, type IFetchAdapter } from "./fetchAdapter";
import { browserAdapter, type IBrowserAdapter } from "./browserAdapter";
import {
  RetrievalRequestSchema,
  FetchResultSchema,
  BrowseResultSchema,
  type RetrievalRequest,
  type RetrievalResult,
  type RetrievalPipelineResult,
  type WebSearchResult,
  type FetchResult,
  type BrowseResult,
  type QualityScore,
  type ExtractedDocument,
  type Heading,
  type ExtractedLink,
  type ContentMetadata,
} from "./types";

const WORDS_PER_MINUTE = 200;

interface ProcessedUrl {
  original: string;
  canonical: string;
  searchResult: WebSearchResult;
}

interface FetchedContent {
  url: ProcessedUrl;
  content: string;
  fetchResult: FetchResult | BrowseResult;
  method: "fetch" | "browser";
  timing: { fetchMs: number };
}

interface ExtractedContent {
  url: ProcessedUrl;
  content: string;
  title: string;
  fetchResult: FetchResult | BrowseResult;
  method: "fetch" | "browser";
  timing: { fetchMs: number; extractMs: number };
  extractedDocument?: ExtractedDocument;
}

export class RetrievalPipeline {
  private searchAdapter: ISearchAdapter;
  private fetchAdapter: IFetchAdapter;
  private browserAdapter: IBrowserAdapter;
  
  constructor(
    search?: ISearchAdapter,
    fetch?: IFetchAdapter,
    browser?: IBrowserAdapter
  ) {
    this.searchAdapter = search || searchAdapter;
    this.fetchAdapter = fetch || fetchAdapter;
    this.browserAdapter = browser || browserAdapter;
  }
  
  async retrieve(request: RetrievalRequest): Promise<RetrievalPipelineResult> {
    const validated = validateOrThrow(
      RetrievalRequestSchema,
      request,
      "RetrievalPipeline.retrieve"
    );
    
    const startTime = Date.now();
    const errors: RetrievalPipelineResult["errors"] = [];
    
    let searchResults: WebSearchResult[] = [];
    const searchStartTime = Date.now();
    
    try {
      if (validated.includeScholar && this.searchAdapter.searchScholar) {
        const [webResults, scholarResults] = await Promise.all([
          this.searchAdapter.search(validated.query, Math.ceil(validated.maxResults / 2)),
          this.searchAdapter.searchScholar(validated.query, Math.floor(validated.maxResults / 2)),
        ]);
        searchResults = [...scholarResults, ...webResults];
      } else {
        searchResults = await this.searchAdapter.search(validated.query, validated.maxResults * 2);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push({ url: "", error: errorMessage, stage: "search" });
      console.error("[RetrievalPipeline] Search failed:", error);
    }
    
    const searchMs = Date.now() - searchStartTime;
    
    const processedUrls = this.canonicalizeAndFilter(searchResults, validated, errors);
    
    const dedupedUrls = this.deduplicateByCanonicalUrl(processedUrls);
    
    const fetchStartTime = Date.now();
    const fetchedContents = await this.fetchContents(dedupedUrls, validated, errors);
    const fetchMs = Date.now() - fetchStartTime;
    
    const processStartTime = Date.now();
    const extractedContents = await this.extractReadableContent(fetchedContents, validated, errors);
    
    const scoredResults = this.scoreAndHash(extractedContents, validated, errors);
    
    const dedupedResults = validated.deduplicateByContent 
      ? this.deduplicateByContentHash(scoredResults)
      : scoredResults;
    
    const filteredResults = dedupedResults.filter(r => r.qualityScore.total >= validated.minQualityScore);
    
    const sortedResults = filteredResults
      .sort((a, b) => b.qualityScore.total - a.qualityScore.total)
      .slice(0, validated.maxResults);
    
    const processMs = Date.now() - processStartTime;
    const totalMs = Date.now() - startTime;
    
    this.recordMetrics(validated.query, sortedResults.length, totalMs, errors.length === 0);
    
    return {
      success: sortedResults.length > 0 || errors.length === 0,
      query: validated.query,
      results: sortedResults,
      totalFound: searchResults.length,
      totalProcessed: fetchedContents.length,
      totalDeduped: dedupedResults.length,
      timing: {
        totalMs,
        searchMs,
        fetchMs,
        processMs,
      },
      errors,
    };
  }
  
  private canonicalizeAndFilter(
    searchResults: WebSearchResult[],
    request: RetrievalRequest,
    errors: RetrievalPipelineResult["errors"]
  ): ProcessedUrl[] {
    const processed: ProcessedUrl[] = [];
    
    for (const result of searchResults) {
      try {
        const canonical = canonicalizeUrl(result.url);
        const domain = extractDomain(canonical);
        
        if (!sandboxSecurity.isHostAllowed(domain)) {
          errors.push({ url: result.url, error: "Domain blocked by security policy", stage: "fetch" });
          continue;
        }
        
        if (request.blockedDomains?.some(d => domain.includes(d))) {
          continue;
        }
        
        if (request.allowedDomains && request.allowedDomains.length > 0) {
          if (!request.allowedDomains.some(d => domain.includes(d))) {
            continue;
          }
        }
        
        processed.push({
          original: result.url,
          canonical,
          searchResult: result,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({ url: result.url, error: errorMessage, stage: "fetch" });
      }
    }
    
    return processed;
  }
  
  private deduplicateByCanonicalUrl(urls: ProcessedUrl[]): ProcessedUrl[] {
    const seen = new Map<string, ProcessedUrl>();
    
    for (const url of urls) {
      if (!seen.has(url.canonical)) {
        seen.set(url.canonical, url);
      }
    }
    
    return Array.from(seen.values());
  }
  
  private async fetchContents(
    urls: ProcessedUrl[],
    request: RetrievalRequest,
    errors: RetrievalPipelineResult["errors"]
  ): Promise<FetchedContent[]> {
    const results: FetchedContent[] = [];
    
    const fetchPromises = urls.slice(0, request.maxResults * 2).map(async (url) => {
      const startTime = Date.now();
      const allowBrowser = request.allowBrowser !== false;
      
      try {
        if (request.preferBrowser && allowBrowser) {
          const browseResult = await this.browserAdapter.browse(url.original);
          
          if (browseResult.success && browseResult.content) {
            return {
              url,
              content: browseResult.content,
              fetchResult: browseResult,
              method: "browser" as const,
              timing: { fetchMs: Date.now() - startTime },
            };
          }
        }
        
        const fetchResult = await this.fetchAdapter.fetch(url.original);
        
        if (fetchResult.success && fetchResult.content) {
          const needsBrowser = this.needsBrowserFallback(fetchResult);
          
          if (needsBrowser && allowBrowser) {
            const browseResult = await this.browserAdapter.browse(url.original);
            
            if (browseResult.success && browseResult.content) {
              return {
                url,
                content: browseResult.content,
                fetchResult: browseResult,
                method: "browser" as const,
                timing: { fetchMs: Date.now() - startTime },
              };
            }
          }
          
          return {
            url,
            content: fetchResult.content,
            fetchResult,
            method: "fetch" as const,
            timing: { fetchMs: Date.now() - startTime },
          };
        }

        if (allowBrowser) {
          const browseResult = await this.browserAdapter.browse(url.original);

          if (browseResult.success && browseResult.content) {
            return {
              url,
              content: browseResult.content,
              fetchResult: browseResult,
              method: "browser" as const,
              timing: { fetchMs: Date.now() - startTime },
            };
          }

          errors.push({
            url: url.original,
            error: browseResult.error || fetchResult.error || "Failed to fetch content",
            stage: "browse",
          });
          return null;
        }

        errors.push({
          url: url.original,
          error: fetchResult.error || "Failed to fetch content",
          stage: "fetch",
        });
        return null;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({ url: url.original, error: errorMessage, stage: "fetch" });
        return null;
      }
    });
    
    const fetchedResults = await Promise.all(fetchPromises);
    
    for (const result of fetchedResults) {
      if (result) {
        results.push(result);
      }
    }
    
    return results;
  }
  
  private needsBrowserFallback(fetchResult: FetchResult): boolean {
    if (!fetchResult.content) return true;
    
    const content = fetchResult.content.toLowerCase();
    
    if (content.includes("javascript") && content.includes("required")) return true;
    if (content.includes("enable javascript")) return true;
    if (content.includes("please enable javascript")) return true;
    if (content.includes("noscript")) return true;
    
    const textLength = content.replace(/<[^>]+>/g, "").trim().length;
    if (textLength < 200 && content.includes("<script")) return true;
    
    const contentType = fetchResult.contentType || "";
    if (contentType.includes("application/javascript")) return true;
    
    return false;
  }
  
  private async extractReadableContent(
    fetchedContents: FetchedContent[],
    request: RetrievalRequest,
    errors: RetrievalPipelineResult["errors"]
  ): Promise<ExtractedContent[]> {
    if (!request.extractReadable) {
      return fetchedContents.map(fc => ({
        ...fc,
        title: fc.url.searchResult.title,
        timing: { ...fc.timing, extractMs: 0 },
      }));
    }
    
    const results: ExtractedContent[] = [];
    
    for (const fetched of fetchedContents) {
      const extractStartTime = Date.now();
      
      try {
        const { title, content, extractedDocument } = this.extractWithReadability(
          fetched.content,
          fetched.url.original
        );
        
        results.push({
          ...fetched,
          title: title || fetched.url.searchResult.title,
          content: content || fetched.content,
          extractedDocument,
          timing: { 
            ...fetched.timing, 
            extractMs: Date.now() - extractStartTime 
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({ url: fetched.url.original, error: errorMessage, stage: "extract" });
        
        results.push({
          ...fetched,
          title: fetched.url.searchResult.title,
          timing: { 
            ...fetched.timing, 
            extractMs: Date.now() - extractStartTime 
          },
        });
      }
    }
    
    return results;
  }
  
  private extractWithReadability(html: string, url: string): { title: string; content: string; extractedDocument: ExtractedDocument } {
    try {
      const dom = new JSDOM(html, { url });
      const document = dom.window.document;
      const reader = new Readability(document.cloneNode(true) as Document);
      const article = reader.parse();
      
      const headings = this.extractHeadings(document);
      const links = this.extractLinks(document, url);
      const language = this.detectLanguage(document, article?.content || html);
      const { hasAuthor, hasCitations, hasReferences } = this.detectAuthoritativeness(document, html);
      
      let content = "";
      let title = "";
      
      if (article) {
        title = article.title || "";
        content = article.textContent?.replace(/\s+/g, " ").trim() || "";
      } else {
        let text = html;
        text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
        text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
        text = text.replace(/<[^>]+>/g, " ");
        text = text.replace(/\s+/g, " ").trim();
        content = text;
      }
      
      const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
      const readTimeMinutes = Math.ceil(wordCount / WORDS_PER_MINUTE);
      
      const extractedDocument: ExtractedDocument = {
        title,
        content,
        headings,
        links,
        wordCount,
        readTimeMinutes,
        language,
        hasAuthor,
        hasCitations,
        hasReferences,
      };
      
      return { title, content, extractedDocument };
    } catch {
      const fallbackContent = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const wordCount = fallbackContent.split(/\s+/).filter(w => w.length > 0).length;
      
      return { 
        title: "", 
        content: fallbackContent,
        extractedDocument: {
          title: "",
          content: fallbackContent,
          headings: [],
          links: [],
          wordCount,
          readTimeMinutes: Math.ceil(wordCount / WORDS_PER_MINUTE),
          hasAuthor: false,
          hasCitations: false,
          hasReferences: false,
        }
      };
    }
  }
  
  private extractHeadings(document: Document): Heading[] {
    const headings: Heading[] = [];
    
    for (let level = 1; level <= 6; level++) {
      const elements = document.querySelectorAll(`h${level}`);
      elements.forEach(el => {
        const text = el.textContent?.trim();
        if (text) {
          headings.push({ level, text });
        }
      });
    }
    
    return headings;
  }
  
  private extractLinks(document: Document, baseUrl: string): ExtractedLink[] {
    const links: ExtractedLink[] = [];
    const anchorElements = document.querySelectorAll("a[href]");
    const baseDomain = extractDomain(baseUrl);
    
    anchorElements.forEach(el => {
      const href = el.getAttribute("href");
      const text = el.textContent?.trim() || "";
      
      if (href && text && !href.startsWith("#") && !href.startsWith("javascript:")) {
        try {
          const absoluteUrl = new URL(href, baseUrl).href;
          const linkDomain = extractDomain(absoluteUrl);
          const isExternal = linkDomain !== baseDomain;
          
          links.push({ href: absoluteUrl, text, isExternal });
        } catch {
          if (href.startsWith("/") || href.startsWith("http")) {
            links.push({ href, text, isExternal: true });
          }
        }
      }
    });
    
    return links.slice(0, 100);
  }
  
  private detectLanguage(document: Document, content: string): string | undefined {
    const htmlLang = document.documentElement.getAttribute("lang");
    if (htmlLang) {
      return htmlLang.split("-")[0].toLowerCase();
    }
    
    const metaLang = document.querySelector('meta[http-equiv="content-language"]');
    if (metaLang) {
      const langContent = metaLang.getAttribute("content");
      if (langContent) {
        return langContent.split("-")[0].toLowerCase();
      }
    }
    
    return undefined;
  }
  
  private detectAuthoritativeness(document: Document, html: string): { hasAuthor: boolean; hasCitations: boolean; hasReferences: boolean } {
    const lowerHtml = html.toLowerCase();
    
    const hasAuthor = !!(
      document.querySelector('[rel="author"]') ||
      document.querySelector('[class*="author"]') ||
      document.querySelector('[itemprop="author"]') ||
      document.querySelector('meta[name="author"]') ||
      lowerHtml.includes('written by') ||
      lowerHtml.includes('posted by')
    );
    
    const hasCitations = !!(
      document.querySelector('[class*="citation"]') ||
      document.querySelector('[class*="cite"]') ||
      document.querySelector('cite') ||
      lowerHtml.includes('[1]') ||
      lowerHtml.includes('et al.') ||
      /\(\d{4}\)/.test(html)
    );
    
    const hasReferences = !!(
      document.querySelector('[id*="reference"]') ||
      document.querySelector('[class*="reference"]') ||
      document.querySelector('[id*="bibliography"]') ||
      lowerHtml.includes('references</h') ||
      lowerHtml.includes('bibliography</h') ||
      lowerHtml.includes('works cited</h')
    );
    
    return { hasAuthor, hasCitations, hasReferences };
  }
  
  private scoreAndHash(
    extractedContents: ExtractedContent[],
    request: RetrievalRequest,
    errors: RetrievalPipelineResult["errors"]
  ): RetrievalResult[] {
    const results: RetrievalResult[] = [];
    
    for (const extracted of extractedContents) {
      try {
        const headers = "headers" in extracted.fetchResult 
          ? extracted.fetchResult.headers 
          : {};
        
        const contentLength = extracted.content.length;
        
        const contentMetadata: ContentMetadata | undefined = extracted.extractedDocument ? {
          author: extracted.extractedDocument.hasAuthor ? "present" : undefined,
          hasCitations: extracted.extractedDocument.hasCitations,
          hasReferences: extracted.extractedDocument.hasReferences,
        } : undefined;
        
        const qualityScore = calculateQualityScore(
          extracted.url.canonical,
          headers as Record<string, string>,
          contentLength,
          undefined,
          contentMetadata
        );
        
        const contentHash = hashContent(extracted.content);
        
        const totalMs = extracted.timing.fetchMs + (extracted.timing.extractMs || 0);
        
        results.push({
          url: extracted.url.original,
          canonicalUrl: extracted.url.canonical,
          title: extracted.title,
          snippet: extracted.url.searchResult.snippet,
          content: extracted.content,
          contentHash,
          qualityScore,
          fetchMethod: extracted.method,
          timing: {
            fetchMs: extracted.timing.fetchMs,
            extractMs: extracted.timing.extractMs,
            totalMs,
          },
          metadata: {
            contentType: "contentType" in extracted.fetchResult 
              ? extracted.fetchResult.contentType 
              : undefined,
            lastModified: headers["last-modified"],
            contentLength,
            authors: extracted.url.searchResult.authors,
            year: extracted.url.searchResult.year,
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({ url: extracted.url.original, error: errorMessage, stage: "score" });
      }
    }
    
    return results;
  }
  
  private deduplicateByContentHash(results: RetrievalResult[]): RetrievalResult[] {
    const seen = new Map<string, RetrievalResult>();
    
    for (const result of results) {
      const existing = seen.get(result.contentHash);
      
      if (!existing || result.qualityScore.total > existing.qualityScore.total) {
        seen.set(result.contentHash, result);
      }
    }
    
    return Array.from(seen.values());
  }
  
  private recordMetrics(query: string, resultCount: number, durationMs: number, success: boolean): void {
    metricsCollector.record({
      toolName: "web_retrieval",
      latencyMs: durationMs,
      success,
      timestamp: new Date(),
    });
  }
}

export const retrievalPipeline = new RetrievalPipeline(
  searchAdapter,
  fetchAdapter,
  browserAdapter
);
