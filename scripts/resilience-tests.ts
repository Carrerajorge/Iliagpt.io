import { 
  CircuitBreaker, 
  ExponentialBackoff, 
  withResilience, 
  HealthCheckManager,
  Bulkhead,
  RateLimiterAdvanced,
  ResourcePool,
  getOrCreateCircuitBreaker,
  globalHealthManager
} from "../server/agent/registry/resilience";

interface TestResult {
  name: string;
  status: "PASS" | "FAIL";
  duration: number;
  details?: string;
}

const results: TestResult[] = [];

async function runTest(name: string, testFn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await testFn();
    results.push({ name, status: "PASS", duration: Date.now() - start });
    console.log(`  ✓ ${name}`);
  } catch (error: any) {
    results.push({ name, status: "FAIL", duration: Date.now() - start, details: error.message });
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

async function testCircuitBreaker(): Promise<void> {
  console.log("\n[Circuit Breaker Tests]");

  await runTest("Circuit starts closed", async () => {
    const cb = new CircuitBreaker("test-cb-1");
    if (cb.getState() !== "closed") throw new Error("Expected closed state");
  });

  await runTest("Circuit opens after failures", async () => {
    const cb = new CircuitBreaker("test-cb-2", { failureThreshold: 3 });
    for (let i = 0; i < 3; i++) {
      cb.recordFailure();
    }
    if (cb.getState() !== "open") throw new Error("Expected open state");
  });

  await runTest("Circuit blocks execution when open", async () => {
    const cb = new CircuitBreaker("test-cb-3", { failureThreshold: 2 });
    cb.recordFailure();
    cb.recordFailure();
    if (cb.canExecute()) throw new Error("Should not allow execution when open");
  });

  await runTest("Circuit recovers to half-open after timeout", async () => {
    const cb = new CircuitBreaker("test-cb-4", { failureThreshold: 1, resetTimeoutMs: 100 });
    cb.recordFailure();
    await new Promise(r => setTimeout(r, 150));
    if (cb.getState() !== "half_open") throw new Error("Expected half_open state");
  });

  await runTest("Circuit closes after successes in half-open", async () => {
    const cb = new CircuitBreaker("test-cb-5", { failureThreshold: 1, successThreshold: 2, resetTimeoutMs: 50 });
    cb.recordFailure();
    await new Promise(r => setTimeout(r, 100));
    cb.recordSuccess();
    cb.recordSuccess();
    if (cb.getState() !== "closed") throw new Error("Expected closed state");
  });
}

async function testExponentialBackoff(): Promise<void> {
  console.log("\n[Exponential Backoff Tests]");

  await runTest("Backoff increases exponentially", async () => {
    const backoff = new ExponentialBackoff({ baseDelayMs: 100, maxDelayMs: 10000, jitterFactor: 0 });
    const d1 = backoff.getNextDelay();
    const d2 = backoff.getNextDelay();
    const d3 = backoff.getNextDelay();
    if (d2 <= d1 || d3 <= d2) throw new Error(`Delays should increase: ${d1}, ${d2}, ${d3}`);
  });

  await runTest("Backoff respects max delay", async () => {
    const backoff = new ExponentialBackoff({ baseDelayMs: 1000, maxDelayMs: 2000, jitterFactor: 0 });
    for (let i = 0; i < 10; i++) backoff.getNextDelay();
    const delay = backoff.getNextDelay();
    if (delay > 2000) throw new Error(`Delay ${delay} exceeds max 2000`);
  });

  await runTest("Backoff respects max retries", async () => {
    const backoff = new ExponentialBackoff({ maxRetries: 3 });
    for (let i = 0; i < 3; i++) backoff.getNextDelay();
    if (backoff.shouldRetry()) throw new Error("Should not retry after max retries");
  });

  await runTest("Backoff reset works", async () => {
    const backoff = new ExponentialBackoff({ maxRetries: 2 });
    backoff.getNextDelay();
    backoff.getNextDelay();
    backoff.reset();
    if (!backoff.shouldRetry()) throw new Error("Should allow retry after reset");
  });
}

async function testWithResilience(): Promise<void> {
  console.log("\n[withResilience Wrapper Tests]");

  await runTest("Successful operation returns data", async () => {
    const result = await withResilience(async () => ({ value: 42 }));
    if (!result.success || result.data?.value !== 42) throw new Error("Expected success with value 42");
  });

  await runTest("Failed operation retries", async () => {
    let attempts = 0;
    const result = await withResilience(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("fail");
        return "success";
      },
      { retryConfig: { maxRetries: 3, baseDelayMs: 10 } }
    );
    if (!result.success || attempts !== 3) throw new Error(`Expected 3 attempts, got ${attempts}`);
  });

  await runTest("Timeout is enforced", async () => {
    const result = await withResilience(
      async () => {
        await new Promise(r => setTimeout(r, 500));
        return "late";
      },
      { timeoutMs: 100 }
    );
    if (result.success) throw new Error("Should have timed out");
    if (!result.error?.includes("timed out")) throw new Error("Expected timeout error");
  });

  await runTest("Circuit breaker integration works", async () => {
    const cb = new CircuitBreaker("test-resilience-cb", { failureThreshold: 1 });
    cb.recordFailure();
    const result = await withResilience(
      async () => "should not run",
      { circuitBreaker: cb }
    );
    if (result.success) throw new Error("Should fail due to open circuit");
    if (!result.error?.includes("Circuit")) throw new Error("Expected circuit breaker error");
  });

  await runTest("Fallback is used when circuit is open", async () => {
    const cb = new CircuitBreaker("test-fallback-cb", { failureThreshold: 1 });
    cb.recordFailure();
    const result = await withResilience(
      async () => "primary",
      { 
        circuitBreaker: cb,
        fallback: async () => "fallback-value"
      }
    );
    if (result.success) throw new Error("Fallback should return success: false");
    if (result.data !== "fallback-value") throw new Error("Expected fallback value data");
  });
}

async function testHealthCheckManager(): Promise<void> {
  console.log("\n[Health Check Manager Tests]");

  await runTest("Register and run health check", async () => {
    const manager = new HealthCheckManager();
    manager.registerHealthCheck("test-service", async () => true);
    const result = await manager.runHealthCheck("test-service");
    if (!result.healthy) throw new Error("Expected healthy status");
  });

  await runTest("Health check tracks failures", async () => {
    const manager = new HealthCheckManager();
    let callCount = 0;
    manager.registerHealthCheck("failing-service", async () => {
      callCount++;
      return false;
    });
    await manager.runHealthCheck("failing-service");
    await manager.runHealthCheck("failing-service");
    const status = manager.getHealthStatus("failing-service") as any;
    if (status.consecutiveFailures !== 2) throw new Error(`Expected 2 failures, got ${status.consecutiveFailures}`);
  });

  await runTest("Overall health aggregation", async () => {
    const manager = new HealthCheckManager();
    manager.registerHealthCheck("healthy-1", async () => true);
    manager.registerHealthCheck("healthy-2", async () => true);
    manager.registerHealthCheck("unhealthy-1", async () => false);
    await manager.runAllHealthChecks();
    const overall = manager.getOverallHealth();
    if (overall.healthy) throw new Error("Should not be healthy with failing service");
    if (!overall.unhealthyServices.includes("unhealthy-1")) throw new Error("Should list unhealthy service");
  });
}

async function testBulkhead(): Promise<void> {
  console.log("\n[Bulkhead Tests]");

  await runTest("Bulkhead limits concurrency", async () => {
    const bulkhead = new Bulkhead("test-bulkhead", { maxConcurrent: 2, maxQueue: 5 });
    const acquired: boolean[] = [];
    acquired.push(await bulkhead.acquire());
    acquired.push(await bulkhead.acquire());
    
    const thirdAcquire = bulkhead.acquire();
    let thirdResolved = false;
    thirdAcquire.then(() => { thirdResolved = true; });
    
    await new Promise(r => setTimeout(r, 50));
    if (thirdResolved) throw new Error("Third acquire should be queued");
    
    bulkhead.release();
    await new Promise(r => setTimeout(r, 50));
    if (!thirdResolved) throw new Error("Third acquire should complete after release");
  });

  await runTest("Bulkhead rejects when queue is full", async () => {
    const bulkhead = new Bulkhead("test-bulkhead-2", { maxConcurrent: 1, maxQueue: 1 });
    await bulkhead.acquire();
    bulkhead.acquire();
    const third = await bulkhead.acquire();
    if (third) throw new Error("Should reject when queue is full");
  });
}

async function testRateLimiter(): Promise<void> {
  console.log("\n[Rate Limiter Tests]");

  await runTest("Rate limiter allows within limit", async () => {
    const limiter = new RateLimiterAdvanced();
    limiter.configure("test-api", 10, 100);
    for (let i = 0; i < 5; i++) {
      if (!limiter.tryAcquire("test-api")) throw new Error(`Should allow request ${i}`);
    }
  });

  await runTest("Rate limiter blocks when exhausted", async () => {
    const limiter = new RateLimiterAdvanced();
    limiter.configure("limited-api", 3, 3);
    limiter.tryAcquire("limited-api");
    limiter.tryAcquire("limited-api");
    limiter.tryAcquire("limited-api");
    if (limiter.tryAcquire("limited-api")) throw new Error("Should block when tokens exhausted");
  });

  await runTest("Rate limiter refills over time", async () => {
    const limiter = new RateLimiterAdvanced();
    limiter.configure("refill-api", 100, 5);
    for (let i = 0; i < 5; i++) limiter.tryAcquire("refill-api");
    await new Promise(r => setTimeout(r, 100));
    if (!limiter.tryAcquire("refill-api")) throw new Error("Should have tokens after refill");
  });
}

async function testResourcePool(): Promise<void> {
  console.log("\n[Resource Pool Tests]");

  await runTest("Pool creates and releases resources", async () => {
    let created = 0;
    let destroyed = 0;
    const pool = new ResourcePool(
      async () => { created++; return { id: created }; },
      async () => { destroyed++; },
      { minSize: 2, maxSize: 5 }
    );
    
    await pool.initialize();
    if (created !== 2) throw new Error(`Expected 2 created, got ${created}`);
    
    const r1 = await pool.acquire();
    const r2 = await pool.acquire();
    if (!r1 || !r2) throw new Error("Should acquire resources");
    
    pool.release(r1);
    pool.release(r2);
    
    const metrics = pool.getMetrics();
    if (metrics.available !== 2) throw new Error(`Expected 2 available, got ${metrics.available}`);
  });
}

async function testChaosScenarios(): Promise<void> {
  console.log("\n[Chaos Scenario Tests]");

  await runTest("Handles rapid failures gracefully", async () => {
    const cb = getOrCreateCircuitBreaker("chaos-rapid");
    for (let i = 0; i < 10; i++) {
      cb.recordFailure();
    }
    if (cb.getState() !== "open") throw new Error("Circuit should be open after rapid failures");
  });

  await runTest("Recovers from cascade failures", async () => {
    const services = ["svc-a", "svc-b", "svc-c"];
    const cbs = services.map(name => getOrCreateCircuitBreaker(name, { failureThreshold: 2, resetTimeoutMs: 50 }));
    
    cbs.forEach(cb => { cb.recordFailure(); cb.recordFailure(); });
    const allOpen = cbs.every(cb => cb.getState() === "open");
    if (!allOpen) throw new Error("All circuits should be open");
    
    await new Promise(r => setTimeout(r, 100));
    const allHalfOpen = cbs.every(cb => cb.getState() === "half_open");
    if (!allHalfOpen) throw new Error("All circuits should transition to half_open");
    
    cbs.forEach(cb => { cb.recordSuccess(); cb.recordSuccess(); cb.recordSuccess(); });
    const allClosed = cbs.every(cb => cb.getState() === "closed");
    if (!allClosed) throw new Error("All circuits should recover to closed");
  });

  await runTest("Handles concurrent load with bulkhead", async () => {
    const bulkhead = new Bulkhead("chaos-concurrent", { maxConcurrent: 3, maxQueue: 10, queueTimeoutMs: 1000 });
    const results: boolean[] = [];
    
    const tasks = Array.from({ length: 10 }, async () => {
      const acquired = await bulkhead.acquire();
      results.push(acquired);
      if (acquired) {
        await new Promise(r => setTimeout(r, 50));
        bulkhead.release();
      }
      return acquired;
    });
    
    await Promise.all(tasks);
    const successCount = results.filter(r => r).length;
    if (successCount < 3) throw new Error(`Expected at least 3 successes, got ${successCount}`);
  });
}

async function testProductionWorkflowIntegration(): Promise<void> {
  console.log("\n[Production Workflow Integration Tests]");

  await runTest("API endpoint returns workflow status", async () => {
    const response = await fetch("http://localhost:5000/api/registry/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        query: "genera una imagen de prueba de resiliencia",
        userId: "test-user"
      })
    });
    const data = await response.json();
    if (!data.success) throw new Error("Workflow creation should succeed");
    if (!data.runId) throw new Error("Should return runId");
  });

  await runTest("Chat endpoint handles generation with resilience", async () => {
    const response = await fetch("http://localhost:5000/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "crea una imagen de un gato para test de resiliencia" }],
        provider: "google",
        model: "gemini-3-flash-preview"
      })
    });
    const data = await response.json();
    if (!data.content) throw new Error("Should return content");
    if (!data.artifact) throw new Error("Should return artifact");
  });
}

async function main() {
  console.log("========================================");
  console.log("   RESILIENCE ACCEPTANCE TESTS");
  console.log("========================================");

  await testCircuitBreaker();
  await testExponentialBackoff();
  await testWithResilience();
  await testHealthCheckManager();
  await testBulkhead();
  await testRateLimiter();
  await testResourcePool();
  await testChaosScenarios();
  await testProductionWorkflowIntegration();

  console.log("\n========================================");
  console.log("           TEST SUMMARY");
  console.log("========================================");

  const passed = results.filter(r => r.status === "PASS").length;
  const failed = results.filter(r => r.status === "FAIL").length;
  const total = results.length;

  console.log(`Total: ${total}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`);

  if (failed > 0) {
    console.log("\nFailed Tests:");
    results.filter(r => r.status === "FAIL").forEach(r => {
      console.log(`  - ${r.name}: ${r.details}`);
    });
  }

  console.log("========================================\n");
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
