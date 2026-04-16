import { Router, Request, Response } from "express";
import { type AuthenticatedRequest } from "../types/express";
import { z } from "zod";
import { storage } from "../storage";
import { getUpload, getSheets } from "../services/spreadsheetAnalyzer";
import {
  startAnalysis,
  getAnalysisProgress,
  getAnalysisResults,
} from "../services/analysisOrchestrator";
import { analysisLogger } from "../lib/analysisLogger";
import { complexityAnalyzer } from "../services/complexityAnalyzer";
import { checkDynamicEscalation } from "../services/router";
import { pareOrchestrator, type RoutingDecision } from "../services/pare";
import { runAgent, type AgentState } from "../services/agentRunner";
import { intentEnginePipeline, stateManager } from "../intent-engine";
import { analysisService } from "../services/analysisService";

const analyzeRequestSchema = z.object({
  messageId: z.string().optional(),
  scope: z.enum(["all", "selected", "active"]).default("all"),
  sheetsToAnalyze: z.array(z.string()).optional(),
  prompt: z.string().optional(),
});

function getFileExtension(filename: string): string {
  return (filename.split('.').pop() || '').toLowerCase();
}

function isSpreadsheetFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return ['xlsx', 'xls', 'csv', 'tsv'].includes(ext);
}

const complexityRequestSchema = z.object({
  message: z.string(),
  hasAttachments: z.boolean().optional().default(false),
});

const routerRequestSchema = z.object({
  message: z.string().min(1, "Message cannot be empty"),
  hasAttachments: z.boolean().optional().default(false),
  attachmentTypes: z.array(z.string()).optional().default([]),
});

const agentRunRequestSchema = z.object({
  message: z.string(),
  planHint: z.array(z.string()).optional().default([]),
});

const escalationCheckSchema = z.object({
  response: z.string().min(1, "Response string required"),
});

const intentAnalyzeSchema = z.object({
  message: z.string().min(1, "Message is required"),
});

export function createChatRoutes(): Router {
  const router = Router();

  router.post("/complexity", async (req: Request, res: Response) => {
    try {
      const validation = complexityRequestSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.message });
      }

      const { message, hasAttachments } = validation.data;
      const result = complexityAnalyzer.analyze(message, hasAttachments);

      res.json({
        agent_required: result.agent_required,
        agent_reason: result.agent_reason,
        complexity_score: result.score,
        category: result.category,
        signals: result.signals,
        recommended_path: result.recommended_path,
        estimated_tokens: result.estimated_tokens,
        dimensions: result.dimensions,
      });
    } catch (error: any) {
      console.error("[ChatRoutes] Complexity analysis error:", error);
      res.status(500).json({ error: "Failed to analyze complexity" });
    }
  });

  router.post("/route", async (req: Request, res: Response) => {
    try {
      const validation = routerRequestSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validation.error.message,
          code: "VALIDATION_ERROR"
        });
      }

      const { message, hasAttachments, attachmentTypes } = validation.data;

      const attachments = hasAttachments
        ? attachmentTypes.length > 0
          ? attachmentTypes.map((type, idx) => ({ type, name: `attachment_${idx}` }))
          : [{ type: 'file', name: 'attached' }]
        : undefined;

      const decision = await pareOrchestrator.route(message, hasAttachments, {
        attachments,
        attachmentTypes,
      });

      console.log(`[PARE] Route decision: ${decision.route}, confidence: ${decision.confidence}, reasons: ${decision.reasons.join(', ')}`);

      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        component: "PARE",
        event: "route_decision",
        route: decision.route,
        confidence: decision.confidence,
        reasons: decision.reasons,
        toolNeeds: decision.toolNeeds,
      }));

      res.json({
        route: decision.route,
        confidence: decision.confidence,
        reasons: decision.reasons,
        toolNeeds: decision.toolNeeds,
        planHint: decision.planHint,
        tool_needs: decision.toolNeeds,
        plan_hint: decision.planHint,
      });
    } catch (error: any) {
      const errorMsg = error.message || "Failed to route message";
      console.error("[ChatRoutes] PARE Router error:", JSON.stringify({ error: errorMsg }));
      res.json({
        route: "chat",
        confidence: 0.5,
        reasons: ["Router fallback due to error"],
        toolNeeds: [],
        planHint: [],
        tool_needs: [],
        plan_hint: [],
      });
    }
  });

  router.post("/agent-run", async (req: Request, res: Response) => {
    try {
      const validation = agentRunRequestSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validation.error.message,
          code: "VALIDATION_ERROR"
        });
      }

      const { message, planHint } = validation.data;

      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        component: "ChatRoutes",
        event: "agent_run_started",
        objective: message.slice(0, 100),
      }));

      const result = await runAgent(message, planHint);

      res.json({
        success: result.success,
        run_id: crypto.randomUUID(),
        result: result.result,
        state: {
          objective: result.state.objective,
          plan: result.state.plan,
          toolsUsed: result.state.toolsUsed,
          stepsCompleted: result.state.history.length,
          status: result.state.status,
        },
      });
    } catch (error: any) {
      const errorMsg = error.message || "Failed to run agent";
      console.error("[ChatRoutes] Agent run error:", JSON.stringify({ error: errorMsg }));
      res.status(500).json({
        error: "Failed to run agent",
        code: "AGENT_RUN_ERROR",
        suggestion: "Check server logs for details. If LLM is unavailable, heuristic fallback should apply."
      });
    }
  });

  router.post("/escalation-check", async (req: Request, res: Response) => {
    try {
      const validation = escalationCheckSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Response string required" });
      }

      const { response } = validation.data;
      const result = checkDynamicEscalation(response);
      res.json(result);
    } catch (error: any) {
      console.error("[ChatRoutes] Escalation check error:", error);
      res.status(500).json({ error: "Failed to check escalation" });
    }
  });


  router.post("/uploads/:uploadId/analyze", async (req: Request, res: Response) => {
    try {
      const { uploadId } = req.params;
      const userId = (req as AuthenticatedRequest).user?.id || "anonymous";

      const validation = analyzeRequestSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.message });
      }

      const { messageId, scope, sheetsToAnalyze, prompt } = validation.data;

      const result = await analysisService.startUploadAnalysis({
        uploadId,
        userId,
        messageId,
        scope,
        sheetsToAnalyze,
        prompt
      });

      res.json(result);

    } catch (error: any) {
      console.error("[ChatRoutes] Start analysis error:", error);
      const statusCode = error.message === "Upload not found" ? 404 : 500;
      const safeMsg = error.message === "Upload not found" ? "Upload not found" : "Failed to start analysis";
      res.status(statusCode).json({ error: safeMsg });
    }
  });

  router.get("/uploads/:uploadId/analysis", async (req: Request, res: Response) => {
    try {
      const { uploadId } = req.params;
      const result = await analysisService.getAnalysisStatus(uploadId);
      res.json(result);
    } catch (error: any) {
      console.error("[ChatRoutes] Get analysis error:", error);
      const statusCode = error.message === "Analysis not found for this upload" ? 404 : 500;
      const safeMsg = error.message === "Analysis not found for this upload" ? "Analysis not found for this upload" : "Failed to get analysis";
      res.status(statusCode).json({ error: safeMsg });
    }
  });

  const intentRequestSchema = z.object({
    message: z.string().min(1, "Message cannot be empty"),
    sessionId: z.string().optional(),
    userId: z.string().optional(),
    skipQualityGate: z.boolean().optional().default(false),
    skipSelfHeal: z.boolean().optional().default(false),
  });

  router.post("/intent/process", async (req: Request, res: Response) => {
    try {
      const validation = intentRequestSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validation.error.message
        });
      }

      const { message, sessionId, userId, skipQualityGate, skipSelfHeal } = validation.data;

      const result = await intentEnginePipeline.process(message, {
        sessionId: sessionId || `session_${Date.now()}`,
        userId: userId || 'anonymous',
        skipQualityGate,
        skipSelfHeal,
      });

      res.json({
        success: result.success,
        output: result.output,
        intent: result.context.intentClassification?.intent,
        confidence: result.context.intentClassification?.confidence,
        constraints: result.context.constraints,
        qualityScore: result.qualityScore,
        repairAttempts: result.repairAttempts,
        processingTimeMs: result.processingTimeMs,
        error: result.error,
      });
    } catch (error: any) {
      console.error("[ChatRoutes] Intent engine error:", error);
      res.status(500).json({ error: "Failed to process intent" });
    }
  });

  router.post("/intent/analyze", async (req: Request, res: Response) => {
    try {
      const validation = intentAnalyzeSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Message is required" });
      }

      const { message } = validation.data;
      const analysis = await intentEnginePipeline.analyzeOnly(message);

      res.json({
        normalizedInput: {
          language: analysis.normalizedInput.language,
          entities: analysis.normalizedInput.entities,
          metadata: analysis.normalizedInput.metadata,
        },
        intent: analysis.intent,
        constraints: analysis.constraints,
      });
    } catch (error: any) {
      console.error("[ChatRoutes] Intent analysis error:", error);
      res.status(500).json({ error: "Failed to analyze intent" });
    }
  });

  router.get("/intent/session/:sessionId", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const session = stateManager.getSession(sessionId);

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      res.json({
        sessionId: session.sessionId,
        domain: session.domain,
        constraints: session.constraints,
        historyLength: session.history.length,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });
    } catch (error: any) {
      console.error("[ChatRoutes] Get session error:", error);
      res.status(500).json({ error: "Failed to get session" });
    }
  });

  router.delete("/intent/session/:sessionId", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      intentEnginePipeline.resetSession(sessionId);
      res.json({ success: true, message: "Session reset" });
    } catch (error: any) {
      console.error("[ChatRoutes] Reset session error:", error);
      res.status(500).json({ error: "Failed to reset session" });
    }
  });

  return router;
}
