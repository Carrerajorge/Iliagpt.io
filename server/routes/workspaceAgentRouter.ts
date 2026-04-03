import { Router, Request, Response } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { executeAgentLoop, type AgentExecutorOptions } from "../agent/agentExecutor";
import { type RequestSpec, QualityConstraintsSchema } from "../agent/requestSpec";

const WorkspaceMessageSchema = z.object({
  threadId: z.string().optional(),
  message: z.string().min(1).max(10000),
  projectType: z.string().optional(),
  projectName: z.string().optional(),
  context: z.object({
    files: z.array(z.string()).optional(),
    preview: z.string().optional(),
  }).optional(),
});

interface WorkspaceThread {
  id: string;
  ownerId: string;
  projectType: string;
  projectName: string;
  messages: Array<{ role: string; content: string; timestamp: number; toolCalls?: any[] }>;
  createdAt: number;
  updatedAt: number;
  status: "active" | "completed" | "error";
  title: string;
}

const MAX_THREADS_PER_USER = 50;
const MAX_MESSAGES_PER_THREAD = 200;

const threads = new Map<string, WorkspaceThread>();

function generateThreadTitle(message: string): string {
  const cleaned = message.replace(/[#*_`]/g, "").trim();
  if (cleaned.length <= 50) return cleaned;
  return cleaned.substring(0, 47) + "...";
}

function extractUserId(req: Request): string {
  const sessionUser = (req as any).user?.id;
  if (sessionUser) return sessionUser;
  const headerUser = req.headers["x-user-id"];
  if (typeof headerUser === "string" && headerUser.length > 0) return headerUser;
  return "local-user";
}

export function createWorkspaceAgentRouter(): Router {
  const router = Router();

  router.get("/threads", (req: Request, res: Response) => {
    const userId = extractUserId(req);
    const userThreads = Array.from(threads.values())
      .filter(t => t.ownerId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(t => ({
        id: t.id,
        title: t.title,
        projectType: t.projectType,
        projectName: t.projectName,
        status: t.status,
        messageCount: t.messages.length,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        lastMessage: t.messages[t.messages.length - 1]?.content?.substring(0, 100),
      }));

    res.json({ success: true, data: userThreads });
  });

  router.get("/threads/:threadId", (req: Request, res: Response) => {
    const userId = extractUserId(req);
    const thread = threads.get(req.params.threadId);
    if (!thread || thread.ownerId !== userId) {
      return res.status(404).json({ success: false, error: "Thread not found" });
    }
    res.json({ success: true, data: thread });
  });

  router.delete("/threads/:threadId", (req: Request, res: Response) => {
    const userId = extractUserId(req);
    const thread = threads.get(req.params.threadId);
    if (!thread || thread.ownerId !== userId) {
      return res.status(404).json({ success: false, error: "Thread not found" });
    }
    threads.delete(req.params.threadId);
    res.json({ success: true, deleted: true });
  });

  router.post("/chat", async (req: Request, res: Response) => {
    const userId = extractUserId(req);

    try {
      const body = WorkspaceMessageSchema.parse(req.body);

      let threadId = body.threadId;
      let thread: WorkspaceThread;

      if (threadId && threads.has(threadId)) {
        thread = threads.get(threadId)!;
        if (thread.ownerId !== userId) {
          return res.status(403).json({ success: false, error: "Access denied" });
        }
      } else {
        const userThreadCount = Array.from(threads.values()).filter(t => t.ownerId === userId).length;
        if (userThreadCount >= MAX_THREADS_PER_USER) {
          return res.status(429).json({ success: false, error: "Thread limit reached" });
        }

        threadId = `ws_${randomUUID().replace(/-/g, "").substring(0, 12)}`;
        thread = {
          id: threadId,
          ownerId: userId,
          projectType: body.projectType || "website",
          projectName: body.projectName || "Project",
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: "active",
          title: generateThreadTitle(body.message),
        };
        threads.set(threadId, thread);
      }

      if (thread.messages.length >= MAX_MESSAGES_PER_THREAD) {
        return res.status(429).json({ success: false, error: "Thread message limit reached" });
      }

      thread.messages.push({
        role: "user",
        content: body.message,
        timestamp: Date.now(),
      });
      thread.updatedAt = Date.now();

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      let aborted = false;
      req.on("close", () => { aborted = true; });

      const writeSse = (event: string, data: any) => {
        if (aborted) return;
        try {
          const r = res as any;
          if (r.writableEnded || r.destroyed) return;
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          if (typeof r.flush === "function") r.flush();
        } catch {}
      };

      writeSse("thread_info", { threadId, title: thread.title, messageCount: thread.messages.length });

      const systemPrompt = buildWorkspaceSystemPrompt(body.projectType || "website", body.projectName || "Project", body.context);

      const messages: Array<{ role: string; content: string }> = [
        { role: "system", content: systemPrompt },
        ...thread.messages.map(m => ({ role: m.role, content: m.content })),
      ];

      const runId = `wsrun_${randomUUID().replace(/-/g, "").substring(0, 12)}`;

      const requestSpec: RequestSpec = {
        id: randomUUID(),
        chatId: threadId,
        userId,
        rawMessage: body.message,
        intent: "code_generation",
        intentConfidence: 0.9,
        deliverableType: "code",
        targetAgents: ["code"],
        primaryAgent: "code",
        attachments: [],
        constraints: QualityConstraintsSchema.parse({}),
        createdAt: new Date(),
      };

      const options: AgentExecutorOptions = {
        maxIterations: 15,
        timeout: 120000,
        runId,
        userId,
        chatId: threadId,
        requestSpec,
        accessLevel: "trusted",
      };

      try {
        const fullResponse = await executeAgentLoop(messages, res, options);

        thread.messages.push({
          role: "assistant",
          content: fullResponse,
          timestamp: Date.now(),
        });
        thread.updatedAt = Date.now();
      } catch (loopErr: any) {
        console.error(`[WorkspaceAgent] Agent loop error:`, loopErr?.message);
        thread.status = "error";

        writeSse("error", {
          message: loopErr?.message || "Agent execution failed",
          runId,
        });

        thread.messages.push({
          role: "assistant",
          content: `Error: ${loopErr?.message || "Agent execution failed"}`,
          timestamp: Date.now(),
        });
      }

    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: "Invalid request",
          issues: error.issues,
        });
      }
      console.error(`[WorkspaceAgent] Unexpected error:`, error?.message);
      return res.status(500).json({
        success: false,
        error: error?.message || "Internal server error",
      });
    }
  });

  return router;
}

function buildWorkspaceSystemPrompt(projectType: string, projectName: string, context?: { files?: string[]; preview?: string }): string {
  return `You are Codex, an elite AI coding agent inside the IliaGPT workspace.
You are building a ${projectType} project called "${projectName}".

YOUR CAPABILITIES:
- You can read, write, and edit files using tools (read_file, write_file, edit_file)
- You can execute shell commands (bash)
- You can run code (run_code)
- You can search the web for information (web_search)
- You can browse websites (browse_and_act)
- You can analyze data and generate charts
- You have access to the full OpenClaw toolkit

YOUR BEHAVIOR:
1. When the user describes what they want to build, START BUILDING IT IMMEDIATELY
2. Use tools to create files, install dependencies, and set up the project
3. Show your progress as you work - explain what you're doing briefly
4. Write clean, production-quality code
5. After creating/modifying files, summarize what was done
6. If you need clarification, ask specific questions
7. Always prefer action over discussion

PROJECT CONTEXT:
- Type: ${projectType}
- Name: ${projectName}
${context?.files?.length ? `- Existing files: ${context.files.join(", ")}` : "- No existing files yet"}
${context?.preview ? `- Preview URL: ${context.preview}` : ""}

LANGUAGE: Respond in the same language the user uses. Default to Spanish if unclear.`;
}
