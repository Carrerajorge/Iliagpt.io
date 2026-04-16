import { Router } from "express";
import { z } from "zod";
import { getOrCreateSecureUserId } from "../lib/anonUserHelper";
import { ensureUserRowExists } from "../lib/ensureUserRowExists";
import { getOpenClawConfig } from "../openclaw/config";
import { openclawSubagentService } from "../openclaw/agents/subagentService";
import { skillRegistry } from "../openclaw/skills/skillRegistry";
import { initSkills } from "../openclaw/skills/skillLoader";
import { RAGService } from "../services/ragService";
import { getCatalogModelBySelection } from "../services/modelCatalogService";
import { orchestrationEngine } from "../services/orchestrationEngine";
import { usageQuotaService } from "../services/usageQuotaService";
import { openclawMetrics } from "../openclaw/lib/metrics";
import { auditLog } from "../openclaw/lib/auditLog";
import { searchSkills as marketplaceSearch, getPopularSkills, installSkill } from "../openclaw/skills/marketplace";

const objectiveSchema = z.object({
  objective: z.string().trim().min(1, "objective is required"),
  complexity: z.coerce.number().int().min(1).max(10).optional(),
});

const ragSearchSchema = z.object({
  query: z.string().trim().min(1, "query is required"),
  limit: z.coerce.number().int().min(1).max(20).optional(),
  chatId: z.string().trim().optional(),
  minScore: z.coerce.number().min(0).max(1).optional(),
});

const ragContextSchema = z.object({
  message: z.string().trim().min(1, "message is required"),
  currentChatId: z.string().trim().optional(),
});

const skillsResolveSchema = z.object({
  skillIds: z.array(z.string().trim().min(1)).optional(),
});

const spawnSubagentSchema = z.object({
  objective: z.string().trim().min(1, "objective is required"),
  planHint: z.array(z.string().trim().min(1)).optional(),
  parentRunId: z.string().trim().optional(),
  chatId: z.string().trim().optional(),
});

const orchestratorFlowSchema = objectiveSchema.extend({
  spawnSubagents: z.boolean().optional().default(true),
  maxSubagents: z.coerce.number().int().min(1).max(10).optional().default(3),
  chatId: z.string().trim().optional(),
});

const nativeExecSchema = z.object({
  prompt: z.string().trim().min(1, "prompt is required"),
  context: z.unknown().optional(),
  chatId: z.string().trim().optional(),
  provider: z.string().trim().optional(),
  model: z.string().trim().optional(),
  timeoutMs: z.coerce.number().int().min(5_000).max(600_000).optional(),
  enableTools: z.boolean().optional(),
});

function normalizeComplexity(objective: string, complexity?: number): number {
  if (typeof complexity === "number" && Number.isFinite(complexity)) {
    return Math.max(1, Math.min(10, complexity));
  }
  return Math.min(10, Math.max(1, Math.ceil(objective.length / 120)));
}

function parseLimit(raw: unknown, fallback = 50): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(500, Math.max(1, Math.floor(n)));
}

function parseSubagentStatus(raw: unknown) {
  if (typeof raw !== "string") return undefined;
  const normalized = raw.trim();
  if (
    normalized === "queued" ||
    normalized === "running" ||
    normalized === "completed" ||
    normalized === "failed" ||
    normalized === "cancelled"
  ) {
    return normalized;
  }
  return undefined;
}

function estimateTextTokens(text: string): number {
  return Math.max(0, Math.ceil(String(text || "").length / 4));
}

function buildRunStats(
  runs: Array<{ status: "queued" | "running" | "completed" | "failed" | "cancelled" }>,
) {
  const stats = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    active: 0,
  };

  for (const run of runs) {
    stats[run.status] += 1;
    if (run.status === "queued" || run.status === "running") {
      stats.active += 1;
    }
  }

  return stats;
}

function respondError(res: any, error: unknown) {
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      error: "Invalid request",
      details: error.flatten(),
    });
  }
  return res.status(500).json({
    error: (error as Error)?.message || "Runtime error",
  });
}

export function createOpenClawRuntimeRouter(): Router {
  const router = Router();
  const ragService = new RAGService();

  router.get("/health", (_req, res) => {
    return res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      modules: {
        skills: process.env.ENABLE_OPENCLAW_SKILLS !== "false",
        tools: process.env.ENABLE_OPENCLAW_TOOLS === "true",
        gateway: process.env.ENABLE_OPENCLAW_GATEWAY === "true",
      },
    });
  });

  router.get("/skills", (_req, res) => {
    const skills = skillRegistry.list().map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tools: skill.tools || [],
      source: skill.source || "builtin",
      filePath: skill.filePath,
      updatedAt: skill.updatedAt,
    }));
    return res.json({
      count: skills.length,
      skills,
    });
  });

  router.post("/skills/reload", async (_req, res) => {
    try {
      const config = getOpenClawConfig();
      await initSkills(config);
      return res.json({
        reloaded: true,
        count: skillRegistry.list().length,
      });
    } catch (error: any) {
      return res.status(500).json({
        error: error?.message || "Failed to reload skills",
      });
    }
  });

  router.post("/skills/resolve", (req, res) => {
    try {
      const parsed = skillsResolveSchema.parse(req.body || {});
      const resolved = skillRegistry.resolve(parsed.skillIds);
      return res.json({
        prompt: resolved.prompt,
        tools: resolved.tools,
        count: resolved.skills.length,
        skills: resolved.skills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          tools: skill.tools || [],
          source: skill.source || "builtin",
          filePath: skill.filePath,
        })),
      });
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/rag/search", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const parsed = ragSearchSchema.parse(req.body || {});
      const results = await ragService.search(userId, parsed.query, {
        limit: parsed.limit,
        chatId: parsed.chatId,
        minScore: parsed.minScore,
      });
      return res.json({
        count: results.length,
        results,
      });
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/rag/context", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const parsed = ragContextSchema.parse(req.body || {});
      const context = await ragService.getContextForMessage(
        userId,
        parsed.message,
        parsed.currentChatId,
      );
      return res.json({ context });
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/orchestrator/plan", async (req, res) => {
    try {
      const parsed = objectiveSchema.parse(req.body || {});
      const complexity = normalizeComplexity(parsed.objective, parsed.complexity);
      const subtasks = await orchestrationEngine.decomposeTask(parsed.objective, complexity);
      const plan = orchestrationEngine.buildExecutionPlan(subtasks);
      return res.json({ objective: parsed.objective, complexity, subtasks, plan });
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/orchestrator/run", async (req, res) => {
    try {
      const parsed = objectiveSchema.parse(req.body || {});
      const complexity = normalizeComplexity(parsed.objective, parsed.complexity);
      const subtasks = await orchestrationEngine.decomposeTask(parsed.objective, complexity);
      const plan = orchestrationEngine.buildExecutionPlan(subtasks);
      const execution = await orchestrationEngine.executeParallel(plan);
      const combined = orchestrationEngine.combineResults(execution);
      return res.json({
        objective: parsed.objective,
        complexity,
        subtasks,
        plan,
        execution,
        combined,
      });
    } catch (error) {
      return respondError(res, error);
    }
  });

  // Full agentic flow for smoke/e2e checks:
  // objective -> plan -> delegate subagents -> consolidated response.
  router.post("/orchestrator/flow", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const parsed = orchestratorFlowSchema.parse(req.body || {});
      const complexity = normalizeComplexity(parsed.objective, parsed.complexity);
      const subtasks = await orchestrationEngine.decomposeTask(parsed.objective, complexity);
      const plan = orchestrationEngine.buildExecutionPlan(subtasks);

      const delegatedRuns = parsed.spawnSubagents
        ? await Promise.all(
            subtasks.slice(0, parsed.maxSubagents).map((subtask) =>
              openclawSubagentService.spawn({
                requesterUserId: userId,
                chatId: parsed.chatId || 'openclaw-runtime',
                objective: subtask.description,
                planHint: subtask.toolId ? [`use:${subtask.toolId}`] : [],
                permissionProfile: 'full_agent',
              }),
            ),
          )
        : [];

      const execution = await orchestrationEngine.executeParallel(plan);
      const combined = orchestrationEngine.combineResults(execution);

      return res.json({
        objective: parsed.objective,
        complexity,
        subtasks,
        plan,
        delegatedRuns: delegatedRuns.map((run) => ({
          id: run.id,
          objective: run.objective,
          status: run.status,
          createdAt: run.createdAt,
        })),
        execution,
        combined,
      });
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/subagents", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const parsed = spawnSubagentSchema.parse(req.body || {});
      const run = await openclawSubagentService.spawn({
        requesterUserId: userId,
        chatId: parsed.chatId || parsed.parentRunId || 'openclaw-runtime',
        objective: parsed.objective,
        planHint: parsed.planHint || [],
        parentRunId: parsed.parentRunId,
        permissionProfile: 'full_agent',
      });
      return res.status(202).json(run);
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/subagents", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    const status = parseSubagentStatus(req.query.status);
    const limit = parseLimit(req.query.limit, 50);
    const parentRunId = typeof req.query.parentRunId === "string" ? req.query.parentRunId : undefined;
    const chatId = typeof req.query.chatId === "string" ? req.query.chatId : undefined;
    const runs = await openclawSubagentService.list({
      requesterUserId: userId,
      chatId,
      status,
      limit,
      parentRunId,
    });
    return res.json({
      count: runs.length,
      stats: buildRunStats(runs),
      runs,
    });
  });

  router.get("/subagents/:runId", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    const run = await openclawSubagentService.get(req.params.runId);
    if (!run || run.requesterUserId !== userId) {
      return res.status(404).json({ error: "Subagent run not found" });
    }
    return res.json(run);
  });

  router.post("/subagents/:runId/cancel", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    const run = await openclawSubagentService.get(req.params.runId);
    if (!run || run.requesterUserId !== userId) {
      return res.status(404).json({ error: "Subagent run not found" });
    }

    const cancelled = await openclawSubagentService.cancel(run.id);
    return res.json({
      runId: run.id,
      cancelled,
    });
  });

  router.get("/native/status", async (_req, res) => {
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const packageJsonPath = path.join(process.cwd(), "node_modules", "openclaw", "package.json");
      const entryPath = path.join(process.cwd(), "node_modules", "openclaw", "openclaw.mjs");
      const [pkgRaw, entryStat] = await Promise.all([
        fs.readFile(packageJsonPath, "utf8"),
        fs.stat(entryPath),
      ]);
      const pkg = JSON.parse(pkgRaw) as { version?: string; name?: string };

      return res.json({
        ok: true,
        packageName: pkg.name || "openclaw",
        packageVersion: pkg.version || null,
        entryPath,
        entryAvailable: entryStat.isFile(),
        workspaceRoot: process.env.OPENCLAW_WORKSPACE_ROOT || null,
      });
    } catch (error: any) {
      return res.status(503).json({
        ok: false,
        error: error?.message || "Native OpenClaw runtime unavailable",
      });
    }
  });

  router.post("/native/exec", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const parsed = nativeExecSchema.parse(req.body || {});
      await ensureUserRowExists(userId, req).catch(() => {});

      const estimatedInputTokens =
        estimateTextTokens(parsed.prompt) +
        (parsed.context == null ? 0 : estimateTextTokens(JSON.stringify(parsed.context)));
      const quotaCheck = await usageQuotaService.validateUnifiedQuota(userId, estimatedInputTokens);
      if (!quotaCheck.allowed) {
        return res.status(quotaCheck.payload.statusCode).json(quotaCheck.payload);
      }

      const selectedModel = await getCatalogModelBySelection(parsed.model, { userId });
      if (selectedModel && !selectedModel.availableToUser) {
        return res.status(403).json({
          ok: false,
          code: "MODEL_UPGRADE_REQUIRED",
          message:
            "El modelo solicitado no está disponible para tu plan actual. Actualiza tu suscripción para ejecutar este runtime nativo.",
          billing: {
            unified: true,
            statusUrl: "/api/billing/status",
            upgradeUrl: "/workspace-settings?section=billing",
          },
        });
      }

      const { executeOpenClawNativePrompt } = await import("../services/openClawNativeExecution");
      const result = await executeOpenClawNativePrompt({
        prompt: parsed.prompt,
        context: parsed.context,
        userId,
        chatId: parsed.chatId || "openclaw-native-web",
        provider: parsed.provider || selectedModel?.gatewayProvider,
        model: parsed.model || selectedModel?.modelId,
        timeoutMs: parsed.timeoutMs,
        enableTools: parsed.enableTools,
      });

      usageQuotaService
        .recordUnifiedOpenClawUsage(userId, estimatedInputTokens, estimateTextTokens(result.response))
        .catch(() => {});

      return res.json({
        ok: true,
        ...result,
      });
    } catch (error) {
      return respondError(res, error);
    }
  });

  // ── Observability endpoints ──

  router.get("/metrics", (_req, res) => {
    return res.json(openclawMetrics.getSummary());
  });

  router.get("/metrics/prometheus", (_req, res) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.send(openclawMetrics.toPrometheus());
  });

  router.get("/audit", (req, res) => {
    const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
    const toolId = typeof req.query.toolId === "string" ? req.query.toolId : undefined;
    const limit = parseLimit(req.query.limit, 50);
    return res.json(auditLog.query({ userId, toolId, limit }));
  });

  router.get("/audit/stats", (_req, res) => {
    return res.json(auditLog.getStats());
  });

  // ── Marketplace endpoints ──

  router.get("/marketplace/search", async (req, res) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      if (!q) return res.status(400).json({ error: "Missing query parameter 'q'" });
      const limit = parseLimit(req.query.limit, 20);
      const results = await marketplaceSearch(q, limit);
      return res.json({ count: results.length, results });
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/marketplace/popular", async (_req, res) => {
    try {
      const results = await getPopularSkills(10);
      return res.json({ count: results.length, results });
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/marketplace/install", async (req, res) => {
    try {
      const body = z.object({ skillId: z.string().trim().min(1) }).parse(req.body || {});
      const config = getOpenClawConfig();
      const targetDir = config.skills.directory || "server/openclaw/skills";
      const result = await installSkill(body.skillId, targetDir);
      if (!result.success) {
        return res.status(502).json({ error: result.error || "Install failed" });
      }
      return res.json({ installed: true, skillId: body.skillId, path: result.path });
    } catch (error) {
      return respondError(res, error);
    }
  });

  // ── File upload for OpenClaw workspace ─────────────────────────────
  router.post("/files/upload", async (req, res) => {
    try {
      const multer = (await import("multer")).default;
      const fsSync = await import("fs");
      const pathMod = await import("path");

      const userId = getOrCreateSecureUserId(req);
      const workspaceRoot = process.env.OPENCLAW_WORKSPACE_ROOT || pathMod.join(process.cwd(), "openclaw-workspaces");
      const userDir = pathMod.join(workspaceRoot, userId, "files");
      if (!fsSync.existsSync(userDir)) fsSync.mkdirSync(userDir, { recursive: true });

      const upload = multer({
        dest: userDir,
        limits: { fileSize: 500 * 1024 * 1024 }, // 500MB — sin límites prácticos
      }).single("file");

      upload(req, res, async (err: any) => {
        if (err) return res.status(400).json({ error: err.message });
        const file = req.file;
        if (!file) return res.status(400).json({ error: "No file provided" });

        // Rename to original filename (safe)
        const safeName = pathMod.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
        const finalPath = pathMod.join(userDir, safeName);
        fsSync.renameSync(file.path, finalPath);

        console.log(`[OpenClaw] File uploaded: ${safeName} (${file.size} bytes) for user ${userId}`);
        return res.json({ ok: true, name: safeName, size: file.size, path: `/openclaw-workspaces/${userId}/files/${safeName}` });
      });
    } catch (error) {
      return respondError(res, error);
    }
  });

  // List files in user's workspace
  router.get("/files", async (req, res) => {
    try {
      const fsSync = await import("fs");
      const pathMod = await import("path");
      const userId = getOrCreateSecureUserId(req);
      const workspaceRoot = process.env.OPENCLAW_WORKSPACE_ROOT || pathMod.join(process.cwd(), "openclaw-workspaces");
      const userDir = pathMod.join(workspaceRoot, userId, "files");

      if (!fsSync.existsSync(userDir)) return res.json({ files: [] });

      const files = fsSync.readdirSync(userDir).map((name: string) => {
        const stat = fsSync.statSync(pathMod.join(userDir, name));
        return { name, size: stat.size, modified: stat.mtime.toISOString() };
      });

      return res.json({ files });
    } catch (error) {
      return respondError(res, error);
    }
  });

  // Delete a file
  router.delete("/files/:name", async (req, res) => {
    try {
      const fsSync = await import("fs");
      const pathMod = await import("path");
      const userId = getOrCreateSecureUserId(req);
      const workspaceRoot = process.env.OPENCLAW_WORKSPACE_ROOT || pathMod.join(process.cwd(), "openclaw-workspaces");
      const safeName = pathMod.basename(req.params.name);
      const filePath = pathMod.join(workspaceRoot, userId, "files", safeName);

      if (fsSync.existsSync(filePath)) fsSync.unlinkSync(filePath);
      return res.json({ ok: true });
    } catch (error) {
      return respondError(res, error);
    }
  });

  return router;
}
