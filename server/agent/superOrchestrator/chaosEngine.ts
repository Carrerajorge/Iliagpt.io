import { randomUUID } from "crypto";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../db";
import { orchestratorRuns, orchestratorTasks } from "@shared/schema";
import { dagScheduler } from "./dagScheduler";
import { orchestratorEvents } from "./queue";

export type ChaosExperimentType =
  | "kill-random-agent"
  | "inject-latency"
  | "fail-percentage"
  | "budget-spike"
  | "network-partition"
  | "queue-flood";

export const EXPERIMENT_TYPES: ChaosExperimentType[] = [
  "kill-random-agent",
  "inject-latency",
  "fail-percentage",
  "budget-spike",
  "network-partition",
  "queue-flood",
];

export interface ChaosExperimentResults {
  affectedTasks: string[];
  metricsBefore: Record<string, any>;
  metricsAfter: Record<string, any>;
  errorsInjected: number;
}

export interface ChaosExperiment {
  id: string;
  type: ChaosExperimentType;
  params: Record<string, any>;
  status: "pending" | "running" | "completed" | "stopped";
  startedAt: Date | null;
  stoppedAt: Date | null;
  results: ChaosExperimentResults;
}

export const chaosFlags = {
  latencyMs: 0,
  failPercentage: 0,
  budgetSpikeMultiplier: 1,
};

class ChaosEngine {
  private experiments = new Map<string, ChaosExperiment>();
  private timers = new Map<string, NodeJS.Timeout>();
  private totalExperimentsRun = 0;

  private ensureNotProduction(): void {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Chaos experiments cannot run in production");
    }
  }

  async startExperiment(
    type: ChaosExperimentType,
    params: Record<string, any> = {}
  ): Promise<ChaosExperiment> {
    this.ensureNotProduction();

    if (!EXPERIMENT_TYPES.includes(type)) {
      throw new Error(`Unknown experiment type: ${type}`);
    }

    const maxDurationMs = params.maxDurationMs || 60000;

    const experiment: ChaosExperiment = {
      id: randomUUID(),
      type,
      params,
      status: "running",
      startedAt: new Date(),
      stoppedAt: null,
      results: {
        affectedTasks: [],
        metricsBefore: {},
        metricsAfter: {},
        errorsInjected: 0,
      },
    };

    this.experiments.set(experiment.id, experiment);
    this.totalExperimentsRun++;

    const timer = setTimeout(() => {
      this.stopExperiment(experiment.id);
    }, maxDurationMs);
    this.timers.set(experiment.id, timer);

    try {
      await this.executeExperiment(experiment);
    } catch (err: any) {
      experiment.results.metricsAfter.error = err.message;
    }

    orchestratorEvents.emit("chaos:started", {
      experimentId: experiment.id,
      type,
      params,
    });

    return experiment;
  }

  async stopExperiment(id: string): Promise<ChaosExperiment | null> {
    const experiment = this.experiments.get(id);
    if (!experiment || experiment.status !== "running") return experiment || null;

    experiment.status = "stopped";
    experiment.stoppedAt = new Date();

    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }

    this.cleanupExperiment(experiment);

    orchestratorEvents.emit("chaos:stopped", { experimentId: id });

    return experiment;
  }

  getExperiment(id: string): ChaosExperiment | null {
    return this.experiments.get(id) || null;
  }

  listExperiments(): ChaosExperiment[] {
    return Array.from(this.experiments.values()).sort(
      (a, b) =>
        (b.startedAt?.getTime() || 0) - (a.startedAt?.getTime() || 0)
    );
  }

  getStats(): {
    totalExperiments: number;
    activeExperiments: number;
    experimentsByType: Record<string, number>;
    totalErrorsInjected: number;
    totalAffectedTasks: number;
    isProduction: boolean;
  } {
    const all = Array.from(this.experiments.values());
    const active = all.filter((e) => e.status === "running");

    const byType: Record<string, number> = {};
    for (const e of all) {
      byType[e.type] = (byType[e.type] || 0) + 1;
    }

    let totalErrors = 0;
    let totalAffected = 0;
    for (const e of all) {
      totalErrors += e.results.errorsInjected;
      totalAffected += e.results.affectedTasks.length;
    }

    return {
      totalExperiments: this.totalExperimentsRun,
      activeExperiments: active.length,
      experimentsByType: byType,
      totalErrorsInjected: totalErrors,
      totalAffectedTasks: totalAffected,
      isProduction: process.env.NODE_ENV === "production",
    };
  }

  private async executeExperiment(experiment: ChaosExperiment): Promise<void> {
    switch (experiment.type) {
      case "kill-random-agent":
        await this.execKillRandomAgent(experiment);
        break;
      case "inject-latency":
        this.execInjectLatency(experiment);
        break;
      case "fail-percentage":
        this.execFailPercentage(experiment);
        break;
      case "budget-spike":
        this.execBudgetSpike(experiment);
        break;
      case "network-partition":
        await this.execNetworkPartition(experiment);
        break;
      case "queue-flood":
        await this.execQueueFlood(experiment);
        break;
    }
  }

  private async execKillRandomAgent(experiment: ChaosExperiment): Promise<void> {
    const runningTasks = await db
      .select()
      .from(orchestratorTasks)
      .where(eq(orchestratorTasks.status, "running"))
      .limit(50);

    experiment.results.metricsBefore = {
      runningTaskCount: runningTasks.length,
    };

    if (runningTasks.length === 0) {
      experiment.status = "completed";
      experiment.stoppedAt = new Date();
      experiment.results.metricsAfter = { message: "No running tasks to kill" };
      return;
    }

    const target = runningTasks[Math.floor(Math.random() * runningTasks.length)];

    await db
      .update(orchestratorTasks)
      .set({
        status: "failed",
        error: "Killed by chaos experiment: " + experiment.id,
        completedAt: new Date(),
      })
      .where(eq(orchestratorTasks.id, target.id));

    experiment.results.affectedTasks.push(target.id);
    experiment.results.errorsInjected = 1;
    experiment.results.metricsAfter = {
      killedTaskId: target.id,
      killedRole: target.agentRole,
    };
    experiment.status = "completed";
    experiment.stoppedAt = new Date();
  }

  private execInjectLatency(experiment: ChaosExperiment): void {
    const delayMs = experiment.params.delayMs || 2000;

    experiment.results.metricsBefore = {
      previousLatencyMs: chaosFlags.latencyMs,
    };

    chaosFlags.latencyMs = delayMs;

    experiment.results.metricsAfter = {
      injectedLatencyMs: delayMs,
    };
    experiment.results.errorsInjected = 1;
  }

  private execFailPercentage(experiment: ChaosExperiment): void {
    const percentage = Math.min(
      100,
      Math.max(0, experiment.params.percentage || 10)
    );

    experiment.results.metricsBefore = {
      previousFailPercentage: chaosFlags.failPercentage,
    };

    chaosFlags.failPercentage = percentage;

    experiment.results.metricsAfter = {
      failPercentage: percentage,
    };
    experiment.results.errorsInjected = 1;
  }

  private execBudgetSpike(experiment: ChaosExperiment): void {
    const multiplier = experiment.params.multiplier || 10;

    experiment.results.metricsBefore = {
      previousMultiplier: chaosFlags.budgetSpikeMultiplier,
    };

    chaosFlags.budgetSpikeMultiplier = multiplier;

    experiment.results.metricsAfter = {
      budgetMultiplier: multiplier,
    };
    experiment.results.errorsInjected = 1;
  }

  private async execNetworkPartition(experiment: ChaosExperiment): Promise<void> {
    const activeRuns = await db
      .select({ id: orchestratorRuns.id })
      .from(orchestratorRuns)
      .where(eq(orchestratorRuns.status, "running"));

    experiment.results.metricsBefore = {
      activeRunCount: activeRuns.length,
    };

    for (const run of activeRuns) {
      dagScheduler.pauseRun(run.id);
      experiment.results.affectedTasks.push(run.id);
    }

    experiment.results.errorsInjected = activeRuns.length;
    experiment.results.metricsAfter = {
      partitionedRuns: activeRuns.length,
    };
  }

  private async execQueueFlood(experiment: ChaosExperiment): Promise<void> {
    const count = experiment.params.count || 100;

    experiment.results.metricsBefore = { floodCount: count };

    let submitted = 0;
    try {
      const [run] = await db
        .insert(orchestratorRuns)
        .values({
          objective: `[CHAOS] Queue flood test - ${experiment.id}`,
          status: "running",
          priority: 1,
          createdBy: "chaos-engine",
          totalTasks: count,
        })
        .returning();

      const tasks = [];
      for (let i = 0; i < count; i++) {
        tasks.push({
          runId: run.id,
          agentRole: "chaos_dummy",
          label: `Chaos dummy task ${i + 1}`,
          status: "pending" as const,
          inputJson: { chaos: true, experimentId: experiment.id },
          maxRetries: 0,
          dependsOn: [],
          riskLevel: "safe",
        });
      }

      const inserted = await db
        .insert(orchestratorTasks)
        .values(tasks)
        .returning({ id: orchestratorTasks.id });

      submitted = inserted.length;
      experiment.results.affectedTasks.push(
        run.id,
        ...inserted.map((t) => t.id)
      );
    } catch (err: any) {
      experiment.results.metricsAfter.floodError = err.message;
    }

    experiment.results.errorsInjected = submitted;
    experiment.results.metricsAfter = {
      ...experiment.results.metricsAfter,
      tasksSubmitted: submitted,
    };
    experiment.status = "completed";
    experiment.stoppedAt = new Date();
  }

  private cleanupExperiment(experiment: ChaosExperiment): void {
    switch (experiment.type) {
      case "inject-latency":
        chaosFlags.latencyMs = 0;
        break;
      case "fail-percentage":
        chaosFlags.failPercentage = 0;
        break;
      case "budget-spike":
        chaosFlags.budgetSpikeMultiplier = 1;
        break;
      case "network-partition":
        for (const runId of experiment.results.affectedTasks) {
          dagScheduler.resumeRun(runId);
        }
        break;
    }
  }
}

export const chaosEngine = new ChaosEngine();
