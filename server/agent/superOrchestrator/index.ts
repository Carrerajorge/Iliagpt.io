import { eq, desc, and, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  orchestratorRuns, orchestratorTasks, orchestratorApprovals, orchestratorArtifacts,
  type OrchestratorRun, type InsertOrchestratorRun,
  type OrchestratorTask, type InsertOrchestratorTask,
} from "@shared/schema";
import { dagScheduler } from "./dagScheduler";
import { governanceEngine } from "./governance";
import { registerTaskProcessor, startOrchestratorWorker, getQueueStats, orchestratorEvents } from "./queue";
import { executeTask } from "./taskExecutor";
import { matchRoles, getAllRoles, getRoleById } from "./agentRoles";

export interface SubmitRunOptions {
  objective: string;
  createdBy: string;
  priority?: number;
  budgetLimitUsd?: number;
  timeLimitMs?: number;
  concurrencyLimit?: number;
  tasks: Array<{
    agentRole: string;
    label: string;
    input?: any;
    dependsOn?: string[];
    riskLevel?: string;
    maxRetries?: number;
  }>;
}

export interface RunStatus {
  run: OrchestratorRun;
  tasks: OrchestratorTask[];
  approvalsPending: number;
  queueStats: { waiting: number; active: number; completed: number; failed: number };
}

class SuperOrchestrator {
  private initialized = false;

  initialize() {
    if (this.initialized) return;

    registerTaskProcessor(async (job) => {
      return executeTask(job.data);
    });

    startOrchestratorWorker(10);
    this.initialized = true;
    console.log("[SuperOrchestrator] Initialized");
  }

  async submitRun(options: SubmitRunOptions): Promise<{ runId: string; taskCount: number }> {
    const validation = await governanceEngine.validateRunSubmission(
      options.createdBy,
      options.tasks.length
    );

    if (!validation.allowed) {
      throw new Error(`Run rejected: ${validation.reason}`);
    }

    const [run] = await db.insert(orchestratorRuns).values({
      objective: options.objective,
      status: "planning",
      priority: options.priority || 5,
      budgetLimitUsd: options.budgetLimitUsd,
      timeLimitMs: options.timeLimitMs,
      concurrencyLimit: options.concurrencyLimit || 10,
      createdBy: options.createdBy,
      totalTasks: options.tasks.length,
    }).returning();

    const tempIdMap = new Map<string, string>();
    const taskInserts: InsertOrchestratorTask[] = [];

    for (let i = 0; i < options.tasks.length; i++) {
      const t = options.tasks[i];
      const tempId = `temp_${i}`;
      taskInserts.push({
        runId: run.id,
        agentRole: t.agentRole,
        label: t.label || `Task ${i + 1}`,
        status: "pending",
        inputJson: t.input || {},
        maxRetries: t.maxRetries || 3,
        dependsOn: t.dependsOn || [],
        riskLevel: t.riskLevel || "safe",
      });
    }

    const insertedTasks = await db.insert(orchestratorTasks).values(taskInserts).returning();

    for (let i = 0; i < insertedTasks.length; i++) {
      tempIdMap.set(`temp_${i}`, insertedTasks[i].id);
    }

    for (const task of insertedTasks) {
      if (task.dependsOn && task.dependsOn.length > 0) {
        const resolvedDeps = task.dependsOn.map((dep) => tempIdMap.get(dep) || dep);
        await db.update(orchestratorTasks).set({ dependsOn: resolvedDeps }).where(eq(orchestratorTasks.id, task.id));
      }
    }

    for (const task of insertedTasks) {
      if (governanceEngine.requiresApproval(task.riskLevel)) {
        await governanceEngine.requestApproval(
          task.id,
          run.id,
          `Task requires approval: ${task.agentRole} (risk: ${task.riskLevel})`,
          options.createdBy
        );
      }
    }

    const dagJson = {
      nodes: insertedTasks.map((t) => ({
        id: t.id,
        role: t.agentRole,
        label: t.label,
        deps: t.dependsOn || [],
      })),
    };

    await db.update(orchestratorRuns).set({
      status: "running",
      dagJson,
      startedAt: new Date(),
    }).where(eq(orchestratorRuns.id, run.id));

    dagScheduler.setConcurrencyLimit(run.id, options.concurrencyLimit || 10);
    await dagScheduler.initializeFromDB(run.id);

    orchestratorEvents.emit("run:started", { runId: run.id });
    await dagScheduler.scheduleReadyTasks(run.id);

    return { runId: run.id, taskCount: insertedTasks.length };
  }

  async getRunStatus(runId: string): Promise<RunStatus | null> {
    const [run] = await db.select().from(orchestratorRuns).where(eq(orchestratorRuns.id, runId));
    if (!run) return null;

    const tasks = await db.select().from(orchestratorTasks).where(eq(orchestratorTasks.runId, runId));

    const pendingApprovals = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orchestratorApprovals)
      .where(and(eq(orchestratorApprovals.runId, runId), eq(orchestratorApprovals.status, "pending")));

    const queueStats = await getQueueStats();

    return {
      run,
      tasks,
      approvalsPending: pendingApprovals[0]?.count || 0,
      queueStats,
    };
  }

  async listRuns(options: { userId?: string; status?: string; limit?: number; offset?: number } = {}): Promise<{ runs: OrchestratorRun[]; total: number }> {
    const conditions = [];
    if (options.userId) conditions.push(eq(orchestratorRuns.createdBy, options.userId));
    if (options.status) conditions.push(eq(orchestratorRuns.status, options.status));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orchestratorRuns)
      .where(whereClause);

    const runs = await db
      .select()
      .from(orchestratorRuns)
      .where(whereClause)
      .orderBy(desc(orchestratorRuns.createdAt))
      .limit(options.limit || 50)
      .offset(options.offset || 0);

    return { runs, total: countResult?.count || 0 };
  }

  async cancelRun(runId: string): Promise<boolean> {
    const [run] = await db.select().from(orchestratorRuns).where(eq(orchestratorRuns.id, runId));
    if (!run || run.status === "completed" || run.status === "cancelled") return false;

    dagScheduler.pauseRun(runId);

    await db.update(orchestratorRuns).set({
      status: "cancelled",
      error: "Cancelled by user",
      completedAt: new Date(),
    }).where(eq(orchestratorRuns.id, runId));

    await db.update(orchestratorTasks).set({
      status: "cancelled",
      error: "Run cancelled",
      completedAt: new Date(),
    }).where(and(
      eq(orchestratorTasks.runId, runId),
      eq(orchestratorTasks.status, "pending")
    ));

    return true;
  }

  async pauseRun(runId: string): Promise<boolean> {
    const [run] = await db.select().from(orchestratorRuns).where(eq(orchestratorRuns.id, runId));
    if (!run || run.status !== "running") return false;

    dagScheduler.pauseRun(runId);

    await db.update(orchestratorRuns).set({ status: "paused" }).where(eq(orchestratorRuns.id, runId));
    return true;
  }

  async resumeRun(runId: string): Promise<boolean> {
    const [run] = await db.select().from(orchestratorRuns).where(eq(orchestratorRuns.id, runId));
    if (!run || run.status !== "paused") return false;

    await db.update(orchestratorRuns).set({ status: "running" }).where(eq(orchestratorRuns.id, runId));
    dagScheduler.resumeRun(runId);
    return true;
  }

  async getStats(): Promise<{
    totalRuns: number;
    activeRuns: number;
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    totalCostUsd: number;
    pendingApprovals: number;
    queueStats: any;
    killSwitchStatus: any;
    availableRoles: number;
  }> {
    const [runStats] = await db.select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where status = 'running')::int`,
      totalCost: sql<number>`coalesce(sum(total_cost_usd), 0)::float`,
    }).from(orchestratorRuns);

    const [taskStats] = await db.select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where status = 'completed')::int`,
      failed: sql<number>`count(*) filter (where status = 'failed')::int`,
    }).from(orchestratorTasks);

    const [approvalStats] = await db.select({
      pending: sql<number>`count(*) filter (where status = 'pending')::int`,
    }).from(orchestratorApprovals);

    return {
      totalRuns: runStats?.total || 0,
      activeRuns: runStats?.active || 0,
      totalTasks: taskStats?.total || 0,
      completedTasks: taskStats?.completed || 0,
      failedTasks: taskStats?.failed || 0,
      totalCostUsd: runStats?.totalCost || 0,
      pendingApprovals: approvalStats?.pending || 0,
      queueStats: await getQueueStats(),
      killSwitchStatus: governanceEngine.getKillSwitchStatus(),
      availableRoles: getAllRoles().length,
    };
  }

  getRoles() {
    return getAllRoles();
  }

  matchRoles(description: string) {
    return matchRoles(description);
  }
}

export const superOrchestrator = new SuperOrchestrator();

export { governanceEngine } from "./governance";
export { dagScheduler } from "./dagScheduler";
export { getAllRoles, getRoleById, matchRoles } from "./agentRoles";
