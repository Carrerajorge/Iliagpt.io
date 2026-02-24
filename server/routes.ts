import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { ObjectStorageService } from "./objectStorage";
import { processDocument } from "./services/documentProcessing";
import { chunkText, generateEmbeddingsBatch } from "./embeddingService";
import { StepUpdate } from "./agent";
import { browserSessionManager, SessionEvent } from "./agent/browser";
import { fileProcessingQueue, FileStatusUpdate } from "./lib/fileProcessingQueue";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import { generateAnonToken } from "./lib/anonToken";
import { pptExportRouter } from "./routes/pptExport";
import { createChatsRouter } from "./routes/chatsRouter";
import { createFilesRouter } from "./routes/filesRouter";
import { createGptRouter } from "./routes/gptRouter";
import { createDocumentsRouter } from "./routes/documentsRouter";
import { createAdminRouter } from "./routes/adminRouter";
import { createRetrievalAdminRouter } from "./routes/retrievalAdminRouter";
import { createAgentRouter } from "./routes/agentRouter";
import { createFigmaRouter } from "./routes/figmaRouter";
import { createLibraryRouter } from "./routes/libraryRouter";
import { createCodeRouter } from "./routes/codeRouter";
import { createUserRouter } from "./routes/userRouter";
import { createChatAiRouter } from "./routes/chatAiRouter";
import { createGoogleFormsRouter } from "./routes/googleFormsRouter";
import { createGmailRouter } from "./routes/gmailRouter";
import gmailOAuthRouter from "./routes/gmailOAuthRouter";
import { createGmailMcpRouter } from "./mcp/gmailMcpServer";
import healthRouter from "./routes/healthRouter";
import aiExcelRouter from "./routes/aiExcelRouter";
import { metricsHandler, getMetricsJson } from "./lib/parePrometheusMetrics";
import { createHealthRouter as createPareHealthRouter, getHealthSummary as getPareHealthSummary } from "./lib/pareHealthChecks";
import { getMetricsSummary as getPareMetricsSummary } from "./lib/pareMetrics";
import errorRouter from "./routes/errorRouter";
import { createSpreadsheetRouter } from "./routes/spreadsheetRoutes";
import { createChatRoutes } from "./routes/chatRoutes";
import { createAgentModeRouter } from "./routes/agentRoutes";
import { createSandboxAgentRouter } from "./routes/sandboxAgentRouter";
import { createLangGraphRouter } from "./routes/langGraphRouter";
import { createRegistryRouter } from "./routes/registryRouter";
import wordPipelineRoutes from "./routes/wordPipelineRoutes";
import redisSSERouter from "./routes/redisSSERouter";
import superAgentRouter from "./routes/superAgentRoutes";
import conversationMemoryRoutes from "./routes/conversationMemoryRoutes";
import { createPythonToolsRouter } from "./routes/pythonToolsRouter";
import { createToolExecutionRouter } from "./routes/toolExecutionRouter";
import scientificSearchRouter from "./routes/scientificSearchRouter";
import documentAnalysisRouter from "./routes/documentAnalysisRouter";
import ragRouter from "./routes/ragRouter";
import { createStripeRouter } from "./routes/stripeRouter";
import { createOpenClawRouter } from "./routes/openclawRouter";
import { createRunController } from "./agent/superAgent/tracing/RunController";
import { initializeEventStore, getEventStore } from "./agent/superAgent/tracing/EventStore";
import type { ExecutionEvent, ExecutionEventType } from "@shared/executionProtocol";
import type { TraceEvent } from "./agent/superAgent/tracing/types";
import { getStreamGateway } from "./agent/superAgent/tracing/StreamGateway";
import type { TraceEmitter } from "./agent/superAgent/tracing/TraceEmitter";
import { initializeRedisSSE } from "./lib/redisSSE";
import { initializeAgentSystem } from "./agent/registry";
import { ALL_TOOLS, SAFE_TOOLS, SYSTEM_TOOLS } from "./agent/langgraph/tools";
import { getAllAgents, getAgentSummary, SPECIALIZED_AGENTS } from "./agent/langgraph/agents";
import { createAuthenticatedWebSocketHandler, AuthenticatedWebSocket } from "./lib/wsAuth";
import { llmGateway } from "./lib/llmGateway";
import { getUserConfig, setUserConfig, getDefaultConfig, validatePatterns, getFilterStats } from "./services/contentFilter";
import { getLogs, getLogStats, type LogFilters } from "./lib/structuredLogger";
import { getActiveRequests, getRequestStats } from "./lib/requestTracer";
import { getAllServicesHealth, getOverallStatus, initializeHealthMonitoring } from "./lib/healthMonitor";
import { getActiveAlerts, getAlertHistory, getAlertStats, resolveAlert } from "./lib/alertManager";
import { recordConnectorUsage, getConnectorStats, getAllConnectorStats, resetConnectorStats, isValidConnector, type ConnectorName } from "./lib/connectorMetrics";
import { checkConnectorHealth, checkAllConnectorsHealth, getHealthSummary, startPeriodicHealthCheck } from "./lib/connectorAlerting";
import { 
  runAgent, getTools, healthCheck as pythonAgentHealthCheck, isServiceAvailable, PythonAgentClientError,
  browse as pythonAgentBrowse, search as pythonAgentSearch, createDocument as pythonAgentCreateDocument,
  executeTool as pythonAgentExecuteTool, listFiles as pythonAgentListFiles, getStatus as pythonAgentGetStatus
} from "./services/pythonAgentClient";
import express from "express";
import path from "path";
import fs from "fs";

const agentClients: Map<string, Set<WebSocket>> = new Map();
const browserClients: Map<string, Set<WebSocket>> = new Map();
const fileStatusClients: Map<string, Set<WebSocket>> = new Map();

function mapTraceEventType(eventType: string): ExecutionEventType {
  const mapping: Record<string, ExecutionEventType> = {
    run_started: "run_started",
    run_completed: "run_completed",
    run_failed: "run_failed",
    phase_started: "step_started",
    phase_completed: "step_completed",
    phase_failed: "step_failed",
    tool_start: "tool_call_started",
    tool_progress: "tool_call_progress",
    tool_stdout_chunk: "tool_call_chunk",
    tool_end: "tool_call_completed",
    tool_error: "tool_call_failed",
    checkpoint: "info",
    contract_violation: "warning",
    heartbeat: "heartbeat",
    retry_scheduled: "tool_call_retry",
    fallback_activated: "warning",
    source_collected: "info",
    source_verified: "info",
    source_rejected: "warning",
    artifact_created: "artifact_ready",
    progress_update: "step_progress",
  };
  return mapping[eventType] || "info";
}

function buildPayloadFromTraceEvent(event: TraceEvent): ExecutionEvent["payload"] {
  const basePayload = {
    message: event.message,
    agent: event.agent,
    phase: event.phase,
    status: event.status,
    progress: event.progress,
    ...(event.metrics || {}),
    ...(event.evidence || {}),
  };

  switch (event.event_type) {
    case "run_started":
      return {
        request_type: "research",
        request_summary: event.message,
        metadata: event.evidence,
      };
    case "run_completed":
      return {
        duration_ms: event.metrics?.latency_ms || 0,
        total_steps: event.metrics?.articles_verified || 0,
        completed_steps: event.metrics?.articles_accepted || 0,
        artifacts_count: 0,
        summary: event.message,
      };
    case "run_failed":
      return {
        error: event.message,
        error_code: event.evidence?.error_code,
        recoverable: false,
      };
    case "phase_started":
    case "phase_completed":
    case "phase_failed":
      return {
        step: {
          id: event.span_id,
          title: event.message,
          kind: "execute" as const,
          status: event.status === "success" ? "completed" : event.status === "failed" ? "failed" : "running",
          progress: event.progress,
        },
      };
    case "tool_start":
    case "tool_end":
    case "tool_error":
      return {
        call: {
          call_id: event.span_id,
          tool: event.node_id,
          summary: event.message,
          status: event.status === "success" ? "completed" : event.status === "failed" ? "failed" : "running",
          latency_ms: event.metrics?.latency_ms,
        },
      };
    case "tool_progress":
      return {
        call_id: event.span_id,
        progress: event.progress || 0,
        message: event.message,
      };
    case "tool_stdout_chunk":
      return {
        call_id: event.span_id,
        chunk: event.message,
      };
    case "artifact_created":
      return {
        artifact: {
          artifact_id: event.span_id,
          kind: "excel" as const,
          filename: event.message.replace(/^Created \w+: /, ""),
          mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          status: "ready" as const,
          download_url: event.evidence?.final_url,
        },
      };
    case "heartbeat":
      return {
        uptime_ms: Date.now() - event.ts,
      };
    case "progress_update":
      return {
        step_id: event.span_id,
        progress: event.progress || 0,
        message: event.message,
        items_processed: event.metrics?.articles_collected,
        items_total: event.metrics?.articles_verified,
      };
    default:
      return {
        message: event.message,
        details: { ...event.metrics, ...event.evidence },
      };
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);
  
  // Session identity endpoint for consistent user ID across frontend/backend
  // SECURITY: Anonymous user IDs are now bound to the session to prevent impersonation
  app.get("/api/session/identity", (req: Request, res: Response) => {
    const user = (req as any).user;
    const authUserId = user?.claims?.sub;
    const authEmail = user?.claims?.email;
    
    if (authUserId) {
      return res.json({
        userId: authUserId,
        email: authEmail,
        isAnonymous: false
      });
    }
    
    // For anonymous users, bind ID to session (not header) to prevent impersonation
    const session = req.session as any;
    if (!session.anonUserId) {
      const sessionId = (req as any).sessionID;
      session.anonUserId = sessionId ? `anon_${sessionId}` : null;
    }
    
    const anonUserId = session.anonUserId;
    res.json({
      userId: anonUserId,
      token: anonUserId ? generateAnonToken(anonUserId) : null,
      email: null,
      isAnonymous: true
    });
  });
  
  const artifactsDir = path.join(process.cwd(), "artifacts");
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }
  app.use("/api/artifacts", express.static(artifactsDir, {
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      const stats = fs.statSync(filePath);
      if (ext === ".pptx") {
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
      } else if (ext === ".docx") {
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      } else if (ext === ".xlsx") {
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      } else if (ext === ".pdf") {
        res.setHeader("Content-Type", "application/pdf");
      } else if (ext === ".png") {
        res.setHeader("Content-Type", "image/png");
      }
      res.setHeader("Content-Length", stats.size);
      res.setHeader("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    }
  }));
  
  app.use("/api/ppt", pptExportRouter);
  app.use("/api", createChatsRouter());
  app.use(createFilesRouter());
  app.use("/api", createGptRouter());
  app.use("/api/documents", createDocumentsRouter());
  app.use("/api/admin", createAdminRouter());
  app.use("/api/admin", createRetrievalAdminRouter());
  app.use("/api", createAgentRouter(broadcastBrowserEvent));
  app.use(createFigmaRouter());
  app.use(createLibraryRouter());
  app.use(createCodeRouter());
  app.use(createUserRouter());
  app.use("/api", createChatAiRouter(broadcastAgentUpdate));
  app.use("/api/integrations/google/forms", createGoogleFormsRouter());
  app.use("/api/integrations/google/gmail", createGmailRouter());
  app.use("/api/oauth/google/gmail", gmailOAuthRouter);
  app.use("/mcp/gmail", createGmailMcpRouter());
  app.use("/health", healthRouter);
  app.use("/health/pare", createPareHealthRouter());
  app.get("/metrics", metricsHandler);
  app.get("/api/pare/metrics", (_req: Request, res: Response) => {
    res.json({
      prometheus: getMetricsJson(),
      internal: getPareMetricsSummary(),
      health: getPareHealthSummary()
    });
  });
  app.use("/api/ai", aiExcelRouter);
  app.use("/api/errors", errorRouter);
  app.use("/api/spreadsheet", createSpreadsheetRouter());
  app.use("/api/chat", createChatRoutes());
  app.use("/api/agent", createAgentModeRouter());
  app.use("/api", createSandboxAgentRouter());
  app.use("/api", createLangGraphRouter());
  app.use("/api", createRegistryRouter());
  app.use("/api/word-pipeline", wordPipelineRoutes);
  app.use("/api/sse", redisSSERouter);
  app.use("/api/memory", conversationMemoryRoutes);
  app.use("/api", superAgentRouter);
  app.use("/api", createPythonToolsRouter());
  app.use("/api/execution", createToolExecutionRouter());
  app.use("/api/scientific", scientificSearchRouter);
  app.use("/api/document-analysis", documentAnalysisRouter);
  app.use("/api/rag", ragRouter);
  app.use(createStripeRouter());
  app.use("/api/openclaw", createOpenClawRouter());
  app.use("/api", createRunController());

  // ===== Run Detail Endpoints =====
  
  // GET /api/runs/:runId - Get current run state
  app.get("/api/runs/:runId", (req: Request, res: Response) => {
    try {
      const { runId } = req.params;
      const gateway = getStreamGateway();
      const traceBus = gateway.getRunBus(runId);
      
      if (!traceBus) {
        return res.status(404).json({
          success: false,
          error: "Run not found",
          run_id: runId,
        });
      }
      
      const emitter = traceBus as TraceEmitter;
      const metrics = emitter.getMetrics();
      const toolCalls = emitter.getToolCallsArray();
      const artifacts = emitter.getArtifactsArray();
      
      const completedSteps = toolCalls.filter(tc => tc.status === "completed").length;
      const runningSteps = toolCalls.filter(tc => tc.status === "running" || tc.status === "streaming").length;
      
      let status: "pending" | "running" | "completed" | "failed" = "pending";
      if (runningSteps > 0) {
        status = "running";
      } else if (metrics.failedToolCalls > 0 && metrics.completedToolCalls === 0) {
        status = "failed";
      } else if (metrics.totalToolCalls > 0 && metrics.completedToolCalls === metrics.totalToolCalls) {
        status = "completed";
      } else if (metrics.totalToolCalls > 0) {
        status = "running";
      }
      
      const progress = metrics.totalToolCalls > 0 
        ? Math.round((metrics.completedToolCalls / metrics.totalToolCalls) * 100)
        : 0;
      
      res.json({
        success: true,
        run_id: runId,
        status,
        progress,
        metrics: {
          total_tool_calls: metrics.totalToolCalls,
          completed_tool_calls: metrics.completedToolCalls,
          failed_tool_calls: metrics.failedToolCalls,
          total_artifacts: metrics.totalArtifacts,
          ready_artifacts: metrics.readyArtifacts,
        },
        counts: {
          steps: metrics.totalToolCalls,
          tool_calls: metrics.totalToolCalls,
          artifacts: metrics.totalArtifacts,
        },
      });
    } catch (error: any) {
      console.error("[RunDetail] Error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get run details",
      });
    }
  });

  // GET /api/runs/:runId/calls - List all tool calls for a run
  app.get("/api/runs/:runId/calls", (req: Request, res: Response) => {
    try {
      const { runId } = req.params;
      const gateway = getStreamGateway();
      const traceBus = gateway.getRunBus(runId);
      
      if (!traceBus) {
        return res.status(404).json({
          success: false,
          error: "Run not found",
          run_id: runId,
        });
      }
      
      const emitter = traceBus as TraceEmitter;
      const toolCalls = emitter.getToolCallsArray();
      
      res.json({
        success: true,
        run_id: runId,
        count: toolCalls.length,
        calls: toolCalls,
      });
    } catch (error: any) {
      console.error("[RunCalls] Error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get tool calls",
      });
    }
  });

  // GET /api/runs/:runId/calls/:callId - Get specific tool call details
  app.get("/api/runs/:runId/calls/:callId", (req: Request, res: Response) => {
    try {
      const { runId, callId } = req.params;
      const gateway = getStreamGateway();
      const traceBus = gateway.getRunBus(runId);
      
      if (!traceBus) {
        return res.status(404).json({
          success: false,
          error: "Run not found",
          run_id: runId,
        });
      }
      
      const emitter = traceBus as TraceEmitter;
      const toolCall = emitter.getToolCall(callId);
      
      if (!toolCall) {
        return res.status(404).json({
          success: false,
          error: "Tool call not found",
          run_id: runId,
          call_id: callId,
        });
      }
      
      res.json({
        success: true,
        run_id: runId,
        call: toolCall,
      });
    } catch (error: any) {
      console.error("[RunCallDetail] Error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get tool call details",
      });
    }
  });

  // GET /api/runs/:runId/artifacts - List all artifacts for a run
  app.get("/api/runs/:runId/artifacts", (req: Request, res: Response) => {
    try {
      const { runId } = req.params;
      const gateway = getStreamGateway();
      const traceBus = gateway.getRunBus(runId);
      
      if (!traceBus) {
        return res.status(404).json({
          success: false,
          error: "Run not found",
          run_id: runId,
        });
      }
      
      const emitter = traceBus as TraceEmitter;
      const artifacts = emitter.getArtifactsArray();
      
      res.json({
        success: true,
        run_id: runId,
        count: artifacts.length,
        artifacts,
      });
    } catch (error: any) {
      console.error("[RunArtifacts] Error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get artifacts",
      });
    }
  });

  // GET /api/runs/:runId/artifacts/:artifactId - Get specific artifact details
  app.get("/api/runs/:runId/artifacts/:artifactId", (req: Request, res: Response) => {
    try {
      const { runId, artifactId } = req.params;
      const gateway = getStreamGateway();
      const traceBus = gateway.getRunBus(runId);
      
      if (!traceBus) {
        return res.status(404).json({
          success: false,
          error: "Run not found",
          run_id: runId,
        });
      }
      
      const emitter = traceBus as TraceEmitter;
      const artifact = emitter.getArtifact(artifactId);
      
      if (!artifact) {
        return res.status(404).json({
          success: false,
          error: "Artifact not found",
          run_id: runId,
          artifact_id: artifactId,
        });
      }
      
      res.json({
        success: true,
        run_id: runId,
        artifact,
        download_url: artifact.download_url || null,
      });
    } catch (error: any) {
      console.error("[RunArtifactDetail] Error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get artifact details",
      });
    }
  });

  // GET /api/runs/:runId/stream - SSE endpoint for real-time execution events
  app.get("/api/runs/:runId/stream", (req: Request, res: Response) => {
    const { runId } = req.params;
    const lastEventId = req.headers["last-event-id"] 
      ? parseInt(req.headers["last-event-id"] as string, 10) 
      : 0;
    
    const gateway = getStreamGateway();
    const traceBus = gateway.getRunBus(runId);
    
    if (!traceBus) {
      return res.status(404).json({
        success: false,
        error: "Run not found",
        run_id: runId,
      });
    }
    
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    
    let seq = lastEventId;
    let closed = false;
    
    const sendEvent = (eventType: string, data: any, eventSeq?: number) => {
      if (closed) return;
      try {
        const eventId = eventSeq ?? ++seq;
        res.write(`id: ${eventId}\n`);
        res.write(`event: ${eventType}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (e) {
        console.error("[RunStream] Write error:", e);
      }
    };
    
    sendEvent("connected", {
      run_id: runId,
      message: "Connected to execution stream",
      ts: Date.now(),
    });
    
    const executionEventHandler = (event: ExecutionEvent) => {
      if (closed) return;
      sendEvent(event.type, event, event.seq);
    };
    
    const traceEventHandler = (event: any) => {
      if (closed) return;
      const execEvent: ExecutionEvent = {
        schema_version: "v1",
        run_id: event.run_id || runId,
        seq: event.seq || ++seq,
        ts: event.ts || Date.now(),
        type: mapTraceEventType(event.event_type),
        payload: buildPayloadFromTraceEvent(event),
      };
      sendEvent(execEvent.type, execEvent, execEvent.seq);
    };
    
    const emitter = traceBus as TraceEmitter;
    
    if (emitter.listenerCount && emitter.listenerCount("execution_event") >= 0) {
      emitter.on("execution_event", executionEventHandler);
    }
    emitter.on("trace", traceEventHandler);
    
    const heartbeatInterval = setInterval(() => {
      if (closed) return;
      sendEvent("heartbeat", {
        run_id: runId,
        ts: Date.now(),
      });
    }, 800);
    
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeatInterval);
      emitter.off("execution_event", executionEventHandler);
      emitter.off("trace", traceEventHandler);
      console.log(`[RunStream] Client disconnected from run ${runId}`);
    };
    
    req.on("close", cleanup);
    req.on("error", cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);
  });

  // GET /api/runs/:runId/events - Polling endpoint for execution events
  app.get("/api/runs/:runId/events", async (req: Request, res: Response) => {
    try {
      const { runId } = req.params;
      const after = parseInt(req.query.after as string, 10) || 0;
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 1000);
      
      const gateway = getStreamGateway();
      const traceBus = gateway.getRunBus(runId);
      
      if (!traceBus) {
        const eventStore = getEventStore();
        const storedEvents = await eventStore.getEvents(runId, after, limit);
        
        if (storedEvents.length === 0) {
          return res.status(404).json({
            success: false,
            error: "Run not found",
            run_id: runId,
          });
        }
        
        const events: ExecutionEvent[] = storedEvents.map(traceEvent => ({
          schema_version: "v1",
          run_id: traceEvent.run_id,
          seq: traceEvent.seq,
          ts: traceEvent.ts,
          type: mapTraceEventType(traceEvent.event_type),
          payload: buildPayloadFromTraceEvent(traceEvent),
        }));
        
        return res.json({
          success: true,
          run_id: runId,
          events,
          count: events.length,
          last_seq: events.length > 0 ? events[events.length - 1].seq : after,
        });
      }
      
      const eventStore = getEventStore();
      const storedEvents = await eventStore.getEvents(runId, after, limit);
      
      const events: ExecutionEvent[] = storedEvents.map(traceEvent => ({
        schema_version: "v1",
        run_id: traceEvent.run_id,
        seq: traceEvent.seq,
        ts: traceEvent.ts,
        type: mapTraceEventType(traceEvent.event_type),
        payload: buildPayloadFromTraceEvent(traceEvent),
      }));
      
      res.json({
        success: true,
        run_id: runId,
        events,
        count: events.length,
        last_seq: events.length > 0 ? events[events.length - 1].seq : after,
      });
    } catch (error: any) {
      console.error("[RunEvents] Error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get run events",
      });
    }
  });

  initializeEventStore().catch(console.error);
  
  initializeRedisSSE().then(() => {
    console.log("[RedisSSE] Initialized");
  }).catch(err => {
    console.warn("[RedisSSE] Not available (Redis may not be configured):", err.message);
  });

  initializeAgentSystem({ runSmokeTest: false }).then(result => {
    console.log(`[AgentSystem] Initialized: ${result.toolCount} tools, ${result.agentCount} agents`);
  }).catch(err => {
    console.error("[AgentSystem] Initialization failed:", err.message);
  });

  // ===== Simple Tools & Agents Endpoints =====
  
  // GET /tools - Return all 100 tools
  app.get("/tools", (_req: Request, res: Response) => {
    try {
      const tools = ALL_TOOLS.map(tool => ({
        name: tool.name,
        description: tool.description,
      }));
      
      res.json({
        success: true,
        count: tools.length,
        tools,
        categories: {
          safe: SAFE_TOOLS.map(t => t.name),
          system: SYSTEM_TOOLS.map(t => t.name),
        },
      });
    } catch (error: any) {
      console.error("[Tools] Error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to load tools",
      });
    }
  });

  // GET /agents - Return all 10 agents
  app.get("/agents", (_req: Request, res: Response) => {
    try {
      const agents = SPECIALIZED_AGENTS.map(agent => ({
        name: agent.name,
        description: agent.description,
        capabilities: agent.capabilities,
        tools: agent.tools,
      }));
      
      res.json({
        success: true,
        count: agents.length,
        agents,
      });
    } catch (error: any) {
      console.error("[Agents] Error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to load agents",
      });
    }
  });

  // GET /api/tools - Enhanced tool catalog with category metadata
  app.get("/api/tools", (_req: Request, res: Response) => {
    try {
      const categoryMap: Record<string, string[]> = {
        "Core": SAFE_TOOLS.map(t => t.name),
        "System": SYSTEM_TOOLS.map(t => t.name),
        "Web": ["browserNavigate", "browserClick", "browserType", "browserExtract", "browserScreenshot", "browserScroll", "browserClose", "webSearch", "webFetch", "webCrawl"],
        "Generation": ["imageGenerate", "codeGenerate", "textGenerate", "dataGenerate", "templateGenerate"],
        "Processing": ["textProcess", "dataTransform", "fileConvert", "imageProcess", "batchProcess"],
        "Data": ["dataAnalyze", "dataVisualize", "dataExport", "dataImport", "dataValidate"],
        "Document": ["documentCreate", "documentEdit", "documentParse", "documentMerge", "documentTemplate"],
        "Development": ["codeAnalyze", "codeFormat", "codeLint", "codeTest", "codeDebug"],
        "Diagram": ["diagramCreate", "flowchartGenerate", "mindmapCreate", "orgchartCreate"],
        "API": ["apiCall", "apiMock", "apiTest", "apiDocument"],
        "Productivity": ["taskCreate", "reminderSet", "noteCreate", "calendarEvent"],
        "Security": ["secretsManage", "accessControl", "auditLog", "encryptData"],
        "Automation": ["workflowCreate", "triggerSet", "scheduleTask", "batchRun"],
        "Database": ["queryExecute", "schemaManage", "dataBackup", "dataMigrate"],
        "Monitoring": ["metricsCollect", "alertCreate", "logAnalyze", "healthCheck"],
        "Memory": ["memoryStore", "memoryRetrieve", "contextManage", "sessionState"],
        "Reasoning": ["reason", "reflect", "verify"],
        "Orchestration": ["orchestrate", "workflow", "strategicPlan"],
        "Communication": ["decide", "clarify", "summarize", "explain"],
      };
      
      const categoryIcons: Record<string, string> = {
        "Core": "zap",
        "System": "terminal",
        "Web": "globe",
        "Generation": "sparkles",
        "Processing": "cog",
        "Data": "database",
        "Document": "file-text",
        "Development": "code",
        "Diagram": "git-branch",
        "API": "plug",
        "Productivity": "calendar",
        "Security": "shield",
        "Automation": "repeat",
        "Database": "hard-drive",
        "Monitoring": "activity",
        "Memory": "brain",
        "Reasoning": "lightbulb",
        "Orchestration": "layers",
        "Communication": "message-circle",
      };
      
      const tools = ALL_TOOLS.map(tool => {
        let category = "Utility";
        for (const [cat, toolNames] of Object.entries(categoryMap)) {
          if (toolNames.includes(tool.name)) {
            category = cat;
            break;
          }
        }
        return {
          name: tool.name,
          description: tool.description,
          category,
          icon: categoryIcons[category] || "wrench",
        };
      });
      
      const categories = Object.entries(categoryMap)
        .filter(([_, toolNames]) => toolNames.some(name => ALL_TOOLS.find(t => t.name === name)))
        .map(([name, _]) => ({
          name,
          icon: categoryIcons[name] || "folder",
          count: tools.filter(t => t.category === name).length,
        }));
      
      res.json({
        success: true,
        count: tools.length,
        tools,
        categories,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/agents - Alias for /agents
  app.get("/api/agents", (_req: Request, res: Response) => {
    try {
      const agents = SPECIALIZED_AGENTS;
      res.json({
        success: true,
        count: agents.length,
        agents,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ===== Python Agent v5.0 Endpoints =====
  
  // POST /api/python-agent/run - Execute the Python agent
  app.post("/api/python-agent/run", async (req: Request, res: Response) => {
    try {
      const { input, verbose = false, timeout = 60 } = req.body;
      
      if (!input || typeof input !== "string") {
        return res.status(400).json({
          success: false,
          error: "Missing or invalid 'input' field",
        });
      }
      
      const result = await runAgent(input, { verbose, timeout });
      res.json(result);
    } catch (error: any) {
      console.error("[PythonAgent] Run error:", error);
      
      if (error instanceof PythonAgentClientError) {
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({
          success: false,
          error: error.message,
          details: error.details,
        });
      }
      
      res.status(500).json({
        success: false,
        error: error.message || "Failed to execute Python agent",
      });
    }
  });

  // GET /api/python-agent/tools - List available tools
  app.get("/api/python-agent/tools", async (_req: Request, res: Response) => {
    try {
      const tools = await getTools();
      res.json({
        success: true,
        data: tools,
      });
    } catch (error: any) {
      console.error("[PythonAgent] Tools error:", error);
      
      if (error instanceof PythonAgentClientError) {
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({
          success: false,
          error: error.message,
        });
      }
      
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get Python agent tools",
      });
    }
  });

  // GET /api/python-agent/health - Check Python agent service health
  app.get("/api/python-agent/health", async (_req: Request, res: Response) => {
    try {
      const health = await pythonAgentHealthCheck();
      res.json({
        success: true,
        data: health,
      });
    } catch (error: any) {
      console.error("[PythonAgent] Health check error:", error);
      
      res.status(503).json({
        success: false,
        error: error.message || "Python agent service unavailable",
        status: "unhealthy",
      });
    }
  });

  // GET /api/python-agent/status - Quick availability check
  app.get("/api/python-agent/status", async (_req: Request, res: Response) => {
    const available = await isServiceAvailable();
    res.json({
      success: true,
      available,
      service: "python-agent-v5",
    });
  });

  // POST /api/python-agent/browse - Browse URL with Python agent
  app.post("/api/python-agent/browse", async (req: Request, res: Response) => {
    try {
      const result = await pythonAgentBrowse(req.body);
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof PythonAgentClientError) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /api/python-agent/search - Web search with Python agent
  app.post("/api/python-agent/search", async (req: Request, res: Response) => {
    try {
      const result = await pythonAgentSearch(req.body);
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof PythonAgentClientError) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /api/python-agent/document - Create document with Python agent
  app.post("/api/python-agent/document", async (req: Request, res: Response) => {
    try {
      const result = await pythonAgentCreateDocument(req.body);
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof PythonAgentClientError) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /api/python-agent/execute - Execute specific tool
  app.post("/api/python-agent/execute", async (req: Request, res: Response) => {
    try {
      const result = await pythonAgentExecuteTool(req.body);
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof PythonAgentClientError) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/python-agent/files - List files created by Python agent
  app.get("/api/python-agent/files", async (_req: Request, res: Response) => {
    try {
      const result = await pythonAgentListFiles();
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof PythonAgentClientError) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/python-agent/agent-status - Detailed agent status
  app.get("/api/python-agent/agent-status", async (_req: Request, res: Response) => {
    try {
      const result = await pythonAgentGetStatus();
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof PythonAgentClientError) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ===== Public Models Endpoint (for user-facing selector) =====
  app.get("/api/models/available", async (req: Request, res: Response) => {
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0"
    });
    try {
      const allModels = await storage.getAiModels();
      const models = allModels
        .filter((m: any) => m.isEnabled === "true")
        .sort((a: any, b: any) => (a.displayOrder || 0) - (b.displayOrder || 0))
        .map((m: any) => ({
          id: m.id,
          name: m.name,
          provider: m.provider,
          modelId: m.modelId,
          description: m.description,
          isEnabled: m.isEnabled,
          enabledAt: m.enabledAt,
          displayOrder: m.displayOrder || 0,
          icon: m.icon,
          modelType: m.modelType,
          contextWindow: m.contextWindow,
        }));
      res.json({ models });
    } catch (error: any) {
      console.error("[Models] Error fetching available models:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== AI Quality Stats & Content Filter Endpoints =====
  
  // GET /api/ai/quality-stats - Return quality statistics
  app.get("/api/ai/quality-stats", (req: Request, res: Response) => {
    try {
      const sinceParam = req.query.since as string | undefined;
      const since = sinceParam ? new Date(sinceParam) : undefined;
      
      const stats = llmGateway.getQualityStats(since);
      const filterStats = getFilterStats();
      
      res.json({
        success: true,
        data: {
          qualityStats: stats,
          filterStats,
        },
      });
    } catch (error: any) {
      console.error("[QualityStats] Error getting stats:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message || "Failed to get quality stats" 
      });
    }
  });

  // GET /api/ai/content-filter - Get current filter config
  app.get("/api/ai/content-filter", (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id || "anonymous";
      const config = getUserConfig(userId);
      
      res.json({
        success: true,
        data: config,
      });
    } catch (error: any) {
      console.error("[ContentFilter] Error getting config:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message || "Failed to get filter config" 
      });
    }
  });

  // PUT /api/ai/content-filter - Update filter config
  app.put("/api/ai/content-filter", (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id || "anonymous";
      const { enabled, sensitivityLevel, customPatterns } = req.body;
      
      // Validate sensitivity level
      if (sensitivityLevel && !["low", "medium", "high"].includes(sensitivityLevel)) {
        return res.status(400).json({
          success: false,
          error: "Invalid sensitivity level. Must be 'low', 'medium', or 'high'",
        });
      }
      
      // Validate custom patterns if provided
      if (customPatterns && Array.isArray(customPatterns)) {
        const validation = validatePatterns(customPatterns);
        if (!validation.valid) {
          return res.status(400).json({
            success: false,
            error: `Invalid regex patterns: ${validation.invalidPatterns.join(", ")}`,
          });
        }
      }
      
      const newConfig = setUserConfig(userId, {
        enabled: enabled !== undefined ? Boolean(enabled) : undefined,
        sensitivityLevel,
        customPatterns,
      });
      
      res.json({
        success: true,
        data: newConfig,
      });
    } catch (error: any) {
      console.error("[ContentFilter] Error updating config:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message || "Failed to update filter config" 
      });
    }
  });

  // GET /api/ai/content-filter/default - Get default filter config
  app.get("/api/ai/content-filter/default", (_req: Request, res: Response) => {
    try {
      const defaultConfig = getDefaultConfig();
      res.json({
        success: true,
        data: defaultConfig,
      });
    } catch (error: any) {
      res.status(500).json({ 
        success: false, 
        error: error.message || "Failed to get default config" 
      });
    }
  });

  // ===== Observability Endpoints =====
  
  // Initialize health monitoring
  initializeHealthMonitoring();
  
  // Start periodic connector health checks
  startPeriodicHealthCheck(60000);

  // GET /api/observability/logs - Query logs with filters
  app.get("/api/observability/logs", (req: Request, res: Response) => {
    try {
      const filters: LogFilters = {};
      
      if (req.query.level) {
        filters.level = req.query.level as "debug" | "info" | "warn" | "error";
      }
      if (req.query.component) {
        filters.component = req.query.component as string;
      }
      if (req.query.since) {
        filters.since = new Date(req.query.since as string);
      }
      if (req.query.requestId) {
        filters.requestId = req.query.requestId as string;
      }
      if (req.query.userId) {
        filters.userId = req.query.userId as string;
      }
      if (req.query.limit) {
        filters.limit = parseInt(req.query.limit as string, 10);
      }
      
      const logs = getLogs(filters);
      
      res.json({
        success: true,
        data: {
          logs,
          count: logs.length,
        },
      });
    } catch (error: any) {
      console.error("[Observability] Error getting logs:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get logs",
      });
    }
  });

  // GET /api/observability/health - Get all services health status
  app.get("/api/observability/health", (_req: Request, res: Response) => {
    try {
      const services = getAllServicesHealth();
      const overallStatus = getOverallStatus();
      
      res.json({
        success: true,
        data: {
          overall: overallStatus,
          services,
        },
      });
    } catch (error: any) {
      console.error("[Observability] Error getting health:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get health status",
      });
    }
  });

  // GET /api/observability/alerts - Get active alerts
  app.get("/api/observability/alerts", (req: Request, res: Response) => {
    try {
      const includeHistory = req.query.history === "true";
      const sinceParam = req.query.since as string | undefined;
      
      const activeAlerts = getActiveAlerts();
      const alertStats = getAlertStats();
      
      const response: any = {
        success: true,
        data: {
          active: activeAlerts,
          stats: alertStats,
        },
      };
      
      if (includeHistory) {
        const since = sinceParam ? new Date(sinceParam) : undefined;
        response.data.history = getAlertHistory(since);
      }
      
      res.json(response);
    } catch (error: any) {
      console.error("[Observability] Error getting alerts:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get alerts",
      });
    }
  });

  // POST /api/observability/alerts/:id/resolve - Resolve an alert
  app.post("/api/observability/alerts/:id/resolve", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const alert = resolveAlert(id);
      
      if (!alert) {
        return res.status(404).json({
          success: false,
          error: "Alert not found",
        });
      }
      
      res.json({
        success: true,
        data: alert,
      });
    } catch (error: any) {
      console.error("[Observability] Error resolving alert:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to resolve alert",
      });
    }
  });

  // GET /api/observability/stats - Get request and log stats
  app.get("/api/observability/stats", (_req: Request, res: Response) => {
    try {
      const logStats = getLogStats();
      const requestStats = getRequestStats();
      const activeReqs = getActiveRequests();
      
      res.json({
        success: true,
        data: {
          logs: logStats,
          requests: {
            ...requestStats,
            activeDetails: activeReqs,
          },
        },
      });
    } catch (error: any) {
      console.error("[Observability] Error getting stats:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get stats",
      });
    }
  });

  // ===== Connector Stats Endpoints =====
  
  // GET /api/connectors/stats - Get all connector statistics
  app.get("/api/connectors/stats", (_req: Request, res: Response) => {
    try {
      const stats = getAllConnectorStats();
      const healthSummary = getHealthSummary();
      
      res.json({
        success: true,
        data: {
          connectors: stats,
          health: healthSummary,
        },
      });
    } catch (error: any) {
      console.error("[Connectors] Error getting stats:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get connector stats",
      });
    }
  });

  // GET /api/connectors/:name/stats - Get single connector statistics
  app.get("/api/connectors/:name/stats", (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      
      if (!isValidConnector(name)) {
        return res.status(400).json({
          success: false,
          error: `Invalid connector name: ${name}. Valid connectors: gmail, gemini, xai, database, forms`,
        });
      }
      
      const stats = getConnectorStats(name as ConnectorName);
      const health = checkConnectorHealth(name as ConnectorName);
      
      res.json({
        success: true,
        data: {
          stats,
          health,
        },
      });
    } catch (error: any) {
      console.error("[Connectors] Error getting connector stats:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to get connector stats",
      });
    }
  });

  // POST /api/connectors/:name/reset - Reset stats for connector (admin only)
  app.post("/api/connectors/:name/reset", (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const user = (req as any).user;
      
      // Check admin role
      if (!user?.roles?.includes("admin")) {
        return res.status(403).json({
          success: false,
          error: "Admin access required",
        });
      }
      
      if (!isValidConnector(name)) {
        return res.status(400).json({
          success: false,
          error: `Invalid connector name: ${name}. Valid connectors: gmail, gemini, xai, database, forms`,
        });
      }
      
      resetConnectorStats(name as ConnectorName);
      
      res.json({
        success: true,
        message: `Stats reset for connector: ${name}`,
      });
    } catch (error: any) {
      console.error("[Connectors] Error resetting stats:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to reset connector stats",
      });
    }
  });

  const objectStorageService = new ObjectStorageService();

  browserSessionManager.addGlobalEventListener((event: SessionEvent) => {
    broadcastBrowserEvent(event.sessionId, event);
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws/agent" });
  
  createAuthenticatedWebSocketHandler(wss, true, (ws: AuthenticatedWebSocket) => {
    let subscribedRunId: string | null = null;
    
    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === "subscribe" && data.runId) {
          subscribedRunId = data.runId;
          if (!agentClients.has(data.runId)) {
            agentClients.set(data.runId, new Set());
          }
          agentClients.get(data.runId)!.add(ws);
        }
      } catch (e) {
        console.error("WS message parse error:", e);
      }
    });
    
    ws.on("close", () => {
      if (subscribedRunId) {
        const clients = agentClients.get(subscribedRunId);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) {
            agentClients.delete(subscribedRunId);
          }
        }
      }
    });
  });

  const browserWss = new WebSocketServer({ server: httpServer, path: "/ws/browser" });

  const fileStatusWss = new WebSocketServer({ server: httpServer, path: "/ws/file-status" });

  createAuthenticatedWebSocketHandler(fileStatusWss, true, (ws: AuthenticatedWebSocket) => {
    let subscribedFileIds: Set<string> = new Set();
    
    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === "subscribe" && data.fileId) {
          subscribedFileIds.add(data.fileId);
          if (!fileStatusClients.has(data.fileId)) {
            fileStatusClients.set(data.fileId, new Set());
          }
          fileStatusClients.get(data.fileId)!.add(ws);
          
          ws.send(JSON.stringify({ type: "subscribed", fileId: data.fileId }));
          
          const job = fileProcessingQueue.getJob(data.fileId);
          if (job && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'file_status',
              fileId: job.fileId,
              status: job.status,
              progress: job.progress,
              error: job.error,
            }));
          }
        } else if (data.type === "unsubscribe" && data.fileId) {
          subscribedFileIds.delete(data.fileId);
          const clients = fileStatusClients.get(data.fileId);
          if (clients) {
            clients.delete(ws);
            if (clients.size === 0) {
              fileStatusClients.delete(data.fileId);
            }
          }
        }
      } catch (e) {
        console.error("File status WS message parse error:", e);
      }
    });
    
    ws.on("close", () => {
      const fileIds = Array.from(subscribedFileIds);
      for (const fileId of fileIds) {
        const clients = fileStatusClients.get(fileId);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) {
            fileStatusClients.delete(fileId);
          }
        }
      }
    });
  });

  fileProcessingQueue.setStatusChangeHandler((update: FileStatusUpdate) => {
    broadcastFileStatus(update);
  });

  fileProcessingQueue.setProcessCallback(async (job) => {
    try {
      await storage.updateFileJobStatus(job.fileId, "processing");
      await storage.updateFileProgress(job.fileId, 10);
      fileProcessingQueue.updateProgress(job.fileId, 10);

      const objectFile = await objectStorageService.getObjectEntityFile(job.storagePath);
      const content = await objectStorageService.getFileContent(objectFile);
      await storage.updateFileProgress(job.fileId, 30);
      fileProcessingQueue.updateProgress(job.fileId, 30);

      const result = await processDocument(content, job.mimeType, job.fileName);
      await storage.updateFileProgress(job.fileId, 50);
      fileProcessingQueue.updateProgress(job.fileId, 50);

      const chunks = chunkText(result.text, 1500, 150);
      await storage.updateFileProgress(job.fileId, 60);
      fileProcessingQueue.updateProgress(job.fileId, 60);

      const texts = chunks.map(c => c.content);
      const embeddings = await generateEmbeddingsBatch(texts);
      await storage.updateFileProgress(job.fileId, 80);
      fileProcessingQueue.updateProgress(job.fileId, 80);

      const chunksWithEmbeddings = chunks.map((chunk, i) => ({
        fileId: job.fileId,
        content: chunk.content,
        embedding: embeddings[i],
        chunkIndex: chunk.chunkIndex,
        pageNumber: chunk.pageNumber || null,
        metadata: null,
      }));

      await storage.createFileChunks(chunksWithEmbeddings);
      await storage.updateFileProgress(job.fileId, 95);
      fileProcessingQueue.updateProgress(job.fileId, 95);

      await storage.updateFileCompleted(job.fileId);
      await storage.updateFileJobStatus(job.fileId, "completed");
      
      console.log(`[FileQueue] File ${job.fileId} processed: ${chunks.length} chunks created`);
    } catch (error: any) {
      console.error(`[FileQueue] Error processing file ${job.fileId}:`, error);
      await storage.updateFileError(job.fileId, error.message || "Unknown error");
      await storage.updateFileJobStatus(job.fileId, "failed", error.message);
      throw error;
    }
  });
  
  createAuthenticatedWebSocketHandler(browserWss, true, (ws: AuthenticatedWebSocket) => {
    let subscribedSessionId: string | null = null;
    
    ws.on("message", async (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === "subscribe" && data.sessionId) {
          subscribedSessionId = data.sessionId;
          if (!browserClients.has(data.sessionId)) {
            browserClients.set(data.sessionId, new Set());
          }
          browserClients.get(data.sessionId)!.add(ws);
          
          ws.send(JSON.stringify({ type: "subscribed", sessionId: data.sessionId }));
          
          try {
            const screenshot = await browserSessionManager.getScreenshot(data.sessionId);
            if (screenshot && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                messageType: "browser_event",
                eventType: "observation",
                sessionId: data.sessionId,
                timestamp: new Date(),
                data: { type: "screenshot", screenshot }
              }));
            }
          } catch (e) {
          }
        }
      } catch (e) {
        console.error("Browser WS message parse error:", e);
      }
    });
    
    ws.on("close", () => {
      if (subscribedSessionId) {
        const clients = browserClients.get(subscribedSessionId);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) {
            browserClients.delete(subscribedSessionId);
          }
        }
      }
    });
  });

  return httpServer;
}

function broadcastBrowserEvent(sessionId: string, event: SessionEvent) {
  const clients = browserClients.get(sessionId);
  if (!clients) return;
  
  const message = JSON.stringify({ 
    messageType: "browser_event", 
    eventType: event.type,
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    data: event.data
  });
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function broadcastAgentUpdate(runId: string, update: StepUpdate) {
  const clients = agentClients.get(runId);
  if (!clients) return;
  
  const message = JSON.stringify({ type: "step_update", ...update });
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function broadcastFileStatus(update: FileStatusUpdate) {
  const clients = fileStatusClients.get(update.fileId);
  if (!clients) return;
  
  const message = JSON.stringify(update);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}
