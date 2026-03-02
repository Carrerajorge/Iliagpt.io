import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { orchestratorTasks, orchestratorRuns } from "@shared/schema";
import type { OrchestratorTask } from "@shared/schema";
import { enqueueTask, orchestratorEvents } from "./queue";

export interface DAGNode {
  taskId: string;
  agentRole: string;
  label: string;
  dependsOn: string[];
  status: string;
  riskLevel: string;
}

export interface DAGState {
  runId: string;
  nodes: Map<string, DAGNode>;
  completed: Set<string>;
  failed: Set<string>;
  running: Set<string>;
  pending: Set<string>;
  awaitingApproval: Set<string>;
}

export class DAGScheduler {
  private states = new Map<string, DAGState>();
  private concurrencyLimits = new Map<string, number>();
  private paused = new Set<string>();
  private killed = false;

  constructor() {
    orchestratorEvents.on("task:completed", (data) => this.onTaskCompleted(data));
    orchestratorEvents.on("task:failed", (data) => this.onTaskFailed(data));
  }

  async initializeFromDB(runId: string): Promise<DAGState> {
    const tasks = await db
      .select()
      .from(orchestratorTasks)
      .where(eq(orchestratorTasks.runId, runId));

    const state: DAGState = {
      runId,
      nodes: new Map(),
      completed: new Set(),
      failed: new Set(),
      running: new Set(),
      pending: new Set(),
      awaitingApproval: new Set(),
    };

    for (const task of tasks) {
      state.nodes.set(task.id, {
        taskId: task.id,
        agentRole: task.agentRole,
        label: task.label,
        dependsOn: task.dependsOn || [],
        status: task.status,
        riskLevel: task.riskLevel,
      });

      if (task.status === "completed") state.completed.add(task.id);
      else if (task.status === "failed" || task.status === "skipped" || task.status === "denied" || task.status === "cancelled") state.failed.add(task.id);
      else if (task.status === "running") state.running.add(task.id);
      else if (task.status === "awaiting_approval") state.awaitingApproval.add(task.id);
      else state.pending.add(task.id);
    }

    this.states.set(runId, state);
    return state;
  }

  getReadyTasks(runId: string): DAGNode[] {
    const state = this.states.get(runId);
    if (!state) return [];
    if (this.killed || this.paused.has(runId)) return [];

    const concurrencyLimit = this.concurrencyLimits.get(runId) || 10;
    const availableSlots = concurrencyLimit - state.running.size;
    if (availableSlots <= 0) return [];

    const ready: DAGNode[] = [];

    for (const taskId of state.pending) {
      const node = state.nodes.get(taskId);
      if (!node) continue;

      const depsResolved = node.dependsOn.every(
        (depId) => state.completed.has(depId)
      );

      const depsFailed = node.dependsOn.some(
        (depId) => state.failed.has(depId)
      );

      if (depsFailed) {
        state.pending.delete(taskId);
        state.failed.add(taskId);
        node.status = "skipped";
        this.updateTaskStatus(taskId, "skipped", "Dependency failed");
        continue;
      }

      if (depsResolved) {
        ready.push(node);
      }
    }

    return ready.slice(0, availableSlots);
  }

  async scheduleReadyTasks(runId: string): Promise<number> {
    const ready = this.getReadyTasks(runId);
    if (ready.length === 0) return 0;

    const state = this.states.get(runId)!;
    let scheduled = 0;

    for (const node of ready) {
      const task = await db
        .select()
        .from(orchestratorTasks)
        .where(eq(orchestratorTasks.id, node.taskId))
        .then((rows) => rows[0]);

      if (!task) continue;

      state.pending.delete(node.taskId);
      state.running.add(node.taskId);
      node.status = "running";

      await this.updateTaskStatus(node.taskId, "running");

      const jobId = await enqueueTask({
        runId,
        taskId: node.taskId,
        agentRole: node.agentRole,
        input: task.inputJson,
        retryCount: task.retryCount,
        maxRetries: task.maxRetries,
        riskLevel: node.riskLevel,
      });

      if (!jobId) {
        orchestratorEvents.emit("task:inline", {
          runId,
          taskId: node.taskId,
          task,
        });
      }

      scheduled++;
    }

    return scheduled;
  }

  private async onTaskCompleted(data: { runId: string; taskId: string; result: any }) {
    const state = this.states.get(data.runId);
    if (!state) return;

    const node = state.nodes.get(data.taskId);
    if (!node) return;

    state.running.delete(data.taskId);
    state.completed.add(data.taskId);
    node.status = "completed";

    await this.updateTaskStatus(data.taskId, "completed");
    await this.updateRunProgress(data.runId);

    if (this.isDAGComplete(data.runId)) {
      orchestratorEvents.emit("run:completed", { runId: data.runId });
      await this.updateRunStatus(data.runId, "completed");
    } else {
      await this.scheduleReadyTasks(data.runId);
    }
  }

  private async onTaskFailed(data: { runId: string; taskId: string; error: string; retryCount: number; maxRetries: number }) {
    const state = this.states.get(data.runId);
    if (!state) return;

    const node = state.nodes.get(data.taskId);
    if (!node) return;

    if (data.retryCount < data.maxRetries) {
      return;
    }

    state.running.delete(data.taskId);
    state.failed.add(data.taskId);
    node.status = "failed";

    await this.updateTaskStatus(data.taskId, "failed", data.error);
    await this.updateRunProgress(data.runId);

    const criticalFailure = node.riskLevel === "critical" || node.riskLevel === "dangerous";
    if (criticalFailure) {
      orchestratorEvents.emit("run:failed", {
        runId: data.runId,
        reason: `Critical task ${data.taskId} failed: ${data.error}`,
      });
      await this.updateRunStatus(data.runId, "failed", `Critical task failed: ${data.error}`);
    } else {
      await this.scheduleReadyTasks(data.runId);
      if (this.isDAGComplete(data.runId)) {
        const state = this.states.get(data.runId)!;
        const hasFailures = state.failed.size > 0;
        await this.updateRunStatus(data.runId, hasFailures ? "completed_with_errors" : "completed");
      }
    }
  }

  isDAGComplete(runId: string): boolean {
    const state = this.states.get(runId);
    if (!state) return true;
    return state.pending.size === 0 && state.running.size === 0 && state.awaitingApproval.size === 0;
  }

  setConcurrencyLimit(runId: string, limit: number) {
    this.concurrencyLimits.set(runId, Math.max(1, Math.min(limit, 100)));
  }

  pauseRun(runId: string) {
    this.paused.add(runId);
  }

  resumeRun(runId: string) {
    this.paused.delete(runId);
    this.scheduleReadyTasks(runId);
  }

  globalKill() {
    this.killed = true;
    orchestratorEvents.emit("global:kill");
  }

  globalResume() {
    this.killed = false;
  }

  isKilled(): boolean {
    return this.killed;
  }

  getDAGState(runId: string): DAGState | undefined {
    return this.states.get(runId);
  }

  private async updateTaskStatus(taskId: string, status: string, error?: string) {
    const updates: any = { status };
    if (status === "running") updates.startedAt = new Date();
    if (status === "completed" || status === "failed" || status === "skipped") {
      updates.completedAt = new Date();
    }
    if (error) updates.error = error;

    await db.update(orchestratorTasks).set(updates).where(eq(orchestratorTasks.id, taskId));
  }

  private async updateRunProgress(runId: string) {
    const state = this.states.get(runId);
    if (!state) return;

    await db.update(orchestratorRuns).set({
      completedTasks: state.completed.size,
      failedTasks: state.failed.size,
    }).where(eq(orchestratorRuns.id, runId));
  }

  private async updateRunStatus(runId: string, status: string, error?: string) {
    const updates: any = { status, completedAt: new Date() };
    if (error) updates.error = error;
    await db.update(orchestratorRuns).set(updates).where(eq(orchestratorRuns.id, runId));
  }
}

export const dagScheduler = new DAGScheduler();
