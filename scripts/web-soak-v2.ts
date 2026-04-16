#!/usr/bin/env npx tsx

import * as fs from "fs";
import * as path from "path";
import {
  V2MetricsCollector,
  ResourceSampler,
  LeakDetector,
  BudgetEnforcer,
  DomainCircuitBreaker,
  categorizeError,
  PhaseType,
  type PhaseSample,
  type ResourceSample,
  type LeakEvent,
  type DomainStatus,
} from "../server/agent/webtool/v2/index";
import { RetrievalPlanner } from "../server/agent/webtool/retrievalPlanner";
import { ResponseCache } from "../server/agent/webtool/responseCache";
import { RelevanceFilter } from "../server/agent/webtool/relevanceFilter";

interface SoakConfig {
  durationSeconds: number;
  concurrency: number;
  realistic: boolean;
  outputDir: string;
}

interface SLOThresholds {
  fetchP95Ms: number;
  browserP95Ms: number;
  successRatePercent: number;
}

interface ScenarioResult {
  success: boolean;
  latencyMs: number;
  category: string;
  domain: string;
  pageSize: "small" | "medium" | "large";
  usedBrowser: boolean;
  error?: string;
  errorType?: string;
  phases: PhaseMetrics;
  budgetUsage?: {
    pages: number;
    bytes: number;
    timeMs: number;
  };
}

interface PhaseMetrics {
  planMs: number;
  searchMs: number;
  fetchMs: number;
  browserMs: number;
  extractMs: number;
  filterMs: number;
  totalMs: number;
}

interface TimeSeriesEntry {
  timestamp: number;
  elapsedSeconds: number;
  totalRequests: number;
  successRate: number;
  fetchP95Ms: number;
  browserP95Ms: number;
  heapUsedMb: number;
  rssMb: number;
  fdCount: number;
  openCircuits: number;
  activeRequests: number;
  leakDetected: boolean;
}

interface SoakResults {
  config: SoakConfig;
  sloThresholds: SLOThresholds;
  startTime: number;
  endTime: number;
  durationMs: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  requestsPerSecond: number;
  phasePercentiles: {
    fetch: { p50: number; p95: number; p99: number; avg: number };
    browser: { p50: number; p95: number; p99: number; avg: number };
  };
  errorTaxonomy: Record<string, number>;
  categoryBreakdown: Record<string, { total: number; success: number; avgLatency: number }>;
  domainBreakdown: Record<string, { total: number; success: number; circuitState: string }>;
  memoryStats: {
    peakHeapMb: number;
    peakRssMb: number;
    heapGrowthMb: number;
    leakDetected: boolean;
    finalFdCount: number;
  };
  sloResults: {
    fetchP95Passed: boolean;
    browserP95Passed: boolean;
    successRatePassed: boolean;
    allPassed: boolean;
  };
  timeSeries: TimeSeriesEntry[];
  warnings: string[];
}

const FINANCIAL_PROMPTS = [
  "What is the current stock price of Apple AAPL today?",
  "Compare Q4 2024 earnings of Microsoft and Google",
  "Latest Federal Reserve interest rate decision",
  "S&P 500 performance in the last month",
  "Bitcoin price prediction for 2025",
  "Best dividend stocks for retirement portfolio",
  "How to analyze a company balance sheet",
  "What are ESG investing criteria?",
  "Current inflation rate in the United States",
  "Gold price forecast for next quarter",
];

const TECHNICAL_PROMPTS = [
  "How to implement a binary search tree in Python?",
  "Best practices for React hooks performance optimization",
  "Kubernetes vs Docker Swarm comparison 2024",
  "How to configure Nginx as reverse proxy with SSL",
  "TypeScript generics advanced patterns tutorial",
  "PostgreSQL query optimization techniques",
  "GraphQL vs REST API design trade-offs",
  "Microservices architecture patterns with Node.js",
  "Redis caching strategies for high traffic applications",
  "CI/CD pipeline best practices with GitHub Actions",
];

const NEWS_PROMPTS = [
  "Latest news on artificial intelligence regulations",
  "Climate change summit 2024 key outcomes",
  "Technology industry layoffs recent updates",
  "Space exploration missions planned for 2025",
  "Electric vehicle market trends today",
  "Cybersecurity threats and data breaches this week",
  "Global supply chain disruptions news",
  "Renewable energy policy developments",
  "Healthcare technology innovations 2024",
  "International trade agreements updates",
];

const ACADEMIC_PROMPTS = [
  "Recent advances in quantum computing research",
  "Machine learning applications in healthcare diagnosis",
  "Climate modeling techniques and predictions",
  "CRISPR gene editing latest developments",
  "Neuroscience discoveries about memory formation",
  "Renewable energy efficiency improvements 2024",
  "Artificial general intelligence research progress",
  "Blockchain applications beyond cryptocurrency",
  "Space telescope discoveries and observations",
  "Materials science breakthroughs for batteries",
];

const SCENARIO_CATALOG = {
  financial: { prompts: FINANCIAL_PROMPTS, domains: ["bloomberg.com", "reuters.com", "wsj.com", "finance.yahoo.com", "marketwatch.com"] },
  technical: { prompts: TECHNICAL_PROMPTS, domains: ["stackoverflow.com", "github.com", "dev.to", "medium.com", "hackernews.com"] },
  news: { prompts: NEWS_PROMPTS, domains: ["bbc.com", "cnn.com", "nytimes.com", "theguardian.com", "reuters.com"] },
  academic: { prompts: ACADEMIC_PROMPTS, domains: ["arxiv.org", "nature.com", "science.org", "scholar.google.com", "pubmed.gov"] },
};

const PAGE_SIZES = {
  small: { minBytes: 5000, maxBytes: 20000 },
  medium: { minBytes: 50000, maxBytes: 200000 },
  large: { minBytes: 500000, maxBytes: 2000000 },
};

const REALISTIC_LATENCIES = {
  search: { min: 200, max: 800 },
  fetch: { min: 100, max: 2000 },
  browser: { min: 1500, max: 6000 },
  extract: { min: 50, max: 300 },
};

const DEFAULT_CONFIG: SoakConfig = {
  durationSeconds: 3600,
  concurrency: 50,
  realistic: false,
  outputDir: "test_results",
};

const DEFAULT_SLO: SLOThresholds = {
  fetchP95Ms: 3000,
  browserP95Ms: 8000,
  successRatePercent: 97,
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function simulateNetworkLatency(phase: keyof typeof REALISTIC_LATENCIES): number {
  const { min, max } = REALISTIC_LATENCIES[phase];
  return min + Math.random() * (max - min);
}

function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomPageSize(): "small" | "medium" | "large" {
  const rand = Math.random();
  if (rand < 0.5) return "medium";
  if (rand < 0.8) return "small";
  return "large";
}

function getRandomCategory(): keyof typeof SCENARIO_CATALOG {
  const categories = Object.keys(SCENARIO_CATALOG) as (keyof typeof SCENARIO_CATALOG)[];
  return getRandomItem(categories);
}

function generatePageContent(size: "small" | "medium" | "large", prompt: string): string {
  const { minBytes, maxBytes } = PAGE_SIZES[size];
  const targetBytes = minBytes + Math.random() * (maxBytes - minBytes);
  const baseContent = `Content for: ${prompt}. `;
  const repetitions = Math.ceil(targetBytes / baseContent.length);
  return baseContent.repeat(repetitions).slice(0, targetBytes);
}

class SoakRunner {
  private config: SoakConfig;
  private sloThresholds: SLOThresholds;
  private metricsCollector: V2MetricsCollector;
  private resourceSampler: ResourceSampler;
  private leakDetector: LeakDetector;
  private budgetEnforcer: BudgetEnforcer;
  private circuitBreaker: DomainCircuitBreaker;
  private results: ScenarioResult[] = [];
  private timeSeries: TimeSeriesEntry[] = [];
  private warnings: string[] = [];
  private activeRequests = 0;
  private startTime = 0;
  private stopped = false;
  private fetchLatencies: number[] = [];
  private browserLatencies: number[] = [];
  private categoryStats: Map<string, { total: number; success: number; latencies: number[] }> = new Map();
  private domainStats: Map<string, { total: number; success: number }> = new Map();
  private errorCounts: Map<string, number> = new Map();

  constructor(config: Partial<SoakConfig> = {}, sloThresholds: Partial<SLOThresholds> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sloThresholds = { ...DEFAULT_SLO, ...sloThresholds };
    
    this.metricsCollector = new V2MetricsCollector({
      maxSamples: 100000,
      defaultWindowMs: this.config.durationSeconds * 1000,
    });
    
    this.resourceSampler = new ResourceSampler({
      maxSamples: Math.ceil(this.config.durationSeconds),
      intervalMs: 1000,
      heapGrowthThresholdMbPerMinute: 50,
      heapWarningThresholdPercent: 85,
      fdWarningThreshold: 900,
    });
    
    this.leakDetector = new LeakDetector({
      thresholds: {
        heapGrowthRateMbPerMin: 10,
        maxFdCount: 1024,
        maxBrowserContexts: 5,
        maxBrowserPages: 20,
      },
      sampleWindowMs: 60000,
      minSamplesForDetection: 5,
    });
    
    this.budgetEnforcer = new BudgetEnforcer({
      defaultLimits: {
        maxPages: 100,
        maxBytes: 50 * 1024 * 1024,
        maxTimeMs: 300000,
      },
    });
    
    this.circuitBreaker = new DomainCircuitBreaker({
      failureThreshold: 5,
      resetTimeoutMs: 30000,
      halfOpenSuccessThreshold: 2,
      trackingWindowMs: 60000,
    });
  }

  private setupEventHandlers(): void {
    this.resourceSampler.on("warning", (warning: { type: string; message: string }) => {
      const msg = `[Resource Warning] ${warning.message}`;
      console.warn(msg);
      this.warnings.push(msg);
    });

    this.leakDetector.on("leak_detected", (event: LeakEvent) => {
      const msg = `[Leak Detected] ${event.message}`;
      console.error(msg);
      this.warnings.push(msg);
    });

    this.leakDetector.on("warning", (event: LeakEvent) => {
      const msg = `[Leak Warning] ${event.message}`;
      console.warn(msg);
      this.warnings.push(msg);
    });
  }

  private checkSLOWarnings(): void {
    const successRate = this.results.length > 0
      ? (this.results.filter(r => r.success).length / this.results.length) * 100
      : 100;

    const fetchP95 = percentile(this.fetchLatencies, 95);
    const browserP95 = percentile(this.browserLatencies, 95);

    const successThreshold = this.sloThresholds.successRatePercent * 0.95;
    const fetchThreshold = this.sloThresholds.fetchP95Ms * 0.9;
    const browserThreshold = this.sloThresholds.browserP95Ms * 0.9;

    if (successRate < successThreshold && successRate >= this.sloThresholds.successRatePercent * 0.9) {
      const msg = `[SLO Warning] Success rate approaching threshold: ${successRate.toFixed(2)}% (threshold: ${this.sloThresholds.successRatePercent}%)`;
      console.warn(msg);
      if (!this.warnings.includes(msg)) this.warnings.push(msg);
    }

    if (fetchP95 > fetchThreshold && fetchP95 <= this.sloThresholds.fetchP95Ms) {
      const msg = `[SLO Warning] Fetch P95 approaching threshold: ${fetchP95.toFixed(0)}ms (threshold: ${this.sloThresholds.fetchP95Ms}ms)`;
      console.warn(msg);
      if (!this.warnings.includes(msg)) this.warnings.push(msg);
    }

    if (browserP95 > browserThreshold && browserP95 <= this.sloThresholds.browserP95Ms) {
      const msg = `[SLO Warning] Browser P95 approaching threshold: ${browserP95.toFixed(0)}ms (threshold: ${this.sloThresholds.browserP95Ms}ms)`;
      console.warn(msg);
      if (!this.warnings.includes(msg)) this.warnings.push(msg);
    }
  }

  private recordTimeSeries(): void {
    const now = Date.now();
    const resourceReport = this.resourceSampler.getReport(60000);
    const leakMetrics = this.leakDetector.getCurrentMetrics();
    const circuitStats = this.circuitBreaker.getStats();

    const entry: TimeSeriesEntry = {
      timestamp: now,
      elapsedSeconds: (now - this.startTime) / 1000,
      totalRequests: this.results.length,
      successRate: this.results.length > 0
        ? (this.results.filter(r => r.success).length / this.results.length) * 100
        : 100,
      fetchP95Ms: percentile(this.fetchLatencies, 95),
      browserP95Ms: percentile(this.browserLatencies, 95),
      heapUsedMb: resourceReport.current.heapUsedMb,
      rssMb: resourceReport.current.rssMb,
      fdCount: resourceReport.current.fdCount,
      openCircuits: circuitStats.openCircuits,
      activeRequests: this.activeRequests,
      leakDetected: leakMetrics.isLeaking,
    };

    this.timeSeries.push(entry);
  }

  private async simulateRetrieval(
    prompt: string,
    category: string,
    domain: string,
    pageSize: "small" | "medium" | "large"
  ): Promise<ScenarioResult> {
    const startTime = performance.now();
    const runId = `soak-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const phases: PhaseMetrics = {
      planMs: 0,
      searchMs: 0,
      fetchMs: 0,
      browserMs: 0,
      extractMs: 0,
      filterMs: 0,
      totalMs: 0,
    };

    let usedBrowser = false;

    try {
      this.budgetEnforcer.createBudget(runId, {
        maxPages: 10,
        maxBytes: 5 * 1024 * 1024,
        maxTimeMs: 30000,
      });

      if (!this.circuitBreaker.canExecute(domain)) {
        throw new Error(`Circuit open for domain: ${domain}`);
      }

      const planStart = performance.now();
      const planner = new RetrievalPlanner();
      const plan = planner.plan(prompt, 3);
      phases.planMs = performance.now() - planStart;

      await this.metricsCollector.recordPhase({
        phase: "search",
        durationMs: phases.planMs,
        success: true,
        usedBrowser: false,
        cacheHit: false,
      });

      const searchStart = performance.now();
      if (this.config.realistic) {
        await new Promise(resolve => setTimeout(resolve, simulateNetworkLatency("search")));
      } else {
        await new Promise(resolve => setTimeout(resolve, 5 + Math.random() * 15));
      }
      phases.searchMs = performance.now() - searchStart;

      const fetchStart = performance.now();
      usedBrowser = Math.random() < 0.3;
      
      if (this.config.realistic) {
        if (usedBrowser) {
          await new Promise(resolve => setTimeout(resolve, simulateNetworkLatency("browser")));
          phases.browserMs = performance.now() - fetchStart;
        } else {
          await new Promise(resolve => setTimeout(resolve, simulateNetworkLatency("fetch")));
          phases.fetchMs = performance.now() - fetchStart;
        }
      } else {
        if (usedBrowser) {
          await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 150));
          phases.browserMs = performance.now() - fetchStart;
        } else {
          await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 40));
          phases.fetchMs = performance.now() - fetchStart;
        }
      }

      await this.metricsCollector.recordPhase({
        phase: usedBrowser ? "browser" : "fetch",
        durationMs: usedBrowser ? phases.browserMs : phases.fetchMs,
        success: true,
        usedBrowser,
        cacheHit: false,
      });

      const content = generatePageContent(pageSize, prompt);
      const contentBytes = Buffer.byteLength(content, "utf8");

      this.budgetEnforcer.consume(runId, {
        pages: 1,
        bytes: contentBytes,
      });

      const extractStart = performance.now();
      const cache = new ResponseCache({ maxEntries: 100, defaultTtlMs: 60000 });
      cache.set(`https://${domain}/${Date.now()}`, content, {
        fetchMethod: usedBrowser ? "browser" : "fetch",
        queryHash: plan.queryHash,
      });
      if (this.config.realistic) {
        await new Promise(resolve => setTimeout(resolve, simulateNetworkLatency("extract")));
      }
      phases.extractMs = performance.now() - extractStart;

      await this.metricsCollector.recordPhase({
        phase: "extract",
        durationMs: phases.extractMs,
        success: true,
        usedBrowser: false,
        cacheHit: false,
      });

      const filterStart = performance.now();
      const filter = new RelevanceFilter({ minScore: 0 });
      const filtered = filter.filter(content, prompt, plan.entities);
      phases.filterMs = performance.now() - filterStart;

      await this.metricsCollector.recordPhase({
        phase: "filter",
        durationMs: phases.filterMs,
        success: true,
        usedBrowser: false,
        cacheHit: false,
      });

      const shouldFail = Math.random() < (this.config.realistic ? 0.025 : 0.015);
      if (shouldFail) {
        const errorTypes = ["timeout", "rate_limit", "network", "memory"];
        const errorType = errorTypes[Math.floor(Math.random() * errorTypes.length)];
        throw new Error(`Simulated ${errorType} error`);
      }

      if (!plan || plan.queries.length === 0) {
        throw new Error("Planning failed - no queries generated");
      }

      if (!filtered) {
        throw new Error("Filtering failed - no content");
      }

      phases.totalMs = performance.now() - startTime;

      this.circuitBreaker.recordSuccess(domain);
      this.budgetEnforcer.release(runId);

      const budgetUsage = this.budgetEnforcer.getBudget(runId);

      return {
        success: true,
        latencyMs: phases.totalMs,
        category,
        domain,
        pageSize,
        usedBrowser,
        phases,
        budgetUsage: budgetUsage ? {
          pages: budgetUsage.consumed.pages,
          bytes: budgetUsage.consumed.bytes,
          timeMs: budgetUsage.consumed.timeMs,
        } : undefined,
      };
    } catch (error) {
      phases.totalMs = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorType = categorizeError(error);

      this.circuitBreaker.recordFailure(domain, errorType as any);
      this.budgetEnforcer.release(runId);

      await this.metricsCollector.recordPhase({
        phase: usedBrowser ? "browser" : "fetch",
        durationMs: phases.totalMs,
        success: false,
        errorCategory: errorType,
        usedBrowser,
        cacheHit: false,
      });

      return {
        success: false,
        latencyMs: phases.totalMs,
        category,
        domain,
        pageSize,
        usedBrowser,
        error: errorMessage,
        errorType,
        phases,
      };
    }
  }

  private processResult(result: ScenarioResult): void {
    this.results.push(result);

    if (result.usedBrowser && result.phases.browserMs > 0) {
      this.browserLatencies.push(result.phases.browserMs);
    } else if (result.phases.fetchMs > 0) {
      this.fetchLatencies.push(result.phases.fetchMs);
    }

    const categoryEntry = this.categoryStats.get(result.category) || { total: 0, success: 0, latencies: [] };
    categoryEntry.total++;
    if (result.success) categoryEntry.success++;
    categoryEntry.latencies.push(result.latencyMs);
    this.categoryStats.set(result.category, categoryEntry);

    const domainEntry = this.domainStats.get(result.domain) || { total: 0, success: 0 };
    domainEntry.total++;
    if (result.success) domainEntry.success++;
    this.domainStats.set(result.domain, domainEntry);

    if (!result.success && result.errorType) {
      this.errorCounts.set(result.errorType, (this.errorCounts.get(result.errorType) || 0) + 1);
    }
  }

  async run(): Promise<SoakResults> {
    console.log("=".repeat(80));
    console.log("WEB RETRIEVAL V2 SOAK TEST");
    console.log("=".repeat(80));
    console.log();
    console.log("Configuration:");
    console.log(`  Duration:     ${this.config.durationSeconds}s (${(this.config.durationSeconds / 60).toFixed(1)} min)`);
    console.log(`  Concurrency:  ${this.config.concurrency}`);
    console.log(`  Mode:         ${this.config.realistic ? "REALISTIC" : "FAST"}`);
    console.log(`  Output Dir:   ${this.config.outputDir}`);
    console.log();
    console.log("SLO Thresholds:");
    console.log(`  Fetch P95:    ≤ ${this.sloThresholds.fetchP95Ms}ms`);
    console.log(`  Browser P95:  ≤ ${this.sloThresholds.browserP95Ms}ms`);
    console.log(`  Success Rate: ≥ ${this.sloThresholds.successRatePercent}%`);
    console.log();

    this.setupEventHandlers();
    this.metricsCollector.startResourceSampling();
    this.resourceSampler.start();
    this.leakDetector.start(1000);
    this.budgetEnforcer.startCleanup();

    this.startTime = Date.now();
    const endTime = this.startTime + this.config.durationSeconds * 1000;

    const timeSeriesInterval = setInterval(() => {
      this.recordTimeSeries();
    }, 5000);

    const sloCheckInterval = setInterval(() => {
      this.checkSLOWarnings();
    }, 10000);

    const progressInterval = setInterval(() => {
      const elapsed = (Date.now() - this.startTime) / 1000;
      const successRate = this.results.length > 0
        ? ((this.results.filter(r => r.success).length / this.results.length) * 100).toFixed(2)
        : "100.00";
      const resourceReport = this.resourceSampler.getReport(60000);
      const circuitStats = this.circuitBreaker.getStats();

      console.log(
        `[${elapsed.toFixed(0)}s] ` +
        `Requests: ${this.results.length} | ` +
        `Success: ${successRate}% | ` +
        `Active: ${this.activeRequests} | ` +
        `Heap: ${resourceReport.current.heapUsedMb.toFixed(1)}MB | ` +
        `FD: ${resourceReport.current.fdCount} | ` +
        `Open Circuits: ${circuitStats.openCircuits}`
      );
    }, 10000);

    const runRequest = async (): Promise<void> => {
      if (this.stopped || Date.now() >= endTime) return;

      this.activeRequests++;
      try {
        const category = getRandomCategory();
        const scenario = SCENARIO_CATALOG[category];
        const prompt = getRandomItem(scenario.prompts);
        const domain = getRandomItem(scenario.domains);
        const pageSize = getRandomPageSize();

        const result = await this.simulateRetrieval(prompt, category, domain, pageSize);
        this.processResult(result);
      } finally {
        this.activeRequests--;
      }
    };

    const requestQueue: Promise<void>[] = [];

    while (Date.now() < endTime && !this.stopped) {
      while (this.activeRequests < this.config.concurrency && Date.now() < endTime && !this.stopped) {
        const promise = runRequest().finally(() => {
          const index = requestQueue.indexOf(promise);
          if (index > -1) requestQueue.splice(index, 1);
        });
        requestQueue.push(promise);
      }

      if (requestQueue.length > 0) {
        await Promise.race(requestQueue);
      } else {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    await Promise.all(requestQueue);

    clearInterval(timeSeriesInterval);
    clearInterval(sloCheckInterval);
    clearInterval(progressInterval);

    this.metricsCollector.stopResourceSampling();
    this.resourceSampler.stop();
    this.leakDetector.stop();
    this.budgetEnforcer.stopCleanup();

    this.recordTimeSeries();

    return this.generateResults();
  }

  private generateResults(): SoakResults {
    const endTime = Date.now();
    const durationMs = endTime - this.startTime;
    const successfulRequests = this.results.filter(r => r.success).length;
    const successRate = this.results.length > 0
      ? (successfulRequests / this.results.length) * 100
      : 0;

    const fetchP50 = percentile(this.fetchLatencies, 50);
    const fetchP95 = percentile(this.fetchLatencies, 95);
    const fetchP99 = percentile(this.fetchLatencies, 99);
    const fetchAvg = this.fetchLatencies.length > 0
      ? this.fetchLatencies.reduce((a, b) => a + b, 0) / this.fetchLatencies.length
      : 0;

    const browserP50 = percentile(this.browserLatencies, 50);
    const browserP95 = percentile(this.browserLatencies, 95);
    const browserP99 = percentile(this.browserLatencies, 99);
    const browserAvg = this.browserLatencies.length > 0
      ? this.browserLatencies.reduce((a, b) => a + b, 0) / this.browserLatencies.length
      : 0;

    const resourceSamples = this.resourceSampler.getSamples();
    const peakHeapMb = resourceSamples.length > 0
      ? Math.max(...resourceSamples.map(s => s.heapUsedMb))
      : 0;
    const peakRssMb = resourceSamples.length > 0
      ? Math.max(...resourceSamples.map(s => s.rssMb))
      : 0;
    const heapGrowthMb = resourceSamples.length >= 2
      ? resourceSamples[resourceSamples.length - 1].heapUsedMb - resourceSamples[0].heapUsedMb
      : 0;
    const finalFdCount = resourceSamples.length > 0
      ? resourceSamples[resourceSamples.length - 1].fdCount
      : 0;

    const leakMetrics = this.leakDetector.getCurrentMetrics();

    const categoryBreakdown: Record<string, { total: number; success: number; avgLatency: number }> = {};
    for (const [category, stats] of this.categoryStats) {
      categoryBreakdown[category] = {
        total: stats.total,
        success: stats.success,
        avgLatency: stats.latencies.length > 0
          ? stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length
          : 0,
      };
    }

    const domainBreakdown: Record<string, { total: number; success: number; circuitState: string }> = {};
    for (const [domain, stats] of this.domainStats) {
      const status = this.circuitBreaker.getStatus(domain);
      domainBreakdown[domain] = {
        total: stats.total,
        success: stats.success,
        circuitState: status.state,
      };
    }

    const errorTaxonomy: Record<string, number> = {};
    for (const [type, count] of this.errorCounts) {
      errorTaxonomy[type] = count;
    }

    const fetchP95Passed = fetchP95 <= this.sloThresholds.fetchP95Ms;
    const browserP95Passed = browserP95 <= this.sloThresholds.browserP95Ms;
    const successRatePassed = successRate >= this.sloThresholds.successRatePercent;

    return {
      config: this.config,
      sloThresholds: this.sloThresholds,
      startTime: this.startTime,
      endTime,
      durationMs,
      totalRequests: this.results.length,
      successfulRequests,
      failedRequests: this.results.length - successfulRequests,
      successRate,
      requestsPerSecond: this.results.length / (durationMs / 1000),
      phasePercentiles: {
        fetch: { p50: fetchP50, p95: fetchP95, p99: fetchP99, avg: fetchAvg },
        browser: { p50: browserP50, p95: browserP95, p99: browserP99, avg: browserAvg },
      },
      errorTaxonomy,
      categoryBreakdown,
      domainBreakdown,
      memoryStats: {
        peakHeapMb,
        peakRssMb,
        heapGrowthMb,
        leakDetected: leakMetrics.isLeaking,
        finalFdCount,
      },
      sloResults: {
        fetchP95Passed,
        browserP95Passed,
        successRatePassed,
        allPassed: fetchP95Passed && browserP95Passed && successRatePassed,
      },
      timeSeries: this.timeSeries,
      warnings: this.warnings,
    };
  }

  stop(): void {
    this.stopped = true;
  }
}

function printResults(results: SoakResults): void {
  console.log();
  console.log("=".repeat(80));
  console.log("SOAK TEST RESULTS");
  console.log("=".repeat(80));
  console.log();

  console.log("Request Statistics:");
  console.log(`  Total Requests:     ${results.totalRequests}`);
  console.log(`  Successful:         ${results.successfulRequests}`);
  console.log(`  Failed:             ${results.failedRequests}`);
  console.log(`  Success Rate:       ${results.successRate.toFixed(2)}%`);
  console.log(`  Requests/Second:    ${results.requestsPerSecond.toFixed(2)}`);
  console.log(`  Duration:           ${(results.durationMs / 1000).toFixed(2)}s`);
  console.log();

  console.log("Latency Statistics (P50/P95/P99/Avg):");
  console.log(`  Fetch:   ${results.phasePercentiles.fetch.p50.toFixed(0)}ms / ${results.phasePercentiles.fetch.p95.toFixed(0)}ms / ${results.phasePercentiles.fetch.p99.toFixed(0)}ms / ${results.phasePercentiles.fetch.avg.toFixed(0)}ms`);
  console.log(`  Browser: ${results.phasePercentiles.browser.p50.toFixed(0)}ms / ${results.phasePercentiles.browser.p95.toFixed(0)}ms / ${results.phasePercentiles.browser.p99.toFixed(0)}ms / ${results.phasePercentiles.browser.avg.toFixed(0)}ms`);
  console.log();

  console.log("Memory Statistics:");
  console.log(`  Peak Heap:       ${results.memoryStats.peakHeapMb.toFixed(2)}MB`);
  console.log(`  Peak RSS:        ${results.memoryStats.peakRssMb.toFixed(2)}MB`);
  console.log(`  Heap Growth:     ${results.memoryStats.heapGrowthMb.toFixed(2)}MB`);
  console.log(`  Final FD Count:  ${results.memoryStats.finalFdCount}`);
  console.log(`  Leak Detected:   ${results.memoryStats.leakDetected ? "YES ⚠️" : "No"}`);
  console.log();

  if (Object.keys(results.errorTaxonomy).length > 0) {
    console.log("Error Taxonomy:");
    const sortedErrors = Object.entries(results.errorTaxonomy).sort((a, b) => b[1] - a[1]);
    for (const [type, count] of sortedErrors) {
      const percentage = ((count / results.totalRequests) * 100).toFixed(2);
      console.log(`  ${type.padEnd(20)} ${count} (${percentage}%)`);
    }
    console.log();
  }

  console.log("Category Breakdown:");
  for (const [category, stats] of Object.entries(results.categoryBreakdown)) {
    const rate = stats.total > 0 ? ((stats.success / stats.total) * 100).toFixed(1) : "0.0";
    console.log(`  ${category.padEnd(12)} Total: ${stats.total}, Success: ${rate}%, Avg Latency: ${stats.avgLatency.toFixed(0)}ms`);
  }
  console.log();

  console.log("Domain Breakdown (Top 10):");
  const sortedDomains = Object.entries(results.domainBreakdown)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10);
  for (const [domain, stats] of sortedDomains) {
    const rate = stats.total > 0 ? ((stats.success / stats.total) * 100).toFixed(1) : "0.0";
    console.log(`  ${domain.padEnd(25)} Total: ${stats.total}, Success: ${rate}%, Circuit: ${stats.circuitState}`);
  }
  console.log();

  if (results.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of results.warnings.slice(0, 10)) {
      console.log(`  ⚠️  ${warning}`);
    }
    if (results.warnings.length > 10) {
      console.log(`  ... and ${results.warnings.length - 10} more`);
    }
    console.log();
  }

  console.log("=".repeat(80));
  console.log("SLO RESULTS");
  console.log("=".repeat(80));
  console.log();
  
  const fetchIcon = results.sloResults.fetchP95Passed ? "✓" : "✗";
  const browserIcon = results.sloResults.browserP95Passed ? "✓" : "✗";
  const successIcon = results.sloResults.successRatePassed ? "✓" : "✗";
  
  console.log(`  ${fetchIcon} Fetch P95:    ${results.phasePercentiles.fetch.p95.toFixed(0)}ms (threshold: ≤${results.sloThresholds.fetchP95Ms}ms)`);
  console.log(`  ${browserIcon} Browser P95:  ${results.phasePercentiles.browser.p95.toFixed(0)}ms (threshold: ≤${results.sloThresholds.browserP95Ms}ms)`);
  console.log(`  ${successIcon} Success Rate: ${results.successRate.toFixed(2)}% (threshold: ≥${results.sloThresholds.successRatePercent}%)`);
  console.log();
  
  const overallIcon = results.sloResults.allPassed ? "✓ PASS" : "✗ FAIL";
  console.log(`  OVERALL: ${overallIcon}`);
  console.log("=".repeat(80));
}

function saveResults(results: SoakResults, outputDir: string): { jsonPath: string; csvPath: string } {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = `web_v2_soak_${timestamp}`;

  const jsonPath = path.join(outputDir, `${baseName}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to: ${jsonPath}`);

  const csvPath = path.join(outputDir, `${baseName}.csv`);
  const csvHeader = [
    "timestamp",
    "elapsedSeconds",
    "totalRequests",
    "successRate",
    "fetchP95Ms",
    "browserP95Ms",
    "heapUsedMb",
    "rssMb",
    "fdCount",
    "openCircuits",
    "activeRequests",
    "leakDetected",
  ].join(",");

  const csvRows = results.timeSeries.map(entry => [
    entry.timestamp,
    entry.elapsedSeconds.toFixed(2),
    entry.totalRequests,
    entry.successRate.toFixed(2),
    entry.fetchP95Ms.toFixed(0),
    entry.browserP95Ms.toFixed(0),
    entry.heapUsedMb.toFixed(2),
    entry.rssMb.toFixed(2),
    entry.fdCount,
    entry.openCircuits,
    entry.activeRequests,
    entry.leakDetected ? 1 : 0,
  ].join(","));

  fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join("\n"));
  console.log(`Time series saved to: ${csvPath}`);

  return { jsonPath, csvPath };
}

function printHelp(): void {
  console.log(`
Web Retrieval V2 Soak Test

Usage: npx tsx scripts/web-soak-v2.ts [options]

Options:
  --duration <seconds>     Duration of the test in seconds (default: 3600 = 60 min)
  --concurrency <n>        Number of concurrent requests (default: 50)
  --realistic              Use realistic network latencies
  --output-dir <path>      Directory for output files (default: test_results)
  --help                   Show this help message

SLO Thresholds (built-in):
  Fetch P95:    ≤ 3000ms
  Browser P95:  ≤ 8000ms
  Success Rate: ≥ 97%

Examples:
  npx tsx scripts/web-soak-v2.ts                              # Default 60-min test
  npx tsx scripts/web-soak-v2.ts --duration 60                # Quick 1-min test
  npx tsx scripts/web-soak-v2.ts --duration 3600 --realistic  # 60-min realistic test
  npx tsx scripts/web-soak-v2.ts --concurrency 100            # Higher load test

Exit Codes:
  0 - All SLOs passed
  1 - One or more SLOs breached
`);
}

function parseArgs(): Partial<SoakConfig> & { help?: boolean } {
  const args: Partial<SoakConfig> & { help?: boolean } = {};

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    if (arg === "--duration" && process.argv[i + 1]) {
      args.durationSeconds = parseInt(process.argv[++i], 10);
    } else if (arg === "--concurrency" && process.argv[i + 1]) {
      args.concurrency = parseInt(process.argv[++i], 10);
    } else if (arg === "--realistic") {
      args.realistic = true;
    } else if (arg === "--output-dir" && process.argv[i + 1]) {
      args.outputDir = process.argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const config: SoakConfig = {
    ...DEFAULT_CONFIG,
    ...args,
  };

  const runner = new SoakRunner(config);

  process.on("SIGINT", () => {
    console.log("\nReceived SIGINT, stopping gracefully...");
    runner.stop();
  });

  process.on("SIGTERM", () => {
    console.log("\nReceived SIGTERM, stopping gracefully...");
    runner.stop();
  });

  try {
    const results = await runner.run();
    printResults(results);
    saveResults(results, config.outputDir);

    process.exit(results.sloResults.allPassed ? 0 : 1);
  } catch (error) {
    console.error("Soak test failed with error:", error);
    process.exit(1);
  }
}

main();
