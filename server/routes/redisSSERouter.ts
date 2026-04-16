/**
 * Redis-backed SSE streaming routes for scalable event fan-out.
 */
import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { redisSSE, isRedisSSEAvailable } from "../lib/redisSSE";
import { z } from "zod";

const router = Router();

const StartChatSchema = z.object({
  message: z.string().min(1).max(10000),
  context: z.record(z.unknown()).optional(),
  model: z.string().optional(),
});

router.get("/stream", async (req: Request, res: Response) => {
  const sessionId = req.query.session_id as string;

  if (!sessionId) {
    return res.status(400).json({ error: "session_id required" });
  }

  if (!isRedisSSEAvailable()) {
    return res.status(503).json({ error: "SSE service unavailable (Redis not connected)" });
  }

  const session = await redisSSE.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  await redisSSE.subscribeSession(sessionId, res);
});

router.post("/start", async (req: Request, res: Response) => {
  try {
    const validation = StartChatSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.message });
    }

    const { message, context, model } = validation.data;
    const sessionId = (req.query.session_id as string) || randomUUID();

    if (!isRedisSSEAvailable()) {
      return res.status(503).json({ error: "SSE service unavailable" });
    }

    await redisSSE.setSession(sessionId, {
      status: "processing",
      context: context || {},
    });

    simulateAgentExecution(sessionId, message, context, model);

    return res.json({
      session_id: sessionId,
      stream_url: `/api/sse/stream?session_id=${sessionId}`,
    });
  } catch (error) {
    console.error("[RedisSSE] Start chat error:", error);
    return res.status(500).json({ error: "Failed to start chat" });
  }
});

router.get("/session/:sessionId", async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  if (!isRedisSSEAvailable()) {
    return res.status(503).json({ error: "Service unavailable" });
  }

  const session = await redisSSE.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  return res.json(session);
});

router.delete("/session/:sessionId", async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  if (!isRedisSSEAvailable()) {
    return res.status(503).json({ error: "Service unavailable" });
  }

  await redisSSE.deleteSession(sessionId);
  return res.json({ deleted: true, session_id: sessionId });
});

router.get("/health", async (_req: Request, res: Response) => {
  const redisOk = isRedisSSEAvailable();
  const totalConnections = redisSSE.getTotalActiveConnections();

  return res.json({
    status: redisOk ? "healthy" : "unhealthy",
    redis: redisOk,
    activeConnections: totalConnections,
  });
});

async function simulateAgentExecution(
  sessionId: string,
  message: string,
  context?: Record<string, unknown>,
  model?: string
): Promise<void> {
  const stages = [
    { name: "parse", description: "Parsing input message" },
    { name: "plan", description: "Planning execution strategy" },
    { name: "execute", description: "Executing agent actions" },
    { name: "synthesize", description: "Synthesizing response" },
  ];

  try {
    for (const stage of stages) {
      await redisSSE.publishTrace(sessionId, {
        event_type: "stage_start",
        stage: stage.name,
        description: stage.description,
        timestamp: new Date().toISOString(),
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      await redisSSE.publishTrace(sessionId, {
        event_type: "stage_complete",
        stage: stage.name,
        timestamp: new Date().toISOString(),
      });
    }

    await redisSSE.publishFinal(sessionId, {
      success: true,
      response: `Processed: ${message.substring(0, 100)}...`,
      model: model || "default",
      context_used: !!context,
    });

    await redisSSE.setSession(sessionId, { status: "completed" });
  } catch (error) {
    await redisSSE.publishError(sessionId, String(error));
    await redisSSE.setSession(sessionId, { status: "error" });
  }
}

export default router;
