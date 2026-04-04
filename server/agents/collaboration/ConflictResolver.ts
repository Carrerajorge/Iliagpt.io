import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";
import type { CollaborationProtocol } from "./CollaborationProtocol.js";

const logger = pino({ name: "ConflictResolver" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConflictType =
  | "factual_contradiction"   // two agents claim different facts
  | "output_mismatch"          // two agents produced different outputs for same input
  | "resource_contention"      // two agents trying to use the same resource
  | "plan_divergence"          // agents have incompatible plans
  | "priority_clash";          // conflicting task priorities

export type ResolutionStrategy =
  | "majority_vote"
  | "expertise_weighted"
  | "leader_decides"
  | "human_escalation"
  | "merge"
  | "latest_wins"
  | "confidence_weighted";

export type ConflictStatus = "open" | "resolving" | "resolved" | "escalated";

export interface ConflictingOutput {
  agentId: string;
  output: unknown;
  confidence: number; // 0-1 self-reported
  reasoning?: string;
  producedAt: number;
}

export interface Conflict {
  conflictId: string;
  swarmId: string;
  taskId?: string;
  type: ConflictType;
  description: string;
  outputs: ConflictingOutput[];
  status: ConflictStatus;
  chosenStrategy?: ResolutionStrategy;
  resolution?: ConflictResolution;
  detectedAt: number;
  resolvedAt?: number;
  auditTrail: AuditEntry[];
}

export interface ConflictResolution {
  resolvedBy: string; // agentId or "system" or "human"
  strategy: ResolutionStrategy;
  winner?: string; // agentId of the winning output
  mergedOutput?: unknown; // if strategy is "merge"
  rationale: string;
  confidence: number;
}

export interface AuditEntry {
  timestamp: number;
  actor: string; // agentId or "system"
  action: string;
  details?: unknown;
}

export interface ExpertiseProfile {
  agentId: string;
  /** domain → expertise level (0-1) */
  expertise: Record<string, number>;
  historicalAccuracy: number; // 0-1 based on past resolutions
  totalResolutionsParticipated: number;
}

// ─── Conflict detector ────────────────────────────────────────────────────────

function detectConflict(outputs: ConflictingOutput[]): boolean {
  if (outputs.length < 2) return false;

  // String outputs: check if they're meaningfully different
  const stringOutputs = outputs
    .map((o) => o.output)
    .filter((o) => typeof o === "string") as string[];

  if (stringOutputs.length >= 2) {
    const normalized = stringOutputs.map((s) => s.toLowerCase().trim());
    const allSame = normalized.every((s) => s === normalized[0]);
    return !allSame;
  }

  // Numeric outputs: check if variance is significant
  const numericOutputs = outputs
    .map((o) => o.output)
    .filter((o) => typeof o === "number") as number[];

  if (numericOutputs.length >= 2) {
    const mean = numericOutputs.reduce((a, b) => a + b, 0) / numericOutputs.length;
    const variance =
      numericOutputs.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / numericOutputs.length;
    return variance / (mean * mean + 1) > 0.05; // >5% coefficient of variation
  }

  // Object outputs: structural diff
  const objOutputs = outputs.map((o) => JSON.stringify(o.output));
  return !objOutputs.every((s) => s === objOutputs[0]);
}

// ─── ConflictResolver ─────────────────────────────────────────────────────────

export class ConflictResolver extends EventEmitter {
  private conflicts = new Map<string, Conflict>();
  private expertiseProfiles = new Map<string, ExpertiseProfile>();
  private resolverQueue: Array<() => Promise<void>> = [];
  private processing = false;

  constructor(
    private readonly protocol: CollaborationProtocol,
    private readonly defaultStrategy: ResolutionStrategy = "confidence_weighted",
    private readonly humanEscalationThreshold = 0.5 // escalate if best confidence < this
  ) {
    super();
    logger.info({ defaultStrategy }, "[ConflictResolver] Initialized");
  }

  // ── Conflict detection ────────────────────────────────────────────────────────

  async detectAndReport(
    swarmId: string,
    outputs: ConflictingOutput[],
    context: {
      taskId?: string;
      type?: ConflictType;
      description?: string;
    } = {}
  ): Promise<Conflict | null> {
    if (!detectConflict(outputs)) {
      return null; // No conflict
    }

    const conflict: Conflict = {
      conflictId: randomUUID(),
      swarmId,
      taskId: context.taskId,
      type: context.type ?? "output_mismatch",
      description:
        context.description ??
        `${outputs.length} agents produced conflicting outputs`,
      outputs,
      status: "open",
      detectedAt: Date.now(),
      auditTrail: [
        {
          timestamp: Date.now(),
          actor: "system",
          action: "conflict_detected",
          details: { outputCount: outputs.length, type: context.type },
        },
      ],
    };

    this.conflicts.set(conflict.conflictId, conflict);
    logger.warn(
      { conflictId: conflict.conflictId, type: conflict.type, outputs: outputs.length },
      "[ConflictResolver] Conflict detected"
    );

    this.emit("conflict:detected", { conflictId: conflict.conflictId, swarmId });

    // Notify swarm
    this.protocol.broadcast(swarmId, {
      from: "system",
      type: "conflict",
      payload: {
        conflictId: conflict.conflictId,
        type: conflict.type,
        description: conflict.description,
      },
    });

    // Enqueue for automatic resolution
    this.enqueueResolution(conflict.conflictId);

    return conflict;
  }

  // ── Resolution strategies ─────────────────────────────────────────────────────

  private enqueueResolution(conflictId: string): void {
    this.resolverQueue.push(() => this.resolve(conflictId));
    if (!this.processing) this.processQueue();
  }

  private async processQueue(): Promise<void> {
    this.processing = true;
    while (this.resolverQueue.length > 0) {
      const task = this.resolverQueue.shift()!;
      try {
        await task();
      } catch (err) {
        logger.error({ err }, "[ConflictResolver] Resolution task error");
      }
    }
    this.processing = false;
  }

  async resolve(
    conflictId: string,
    forceStrategy?: ResolutionStrategy
  ): Promise<ConflictResolution> {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict) throw new Error(`Conflict '${conflictId}' not found`);
    if (conflict.status === "resolved") return conflict.resolution!;

    conflict.status = "resolving";
    conflict.auditTrail.push({
      timestamp: Date.now(),
      actor: "system",
      action: "resolution_started",
      details: { strategy: forceStrategy ?? this.defaultStrategy },
    });

    const strategy = forceStrategy ?? this.selectStrategy(conflict);

    let resolution: ConflictResolution;

    switch (strategy) {
      case "confidence_weighted":
        resolution = await this.resolveByConfidence(conflict);
        break;
      case "expertise_weighted":
        resolution = await this.resolveByExpertise(conflict);
        break;
      case "majority_vote":
        resolution = await this.resolveByVoting(conflict);
        break;
      case "leader_decides":
        resolution = await this.resolveByLeader(conflict);
        break;
      case "latest_wins":
        resolution = this.resolveByRecency(conflict);
        break;
      case "merge":
        resolution = this.resolveByMerge(conflict);
        break;
      case "human_escalation":
        return this.escalateToHuman(conflict);
      default:
        resolution = await this.resolveByConfidence(conflict);
    }

    // Check if confidence is too low — escalate
    if (resolution.confidence < this.humanEscalationThreshold) {
      logger.warn(
        { conflictId, confidence: resolution.confidence },
        "[ConflictResolver] Low resolution confidence, escalating to human"
      );
      return this.escalateToHuman(conflict);
    }

    conflict.status = "resolved";
    conflict.chosenStrategy = strategy;
    conflict.resolution = resolution;
    conflict.resolvedAt = Date.now();
    conflict.auditTrail.push({
      timestamp: Date.now(),
      actor: resolution.resolvedBy,
      action: "conflict_resolved",
      details: { strategy, winner: resolution.winner, confidence: resolution.confidence },
    });

    // Update expertise profiles
    if (resolution.winner) {
      this.reinforceExpertise(resolution.winner, conflict, true);
      for (const o of conflict.outputs) {
        if (o.agentId !== resolution.winner) {
          this.reinforceExpertise(o.agentId, conflict, false);
        }
      }
    }

    this.emit("conflict:resolved", {
      conflictId,
      strategy,
      winner: resolution.winner,
      confidence: resolution.confidence,
    });

    logger.info(
      { conflictId, strategy, winner: resolution.winner, confidence: resolution.confidence },
      "[ConflictResolver] Conflict resolved"
    );

    return resolution;
  }

  private async resolveByConfidence(conflict: Conflict): Promise<ConflictResolution> {
    const sorted = [...conflict.outputs].sort((a, b) => b.confidence - a.confidence);
    const winner = sorted[0];

    return {
      resolvedBy: "system",
      strategy: "confidence_weighted",
      winner: winner.agentId,
      rationale: `Selected agent '${winner.agentId}' with highest self-reported confidence (${winner.confidence.toFixed(2)})`,
      confidence: winner.confidence,
    };
  }

  private async resolveByExpertise(conflict: Conflict): Promise<ConflictResolution> {
    const scored = conflict.outputs.map((o) => {
      const profile = this.expertiseProfiles.get(o.agentId);
      const expertiseScore = profile
        ? Object.values(profile.expertise).reduce((s, v) => s + v, 0) /
          Math.max(1, Object.keys(profile.expertise).length)
        : 0.5;
      const accuracy = profile?.historicalAccuracy ?? 0.5;
      return { ...o, score: expertiseScore * 0.6 + accuracy * 0.4 };
    });

    scored.sort((a, b) => b.score - a.score);
    const winner = scored[0];

    return {
      resolvedBy: "system",
      strategy: "expertise_weighted",
      winner: winner.agentId,
      rationale: `Selected agent '${winner.agentId}' based on expertise and historical accuracy`,
      confidence: winner.score,
    };
  }

  private async resolveByVoting(conflict: Conflict): Promise<ConflictResolution> {
    // Group outputs by their serialized value and count votes
    const groups = new Map<string, { agents: string[]; output: unknown }>();

    for (const o of conflict.outputs) {
      const key = JSON.stringify(o.output);
      if (!groups.has(key)) {
        groups.set(key, { agents: [], output: o.output });
      }
      groups.get(key)!.agents.push(o.agentId);
    }

    const winner = Array.from(groups.values()).sort(
      (a, b) => b.agents.length - a.agents.length
    )[0];

    const confidence = winner.agents.length / conflict.outputs.length;
    const winnerAgent = winner.agents[0];

    return {
      resolvedBy: "system",
      strategy: "majority_vote",
      winner: winnerAgent,
      rationale: `${winner.agents.length}/${conflict.outputs.length} agents agreed on this output`,
      confidence,
    };
  }

  private async resolveByLeader(conflict: Conflict): Promise<ConflictResolution> {
    const swarm = this.protocol.getSwarm(conflict.swarmId);
    const leaderId = swarm?.leaderId;

    if (!leaderId) {
      return this.resolveByConfidence(conflict);
    }

    const leaderOutput = conflict.outputs.find((o) => o.agentId === leaderId);
    if (!leaderOutput) {
      return this.resolveByConfidence(conflict);
    }

    return {
      resolvedBy: leaderId,
      strategy: "leader_decides",
      winner: leaderId,
      rationale: `Swarm leader '${leaderId}' output selected`,
      confidence: leaderOutput.confidence,
    };
  }

  private resolveByRecency(conflict: Conflict): ConflictResolution {
    const sorted = [...conflict.outputs].sort(
      (a, b) => b.producedAt - a.producedAt
    );
    const winner = sorted[0];

    return {
      resolvedBy: "system",
      strategy: "latest_wins",
      winner: winner.agentId,
      rationale: `Most recent output selected (${new Date(winner.producedAt).toISOString()})`,
      confidence: winner.confidence,
    };
  }

  private resolveByMerge(conflict: Conflict): ConflictResolution {
    // Merge object outputs by combining all fields
    const merged: Record<string, unknown> = {};
    let totalConfidence = 0;

    for (const o of conflict.outputs) {
      totalConfidence += o.confidence;
      if (o.output && typeof o.output === "object") {
        for (const [k, v] of Object.entries(o.output as Record<string, unknown>)) {
          if (!(k in merged)) {
            merged[k] = v;
          }
        }
      }
    }

    return {
      resolvedBy: "system",
      strategy: "merge",
      mergedOutput: merged,
      rationale: `Merged outputs from ${conflict.outputs.length} agents`,
      confidence: totalConfidence / conflict.outputs.length,
    };
  }

  private escalateToHuman(conflict: Conflict): ConflictResolution {
    conflict.status = "escalated";
    conflict.auditTrail.push({
      timestamp: Date.now(),
      actor: "system",
      action: "escalated_to_human",
    });

    this.emit("conflict:escalated", { conflictId: conflict.conflictId });
    logger.info({ conflictId: conflict.conflictId }, "[ConflictResolver] Escalated to human");

    return {
      resolvedBy: "human",
      strategy: "human_escalation",
      rationale: "Conflict requires human review due to low resolution confidence",
      confidence: 0,
    };
  }

  private selectStrategy(conflict: Conflict): ResolutionStrategy {
    const hasExpertiseData = conflict.outputs.some((o) =>
      this.expertiseProfiles.has(o.agentId)
    );

    if (hasExpertiseData) return "expertise_weighted";

    const swarm = this.protocol.getSwarm(conflict.swarmId);
    if (swarm?.leaderId) return "leader_decides";

    return this.defaultStrategy;
  }

  // ── Expertise management ──────────────────────────────────────────────────────

  registerExpertise(
    agentId: string,
    expertise: Record<string, number>
  ): void {
    const existing = this.expertiseProfiles.get(agentId);
    this.expertiseProfiles.set(agentId, {
      agentId,
      expertise: { ...(existing?.expertise ?? {}), ...expertise },
      historicalAccuracy: existing?.historicalAccuracy ?? 0.5,
      totalResolutionsParticipated: existing?.totalResolutionsParticipated ?? 0,
    });
  }

  private reinforceExpertise(
    agentId: string,
    _conflict: Conflict,
    wasCorrect: boolean
  ): void {
    const profile = this.expertiseProfiles.get(agentId) ?? {
      agentId,
      expertise: {},
      historicalAccuracy: 0.5,
      totalResolutionsParticipated: 0,
    };

    const n = profile.totalResolutionsParticipated + 1;
    const newAccuracy =
      (profile.historicalAccuracy * (n - 1) + (wasCorrect ? 1 : 0)) / n;

    this.expertiseProfiles.set(agentId, {
      ...profile,
      historicalAccuracy: newAccuracy,
      totalResolutionsParticipated: n,
    });
  }

  // ── Manual override ───────────────────────────────────────────────────────────

  manualResolve(
    conflictId: string,
    winnerId: string,
    humanId: string,
    rationale: string
  ): void {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict) throw new Error(`Conflict '${conflictId}' not found`);

    const resolution: ConflictResolution = {
      resolvedBy: humanId,
      strategy: "human_escalation",
      winner: winnerId,
      rationale,
      confidence: 1.0,
    };

    conflict.status = "resolved";
    conflict.resolution = resolution;
    conflict.resolvedAt = Date.now();
    conflict.auditTrail.push({
      timestamp: Date.now(),
      actor: humanId,
      action: "manual_resolution",
      details: { winnerId, rationale },
    });

    this.emit("conflict:resolved", {
      conflictId,
      strategy: "human_escalation",
      winner: winnerId,
      confidence: 1.0,
    });
    logger.info({ conflictId, winnerId, humanId }, "[ConflictResolver] Manual resolution applied");
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  getConflict(conflictId: string): Conflict | null {
    return this.conflicts.get(conflictId) ?? null;
  }

  getOpenConflicts(swarmId?: string): Conflict[] {
    return Array.from(this.conflicts.values())
      .filter((c) => c.status === "open" || c.status === "resolving")
      .filter((c) => !swarmId || c.swarmId === swarmId);
  }

  getAuditLog(conflictId: string): AuditEntry[] {
    return this.conflicts.get(conflictId)?.auditTrail ?? [];
  }

  getStats() {
    const all = Array.from(this.conflicts.values());
    return {
      total: all.length,
      open: all.filter((c) => c.status === "open").length,
      resolving: all.filter((c) => c.status === "resolving").length,
      resolved: all.filter((c) => c.status === "resolved").length,
      escalated: all.filter((c) => c.status === "escalated").length,
      byType: Object.fromEntries(
        ["factual_contradiction", "output_mismatch", "resource_contention", "plan_divergence", "priority_clash"]
          .map((t) => [t, all.filter((c) => c.type === t).length])
      ),
    };
  }
}
