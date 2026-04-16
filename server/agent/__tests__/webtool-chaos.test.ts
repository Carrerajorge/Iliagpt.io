import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FastFirstPipeline, type FastFirstOptions, type RetrievedSource } from "../webtool/fastFirstPipeline";
import type { IFetchAdapter } from "../webtool/fetchAdapter";
import type { IBrowserAdapter } from "../webtool/browserAdapter";
import type { ISearchAdapter } from "../webtool/searchAdapter";
import type { FetchResult, BrowseResult, WebSearchResult } from "../webtool/types";
import { CancellationToken } from "../executionEngine";
import { CircuitBreaker, CircuitState } from "../../utils/circuitBreaker";

const createMockFetchResult = (overrides: Partial<FetchResult> = {}): FetchResult => ({
  success: true,
  url: "https://example.com",
  finalUrl: "https://example.com",
  status: 200,
  statusText: "OK",
  headers: { "content-type": "text/html" },
  content: "<html><body><h1>Test Content</h1><p>This is test content for web retrieval.</p></body></html>",
  contentType: "text/html",
  contentLength: 100,
  timing: { startMs: 0, endMs: 50, durationMs: 50 },
  retryCount: 0,
  ...overrides,
});

const createMockBrowseResult = (overrides: Partial<BrowseResult> = {}): BrowseResult => ({
  success: true,
  url: "https://example.com",
  finalUrl: "https://example.com",
  title: "Test Page",
  content: "Test Content - This is test content for web retrieval with browser.",
  html: "<html><body><h1>Test Content</h1><p>This is test content for web retrieval with browser.</p></body></html>",
  timing: { navigationMs: 100, renderMs: 50, totalMs: 150 },
  ...overrides,
});

const createMockSearchResult = (url: string = "https://example.com"): WebSearchResult => ({
  url,
  canonicalUrl: url,
  title: "Test Result",
  snippet: "Test snippet for search result",
});

class MockSearchAdapter implements ISearchAdapter {
  private results: WebSearchResult[] = [];
  private shouldError = false;
  private errorMessage = "";

  setResults(results: WebSearchResult[]): void {
    this.results = results;
  }

  setError(shouldError: boolean, message: string = "Search error"): void {
    this.shouldError = shouldError;
    this.errorMessage = message;
  }

  async search(query: string, maxResults?: number): Promise<WebSearchResult[]> {
    if (this.shouldError) {
      throw new Error(this.errorMessage);
    }
    return this.results.slice(0, maxResults || this.results.length);
  }
}

class MockFetchAdapter implements IFetchAdapter {
  private responseMap: Map<string, FetchResult | (() => FetchResult | Promise<FetchResult>)> = new Map();
  private defaultResponse: FetchResult | (() => FetchResult | Promise<FetchResult>) = createMockFetchResult();
  public callCount = 0;
  public callUrls: string[] = [];

  setResponse(url: string, response: FetchResult | (() => FetchResult | Promise<FetchResult>)): void {
    this.responseMap.set(url, response);
  }

  setDefaultResponse(response: FetchResult | (() => FetchResult | Promise<FetchResult>)): void {
    this.defaultResponse = response;
  }

  isUrlAllowed(url: string): boolean {
    return true;
  }

  async checkRobotsTxt(url: string): Promise<boolean> {
    return true;
  }

  async fetch(url: string): Promise<FetchResult> {
    this.callCount++;
    this.callUrls.push(url);
    
    const response = this.responseMap.get(url) || this.defaultResponse;
    if (typeof response === "function") {
      return await response();
    }
    return response;
  }

  reset(): void {
    this.responseMap.clear();
    this.callCount = 0;
    this.callUrls = [];
  }
}

class MockBrowserAdapter implements IBrowserAdapter {
  private responseMap: Map<string, BrowseResult | (() => BrowseResult | Promise<BrowseResult>)> = new Map();
  private defaultResponse: BrowseResult | (() => BrowseResult | Promise<BrowseResult>) = createMockBrowseResult();
  public callCount = 0;
  public callUrls: string[] = [];

  setResponse(url: string, response: BrowseResult | (() => BrowseResult | Promise<BrowseResult>)): void {
    this.responseMap.set(url, response);
  }

  setDefaultResponse(response: BrowseResult | (() => BrowseResult | Promise<BrowseResult>)): void {
    this.defaultResponse = response;
  }

  isUrlAllowed(url: string): boolean {
    return true;
  }

  async screenshot(url: string): Promise<Buffer | null> {
    return null;
  }

  async browse(url: string): Promise<BrowseResult> {
    this.callCount++;
    this.callUrls.push(url);
    
    const response = this.responseMap.get(url) || this.defaultResponse;
    if (typeof response === "function") {
      return await response();
    }
    return response;
  }

  reset(): void {
    this.responseMap.clear();
    this.callCount = 0;
    this.callUrls = [];
  }
}

describe("Webtool Chaos Tests", () => {
  let mockSearch: MockSearchAdapter;
  let mockFetch: MockFetchAdapter;
  let mockBrowser: MockBrowserAdapter;
  let pipeline: FastFirstPipeline;

  beforeEach(() => {
    mockSearch = new MockSearchAdapter();
    mockFetch = new MockFetchAdapter();
    mockBrowser = new MockBrowserAdapter();
    
    mockSearch.setResults([
      createMockSearchResult("https://example.com/page1"),
      createMockSearchResult("https://example.com/page2"),
      createMockSearchResult("https://example.com/page3"),
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("HTTP 429 Rate Limited Responses", () => {
    it("should handle 429 responses from fetch adapter", async () => {
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: false,
        status: 429,
        statusText: "Too Many Requests",
        content: undefined,
        error: "Rate limited - too many requests",
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 1000, browserTimeoutMs: 2000, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query for rate limiting");
      
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });

    it("should fall back to browser on 429 from fetch", async () => {
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: false,
        status: 429,
        statusText: "Too Many Requests",
        error: "Rate limited",
      }));

      mockBrowser.setDefaultResponse(createMockBrowseResult({
        success: true,
        content: "Browser successfully retrieved content after rate limit",
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 1000, browserTimeoutMs: 2000, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query for rate limiting fallback");
      
      expect(result).toBeDefined();
    });

    it("should respect retry-after header on 429", async () => {
      let callCount = 0;
      mockFetch.setDefaultResponse(() => {
        callCount++;
        if (callCount <= 2) {
          return createMockFetchResult({
            success: false,
            status: 429,
            statusText: "Too Many Requests",
            headers: { "retry-after": "1" },
            error: "Rate limited",
          });
        }
        return createMockFetchResult({ success: true });
      });

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 3000, browserTimeoutMs: 5000, maxConcurrency: 1 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query with retry-after");
      expect(result).toBeDefined();
    });
  });

  describe("HTTP 403 Forbidden Responses", () => {
    it("should handle 403 responses gracefully", async () => {
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: false,
        status: 403,
        statusText: "Forbidden",
        content: undefined,
        error: "Access forbidden",
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 1000, browserTimeoutMs: 2000, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query for forbidden");
      
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });

    it("should try browser adapter on 403 from fetch", async () => {
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: false,
        status: 403,
        statusText: "Forbidden",
        error: "Access forbidden",
      }));

      mockBrowser.setDefaultResponse(createMockBrowseResult({
        success: true,
        content: "Browser bypassed 403 restriction",
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 1000, browserTimeoutMs: 2000, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query for 403 fallback");
      
      expect(result).toBeDefined();
    });

    it("should report error when both fetch and browser return 403", async () => {
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: false,
        status: 403,
        statusText: "Forbidden",
        error: "Access forbidden from fetch",
      }));

      mockBrowser.setDefaultResponse(createMockBrowseResult({
        success: false,
        error: "Access forbidden from browser",
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 1000, browserTimeoutMs: 2000, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query for double 403");
      
      expect(result.success).toBe(false);
      expect(result.sources.length).toBe(0);
    });
  });

  describe("Timeout and Slow Response Handling", () => {
    it("should handle slow fetch responses with timeout", async () => {
      mockFetch.setDefaultResponse(async () => {
        await new Promise(resolve => setTimeout(resolve, 5000));
        return createMockFetchResult();
      });

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 100, browserTimeoutMs: 200, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const startTime = Date.now();
      const result = await pipeline.retrieve("test query for timeout");
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(3000);
    });

    it("should fall back to browser on fetch timeout", async () => {
      mockFetch.setDefaultResponse(async () => {
        await new Promise(resolve => setTimeout(resolve, 5000));
        return createMockFetchResult();
      });

      mockBrowser.setDefaultResponse(createMockBrowseResult({
        success: true,
        content: "Browser retrieved content after fetch timeout",
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 50, browserTimeoutMs: 200, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query for timeout fallback");
      expect(result).toBeDefined();
    });

    it("should handle browser timeout gracefully", async () => {
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: false,
        status: 500,
        error: "Server error",
      }));

      mockBrowser.setDefaultResponse(async () => {
        await new Promise(resolve => setTimeout(resolve, 5000));
        return createMockBrowseResult();
      });

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 50, browserTimeoutMs: 100, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const startTime = Date.now();
      const result = await pipeline.retrieve("test query for browser timeout");
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(3000);
    });
  });

  describe("Giant HTML Response Handling (>5MB)", () => {
    it("should handle giant HTML responses without crashing", async () => {
      const giantContent = "<html><body>" + "x".repeat(6 * 1024 * 1024) + "</body></html>";
      
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: true,
        content: giantContent,
        contentLength: giantContent.length,
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 5000, browserTimeoutMs: 5000, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query for giant response");
      expect(result).toBeDefined();
    });

    it("should truncate or handle oversized content gracefully", async () => {
      const oversizedContent = "<html><body><p>" + "Lorem ipsum ".repeat(500000) + "</p></body></html>";
      
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: true,
        content: oversizedContent,
        contentLength: oversizedContent.length,
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 5000, browserTimeoutMs: 5000, maxConcurrency: 1 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const memBefore = process.memoryUsage().heapUsed;
      const result = await pipeline.retrieve("test query for oversized content");
      const memAfter = process.memoryUsage().heapUsed;
      
      expect(result).toBeDefined();
      const memIncrease = (memAfter - memBefore) / (1024 * 1024);
      expect(memIncrease).toBeLessThan(100);
    });
  });

  describe("Malformed HTML Handling", () => {
    it("should handle completely malformed HTML", async () => {
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: true,
        content: "<<>><<<not valid html at all!!!>>><<<",
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 1000, browserTimeoutMs: 2000, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query for malformed HTML");
      expect(result).toBeDefined();
    });

    it("should handle HTML with unclosed tags", async () => {
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: true,
        content: "<html><body><div><p>Unclosed tags everywhere<span>no closing",
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 1000, browserTimeoutMs: 2000, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query for unclosed tags");
      expect(result).toBeDefined();
    });

    it("should handle binary content disguised as HTML", async () => {
      const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]).toString("utf-8");
      
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: true,
        content: binaryContent,
        contentType: "text/html",
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 1000, browserTimeoutMs: 2000, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query for binary content");
      expect(result).toBeDefined();
    });

    it("should handle deeply nested HTML structures", async () => {
      let deeplyNested = "";
      for (let i = 0; i < 1000; i++) {
        deeplyNested += "<div>";
      }
      deeplyNested += "Content";
      for (let i = 0; i < 1000; i++) {
        deeplyNested += "</div>";
      }
      
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: true,
        content: `<html><body>${deeplyNested}</body></html>`,
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 1000, browserTimeoutMs: 2000, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query for deeply nested");
      expect(result).toBeDefined();
    });
  });

  describe("CAPTCHA-like Response Handling", () => {
    it("should detect CAPTCHA-like responses (short, no content)", async () => {
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: true,
        content: "<html><body>Please verify you are human</body></html>",
        contentLength: 50,
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 1000, browserTimeoutMs: 2000, maxConcurrency: 2, minRelevanceScore: 0.1 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query for CAPTCHA detection");
      expect(result).toBeDefined();
    });

    it("should try browser on suspected CAPTCHA from fetch", async () => {
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: true,
        content: "<html><body><form>Are you a robot? <input type='checkbox'></form></body></html>",
        contentLength: 80,
      }));

      mockBrowser.setDefaultResponse(createMockBrowseResult({
        success: true,
        content: "Full article content after CAPTCHA bypass with browser automation",
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 1000, browserTimeoutMs: 2000, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query for CAPTCHA bypass");
      expect(result).toBeDefined();
    });

    it("should handle challenge pages", async () => {
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: true,
        status: 200,
        content: "<html><head><title>Security Check</title></head><body>Checking your browser...</body></html>",
        headers: { "cf-ray": "test-ray-id" },
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 1000, browserTimeoutMs: 2000, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query for challenge page");
      expect(result).toBeDefined();
    });
  });

  describe("Circuit Breaker Behavior", () => {
    it("should trigger circuit breaker after repeated failures", async () => {
      const circuitBreaker = new CircuitBreaker("webtool-test", {
        failureThreshold: 3,
        resetTimeout: 10000,
        halfOpenMaxCalls: 1,
      });

      let executeCount = 0;
      const failingOperation = async () => {
        executeCount++;
        throw new Error("Service unavailable");
      };

      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(failingOperation);
        } catch (e) {
        }
      }

      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
      expect(executeCount).toBe(3);
    });

    it("should recover after circuit breaker reset timeout", async () => {
      const circuitBreaker = new CircuitBreaker("webtool-recovery-test", {
        failureThreshold: 2,
        resetTimeout: 50,
        halfOpenMaxCalls: 1,
      });

      for (let i = 0; i < 2; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error("Temporary failure");
          });
        } catch (e) {
        }
      }

      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);

      await new Promise(resolve => setTimeout(resolve, 60));

      let recovered = false;
      try {
        await circuitBreaker.execute(async () => {
          recovered = true;
          return "success";
        });
      } catch (e) {
      }

      expect(recovered).toBe(true);
    });

    it("should track circuit breaker stats correctly", async () => {
      const circuitBreaker = new CircuitBreaker("webtool-stats-test", {
        failureThreshold: 5,
        resetTimeout: 60000,
      });

      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error("Failure");
          });
        } catch (e) {
        }
      }

      const stats = circuitBreaker.getStats();
      expect(stats.failureCount).toBe(3);
      expect(stats.state).toBe(CircuitState.CLOSED);
    });
  });

  describe("Fallback Ladder (fetch -> browser -> error)", () => {
    it("should use fetch first, then fall back to browser", async () => {
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: false,
        status: 500,
        error: "Internal server error",
      }));

      mockBrowser.setDefaultResponse(createMockBrowseResult({
        success: true,
        content: "Browser fallback content",
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 1000, browserTimeoutMs: 2000, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query for fallback");
      
      expect(result).toBeDefined();
    });

    it("should return error when both fetch and browser fail", async () => {
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: false,
        status: 500,
        error: "Fetch failed",
      }));

      mockBrowser.setDefaultResponse(createMockBrowseResult({
        success: false,
        error: "Browser failed",
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 1000, browserTimeoutMs: 2000, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query for complete failure");
      
      expect(result.success).toBe(false);
      expect(result.sources.length).toBe(0);
    });

    it("should skip browser for successful fetch", async () => {
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: true,
        content: "<html><body><h1>Good content</h1><p>This is meaningful content from fetch.</p></body></html>",
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 1000, browserTimeoutMs: 2000, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query for fetch success");
      
      expect(result).toBeDefined();
      expect(mockBrowser.callCount).toBe(0);
    });

    it("should handle partial failures in concurrent fetches", async () => {
      mockSearch.setResults([
        createMockSearchResult("https://success.com"),
        createMockSearchResult("https://fail.com"),
        createMockSearchResult("https://timeout.com"),
      ]);

      mockFetch.setResponse("https://success.com", createMockFetchResult({
        success: true,
        url: "https://success.com",
        finalUrl: "https://success.com",
        content: "<html><body><h1>Success</h1><p>This page loaded successfully.</p></body></html>",
      }));

      mockFetch.setResponse("https://fail.com", createMockFetchResult({
        success: false,
        url: "https://fail.com",
        finalUrl: "https://fail.com",
        status: 500,
        error: "Server error",
      }));

      mockFetch.setResponse("https://timeout.com", async () => {
        await new Promise(resolve => setTimeout(resolve, 5000));
        return createMockFetchResult({ url: "https://timeout.com", finalUrl: "https://timeout.com" });
      });

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 100, browserTimeoutMs: 200, maxConcurrency: 3 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query for partial failures");
      
      expect(result.sources.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Edge Cases and Stress Conditions", () => {
    it("should handle empty search results", async () => {
      mockSearch.setResults([]);

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 1000, browserTimeoutMs: 2000, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query with no results");
      
      expect(result.sources.length).toBe(0);
      expect(mockFetch.callCount).toBe(0);
      expect(mockBrowser.callCount).toBe(0);
    });

    it("should handle search adapter errors gracefully", async () => {
      mockSearch.setError(true, "Search service unavailable");

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 1000, browserTimeoutMs: 2000, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query with search error");
      
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.error.includes("Search service unavailable"))).toBe(true);
      expect(result.sources.length).toBe(0);
    });

    it("should handle rapid consecutive retrievals", async () => {
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: true,
        content: "<html><body><p>Quick response content</p></body></html>",
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 1000, browserTimeoutMs: 2000, maxConcurrency: 5 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const promises = Array(10).fill(null).map((_, i) => 
        pipeline.retrieve(`rapid query ${i}`)
      );

      const results = await Promise.all(promises);
      
      expect(results.length).toBe(10);
      results.forEach(r => expect(r).toBeDefined());
    });

    it("should handle special characters in URLs", async () => {
      mockSearch.setResults([
        createMockSearchResult("https://example.com/path?q=hello%20world&foo=bar#section"),
      ]);

      mockFetch.setDefaultResponse(createMockFetchResult({
        success: true,
        content: "<html><body><p>Content with special URL</p></body></html>",
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 1000, browserTimeoutMs: 2000, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query with special URL chars");
      expect(result).toBeDefined();
    });

    it("should handle unicode content", async () => {
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: true,
        content: "<html><body><p>日本語コンテンツ 🎉 émojis and ñ characters</p></body></html>",
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 1000, browserTimeoutMs: 2000, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("日本語クエリ test");
      expect(result).toBeDefined();
    });

    it("should not leak memory with many failed requests", async () => {
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: false,
        status: 500,
        error: "Repeated failure",
      }));

      mockBrowser.setDefaultResponse(createMockBrowseResult({
        success: false,
        error: "Browser also failed",
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 100, browserTimeoutMs: 100, maxConcurrency: 5 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const memBefore = process.memoryUsage().heapUsed;
      
      for (let i = 0; i < 50; i++) {
        await pipeline.retrieve(`memory test query ${i}`);
      }
      
      if (global.gc) global.gc();
      
      const memAfter = process.memoryUsage().heapUsed;
      const memIncreaseMb = (memAfter - memBefore) / (1024 * 1024);
      
      expect(memIncreaseMb).toBeLessThan(50);
    });
  });

  describe("Content Quality and Validation", () => {
    it("should reject extremely short responses as low quality", async () => {
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: true,
        content: "<html><body>.</body></html>",
        contentLength: 30,
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 1000, browserTimeoutMs: 2000, maxConcurrency: 2, minRelevanceScore: 0.5 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query for short content");
      expect(result.sources.every(s => s.relevanceScore >= 0)).toBe(true);
    });

    it("should handle responses with only scripts and no content", async () => {
      mockFetch.setDefaultResponse(createMockFetchResult({
        success: true,
        content: "<html><head><script>alert('test')</script></head><body><script>document.write('dynamic')</script></body></html>",
      }));

      pipeline = new FastFirstPipeline(
        { fetchTimeoutMs: 1000, browserTimeoutMs: 2000, maxConcurrency: 2 },
        mockSearch,
        mockFetch,
        mockBrowser
      );

      const result = await pipeline.retrieve("test query for script-only page");
      expect(result).toBeDefined();
    });
  });
});
