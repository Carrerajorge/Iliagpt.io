import { Router } from "express";
import { z } from "zod";
import { getOrCreateSecureUserId } from "../lib/anonUserHelper";
import { getOpenClawConfig } from "../openclaw/config";
import { openclawSubagentService } from "../openclaw/agents/subagentService";
import { skillRegistry } from "../openclaw/skills/skillRegistry";
import { initSkills } from "../openclaw/skills/skillLoader";
import { RAGService } from "../services/ragService";
import { orchestrationEngine } from "../services/orchestrationEngine";

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
        skills: process.env.ENABLE_OPENCLAW_SKILLS === "true",
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

  return router;
}
