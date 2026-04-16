import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { AgentV2 } from "../agent/sandbox/agentV2";
import { taskPlanner } from "../agent/sandbox/taskPlanner";
import { 
  ToolRegistry, DocumentTool, SearchTool, BrowserTool, MessageTool, ResearchTool,
  PlanTool, SlidesTool, WebDevTool, ScheduleTool, ExposeTool, GenerateTool,
  ShellTool, FileTool, PythonTool
} from "../agent/sandbox/tools";
import { sandboxService } from "../agent/sandbox/sandboxService";
import type { ToolCategory } from "../agent/sandbox/agentTypes";

const RunAgentRequestSchema = z.object({
  input: z.string().min(1, "Input is required"),
  sessionId: z.string().optional(),
  config: z.object({
    verbose: z.boolean().optional(),
    maxIterations: z.number().int().positive().max(50).optional(),
    timeout: z.number().int().positive().max(120000).optional(),
  }).optional(),
});

const ExecuteToolRequestSchema = z.object({
  toolName: z.string().min(1),
  params: z.record(z.any()).default({}),
});

const CreatePlanRequestSchema = z.object({
  input: z.string().min(1),
});

const DetectIntentRequestSchema = z.object({
  text: z.string().min(1),
});

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ 
      success: false, 
      error: "Authentication required" 
    });
  }
  next();
}

function createSafeToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  // Core safe tools (no system access)
  registry.register(new DocumentTool());
  registry.register(new SearchTool());
  registry.register(new BrowserTool());
  registry.register(new MessageTool());
  registry.register(new ResearchTool());
  // Extended tools
  registry.register(new PlanTool());
  registry.register(new SlidesTool());
  registry.register(new WebDevTool());
  registry.register(new ScheduleTool());
  registry.register(new ExposeTool());
  registry.register(new GenerateTool());
  return registry;
}

function createFullToolRegistry(): ToolRegistry {
  const registry = createSafeToolRegistry();
  // System tools - ONLY for authenticated, sandboxed access
  registry.register(new ShellTool());
  registry.register(new FileTool());
  registry.register(new PythonTool());
  return registry;
}

// Use arrays to avoid Set iteration issues with TypeScript
const SAFE_TOOLS_ARRAY = [
  "search", "browser", "document", "message", "research",
  "plan", "slides", "webdev_init_project", "schedule", "expose", "generate"
];

const SYSTEM_TOOLS_ARRAY = ["shell", "file", "python"];

const ALL_TOOLS_ARRAY = [...SAFE_TOOLS_ARRAY, ...SYSTEM_TOOLS_ARRAY];

// Sets for O(1) lookup
const SAFE_TOOLS = new Set(SAFE_TOOLS_ARRAY);
const SYSTEM_TOOLS = new Set(SYSTEM_TOOLS_ARRAY);
const ALL_TOOLS = new Set(ALL_TOOLS_ARRAY);

export function createSandboxAgentRouter() {
  const router = Router();

  router.post("/sandbox/agent/run", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = RunAgentRequestSchema.parse(req.body);
      const user = (req as any).user;
      const userId = user?.claims?.sub || user?.id || "anonymous";
      
      const safeRegistry = createSafeToolRegistry();
      
      const agent = new AgentV2({
        ...validated.config,
        name: `SafeAgent-${userId}`,
        maxIterations: Math.min(validated.config?.maxIterations || 20, 50),
        timeout: Math.min(validated.config?.timeout || 60000, 120000),
      });
      
      (agent as any).tools = safeRegistry;
      
      const result = await agent.run(validated.input);
      const status = agent.getStatus();
      
      res.json({
        success: true,
        result,
        status,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          success: false, 
          error: "Validation error",
          details: error.errors 
        });
      }
      console.error("[SandboxAgent] Run error:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message || "Internal server error" 
      });
    }
  });

  router.post("/sandbox/agent/tool", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = ExecuteToolRequestSchema.parse(req.body);
      
      if (!ALL_TOOLS.has(validated.toolName)) {
        return res.status(403).json({
          success: false,
          error: `Tool '${validated.toolName}' is not available. Available tools: ${ALL_TOOLS_ARRAY.join(", ")}`
        });
      }
      
      const registry = createFullToolRegistry();
      const result = await registry.execute(validated.toolName, validated.params);
      
      res.json({
        success: result.success,
        result,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          success: false, 
          error: "Validation error",
          details: error.errors 
        });
      }
      console.error("[SandboxAgent] Tool execution error:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message || "Internal server error" 
      });
    }
  });

  router.post("/sandbox/agent/plan", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = CreatePlanRequestSchema.parse(req.body);
      const plan = await taskPlanner.createPlan(validated.input);
      
      plan.phases.forEach(phase => {
        phase.steps = phase.steps.filter(step => SAFE_TOOLS.has(step.tool));
      });
      plan.phases = plan.phases.filter(phase => phase.steps.length > 0);
      
      res.json({
        success: true,
        plan,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          success: false, 
          error: "Validation error",
          details: error.errors 
        });
      }
      console.error("[SandboxAgent] Plan creation error:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message || "Internal server error" 
      });
    }
  });

  router.post("/sandbox/agent/detect-intent", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = DetectIntentRequestSchema.parse(req.body);
      const intentResult = await taskPlanner.detectIntent(validated.text);
      
      res.json({
        success: true,
        ...intentResult,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          success: false, 
          error: "Validation error",
          details: error.errors 
        });
      }
      console.error("[SandboxAgent] Intent detection error:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message || "Internal server error" 
      });
    }
  });

  router.get("/sandbox/agent/tools", async (_req: Request, res: Response) => {
    try {
      const registry = createFullToolRegistry();
      const tools = registry.listToolsWithInfo();
      
      res.json({
        success: true,
        tools,
        count: tools.length,
        safeTools: SAFE_TOOLS_ARRAY,
        systemTools: SYSTEM_TOOLS_ARRAY,
        note: "All 14 tools available. System tools (shell, file, python) require authentication."
      });
    } catch (error: any) {
      console.error("[SandboxAgent] List tools error:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message || "Internal server error" 
      });
    }
  });

  router.get("/sandbox/agent/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub || user?.id || "anonymous";
      
      res.json({
        success: true,
        status: {
          userId,
          availableTools: ALL_TOOLS_ARRAY,
          safeTools: SAFE_TOOLS_ARRAY,
          systemTools: SYSTEM_TOOLS_ARRAY,
          sandboxEnabled: true,
        },
      });
    } catch (error: any) {
      console.error("[SandboxAgent] Status error:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message || "Internal server error" 
      });
    }
  });

  router.get("/sandbox/session/:sessionId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const sandbox = sandboxService.getSession(sessionId);
      
      if (!sandbox) {
        return res.status(404).json({ 
          success: false, 
          error: "Session not found" 
        });
      }
      
      const status = await sandbox.getStatus();
      res.json({
        success: true,
        sessionId,
        status,
      });
    } catch (error: any) {
      console.error("[SandboxAgent] Session status error:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message || "Internal server error" 
      });
    }
  });

  router.post("/sandbox/session", requireAuth, async (_req: Request, res: Response) => {
    try {
      const sessionId = await sandboxService.createSession();
      const sandbox = sandboxService.getSession(sessionId);
      const status = sandbox ? await sandbox.getStatus() : null;
      
      res.json({
        success: true,
        sessionId,
        status,
      });
    } catch (error: any) {
      console.error("[SandboxAgent] Create session error:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message || "Internal server error" 
      });
    }
  });

  router.delete("/sandbox/session/:sessionId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const result = await sandboxService.destroySession(sessionId);
      
      res.json({
        success: result,
        message: result ? "Session destroyed" : "Session not found",
      });
    } catch (error: any) {
      console.error("[SandboxAgent] Destroy session error:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message || "Internal server error" 
      });
    }
  });

  return router;
}
