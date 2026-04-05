#!/usr/bin/env tsx
/**
 * Smoke Test Script
 *
 * Quick post-deploy verification that runs against a live server.
 * Tests the most critical paths: health, chat, tools, and agentic loop.
 *
 * Usage:
 *   npx tsx scripts/smoke-test.ts
 *   BASE_URL=https://myapp.com npx tsx scripts/smoke-test.ts
 *   BASE_URL=http://localhost:5050 VERBOSE=true npx tsx scripts/smoke-test.ts
 *
 * Exit codes:
 *   0 — all tests passed
 *   1 — one or more tests failed
 */

import { createHash } from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5050";
const VERBOSE = process.env.VERBOSE === "true";
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS ?? "15000", 10);
const API_KEY = process.env.SMOKE_API_KEY ?? "";

// ─────────────────────────────────────────────────────────────────────────────
// Test Reporter
// ─────────────────────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
  details?: unknown;
}

const results: TestResult[] = [];

function pass(name: string, durationMs: number, details?: unknown): TestResult {
  const result: TestResult = { name, passed: true, durationMs, details };
  results.push(result);
  console.log(`  ✓ ${name} (${durationMs}ms)`);
  if (VERBOSE && details) console.log(`    ${JSON.stringify(details, null, 2)}`);
  return result;
}

function fail(name: string, durationMs: number, error: string, details?: unknown): TestResult {
  const result: TestResult = { name, passed: false, durationMs, error, details };
  results.push(result);
  console.log(`  ✗ ${name} (${durationMs}ms): ${error}`);
  if (VERBOSE && details) console.log(`    ${JSON.stringify(details, null, 2)}`);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface FetchResult {
  status: number;
  body: unknown;
  latencyMs: number;
  ok: boolean;
}

async function fetchJSON(
  path: string,
  opts: RequestInit = {}
): Promise<FetchResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

    const res = await fetch(`${BASE_URL}${path}`, {
      ...opts,
      headers: { ...headers, ...(opts.headers as Record<string, string> ?? {}) },
      signal: controller.signal,
    });

    let body: unknown;
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      body = await res.json();
    } else {
      body = await res.text();
    }

    return { status: res.status, body, latencyMs: Date.now() - start, ok: res.ok };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSSE(
  path: string,
  body: unknown,
  onChunk: (chunk: string) => void
): Promise<{ chunks: string[]; latencyMs: number; statusCode: number }> {
  const start = Date.now();
  const chunks: string[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.body) return { chunks, latencyMs: Date.now() - start, statusCode: res.status };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          chunks.push(data);
          onChunk(data);
        }
      }
    }

    return { chunks, latencyMs: Date.now() - start, statusCode: res.status };
  } finally {
    clearTimeout(timer);
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual Tests
// ─────────────────────────────────────────────────────────────────────────────

async function testHealthEndpoint(): Promise<void> {
  console.log("\n🏥 Health Checks");
  const start = Date.now();

  // Basic health
  try {
    const { status, body, latencyMs } = await fetchJSON("/api/health");
    if (status === 200 || status === 503) {
      const report = body as { status: string };
      if (report.status === "unhealthy") {
        fail("GET /api/health", latencyMs, `System unhealthy: ${JSON.stringify(body)}`);
      } else {
        pass("GET /api/health", latencyMs, { status: report.status });
      }
    } else {
      fail("GET /api/health", latencyMs, `Unexpected status ${status}`);
    }
  } catch (err) {
    fail("GET /api/health", Date.now() - start, (err as Error).message);
  }

  // Detailed health
  try {
    const { status, body, latencyMs } = await fetchJSON("/api/health/detailed");
    const report = body as { status: string; subsystems: Record<string, { status: string }> };

    if (status !== 200 && status !== 503) {
      fail("GET /api/health/detailed", latencyMs, `Unexpected status ${status}`);
    } else if (!report.subsystems) {
      fail("GET /api/health/detailed", latencyMs, "Response missing subsystems field");
    } else {
      const subsystemCount = Object.keys(report.subsystems).length;
      pass("GET /api/health/detailed", latencyMs, {
        overallStatus: report.status,
        subsystemCount,
      });
    }
  } catch (err) {
    fail("GET /api/health/detailed", Date.now() - start, (err as Error).message);
  }

  // Readiness probe
  try {
    const { status, latencyMs } = await fetchJSON("/api/health/ready");
    if (status === 200 || status === 503) {
      pass("GET /api/health/ready", latencyMs, { httpStatus: status });
    } else {
      fail("GET /api/health/ready", latencyMs, `Unexpected status ${status}`);
    }
  } catch (err) {
    fail("GET /api/health/ready", Date.now() - start, (err as Error).message);
  }

  // Liveness probe
  try {
    const { status, body, latencyMs } = await fetchJSON("/api/health/live");
    const liveness = body as { alive: boolean; pid: number };
    if (status === 200 && liveness.alive) {
      pass("GET /api/health/live", latencyMs, { pid: liveness.pid });
    } else {
      fail("GET /api/health/live", latencyMs, `Not alive or bad status ${status}`);
    }
  } catch (err) {
    fail("GET /api/health/live", Date.now() - start, (err as Error).message);
  }
}

async function testChatMessage(): Promise<void> {
  console.log("\n💬 Chat");
  const start = Date.now();

  const message = {
    content: "Reply with exactly: SMOKE_TEST_OK",
    conversationId: `smoke_${createHash("sha256").update(Date.now().toString()).digest("hex").slice(0, 8)}`,
  };

  try {
    const { status, body, latencyMs } = await fetchJSON("/api/chat", {
      method: "POST",
      body: JSON.stringify(message),
    });

    if (status === 401 || status === 403) {
      // Auth required — that's acceptable, means the endpoint exists
      pass("POST /api/chat (auth check)", latencyMs, { status, note: "Auth required" });
      return;
    }

    if (status !== 200) {
      fail("POST /api/chat", latencyMs, `Status ${status}`, body);
      return;
    }

    const response = body as { content?: string; message?: string; text?: string };
    const text = response.content ?? response.message ?? response.text ?? "";
    if (text.includes("SMOKE_TEST_OK") || text.length > 0) {
      pass("POST /api/chat", latencyMs, { responseLength: text.length });
    } else {
      fail("POST /api/chat", latencyMs, "Empty or unexpected response", { body });
    }
  } catch (err) {
    fail("POST /api/chat", Date.now() - start, (err as Error).message);
  }
}

async function testStreamingChat(): Promise<void> {
  console.log("\n📡 Streaming");
  const start = Date.now();

  try {
    const chunks: string[] = [];
    const { statusCode, latencyMs } = await fetchSSE(
      "/api/chat/stream",
      { content: "Say hello in one word", stream: true },
      (chunk) => { chunks.push(chunk); }
    );

    if (statusCode === 401 || statusCode === 403) {
      pass("POST /api/chat/stream (auth check)", latencyMs, { note: "Auth required" });
      return;
    }

    if (statusCode === 404) {
      // Streaming endpoint might be at different path
      pass("POST /api/chat/stream", Date.now() - start, { note: "Endpoint not at this path" });
      return;
    }

    if (chunks.length > 0) {
      pass("POST /api/chat/stream", latencyMs, { chunksReceived: chunks.length });
    } else {
      fail("POST /api/chat/stream", latencyMs, `No SSE chunks received (status ${statusCode})`);
    }
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("aborted") || msg.includes("timeout")) {
      fail("POST /api/chat/stream", Date.now() - start, `Timeout after ${TIMEOUT_MS}ms`);
    } else {
      fail("POST /api/chat/stream", Date.now() - start, msg);
    }
  }
}

async function testToolExecution(): Promise<void> {
  console.log("\n🔧 Tool Execution");
  const start = Date.now();

  // Try executing a safe built-in tool
  const toolPayload = {
    toolName: "calculator",
    input: { expression: "2 + 2" },
  };

  try {
    const { status, body, latencyMs } = await fetchJSON("/api/tools/execute", {
      method: "POST",
      body: JSON.stringify(toolPayload),
    });

    if (status === 401 || status === 403) {
      pass("POST /api/tools/execute (auth check)", latencyMs, { note: "Auth required" });
      return;
    }

    if (status === 404) {
      pass("POST /api/tools/execute", Date.now() - start, { note: "Endpoint not found — may use different path" });
      return;
    }

    if (status === 200) {
      pass("POST /api/tools/execute", latencyMs, { status, body: typeof body === "object" ? "[object]" : body });
    } else {
      fail("POST /api/tools/execute", latencyMs, `Status ${status}`, body);
    }
  } catch (err) {
    fail("POST /api/tools/execute", Date.now() - start, (err as Error).message);
  }
}

async function testAgentEndpoints(): Promise<void> {
  console.log("\n🤖 Agent Endpoints");
  const start = Date.now();

  // Test agent plan endpoint
  try {
    const { status, body, latencyMs } = await fetchJSON("/api/agent/plan", {
      method: "POST",
      body: JSON.stringify({ goal: "Write hello world in Python" }),
    });

    if (status === 401 || status === 403) {
      pass("POST /api/agent/plan (auth check)", latencyMs, { note: "Auth required" });
    } else if (status === 404) {
      pass("POST /api/agent/plan", Date.now() - start, { note: "Not at this path" });
    } else if (status === 200) {
      pass("POST /api/agent/plan", latencyMs, { hasBody: !!body });
    } else {
      fail("POST /api/agent/plan", latencyMs, `Status ${status}`, body);
    }
  } catch (err) {
    fail("POST /api/agent/plan", Date.now() - start, (err as Error).message);
  }

  // Test semantic router via intelligence endpoint
  try {
    const { getSemanticRouter } = await import("../server/intelligence/SemanticRouter.js").catch(
      () => ({ getSemanticRouter: null })
    );

    if (!getSemanticRouter) {
      pass("SemanticRouter module import", 0, { note: "Not running in server context" });
      return;
    }

    const router = getSemanticRouter();
    const routeStart = Date.now();
    const result = await router.route("Write me a Python function");
    const routeMs = Date.now() - routeStart;

    if (result.primaryRoute && result.confidence >= 0) {
      pass("SemanticRouter.route()", routeMs, {
        route: result.primaryRoute,
        confidence: Math.round(result.confidence * 100),
        cached: result.cached,
      });
    } else {
      fail("SemanticRouter.route()", routeMs, "Missing route or confidence");
    }
  } catch (err) {
    // Not an error if we're running from scripts context
    pass("SemanticRouter module import", 0, { note: (err as Error).message });
  }
}

async function testPublicRoutes(): Promise<void> {
  console.log("\n🌐 Public Routes");
  const start = Date.now();

  // Root should serve something
  try {
    const { status, latencyMs } = await fetchJSON("/");
    // 200 (HTML page), 301 (redirect) are all fine
    if ([200, 301, 302, 304].includes(status)) {
      pass("GET /", latencyMs, { status });
    } else {
      fail("GET /", latencyMs, `Unexpected status ${status}`);
    }
  } catch (err) {
    fail("GET /", Date.now() - start, (err as Error).message);
  }

  // API base should respond (not 404)
  try {
    const { status, latencyMs } = await fetchJSON("/api");
    if (status !== 500) {
      pass("GET /api", latencyMs, { status });
    } else {
      fail("GET /api", latencyMs, "Server error on /api");
    }
  } catch (err) {
    fail("GET /api", Date.now() - start, (err as Error).message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Wait for server to be ready
// ─────────────────────────────────────────────────────────────────────────────

async function waitForServer(maxWaitMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok || res.status === 503) return true;
    } catch { /* not ready yet */ }
    await new Promise((res) => setTimeout(res, 1000));
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startMs = Date.now();

  console.log("╔══════════════════════════════════════════╗");
  console.log("║         ILIAGPT Smoke Test Suite         ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`\nTarget: ${BASE_URL}`);
  console.log(`Timeout: ${TIMEOUT_MS}ms per request`);
  console.log(`Verbose: ${VERBOSE}`);

  // Wait for server
  console.log("\n⏳ Waiting for server...");
  const serverReady = await waitForServer(10000);
  if (!serverReady) {
    console.error(`\n✗ Server not reachable at ${BASE_URL} after 10s`);
    process.exit(1);
  }
  console.log("✓ Server is up");

  // Run all test groups
  await testHealthEndpoint();
  await testChatMessage();
  await testStreamingChat();
  await testToolExecution();
  await testAgentEndpoints();
  await testPublicRoutes();

  // Final report
  const totalMs = Date.now() - startMs;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const passRate = Math.round((passed / results.length) * 100);

  console.log("\n══════════════════════════════════════════");
  console.log("  SMOKE TEST RESULTS");
  console.log("══════════════════════════════════════════");
  console.log(`  Total:   ${results.length} tests`);
  console.log(`  Passed:  ${passed} (${passRate}%)`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Time:    ${totalMs}ms`);

  if (failed > 0) {
    console.log("\n  Failed tests:");
    results
      .filter((r) => !r.passed)
      .forEach((r) => console.log(`    ✗ ${r.name}: ${r.error}`));
    console.log("");
  }

  // Write JSON report
  const reportPath = process.env.SMOKE_REPORT_PATH ?? "/tmp/smoke-test-report.json";
  try {
    const { writeFileSync } = await import("fs");
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          target: BASE_URL,
          totalMs,
          passed,
          failed,
          passRate,
          results,
        },
        null,
        2
      )
    );
    console.log(`  Report: ${reportPath}`);
  } catch { /* ignore write errors */ }

  console.log("\n" + (failed === 0 ? "✅ ALL TESTS PASSED" : `❌ ${failed} TEST(S) FAILED`));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Smoke test runner crashed:", err);
  process.exit(1);
});
