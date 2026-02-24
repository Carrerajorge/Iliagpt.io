import { Router } from "express";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import { agentModeRuns, agentModeSteps } from "@shared/schema";
import { agentOrchestrator } from "../agent/orchestrator";
import { agentManager } from "../services/agentManager";
import { guardrails } from "../agent/guardrails";
import { agentQueue } from "../agent/queue/agentQueue";
import { browserSessionManager, SessionEvent } from "../agent/browser";

export function createAgentRouter(broadcastBrowserEvent: (sessionId: string, event: SessionEvent) => void) {
  const router = Router();

  // Legacy agent run endpoints (pre agentModeRuns + SSE event bus).
  // Kept for backwards compatibility but moved under /api/agent-legacy/* to avoid
  // shadowing the canonical /api/agent/* routes (see server/routes/agentRoutes.ts).
  router.post("/agent-legacy/runs", async (req, res) => {
    try {
      let { chatId, message, attachments } = req.body;

      if (!message) {
        return res.status(400).json({ error: "message is required" });
      }

      const runId = randomUUID();
      const userId = "anonymous";

      if (!chatId || chatId.startsWith("pending-") || chatId === "") {
        const newChatId = randomUUID();
        console.log(`[AgentRouter] Creating new chat ${newChatId} for agent run`);
        try {
          await storage.createChat({
            id: newChatId,
            userId: userId,
            title: message.slice(0, 50) + (message.length > 50 ? "..." : ""),
            aiModelUsed: "gemini-2.5-flash"
          });
          chatId = newChatId;
        } catch (chatError: any) {
          console.error(`[AgentRouter] Failed to create chat:`, chatError);
          chatId = newChatId;
        }
      }

      try {
        await db.insert(agentModeRuns).values({
          id: runId,
          chatId: chatId,
          userId: null,
          status: "queued"
        });
      } catch (dbError: any) {
        if (dbError.message?.includes("foreign key constraint")) {
          console.log(`[AgentRouter] Chat ${chatId} not found in DB, creating run in-memory only`);
        } else {
          throw dbError;
        }
      }

      const orchestrator = await agentManager.createRun(
        runId,
        chatId,
        userId,
        message,
        attachments
      );

      // Enqueue for async execution
      if (agentQueue) {
        await agentQueue.add("agent-execution", {
          runId,
          chatId,
          userId,
          message,
          attachments
        });
      } else {
        console.warn("[AgentRouter] AgentQueue not available, execution might be delayed");
      }

      const progress = orchestrator.getProgress();
      const eventStream = orchestrator.getEventStream ? orchestrator.getEventStream() : [];
      const todoList = orchestrator.getTodoList ? orchestrator.getTodoList() : [];
      const workspaceFiles = orchestrator.getWorkspaceFiles ? Object.fromEntries(orchestrator.getWorkspaceFiles()) : {};

      const planWithResponse = progress.plan as any;
      res.json({
        id: progress.runId,
        chatId: chatId,
        status: progress.status,
        plan: progress.plan,
        steps: progress.stepResults.map(s => ({
          stepIndex: s.stepIndex,
          toolName: s.toolName,
          status: s.success ? 'succeeded' : (s.error ? 'failed' : 'pending'),
          output: s.output,
          error: s.error,
          startedAt: s.startedAt ? new Date(s.startedAt).toISOString() : null,
          completedAt: s.completedAt ? new Date(s.completedAt).toISOString() : null
        })),
        artifacts: progress.artifacts,
        eventStream: eventStream,
        todoList: todoList,
        workspaceFiles: workspaceFiles,
        summary: planWithResponse?.conversationalResponse || null,
        error: progress.error || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    } catch (error: any) {
      console.error("Error starting agent run:", error);
      res.status(500).json({ error: error.message || "Failed to start agent run" });
    }
  });

  // Get active runs for a specific chat
  router.get("/agent-legacy/runs/chat/:chatId", async (req, res) => {
    try {
      const { chatId } = req.params;

      // First check in-memory runs
      const activeRuns = agentManager.getActiveRunsForChat(chatId);
      if (activeRuns.length > 0) {
        const latestRun = activeRuns[0];
        const orchestrator = agentManager.getOrchestrator(latestRun.runId);
        const eventStream = orchestrator?.getEventStream ? orchestrator.getEventStream() : [];
        const todoList = orchestrator?.getTodoList ? orchestrator.getTodoList() : [];
        const workspaceFiles = orchestrator?.getWorkspaceFiles ?
          Object.fromEntries(orchestrator.getWorkspaceFiles()) : {};

        return res.json({
          id: latestRun.runId,
          chatId: chatId,
          status: latestRun.status,
          plan: latestRun.plan,
          steps: latestRun.stepResults.map(s => ({
            stepIndex: s.stepIndex,
            toolName: s.toolName,
            status: s.success ? 'succeeded' : (s.error ? 'failed' : 'pending'),
            output: s.output,
            error: s.error,
            startedAt: s.startedAt ? new Date(s.startedAt).toISOString() : null,
            completedAt: s.completedAt ? new Date(s.completedAt).toISOString() : null
          })),
          artifacts: latestRun.artifacts,
          eventStream: eventStream,
          todoList: todoList,
          workspaceFiles: workspaceFiles,
          summary: null,
          error: latestRun.error || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }

      // Fall back to database
      const runs = await storage.getAgentRunsByChatId(chatId);
      if (runs.length === 0) {
        return res.json(null);
      }

      const latestRun = runs[0];
      const steps = await storage.getAgentSteps(latestRun.id);
      const assets = await storage.getAgentAssets(latestRun.id);

      res.json({
        id: latestRun.id,
        chatId: (latestRun as any).conversationId || (latestRun as any).chatId || chatId,
        status: latestRun.status,
        plan: null,
        steps: steps.map((s: any) => ({
          stepIndex: s.stepIndex,
          toolName: s.stepType,
          status: s.success === 'true' ? 'succeeded' : (s.success === 'false' ? 'failed' : 'pending'),
          output: s.result,
          error: s.error
        })),
        artifacts: assets,
        eventStream: [],
        todoList: [],
        workspaceFiles: {},
        summary: (latestRun as any).summary || null,
        error: latestRun.error,
        createdAt: (latestRun as any).createdAt,
        updatedAt: (latestRun as any).updatedAt
      });
    } catch (error: any) {
      console.error("Error fetching runs for chat:", error);
      res.status(500).json({ error: error.message || "Failed to fetch runs" });
    }
  });

  router.get("/agent-legacy/runs/:id", async (req, res) => {
    try {
      const progress = agentManager.getRunStatus(req.params.id);

      if (progress) {
        const orchestrator = agentManager.getOrchestrator(req.params.id);
        const eventStream = orchestrator?.getEventStream ? orchestrator.getEventStream() : [];
        const todoList = orchestrator?.getTodoList ? orchestrator.getTodoList() : [];
        const workspaceFiles = orchestrator?.getWorkspaceFiles ?
          Object.fromEntries(orchestrator.getWorkspaceFiles()) : {};

        // Get summary from orchestrator or conversational response from plan
        const conversationalResponse = (progress.plan as any)?.conversationalResponse;
        const summary = orchestrator?.summary || conversationalResponse || null;

        return res.json({
          id: progress.runId,
          chatId: "",
          status: progress.status,
          plan: progress.plan,
          steps: progress.stepResults.map(s => ({
            stepIndex: s.stepIndex,
            toolName: s.toolName,
            status: s.success ? 'succeeded' : (s.error ? 'failed' : 'pending'),
            output: s.output,
            error: s.error,
            startedAt: s.startedAt ? new Date(s.startedAt).toISOString() : null,
            completedAt: s.completedAt ? new Date(s.completedAt).toISOString() : null
          })),
          artifacts: progress.artifacts,
          eventStream: eventStream,
          todoList: todoList,
          workspaceFiles: workspaceFiles,
          summary: summary,
          error: progress.error || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }

      // Try agentModeRuns first (new table with summary), then fallback to old agentRuns
      const [modeRun] = await db.select().from(agentModeRuns).where(eq(agentModeRuns.id, req.params.id));

      if (modeRun) {
        // Load steps from agentModeSteps table
        const modeSteps = await db.select().from(agentModeSteps)
          .where(eq(agentModeSteps.runId, req.params.id))
          .orderBy(agentModeSteps.stepIndex);

        return res.json({
          id: modeRun.id,
          chatId: modeRun.chatId,
          status: modeRun.status,
          plan: modeRun.plan,
          steps: modeSteps.map(s => ({
            stepIndex: s.stepIndex,
            toolName: s.toolName,
            status: s.status,
            output: s.toolOutput,
            error: s.error,
            startedAt: s.startedAt?.toISOString() || null,
            completedAt: s.completedAt?.toISOString() || null
          })),
          artifacts: modeRun.artifacts || [],
          eventStream: [],
          todoList: [],
          workspaceFiles: {},
          summary: modeRun.summary,
          error: modeRun.error,
          createdAt: modeRun.createdAt?.toISOString() || new Date().toISOString(),
          updatedAt: modeRun.completedAt?.toISOString() || modeRun.startedAt?.toISOString() || modeRun.createdAt?.toISOString()
        });
      }

      const run = await storage.getAgentRun(req.params.id);
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }
      const steps = await storage.getAgentSteps(req.params.id);
      const assets = await storage.getAgentAssets(req.params.id);
      res.json({
        id: run.id,
        chatId: (run as any).conversationId || (run as any).chatId || "",
        status: run.status,
        plan: null,
        steps: steps.map((s: any) => ({
          stepIndex: s.stepIndex,
          toolName: s.stepType,
          status: s.success === 'true' ? 'succeeded' : (s.success === 'false' ? 'failed' : 'pending'),
          output: s.result,
          error: s.error
        })),
        artifacts: assets,
        eventStream: [],
        todoList: [],
        workspaceFiles: {},
        summary: null,
        error: run.error,
        createdAt: (run as any).createdAt,
        updatedAt: (run as any).updatedAt
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to get agent run" });
    }
  });

  router.post("/agent-legacy/runs/:id/cancel", async (req, res) => {
    try {
      let success = await agentManager.cancelRun(req.params.id);
      if (!success) {
        success = agentOrchestrator.cancelRun(req.params.id);
      }
      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Run not found or already completed" });
      }
    } catch (error: any) {
      res.status(500).json({ error: "Failed to cancel run" });
    }
  });

  router.post("/browser/session", async (req, res) => {
    try {
      const { objective, config } = req.body;
      if (!objective) {
        return res.status(400).json({ error: "Objective is required" });
      }

      const sessionId = await browserSessionManager.createSession(
        objective,
        config || {},
        (event: SessionEvent) => {
          broadcastBrowserEvent(event.sessionId, event);
        }
      );

      browserSessionManager.startScreenshotStreaming(sessionId, 1500);

      res.json({ sessionId });
    } catch (error: any) {
      console.error("Error creating browser session:", error);
      res.status(500).json({ error: "Failed to create browser session" });
    }
  });

  router.post("/browser/session/:id/navigate", async (req, res) => {
    try {
      const { url } = req.body;
      const validation = await guardrails.validateAction(req.params.id, "navigate", url);
      if (!validation.allowed) {
        return res.status(403).json({ error: validation.reason, blocked: true });
      }
      const result = await browserSessionManager.navigate(req.params.id, url);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/browser/session/:id/click", async (req, res) => {
    try {
      const { selector } = req.body;
      const validation = await guardrails.validateAction(req.params.id, "click", selector);
      if (!validation.allowed) {
        return res.status(403).json({ error: validation.reason, blocked: true });
      }
      const result = await browserSessionManager.click(req.params.id, selector);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/browser/session/:id/type", async (req, res) => {
    try {
      const { selector, text } = req.body;
      const validation = await guardrails.validateAction(req.params.id, "type", selector, { text });
      if (!validation.allowed) {
        return res.status(403).json({ error: validation.reason, blocked: true });
      }
      const result = await browserSessionManager.type(req.params.id, selector, text);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/browser/session/:id/scroll", async (req, res) => {
    try {
      const { direction, amount } = req.body;
      const validation = await guardrails.validateAction(req.params.id, "scroll", "page");
      if (!validation.allowed) {
        return res.status(403).json({ error: validation.reason, blocked: true });
      }
      const result = await browserSessionManager.scroll(req.params.id, direction, amount);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/browser/session/:id/state", async (req, res) => {
    try {
      const state = await browserSessionManager.getPageState(req.params.id);
      if (!state) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json(state);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/browser/session/:id/screenshot", async (req, res) => {
    try {
      const screenshot = await browserSessionManager.getScreenshot(req.params.id);
      if (!screenshot) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json({ screenshot });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/browser/session/:id", async (req, res) => {
    try {
      const session = browserSessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json(session);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete("/browser/session/:id", async (req, res) => {
    try {
      await browserSessionManager.closeSession(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/browser/session/:id/cancel", async (req, res) => {
    try {
      browserSessionManager.cancelSession(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
