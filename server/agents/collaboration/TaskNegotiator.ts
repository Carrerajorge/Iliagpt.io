import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";
import type { CollaborationProtocol, AgentSession } from "./CollaborationProtocol.js";

const logger = pino({ name: "TaskNegotiator" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus =
  | "open"        // published, awaiting bids
  | "negotiating" // bids received, evaluating
  | "awarded"     // assigned to an agent
  | "in_progress" // actively being worked
  | "completed"
  | "failed"
  | "expired";

export type TaskPriority = "low" | "normal" | "high" | "critical";

export interface Task {
  taskId: string;
  swarmId: string;
  title: string;
  description: string;
  requiredCapabilities: string[];
  priority: TaskPriority;
  estimatedDurationMs?: number;
  deadline?: number;
  maxBudgetTokens?: number;
  assignedTo?: string; // agentId
  status: TaskStatus;
  bids: TaskBid[];
  result?: unknown;
  errorMessage?: string;
  createdBy: string; // agentId
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  /** Retry count */
  attempts: number;
  maxAttempts: number;
}

export interface TaskBid {
  bidId: string;
  taskId: string;
  agentId: string;
  /** Competency score for this task (0-1) — self-assessed */
  competencyScore: number;
  /** Current load at bid time (0-1) */
  currentLoad: number;
  /** Estimated time to complete in ms */
  estimatedDurationMs?: number;
  /** Estimated tokens needed */
  estimatedTokens?: number;
  /** Reasoning for the bid */
  reason?: string;
  submittedAt: number;
  /** Overall bid score computed by the negotiator */
  score?: number;
}

export interface BidEvaluationWeights {
  competency: number;    // how well the agent can do the task
  availability: number;  // how free the agent is
  speed: number;         // how fast they estimate completion
  costEfficiency: number;// token efficiency
}

const DEFAULT_WEIGHTS: BidEvaluationWeights = {
  competency: 0.45,
  availability: 0.25,
  speed: 0.15,
  costEfficiency: 0.15,
};

// ─── TaskNegotiator ───────────────────────────────────────────────────────────

export class TaskNegotiator extends EventEmitter {
  private tasks = new Map<string, Task>();
  /** agentId → Set<taskId> currently assigned */
  private agentAssignments = new Map<string, Set<string>>();

  constructor(
    private readonly protocol: CollaborationProtocol,
    private readonly bidWindowMs: number = 5_000,
    private readonly weights: BidEvaluationWeights = DEFAULT_WEIGHTS
  ) {
    super();

    // Listen for incoming bids
    this.protocol.on("message:task_bid", (msg: { payload: TaskBid; from: string }) => {
      this.receiveBid(msg.payload).catch((err) =>
        logger.error({ err }, "[TaskNegotiator] Error receiving bid")
      );
    });

    // Listen for task completion/failure reports
    this.protocol.on("message:task_complete", (msg: { payload: { taskId: string; result: unknown }; from: string }) => {
      this.handleTaskComplete(msg.payload.taskId, msg.payload.result, msg.from).catch(
        (err) => logger.error({ err }, "[TaskNegotiator] Error handling completion")
      );
    });

    this.protocol.on("message:task_fail", (msg: { payload: { taskId: string; error: string }; from: string }) => {
      this.handleTaskFail(msg.payload.taskId, msg.payload.error, msg.from).catch(
        (err) => logger.error({ err }, "[TaskNegotiator] Error handling failure")
      );
    });

    logger.info("[TaskNegotiator] Initialized");
  }

  // ── Task publishing ───────────────────────────────────────────────────────────

  async publishTask(
    swarmId: string,
    createdBy: string,
    spec: {
      title: string;
      description: string;
      requiredCapabilities: string[];
      priority?: TaskPriority;
      estimatedDurationMs?: number;
      deadline?: number;
      maxBudgetTokens?: number;
      maxAttempts?: number;
    }
  ): Promise<Task> {
    const task: Task = {
      taskId: randomUUID(),
      swarmId,
      title: spec.title,
      description: spec.description,
      requiredCapabilities: spec.requiredCapabilities,
      priority: spec.priority ?? "normal",
      estimatedDurationMs: spec.estimatedDurationMs,
      deadline: spec.deadline,
      maxBudgetTokens: spec.maxBudgetTokens,
      status: "open",
      bids: [],
      createdBy,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      attempts: 0,
      maxAttempts: spec.maxAttempts ?? 3,
    };

    this.tasks.set(task.taskId, task);

    // Broadcast call for proposals
    this.protocol.broadcast(swarmId, {
      from: createdBy,
      type: "task_propose",
      payload: {
        taskId: task.taskId,
        title: task.title,
        description: task.description,
        requiredCapabilities: task.requiredCapabilities,
        priority: task.priority,
        deadline: task.deadline,
        bidDeadline: Date.now() + this.bidWindowMs,
      },
    });

    // Award after bidding window
    setTimeout(async () => {
      await this.awardTask(task.taskId);
    }, this.bidWindowMs);

    logger.info({ taskId: task.taskId, title: task.title }, "[TaskNegotiator] Task published");
    this.emit("task:published", { taskId: task.taskId });
    return task;
  }

  // ── Bidding ───────────────────────────────────────────────────────────────────

  async submitBid(bid: Omit<TaskBid, "bidId" | "submittedAt" | "score">): Promise<TaskBid> {
    const task = this.tasks.get(bid.taskId);
    if (!task) throw new Error(`Task '${bid.taskId}' not found`);
    if (task.status !== "open") {
      throw new Error(`Task '${bid.taskId}' is not accepting bids (status: ${task.status})`);
    }

    // Check capability match
    const agentCapabilities = this.getAgentCapabilities(bid.agentId, task.swarmId);
    const capabilityMatch = task.requiredCapabilities.every((cap) =>
      agentCapabilities.includes(cap)
    );

    if (!capabilityMatch) {
      throw new Error(
        `Agent '${bid.agentId}' lacks required capabilities for task '${bid.taskId}'`
      );
    }

    const fullBid: TaskBid = {
      ...bid,
      bidId: randomUUID(),
      submittedAt: Date.now(),
    };

    task.bids.push(fullBid);
    task.updatedAt = Date.now();

    // Broadcast bid to swarm (for transparency)
    this.protocol.send({
      swarmId: task.swarmId,
      from: bid.agentId,
      to: "broadcast",
      type: "task_bid",
      payload: fullBid,
      correlationId: bid.taskId,
    });

    logger.debug(
      { taskId: bid.taskId, agentId: bid.agentId, competency: bid.competencyScore },
      "[TaskNegotiator] Bid received"
    );

    return fullBid;
  }

  private async receiveBid(bid: TaskBid): Promise<void> {
    const task = this.tasks.get(bid.taskId);
    if (!task || task.status !== "open") return;
    if (!task.bids.find((b) => b.bidId === bid.bidId)) {
      task.bids.push(bid);
    }
  }

  // ── Award ─────────────────────────────────────────────────────────────────────

  async awardTask(taskId: string): Promise<string | null> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);
    if (task.status !== "open") return task.assignedTo ?? null;

    if (task.bids.length === 0) {
      logger.warn({ taskId }, "[TaskNegotiator] No bids received, task expired");
      task.status = "expired";
      task.updatedAt = Date.now();
      this.emit("task:expired", { taskId });
      return null;
    }

    // Score all bids
    const scoredBids = task.bids.map((bid) => ({
      ...bid,
      score: this.scoreBid(bid, task),
    }));

    scoredBids.sort((a, b) => b.score - a.score);
    const winner = scoredBids[0];

    task.status = "awarded";
    task.assignedTo = winner.agentId;
    task.updatedAt = Date.now();

    // Track assignment
    if (!this.agentAssignments.has(winner.agentId)) {
      this.agentAssignments.set(winner.agentId, new Set());
    }
    this.agentAssignments.get(winner.agentId)!.add(taskId);

    // Notify winner
    this.protocol.send({
      swarmId: task.swarmId,
      from: "system",
      to: winner.agentId,
      type: "task_award",
      payload: { taskId, task },
    });

    // Notify losers (politeness)
    for (const bid of task.bids) {
      if (bid.agentId !== winner.agentId) {
        this.protocol.send({
          swarmId: task.swarmId,
          from: "system",
          to: bid.agentId,
          type: "task_reject",
          payload: { taskId, reason: "Another agent was selected" },
        });
      }
    }

    logger.info(
      { taskId, winner: winner.agentId, score: winner.score },
      "[TaskNegotiator] Task awarded"
    );
    this.emit("task:awarded", { taskId, winnerId: winner.agentId });
    return winner.agentId;
  }

  markInProgress(taskId: string, agentId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task.assignedTo !== agentId) {
      throw new Error(`Agent '${agentId}' is not assigned to task '${taskId}'`);
    }

    task.status = "in_progress";
    task.startedAt = Date.now();
    task.attempts++;
    task.updatedAt = Date.now();

    this.protocol.broadcast(task.swarmId, {
      from: agentId,
      type: "task_start",
      payload: { taskId, agentId },
    });

    this.emit("task:started", { taskId, agentId });
  }

  private async handleTaskComplete(
    taskId: string,
    result: unknown,
    agentId: string
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "in_progress") return;

    task.status = "completed";
    task.result = result;
    task.completedAt = Date.now();
    task.updatedAt = Date.now();

    this.agentAssignments.get(agentId)?.delete(taskId);

    this.emit("task:completed", { taskId, agentId, result });
    logger.info({ taskId, agentId }, "[TaskNegotiator] Task completed");
  }

  private async handleTaskFail(
    taskId: string,
    error: string,
    agentId: string
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    this.agentAssignments.get(agentId)?.delete(taskId);

    if (task.attempts < task.maxAttempts) {
      logger.warn(
        { taskId, attempt: task.attempts, maxAttempts: task.maxAttempts },
        "[TaskNegotiator] Task failed, retrying"
      );
      // Reset to open for re-bidding
      task.status = "open";
      task.assignedTo = undefined;
      task.bids = [];
      task.updatedAt = Date.now();

      // Re-publish after a short delay
      setTimeout(() => {
        this.protocol.broadcast(task.swarmId, {
          from: "system",
          type: "task_propose",
          payload: { taskId, retryAttempt: task.attempts, ...task },
        });
        setTimeout(() => this.awardTask(taskId), this.bidWindowMs);
      }, 2_000);
    } else {
      task.status = "failed";
      task.errorMessage = error;
      task.updatedAt = Date.now();
      this.emit("task:failed", { taskId, error, attempts: task.attempts });
      logger.error({ taskId, error, attempts: task.attempts }, "[TaskNegotiator] Task failed permanently");
    }
  }

  // ── Scoring ───────────────────────────────────────────────────────────────────

  private scoreBid(bid: TaskBid, task: Task): number {
    const availability = 1 - bid.currentLoad;

    const speedScore =
      bid.estimatedDurationMs && task.estimatedDurationMs
        ? Math.max(0, 1 - bid.estimatedDurationMs / task.estimatedDurationMs)
        : 0.5;

    const costScore =
      bid.estimatedTokens && task.maxBudgetTokens
        ? Math.max(0, 1 - bid.estimatedTokens / task.maxBudgetTokens)
        : 0.5;

    const priorityMultiplier =
      task.priority === "critical" ? 1.2 :
      task.priority === "high" ? 1.1 :
      task.priority === "normal" ? 1.0 : 0.9;

    const raw =
      this.weights.competency * bid.competencyScore +
      this.weights.availability * availability +
      this.weights.speed * speedScore +
      this.weights.costEfficiency * costScore;

    return raw * priorityMultiplier;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private getAgentCapabilities(agentId: string, swarmId: string): string[] {
    const swarm = this.protocol.getSwarm(swarmId);
    if (!swarm) return [];
    return swarm.agents.get(agentId)?.capabilities ?? [];
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  getTask(taskId: string): Task | null {
    return this.tasks.get(taskId) ?? null;
  }

  getAgentTasks(agentId: string): Task[] {
    const ids = this.agentAssignments.get(agentId) ?? new Set();
    return Array.from(ids)
      .map((id) => this.tasks.get(id))
      .filter((t): t is Task => t !== undefined);
  }

  getSwarmTasks(swarmId: string, status?: TaskStatus): Task[] {
    return Array.from(this.tasks.values())
      .filter((t) => t.swarmId === swarmId)
      .filter((t) => !status || t.status === status);
  }

  getStats() {
    const all = Array.from(this.tasks.values());
    return {
      total: all.length,
      open: all.filter((t) => t.status === "open").length,
      inProgress: all.filter((t) => t.status === "in_progress").length,
      completed: all.filter((t) => t.status === "completed").length,
      failed: all.filter((t) => t.status === "failed").length,
      expired: all.filter((t) => t.status === "expired").length,
    };
  }
}
