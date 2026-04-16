import { eq, and, sql } from "drizzle-orm";
import { db } from "../../db";
import { orchestratorRuns, orchestratorTasks, orchestratorApprovals } from "@shared/schema";
import { dagScheduler } from "./dagScheduler";
import { orchestratorEvents, drainQueue } from "./queue";

export interface GovernancePolicy {
  maxConcurrentRunsPerUser: number;
  maxTasksPerRun: number;
  maxConcurrentTasksPerRun: number;
  defaultBudgetLimitUsd: number;
  defaultTimeLimitMs: number;
  riskApprovalThresholds: Record<string, boolean>;
  dangerousTools: string[];
}

const DEFAULT_POLICY: GovernancePolicy = {
  maxConcurrentRunsPerUser: 5,
  maxTasksPerRun: 1000,
  maxConcurrentTasksPerRun: 10,
  defaultBudgetLimitUsd: 10.0,
  defaultTimeLimitMs: 30 * 60 * 1000,
  riskApprovalThresholds: {
    safe: false,
    moderate: false,
    dangerous: true,
    critical: true,
  },
  dangerousTools: [
    "terminal.exec",
    "file.delete",
    "file.write",
    "database.drop",
    "deploy.production",
  ],
};

class GovernanceEngine {
  private killSwitchActive = false;
  private killSwitchTimestamp: number | null = null;
  private policy: GovernancePolicy = { ...DEFAULT_POLICY };
  private runTimers = new Map<string, NodeJS.Timeout>();

  constructor() {
    orchestratorEvents.on("run:started", (data) => this.onRunStarted(data));
    orchestratorEvents.on("task:completed", (data) => this.onTaskCostUpdate(data));
  }

  async armKillSwitch(): Promise<{ armed: boolean; elapsed_ms: number }> {
    const start = Date.now();
    this.killSwitchActive = true;
    this.killSwitchTimestamp = start;

    dagScheduler.globalKill();

    try {
      await drainQueue();
    } catch (e) {}

    const activeRuns = await db
      .select({ id: orchestratorRuns.id })
      .from(orchestratorRuns)
      .where(eq(orchestratorRuns.status, "running"));

    for (const run of activeRuns) {
      await db
        .update(orchestratorRuns)
        .set({ status: "killed", completedAt: new Date(), error: "Global kill switch activated" })
        .where(eq(orchestratorRuns.id, run.id));

      await db
        .update(orchestratorTasks)
        .set({ status: "killed", completedAt: new Date(), error: "Kill switch" })
        .where(and(
          eq(orchestratorTasks.runId, run.id),
          eq(orchestratorTasks.status, "running")
        ));

      await db
        .update(orchestratorTasks)
        .set({ status: "cancelled", error: "Kill switch" })
        .where(and(
          eq(orchestratorTasks.runId, run.id),
          eq(orchestratorTasks.status, "pending")
        ));
    }

    const elapsed = Date.now() - start;
    orchestratorEvents.emit("governance:kill_switch", { armed: true, elapsed_ms: elapsed, runsKilled: activeRuns.length });

    return { armed: true, elapsed_ms: elapsed };
  }

  disarmKillSwitch() {
    this.killSwitchActive = false;
    this.killSwitchTimestamp = null;
    dagScheduler.globalResume();
    orchestratorEvents.emit("governance:kill_switch", { armed: false });
  }

  isKillSwitchActive(): boolean {
    return this.killSwitchActive;
  }

  getKillSwitchStatus() {
    return {
      active: this.killSwitchActive,
      activatedAt: this.killSwitchTimestamp ? new Date(this.killSwitchTimestamp).toISOString() : null,
    };
  }

  async validateRunSubmission(userId: string, taskCount: number): Promise<{ allowed: boolean; reason?: string }> {
    if (this.killSwitchActive) {
      return { allowed: false, reason: "Global kill switch is active" };
    }

    if (taskCount > this.policy.maxTasksPerRun) {
      return { allowed: false, reason: `Task count ${taskCount} exceeds limit of ${this.policy.maxTasksPerRun}` };
    }

    const activeRuns = await db
      .select({ id: orchestratorRuns.id })
      .from(orchestratorRuns)
      .where(and(
        eq(orchestratorRuns.createdBy, userId),
        eq(orchestratorRuns.status, "running")
      ));

    if (activeRuns.length >= this.policy.maxConcurrentRunsPerUser) {
      return { allowed: false, reason: `User has ${activeRuns.length} active runs (limit: ${this.policy.maxConcurrentRunsPerUser})` };
    }

    return { allowed: true };
  }

  requiresApproval(riskLevel: string): boolean {
    return this.policy.riskApprovalThresholds[riskLevel] === true;
  }

  async requestApproval(taskId: string, runId: string, reason: string, requestedBy: string): Promise<string> {
    const [approval] = await db.insert(orchestratorApprovals).values({
      taskId,
      runId,
      reason,
      status: "pending",
      requestedBy,
    }).returning({ id: orchestratorApprovals.id });

    await db.update(orchestratorTasks).set({ status: "awaiting_approval" }).where(eq(orchestratorTasks.id, taskId));

    orchestratorEvents.emit("approval:requested", { approvalId: approval.id, taskId, runId, reason });
    return approval.id;
  }

  async approveTask(approvalId: string, decidedBy: string): Promise<boolean> {
    const [approval] = await db
      .select()
      .from(orchestratorApprovals)
      .where(eq(orchestratorApprovals.id, approvalId));

    if (!approval || approval.status !== "pending") return false;

    await db.update(orchestratorApprovals).set({
      status: "approved",
      decidedBy,
      decidedAt: new Date(),
    }).where(eq(orchestratorApprovals.id, approvalId));

    await db.update(orchestratorTasks).set({ status: "pending" }).where(eq(orchestratorTasks.id, approval.taskId));

    const dagState = dagScheduler.getDAGState(approval.runId);
    if (dagState) {
      dagState.awaitingApproval.delete(approval.taskId);
      dagState.pending.add(approval.taskId);
    }

    await dagScheduler.scheduleReadyTasks(approval.runId);
    return true;
  }

  async denyTask(approvalId: string, decidedBy: string): Promise<boolean> {
    const [approval] = await db
      .select()
      .from(orchestratorApprovals)
      .where(eq(orchestratorApprovals.id, approvalId));

    if (!approval || approval.status !== "pending") return false;

    await db.update(orchestratorApprovals).set({
      status: "denied",
      decidedBy,
      decidedAt: new Date(),
    }).where(eq(orchestratorApprovals.id, approvalId));

    await db.update(orchestratorTasks).set({
      status: "denied",
      error: "Approval denied by " + decidedBy,
      completedAt: new Date(),
    }).where(eq(orchestratorTasks.id, approval.taskId));

    const dagState = dagScheduler.getDAGState(approval.runId);
    if (dagState) {
      dagState.awaitingApproval.delete(approval.taskId);
      dagState.failed.add(approval.taskId);
    }

    return true;
  }

  async checkBudget(runId: string): Promise<{ withinBudget: boolean; spent: number; limit: number | null }> {
    const [run] = await db.select().from(orchestratorRuns).where(eq(orchestratorRuns.id, runId));
    if (!run) return { withinBudget: true, spent: 0, limit: null };

    const spent = run.totalCostUsd;
    const limit = run.budgetLimitUsd;

    if (limit && spent >= limit) {
      await db.update(orchestratorRuns).set({
        status: "paused",
        error: `Budget limit reached: $${spent.toFixed(4)} >= $${limit.toFixed(2)}`,
      }).where(eq(orchestratorRuns.id, runId));

      dagScheduler.pauseRun(runId);
      orchestratorEvents.emit("governance:budget_exceeded", { runId, spent, limit });
      return { withinBudget: false, spent, limit };
    }

    return { withinBudget: true, spent, limit };
  }

  private async onRunStarted(data: { runId: string }) {
    const [run] = await db.select().from(orchestratorRuns).where(eq(orchestratorRuns.id, data.runId));
    if (!run) return;

    const timeLimit = run.timeLimitMs || this.policy.defaultTimeLimitMs;
    const timer = setTimeout(async () => {
      await db.update(orchestratorRuns).set({
        status: "timed_out",
        error: `Time limit exceeded (${timeLimit}ms)`,
        completedAt: new Date(),
      }).where(eq(orchestratorRuns.id, data.runId));

      dagScheduler.pauseRun(data.runId);
      orchestratorEvents.emit("governance:timeout", { runId: data.runId, timeLimitMs: timeLimit });
    }, timeLimit);

    this.runTimers.set(data.runId, timer);
  }

  private async onTaskCostUpdate(data: { runId: string; result: any }) {
    if (!data.result?.costUsd) return;

    await db.update(orchestratorRuns).set({
      totalCostUsd: sql`${orchestratorRuns.totalCostUsd} + ${data.result.costUsd}`,
    }).where(eq(orchestratorRuns.id, data.runId));

    await this.checkBudget(data.runId);
  }

  getPolicy(): GovernancePolicy {
    return { ...this.policy };
  }

  updatePolicy(updates: Partial<GovernancePolicy>) {
    this.policy = { ...this.policy, ...updates };
  }
}

export const governanceEngine = new GovernanceEngine();
