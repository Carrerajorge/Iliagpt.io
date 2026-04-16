import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";

import { ValidationError, validateOrThrow } from "../agent/validation";
import { WorkflowRunner, InMemoryStepExecutorRegistry } from "../workflow/workflowRunner";
import { WorkflowStore } from "../workflow/store";
import { getWorkflowTraceStreamHub, parseLastEventId, WorkflowTraceStreamHub } from "../workflow/streaming";
import { ensureWorkflowTraceSchema } from "../workflow/schemaSetup";

const EVENT_PAGE_LIMIT = 500;

const WorkflowStepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  toolName: z.string().min(1),
  executorKey: z.string().min(1).optional(),
  description: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
  retryPolicy: z
    .object({
      attempts: z.number().int().min(1),
      backoffMs: z.number().int().min(0).optional().default(0),
      maxBackoffMs: z.number().int().min(0).optional(),
    })
    .optional(),
  metadata: z.record(z.any()).optional(),
  input: z.record(z.any()).optional(),
});

const WorkflowPlanSchema = z.object({
  objective: z.string().min(1),
  steps: z.array(WorkflowStepSchema).min(1),
  concurrency: z.number().int().min(1).optional(),
  metadata: z.record(z.any()).optional(),
});

const WorkflowRunRequestSchema = z.object({
  chatId: z.string().min(1),
  userId: z.string().optional().nullable(),
  plan: WorkflowPlanSchema,
  idempotencyKey: z.string().optional(),
  traceId: z.string().optional(),
  variables: z.record(z.any()).optional(),
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function registerDefaultWorkflowExecutors(registry: InMemoryStepExecutorRegistry): void {
  const flakyAttempts = new Map<string, number>();

  registry.registerExecutor("noop", async (ctx) => {
    const delayMs = Math.max(0, Number(ctx.step.input?.delayMs || 0));
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    return {
      success: true,
      output: {
        stepId: ctx.step.id,
        toolName: ctx.step.toolName,
        attempt: ctx.attempt,
      },
      logs: [
        {
          level: "info",
          message: `step ${ctx.step.id} completed`,
          timestamp: Date.now(),
        },
      ],
    };
  });

  registry.registerExecutor("sleep", async (ctx) => {
    const delayMs = Math.max(0, Number(ctx.step.input?.delayMs || 250));
    await sleep(delayMs);
    return { success: true, output: { delayMs } };
  });

  registry.registerExecutor("artifact", async (ctx) => {
    const delayMs = Math.max(0, Number(ctx.step.input?.delayMs || 0));
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    const artifactName = String(ctx.step.input?.name || `${ctx.step.id}.txt`);
    return {
      success: true,
      output: { artifactName },
      artifacts: [
        {
          key: `${ctx.step.id}:${artifactName}`,
          type: String(ctx.step.input?.type || "text/plain"),
          name: artifactName,
          url: typeof ctx.step.input?.url === "string" ? ctx.step.input.url : undefined,
          payload: {
            content: String(ctx.step.input?.content || `artifact for ${ctx.step.id}`),
            attempt: ctx.attempt,
          },
          metadata: {
            stepId: ctx.step.id,
            tool: ctx.step.toolName,
          },
        },
      ],
    };
  });

  registry.registerExecutor("flaky", async (ctx) => {
    const failTimes = Math.max(1, Number(ctx.step.input?.failTimes || 1));
    const key = `${ctx.runId}:${ctx.step.id}`;
    const previous = flakyAttempts.get(key) || 0;
    const current = previous + 1;
    flakyAttempts.set(key, current);

    if (current <= failTimes) {
      return {
        success: false,
        error: {
          message: `flaky failure ${current}/${failTimes}`,
          retryable: true,
        },
      };
    }

    return {
      success: true,
      output: {
        recoveredAfter: failTimes,
      },
    };
  });

  registry.registerExecutor("always-fail", async () => {
    throw new Error("always-fail executor error");
  });
}

function isWorkflowReproEnabled(): boolean {
  const enabled = process.env.WORKFLOW_REPRO === "1";
  const env = process.env.NODE_ENV;
  return enabled && (env === "test" || env === "development");
}

function requireWorkflowAuth(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (user) {
    return next();
  }

  if (isWorkflowReproEnabled()) {
    (req as any).user = {
      id: null,
      email: "workflow-repro@local",
      roles: ["admin"],
    };
    return next();
  }

  res.status(401).json({ error: "Authentication required" });
}

interface WorkflowTraceRouterDeps {
  store?: WorkflowStore;
  runner?: WorkflowRunner;
  streamHub?: WorkflowTraceStreamHub;
}

let singletonDeps: Required<WorkflowTraceRouterDeps> | null = null;

function getDefaultDeps(): Required<WorkflowTraceRouterDeps> {
  if (!singletonDeps) {
    const store = new WorkflowStore();
    const registry = new InMemoryStepExecutorRegistry();
    registerDefaultWorkflowExecutors(registry);
    const runner = new WorkflowRunner(store, registry);
    const streamHub = getWorkflowTraceStreamHub(store);

    singletonDeps = {
      store,
      runner,
      streamHub,
    };
  }

  return singletonDeps;
}

export function createWorkflowTraceRouter(deps?: WorkflowTraceRouterDeps) {
  const defaults = getDefaultDeps();
  const store = deps?.store || defaults.store;
  const runner = deps?.runner || defaults.runner;
  const streamHub = deps?.streamHub || defaults.streamHub;

  const router = Router();

  router.post("/runs", requireWorkflowAuth, async (req: Request, res: Response) => {
    try {
      await ensureWorkflowTraceSchema();
      const body = validateOrThrow(WorkflowRunRequestSchema, req.body, "POST /run-traces/runs");
      const fallbackUserId = isWorkflowReproEnabled() ? null : (req as any).user?.id || null;
      const effectiveUserId = body.userId ?? fallbackUserId;

      let reusedRunId: string | null = null;
      if (body.idempotencyKey) {
        const existing = await store.getRunByIdempotencyKey(body.chatId, body.idempotencyKey);
        if (existing) {
          reusedRunId = existing.id;
        }
      }

      const { runId } = await runner.startWorkflow({
        chatId: body.chatId,
        userId: effectiveUserId,
        plan: body.plan,
        idempotencyKey: body.idempotencyKey,
        traceId: body.traceId,
        variables: body.variables,
      });

      const statusCode = reusedRunId ? 200 : 201;
      res.status(statusCode).json({
        runId,
        reused: reusedRunId === runId,
        streamUrl: `/api/run-traces/runs/${runId}/stream`,
      });
    } catch (error: any) {
      if (error instanceof ValidationError) {
        return res.status(400).json({
          error: "Invalid workflow payload",
          details: error.zodError.errors,
        });
      }

      if (error?.code === "23503") {
        return res.status(400).json({
          error: "Invalid foreign key reference",
          detail: error.detail,
        });
      }

      console.error("[WorkflowTraceRoutes] Failed to create run", error);
      res.status(500).json({ error: "Failed to start workflow run" });
    }
  });

  router.get("/runs/:id", requireWorkflowAuth, async (req: Request, res: Response) => {
    try {
      await ensureWorkflowTraceSchema();
      const runId = req.params.id;
      const run = await store.loadRun(runId);
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      const [steps, artifacts] = await Promise.all([store.loadSteps(runId), store.loadArtifacts(runId)]);

      res.json({
        id: run.id,
        chatId: run.chatId,
        status: run.status,
        plan: run.plan,
        error: (run as any).error || null,
        steps: steps.map((step) => ({
          id: step.id,
          stepIndex: step.stepIndex,
          toolName: step.toolName,
          status: step.status,
          retryCount: step.retryCount,
          error: step.error,
          startedAt: step.startedAt ? step.startedAt.toISOString() : null,
          completedAt: step.completedAt ? step.completedAt.toISOString() : null,
        })),
        artifacts: artifacts.map((artifact) => ({
          id: artifact.id,
          stepId: artifact.stepId,
          stepIndex: artifact.stepIndex,
          artifactKey: artifact.artifactKey,
          type: artifact.type,
          name: artifact.name,
          url: artifact.url,
          payload: artifact.payload,
          metadata: artifact.metadata,
          createdAt: artifact.createdAt?.toISOString?.() || null,
        })),
        startedAt: run.startedAt ? run.startedAt.toISOString() : null,
        completedAt: run.completedAt ? run.completedAt.toISOString() : null,
        totalSteps: run.plan.steps.length,
        completedSteps: (run as any).completedSteps,
        createdAt: run.createdAt.toISOString(),
      });
    } catch (error: any) {
      console.error("[WorkflowTraceRoutes] Error fetching run", error);
      res.status(500).json({ error: "Failed to fetch run" });
    }
  });

  router.get("/runs/:id/events", requireWorkflowAuth, async (req: Request, res: Response) => {
    try {
      await ensureWorkflowTraceSchema();
      const runId = req.params.id;
      const run = await store.loadRun(runId);
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      const limitRaw = parseInt(String(req.query.limit || EVENT_PAGE_LIMIT), 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), EVENT_PAGE_LIMIT) : EVENT_PAGE_LIMIT;
      const order = String(req.query.order || "asc").toLowerCase() === "desc" ? "desc" : "asc";
      const afterSeq = req.query.afterSeq !== undefined ? Number(req.query.afterSeq) : null;

      const events = await store.listEvents({
        runId,
        afterSeq: Number.isFinite(afterSeq as number) ? (afterSeq as number) : null,
        limit,
        order,
      });

      const lastEventSeq = await store.getLastEventSeq(runId);

      res.json({
        runId,
        order,
        limit,
        afterSeq: Number.isFinite(afterSeq as number) ? (afterSeq as number) : null,
        lastEventSeq,
        events: events.map((event) => ({
          id: event.id,
          eventSeq: event.eventSeq,
          eventType: event.eventType,
          correlationId: event.correlationId,
          stepId: event.stepId,
          stepIndex: event.stepIndex,
          traceId: event.traceId,
          spanId: event.spanId,
          severity: event.severity,
          payload: event.payload,
          metadata: event.metadata,
          timestamp: event.timestamp.toISOString(),
        })),
      });
    } catch (error: any) {
      console.error("[WorkflowTraceRoutes] Error fetching events", error);
      res.status(500).json({ error: "Failed to fetch events" });
    }
  });

  router.get("/runs/:id/stream", requireWorkflowAuth, async (req: Request, res: Response) => {
    try {
      await ensureWorkflowTraceSchema();
      const runId = req.params.id;
      const run = await store.loadRun(runId);
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      const lastEventId = parseLastEventId(req.header("last-event-id"), req.query.lastEventId);
      const { close } = streamHub.connectSse({ runId, res, lastEventId });

      req.on("close", () => {
        close();
      });
    } catch (error: any) {
      console.error("[WorkflowTraceRoutes] Stream error", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to open stream" });
      }
    }
  });

  router.post("/runs/:id/cancel", requireWorkflowAuth, async (req: Request, res: Response) => {
    try {
      await ensureWorkflowTraceSchema();
      const runId = req.params.id;
      const result = await runner.cancelRun(runId);
      if (!result.cancelled) {
        return res.status(409).json({
          runId,
          cancelled: false,
          error: "Run cannot be cancelled in current state",
        });
      }

      res.json({ runId, cancelled: true });
    } catch (error: any) {
      console.error("[WorkflowTraceRoutes] Cancel failure", error);
      res.status(500).json({ error: "Failed to cancel run" });
    }
  });

  return router;
}
