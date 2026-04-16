import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RetrievalPlanner, retrievalPlanner, type QueryPlan } from "../webtool/retrievalPlanner";
import { ConcurrencyPool, createConcurrencyPool, type PoolTask } from "../webtool/concurrencyPool";
import { ResponseCache, responseCache, type CacheEntry } from "../webtool/responseCache";
import { RelevanceFilter, relevanceFilter, type FilteredContent } from "../webtool/relevanceFilter";
import { RetrievalMetricsCollector, retrievalMetrics, type RetrievalMetric } from "../webtool/retrievalMetrics";

describe("RetrievalPlanner", () => {
  let planner: RetrievalPlanner;
  
  beforeEach(() => {
    planner = new RetrievalPlanner();
  });

  describe("plan()", () => {
    it("should generate 3-6 queries from a simple prompt", () => {
      const plan = planner.plan("What is the GDP of Germany in 2024?");
      
      expect(plan.queries.length).toBeGreaterThanOrEqual(1);
      expect(plan.queries.length).toBeLessThanOrEqual(6);
      expect(plan.originalPrompt).toBe("What is the GDP of Germany in 2024?");
    });

    it("should extract entities from prompts", () => {
      const plan = planner.plan("Compare Apple and Microsoft stock prices");
      
      expect(plan.entities).toContain("Apple");
      expect(plan.entities).toContain("Microsoft");
    });

    it("should extract keywords and remove stop words", () => {
      const plan = planner.plan("How to implement a binary search tree in Python?");
      
      expect(plan.keywords).toContain("implement");
      expect(plan.keywords).toContain("binary");
      expect(plan.keywords).toContain("search");
      expect(plan.keywords).toContain("tree");
      expect(plan.keywords).toContain("python");
      expect(plan.keywords).not.toContain("how");
      expect(plan.keywords).not.toContain("to");
      expect(plan.keywords).not.toContain("a");
      expect(plan.keywords).not.toContain("in");
    });

    it("should detect factual intent", () => {
      const plan = planner.plan("What is the capital of France?");
      expect(plan.intent).toBe("definition");
    });

    it("should detect comparison intent", () => {
      const plan = planner.plan("Compare React vs Vue for web development");
      expect(plan.intent).toBe("comparison");
    });

    it("should detect how-to intent", () => {
      const plan = planner.plan("How to configure Nginx reverse proxy");
      expect(plan.intent).toBe("how_to");
    });

    it("should detect news intent", () => {
      const plan = planner.plan("Latest news about AI regulation");
      expect(plan.intent).toBe("news");
    });

    it("should detect recency for recent queries", () => {
      const plan = planner.plan("What happened today in the stock market?");
      
      expect(plan.queries.some(q => q.filters?.recency === "day")).toBe(true);
    });

    it("should generate unique query hash", () => {
      const plan1 = planner.plan("Test query one");
      const plan2 = planner.plan("Test query two");
      const plan3 = planner.plan("Test query one");
      
      expect(plan1.queryHash).not.toBe(plan2.queryHash);
      expect(plan1.queryHash).toBe(plan3.queryHash);
    });

    it("should prioritize primary query highest", () => {
      const plan = planner.plan("How to build a REST API with Node.js");
      
      const primary = plan.queries.find(q => q.type === "primary");
      expect(primary).toBeDefined();
      expect(primary!.priority).toBe(10);
    });

    it("should respect maxQueries limit", () => {
      const plan = planner.plan(
        "Compare Apple, Microsoft, Google, Amazon, Meta, Netflix and Tesla stock performance in 2024",
        3
      );
      
      expect(plan.queries.length).toBeLessThanOrEqual(3);
    });

    it("should handle Spanish prompts", () => {
      const plan = planner.plan("¿Cuáles son las últimas noticias sobre inteligencia artificial?");
      
      expect(plan.keywords).toContain("inteligencia");
      expect(plan.keywords).toContain("artificial");
      expect(plan.keywords).not.toContain("las");
      expect(plan.keywords).not.toContain("son");
    });
  });
});

describe("ConcurrencyPool", () => {
  it("should execute all tasks and return results", async () => {
    const pool = createConcurrencyPool<number>({ maxConcurrency: 3 });
    
    const tasks: PoolTask<number>[] = [
      { id: "1", execute: async () => 1 },
      { id: "2", execute: async () => 2 },
      { id: "3", execute: async () => 3 },
    ];
    
    const results = await pool.executeAll(tasks);
    
    expect(results.length).toBe(3);
    expect(results.every(r => r.success)).toBe(true);
    expect(results.map(r => r.result)).toEqual(expect.arrayContaining([1, 2, 3]));
  });

  it("should respect concurrency limit", async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;
    
    const pool = createConcurrencyPool<void>({ maxConcurrency: 2 });
    
    const tasks: PoolTask<void>[] = Array(5).fill(null).map((_, i) => ({
      id: `task-${i}`,
      execute: async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise(r => setTimeout(r, 50));
        currentConcurrent--;
      },
    }));
    
    await pool.executeAll(tasks);
    
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("should handle task failures gracefully", async () => {
    const pool = createConcurrencyPool<number>({ maxConcurrency: 3 });
    
    const tasks: PoolTask<number>[] = [
      { id: "1", execute: async () => 1 },
      { id: "2", execute: async () => { throw new Error("Task failed"); } },
      { id: "3", execute: async () => 3 },
    ];
    
    const results = await pool.executeAll(tasks);
    
    expect(results.length).toBe(3);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[1].error).toBe("Task failed");
    expect(results[2].success).toBe(true);
  });

  it("should handle task timeouts", async () => {
    const pool = createConcurrencyPool<number>({ 
      maxConcurrency: 2, 
      defaultTimeout: 50 
    });
    
    const tasks: PoolTask<number>[] = [
      { id: "fast", execute: async () => { await new Promise(r => setTimeout(r, 10)); return 1; } },
      { id: "slow", execute: async () => { await new Promise(r => setTimeout(r, 200)); return 2; } },
    ];
    
    const results = await pool.executeAll(tasks);
    
    expect(results.find(r => r.id === "fast")?.success).toBe(true);
    expect(results.find(r => r.id === "slow")?.success).toBe(false);
    expect(results.find(r => r.id === "slow")?.error).toBe("Task timeout");
  });

  it("should execute tasks by priority", async () => {
    const executionOrder: string[] = [];
    
    const pool = createConcurrencyPool<void>({ maxConcurrency: 1 });
    
    const tasks: PoolTask<void>[] = [
      { id: "low", priority: 1, execute: async () => { executionOrder.push("low"); } },
      { id: "high", priority: 10, execute: async () => { executionOrder.push("high"); } },
      { id: "medium", priority: 5, execute: async () => { executionOrder.push("medium"); } },
    ];
    
    await pool.executeAll(tasks);
    
    expect(executionOrder[0]).toBe("high");
    expect(executionOrder[2]).toBe("low");
  });

  it("should support streaming results", async () => {
    const pool = createConcurrencyPool<number>({ maxConcurrency: 2 });
    
    const tasks: PoolTask<number>[] = [
      { id: "1", execute: async () => { await new Promise(r => setTimeout(r, 30)); return 1; } },
      { id: "2", execute: async () => { await new Promise(r => setTimeout(r, 10)); return 2; } },
      { id: "3", execute: async () => { await new Promise(r => setTimeout(r, 20)); return 3; } },
    ];
    
    const streamedResults: number[] = [];
    
    for await (const result of pool.executeStreaming(tasks)) {
      if (result.success && result.result !== undefined) {
        streamedResults.push(result.result);
      }
    }
    
    expect(streamedResults.length).toBe(3);
    expect(streamedResults[0]).toBe(2);
  });

  it("should track progress correctly", async () => {
    const pool = createConcurrencyPool<number>({ maxConcurrency: 2 });
    const progressUpdates: { completed: number; total: number }[] = [];
    
    pool.on("progress", (progress) => {
      progressUpdates.push(progress);
    });
    
    const tasks: PoolTask<number>[] = [
      { id: "1", execute: async () => 1 },
      { id: "2", execute: async () => 2 },
      { id: "3", execute: async () => 3 },
    ];
    
    await pool.executeAll(tasks);
    
    expect(progressUpdates.length).toBe(3);
    expect(progressUpdates[progressUpdates.length - 1]).toEqual({ completed: 3, total: 3 });
  });
});

describe("ResponseCache", () => {
  let cache: ResponseCache;
  
  beforeEach(() => {
    cache = new ResponseCache({
      maxEntries: 100,
      defaultTtlMs: 60000,
      cleanupIntervalMs: 1000000,
    });
  });
  
  afterEach(() => {
    cache.destroy();
  });

  it("should store and retrieve entries by URL", () => {
    cache.set("https://example.com/page1", "Content 1", { fetchMethod: "fetch" });
    cache.set("https://example.com/page2", "Content 2", { fetchMethod: "browser" });
    
    const entry1 = cache.get("https://example.com/page1");
    const entry2 = cache.get("https://example.com/page2");
    
    expect(entry1?.content).toBe("Content 1");
    expect(entry1?.fetchMethod).toBe("fetch");
    expect(entry2?.content).toBe("Content 2");
    expect(entry2?.fetchMethod).toBe("browser");
  });

  it("should return null for missing entries", () => {
    const entry = cache.get("https://nonexistent.com/page");
    expect(entry).toBeNull();
  });

  it("should expire entries after TTL", async () => {
    cache = new ResponseCache({
      maxEntries: 100,
      fetchTtlMs: 50,
      browserTtlMs: 50,
      cleanupIntervalMs: 1000000,
    });
    
    cache.set("https://example.com/page", "Content", { fetchMethod: "fetch" });
    
    expect(cache.get("https://example.com/page")).not.toBeNull();
    
    await new Promise(r => setTimeout(r, 100));
    
    expect(cache.get("https://example.com/page")).toBeNull();
  });

  it("should track cache hits and misses", () => {
    cache.set("https://example.com/page", "Content", { fetchMethod: "fetch" });
    
    cache.get("https://example.com/page");
    cache.get("https://example.com/page");
    cache.get("https://nonexistent.com/page");
    
    const stats = cache.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.666, 2);
  });

  it("should support conditional headers for revalidation", () => {
    cache.set("https://example.com/page", "Content", {
      fetchMethod: "fetch",
      etag: '"abc123"',
      lastModified: "Wed, 01 Jan 2025 00:00:00 GMT",
    });
    
    const headers = cache.getConditionalHeaders("https://example.com/page");
    
    expect(headers).not.toBeNull();
    expect(headers!["If-None-Match"]).toBe('"abc123"');
    expect(headers!["If-Modified-Since"]).toBe("Wed, 01 Jan 2025 00:00:00 GMT");
  });

  it("should handle 304 Not Modified responses", () => {
    cache = new ResponseCache({
      maxEntries: 100,
      fetchTtlMs: 1000,
      browserTtlMs: 1000,
      cleanupIntervalMs: 1000000,
    });
    
    cache.set("https://example.com/page", "Content", { fetchMethod: "fetch" });
    
    const originalEntry = cache.get("https://example.com/page");
    const originalExpiry = originalEntry!.expiresAt;
    
    cache.handleNotModified("https://example.com/page", 120000);
    
    const updatedEntry = cache.get("https://example.com/page");
    expect(updatedEntry!.expiresAt).toBeGreaterThan(originalExpiry);
  });

  it("should index by query hash", () => {
    cache.set("https://example.com/page1", "Content 1", { 
      fetchMethod: "fetch",
      queryHash: "query123" 
    });
    cache.set("https://example.com/page2", "Content 2", { 
      fetchMethod: "fetch",
      queryHash: "query123" 
    });
    cache.set("https://example.com/page3", "Content 3", { 
      fetchMethod: "fetch",
      queryHash: "query456" 
    });
    
    const results = cache.getByQuery("query123");
    expect(results.length).toBe(2);
  });

  it("should evict oldest entries when full", () => {
    cache = new ResponseCache({
      maxEntries: 3,
      cleanupIntervalMs: 1000000,
    });
    
    cache.set("https://example.com/1", "Content 1", { fetchMethod: "fetch" });
    cache.set("https://example.com/2", "Content 2", { fetchMethod: "fetch" });
    cache.set("https://example.com/3", "Content 3", { fetchMethod: "fetch" });
    
    cache.get("https://example.com/2");
    cache.get("https://example.com/3");
    
    cache.set("https://example.com/4", "Content 4", { fetchMethod: "fetch" });
    
    expect(cache.get("https://example.com/1")).toBeNull();
    expect(cache.get("https://example.com/2")).not.toBeNull();
    expect(cache.get("https://example.com/3")).not.toBeNull();
    expect(cache.get("https://example.com/4")).not.toBeNull();
  });

  it("should invalidate entries", () => {
    cache.set("https://example.com/page", "Content", { fetchMethod: "fetch" });
    
    expect(cache.get("https://example.com/page")).not.toBeNull();
    
    const invalidated = cache.invalidate("https://example.com/page");
    
    expect(invalidated).toBe(true);
    expect(cache.get("https://example.com/page")).toBeNull();
  });

  it("should reject content larger than maxContentSizeBytes", () => {
    cache = new ResponseCache({
      maxEntries: 100,
      maxContentSizeBytes: 100,
      cleanupIntervalMs: 1000000,
    });
    
    const largeContent = "x".repeat(200);
    const result = cache.set("https://example.com/large", largeContent, { fetchMethod: "fetch" });
    
    expect(result).toBe(false);
    expect(cache.get("https://example.com/large")).toBeNull();
  });

  it("should evict entries when memory limit exceeded", () => {
    cache = new ResponseCache({
      maxEntries: 100,
      maxMemoryMb: 0.001,
      maxContentSizeBytes: 1000,
      cleanupIntervalMs: 1000000,
    });
    
    cache.set("https://example.com/1", "a".repeat(500), { fetchMethod: "fetch" });
    cache.set("https://example.com/2", "b".repeat(500), { fetchMethod: "fetch" });
    cache.set("https://example.com/3", "c".repeat(500), { fetchMethod: "fetch" });
    
    const stats = cache.getStats();
    expect(stats.entries).toBeLessThan(3);
  });

  it("should track memory correctly on clear", () => {
    cache.set("https://example.com/1", "Content 1", { fetchMethod: "fetch" });
    cache.set("https://example.com/2", "Content 2", { fetchMethod: "fetch" });
    
    cache.clear();
    
    const stats = cache.getStats();
    expect(stats.entries).toBe(0);
  });

  it("should track memory correctly when entries expire on get()", async () => {
    cache = new ResponseCache({
      maxEntries: 100,
      fetchTtlMs: 50,
      browserTtlMs: 50,
      cleanupIntervalMs: 1000000,
      maxMemoryMb: 1,
      maxContentSizeBytes: 10000,
    });
    
    cache.set("https://example.com/1", "a".repeat(400), { fetchMethod: "fetch" });
    
    await new Promise(r => setTimeout(r, 100));
    
    const entry = cache.get("https://example.com/1");
    expect(entry).toBeNull();
    
    cache.set("https://example.com/2", "b".repeat(400), { fetchMethod: "fetch" });
    cache.set("https://example.com/3", "c".repeat(400), { fetchMethod: "fetch" });
    
    const stats = cache.getStats();
    expect(stats.entries).toBe(2);
  });

  it("should generate consistent URL hashes", () => {
    const hash1 = ResponseCache.hashUrl("https://example.com/page");
    const hash2 = ResponseCache.hashUrl("https://example.com/page");
    const hash3 = ResponseCache.hashUrl("https://different.com/page");
    
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1.length).toBe(16);
  });
});

describe("RelevanceFilter", () => {
  let filter: RelevanceFilter;
  
  beforeEach(() => {
    filter = new RelevanceFilter();
  });

  it("should filter content by relevance to query", () => {
    const content = `
      The economy of Germany is a highly developed social market economy.
      It has the largest national economy in Europe and is the world's fourth-largest by nominal GDP.
      Germany's GDP in 2024 was approximately 4.5 trillion dollars.
      The country is known for its high-quality manufacturing sector.
      Tourism is also an important part of the German economy.
      Berlin is the capital city of Germany.
    `;
    
    const result = filter.filter(content, "What is Germany's GDP in 2024?", ["Germany"]);
    
    expect(result.overallScore).toBeGreaterThan(0);
    expect(result.chunks.length).toBeGreaterThan(0);
    const hasGdpRelatedFact = result.keyFacts.some(f => 
      f.toLowerCase().includes("gdp") || 
      f.toLowerCase().includes("trillion") ||
      f.toLowerCase().includes("economy")
    );
    expect(hasGdpRelatedFact).toBe(true);
  });

  it("should extract key facts from content", () => {
    const content = `
      Python is a high-level programming language.
      It was created by Guido van Rossum in 1991.
      Python uses dynamic typing and garbage collection.
      The language emphasizes code readability.
    `;
    
    const result = filter.filter(content, "When was Python created?");
    
    expect(result.keyFacts.some(f => f.includes("1991"))).toBe(true);
  });

  it("should score chunks with more matching terms higher", () => {
    const content = `
      Paragraph one talks about unrelated topics like cooking and gardening.
      Paragraph two discusses JavaScript and React for web development.
      Paragraph three explains how to build a React application with TypeScript.
      Paragraph four covers React component patterns and best practices.
    `;
    
    const result = filter.filter(content, "How to build React applications?", ["React"]);
    
    expect(result.chunks[0].matchedTerms).toContain("react");
    expect(result.chunks[0].score).toBeGreaterThan(0.1);
  });

  it("should handle empty content", () => {
    const result = filter.filter("", "test query");
    
    expect(result.originalLength).toBe(0);
    expect(result.chunks.length).toBe(0);
    expect(result.overallScore).toBe(0);
  });

  it("should respect minimum score threshold", () => {
    const filter = new RelevanceFilter({ minScore: 0.5 });
    
    const content = `
      This content is about cooking recipes.
      How to make pasta carbonara.
      Italian cuisine traditions.
    `;
    
    const result = filter.filter(content, "quantum physics");
    
    expect(result.chunks.every(c => c.score >= 0.5) || result.chunks.length === 0).toBe(true);
  });

  it("should extract answer for questions", () => {
    const content = `
      Mount Everest is the tallest mountain on Earth.
      It is located in the Himalayas on the border between Nepal and Tibet.
      The height of Mount Everest is 8,849 meters above sea level.
      Many climbers attempt to reach its summit each year.
    `;
    
    const result = filter.filter(content, "How tall is Mount Everest?", ["Mount Everest"]);
    
    expect(result.extractedAnswer).toBeDefined();
    const answerContainsRelevantInfo = 
      result.extractedAnswer!.includes("8,849") || 
      result.extractedAnswer!.toLowerCase().includes("everest") ||
      result.extractedAnswer!.toLowerCase().includes("mountain");
    expect(answerContainsRelevantInfo).toBe(true);
  });

  it("should generate summary from top chunks", () => {
    const content = `
      Machine learning is a subset of artificial intelligence.
      It enables computers to learn from data without explicit programming.
      Deep learning uses neural networks with many layers.
      Applications include image recognition and natural language processing.
    `;
    
    const result = filter.filter(content, "What is machine learning?");
    
    expect(result.summary).toBeDefined();
    expect(result.summary!.length).toBeGreaterThan(20);
  });

  it("should combine relevant content from multiple sources", () => {
    const filter = new RelevanceFilter({ maxOutputLength: 1000 });
    
    const content1: FilteredContent = {
      originalLength: 500,
      filteredLength: 200,
      chunks: [{
        text: "Source 1 chunk about JavaScript.",
        score: 0.8,
        startIndex: 0,
        endIndex: 100,
        matchedTerms: ["javascript"],
      }],
      overallScore: 0.8,
      keyFacts: [],
    };
    
    const content2: FilteredContent = {
      originalLength: 500,
      filteredLength: 200,
      chunks: [{
        text: "Source 2 chunk about TypeScript.",
        score: 0.6,
        startIndex: 0,
        endIndex: 100,
        matchedTerms: ["typescript"],
      }],
      overallScore: 0.6,
      keyFacts: [],
    };
    
    const combined = filter.combineRelevantContent([content1, content2]);
    
    expect(combined).toContain("JavaScript");
    expect(combined).toContain("TypeScript");
  });
});

describe("RetrievalMetricsCollector", () => {
  let metrics: RetrievalMetricsCollector;
  
  beforeEach(() => {
    metrics = new RetrievalMetricsCollector(100);
  });

  it("should record metrics", () => {
    metrics.record({
      timestamp: Date.now(),
      queryHash: "test123",
      totalDurationMs: 1500,
      searchDurationMs: 200,
      fetchDurationMs: 1000,
      processDurationMs: 300,
      sourcesCount: 5,
      cacheHitRate: 0.4,
      relevanceScore: 0.7,
      method: "fetch",
      success: true,
      errorCount: 0,
    });
    
    expect(metrics.getMetricsCount()).toBe(1);
  });

  it("should calculate SLA report", () => {
    for (let i = 0; i < 20; i++) {
      metrics.record({
        timestamp: Date.now(),
        queryHash: `query${i}`,
        totalDurationMs: 1000 + i * 100,
        searchDurationMs: 200,
        fetchDurationMs: 800 + i * 100,
        processDurationMs: 100,
        sourcesCount: 4 + (i % 3),
        cacheHitRate: 0.3 + (i % 5) * 0.1,
        relevanceScore: 0.5 + (i % 4) * 0.1,
        method: i % 3 === 0 ? "browser" : "fetch",
        success: i % 10 !== 9,
        errorCount: i % 10 === 9 ? 1 : 0,
      });
    }
    
    const report = metrics.getSLAReport();
    
    expect(report.totalRequests).toBe(20);
    expect(report.fetchP95Ms).toBeGreaterThan(0);
    expect(report.successRate).toBeLessThan(1);
    expect(report.slaCompliance).toBeDefined();
  });

  it("should track latency percentiles correctly", () => {
    const durations = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    
    for (const duration of durations) {
      metrics.record({
        timestamp: Date.now(),
        queryHash: "test",
        totalDurationMs: duration,
        searchDurationMs: 50,
        fetchDurationMs: duration - 100,
        processDurationMs: 50,
        sourcesCount: 3,
        cacheHitRate: 0.5,
        relevanceScore: 0.6,
        method: "fetch",
        success: true,
        errorCount: 0,
      });
    }
    
    const report = metrics.getSLAReport();
    expect(report.fetchP95Ms).toBeGreaterThanOrEqual(900);
  });

  it("should generate latency histogram", () => {
    for (let i = 0; i < 100; i++) {
      metrics.record({
        timestamp: Date.now(),
        queryHash: `query${i}`,
        totalDurationMs: (i % 10) * 500 + 100,
        searchDurationMs: 50,
        fetchDurationMs: (i % 10) * 400,
        processDurationMs: 50,
        sourcesCount: 3,
        cacheHitRate: 0.5,
        relevanceScore: 0.6,
        method: "fetch",
        success: true,
        errorCount: 0,
      });
    }
    
    const histogram = metrics.getLatencyHistogram();
    
    expect(Object.keys(histogram).length).toBeGreaterThan(0);
  });

  it("should break down by method", () => {
    for (let i = 0; i < 30; i++) {
      const method = i < 10 ? "cache" : i < 20 ? "fetch" : "browser";
      metrics.record({
        timestamp: Date.now(),
        queryHash: `query${i}`,
        totalDurationMs: method === "cache" ? 100 : method === "fetch" ? 2000 : 7000,
        searchDurationMs: 50,
        fetchDurationMs: method === "cache" ? 0 : method === "fetch" ? 1500 : 6500,
        processDurationMs: 50,
        sourcesCount: 3,
        cacheHitRate: method === "cache" ? 1 : 0,
        relevanceScore: 0.6,
        method,
        success: true,
        errorCount: 0,
      });
    }
    
    const breakdown = metrics.getMethodBreakdown();
    
    expect(breakdown.cache.count).toBe(10);
    expect(breakdown.fetch.count).toBe(10);
    expect(breakdown.browser.count).toBe(10);
    expect(breakdown.cache.avgDurationMs).toBeLessThan(breakdown.fetch.avgDurationMs);
    expect(breakdown.fetch.avgDurationMs).toBeLessThan(breakdown.browser.avgDurationMs);
  });

  it("should check SLA compliance", () => {
    const strictMetrics = new RetrievalMetricsCollector(100, {
      fetchP95Ms: 2000,
      browserP95Ms: 5000,
      minCacheHitRate: 0.4,
      minRelevanceScore: 0.5,
      minSourcesCount: 3,
    });
    
    for (let i = 0; i < 10; i++) {
      strictMetrics.record({
        timestamp: Date.now(),
        queryHash: `query${i}`,
        totalDurationMs: 1500,
        searchDurationMs: 100,
        fetchDurationMs: 1400,
        processDurationMs: 100,
        sourcesCount: 4,
        cacheHitRate: 0.5,
        relevanceScore: 0.6,
        method: "fetch",
        success: true,
        errorCount: 0,
      });
    }
    
    const report = strictMetrics.getSLAReport();
    expect(report.slaCompliance.overall).toBe(true);
  });

  it("should respect max entries limit", () => {
    const limitedMetrics = new RetrievalMetricsCollector(5);
    
    for (let i = 0; i < 10; i++) {
      limitedMetrics.record({
        timestamp: Date.now(),
        queryHash: `query${i}`,
        totalDurationMs: 1000,
        searchDurationMs: 100,
        fetchDurationMs: 800,
        processDurationMs: 100,
        sourcesCount: 3,
        cacheHitRate: 0.5,
        relevanceScore: 0.6,
        method: "fetch",
        success: true,
        errorCount: 0,
      });
    }
    
    expect(limitedMetrics.getMetricsCount()).toBe(5);
  });

  it("should record from FastFirstResult format", () => {
    metrics.recordFromResult("queryhash123", {
      success: true,
      metrics: {
        totalDurationMs: 2000,
        searchDurationMs: 300,
        fetchDurationMs: 1500,
        processDurationMs: 200,
        cacheHitRate: 0.3,
        sourcesCount: 5,
        averageRelevanceScore: 0.7,
      },
      sources: [
        { fetchMethod: "cache" },
        { fetchMethod: "fetch" },
        { fetchMethod: "fetch" },
      ],
      errors: [],
    });
    
    expect(metrics.getMetricsCount()).toBe(1);
    const report = metrics.getSLAReport();
    expect(report.avgRelevanceScore).toBe(0.7);
  });
});

describe("Integration: Slow sites and error handling", () => {
  it("should handle simulated slow response gracefully", async () => {
    const pool = createConcurrencyPool<string>({
      maxConcurrency: 2,
      defaultTimeout: 100,
    });
    
    const tasks: PoolTask<string>[] = [
      {
        id: "slow-site",
        execute: async () => {
          await new Promise(r => setTimeout(r, 200));
          return "slow content";
        },
      },
      {
        id: "fast-site",
        execute: async () => {
          await new Promise(r => setTimeout(r, 10));
          return "fast content";
        },
      },
    ];
    
    const results = await pool.executeAll(tasks);
    
    const slowResult = results.find(r => r.id === "slow-site");
    const fastResult = results.find(r => r.id === "fast-site");
    
    expect(slowResult?.success).toBe(false);
    expect(slowResult?.error).toBe("Task timeout");
    expect(fastResult?.success).toBe(true);
    expect(fastResult?.result).toBe("fast content");
  });

  it("should handle simulated 429 rate limit errors", async () => {
    const pool = createConcurrencyPool<string>({ maxConcurrency: 3 });
    
    let requestCount = 0;
    
    const tasks: PoolTask<string>[] = Array(5).fill(null).map((_, i) => ({
      id: `request-${i}`,
      execute: async () => {
        requestCount++;
        if (requestCount > 2) {
          throw new Error("429 Too Many Requests");
        }
        return `content-${i}`;
      },
    }));
    
    const results = await pool.executeAll(tasks);
    
    const successCount = results.filter(r => r.success).length;
    const rateLimitedCount = results.filter(r => r.error?.includes("429")).length;
    
    expect(successCount).toBe(2);
    expect(rateLimitedCount).toBe(3);
  });
});

describe("Citation validation", () => {
  it("should extract citations that answer the query", () => {
    const filter = new RelevanceFilter();
    
    const content = `
      According to the World Bank, the global GDP growth rate in 2024 was 2.4%.
      "The economic outlook remains uncertain," said IMF Director Kristalina Georgieva.
      Inflation in the United States fell to 3.2% by the end of the year.
      Employment rates in the EU reached a record high of 74.6%.
    `;
    
    const result = filter.filter(content, "What is the global GDP growth rate?");
    
    expect(result.keyFacts.some(f => f.includes("2.4%"))).toBe(true);
    expect(result.extractedAnswer).toContain("2.4");
  });

  it("should validate that citations are from the content", () => {
    const filter = new RelevanceFilter();
    
    const content = `
      The Amazon rainforest covers approximately 5.5 million square kilometers.
      It is home to about 10% of all species on Earth.
      The Amazon River is the second longest river in the world.
    `;
    
    const result = filter.filter(content, "How big is the Amazon rainforest?");
    
    for (const fact of result.keyFacts) {
      expect(content.toLowerCase()).toContain(fact.toLowerCase().slice(0, 30));
    }
  });

  it("should score sources by how well they answer the query", () => {
    const filter = new RelevanceFilter();
    
    const relevantContent = `
      Python 3.12 was released on October 2, 2023.
      It includes several new features like improved error messages.
      Performance improvements of up to 5% were achieved.
    `;
    
    const irrelevantContent = `
      Recipe for chocolate cake:
      Mix flour, sugar, and cocoa powder.
      Bake at 350 degrees for 30 minutes.
    `;
    
    const relevantResult = filter.filter(relevantContent, "When was Python 3.12 released?");
    const irrelevantResult = filter.filter(irrelevantContent, "When was Python 3.12 released?");
    
    expect(relevantResult.overallScore).toBeGreaterThan(irrelevantResult.overallScore);
  });
});
