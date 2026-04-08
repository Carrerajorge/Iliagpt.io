/**
 * REST API for Claude Managed Agents.
 *
 * Mount: app.use("/api/managed-agents", createManagedAgentRouter())
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { createLogger } from "../utils/logger";
import {
  createAgent,
  listAgents,
  getAgent,
  archiveAgent,
  createEnvironment,
  listEnvironments,
  createSession,
  getSession,
  listSessions,
  deleteSession,
  sendMessage,
  interruptSession,
  listEvents,
  streamEvents,
  provisionPreset,
  startPresetSession,
  MANAGED_AGENT_PRESETS,
  type ManagedAgentConfig,
  type ManagedEnvironmentConfig,
} from "../agents/managedAgentService";

const log = createLogger("managed-agent-router");

export function createManagedAgentRouter(): Router {
  const router = Router();

  // All routes require authentication
  router.use(requireAuth);

  // -----------------------------------------------------------------------
  // Presets
  // -----------------------------------------------------------------------

  /** List available agent presets (no Anthropic API call). */
  router.get("/presets", (_req: Request, res: Response) => {
    res.json({
      presets: MANAGED_AGENT_PRESETS.map((p) => ({
        key: p.key,
        name: p.name,
        description: p.description,
        icon: p.icon,
        model: p.config.model,
      })),
    });
  });

  /** Provision a preset (creates agent + environment on Anthropic). */
  router.post("/presets/:key/provision", async (req: Request, res: Response) => {
    try {
      const { key } = req.params;
      const result = await provisionPreset(key);
      res.json(result);
    } catch (err: any) {
      log.error("Provision preset failed", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * One-shot: provision preset → create session → send message → stream SSE.
   * The client receives events via Server-Sent Events.
   */
  router.post("/presets/:key/run", async (req: Request, res: Response) => {
    try {
      const { key } = req.params;
      const { message, title } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "message is required" });
      }

      const { sessionId, agentId, environmentId, sseStream } = await startPresetSession(
        key,
        message,
        title,
      );

      // Set SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Session-Id": sessionId,
        "X-Agent-Id": agentId,
        ...(environmentId ? { "X-Environment-Id": environmentId } : {}),
      });

      // Send metadata as first event
      res.write(
        `data: ${JSON.stringify({ type: "meta", sessionId, agentId, environmentId })}\n\n`,
      );

      // Pipe the Anthropic SSE stream to the client
      await pipeSSEStream(sseStream, res);
    } catch (err: any) {
      log.error("Preset run failed", { error: err.message });
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      } else {
        res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
        res.end();
      }
    }
  });

  // -----------------------------------------------------------------------
  // Agents CRUD
  // -----------------------------------------------------------------------

  router.post("/agents", async (req: Request, res: Response) => {
    try {
      const config: ManagedAgentConfig = req.body;
      const agent = await createAgent(config);
      res.status(201).json(agent);
    } catch (err: any) {
      log.error("Create agent failed", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/agents", async (_req: Request, res: Response) => {
    try {
      const agents = await listAgents();
      res.json(agents);
    } catch (err: any) {
      log.error("List agents failed", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/agents/:id", async (req: Request, res: Response) => {
    try {
      const agent = await getAgent(req.params.id);
      res.json(agent);
    } catch (err: any) {
      log.error("Get agent failed", { error: err.message });
      res.status(404).json({ error: err.message });
    }
  });

  router.post("/agents/:id/archive", async (req: Request, res: Response) => {
    try {
      const result = await archiveAgent(req.params.id);
      res.json(result);
    } catch (err: any) {
      log.error("Archive agent failed", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // -----------------------------------------------------------------------
  // Environments CRUD
  // -----------------------------------------------------------------------

  router.post("/environments", async (req: Request, res: Response) => {
    try {
      const config: ManagedEnvironmentConfig = req.body;
      const environment = await createEnvironment(config);
      res.status(201).json(environment);
    } catch (err: any) {
      log.error("Create environment failed", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/environments", async (_req: Request, res: Response) => {
    try {
      const environments = await listEnvironments();
      res.json(environments);
    } catch (err: any) {
      log.error("List environments failed", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // -----------------------------------------------------------------------
  // Sessions CRUD
  // -----------------------------------------------------------------------

  router.post("/sessions", async (req: Request, res: Response) => {
    try {
      const { agentId, environmentId, title, metadata } = req.body;
      if (!agentId) return res.status(400).json({ error: "agentId is required" });
      const session = await createSession({ agentId, environmentId, title, metadata });
      res.status(201).json(session);
    } catch (err: any) {
      log.error("Create session failed", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/sessions", async (req: Request, res: Response) => {
    try {
      const agentId = req.query.agent_id as string | undefined;
      const sessions = await listSessions(agentId);
      res.json(sessions);
    } catch (err: any) {
      log.error("List sessions failed", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/sessions/:id", async (req: Request, res: Response) => {
    try {
      const session = await getSession(req.params.id);
      res.json(session);
    } catch (err: any) {
      log.error("Get session failed", { error: err.message });
      res.status(404).json({ error: err.message });
    }
  });

  router.delete("/sessions/:id", async (req: Request, res: Response) => {
    try {
      const result = await deleteSession(req.params.id);
      res.json(result);
    } catch (err: any) {
      log.error("Delete session failed", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // -----------------------------------------------------------------------
  // Events — send, list, stream
  // -----------------------------------------------------------------------

  /** Send a user message to a session. */
  router.post("/sessions/:id/message", async (req: Request, res: Response) => {
    try {
      const { message } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "message is required" });
      }
      const result = await sendMessage(req.params.id, message);
      res.json(result);
    } catch (err: any) {
      log.error("Send message failed", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /** Interrupt a running session. */
  router.post("/sessions/:id/interrupt", async (req: Request, res: Response) => {
    try {
      const result = await interruptSession(req.params.id);
      res.json(result);
    } catch (err: any) {
      log.error("Interrupt session failed", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /** List past events for a session. */
  router.get("/sessions/:id/events", async (req: Request, res: Response) => {
    try {
      const events = await listEvents(req.params.id);
      res.json(events);
    } catch (err: any) {
      log.error("List events failed", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Stream session events via SSE.
   * Opens a persistent connection and proxies events from Anthropic.
   */
  router.get("/sessions/:id/stream", async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.id;
      const abortController = new AbortController();

      req.on("close", () => abortController.abort());

      const upstream = await streamEvents(sessionId, abortController.signal);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      await pipeSSEStream(upstream, res);
    } catch (err: any) {
      log.error("Stream events failed", { error: err.message });
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      } else {
        res.end();
      }
    }
  });

  /**
   * Combined: send message + stream response.
   * Convenient for the chat interface — one POST that returns SSE.
   */
  router.post("/sessions/:id/chat", async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.id;
      const { message } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "message is required" });
      }

      const abortController = new AbortController();
      req.on("close", () => abortController.abort());

      // Open SSE stream first to capture all events
      const upstream = await streamEvents(sessionId, abortController.signal);

      // Set SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      // Send the message (fire-and-forget relative to stream)
      sendMessage(sessionId, message).catch((err) => {
        log.error("Send message during chat failed", { error: err.message });
        res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
      });

      await pipeSSEStream(upstream, res);
    } catch (err: any) {
      log.error("Chat stream failed", { error: err.message });
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      } else {
        res.end();
      }
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pipes an upstream SSE Response (from Anthropic) to an Express Response.
 * Reads the body as text chunks and forwards them verbatim.
 */
async function pipeSSEStream(upstream: globalThis.Response, res: Response): Promise<void> {
  const reader = upstream.body?.getReader();
  if (!reader) {
    res.write(`data: ${JSON.stringify({ type: "error", error: "No stream body" })}\n\n`);
    res.end();
    return;
  }

  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);

      // Check for terminal session events to know when to close
      if (
        chunk.includes('"session.status_idle"') ||
        chunk.includes('"session.status_terminated"') ||
        chunk.includes('"session.deleted"')
      ) {
        // Give a small delay for any final events, then close
        await new Promise((resolve) => setTimeout(resolve, 100));
        break;
      }
    }
  } catch (err: any) {
    if (err.name !== "AbortError") {
      log.error("SSE pipe error", { error: err.message });
      res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
    }
  } finally {
    reader.releaseLock();
    res.end();
  }
}
