/**
 * OpenClaw 500 Capabilities Verification API
 * Endpoints for querying, verifying, and reporting on all 500 capabilities.
 */

import { Router, Request, Response } from "express";
import {
  DEFAULT_OPENCLAW_RELEASE_TAG,
  OPENCLAW_RELEASE_URL,
  OPENCLAW_RELEASE_VERSION,
} from "@shared/openclawRelease";
import {
  OPENCLAW_500,
  getOpenClawStats,
  getCapabilityById,
  getCapabilitiesByCategory,
  getGaps,
  type OpenClawCategory,
} from "../data/openClaw500Mapping";
import {
  verifyCapability,
  verifyBatch,
  generateReport,
  getQuickStats,
} from "../services/openClawVerifier";
import {
  listOpenClaw1000Capabilities,
  getOpenClaw1000Capability,
  getOpenClaw1000QuickStats,
  verifyOpenClaw1000Capability,
  verifyOpenClaw1000Batch,
  generateOpenClaw1000Report,
  getOpenClaw1000ExecutionRoadmap,
} from "../services/openClaw1000Service";
import { requireAuth } from "../middleware/auth";
import { getSecureUserId } from "../lib/anonUserHelper";
import { getUnifiedModelCatalog } from "../services/modelCatalogService";
import { getUserId } from "../types/express";
import * as openclaw from "../agent/openclaw";
import { getOpenClawHealth } from "../openclaw/lib/healthCheck";
import { usageQuotaService } from "../services/usageQuotaService";


const router = Router();

/**
 * GET /api/openclaw/capabilities
 * Returns all 500 capabilities with optional filters.
 * Query params: ?category=academic_research&status=implemented
 */
router.get("/capabilities", (req: Request, res: Response) => {
  try {
    const { category, status } = req.query;

    let capabilities = OPENCLAW_500;

    if (category && typeof category === "string") {
      capabilities = capabilities.filter((c) => c.category === category);
    }

    if (status && typeof status === "string") {
      capabilities = capabilities.filter((c) => c.status === status);
    }

    const stats = getOpenClawStats();

    res.json({
      success: true,
      total: capabilities.length,
      stats,
      capabilities,
    });
  } catch (error: any) {
    console.error("[OpenClaw] Error listing capabilities:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/openclaw/capabilities/:id
 * Returns a single capability by ID.
 */
router.get("/capabilities/:id", (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: "Invalid capability ID" });
    }

    const capability = getCapabilityById(id);
    if (!capability) {
      return res.status(404).json({ success: false, error: `Capability ${id} not found` });
    }

    res.json({ success: true, capability });
  } catch (error: any) {
    console.error("[OpenClaw] Error getting capability:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/openclaw/stats
 * Quick stats without full verification.
 */
router.get("/stats", (_req: Request, res: Response) => {
  try {
    const stats = getQuickStats();
    res.json({ success: true, ...stats });
  } catch (error: any) {
    console.error("[OpenClaw] Error getting stats:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/openclaw/gaps
 * Returns only stub/missing capabilities.
 */
router.get("/gaps", (req: Request, res: Response) => {
  try {
    const { category } = req.query;
    let gaps = getGaps();

    if (category && typeof category === "string") {
      gaps = gaps.filter((g) => g.category === category);
    }

    const byCategory = gaps.reduce((acc, g) => {
      if (!acc[g.category]) acc[g.category] = [];
      acc[g.category].push(g);
      return acc;
    }, {} as Record<string, typeof gaps>);

    res.json({
      success: true,
      total: gaps.length,
      byCategory,
      gaps,
    });
  } catch (error: any) {
    console.error("[OpenClaw] Error getting gaps:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/openclaw/verify/:id
 * Run verification for a single capability.
 */
router.post("/verify/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: "Invalid capability ID" });
    }

    const result = await verifyCapability(id);
    res.json({ success: true, result });
  } catch (error: any) {
    console.error("[OpenClaw] Error verifying capability:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/openclaw/verify/batch
 * Run batch verification.
 * Body: { ids?: number[], category?: string }
 */
router.post("/verify/batch", requireAuth, async (req: Request, res: Response) => {
  try {
    const { ids, category } = req.body || {};

    const results = await verifyBatch({
      ids: ids as number[] | undefined,
      category: category as OpenClawCategory | undefined,
    });

    const summary = {
      total: results.length,
      passed: results.filter((r) => r.verifyStatus === "PASS").length,
      failed: results.filter((r) => r.verifyStatus === "FAIL").length,
      skipped: results.filter((r) => r.verifyStatus === "SKIP").length,
      stubs: results.filter((r) => r.verifyStatus === "STUB").length,
      errors: results.filter((r) => r.verifyStatus === "ERROR").length,
    };

    res.json({ success: true, summary, results });
  } catch (error: any) {
    console.error("[OpenClaw] Error in batch verification:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/openclaw/report
 * Full 500-capability verification report.
 */
router.get("/report", async (_req: Request, res: Response) => {
  try {
    const report = await generateReport();
    res.json({ success: true, report });
  } catch (error: any) {
    console.error("[OpenClaw] Error generating report:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/openclaw/categories
 * Returns capability breakdown by category.
 */
router.get("/categories", (_req: Request, res: Response) => {
  try {
    const categories: OpenClawCategory[] = [
      "academic_research",
      "web_realtime_search",
      "browser_automation",
      "documents_and_library",
      "agent_autonomy_multiagent",
      "platform_messaging_ops_security",
    ];

    const breakdown = categories.map((cat) => {
      const caps = getCapabilitiesByCategory(cat);
      return {
        category: cat,
        total: caps.length,
        implemented: caps.filter((c) => c.status === "implemented").length,
        partial: caps.filter((c) => c.status === "partial").length,
        stub: caps.filter((c) => c.status === "stub").length,
        missing: caps.filter((c) => c.status === "missing").length,
        coveragePercent: Math.round(
          ((caps.filter((c) => c.status === "implemented" || c.status === "partial").length) / caps.length) * 1000
        ) / 10,
      };
    });

    res.json({ success: true, categories: breakdown });
  } catch (error: any) {
    console.error("[OpenClaw] Error getting categories:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * =========================
 * OpenClaw 1000 Endpoints
 * =========================
 */

router.get("/capabilities-1000", (req: Request, res: Response) => {
  try {
    const { category, status } = req.query;
    const capabilities = listOpenClaw1000Capabilities({
      category: typeof category === "string" ? category : undefined,
      status: typeof status === "string" ? status : undefined,
    });

    res.json({
      success: true,
      total: capabilities.length,
      stats: getOpenClaw1000QuickStats(),
      capabilities,
    });
  } catch (error: any) {
    console.error("[OpenClaw1000] Error listing capabilities:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/capabilities-1000/:id", (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: "Invalid capability ID" });
    }

    const capability = getOpenClaw1000Capability(id);
    if (!capability) {
      return res.status(404).json({ success: false, error: `Capability ${id} not found` });
    }

    res.json({ success: true, capability });
  } catch (error: any) {
    console.error("[OpenClaw1000] Error getting capability:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/stats-1000", (_req: Request, res: Response) => {
  try {
    res.json({ success: true, ...getOpenClaw1000QuickStats() });
  } catch (error: any) {
    console.error("[OpenClaw1000] Error getting stats:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/verify-1000/:id([0-9]+)", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: "Invalid capability ID" });
    }

    const result = await verifyOpenClaw1000Capability(id);
    res.json({ success: true, result });
  } catch (error: any) {
    console.error("[OpenClaw1000] Error verifying capability:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/verify-1000/batch", requireAuth, async (req: Request, res: Response) => {
  try {
    const { ids, category } = req.body || {};
    const results = await verifyOpenClaw1000Batch({
      ids: Array.isArray(ids) ? ids : undefined,
      category: typeof category === "string" ? category : undefined,
    });

    const summary = {
      total: results.length,
      passed: results.filter((r) => r.verifyStatus === "PASS").length,
      failed: results.filter((r) => r.verifyStatus === "FAIL").length,
      skipped: results.filter((r) => r.verifyStatus === "SKIP").length,
      stubs: results.filter((r) => r.verifyStatus === "STUB").length,
      errors: results.filter((r) => r.verifyStatus === "ERROR").length,
    };

    res.json({ success: true, summary, results });
  } catch (error: any) {
    console.error("[OpenClaw1000] Error in batch verification:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/report-1000", async (_req: Request, res: Response) => {
  try {
    const report = await generateOpenClaw1000Report();
    res.json({ success: true, report });
  } catch (error: any) {
    console.error("[OpenClaw1000] Error generating report:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/categories-1000", (_req: Request, res: Response) => {
  try {
    const allCapabilities = listOpenClaw1000Capabilities();
    const categories = [...new Set(allCapabilities.map((c) => c.category))];
    const breakdown = categories.map((cat) => {
      const caps = allCapabilities.filter((capability) => capability.category === cat);
      return {
        category: cat,
        total: caps.length,
        implemented: caps.filter((c) => c.status === "implemented").length,
        partial: caps.filter((c) => c.status === "partial").length,
        stub: caps.filter((c) => c.status === "stub").length,
        missing: caps.filter((c) => c.status === "missing").length,
        coveragePercent: Math.round(
          ((caps.filter((c) => c.status === "implemented" || c.status === "partial").length) / caps.length) * 1000
        ) / 10,
      };
    });

    res.json({ success: true, categories: breakdown });
  } catch (error: any) {
    console.error("[OpenClaw1000] Error getting categories:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/roadmap-1000", (req: Request, res: Response) => {
  try {
    const startIdRaw = typeof req.query.startId === "string" ? Number.parseInt(req.query.startId, 10) : 1;
    const limitRaw = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : 50;

    const roadmap = getOpenClaw1000ExecutionRoadmap({
      startId: Number.isFinite(startIdRaw) ? startIdRaw : 1,
      limit: Number.isFinite(limitRaw) ? limitRaw : 50,
    });

    res.json({ success: true, roadmap });
  } catch (error: any) {
    console.error("[OpenClaw1000] Error generating roadmap:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

import {
  OPENCLAW_COMMIT,
  OPENCLAW_RELEASE_DATE,
  OPENCLAW_VERSION,
  getEnabledFeatures,
} from "../openclaw/fusion/v2026_4_3";
import { getTaskBoard } from "../openclaw/fusion/v2026_4_3/taskBoard";
import { getGatewayResilience } from "../openclaw/fusion/v2026_4_3/gatewayResilience";
import { getModelSwitchQueue } from "../openclaw/fusion/v2026_4_3/modelSwitchQueue";

router.get("/version", (_req: Request, res: Response) => {
  res.json({
    version: OPENCLAW_VERSION,
    features: getEnabledFeatures(),
    commit: OPENCLAW_COMMIT,
    releaseDate: OPENCLAW_RELEASE_DATE,
  });
});

router.get("/tasks", requireAuth, (req: Request, res: Response) => {
  try {
    const sessionId = (req as any).sessionID || 'default';
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const board = getTaskBoard();
    const tasks = board.getRecentTasks(sessionId, limit);
    const stats = board.getStats();
    const fallbackCount = board.getAgentFallbackCount(sessionId);

    res.json({
      success: true,
      tasks,
      stats,
      fallbackCount,
      sessionId,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/tasks", requireAuth, (req: Request, res: Response) => {
  try {
    const sessionId = (req as any).sessionID || 'default';
    const { title, agentId } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, error: 'title is required' });
    }
    const board = getTaskBoard();
    const task = board.createTask(sessionId, title, agentId);
    res.json({ success: true, task });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.patch("/tasks/:taskId", requireAuth, (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { status, result, error, progress, metadata } = req.body;
    const board = getTaskBoard();
    const task = board.updateTask(taskId, { status, result, error, progress, metadata });
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    res.json({ success: true, task });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete("/tasks/:taskId", requireAuth, (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const board = getTaskBoard();
    const cancelled = board.cancelTask(taskId);
    res.json({ success: true, cancelled });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/gateway/health", (_req: Request, res: Response) => {
  try {
    const resilience = getGatewayResilience();
    const report = resilience.getHealthReport();
    res.json({ success: true, facades: report });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/model/switch", requireAuth, (req: Request, res: Response) => {
  try {
    const { sessionId, fromModel, toModel } = req.body;
    if (!sessionId || !toModel) {
      return res.status(400).json({ success: false, error: 'sessionId and toModel are required' });
    }
    const queue = getModelSwitchQueue();
    const request = queue.queueModelSwitch(sessionId, fromModel || 'unknown', toModel);
    res.json({ success: true, request, busy: queue.isRunBusy(sessionId) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export function createOpenClawRouter(): Router {
  const runtimeRouter = Router();

  try {
    // `openclaw` and `requireAuth` are imported statically at the top of
    // the file. The previous CJS `require()` calls here crashed under ESM
    // ("require is not defined") because tsx loads this file as an ES
    // module. Static imports work in both CJS and ESM.
    openclaw.initializeOpenClawTools();

    runtimeRouter.get("/status", (_req: Request, res: Response) => {
      res.json(openclaw.getOpenClawStatus());
    });

    runtimeRouter.get("/tools", (req: Request, res: Response) => {
      const plan = (req.query.plan as string) || "free";
      const tools = openclaw.getOpenClawToolsForUser(plan);
      res.json({
        plan,
        count: tools.length,
        tools: tools.map((t: any) => ({
          name: t.name,
          description: t.description,
        })),
      });
    });

    runtimeRouter.get("/catalog", (_req: Request, res: Response) => {
      res.json({
        sections: openclaw.getCatalogSections(),
      });
    });

    runtimeRouter.get("/system-prompt", (req: Request, res: Response) => {
      const tier = (req.query.tier as any) || "pro";
      const citations = req.query.citations !== "false";
      res.json({
        prompt: openclaw.buildOpenClawSystemPromptSection({
          tier,
          citationsEnabled: citations,
        }),
      });
    });

    runtimeRouter.post("/check-tool", requireAuth, (req: Request, res: Response) => {
      const { toolName, plan } = req.body || {};
      if (!toolName || !plan) {
        return res.status(400).json({ error: "toolName and plan are required" });
      }
      res.json({
        toolName,
        plan,
        allowed: openclaw.isToolAvailableForPlan(toolName, plan),
        allTools: openclaw.getToolsForPlan(plan),
      });
    });

    runtimeRouter.post("/compact", requireAuth, async (req: Request, res: Response) => {
      try {
        const { messages, overrides } = req.body || {};
        if (!Array.isArray(messages)) {
          return res.status(400).json({ error: "messages array is required" });
        }
        const result = await openclaw.handleCompaction(messages, overrides);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });
  } catch (err: any) {
    console.warn(`[OpenClaw Runtime] Failed to initialize: ${err.message}`);
    runtimeRouter.use((_req: Request, res: Response) => {
      res.status(503).json({ error: "OpenClaw runtime not available" });
    });
  }

  return runtimeRouter;
}

/**
 * GET /api/openclaw/health
 * Runtime health check for all OpenClaw modules.
 */
router.get("/health", (_req: Request, res: Response) => {
  try {
    // `getOpenClawHealth` is now imported statically at the top of the
    // file — the old `require()` here crashed under ESM.
    const health = getOpenClawHealth();
    const httpStatus = health.status === "unhealthy" ? 503 : 200;
    res.status(httpStatus).json({ success: true, ...health });
  } catch (error: any) {
    res.status(503).json({ success: false, status: "unhealthy", error: error.message });
  }
});

router.get("/instance/status", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req) || "anon_" + (req.ip || "unknown").replace(/[:.]/g, "_");

    const instanceId = `oc_${Buffer.from(userId).toString("base64url").slice(0, 16)}`;
    const catalog = await getUnifiedModelCatalog({ userId });
    const stats = getOpenClawStats();
    const uptimeMs = process.uptime() * 1000;
    const models = catalog.models.map((model) => ({
      id: model.modelId,
      name: model.name,
      provider: model.providerDisplayName,
      enabled: model.availableToUser,
      tier: model.tier,
      contextWindow: model.contextWindow,
      description: model.description,
      requiresUpgrade: model.requiresUpgrade,
      logoUrl: model.logoUrl,
    }));

    const fusionModules = [
      "task-board",
      "searxng-search",
      "model-switch-queue",
      "zai-models",
      "gateway-resilience",
      "commands-list-rpc",
      "native-exec-api",
      "desktop-local-mode",
      "unified-model-catalog",
      "unified-quota-billing",
    ];

    res.json({
      version: OPENCLAW_RELEASE_VERSION,
      latestVersion: OPENCLAW_RELEASE_VERSION,
      instanceId,
      userId: userId.slice(0, 20) + "...",
      uptime: uptimeMs,
      status: "running",
      capabilities: stats.total || 500,
      models,
      fusionModules,
      toolsRegistered: 138,
      agentsRegistered: 10,
      isShared: false,
      lastHealthCheck: new Date().toISOString(),
      meta: {
        unified: true,
        plan: catalog.userAccess.plan,
        isAdmin: catalog.userAccess.isAdmin,
        isPaid: catalog.userAccess.isPaid,
        defaultModelId: catalog.defaultModel?.modelId || catalog.defaultModelId,
        refreshedAt: catalog.refreshedAt,
      },
    });
  } catch (error: any) {
    console.error("[OpenClaw] Error getting instance status:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/instance/models", (req: Request, res: Response) => {
  try {
    const { modelId, enabled } = req.body || {};
    if (!modelId || typeof enabled !== "boolean") {
      return res.status(400).json({ success: false, error: "modelId and enabled are required" });
    }
    console.log(`[OpenClaw] Model ${modelId} ${enabled ? "enabled" : "disabled"} by user`);
    res.json({ success: true, modelId, enabled });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/instance/check-update", (_req: Request, res: Response) => {
  try {
    const currentVersion = OPENCLAW_RELEASE_VERSION;
    const latestVersion = OPENCLAW_RELEASE_VERSION;
    res.json({
      success: true,
      currentVersion,
      latestVersion,
      updateAvailable: currentVersion !== latestVersion,
      releaseUrl: OPENCLAW_RELEASE_URL,
      changelog: [
        "Unified model catalog between OpenClaw and ILIAGPT",
        "Unified quota and billing across chat, web runtime, and desktop native mode",
        "Extended gateway compatibility for the latest OpenClaw control UI",
        "Native runtime bridge and desktop local execution hardening",
        "Release metadata aligned to the bundled OpenClaw build",
      ],
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

import {
  getOrCreateInstance,
  getAllInstances,
  updateInstanceStatus,
  getUserTokenHistory,
  getAdminConfig,
  updateAdminConfig,
  deleteInstance,
} from "../services/openclawInstanceService";
import { users } from "@shared/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "carrerajorge874@gmail.com").toLowerCase().trim();

function isAdminUser(req: Request): boolean {
  const user = (req as any).user;
  if (!user) return false;
  const email = (user.email || "").toLowerCase().trim();
  const role = (user.role || "").toLowerCase();
  return email === ADMIN_EMAIL || role === "admin";
}

async function buildUnifiedOpenClawBudget(userId: string) {
  const quota = await usageQuotaService.getUnifiedQuotaSnapshot(userId);
  return {
    unified: true as const,
    scope: "shared_global",
    allowed:
      quota.blockingState === "ok" &&
      quota.requests.allowed &&
      quota.daily.allowed &&
      quota.monthly.allowed,
    blockingState: quota.blockingState,
    used: quota.monthly.used,
    limit: quota.monthly.limit,
    remaining: quota.monthly.remaining,
    resetAt: quota.monthly.resetAt?.toISOString?.() || null,
    requestLimit: {
      allowed: quota.requests.allowed,
      remaining: quota.requests.remaining,
      limit: quota.requests.limit,
      resetAt: quota.requests.resetAt?.toISOString?.() || null,
    },
    daily: {
      allowed: quota.daily.allowed,
      resetAt: quota.daily.resetAt?.toISOString?.() || null,
      inputUsed: quota.daily.inputUsed,
      inputLimit: quota.daily.inputLimit,
      inputRemaining: quota.daily.inputRemaining,
      outputUsed: quota.daily.outputUsed,
      outputLimit: quota.daily.outputLimit,
      outputRemaining: quota.daily.outputRemaining,
      totalUsed: quota.daily.totalUsed,
    },
    channels: quota.channels,
    plan: quota.plan,
    isAdmin: quota.isAdmin,
    isPaid: quota.isPaid,
    billing: quota.billing,
  };
}

router.get("/instance", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Not authenticated" });

    const instance = await getOrCreateInstance(userId);
    const budget = await buildUnifiedOpenClawBudget(userId);

    res.json({
      success: true,
      instance: {
        ...instance,
        version: instance.version || DEFAULT_OPENCLAW_RELEASE_TAG,
        budget,
      },
    });
  } catch (error: any) {
    console.error("[OpenClaw] Error getting instance:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/instance/tokens", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Not authenticated" });

    const limit = parseInt(req.query.limit as string) || 50;
    const history = await getUserTokenHistory(userId, limit);
    const budget = await buildUnifiedOpenClawBudget(userId);

    res.json({ success: true, budget, history });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/admin/instances", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!isAdminUser(req)) return res.status(403).json({ success: false, error: "Admin access required" });

    const config = await getAdminConfig();
    const instances = await getAllInstances();

    const instancesWithUsers = await Promise.all(
      instances.map(async (inst) => {
        const quota = await buildUnifiedOpenClawBudget(inst.userId);
        const [user] = await db.select({ email: users.email, firstName: users.firstName, lastName: users.lastName, plan: users.plan })
          .from(users)
          .where(eq(users.id, inst.userId))
          .limit(1);
        return {
          ...inst,
          version: inst.version || DEFAULT_OPENCLAW_RELEASE_TAG,
          user: user || null,
          quota,
          tokensUsed: quota.channels.openclawUsed,
          tokensLimit: quota.limit,
          tokensRemaining: quota.remaining,
          sharedTokensUsed: quota.used,
          sharedTokensLimit: quota.limit,
        };
      })
    );

    const stats = {
      totalInstances: instancesWithUsers.length,
      activeInstances: instancesWithUsers.filter((inst) => inst.status === "active").length,
      totalTokensUsed: instancesWithUsers.reduce((sum, inst) => sum + (inst.quota.channels.openclawUsed || 0), 0),
      totalSharedTokensUsed: instancesWithUsers.reduce((sum, inst) => sum + (inst.quota.used || 0), 0),
      totalRequests: instancesWithUsers.reduce((sum, inst) => sum + (inst.requestCount || 0), 0),
    };

    res.json({
      success: true,
      stats,
      config,
      instances: instancesWithUsers,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.patch("/admin/instances/:id/tokens", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!isAdminUser(req)) return res.status(403).json({ success: false, error: "Admin access required" });
    return res.status(409).json({
      success: false,
      code: "UNIFIED_BILLING_MANAGED_EXTERNALLY",
      error:
        "Los límites de OpenClaw ahora se gestionan desde el sistema central de billing y cuotas. Ajusta el plan o saldo global desde billing.",
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.patch("/admin/instances/:id/status", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!isAdminUser(req)) return res.status(403).json({ success: false, error: "Admin access required" });

    const { status } = req.body;
    if (!["active", "suspended", "disabled"].includes(status)) {
      return res.status(400).json({ success: false, error: "Invalid status" });
    }

    const updated = await updateInstanceStatus(req.params.id, status);
    res.json({ success: true, instance: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/admin/instances/:id/reset-tokens", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!isAdminUser(req)) return res.status(403).json({ success: false, error: "Admin access required" });
    return res.status(409).json({
      success: false,
      code: "UNIFIED_BILLING_MANAGED_EXTERNALLY",
      error:
        "El saldo compartido ya no se reinicia desde OpenClaw. Usa las herramientas centrales de billing o créditos para administrar la cuota.",
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete("/admin/instances/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!isAdminUser(req)) return res.status(403).json({ success: false, error: "Admin access required" });

    await deleteInstance(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/admin/config", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!isAdminUser(req)) return res.status(403).json({ success: false, error: "Admin access required" });

    const config = await getAdminConfig();
    res.json({ success: true, config });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.patch("/admin/config", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!isAdminUser(req)) return res.status(403).json({ success: false, error: "Admin access required" });

    const { defaultTokensLimit, globalEnabled, autoProvisionOnLogin } = req.body;
    const updates: Record<string, unknown> = {};
    if (typeof defaultTokensLimit === "number") updates.defaultTokensLimit = defaultTokensLimit;
    if (typeof globalEnabled === "boolean") updates.globalEnabled = globalEnabled;
    if (typeof autoProvisionOnLogin === "boolean") updates.autoProvisionOnLogin = autoProvisionOnLogin;

    const config = await updateAdminConfig(updates as any);
    res.json({ success: true, config });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

import { getOpenClawReleaseSnapshot } from "../services/openClawReleaseService";

router.post("/admin/sync", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!isAdminUser(req)) return res.status(403).json({ success: false, error: "Admin access required" });

    const snapshot = await getOpenClawReleaseSnapshot("latest");

    await updateAdminConfig({
      currentVersion: snapshot.bundled.version || DEFAULT_OPENCLAW_RELEASE_TAG,
      lastSyncAt: new Date(),
    });

    res.json({
      success: true,
      sync: snapshot.sync,
      bundledVersion: snapshot.bundled.version,
      requestedTag: snapshot.requestedTag,
      latestRelease: snapshot.latestRelease
        ? {
            tagName: snapshot.latestRelease.tagName,
            name: snapshot.latestRelease.name,
            overview: snapshot.latestRelease.overview,
            highlights: snapshot.latestRelease.highlights,
            publishedAt: snapshot.latestRelease.publishedAt,
          }
        : null,
      errors: snapshot.errors,
    });
  } catch (error: any) {
    console.error("[OpenClaw] Sync error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/admin/sync/status", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!isAdminUser(req)) return res.status(403).json({ success: false, error: "Admin access required" });

    const config = await getAdminConfig();
    const snapshot = await getOpenClawReleaseSnapshot(config.currentVersion || "latest");

    res.json({
      success: true,
      currentVersion: config.currentVersion,
      lastSyncAt: config.lastSyncAt,
      githubRepo: config.githubRepo,
      sync: snapshot.sync,
      updateAvailable: snapshot.sync.status === "update_available",
      latestVersion: snapshot.latestRelease?.tagName || null,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

function requireIdentity(req: Request, res: Response, next: Function) {
  const userId = getSecureUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  (req as any)._internetUserId = userId;
  next();
}

router.post("/internet/fetch", requireIdentity as any, async (req: Request, res: Response) => {
  try {
    const { webFetch } = await import("../openclaw/lib/internetAccess");
    const { url, extractLinks } = req.body;
    if (!url) return res.status(400).json({ error: "url is required" });
    const result = await webFetch(url, { extractLinks });
    res.json({ ok: true, result });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.post("/internet/search", requireIdentity as any, async (req: Request, res: Response) => {
  try {
    const { webSearch } = await import("../openclaw/lib/internetAccess");
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "query is required" });
    const result = await webSearch(query);
    res.json({ ok: true, result });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.get("/internet/status", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    version: OPENCLAW_RELEASE_VERSION,
    capabilities: ["web-fetch", "web-search"],
    provider: "openclaw-internet-access",
  });
});

export default router;
