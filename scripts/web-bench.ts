#!/usr/bin/env npx tsx

import { RetrievalPlanner, retrievalPlanner } from "../server/agent/webtool/retrievalPlanner";
import { ConcurrencyPool, createConcurrencyPool, type PoolTask } from "../server/agent/webtool/concurrencyPool";
import { ResponseCache } from "../server/agent/webtool/responseCache";
import { RelevanceFilter, relevanceFilter } from "../server/agent/webtool/relevanceFilter";
import { RetrievalMetricsCollector } from "../server/agent/webtool/retrievalMetrics";

const BENCHMARK_CONFIG = {
  iterations: 100,
  warmupIterations: 10,
  concurrencyLevels: [1, 2, 5, 10],
  thresholds: {
    plannerP95Ms: 10,
    concurrencyPoolP95Ms: 200,
    cacheP95Ms: 1,
    filterP95Ms: 50,
  },
};

interface BenchmarkResult {
  name: string;
  iterations: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  opsPerSecond: number;
  passed: boolean;
  threshold?: number;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function runBenchmark(
  name: string,
  fn: () => void | Promise<void>,
  iterations: number,
  threshold?: number
): BenchmarkResult {
  const durations: number[] = [];
  
  for (let i = 0; i < BENCHMARK_CONFIG.warmupIterations; i++) {
    fn();
  }
  
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    durations.push(performance.now() - start);
  }
  
  const minMs = Math.min(...durations);
  const maxMs = Math.max(...durations);
  const avgMs = durations.reduce((a, b) => a + b, 0) / durations.length;
  const p50Ms = percentile(durations, 50);
  const p95Ms = percentile(durations, 95);
  const p99Ms = percentile(durations, 99);
  const opsPerSecond = 1000 / avgMs;
  
  return {
    name,
    iterations,
    minMs,
    maxMs,
    avgMs,
    p50Ms,
    p95Ms,
    p99Ms,
    opsPerSecond,
    passed: threshold ? p95Ms <= threshold : true,
    threshold,
  };
}

async function runAsyncBenchmark(
  name: string,
  fn: () => Promise<void>,
  iterations: number,
  threshold?: number
): Promise<BenchmarkResult> {
  const durations: number[] = [];
  
  for (let i = 0; i < BENCHMARK_CONFIG.warmupIterations; i++) {
    await fn();
  }
  
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    durations.push(performance.now() - start);
  }
  
  const minMs = Math.min(...durations);
  const maxMs = Math.max(...durations);
  const avgMs = durations.reduce((a, b) => a + b, 0) / durations.length;
  const p50Ms = percentile(durations, 50);
  const p95Ms = percentile(durations, 95);
  const p99Ms = percentile(durations, 99);
  const opsPerSecond = 1000 / avgMs;
  
  return {
    name,
    iterations,
    minMs,
    maxMs,
    avgMs,
    p50Ms,
    p95Ms,
    p99Ms,
    opsPerSecond,
    passed: threshold ? p95Ms <= threshold : true,
    threshold,
  };
}

function formatResult(result: BenchmarkResult): string {
  const status = result.passed ? "✓ PASS" : "✗ FAIL";
  const thresholdInfo = result.threshold 
    ? ` (threshold: ${result.threshold}ms)` 
    : "";
  
  return `
${status} ${result.name}${thresholdInfo}
  Iterations: ${result.iterations}
  Min: ${result.minMs.toFixed(3)}ms
  Max: ${result.maxMs.toFixed(3)}ms
  Avg: ${result.avgMs.toFixed(3)}ms
  P50: ${result.p50Ms.toFixed(3)}ms
  P95: ${result.p95Ms.toFixed(3)}ms
  P99: ${result.p99Ms.toFixed(3)}ms
  Ops/sec: ${result.opsPerSecond.toFixed(1)}
`;
}

async function main() {
  console.log("=".repeat(60));
  console.log("Web Retrieval Benchmark Suite");
  console.log("=".repeat(60));
  console.log();
  
  const results: BenchmarkResult[] = [];
  
  console.log("Running RetrievalPlanner benchmarks...");
  const planner = new RetrievalPlanner();
  const queries = [
    "What is the GDP of Germany in 2024?",
    "Compare React vs Vue for web development",
    "How to implement a REST API with Node.js and Express?",
    "Latest news about artificial intelligence regulations",
    "¿Cuáles son las mejores prácticas para seguridad en aplicaciones web?",
  ];
  
  results.push(runBenchmark(
    "RetrievalPlanner.plan() - Simple query",
    () => planner.plan("What is the GDP of Germany?"),
    BENCHMARK_CONFIG.iterations,
    BENCHMARK_CONFIG.thresholds.plannerP95Ms
  ));
  
  results.push(runBenchmark(
    "RetrievalPlanner.plan() - Complex query",
    () => planner.plan("Compare Apple, Microsoft, and Google revenue growth in 2024 with detailed analysis"),
    BENCHMARK_CONFIG.iterations,
    BENCHMARK_CONFIG.thresholds.plannerP95Ms
  ));
  
  console.log("Running ConcurrencyPool benchmarks...");
  
  for (const concurrency of BENCHMARK_CONFIG.concurrencyLevels) {
    const pool = createConcurrencyPool<number>({ maxConcurrency: concurrency });
    const tasks: PoolTask<number>[] = Array(20).fill(null).map((_, i) => ({
      id: `task-${i}`,
      execute: async () => {
        await new Promise(r => setTimeout(r, 5));
        return i;
      },
    }));
    
    results.push(await runAsyncBenchmark(
      `ConcurrencyPool.executeAll() - ${concurrency} concurrent`,
      () => pool.executeAll(tasks).then(() => {}),
      10,
      BENCHMARK_CONFIG.thresholds.concurrencyPoolP95Ms
    ));
  }
  
  console.log("Running ResponseCache benchmarks...");
  const cache = new ResponseCache({ maxEntries: 1000, cleanupIntervalMs: 1000000 });
  
  for (let i = 0; i < 500; i++) {
    cache.set(`https://example.com/page${i}`, `Content for page ${i}`.repeat(100), {
      fetchMethod: "fetch",
      queryHash: `query${i % 10}`,
    });
  }
  
  results.push(runBenchmark(
    "ResponseCache.get() - Hit",
    () => cache.get("https://example.com/page250"),
    BENCHMARK_CONFIG.iterations,
    BENCHMARK_CONFIG.thresholds.cacheP95Ms
  ));
  
  results.push(runBenchmark(
    "ResponseCache.get() - Miss",
    () => cache.get("https://nonexistent.com/page"),
    BENCHMARK_CONFIG.iterations,
    BENCHMARK_CONFIG.thresholds.cacheP95Ms
  ));
  
  results.push(runBenchmark(
    "ResponseCache.set() - New entry",
    () => cache.set(`https://example.com/new${Date.now()}`, "New content", { fetchMethod: "fetch" }),
    BENCHMARK_CONFIG.iterations,
    BENCHMARK_CONFIG.thresholds.cacheP95Ms * 2
  ));
  
  console.log("Running RelevanceFilter benchmarks...");
  const filter = new RelevanceFilter();
  
  const shortContent = "The GDP of Germany in 2024 was approximately 4.5 trillion dollars.".repeat(5);
  const longContent = `
    The economy of Germany is the largest national economy in Europe.
    ${shortContent}
    ${"Additional paragraph with more economic information. ".repeat(50)}
  `.repeat(3);
  
  results.push(runBenchmark(
    "RelevanceFilter.filter() - Short content",
    () => filter.filter(shortContent, "GDP Germany 2024"),
    BENCHMARK_CONFIG.iterations,
    BENCHMARK_CONFIG.thresholds.filterP95Ms
  ));
  
  results.push(runBenchmark(
    "RelevanceFilter.filter() - Long content",
    () => filter.filter(longContent, "GDP Germany 2024"),
    BENCHMARK_CONFIG.iterations,
    BENCHMARK_CONFIG.thresholds.filterP95Ms * 2
  ));
  
  console.log("Running RetrievalMetricsCollector benchmarks...");
  const metrics = new RetrievalMetricsCollector(10000);
  
  for (let i = 0; i < 5000; i++) {
    metrics.record({
      timestamp: Date.now() - i * 1000,
      queryHash: `query${i}`,
      totalDurationMs: 1000 + Math.random() * 5000,
      searchDurationMs: 200 + Math.random() * 300,
      fetchDurationMs: 500 + Math.random() * 4000,
      processDurationMs: 100 + Math.random() * 200,
      sourcesCount: 3 + Math.floor(Math.random() * 5),
      cacheHitRate: Math.random(),
      relevanceScore: 0.3 + Math.random() * 0.5,
      method: ["cache", "fetch", "browser", "mixed"][Math.floor(Math.random() * 4)] as any,
      success: Math.random() > 0.1,
      errorCount: Math.random() > 0.9 ? 1 : 0,
    });
  }
  
  results.push(runBenchmark(
    "RetrievalMetricsCollector.getSLAReport()",
    () => metrics.getSLAReport(),
    BENCHMARK_CONFIG.iterations,
    10
  ));
  
  results.push(runBenchmark(
    "RetrievalMetricsCollector.getMethodBreakdown()",
    () => metrics.getMethodBreakdown(),
    BENCHMARK_CONFIG.iterations,
    20
  ));
  
  cache.destroy();
  
  console.log("\n" + "=".repeat(60));
  console.log("RESULTS");
  console.log("=".repeat(60));
  
  for (const result of results) {
    console.log(formatResult(result));
  }
  
  console.log("=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  console.log(`\nTotal benchmarks: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  
  if (failed > 0) {
    console.log("\nFailed benchmarks:");
    for (const result of results.filter(r => !r.passed)) {
      console.log(`  - ${result.name}: P95=${result.p95Ms.toFixed(2)}ms (threshold: ${result.threshold}ms)`);
    }
  }
  
  console.log(`\nOverall: ${failed === 0 ? "✓ ALL PASSED" : "✗ SOME FAILED"}`);
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
