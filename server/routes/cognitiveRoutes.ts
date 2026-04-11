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
  classifyIntent,
  validateOutput,
  type ProviderAdapter,
  type CognitiveIntent,
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

// ── Default adapter set (mock-only until real wiring lands) ───────────────

function buildDefaultAdapters(): ProviderAdapter[] {
  return [
    new EchoMockAdapter(),
    new ScriptedMockAdapter(
      [
        { text: "scripted reply A", finishReason: "stop" },
        { text: "scripted reply B", finishReason: "stop" },
      ],
      "mock-scripted",
    ),
    new ToolEmittingMockAdapter("noop_tool", { ok: true }),
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
      const controller = new AbortController();
      req.on("close", () => {
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
