import { Router, Request, Response } from "express";
import { z } from "zod";
import { LangGraphAgent, getDefaultAgent, createAgent, type AgentConfig } from "../agent/langgraph";
import { ALL_TOOLS, SAFE_TOOLS, SYSTEM_TOOLS, getToolsByCategory } from "../agent/langgraph/tools";
import { memoryStore, checkpointer } from "../agent/langgraph/memory";

const RunAgentSchema = z.object({
  message: z.string().min(1),
  threadId: z.string().optional(),
  config: z.object({
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxIterations: z.number().min(1).max(50).optional(),
    timeout: z.number().min(1000).max(300000).optional(),
    includeSystemTools: z.boolean().optional(),
    enableHumanInLoop: z.boolean().optional(),
    verbose: z.boolean().optional(),
  }).optional(),
});

const ResumeApprovalSchema = z.object({
  threadId: z.string(),
  approvalId: z.string(),
  approved: z.boolean(),
});

export function createLangGraphRouter() {
  const router = Router();
  const agentInstances: Map<string, LangGraphAgent> = new Map();

  function getOrCreateAgent(threadId: string, config?: AgentConfig): LangGraphAgent {
    const existingAgent = agentInstances.get(threadId);
    if (existingAgent) return existingAgent;
    
    const agent = createAgent(config || {});
    agentInstances.set(threadId, agent);
    return agent;
  }

  router.post("/langgraph/run", async (req: Request, res: Response) => {
    try {
      const validated = RunAgentSchema.parse(req.body);
      const threadId = validated.threadId || `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const agent = getOrCreateAgent(threadId, validated.config);

      console.log(`[LangGraph] Starting run for thread ${threadId}`);
      const startTime = Date.now();
      
      const result = await agent.run({
        input: validated.message,
        threadId,
        config: validated.config,
      });
      const latencyMs = Date.now() - startTime;

      console.log(`[LangGraph] Run completed in ${latencyMs}ms for thread ${threadId}`);

      res.json({
        success: result.success,
        threadId: result.threadId,
        response: result.response,
        metrics: result.metrics,
        toolsExecuted: result.toolsExecuted,
        error: result.error,
      });
    } catch (error: any) {
      console.error("[LangGraph] Run error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "LangGraph execution failed",
      });
    }
  });

  router.post("/langgraph/stream", async (req: Request, res: Response) => {
    try {
      const validated = RunAgentSchema.parse(req.body);
      const threadId = validated.threadId || `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const agent = getOrCreateAgent(threadId, validated.config);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      res.write(`data: ${JSON.stringify({ type: "start", threadId })}\n\n`);

      const stream = agent.stream({
        input: validated.message,
        threadId,
        config: validated.config,
      });
      
      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify({
          type: chunk.type,
          node: chunk.node,
          content: chunk.content,
          tool: chunk.tool,
          metrics: chunk.metrics,
          timestamp: chunk.timestamp,
        })}\n\n`);
      }

      const history = await agent.getConversationHistory(threadId);
      
      res.write(`data: ${JSON.stringify({ 
        type: "complete",
        threadId,
        messagesCount: history?.messages?.length || 0,
      })}\n\n`);
      
      res.end();
    } catch (error: any) {
      console.error("[LangGraph] Stream error:", error);
      res.write(`data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`);
      res.end();
    }
  });

  router.post("/langgraph/approve", async (req: Request, res: Response) => {
    try {
      const validated = ResumeApprovalSchema.parse(req.body);
      const agent = agentInstances.get(validated.threadId);

      if (!agent) {
        return res.status(404).json({
          success: false,
          error: `Thread ${validated.threadId} not found`,
        });
      }

      const result = await agent.resumeWithApproval(
        validated.threadId,
        validated.approvalId,
        validated.approved
      );

      res.json({
        success: result.success,
        threadId: result.threadId,
        response: result.response,
        metrics: result.metrics,
        toolsExecuted: result.toolsExecuted,
        error: result.error,
      });
    } catch (error: any) {
      console.error("[LangGraph] Approval error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to process approval",
      });
    }
  });

  router.get("/langgraph/history/:threadId", async (req: Request, res: Response) => {
    try {
      const { threadId } = req.params;
      const agent = agentInstances.get(threadId);

      if (!agent) {
        const memory = await memoryStore.get(threadId);
        if (memory) {
          return res.json({
            success: true,
            threadId,
            history: memory,
            source: "memory_store",
          });
        }
        return res.status(404).json({
          success: false,
          error: `Thread ${threadId} not found`,
        });
      }

      const history = await agent.getConversationHistory(threadId);
      res.json({
        success: true,
        threadId,
        history,
        source: "active_agent",
      });
    } catch (error: any) {
      console.error("[LangGraph] History error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.delete("/langgraph/history/:threadId", async (req: Request, res: Response) => {
    try {
      const { threadId } = req.params;
      const agent = agentInstances.get(threadId);

      if (agent) {
        await agent.clearConversation(threadId);
      }
      await memoryStore.delete(threadId);
      agentInstances.delete(threadId);

      res.json({
        success: true,
        message: `Thread ${threadId} cleared`,
      });
    } catch (error: any) {
      console.error("[LangGraph] Clear history error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/langgraph/tools", async (_req: Request, res: Response) => {
    try {
      const allTools = ALL_TOOLS.map(tool => ({
        name: tool.name,
        description: tool.description,
        schema: tool.schema,
      }));

      const safeTools = SAFE_TOOLS.map(t => t.name);
      const systemTools = SYSTEM_TOOLS.map(t => t.name);

      res.json({
        success: true,
        tools: allTools,
        count: allTools.length,
        categories: {
          safe: safeTools,
          system: systemTools,
        },
        note: "LangGraph agent tools. System tools (shell, file, python) require authentication.",
      });
    } catch (error: any) {
      console.error("[LangGraph] Tools error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/langgraph/status", async (_req: Request, res: Response) => {
    try {
      const activeThreads = Array.from(agentInstances.keys());
      
      res.json({
        success: true,
        status: {
          activeThreads: activeThreads.length,
          threads: activeThreads,
          toolsAvailable: ALL_TOOLS.length,
          defaultModel: "gemini-3.1-pro",
          framework: "LangGraph",
          version: "1.0.0",
        },
      });
    } catch (error: any) {
      console.error("[LangGraph] Status error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  return router;
}
