import { eq } from "drizzle-orm";
import { db } from "../../db";
import { orchestratorTasks, orchestratorArtifacts } from "@shared/schema";
import { getRoleById } from "./agentRoles";
import type { OrchestratorJobResult } from "./queue";

export interface TaskExecutionContext {
  runId: string;
  taskId: string;
  agentRole: string;
  input: any;
  userId: string;
}

export type TaskHandler = (ctx: TaskExecutionContext) => Promise<{
  output: any;
  costUsd: number;
  artifacts?: Array<{ name: string; type: string; content: any; sizeBytes: number }>;
}>;

const handlers = new Map<string, TaskHandler>();

const defaultHandler: TaskHandler = async (ctx) => {
  const isProduction = process.env.NODE_ENV === "production";
  const role = getRoleById(ctx.agentRole);
  const roleName = role?.name || ctx.agentRole;

  const errorMsg =
    `No handler registered for SuperOrchestrator role "${ctx.agentRole}" (${roleName}). ` +
    `Register a real handler via registerTaskHandler() before enqueuing this task type.`;

  if (isProduction) {
    throw Object.assign(new Error(errorMsg), {
      code: "HANDLER_NOT_REGISTERED",
      agentRole: ctx.agentRole,
    });
  }

  // In development/test: warn and return stub so callers can still iterate
  console.warn(`[SuperOrchestrator] STUB handler invoked — ${errorMsg}`);
  return {
    output: {
      status: "stub_executed",
      experimental: true,
      warning: errorMsg,
      agentRole: roleName,
      summary: `[STUB] Task processed by ${roleName} agent (no real handler registered)`,
      input: ctx.input,
      capabilities: role?.capabilities || [],
    },
    costUsd: 0,
  };
};

export function registerTaskHandler(agentRole: string, handler: TaskHandler) {
  handlers.set(agentRole, handler);
}

export function getRegisteredHandlers(): string[] {
  return Array.from(handlers.keys());
}

export async function executeTask(
  jobData: { runId: string; taskId: string; agentRole: string; input: any; riskLevel: string }
): Promise<OrchestratorJobResult> {
  const startTime = Date.now();

  try {
    await db
      .update(orchestratorTasks)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(orchestratorTasks.id, jobData.taskId));

    const handler = handlers.get(jobData.agentRole) || defaultHandler;

    const result = await handler({
      runId: jobData.runId,
      taskId: jobData.taskId,
      agentRole: jobData.agentRole,
      input: jobData.input,
      userId: "orchestrator",
    });

    const durationMs = Date.now() - startTime;

    if (result.artifacts && result.artifacts.length > 0) {
      for (const artifact of result.artifacts) {
        await db.insert(orchestratorArtifacts).values({
          taskId: jobData.taskId,
          runId: jobData.runId,
          type: artifact.type,
          name: artifact.name,
          contentJson: artifact.content,
          sizeBytes: artifact.sizeBytes,
        });
      }
    }

    await db
      .update(orchestratorTasks)
      .set({
        status: "completed",
        outputJson: result.output,
        costUsd: result.costUsd,
        durationMs,
        completedAt: new Date(),
      })
      .where(eq(orchestratorTasks.id, jobData.taskId));

    return {
      taskId: jobData.taskId,
      status: "completed",
      output: result.output,
      costUsd: result.costUsd,
      durationMs,
      artifacts: result.artifacts,
    };
  } catch (error: any) {
    const durationMs = Date.now() - startTime;

    await db
      .update(orchestratorTasks)
      .set({
        status: "failed",
        error: error.message || String(error),
        durationMs,
        completedAt: new Date(),
      })
      .where(eq(orchestratorTasks.id, jobData.taskId));

    return {
      taskId: jobData.taskId,
      status: "failed",
      error: error.message || String(error),
      costUsd: 0,
      durationMs,
    };
  }
}
