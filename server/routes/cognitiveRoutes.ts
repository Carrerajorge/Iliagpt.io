/**
 * Cognitive Middleware — REST surface.
 *
 * Mounts the cognitive middleware as `/api/cognitive/*`. Every
 * endpoint here is provider-agnostic and uses the EchoMockAdapter
 * by default so the route is always available even when no real
 * LLM provider is configured. Production wiring (Claude, OpenAI,
 * Gemini, in-house GPT-3) is the job of a follow-up turn that
 * adds real adapters.
 *
 * Endpoints:
 *
 *   POST /api/cognitive/run            — full pipeline run
 *   POST /api/cognitive/classify       — intent router only
 *   POST /api/cognitive/validate       — output validator only
 *   GET  /api/cognitive/adapters       — list registered adapters
 */

import express, { type Request, type Response, Router } from "express";
import { z } from "zod";
import {
  CognitiveMiddleware,
  EchoMockAdapter,
  ScriptedMockAdapter,
  ToolEmittingMockAdapter,
  StreamingMockAdapter,
  InHouseGptAdapter,
  InMemoryMemoryStore,
  InMemoryDocumentStore,
  InMemoryToolRegistry,
  InMemoryTokenBucketLimiter,
  CircuitBreakerRegistry,
  InMemoryRunRepository,
  buildDefaultCapabilityCatalog,
  CAPABILITY_CATEGORY_LABELS,
  classifyIntent,
  validateOutput,
  type ProviderAdapter,
  type CognitiveIntent,
  type CognitiveStreamEvent,
  type NormalizedProviderRequest,
  type ProviderResponse,
} from "../cognitive";
import {
  buildCapabilityHandlerMap,
  resetCapabilityHandlerStores,
} from "../cognitive/capabilityHandlers";

// ── Schemas ───────────────────────────────────────────────────────────────

const intentEnum = z.enum([
  "chat",
  "qa",
  "rag_search",
  "code_generation",
  "doc_generation",
  "image_generation",
  "data_analysis",
  "tool_call",
  "agent_task",
  "summarization",
  "translation",
  "unknown",
]);

const runRequestSchema = z.object({
  userId: z.string().min(1).max(120).default("anon"),
  conversationId: z.string().max(120).optional(),
  message: z.string().min(1).max(8_000),
  intentHint: intentEnum.optional(),
  preferredProvider: z.string().max(60).optional(),
  maxTokens: z.number().int().min(1).max(8192).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

const classifyRequestSchema = z.object({
  message: z.string().min(1).max(8_000),
  intentHint: intentEnum.optional(),
});

const validateRequestSchema = z.object({
  response: z.object({
    text: z.string(),
    finishReason: z.enum([
      "stop",
      "length",
      "tool_calls",
      "content_filter",
      "error",
      "aborted",
    ]),
    toolCalls: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          args: z.record(z.string(), z.unknown()),
        }),
      )
      .default([]),
    usage: z
      .object({
        promptTokens: z.number().int().nonnegative(),
        completionTokens: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative().optional(),
      })
      .optional(),
  }),
  toolDescriptors: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        inputSchema: z.record(z.string(), z.unknown()),
      }),
    )
    .optional(),
});

// ── SSE helpers ───────────────────────────────────────────────────────────

/**
 * Drop the `kind` field from a stream event before serializing to SSE.
 * The event name already lives in the `event:` header line, so
 * embedding it a second time in the data payload is pure noise.
 */
function stripEventKind(event: CognitiveStreamEvent): Record<string, unknown> {
  const { kind: _kind, ...rest } = event as CognitiveStreamEvent & {
    kind: string;
  };
  void _kind;
  return rest as Record<string, unknown>;
}

// ── Demo tool-loop adapter (Turn D smoke tests) ───────────────────────────

/**
 * Deterministic adapter that drives the Turn D agentic loop through
 * one full tool round trip. Looks at the incoming message history
 * and decides:
 *
 *   • First turn (no "tool" role messages yet) → emit a tool_calls
 *     response that invokes `demo_sum` with a=2, b=3.
 *
 *   • Subsequent turns (there is a "tool" role message) → parse the
 *     tool result and emit a `stop` response containing the sum.
 *
 * Unlike ScriptedMockAdapter, this instance is stateless across
 * calls so every smoke test run starts from the same behavior. It
 * also gracefully handles multiple tool loops because the decision
 * rule is "is there already a tool result in my history".
 */
class DemoToolLoopAdapter implements ProviderAdapter {
  readonly name = "mock-tool-agent";
  readonly capabilities: ReadonlySet<CognitiveIntent> = new Set<CognitiveIntent>([
    "chat",
    "qa",
    "tool_call",
    "data_analysis",
    "agent_task",
    "code_generation",
    "doc_generation",
    "summarization",
    "translation",
    "unknown",
  ]);

  async generate(
    request: NormalizedProviderRequest,
    signal?: AbortSignal,
  ): Promise<ProviderResponse> {
    if (signal?.aborted) {
      return {
        text: "",
        finishReason: "aborted",
        toolCalls: [],
        raw: { error: "aborted before call" },
      };
    }

    const hasToolResult = request.messages.some((m) => m.role === "tool");

    if (!hasToolResult) {
      // First turn — ask the tool registry for a demo sum.
      return {
        text: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: "demo_sum",
            args: { a: 2, b: 3 },
          },
        ],
        usage: { promptTokens: 0, completionTokens: 0 },
      };
    }

    // Second turn — locate the most recent tool message and parse
    // the result the orchestrator serialized into it.
    const lastTool = [...request.messages].reverse().find((m) => m.role === "tool");
    let parsed: unknown = null;
    try {
      parsed = lastTool?.content ? JSON.parse(lastTool.content) : null;
    } catch {
      parsed = null;
    }
    const sum = (parsed as { sum?: number } | null)?.sum ?? "unknown";
    return {
      text: `The demo_sum tool returned ${JSON.stringify(parsed)}. The sum is ${sum}.`,
      finishReason: "stop",
      toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 30 },
    };
  }
}

// ── Artifact demo adapter (Turn H smoke tests) ────────────────────────────

/**
 * Stateless adapter that always returns a response with an
 * embedded fenced TypeScript code block so the Turn H artifact
 * extraction path can be verified end-to-end over HTTP. Unlike
 * ScriptedMockAdapter, there's no cursor so every smoke request
 * sees the same output regardless of test ordering.
 */
class DemoArtifactAdapter implements ProviderAdapter {
  readonly name = "mock-artifact";
  readonly capabilities: ReadonlySet<CognitiveIntent> = new Set<CognitiveIntent>([
    "chat",
    "qa",
    "code_generation",
    "doc_generation",
    "unknown",
  ]);

  async generate(
    _request: NormalizedProviderRequest,
    signal?: AbortSignal,
  ): Promise<ProviderResponse> {
    if (signal?.aborted) {
      return {
        text: "",
        finishReason: "aborted",
        toolCalls: [],
        raw: { error: "aborted before call" },
      };
    }
    return {
      text:
        "Here is a short example:\n\n" +
        "```typescript\n" +
        "function add(a: number, b: number): number {\n" +
        "  return a + b;\n" +
        "}\n" +
        "```\n\n" +
        "You can call it with any two numbers.",
      finishReason: "stop",
      toolCalls: [],
      usage: { promptTokens: 5, completionTokens: 40 },
    };
  }
}

// ── Default adapter set (mock-only until real wiring lands) ───────────────

function buildDefaultAdapters(): ProviderAdapter[] {
  return [
    // Real adapter that runs entirely offline against the in-house
    // GPT-3 implementation. Always available — no API keys, no
    // network. Lives at the front of the priority order so the
    // cognitive layer has at least one real provider out of the box.
    new InHouseGptAdapter(),
    // Mock adapters for tests + demos. Useful when callers explicitly
    // request `preferredProvider: "mock-echo"`.
    new EchoMockAdapter(),
    new ScriptedMockAdapter(
      [
        { text: "scripted reply A", finishReason: "stop" },
        { text: "scripted reply B", finishReason: "stop" },
      ],
      "mock-scripted",
    ),
    new ToolEmittingMockAdapter("noop_tool", { ok: true }),
    // Streaming mock used by /api/cognitive/stream live smoke tests +
    // UI demos. Splits a canned reply into 4 chunks so the SSE
    // consumer gets to see real incremental deltas. Deterministic,
    // no network, no API keys.
    new StreamingMockAdapter({
      chunks: ["hola ", "mundo ", "del ", "streaming"],
      delayMs: 10,
      name: "mock-streaming",
    }),
    // Demo tool-loop adapter (Turn D). Drives the agentic loop end-
    // to-end against the demo tool registry wired into the router.
    new DemoToolLoopAdapter(),
    // Demo artifact adapter (Turn H). Always emits a response with
    // a fenced TypeScript code block so smoke tests can verify
    // the artifact extraction path end-to-end.
    new DemoArtifactAdapter(),
    // NOTE: SmartRouterAdapter is NOT registered here by default.
    // Mounting it requires the heavy llmGateway module which has
    // its own boot dependencies (Redis, env vars). A follow-up
    // turn that introduces a feature flag will toggle it on.
  ];
}

// ── Router ────────────────────────────────────────────────────────────────

export function createCognitiveRouter(): Router {
  const router: Router = express.Router();
  router.use(express.json({ limit: "1mb" }));

  // Default in-memory stores seeded with a tiny demo corpus so the
  // /run and /stream routes exercise the context enrichment layer
  // (Turn C) out of the box. Production wiring replaces these with
  // pgvector-backed implementations without touching the pipeline.
  const demoMemory = new InMemoryMemoryStore({
    seed: [
      {
        id: "seed-demo-1",
        userId: "smoke-demo",
        text: "smoke-demo user prefers Spanish replies and short answers",
        importance: 0.9,
        createdAt: 0,
      },
    ],
  });
  const demoDocs = new InMemoryDocumentStore({
    documents: [
      {
        docId: "demo-handbook",
        title: "Demo Handbook",
        text:
          "Refund policy: refunds are allowed within 30 days of purchase. " +
          "Shipping takes 3 to 5 business days to anywhere worldwide. " +
          "Our support team answers every email within 24 hours.",
      },
    ],
  });

  // Demo tool registry (Turn D). Registers a single deterministic
  // `demo_sum` tool that the `mock-tool-agent` adapter invokes via
  // the agentic loop so live HTTP smoke tests can exercise the
  // full tool-execution path without any external dependencies.
  const demoRegistry = new InMemoryToolRegistry([
    {
      descriptor: {
        name: "demo_sum",
        description: "Return the arithmetic sum of two integers.",
        inputSchema: {
          type: "object",
          properties: {
            a: { type: "number" },
            b: { type: "number" },
          },
          required: ["a", "b"],
        },
      },
      handler: async (args) => {
        const a = Number(args.a ?? 0);
        const b = Number(args.b ?? 0);
        return { sum: a + b };
      },
    },
  ]);

  // Demo rate limiter (Turn E). Generous per-user bucket so normal
  // smoke tests pass. A dedicated throttled middleware with a
  // tiny-capacity limiter is mounted below for rate-limit specific
  // smoke tests.
  const demoLimiter = new InMemoryTokenBucketLimiter({
    name: "demo-limiter",
    capacity: 100,
    refillPerSecond: 10,
  });

  // Demo circuit breaker registry (Turn E). Generous thresholds so
  // normal smoke tests never trip it.
  const demoBreakers = new CircuitBreakerRegistry({
    defaults: { failureThreshold: 3, cooldownMs: 60_000 },
  });

  // Demo run repository (Turn G). In-memory so smoke tests can save
  // + retrieve runs without touching Postgres. Production wiring
  // swaps this for a PostgresRunRepository initialized at boot.
  const demoRunRepo = new InMemoryRunRepository({
    name: "demo-run-repo",
  });

  // Turn I: full capability catalog mounted into the router.
  // Turn J: provides REAL handlers for 20+ capabilities via
  // buildCapabilityHandlerMap(). Each entry with a real handler
  // is auto-promoted from "stub" to "available" inside the catalog
  // builder. Entries without handlers stay as stubs and return
  // a structured `not_implemented` outcome on invoke.
  const demoCapabilityRegistry = buildDefaultCapabilityCatalog({
    handlers: buildCapabilityHandlerMap(),
  });

  // Tiny-bucket limiter for the /throttled-demo route only. Zero
  // refill so the bucket stays drained across smoke test calls
  // and the denial path is deterministic.
  const throttledLimiter = new InMemoryTokenBucketLimiter({
    name: "throttled-demo-limiter",
    capacity: 2,
    refillPerSecond: 0,
  });

  // Second middleware that shares the same adapter set but uses
  // the tiny limiter. Mounted under /throttled-demo/run only.
  const throttledMiddleware = new CognitiveMiddleware({
    adapters: buildDefaultAdapters(),
    defaultSystemPrompt: "You are a helpful assistant.",
    rateLimiter: throttledLimiter,
  });

  // Single shared instance — the middleware itself is stateless and
  // re-entrant, so one instance handles every concurrent request.
  const middleware = new CognitiveMiddleware({
    adapters: buildDefaultAdapters(),
    maxRetries: 2,
    timeoutMs: 30_000,
    defaultSystemPrompt: "You are a helpful assistant.",
    memoryStore: demoMemory,
    documentStore: demoDocs,
    toolRegistry: demoRegistry,
    maxToolIterations: 5,
    rateLimiter: demoLimiter,
    // The default keyFn is `user:${userId}:intent:${intent}` which
    // gives each (user, intent) pair its own bucket. That's the
    // right default but makes it hard to drain a bucket in a smoke
    // test that hits different intents, so we scope smoke tests on
    // the "smoke-rate-limited" userId only.
    circuitBreakers: demoBreakers,
    runRepository: demoRunRepo,
    // Smoke tests need deterministic "save happened before
    // response" semantics so they can GET /runs/:id right after.
    awaitRunSave: true,
    capabilityRegistry: demoCapabilityRegistry,
  });

  // ── POST /api/cognitive/run ───────────────────────────────────────────
  router.post("/run", async (req: Request, res: Response) => {
    const parsed = runRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "invalid_request", issues: parsed.error.issues });
    }
    try {
      // Forward client disconnect → AbortSignal so cancellation
      // propagates all the way through the cognitive pipeline.
      //
      // Important: use `res.on("close")`, NOT `req.on("close")`. In
      // Node 22+ the REQUEST stream's "close" event fires as soon as
      // express.json() finishes reading the body, even though the
      // underlying TCP socket is still open and the client is happily
      // waiting for the response. That race kills slow adapters.
      //
      // The RESPONSE stream's "close" only fires when:
      //   (a) we finished writing the response (writableEnded === true,
      //       so the controller is NOT aborted) OR
      //   (b) the client actually disconnected mid-response
      //       (writableEnded === false, so we DO abort).
      //
      // This matches Express's recommended cancellation pattern in
      // Node 22+ and is consistent with how the existing chat router
      // in this repo handles client disconnects.
      const controller = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      const result = await middleware.run({
        ...parsed.data,
        signal: controller.signal,
      });
      // The middleware never throws — it returns ok=false on error.
      // We always return 200 with the structured response so callers
      // get telemetry + routing decisions on every outcome.
      return res.json(result);
    } catch (caught) {
      // Defensive — if SOMETHING above the middleware crashes
      // (very unlikely), still return a structured error.
      return res.status(500).json({
        error: "cognitive_run_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /api/cognitive/stream ────────────────────────────────────────
  //
  // Streaming twin of /run. Emits Server-Sent Events as the pipeline
  // progresses:
  //
  //   event: intent-decided    → { routing }
  //   event: text-delta        → { delta }           (0..N)
  //   event: tool-call         → { toolCall }        (0..N)
  //   event: validation        → { validation }
  //   event: done              → { response }        (terminal)
  //   event: error             → { code, message }   (only on failures)
  //
  // A blank "event: ping" message is written every 15 s to keep
  // proxies from timing out the connection — mirrors the keepalive
  // pattern the rest of the repo uses for its SSE routes.
  router.post("/stream", async (req: Request, res: Response) => {
    const parsed = runRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "invalid_request", issues: parsed.error.issues });
    }

    // SSE headers (mirrors server/realtime/presence.ts + chat SSE).
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // Disable nginx buffering so chunks reach the browser immediately.
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const writeEvent = (event: string, data: unknown): void => {
      // Each SSE message is two framed lines:
      //   event: <name>
      //   data: <json>
      // followed by an empty line as the end-of-message marker.
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        // Socket already closed — nothing to do.
      }
    };

    // Keepalive ping every 15s. Note: SSE comments are lines starting
    // with ":" — consumers ignore them, proxies reset their idle
    // timers on any byte.
    const keepalive = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(keepalive);
      }
    }, 15_000);

    // Wire cancellation. Same Node-22 pattern as /run: use res.on("close")
    // because req.on("close") fires as soon as express.json() finishes
    // reading the body.
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) {
        controller.abort();
      }
    });

    try {
      const stream = middleware.runStream({
        ...parsed.data,
        signal: controller.signal,
      });
      for await (const event of stream) {
        writeEvent(event.kind, stripEventKind(event));
        // Safety: if the consumer already disconnected, stop pulling.
        if (res.writableEnded) break;
      }
    } catch (caught) {
      // The generator is contractually not supposed to throw, but
      // defensive coding keeps the route robust.
      writeEvent("error", {
        code: "stream_threw",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      clearInterval(keepalive);
      try {
        res.end();
      } catch {
        // Already ended.
      }
    }
  });

  // ── POST /api/cognitive/classify ──────────────────────────────────────
  router.post("/classify", (req: Request, res: Response) => {
    const parsed = classifyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "invalid_request", issues: parsed.error.issues });
    }
    try {
      const classification = classifyIntent(
        parsed.data.message,
        parsed.data.intentHint,
      );
      return res.json(classification);
    } catch (caught) {
      return res.status(400).json({
        error: "classify_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /api/cognitive/validate ──────────────────────────────────────
  router.post("/validate", (req: Request, res: Response) => {
    const parsed = validateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "invalid_request", issues: parsed.error.issues });
    }
    try {
      const report = validateOutput(parsed.data.response as ProviderResponse, {
        toolDescriptors: parsed.data.toolDescriptors,
      });
      return res.json(report);
    } catch (caught) {
      return res.status(400).json({
        error: "validate_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /api/cognitive/throttled-demo/run (Turn E) ───────────────────
  //
  // Dedicated endpoint for Turn E rate-limit smoke tests. Uses a
  // tiny-bucket limiter (capacity=2, no refill) so smoke tests can
  // drain the bucket in a few calls and assert the rate_limited
  // response shape deterministically. Does NOT share state with
  // the main /run path.
  router.post("/throttled-demo/run", async (req: Request, res: Response) => {
    const parsed = runRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "invalid_request", issues: parsed.error.issues });
    }
    try {
      const controller = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      const result = await throttledMiddleware.run({
        ...parsed.data,
        signal: controller.signal,
      });
      return res.json(result);
    } catch (caught) {
      return res.status(500).json({
        error: "cognitive_run_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /api/cognitive/throttled-demo/reset (Turn E test helper) ─────
  //
  // Lets smoke tests reset the throttled limiter's buckets between
  // runs so the suite is order-independent. Not exposed through the
  // main router in production.
  router.post("/throttled-demo/reset", (_req: Request, res: Response) => {
    throttledLimiter.resetAll();
    return res.json({ ok: true });
  });

  // ── GET /api/cognitive/test-harness (Turn J) ──────────────────────────
  //
  // Minimal HTML page served to a real browser for Playwright E2E
  // tests. Exposes `window.invokeCapability(id, args, userId)`
  // and `window.listCapabilities()` helpers so test code can run
  // as `page.evaluate(({id, args}) => window.invokeCapability(id, args))`
  // against the browser's own fetch API. This is "navegador real"
  // from the user's spec — chromium executes real JS hitting real
  // routes.
  router.get("/test-harness", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Cognitive Capability Test Harness</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
  <h1 id="status">ready</h1>
  <pre id="last-result"></pre>
  <div id="registry-count"></div>
  <script>
    window.__COGNITIVE_HARNESS__ = true;
    window.invokeCapability = async function(id, args, userId, approvalToken) {
      const body = JSON.stringify({
        userId: userId || 'harness',
        args: args || {},
        approvalToken: approvalToken,
      });
      const res = await fetch('/api/cognitive/capabilities/' + id + '/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
      });
      const json = await res.json();
      document.getElementById('last-result').textContent = JSON.stringify(json).slice(0, 2000);
      document.getElementById('status').textContent = json.ok ? 'ok' : 'err';
      return json;
    };
    window.listCapabilities = async function() {
      const res = await fetch('/api/cognitive/capabilities');
      const json = await res.json();
      document.getElementById('registry-count').textContent = 'count=' + json.totalCount;
      return json;
    };
    window.resetHandlerStores = async function() {
      const res = await fetch('/api/cognitive/test-harness/reset', { method: 'POST' });
      return res.json();
    };
  </script>
</body>
</html>`);
  });

  // ── POST /api/cognitive/test-harness/reset (Turn J) ───────────────────
  //
  // Clears the in-memory capability handler stores (scheduled
  // tasks, projects, dispatch queue) so concurrent Playwright
  // tests don't see each other's state. Mounted on the cognitive
  // route because it's a test-only helper; production would not
  // expose this.
  router.post("/test-harness/reset", (_req: Request, res: Response) => {
    resetCapabilityHandlerStores();
    return res.json({ ok: true });
  });

  // ── GET /api/cognitive/capabilities (Turn I) ──────────────────────────
  //
  // Returns the full capability catalog. UIs render "everything
  // the platform can do" grouped by category. Response shape:
  //   { categories: [{ key, label, count }],
  //     capabilities: [descriptor, ...],
  //     totalCount, availableCount }
  router.get("/capabilities", (_req: Request, res: Response) => {
    try {
      const capabilities = demoCapabilityRegistry.list();
      const categoryCounts = new Map<string, number>();
      for (const c of capabilities) {
        categoryCounts.set(c.category, (categoryCounts.get(c.category) ?? 0) + 1);
      }
      const categories = Array.from(categoryCounts.entries())
        .map(([key, count]) => ({
          key,
          label:
            CAPABILITY_CATEGORY_LABELS[
              key as keyof typeof CAPABILITY_CATEGORY_LABELS
            ] ?? key,
          count,
        }))
        .sort((a, b) => a.key.localeCompare(b.key));
      return res.json({
        categories,
        capabilities,
        totalCount: capabilities.length,
        availableCount: demoCapabilityRegistry.listAvailable().length,
      });
    } catch (caught) {
      return res.status(500).json({
        error: "capability_list_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── POST /api/cognitive/capabilities/:id/invoke (Turn I) ──────────────
  //
  // Invoke a capability by id. Body: { userId, args,
  // approvalToken?, conversationId? }. Returns the full
  // CapabilityInvocation as JSON.
  router.post(
    "/capabilities/:id/invoke",
    async (req: Request, res: Response) => {
      const id = req.params.id;
      const body = (req.body ?? {}) as {
        userId?: string;
        conversationId?: string;
        args?: Record<string, unknown>;
        approvalToken?: string;
      };
      if (!body.userId || typeof body.userId !== "string") {
        return res
          .status(400)
          .json({ error: "invalid_request", message: "userId is required" });
      }
      try {
        const controller = new AbortController();
        res.on("close", () => {
          if (!res.writableEnded) controller.abort();
        });
        const invocation = await middleware.invokeCapability(
          id,
          body.args ?? {},
          {
            userId: body.userId,
            conversationId: body.conversationId,
            signal: controller.signal,
            approvalToken: body.approvalToken,
          },
        );
        return res.json(invocation);
      } catch (caught) {
        return res.status(500).json({
          error: "capability_invoke_failed",
          message: caught instanceof Error ? caught.message : String(caught),
        });
      }
    },
  );

  // ── GET /api/cognitive/runs/:runId (Turn G) ───────────────────────────
  //
  // Fetch a previously-saved run by its runId. Returns 404 if the
  // run doesn't exist.
  router.get("/runs/:runId", async (req: Request, res: Response) => {
    try {
      const record = await demoRunRepo.get(req.params.runId);
      if (!record) {
        return res.status(404).json({ error: "run_not_found" });
      }
      return res.json(record);
    } catch (caught) {
      return res.status(500).json({
        error: "run_fetch_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── GET /api/cognitive/users/:userId/runs (Turn G) ────────────────────
  //
  // List the most recent runs for a user, newest first. Caps at 50.
  router.get("/users/:userId/runs", async (req: Request, res: Response) => {
    try {
      const limit = Number(req.query.limit ?? 50);
      const records = await demoRunRepo.listByUser(
        req.params.userId,
        Number.isFinite(limit) ? limit : 50,
      );
      return res.json({ runs: records, count: records.length });
    } catch (caught) {
      return res.status(500).json({
        error: "run_list_failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });

  // ── GET /api/cognitive/adapters ───────────────────────────────────────
  router.get("/adapters", (_req: Request, res: Response) => {
    return res.json({
      adapters: middleware.listAdapters(),
      // Surface the available intents so UIs can build dropdowns.
      intents: [
        "chat",
        "qa",
        "rag_search",
        "code_generation",
        "doc_generation",
        "image_generation",
        "data_analysis",
        "tool_call",
        "agent_task",
        "summarization",
        "translation",
        "unknown",
      ] as CognitiveIntent[],
    });
  });

  return router;
}
