import { randomUUID } from "crypto";
import pino from "pino";
import { VectorMemoryStore } from "./VectorMemoryStore.js";

const logger = pino({ name: "ProceduralMemory" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type SkillStatus = "draft" | "active" | "deprecated" | "experimental";

export interface PrimitiveStep {
  stepId: string;
  name: string;
  description: string;
  /** Tool or action to call */
  action: string;
  /** Parameter template (may include ${variable} placeholders) */
  parameters: Record<string, unknown>;
  /** Optional precondition expression */
  precondition?: string;
  /** Expected outcome description */
  expectedOutcome?: string;
  order: number;
}

export interface Skill {
  skillId: string;
  name: string;
  description: string;
  /** Domain tags: e.g. ["web-search", "analysis", "coding"] */
  tags: string[];
  status: SkillStatus;
  steps: PrimitiveStep[];
  /** Input parameter names and descriptions */
  inputSpec: Record<string, string>;
  /** Output description */
  outputSpec: string;
  /** IDs of primitive skills this is composed of */
  composedOf: string[];
  /** Task types this skill can handle (for matching) */
  applicableTaskTypes: string[];
  /** Execution stats */
  successCount: number;
  failureCount: number;
  successRate: number;
  averageDurationMs: number;
  /** Refinement history: list of changes made */
  refinements: SkillRefinement[];
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  /** Confidence that this skill is the right one to use (0-1) */
  confidence: number;
}

export interface SkillRefinement {
  refinementId: string;
  description: string;
  changedSteps: string[]; // stepIds modified
  triggerReason: string; // why the refinement was made
  successRateBefore: number;
  successRateAfter?: number; // set after 10 more executions
  appliedAt: number;
}

export interface SkillExecutionRecord {
  executionId: string;
  skillId: string;
  input: Record<string, unknown>;
  output: unknown;
  success: boolean;
  durationMs: number;
  stepsExecuted: string[];
  failedStep?: string;
  error?: string;
  executedAt: number;
}

export interface SkillMatchResult {
  skill: Skill;
  relevanceScore: number;
  matchReason: string;
}

// ─── ProceduralMemory ─────────────────────────────────────────────────────────

export class ProceduralMemory {
  private skills = new Map<string, Skill>();
  private executionHistory = new Map<string, SkillExecutionRecord[]>(); // skillId → history
  /** name → skillId index */
  private nameIndex = new Map<string, string>();

  constructor(
    private readonly vectorStore: VectorMemoryStore,
    private readonly agentId: string
  ) {
    logger.info({ agentId }, "[ProceduralMemory] Initialized");
  }

  // ── Skill CRUD ────────────────────────────────────────────────────────────────

  async defineSkill(
    name: string,
    description: string,
    steps: Omit<PrimitiveStep, "stepId">[],
    opts: {
      tags?: string[];
      inputSpec?: Record<string, string>;
      outputSpec?: string;
      applicableTaskTypes?: string[];
    } = {}
  ): Promise<Skill> {
    if (this.nameIndex.has(name.toLowerCase())) {
      throw new Error(
        `Skill '${name}' already exists. Use refineSkill() to modify it.`
      );
    }

    const skillId = randomUUID();
    const skill: Skill = {
      skillId,
      name,
      description,
      tags: opts.tags ?? [],
      status: "active",
      steps: steps.map((s, i) => ({ ...s, stepId: randomUUID(), order: i })),
      inputSpec: opts.inputSpec ?? {},
      outputSpec: opts.outputSpec ?? "Unspecified output",
      composedOf: [],
      applicableTaskTypes: opts.applicableTaskTypes ?? [],
      successCount: 0,
      failureCount: 0,
      successRate: 0,
      averageDurationMs: 0,
      refinements: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      confidence: 0.5,
    };

    this.skills.set(skillId, skill);
    this.nameIndex.set(name.toLowerCase(), skillId);
    this.executionHistory.set(skillId, []);

    // Index in vector store for semantic retrieval
    await this.indexSkill(skill);

    logger.info({ skillId, name }, "[ProceduralMemory] Skill defined");
    return skill;
  }

  async composeSkill(
    name: string,
    description: string,
    primitiveSkillIds: string[],
    opts: {
      tags?: string[];
      applicableTaskTypes?: string[];
    } = {}
  ): Promise<Skill> {
    // Validate all primitive skills exist
    for (const id of primitiveSkillIds) {
      if (!this.skills.has(id)) {
        throw new Error(`Primitive skill '${id}' not found`);
      }
    }

    // Build composed steps from primitives
    const composedSteps: PrimitiveStep[] = [];
    for (let i = 0; i < primitiveSkillIds.length; i++) {
      const primitive = this.skills.get(primitiveSkillIds[i])!;
      composedSteps.push(
        ...primitive.steps.map((s) => ({
          ...s,
          stepId: randomUUID(),
          order: composedSteps.length + s.order,
          name: `[${primitive.name}] ${s.name}`,
        }))
      );
    }

    const skillId = randomUUID();
    const skill: Skill = {
      skillId,
      name,
      description,
      tags: opts.tags ?? [],
      status: "experimental",
      steps: composedSteps,
      inputSpec: {},
      outputSpec: "Composed skill output",
      composedOf: primitiveSkillIds,
      applicableTaskTypes: opts.applicableTaskTypes ?? [],
      successCount: 0,
      failureCount: 0,
      successRate: 0,
      averageDurationMs: 0,
      refinements: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      confidence: 0.3, // lower confidence until validated
    };

    this.skills.set(skillId, skill);
    this.nameIndex.set(name.toLowerCase(), skillId);
    this.executionHistory.set(skillId, []);

    await this.indexSkill(skill);

    logger.info(
      { skillId, name, composedOf: primitiveSkillIds },
      "[ProceduralMemory] Composed skill created"
    );
    return skill;
  }

  getSkill(skillId: string): Skill | null {
    return this.skills.get(skillId) ?? null;
  }

  findSkillByName(name: string): Skill | null {
    const id = this.nameIndex.get(name.toLowerCase());
    if (!id) return null;
    return this.skills.get(id) ?? null;
  }

  // ── Semantic search ───────────────────────────────────────────────────────────

  async findRelevantSkills(
    taskDescription: string,
    topK = 5
  ): Promise<SkillMatchResult[]> {
    const result = await this.vectorStore.query(taskDescription, {
      namespace: this.skillNamespace(),
      topK: topK * 2,
      minScore: 0.4,
    });

    const matches: SkillMatchResult[] = [];

    for (const record of result.records) {
      const skillId = String(record.metadata?.skillId);
      const skill = this.skills.get(skillId);
      if (!skill || skill.status === "deprecated") continue;

      const relevanceScore = (record.score ?? 0) * skill.confidence;

      matches.push({
        skill,
        relevanceScore,
        matchReason: `Semantic similarity: ${(record.score ?? 0).toFixed(2)}, confidence: ${skill.confidence.toFixed(2)}`,
      });
    }

    // Also check task type matching
    for (const skill of this.skills.values()) {
      if (skill.status === "deprecated") continue;
      if (
        skill.applicableTaskTypes.some((t) =>
          taskDescription.toLowerCase().includes(t.toLowerCase())
        )
      ) {
        const exists = matches.find((m) => m.skill.skillId === skill.skillId);
        if (!exists) {
          matches.push({
            skill,
            relevanceScore: skill.confidence * 0.7,
            matchReason: "Task type match",
          });
        }
      }
    }

    return matches
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, topK);
  }

  // ── Execution recording ───────────────────────────────────────────────────────

  async recordExecution(
    skillId: string,
    record: Omit<SkillExecutionRecord, "executionId">
  ): Promise<void> {
    const skill = this.skills.get(skillId);
    if (!skill) throw new Error(`Skill '${skillId}' not found`);

    const fullRecord: SkillExecutionRecord = {
      ...record,
      executionId: randomUUID(),
    };

    const history = this.executionHistory.get(skillId) ?? [];
    history.push(fullRecord);
    // Keep only last 200 executions
    if (history.length > 200) history.shift();
    this.executionHistory.set(skillId, history);

    // Update stats
    await this.updateStats(skill, fullRecord);
  }

  private async updateStats(skill: Skill, record: SkillExecutionRecord): Promise<void> {
    const updatedSuccessCount = skill.successCount + (record.success ? 1 : 0);
    const updatedFailureCount = skill.failureCount + (record.success ? 0 : 1);
    const total = updatedSuccessCount + updatedFailureCount;
    const newSuccessRate = total > 0 ? updatedSuccessCount / total : 0;

    // Rolling average duration
    const newAvgDuration =
      (skill.averageDurationMs * (total - 1) + record.durationMs) / total;

    // Update confidence based on success rate (with some smoothing)
    const newConfidence = Math.max(
      0.1,
      Math.min(0.95, skill.confidence * 0.9 + newSuccessRate * 0.1)
    );

    const updated: Skill = {
      ...skill,
      successCount: updatedSuccessCount,
      failureCount: updatedFailureCount,
      successRate: newSuccessRate,
      averageDurationMs: newAvgDuration,
      confidence: newConfidence,
      lastUsedAt: Date.now(),
      updatedAt: Date.now(),
      // Auto-activate experimental skills after 10 successful executions
      status:
        skill.status === "experimental" && updatedSuccessCount >= 10
          ? "active"
          : skill.status,
    };

    this.skills.set(skill.skillId, updated);

    // Trigger auto-refinement if success rate drops below 50% after 20+ executions
    if (total >= 20 && newSuccessRate < 0.5) {
      logger.warn(
        { skillId: skill.skillId, successRate: newSuccessRate },
        "[ProceduralMemory] Skill has low success rate, refinement recommended"
      );
    }

    // Re-index with updated confidence
    if (total % 10 === 0) {
      await this.indexSkill(updated);
    }
  }

  // ── Refinement ────────────────────────────────────────────────────────────────

  async refineSkill(
    skillId: string,
    refinement: {
      description: string;
      reason: string;
      stepUpdates?: Partial<PrimitiveStep>[];
      addSteps?: Omit<PrimitiveStep, "stepId">[];
      removeStepIds?: string[];
    }
  ): Promise<Skill> {
    const skill = this.skills.get(skillId);
    if (!skill) throw new Error(`Skill '${skillId}' not found`);

    let steps = [...skill.steps];

    if (refinement.removeStepIds?.length) {
      steps = steps.filter((s) => !refinement.removeStepIds!.includes(s.stepId));
    }

    if (refinement.stepUpdates?.length) {
      for (const update of refinement.stepUpdates) {
        const idx = steps.findIndex((s) => s.stepId === update.stepId);
        if (idx !== -1) {
          steps[idx] = { ...steps[idx], ...update };
        }
      }
    }

    if (refinement.addSteps?.length) {
      const newSteps = refinement.addSteps.map((s, i) => ({
        ...s,
        stepId: randomUUID(),
        order: steps.length + i,
      }));
      steps = [...steps, ...newSteps];
    }

    const refinementRecord: SkillRefinement = {
      refinementId: randomUUID(),
      description: refinement.description,
      changedSteps: [
        ...(refinement.stepUpdates?.map((s) => s.stepId ?? "") ?? []),
        ...(refinement.removeStepIds ?? []),
        ...(refinement.addSteps?.map(() => "new") ?? []),
      ].filter(Boolean),
      triggerReason: refinement.reason,
      successRateBefore: skill.successRate,
      appliedAt: Date.now(),
    };

    const updated: Skill = {
      ...skill,
      steps,
      refinements: [...skill.refinements, refinementRecord],
      updatedAt: Date.now(),
    };

    this.skills.set(skillId, updated);
    await this.indexSkill(updated);

    logger.info(
      { skillId, refinementId: refinementRecord.refinementId },
      "[ProceduralMemory] Skill refined"
    );
    return updated;
  }

  // ── Transfer learning ─────────────────────────────────────────────────────────

  async transferSkill(
    sourceSkillId: string,
    newName: string,
    adaptations: {
      newDescription?: string;
      parameterMappings?: Record<string, string>;
      tags?: string[];
    }
  ): Promise<Skill> {
    const source = this.skills.get(sourceSkillId);
    if (!source) throw new Error(`Source skill '${sourceSkillId}' not found`);

    // Create a new skill based on the source but adapted
    const adaptedSteps = source.steps.map((step) => {
      const params = { ...step.parameters };
      if (adaptations.parameterMappings) {
        for (const [oldKey, newKey] of Object.entries(adaptations.parameterMappings)) {
          if (oldKey in params) {
            params[newKey] = params[oldKey];
            delete params[oldKey];
          }
        }
      }
      return { ...step, parameters: params };
    });

    return this.defineSkill(
      newName,
      adaptations.newDescription ?? `Adapted from: ${source.name}`,
      adaptedSteps.map(({ stepId: _id, ...rest }) => rest),
      {
        tags: adaptations.tags ?? source.tags,
        inputSpec: source.inputSpec,
        outputSpec: source.outputSpec,
        applicableTaskTypes: source.applicableTaskTypes,
      }
    );
  }

  // ── Deprecation ────────────────────────────────────────────────────────────────

  deprecateSkill(skillId: string, replacedBy?: string): void {
    const skill = this.skills.get(skillId);
    if (!skill) return;
    this.skills.set(skillId, {
      ...skill,
      status: "deprecated",
      updatedAt: Date.now(),
      description: replacedBy
        ? `${skill.description} [DEPRECATED: replaced by ${replacedBy}]`
        : `${skill.description} [DEPRECATED]`,
    });
    logger.info({ skillId, replacedBy }, "[ProceduralMemory] Skill deprecated");
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private async indexSkill(skill: Skill): Promise<void> {
    const content = [
      skill.name,
      skill.description,
      skill.tags.join(" "),
      skill.applicableTaskTypes.join(" "),
      skill.steps.map((s) => s.description).join(" "),
    ].join(" ");

    await this.vectorStore.upsert({
      id: `skill:${skill.skillId}`,
      content,
      metadata: {
        skillId: skill.skillId,
        name: skill.name,
        status: skill.status,
        kind: "skill",
      },
      namespace: this.skillNamespace(),
      importance: skill.confidence,
    });
  }

  private skillNamespace(): string {
    return `${VectorMemoryStore.agentNamespace(this.agentId)}:skills`;
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────

  getStats() {
    const all = Array.from(this.skills.values());
    return {
      total: all.length,
      active: all.filter((s) => s.status === "active").length,
      experimental: all.filter((s) => s.status === "experimental").length,
      deprecated: all.filter((s) => s.status === "deprecated").length,
      averageSuccessRate:
        all.length > 0
          ? all.reduce((s, sk) => s + sk.successRate, 0) / all.length
          : 0,
      totalExecutions: all.reduce((s, sk) => s + sk.successCount + sk.failureCount, 0),
    };
  }
}
