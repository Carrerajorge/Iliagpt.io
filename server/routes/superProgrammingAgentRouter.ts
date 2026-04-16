import { Router, Request, Response } from "express";
import { z } from "zod";
import { superProgrammingAgentService } from "../services/superProgrammingAgent";

const AssessRequestSchema = z.object({
  objective: z.string().min(1).max(6000).optional(),
});

const PlanRequestSchema = z.object({
  objective: z.string().min(10).max(6000),
  targetMaturity: z.number().int().min(40).max(100).optional(),
});

const RunRequestSchema = z.object({
  objective: z.string().min(10).max(6000),
  targetMaturity: z.number().int().min(40).max(100).optional(),
  dryRun: z.boolean().optional(),
  maxTasks: z.number().int().min(1).max(40).optional(),
  stopOnFailure: z.boolean().optional(),
});

const ListRunsSchema = z.object({
  limit: z
    .string()
    .transform((value) => Number.parseInt(value, 10))
    .pipe(z.number().int().min(1).max(100))
    .optional(),
});

export function createSuperProgrammingAgentRouter(): Router {
  const router = Router();

  router.get("/status", (_req: Request, res: Response) => {
    const runs = superProgrammingAgentService.listRuns(5);
    res.json({
      success: true,
      data: {
        projectRoot: superProgrammingAgentService.getProjectRoot(),
        recentRuns: runs.map((run) => ({
          runId: run.runId,
          status: run.status,
          mode: run.mode,
          createdAt: run.createdAt,
          objective: run.objective,
          summary: run.summary,
        })),
      },
    });
  });

  router.post("/assess", async (req: Request, res: Response) => {
    try {
      const { objective } = AssessRequestSchema.parse(req.body ?? {});
      const assessment = await superProgrammingAgentService.assess(objective);
      return res.json({
        success: true,
        data: assessment,
      });
    } catch (error) {
      const err = error as Error;
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: "Invalid request payload",
          issues: error.issues,
        });
      }
      return res.status(500).json({
        success: false,
        error: err.message || "Failed to assess super programming capabilities",
      });
    }
  });

  router.post("/plan", async (req: Request, res: Response) => {
    try {
      const { objective, targetMaturity } = PlanRequestSchema.parse(req.body ?? {});
      const plan = await superProgrammingAgentService.buildPlan(objective, {
        targetMaturity,
      });

      return res.json({
        success: true,
        data: plan,
      });
    } catch (error) {
      const err = error as Error;
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: "Invalid request payload",
          issues: error.issues,
        });
      }
      return res.status(500).json({
        success: false,
        error: err.message || "Failed to build super programming plan",
      });
    }
  });

  router.post("/run", async (req: Request, res: Response) => {
    try {
      const {
        objective,
        targetMaturity,
        dryRun,
        maxTasks,
        stopOnFailure,
      } = RunRequestSchema.parse(req.body ?? {});

      const plan = await superProgrammingAgentService.buildPlan(objective, {
        targetMaturity,
      });

      const run = await superProgrammingAgentService.runPlan(plan, {
        dryRun,
        maxTasks,
        stopOnFailure,
      });

      return res.json({
        success: true,
        data: {
          run,
          plan: {
            planId: plan.planId,
            objective: plan.objective,
            targetMaturity: plan.targetMaturity,
            estimatedWeeks: plan.estimatedWeeks,
            tasks: plan.priorityBacklog.length,
          },
        },
      });
    } catch (error) {
      const err = error as Error;
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: "Invalid request payload",
          issues: error.issues,
        });
      }
      return res.status(500).json({
        success: false,
        error: err.message || "Failed to execute super programming plan",
      });
    }
  });

  router.get("/runs", (req: Request, res: Response) => {
    try {
      const { limit } = ListRunsSchema.parse(req.query ?? {});
      const runs = superProgrammingAgentService.listRuns(limit ?? 25);
      return res.json({
        success: true,
        count: runs.length,
        data: runs,
      });
    } catch (error) {
      const err = error as Error;
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: "Invalid query params",
          issues: error.issues,
        });
      }
      return res.status(500).json({
        success: false,
        error: err.message || "Failed to list super programming runs",
      });
    }
  });

  router.get("/runs/:runId", (req: Request, res: Response) => {
    try {
      const run = superProgrammingAgentService.getRun(req.params.runId);
      if (!run) {
        return res.status(404).json({
          success: false,
          error: "Run not found",
        });
      }

      return res.json({
        success: true,
        data: run,
      });
    } catch (error) {
      const err = error as Error;
      return res.status(500).json({
        success: false,
        error: err.message || "Failed to get run",
      });
    }
  });

  return router;
}
