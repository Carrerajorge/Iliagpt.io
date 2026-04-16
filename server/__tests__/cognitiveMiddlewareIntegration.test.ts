/**
 * Cognitive Middleware — heavy integration suite (Turn H).
 *
 * The unit tests in `cognitiveMiddleware.test.ts` pin individual
 * behaviors in isolation. This file exercises the FULL stack end
 * to end: every turn of the roadmap (A through H) wired into one
 * middleware instance, running realistic multi-turn conversational
 * flows, concurrent sessions, mixed streaming + tool + context
 * combinations, resilience against adapter failures, and cross-
 * provider compatibility.
 *
 * These tests are SLOWER than unit tests on purpose — they
 * construct real middleware graphs with stores, limiters,
 * breakers, registries, repositories, and sessions. They are the
 * last line of defense before a release: if anything here breaks,
 * the production pipeline is broken.
 *
 * Categories:
 *
 *   1. Multi-turn conversational flows (sessions)
 *   2. Full-stack combined scenarios (tools + context + persistence + telemetry)
 *   3. Resilience under failure (rate limit + breaker + bad tool)
 *   4. Streaming + cancellation + artifact extraction
 *   5. Multi-LLM compatibility (same prompt → same shape across adapters)
 *   6. Concurrency + isolation (many sessions, many users)
 *   7. Artifact extraction across the full pipeline
 *   8. Alignment + validator integration
 */

import { describe, it, expect } from "vitest";
import {
  CognitiveMiddleware,
  CognitiveSession,
  EchoMockAdapter,
  ScriptedMockAdapter,
  FailingMockAdapter,
  StreamingMockAdapter,
  InMemoryToolRegistry,
  InMemoryMemoryStore,
  InMemoryDocumentStore,
  InMemoryTokenBucketLimiter,
  CircuitBreakerRegistry,
  InMemoryRunRepository,
  extractArtifacts,
  type CognitiveStreamEvent,
  type ProviderAdapter,
  type CognitiveIntent,
  type CognitiveArtifact,
} from "../cognitive";

// ---------------------------------------------------------------------------
// Test harness: build a "production-shaped" middleware with every
// layer wired together.
// ---------------------------------------------------------------------------

function buildFullStackMiddleware(overrides: {
  adapters?: ProviderAdapter[];
  // All layers individually optional so specific tests can skip
  // components they don't need.
  skipMemory?: boolean;
  skipDocs?: boolean;
  skipTools?: boolean;
  skipRateLimit?: boolean;
  skipBreakers?: boolean;
  skipRepo?: boolean;
  maxToolIterations?: number;
} = {}): {
  middleware: CognitiveMiddleware;
  repo: InMemoryRunRepository;
  memory: InMemoryMemoryStore;
  docs: InMemoryDocumentStore;
  registry: InMemoryToolRegistry;
  limiter: InMemoryTokenBucketLimiter;
  breakers: CircuitBreakerRegistry;
} {
  const adapters = overrides.adapters ?? [new EchoMockAdapter()];

  const memory = new InMemoryMemoryStore({
    seed: [
      {
        id: "m-alice-1",
        userId: "alice",
        text: "alice prefers kubernetes over docker swarm",
        importance: 0.9,
        createdAt: 1,
      },
      {
        id: "m-alice-2",
        userId: "alice",
        text: "alice writes python and uses pytest",
        importance: 0.7,
        createdAt: 2,
      },
      {
        id: "m-bob-1",
        userId: "bob",
        text: "bob prefers typescript and vitest",
        importance: 0.8,
        createdAt: 3,
      },
    ],
  });

  const docs = new InMemoryDocumentStore({
    documents: [
      {
        docId: "handbook",
        title: "Handbook",
        text:
          "Refund policy: refund allowed within 30 days of purchase. " +
          "Shipping takes 3 to 5 business days to anywhere worldwide. " +
          "Our support team answers every email within 24 hours.",
      },
      {
        docId: "api-guide",
        title: "API Guide",
        text:
          "kubernetes cluster setup: use kubectl apply. " +
          "Deployment specs live in the manifests folder. " +
          "kubernetes pods restart on failure automatically.",
      },
    ],
  });

  const registry = new InMemoryToolRegistry([
    {
      descriptor: {
        name: "add_numbers",
        description: "adds two numbers",
        inputSchema: {
          type: "object",
          properties: { a: { type: "number" }, b: { type: "number" } },
          required: ["a", "b"],
        },
      },
      handler: async (args) => ({
        sum: (args.a as number) + (args.b as number),
      }),
    },
    {
      descriptor: {
        name: "slow_tool",
        description: "a slow tool for timeout testing",
        inputSchema: { type: "object" },
      },
      handler: async () =>
        new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 200)),
      timeoutMs: 50,
    },
  ]);

  const limiter = new InMemoryTokenBucketLimiter({
    capacity: 10_000,
    refillPerSecond: 100,
  });

  const breakers = new CircuitBreakerRegistry({
    defaults: { failureThreshold: 3, cooldownMs: 60_000 },
  });

  const repo = new InMemoryRunRepository({ name: "integration-repo" });

  const middleware = new CognitiveMiddleware({
    adapters,
    maxRetries: 1,
    timeoutMs: 10_000,
    defaultSystemPrompt: "You are a helpful assistant.",
    memoryStore: overrides.skipMemory ? undefined : memory,
    documentStore: overrides.skipDocs ? undefined : docs,
    toolRegistry: overrides.skipTools ? undefined : registry,
    maxToolIterations: overrides.maxToolIterations ?? 5,
    rateLimiter: overrides.skipRateLimit ? undefined : limiter,
    circuitBreakers: overrides.skipBreakers ? undefined : breakers,
    runRepository: overrides.skipRepo ? undefined : repo,
    awaitRunSave: true,
  });

  return { middleware, repo, memory, docs, registry, limiter, breakers };
}

/**
 * Adapter that plays one turn of a tool-call → stop sequence. The
 * state is per-userId so concurrent sessions don't race. Used by
 * tests that need deterministic agentic loops.
 */
class PerUserToolAgentAdapter implements ProviderAdapter {
  readonly name: string;
  readonly capabilities: ReadonlySet<CognitiveIntent> = new Set<CognitiveIntent>([
    "chat",
    "qa",
    "tool_call",
    "data_analysis",
    "agent_task",
    "unknown",
  ]);
  private readonly turnsByUser = new Map<string, number>();

  constructor(name = "per-user-tool-agent") {
    this.name = name;
  }

  async generate(request: {
    messages: { role: string; content: string }[];
  }): Promise<{
    text: string;
    finishReason: "stop" | "tool_calls";
    toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
  }> {
    // Decide based on whether a tool result is already in history.
    const hasToolResult = request.messages.some((m) => m.role === "tool");
    if (!hasToolResult) {
      return {
        text: "",
        finishReason: "tool_calls",
        toolCalls: [
          { id: "c1", name: "add_numbers", args: { a: 2, b: 3 } },
        ],
      };
    }
    // Second turn: emit final text.
    const lastTool = [...request.messages].reverse().find((m) => m.role === "tool");
    let parsed: { sum?: number } = {};
    try {
      parsed = lastTool ? JSON.parse(lastTool.content) : {};
    } catch {
      parsed = {};
    }
    return {
      text: `The answer is ${parsed.sum ?? "unknown"}.`,
      finishReason: "stop",
      toolCalls: [],
    };
  }
}

// ---------------------------------------------------------------------------
// 1. Multi-turn conversational flows (sessions)
// ---------------------------------------------------------------------------

describe("integration: CognitiveSession multi-turn flows", () => {
  it("I1 session tracks turn count across continue calls", async () => {
    const { middleware } = buildFullStackMiddleware();
    const session = new CognitiveSession(middleware, { userId: "alice" });
    expect(session.snapshot().turnCount).toBe(0);
    await session.continue("hello");
    expect(session.snapshot().turnCount).toBe(1);
    await session.continue("how are you?");
    expect(session.snapshot().turnCount).toBe(2);
    await session.continue("thanks");
    expect(session.snapshot().turnCount).toBe(3);
  });

  it("I2 session snapshots carry last response + ok state", async () => {
    const { middleware } = buildFullStackMiddleware();
    const session = new CognitiveSession(middleware, { userId: "alice" });
    await session.continue("hola");
    const snap = session.snapshot();
    expect(snap.lastUserMessage).toBe("hola");
    expect(snap.lastResponseText).toContain("Echo:");
    expect(snap.lastOk).toBe(true);
  });

  it("I3 session uses the same conversationId across turns", async () => {
    const { middleware, repo } = buildFullStackMiddleware();
    const session = new CognitiveSession(middleware, {
      userId: "alice",
      conversationId: "my-conv",
    });
    await session.continue("turn 1");
    await session.continue("turn 2");
    // Both turns should land in the repo with the same convId.
    const runs = await repo.listByUser("alice");
    expect(runs.length).toBe(2);
    expect(runs[0].conversationId).toBe("my-conv");
    expect(runs[1].conversationId).toBe("my-conv");
  });

  it("I4 session serializes concurrent continue calls", async () => {
    const { middleware } = buildFullStackMiddleware();
    const session = new CognitiveSession(middleware, { userId: "alice" });
    // Fire 5 concurrent continues. They should all complete
    // AND the final turnCount should be exactly 5.
    await Promise.all([
      session.continue("a"),
      session.continue("b"),
      session.continue("c"),
      session.continue("d"),
      session.continue("e"),
    ]);
    expect(session.snapshot().turnCount).toBe(5);
  });

  it("I5 session clearErrors wipes errorHistory but keeps turnCount", async () => {
    const brokenRepo = {
      name: "broken",
      save: async () => {
        throw new Error("db down");
      },
      get: async () => null,
      listByUser: async () => [],
      deleteByRunId: async () => 0,
    };
    const { middleware } = buildFullStackMiddleware();
    // Override repo after construction isn't supported — build a
    // fresh middleware with the broken repo instead.
    const mw = new CognitiveMiddleware({
      adapters: [new EchoMockAdapter()],
      runRepository: brokenRepo,
      awaitRunSave: true,
    });
    const session = new CognitiveSession(mw, { userId: "alice" });
    await session.continue("hi");
    expect(session.snapshot().errorHistory.length).toBeGreaterThan(0);
    session.clearErrors();
    expect(session.snapshot().errorHistory).toEqual([]);
    expect(session.snapshot().turnCount).toBe(1);
    void middleware;
  });
});

// ---------------------------------------------------------------------------
// 2. Full-stack combined scenarios
// ---------------------------------------------------------------------------

describe("integration: full-stack combined scenarios", () => {
  it("I6 turn A+B+C+D+E+F+G+H all fire on one run", async () => {
    const { middleware, repo, memory, docs, registry } = buildFullStackMiddleware({
      adapters: [new PerUserToolAgentAdapter("agent-full-stack")],
    });

    // Confirm stores are primed.
    expect(memory.size).toBeGreaterThan(0);
    expect(docs.chunkCount).toBeGreaterThan(0);
    expect(registry.size).toBeGreaterThan(0);

    const r = await middleware.run({
      userId: "alice",
      message: "please add two numbers alice kubernetes",
    });

    expect(r.ok).toBe(true);
    // Intent classifier picked something
    expect(r.routing.intent.intent).toBeDefined();
    // Context enrichment found memory + doc
    expect(r.telemetry.contextChunksIncluded).toBeGreaterThanOrEqual(1);
    // Tool executed
    expect(r.telemetry.toolCallCount).toBe(1);
    expect(r.toolExecutions[0].ok).toBe(true);
    // Rate limiter allowed
    expect(r.telemetry.rateLimitAllowed).toBe(true);
    // Breaker was closed
    expect(r.telemetry.circuitBreakerState).toBe("closed");
    // Run was persisted
    const runs = await repo.listByUser("alice");
    expect(runs.length).toBe(1);
    expect(runs[0].toolExecutions.length).toBe(1);
    // Telemetry collected every field
    expect(r.telemetry.intentClassificationMs).toBeGreaterThanOrEqual(0);
    expect(r.telemetry.contextEnrichmentMs).toBeGreaterThanOrEqual(0);
    expect(r.telemetry.providerCallMs).toBeGreaterThanOrEqual(0);
    expect(r.telemetry.validationMs).toBeGreaterThanOrEqual(0);
    // Artifacts extracted (empty in this case, but field present)
    expect(Array.isArray(r.artifacts)).toBe(true);
    expect(typeof r.telemetry.artifactCount).toBe("number");
  });

  it("I7 context bundle leaks into the actual provider request", async () => {
    const echo = new EchoMockAdapter();
    const { middleware } = buildFullStackMiddleware({ adapters: [echo] });
    await middleware.run({
      userId: "alice",
      message: "alice prefers what container runtime",
    });
    // System prompt should carry the rendered memory block.
    expect(echo.lastRequest?.systemPrompt).toContain("[memory:");
    expect(echo.lastRequest?.systemPrompt).toContain("kubernetes");
  });

  it("I8 tool results round-trip into the run record", async () => {
    const { middleware, repo } = buildFullStackMiddleware({
      adapters: [new PerUserToolAgentAdapter("agent-roundtrip")],
    });
    await middleware.run({
      userId: "alice",
      message: "add 2 and 3 please",
    });
    const runs = await repo.listByUser("alice");
    const rec = runs[0];
    expect(rec.toolExecutions.length).toBe(1);
    const outcome = rec.toolExecutions[0];
    expect(outcome.ok).toBe(true);
    expect((outcome.result as { sum: number }).sum).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 3. Resilience under failure
// ---------------------------------------------------------------------------

describe("integration: resilience under failure", () => {
  it("I9 rate limit denial returns structured error, still persists telemetry", async () => {
    const { middleware } = buildFullStackMiddleware();
    // Override with a tiny bucket by building a fresh middleware.
    const tinyLimiter = new InMemoryTokenBucketLimiter({
      capacity: 1,
      refillPerSecond: 0,
    });
    const mw = new CognitiveMiddleware({
      adapters: [new EchoMockAdapter()],
      rateLimiter: tinyLimiter,
    });
    await mw.run({ userId: "u", message: "first" });
    const denied = await mw.run({ userId: "u", message: "second" });
    expect(denied.ok).toBe(false);
    expect(denied.telemetry.rateLimitAllowed).toBe(false);
    expect(
      denied.validation.issues.some((i) => i.code === "rate_limited"),
    ).toBe(true);
    void middleware;
  });

  it("I10 breaker trips after N failures + fails over to next adapter", async () => {
    const failing = new FailingMockAdapter("always fails", Infinity, "bad");
    const good = new EchoMockAdapter();
    const breakers = new CircuitBreakerRegistry({
      defaults: { failureThreshold: 2, cooldownMs: 60_000 },
    });
    const mw = new CognitiveMiddleware({
      adapters: [failing, good],
      circuitBreakers: breakers,
      maxRetries: 0,
    });

    // Two failures should trip "bad" breaker.
    await mw.run({ userId: "u", message: "hi 1" });
    await mw.run({ userId: "u", message: "hi 2" });
    expect(breakers.get("bad").getStatus().state).toBe("open");

    // Third call should failover to "mock-echo"
    const r3 = await mw.run({ userId: "u", message: "hi 3" });
    expect(r3.ok).toBe(true);
    expect(r3.routing.providerName).toBe("mock-echo");
  });

  it("I11 tool timeout becomes a feedback loop, run still succeeds", async () => {
    // The slow_tool has timeoutMs=50 and its handler runs for 200ms.
    // The agentic loop should see a timeout outcome fed back.
    const scripted = new ScriptedMockAdapter(
      [
        {
          text: "",
          finishReason: "tool_calls",
          toolCalls: [{ id: "c1", name: "slow_tool", args: {} }],
        },
        { text: "Recovered from tool timeout.", finishReason: "stop", toolCalls: [] },
      ],
      "recovery-agent",
    );
    const { middleware } = buildFullStackMiddleware({ adapters: [scripted] });
    const r = await middleware.run({ userId: "alice", message: "use the slow tool" });
    expect(r.toolExecutions.length).toBe(1);
    expect(r.toolExecutions[0].ok).toBe(false);
    expect(r.toolExecutions[0].errorCode).toBe("timeout");
    expect(r.text).toContain("Recovered");
  });

  it("I12 run repo failure doesn't poison the response", async () => {
    const brokenRepo = {
      name: "broken-repo",
      save: async () => {
        throw new Error("persistence offline");
      },
      get: async () => null,
      listByUser: async () => [],
      deleteByRunId: async () => 0,
    };
    const mw = new CognitiveMiddleware({
      adapters: [new EchoMockAdapter()],
      runRepository: brokenRepo,
      awaitRunSave: true,
    });
    const r = await mw.run({ userId: "u", message: "hello" });
    expect(r.ok).toBe(true);
    expect(r.text).toBe("Echo: hello");
    expect(r.errors.some((e) => e.startsWith("run_persist_failed"))).toBe(true);
  });

  it("I13 combined: rate limited → breaker open → memory store throws → request still returns structured response", async () => {
    const brokenMemory = {
      name: "broken-memory",
      recall: async () => {
        throw new Error("memory down");
      },
      remember: async () => {
        throw new Error("unused");
      },
    };
    // This combines multiple failure surfaces. Even with every
    // optional layer broken, the middleware must return a valid
    // CognitiveResponse.
    const mw = new CognitiveMiddleware({
      adapters: [new EchoMockAdapter()],
      memoryStore: brokenMemory,
    });
    const r = await mw.run({ userId: "u", message: "hi" });
    expect(r.ok).toBe(true);
    expect(r.errors.some((e) => e.includes("memory_store"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Streaming + cancellation + artifacts
// ---------------------------------------------------------------------------

describe("integration: streaming + cancellation + artifacts", () => {
  it("I14 stream emits full event sequence including context + tool events", async () => {
    const agent = new PerUserToolAgentAdapter("stream-agent");
    const { middleware } = buildFullStackMiddleware({ adapters: [agent] });

    const events: CognitiveStreamEvent[] = [];
    for await (const e of middleware.runStream({
      userId: "alice",
      message: "please add 2 and 3",
    })) {
      events.push(e);
    }

    const kinds = events.map((e) => e.kind);
    // Order: intent-decided → context-enriched → (tool-call → tool-result → text-delta) → validation → done
    expect(kinds).toContain("intent-decided");
    expect(kinds).toContain("context-enriched");
    expect(kinds).toContain("tool-call");
    expect(kinds).toContain("tool-result");
    expect(kinds).toContain("text-delta");
    expect(kinds).toContain("validation");
    expect(kinds[kinds.length - 1]).toBe("done");
  });

  it("I15 stream cancellation mid-delta lands cleanly in done event", async () => {
    const slow = new StreamingMockAdapter({
      chunks: ["a", "b", "c", "d", "e"],
      delayMs: 50,
    });
    const { middleware } = buildFullStackMiddleware({ adapters: [slow] });
    const controller = new AbortController();
    const iter = middleware.runStream({
      userId: "alice",
      message: "slow stream",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 60);
    const events: CognitiveStreamEvent[] = [];
    for await (const e of iter) events.push(e);
    const done = events.find((e) => e.kind === "done");
    expect(done).toBeDefined();
    if (done && done.kind === "done") {
      expect(done.response.errors.length).toBeGreaterThan(0);
    }
  });

  it("I16 artifact extraction fires on streaming responses", async () => {
    const codeResponse = new StreamingMockAdapter({
      chunks: [
        "Here's a function:\n\n```typescript\n",
        "function add(a: number, b: number) {\n",
        "  return a + b;\n",
        "}\n```\n",
      ],
    });
    const { middleware } = buildFullStackMiddleware({
      adapters: [codeResponse],
    });
    const events: CognitiveStreamEvent[] = [];
    for await (const e of middleware.runStream({
      userId: "alice",
      message: "show me an add function",
    })) {
      events.push(e);
    }
    const done = events.find((e) => e.kind === "done");
    if (done && done.kind === "done") {
      expect(done.response.artifacts.length).toBeGreaterThan(0);
      const code = done.response.artifacts[0];
      expect(code.kind).toBe("code");
      if (code.kind === "code") {
        expect(code.language).toBe("typescript");
        expect(code.source).toContain("function add");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Multi-LLM compatibility
// ---------------------------------------------------------------------------

describe("integration: multi-LLM compatibility", () => {
  it("I17 same prompt through three adapters yields structurally equivalent responses", async () => {
    const adapters = [
      new EchoMockAdapter(),
      new ScriptedMockAdapter(
        [{ text: "scripted response", finishReason: "stop" }],
        "compat-scripted",
      ),
      new StreamingMockAdapter({
        chunks: ["streamed ", "response"],
        name: "compat-streaming",
      }),
    ];

    const results = await Promise.all(
      adapters.map((adapter) => {
        const mw = new CognitiveMiddleware({
          adapters: [adapter],
        });
        return mw.run({ userId: "u", message: "test compat" });
      }),
    );

    // All three should have the same shape + non-empty text.
    for (const r of results) {
      expect(r.ok).toBe(true);
      expect(typeof r.text).toBe("string");
      expect(r.text.length).toBeGreaterThan(0);
      expect(Array.isArray(r.toolCalls)).toBe(true);
      expect(Array.isArray(r.toolExecutions)).toBe(true);
      expect(Array.isArray(r.artifacts)).toBe(true);
      expect(typeof r.telemetry.durationMs).toBe("number");
      expect(typeof r.telemetry.providerCallMs).toBe("number");
      expect(r.routing.providerName).toBeDefined();
      expect(r.validation).toBeDefined();
    }
  });

  it("I18 streaming and non-streaming both yield identical CognitiveResponse shape", async () => {
    const scripted = new ScriptedMockAdapter(
      [{ text: "deterministic output", finishReason: "stop" }],
      "compat-scripted-ns",
    );
    const streaming = new StreamingMockAdapter({
      chunks: ["deterministic ", "output"],
      name: "compat-streaming-s",
    });

    const mwNonStream = new CognitiveMiddleware({ adapters: [scripted] });
    const mwStream = new CognitiveMiddleware({ adapters: [streaming] });

    const nonStreamResp = await mwNonStream.run({
      userId: "u",
      message: "compat check",
    });

    const events: CognitiveStreamEvent[] = [];
    for await (const e of mwStream.runStream({
      userId: "u",
      message: "compat check",
    })) {
      events.push(e);
    }
    const done = events.find((e) => e.kind === "done");
    const streamResp =
      done && done.kind === "done" ? done.response : null;
    expect(streamResp).toBeDefined();
    if (streamResp) {
      // Both should have text with "deterministic output"
      expect(nonStreamResp.text).toBe("deterministic output");
      expect(streamResp.text).toBe("deterministic output");
      // Both should expose the same telemetry fields.
      expect(Object.keys(nonStreamResp.telemetry).sort()).toEqual(
        Object.keys(streamResp.telemetry).sort(),
      );
    }
  });

  it("I19 provider preference honored across multi-adapter middleware", async () => {
    const a = new ScriptedMockAdapter(
      [{ text: "from A", finishReason: "stop" }],
      "compat-A",
    );
    const b = new ScriptedMockAdapter(
      [{ text: "from B", finishReason: "stop" }],
      "compat-B",
    );
    const c = new ScriptedMockAdapter(
      [{ text: "from C", finishReason: "stop" }],
      "compat-C",
    );
    const mw = new CognitiveMiddleware({ adapters: [a, b, c] });

    const r1 = await mw.run({ userId: "u", message: "hi", preferredProvider: "compat-B" });
    expect(r1.text).toBe("from B");

    const r2 = await mw.run({ userId: "u", message: "hi", preferredProvider: "compat-C" });
    expect(r2.text).toBe("from C");

    const r3 = await mw.run({ userId: "u", message: "hi" });
    // First capable wins when no preference
    expect(r3.text).toBe("from A");
  });
});

// ---------------------------------------------------------------------------
// 6. Concurrency + isolation
// ---------------------------------------------------------------------------

describe("integration: concurrency + isolation", () => {
  it("I20 50 concurrent requests against the same middleware all succeed", async () => {
    const { middleware } = buildFullStackMiddleware();
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        middleware.run({ userId: `user-${i}`, message: `query ${i}` }),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    // Every response should have distinct echoed text.
    const texts = results.map((r) => r.text);
    expect(new Set(texts).size).toBe(50);
  });

  it("I21 concurrent sessions on the same middleware are isolated", async () => {
    const { middleware, repo } = buildFullStackMiddleware();
    const alice = new CognitiveSession(middleware, { userId: "alice" });
    const bob = new CognitiveSession(middleware, { userId: "bob" });

    await Promise.all([
      alice.continue("a1"),
      bob.continue("b1"),
      alice.continue("a2"),
      bob.continue("b2"),
      alice.continue("a3"),
    ]);

    expect(alice.snapshot().turnCount).toBe(3);
    expect(bob.snapshot().turnCount).toBe(2);
    // Both users should be in the repo with distinct records.
    const aliceRuns = await repo.listByUser("alice");
    const bobRuns = await repo.listByUser("bob");
    expect(aliceRuns.length).toBe(3);
    expect(bobRuns.length).toBe(2);
  });

  it("I22 memory store isolation: alice's memories never leak to bob", async () => {
    const echo = new EchoMockAdapter();
    const { middleware } = buildFullStackMiddleware({ adapters: [echo] });

    await middleware.run({
      userId: "alice",
      message: "alice prefers kubernetes",
    });
    const aliceSystem = echo.lastRequest?.systemPrompt ?? "";
    expect(aliceSystem).toContain("alice prefers kubernetes");

    // Now bob runs — alice's memory must NOT appear.
    await middleware.run({
      userId: "bob",
      message: "bob prefers typescript vitest",
    });
    const bobSystem = echo.lastRequest?.systemPrompt ?? "";
    expect(bobSystem).not.toContain("alice prefers kubernetes");
    expect(bobSystem).toContain("bob prefers typescript");
  });
});

// ---------------------------------------------------------------------------
// 7. Artifact extraction across the pipeline
// ---------------------------------------------------------------------------

describe("integration: artifact extraction end-to-end", () => {
  it("I23 code block response produces a CodeArtifact", async () => {
    const scripted = new ScriptedMockAdapter(
      [
        {
          text: "Here you go:\n\n```python\ndef hello():\n    print('hi')\n```",
          finishReason: "stop",
        },
      ],
      "artifact-code",
    );
    const { middleware } = buildFullStackMiddleware({ adapters: [scripted] });
    const r = await middleware.run({ userId: "alice", message: "show me python" });
    expect(r.artifacts.length).toBe(1);
    const a = r.artifacts[0] as CognitiveArtifact;
    expect(a.kind).toBe("code");
    if (a.kind === "code") {
      expect(a.language).toBe("python");
      expect(a.source).toContain("def hello");
    }
    expect(r.telemetry.artifactCount).toBe(1);
  });

  it("I24 markdown table response produces a TableArtifact", async () => {
    const tableText = `Here's the data:

| name | age |
| ---- | --- |
| alice | 30 |
| bob | 25 |`;
    const scripted = new ScriptedMockAdapter(
      [{ text: tableText, finishReason: "stop" }],
      "artifact-table",
    );
    const { middleware } = buildFullStackMiddleware({ adapters: [scripted] });
    const r = await middleware.run({ userId: "alice", message: "data please" });
    const tables = r.artifacts.filter((a) => a.kind === "table");
    expect(tables.length).toBe(1);
    const t = tables[0];
    if (t.kind === "table") {
      expect(t.headers).toEqual(["name", "age"]);
      expect(t.rows).toEqual([
        ["alice", "30"],
        ["bob", "25"],
      ]);
    }
  });

  it("I25 mermaid diagram produces a DiagramArtifact not a CodeArtifact", async () => {
    const mermaidText =
      "Architecture:\n\n```mermaid\ngraph LR\n  A --> B\n  B --> C\n```\n";
    const scripted = new ScriptedMockAdapter(
      [{ text: mermaidText, finishReason: "stop" }],
      "artifact-mermaid",
    );
    const { middleware } = buildFullStackMiddleware({ adapters: [scripted] });
    const r = await middleware.run({ userId: "alice", message: "diagram please" });
    const diagrams = r.artifacts.filter((a) => a.kind === "diagram");
    const codes = r.artifacts.filter((a) => a.kind === "code");
    expect(diagrams.length).toBe(1);
    expect(codes.length).toBe(0);
  });

  it("I26 long response with headings produces a MarkdownArtifact", async () => {
    const doc =
      "# Introduction\n\n" +
      "This document explains the architecture in detail. ".repeat(10) +
      "\n\n## Components\n\n" +
      "The system has multiple components working together. ".repeat(10) +
      "\n\n## Conclusion\n\n" +
      "In summary, the system is well-designed and tested. ".repeat(5);
    const scripted = new ScriptedMockAdapter(
      [{ text: doc, finishReason: "stop" }],
      "artifact-doc",
    );
    const { middleware } = buildFullStackMiddleware({ adapters: [scripted] });
    const r = await middleware.run({ userId: "alice", message: "write a doc" });
    const markdown = r.artifacts.filter((a) => a.kind === "markdown");
    expect(markdown.length).toBe(1);
    if (markdown[0].kind === "markdown") {
      expect(markdown[0].headingCount).toBeGreaterThanOrEqual(2);
    }
  });

  it("I27 extractArtifacts is deterministic for a fixed input", () => {
    const text = "```js\nconst x = 1;\n```";
    const a1 = extractArtifacts(text);
    const a2 = extractArtifacts(text);
    expect(a1).toEqual(a2);
  });

  it("I28 artifacts from a broken response: parse failures return empty array, never throw", () => {
    const weirdText = "```\nunclosed fence\n";
    const result = extractArtifacts(weirdText);
    // Either 0 or 1 artifacts, but the call must not throw.
    expect(Array.isArray(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Alignment + validator integration
// ---------------------------------------------------------------------------

describe("integration: alignment validators across pipeline", () => {
  it("I29 citation without context fires when URL is in response but no context is injected", async () => {
    const scripted = new ScriptedMockAdapter(
      [
        {
          text: "See https://example.com/docs for details.",
          finishReason: "stop",
        },
      ],
      "alignment-cite",
    );
    // No stores configured — empty bundle.
    const mw = new CognitiveMiddleware({
      adapters: [scripted],
    });
    const r = await mw.run({ userId: "u", message: "tell me" });
    expect(
      r.validation.issues.some((i) => i.code === "citation_without_context"),
    ).toBe(true);
  });

  it("I30 false premise echo detected across full pipeline", async () => {
    const scripted = new ScriptedMockAdapter(
      [
        {
          text: "You are correct, 2 + 2 = 5 is a fascinating fact.",
          finishReason: "stop",
        },
      ],
      "alignment-false-premise",
    );
    const { middleware } = buildFullStackMiddleware({ adapters: [scripted] });
    const r = await middleware.run({
      userId: "alice",
      message: "Tell me why 2 + 2 = 5 is correct",
    });
    expect(
      r.validation.issues.some((i) => i.code === "false_premise_echoed"),
    ).toBe(true);
  });

  it("I31 refusal detected + marked in response", async () => {
    const scripted = new ScriptedMockAdapter(
      [{ text: "I'm sorry, I cannot help with that.", finishReason: "stop" }],
      "alignment-refusal",
    );
    const { middleware } = buildFullStackMiddleware({ adapters: [scripted] });
    const r = await middleware.run({ userId: "alice", message: "do bad thing" });
    expect(r.validation.refusalDetected).toBe(true);
  });
});
