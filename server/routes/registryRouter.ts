import { Router, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import {
  toolRegistry,
  agentRegistry,
  orchestrator,
  capabilitiesReportRunner,
  initializeAgentSystem,
  getSystemStatus,
  isInitialized,
} from "../agent/registry";
import { productionWorkflowRunner, classifyIntent, isGenerationIntent } from "../agent/registry/productionWorkflowRunner";

export function createRegistryRouter(): Router {
  const router = Router();

  router.get("/registry/status", async (_req: Request, res: Response) => {
    try {
      const status = getSystemStatus();
      res.json({
        success: true,
        data: status,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post("/registry/initialize", async (req: Request, res: Response) => {
    try {
      const { runSmokeTest = false } = req.body;
      const result = await initializeAgentSystem({ runSmokeTest });
      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/registry/tools", async (_req: Request, res: Response) => {
    try {
      const tools = toolRegistry.getAll().map(t => ({
        name: t.metadata.name,
        description: t.metadata.description,
        category: t.metadata.category,
        version: t.metadata.version,
        config: t.config,
      }));
      
      res.json({
        success: true,
        count: tools.length,
        data: tools,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/registry/tools/:name", async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const tool = toolRegistry.get(name);
      
      if (!tool) {
        return res.status(404).json({
          success: false,
          error: `Tool "${name}" not found`,
        });
      }
      
      res.json({
        success: true,
        data: {
          metadata: tool.metadata,
          config: tool.config,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post("/registry/tools/:name/execute", async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const { input, options } = req.body;
      
      const result = await toolRegistry.execute(name, input, options);
      
      res.json({
        success: result.success,
        data: result.data,
        error: result.error,
        trace: {
          requestId: result.trace.requestId,
          toolName: result.trace.toolName,
          durationMs: result.trace.durationMs,
          status: result.trace.status,
          retryCount: result.trace.retryCount,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/registry/tools/category/:category", async (req: Request, res: Response) => {
    try {
      const { category } = req.params;
      const tools = toolRegistry.getByCategory(category as any).map(t => ({
        name: t.metadata.name,
        description: t.metadata.description,
      }));
      
      res.json({
        success: true,
        count: tools.length,
        category,
        data: tools,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/registry/agents", async (_req: Request, res: Response) => {
    try {
      const agents = agentRegistry.getAll().map(a => ({
        name: a.config.name,
        description: a.config.description,
        role: a.config.role,
        tools: a.config.tools,
        capabilities: a.getCapabilities().map(c => c.name),
        state: a.state,
      }));
      
      res.json({
        success: true,
        count: agents.length,
        data: agents,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/registry/agents/:name", async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const agent = agentRegistry.get(name);
      
      if (!agent) {
        return res.status(404).json({
          success: false,
          error: `Agent "${name}" not found`,
        });
      }
      
      res.json({
        success: true,
        data: {
          config: agent.config,
          state: agent.state,
          capabilities: agent.getCapabilities(),
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post("/registry/route", async (req: Request, res: Response) => {
    try {
      const { query } = req.body;
      
      if (!query || typeof query !== "string") {
        return res.status(400).json({
          success: false,
          error: "Query is required",
        });
      }
      
      const result = await orchestrator.route(query);
      
      res.json({
        success: true,
        data: {
          intent: result.intent,
          agentName: result.agentName,
          tools: result.tools,
          workflow: result.workflow,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post("/registry/execute", async (req: Request, res: Response) => {
    try {
      const { query } = req.body;
      
      if (!query || typeof query !== "string") {
        return res.status(400).json({
          success: false,
          error: "Query is required",
        });
      }
      
      const result = await orchestrator.executeTask(query);
      
      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/registry/traces", async (req: Request, res: Response) => {
    try {
      const { toolName, category, status, limit } = req.query;
      
      const traces = toolRegistry.getTraces({
        toolName: toolName as string,
        category: category as string,
        status: status as any,
        limit: limit ? parseInt(limit as string) : 100,
      });
      
      res.json({
        success: true,
        count: traces.length,
        data: traces,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/registry/stats", async (_req: Request, res: Response) => {
    try {
      const toolStats = toolRegistry.getStats();
      const agentStats = agentRegistry.getStats();
      const orchestratorStats = orchestrator.getStats();
      
      res.json({
        success: true,
        data: {
          tools: toolStats,
          agents: agentStats,
          orchestrator: orchestratorStats,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post("/registry/capabilities-report", async (req: Request, res: Response) => {
    try {
      const { mode = "full", full = false, smoke = false, implementedOnly = false } = req.body;
      
      let reportMode: "full" | "smoke" | "implementedOnly" = mode;
      if (full) reportMode = "full";
      else if (smoke) reportMode = "smoke";
      else if (implementedOnly) reportMode = "implementedOnly";
      
      const report = await capabilitiesReportRunner.runReport(reportMode);
      
      res.json({
        success: true,
        data: report,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/registry/capabilities-report/junit", async (_req: Request, res: Response) => {
    try {
      const report = capabilitiesReportRunner.getLastReport();
      
      if (!report) {
        return res.status(404).json({
          success: false,
          error: "No report available. Run /registry/capabilities-report first.",
        });
      }
      
      const junit = capabilitiesReportRunner.toJUnit();
      res.type("application/xml").send(junit);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post("/registry/execute-workflow", async (req: Request, res: Response) => {
    try {
      const { query, workflowId, strict_e2e = false } = req.body;
      
      if (!query && !workflowId) {
        return res.status(400).json({
          success: false,
          error: "Either 'query' or 'workflowId' is required",
        });
      }

      if (strict_e2e && query) {
        const result = await orchestrator.executeStrictE2E(query, true);
        return res.json({
          success: result.success,
          type: result.type,
          intent: result.intent,
          evidence: result.evidence,
          summary: result.summary,
          artifacts: result.artifacts,
          firstFailure: result.firstFailure,
        });
      }
      
      let workflow;
      let evidence: Array<{
        stepId: string;
        toolName: string;
        input?: unknown;
        output: any;
        schemaValidation?: string;
        requestId?: string;
        durationMs: number;
        retryCount?: number;
        replanEvents?: string[];
        status: string;
        error?: string;
      }> = [];
      
      if (workflowId) {
        workflow = await orchestrator.executeWorkflow(workflowId);
      } else if (query) {
        const result = await orchestrator.executeTask(query);
        
        if (result.workflowResult) {
          workflow = result.workflowResult;
        } else if (result.toolResults) {
          return res.json({
            success: true,
            type: "simple",
            intent: result.intent,
            evidence: result.toolResults.map((r, i) => ({
              stepId: `step_${i + 1}`,
              toolName: r.trace.toolName,
              input: r.trace.args,
              output: r.data,
              schemaValidation: r.success ? "pass" : "fail",
              requestId: r.trace.requestId,
              durationMs: r.trace.durationMs || 0,
              retryCount: r.trace.retryCount,
              replanEvents: [],
              status: r.success ? "completed" : "failed",
              error: r.error?.message,
            })),
            summary: {
              totalSteps: result.toolResults.length,
              completedSteps: result.toolResults.filter(r => r.success).length,
              failedSteps: result.toolResults.filter(r => !r.success).length,
              skippedSteps: 0,
              totalDurationMs: result.toolResults.reduce((sum, r) => sum + (r.trace.durationMs || 0), 0),
              replans: 0,
              allValidationsPassed: result.toolResults.every(r => r.success),
            },
          });
        } else if (result.agentResult) {
          return res.json({
            success: result.agentResult.success,
            type: "agent",
            intent: result.intent,
            evidence: [{
              stepId: "agent_execution",
              toolName: result.intent.suggestedAgent,
              input: { query },
              output: result.agentResult.output,
              schemaValidation: result.agentResult.success ? "pass" : "fail",
              requestId: result.agentResult.trace?.requestId,
              durationMs: result.agentResult.trace?.durationMs || 0,
              retryCount: 0,
              replanEvents: [],
              status: result.agentResult.success ? "completed" : "failed",
              error: result.agentResult.error,
            }],
            summary: {
              totalSteps: 1,
              completedSteps: result.agentResult.success ? 1 : 0,
              failedSteps: result.agentResult.success ? 0 : 1,
              skippedSteps: 0,
              totalDurationMs: result.agentResult.trace?.durationMs || 0,
              replans: 0,
              allValidationsPassed: result.agentResult.success,
            },
          });
        }
      }
      
      if (workflow) {
        evidence = workflow.steps.map(step => ({
          stepId: step.id,
          toolName: step.name,
          input: step.input,
          output: step.result?.data || step.result?.output,
          schemaValidation: step.status === "completed" ? "pass" : "fail",
          requestId: step.result?.trace?.requestId,
          durationMs: step.duration || 0,
          retryCount: step.result?.trace?.retryCount || 0,
          replanEvents: step.status === "failed" && step.result?.error?.retryable
            ? [`Retry attempted for ${step.name}`]
            : [],
          status: step.status,
          error: step.error,
        }));
      }
      
      const completedSteps = evidence.filter(e => e.status === "completed").length;
      const failedSteps = evidence.filter(e => e.status === "failed").length;
      
      res.json({
        success: workflow?.status === "completed",
        type: "workflow",
        workflow: workflow ? {
          id: workflow.id,
          name: workflow.name,
          status: workflow.status,
          startedAt: workflow.startedAt,
          completedAt: workflow.completedAt,
          error: workflow.error,
        } : null,
        evidence,
        summary: {
          totalSteps: evidence.length,
          completedSteps,
          failedSteps,
          skippedSteps: evidence.filter(e => e.status === "skipped").length,
          totalDurationMs: evidence.reduce((sum, e) => sum + e.durationMs, 0),
          replans: evidence.filter(e => e.replanEvents && e.replanEvents.length > 0).length,
          allValidationsPassed: failedSteps === 0,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
        stack: error.stack,
      });
    }
  });

  router.get("/registry/health", async (_req: Request, res: Response) => {
    try {
      const [toolHealth, agentHealth] = await Promise.all([
        toolRegistry.runHealthChecks(),
        agentRegistry.runHealthChecks(),
      ]);
      
      const toolsHealthy = Array.from(toolHealth.values()).every(h => h);
      const agentsHealthy = Array.from(agentHealth.values()).every(h => h);
      
      res.json({
        success: true,
        healthy: toolsHealthy && agentsHealthy,
        data: {
          tools: Object.fromEntries(toolHealth),
          agents: Object.fromEntries(agentHealth),
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post("/registry/workflows", async (req: Request, res: Response) => {
    try {
      const { query } = req.body;
      
      if (!query || typeof query !== "string") {
        return res.status(400).json({
          success: false,
          error: "Query is required",
        });
      }

      const result = await productionWorkflowRunner.startRun(query);
      
      res.status(202).json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/registry/workflows/:runId", async (req: Request, res: Response) => {
    try {
      const { runId } = req.params;
      const run = productionWorkflowRunner.getRunStatus(runId);
      
      if (!run) {
        return res.status(404).json({
          success: false,
          error: `Run ${runId} not found`,
        });
      }
      
      res.json({
        success: true,
        data: {
          runId: run.runId,
          requestId: run.requestId,
          status: run.status,
          startedAt: run.startedAt,
          updatedAt: run.updatedAt,
          completedAt: run.completedAt,
          currentStepIndex: run.currentStepIndex,
          totalSteps: run.totalSteps,
          replansCount: run.replansCount,
          intent: run.intent,
          evidence: run.evidence,
          artifacts: run.artifacts,
          error: run.error,
          errorType: run.errorType,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/registry/workflows/:runId/events", async (req: Request, res: Response) => {
    const { runId } = req.params;
    
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const sendEvent = (event: any) => {
      res.write(`event: ${event.eventType}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const existingEvents = productionWorkflowRunner.getRunEvents(runId);
    for (const event of existingEvents) {
      sendEvent(event);
    }

    const eventHandler = (event: any) => {
      if (event.runId === runId) {
        sendEvent(event);
        
        if (event.eventType === "run_completed" || 
            event.eventType === "run_failed" || 
            event.eventType === "run_cancelled") {
          res.end();
        }
      }
    };

    productionWorkflowRunner.on("event", eventHandler);

    const heartbeatInterval = setInterval(() => {
      res.write(`event: heartbeat\n`);
      res.write(`data: {"timestamp":"${new Date().toISOString()}"}\n\n`);
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeatInterval);
      productionWorkflowRunner.off("event", eventHandler);
    });
  });

  router.post("/registry/workflows/:runId/cancel", async (req: Request, res: Response) => {
    try {
      const { runId } = req.params;
      const { reason } = req.body;
      
      const cancelled = await productionWorkflowRunner.cancelRun(runId, reason);
      
      if (!cancelled) {
        return res.status(404).json({
          success: false,
          error: `Run ${runId} not found or already completed`,
        });
      }
      
      res.json({
        success: true,
        message: `Run ${runId} cancelled`,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/artifacts/:filename/download", async (req: Request, res: Response) => {
    try {
      const { filename } = req.params;
      const artifactsDir = path.join(process.cwd(), "artifacts");
      const filePath = path.join(artifactsDir, filename);

      // SECURITY: Prevent path traversal attacks
      const realPath = path.resolve(filePath);
      if (!realPath.startsWith(path.resolve(artifactsDir))) {
        return res.status(403).json({
          success: false,
          error: "Invalid file path - access denied",
        });
      }

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          error: "Artifact not found",
        });
      }
      
      const stats = fs.statSync(filePath);
      const ext = path.extname(filename).toLowerCase();
      
      // Set appropriate Content-Type based on file extension
      const mimeTypes: Record<string, string> = {
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".html": "text/html",
      };
      
      const contentType = mimeTypes[ext] || "application/octet-stream";
      
      // Set headers for binary download
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", stats.size);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      
      // Stream the file as binary
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
      
      fileStream.on("error", (err) => {
        console.error(`[ArtifactDownload] Stream error for ${filename}:`, err);
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: "Failed to stream file" });
        }
      });
    } catch (error: any) {
      console.error(`[ArtifactDownload] Error downloading ${req.params.filename}:`, error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/artifacts/:filename/preview", async (req: Request, res: Response) => {
    try {
      const { filename } = req.params;
      const artifactsDir = path.join(process.cwd(), "artifacts");
      const filePath = path.join(artifactsDir, filename);

      // SECURITY: Prevent path traversal attacks
      const realPath = path.resolve(filePath);
      if (!realPath.startsWith(path.resolve(artifactsDir))) {
        return res.status(403).json({
          success: false,
          error: "Invalid file path - access denied",
        });
      }

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          error: "Artifact not found",
        });
      }
      
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".pdf": "application/pdf",
        ".html": "text/html",
        ".txt": "text/plain",
      };
      
      const contentType = mimeTypes[ext] || "application/octet-stream";
      res.type(contentType);
      res.sendFile(filePath);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/artifacts/:filename", async (req: Request, res: Response) => {
    try {
      const { filename } = req.params;
      
      // Security: Only allow JSON files (deckState content files) via this endpoint
      // Other files must use /download or /preview which have their own access controls
      const ext = path.extname(filename).toLowerCase();
      if (ext !== ".json") {
        return res.status(403).json({
          success: false,
          error: "Only JSON content files are accessible via this endpoint",
        });
      }
      
      const artifactsDir = path.join(process.cwd(), "artifacts");
      const filePath = path.join(artifactsDir, filename);
      
      // Prevent path traversal attacks
      const realPath = path.resolve(filePath);
      if (!realPath.startsWith(path.resolve(artifactsDir))) {
        return res.status(403).json({
          success: false,
          error: "Invalid file path",
        });
      }
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          error: "Artifact not found",
        });
      }
      
      res.type("application/json");
      res.sendFile(filePath);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post("/registry/classify-intent", async (req: Request, res: Response) => {
    try {
      const { query } = req.body;
      
      if (!query || typeof query !== "string") {
        return res.status(400).json({
          success: false,
          error: "Query is required",
        });
      }
      
      const intent = classifyIntent(query);
      const isGeneration = isGenerationIntent(intent);
      
      res.json({
        success: true,
        data: {
          query,
          intent,
          isGenerationIntent: isGeneration,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  return router;
}
