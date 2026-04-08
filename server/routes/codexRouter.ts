/**
 * Codex VC Router — API for the coding agent system.
 */

import { Router, type Request, type Response } from "express";
import { getUserId } from "../types/express";
import { listTemplates } from "../codex/templates";

export function createCodexRouter(): Router {
  const router = Router();

  // Lazy import to avoid circular deps at startup
  const getEngine = async () => {
    return await import("../codex/codexEngine");
  };

  // List available templates
  router.get("/templates", (_req: Request, res: Response) => {
    return res.json({ templates: listTemplates() });
  });

  // Create a new codex session
  router.post("/create", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    const { projectName, instruction, templateId } = req.body;
    if (!projectName || !instruction) {
      return res.status(400).json({ error: "projectName and instruction required" });
    }

    try {
      const engine = await getEngine();
      const session = await engine.createSession(
        userId,
        projectName,
        instruction,
        templateId,
      );
      return res.status(201).json({ session });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Failed to create session" });
    }
  });

  // Send instruction to agent (SSE stream)
  router.post("/:sessionId/instruction", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    const { instruction } = req.body;
    if (!instruction) return res.status(400).json({ error: "instruction required" });

    const engine = await getEngine();
    const session = engine.getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.userId !== userId) return res.status(403).json({ error: "Not your session" });

    // SSE streaming
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    try {
      for await (const step of engine.executeInstruction(req.params.sessionId, instruction)) {
        res.write(`event: step\ndata: ${JSON.stringify(step)}\n\n`);
        if (typeof (res as any).flush === "function") (res as any).flush();
      }
      res.write(`event: done\ndata: ${JSON.stringify({ sessionId: req.params.sessionId })}\n\n`);
    } catch (err: any) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err?.message })}\n\n`);
    }

    res.end();
  });

  // Get file tree
  router.get("/:sessionId/files", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    const engine = await getEngine();
    const session = engine.getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });

    try {
      const files = await engine.listFiles(req.params.sessionId);
      return res.json({ files });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message });
    }
  });

  // Read a file
  router.get("/:sessionId/file", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: "path query param required" });

    const engine = await getEngine();
    try {
      const content = await engine.readFile(req.params.sessionId, filePath);
      return res.json({ path: filePath, content });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message });
    }
  });

  // Write/update a file (user edit)
  router.put("/:sessionId/file", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) {
      return res.status(400).json({ error: "path and content required" });
    }

    const engine = await getEngine();
    try {
      await engine.writeFile(req.params.sessionId, filePath, content);
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message });
    }
  });

  // Execute terminal command
  router.post("/:sessionId/terminal", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    const { command } = req.body;
    if (!command) return res.status(400).json({ error: "command required" });

    const engine = await getEngine();
    try {
      const result = await engine.runCommand(req.params.sessionId, command);
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message });
    }
  });

  // Close session and cleanup
  router.delete("/:sessionId", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    const engine = await getEngine();
    try {
      await engine.closeSession(req.params.sessionId);
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message });
    }
  });

  // List user's sessions
  router.get("/", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    const engine = await getEngine();
    const sessions = engine.listSessions(userId);
    return res.json({ sessions });
  });

  return router;
}
