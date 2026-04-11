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
  classifyIntent,
  validateOutput,
  type ProviderAdapter,
  type CognitiveIntent,
  type CognitiveStreamEvent,
  type ProviderResponse,
} from "../cognitive";

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

  // Single shared instance — the middleware itself is stateless and
  // re-entrant, so one instance handles every concurrent request.
  const middleware = new CognitiveMiddleware({
    adapters: buildDefaultAdapters(),
    maxRetries: 2,
    timeoutMs: 30_000,
    defaultSystemPrompt: "You are a helpful assistant.",
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
