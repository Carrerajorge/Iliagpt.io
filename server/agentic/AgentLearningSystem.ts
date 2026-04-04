import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";
import {
  getClaudeAgentBackbone,
  CLAUDE_MODELS,
  type AgentMessage,
} from "./ClaudeAgentBackbone.js";

const logger = pino({ name: "AgentLearningSystem" });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaskExperience {
  experienceId: string;
  agentId: string;
  taskType: string;
  taskDescription: string;
  toolsUsed: string[];
  strategyUsed: string;
  outcome: "success" | "partial" | "failure";
  qualityScore: number; // 0-1
  durationMs: number;
  tokensUsed: number;
  errorPatterns: string[];
  keyLessons: string[];
  timestamp: number;
}

export interface Strategy {
  strategyId: string;
  taskType: string;
  name: string;
  description: string;
  steps: string[];
  toolSequence: string[];
  successRate: number; // 0-1
  avgQualityScore: number;
  avgDurationMs: number;
  sampleSize: number;
  firstLearnedAt: number;
  lastUsedAt: number;
  refinements: StrategyRefinement[];
}

export interface StrategyRefinement {
  refinementId: string;
  description: string;
  improvement: number; // delta quality score
  timestamp: number;
}

export interface ErrorPattern {
  patternId: string;
  agentId: string;
  taskType: string;
  errorSignature: string; // normalized error description
  occurrences: number;
  firstSeen: number;
  lastSeen: number;
  resolvedBy: string[]; // strategies that fixed it
  stillActive: boolean;
}

export interface SkillLevel {
  taskType: string;
  level: "novice" | "intermediate" | "proficient" | "expert";
  experienceCount: number;
  avgQualityScore: number;
  successRate: number;
  lastPracticed: number;
  improvementRate: number; // delta quality per 10 tasks
}

export interface TransferLearning {
  sourceTaskType: string;
  targetTaskType: string;
  applicableLessons: string[];
  applicableStrategies: string[]; // strategyIds
  confidence: number; // 0-1
  detectedAt: number;
}

export interface PerformanceBenchmark {
  benchmarkId: string;
  agentId: string;
  taskType: string;
  period: { from: number; to: number };
  avgQualityScore: number;
  successRate: number;
  avgDurationMs: number;
  tasksCompleted: number;
  comparedToPrevious?: {
    qualityDelta: number;
    successRateDelta: number;
    speedDelta: number;
  };
}

// ─── Skill calculator ─────────────────────────────────────────────────────────

function computeSkillLevel(
  count: number,
  successRate: number,
  avgQuality: number
): SkillLevel["level"] {
  const score = count * 0.3 + successRate * 0.35 + avgQuality * 0.35;

  if (score >= 0.85 && count >= 20) return "expert";
  if (score >= 0.7 && count >= 10) return "proficient";
  if (score >= 0.5 && count >= 3) return "intermediate";
  return "novice";
}

// ─── AgentLearningSystem ──────────────────────────────────────────────────────

export class AgentLearningSystem extends EventEmitter {
  private experiences: TaskExperience[] = [];
  private strategies = new Map<string, Strategy>(); // strategyId → strategy
  private errorPatterns: ErrorPattern[] = [];
  private skills = new Map<string, SkillLevel>(); // taskType → skill (per agent: `agentId:taskType`)
  private transferMappings: TransferLearning[] = [];

  constructor(
    private readonly backbone = getClaudeAgentBackbone()
  ) {
    super();
    logger.info("[AgentLearningSystem] Initialized");
  }

  // ── Experience recording ──────────────────────────────────────────────────────

  async recordExperience(
    exp: Omit<TaskExperience, "experienceId" | "timestamp" | "keyLessons">
  ): Promise<TaskExperience> {
    // Extract lessons using LLM
    const keyLessons = await this.extractLessons(exp);

    const experience: TaskExperience = {
      ...exp,
      experienceId: randomUUID(),
      timestamp: Date.now(),
      keyLessons,
    };

    this.experiences.push(experience);
    if (this.experiences.length > 10_000) this.experiences.shift();

    // Update skill level
    this.updateSkill(exp.agentId, exp.taskType, exp.outcome, exp.qualityScore);

    // Update or create strategy
    await this.updateStrategy(experience);

    // Check for new error patterns
    if (exp.errorPatterns.length > 0) {
      this.trackErrorPatterns(exp.agentId, exp.taskType, exp.errorPatterns);
    }

    // Detect transfer learning opportunities
    await this.detectTransferOpportunities(experience);

    logger.info(
      {
        experienceId: experience.experienceId,
        taskType: exp.taskType,
        outcome: exp.outcome,
        quality: exp.qualityScore,
      },
      "[AgentLearningSystem] Experience recorded"
    );

    this.emit("experience:recorded", experience);
    return experience;
  }

  // ── Lesson extraction ─────────────────────────────────────────────────────────

  private async extractLessons(
    exp: Omit<TaskExperience, "experienceId" | "timestamp" | "keyLessons">
  ): Promise<string[]> {
    if (exp.qualityScore >= 0.9 && exp.outcome === "success") {
      // High quality success — extract what worked
      return [`${exp.strategyUsed} worked well for ${exp.taskType}`];
    }

    if (exp.outcome === "failure" || exp.qualityScore < 0.5) {
      const messages: AgentMessage[] = [
        {
          role: "user",
          content: `Extract 2-3 key lessons from this failed agent task.

TASK TYPE: ${exp.taskType}
STRATEGY USED: ${exp.strategyUsed}
TOOLS USED: ${exp.toolsUsed.join(", ")}
OUTCOME: ${exp.outcome}
QUALITY SCORE: ${exp.qualityScore}
ERRORS: ${exp.errorPatterns.join("; ")}

Output JSON array of lessons: ["lesson 1", "lesson 2"]
Return ONLY valid JSON array.`,
          },
        ];

      try {
        const response = await this.backbone.call(messages, {
          model: CLAUDE_MODELS.HAIKU,
          maxTokens: 256,
          system: "Extract actionable lessons from agent task failures.",
        });

        const jsonMatch = response.text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as string[];
          return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
        }
      } catch {
        // Fall through
      }
    }

    return [];
  }

  // ── Strategy management ───────────────────────────────────────────────────────

  private async updateStrategy(experience: TaskExperience): Promise<void> {
    // Find existing strategy for this taskType + strategy name
    const existing = Array.from(this.strategies.values()).find(
      (s) => s.taskType === experience.taskType && s.name === experience.strategyUsed
    );

    if (existing) {
      // Update rolling stats
      const n = existing.sampleSize;
      existing.successRate =
        (existing.successRate * n + (experience.outcome === "success" ? 1 : 0)) / (n + 1);
      existing.avgQualityScore =
        (existing.avgQualityScore * n + experience.qualityScore) / (n + 1);
      existing.avgDurationMs =
        (existing.avgDurationMs * n + experience.durationMs) / (n + 1);
      existing.sampleSize++;
      existing.lastUsedAt = Date.now();

      // Add refinement if quality improved significantly
      const prevQuality = existing.avgQualityScore;
      if (experience.qualityScore - prevQuality > 0.1) {
        existing.refinements.push({
          refinementId: randomUUID(),
          description: experience.keyLessons[0] ?? "Quality improvement detected",
          improvement: experience.qualityScore - prevQuality,
          timestamp: Date.now(),
        });
      }

      this.emit("strategy:updated", { strategyId: existing.strategyId, taskType: experience.taskType });
    } else if (experience.outcome === "success" && experience.qualityScore >= 0.7) {
      // Create new strategy from successful experience
      const strategy: Strategy = {
        strategyId: randomUUID(),
        taskType: experience.taskType,
        name: experience.strategyUsed,
        description: `Learned strategy: ${experience.strategyUsed}`,
        steps: experience.keyLessons,
        toolSequence: experience.toolsUsed,
        successRate: 1.0,
        avgQualityScore: experience.qualityScore,
        avgDurationMs: experience.durationMs,
        sampleSize: 1,
        firstLearnedAt: Date.now(),
        lastUsedAt: Date.now(),
        refinements: [],
      };

      this.strategies.set(strategy.strategyId, strategy);

      logger.info(
        { strategyId: strategy.strategyId, taskType: experience.taskType },
        "[AgentLearningSystem] New strategy learned"
      );

      this.emit("strategy:learned", strategy);
    }
  }

  // ── Skill tracking ────────────────────────────────────────────────────────────

  private updateSkill(
    agentId: string,
    taskType: string,
    outcome: TaskExperience["outcome"],
    qualityScore: number
  ): void {
    const key = `${agentId}:${taskType}`;
    const existing = this.skills.get(key) ?? {
      taskType,
      level: "novice" as const,
      experienceCount: 0,
      avgQualityScore: 0,
      successRate: 0,
      lastPracticed: Date.now(),
      improvementRate: 0,
    };

    const prevAvg = existing.avgQualityScore;
    const n = existing.experienceCount;

    existing.experienceCount++;
    existing.avgQualityScore = (prevAvg * n + qualityScore) / (n + 1);
    existing.successRate =
      (existing.successRate * n + (outcome === "success" ? 1 : 0)) / (n + 1);
    existing.lastPracticed = Date.now();

    // Track improvement rate over last 10 tasks
    const recentByKey = this.experiences
      .filter((e) => e.agentId === agentId && e.taskType === taskType)
      .slice(-10);

    if (recentByKey.length >= 5) {
      const firstHalf = recentByKey.slice(0, Math.floor(recentByKey.length / 2));
      const secondHalf = recentByKey.slice(Math.floor(recentByKey.length / 2));
      const firstAvg = firstHalf.reduce((s, e) => s + e.qualityScore, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((s, e) => s + e.qualityScore, 0) / secondHalf.length;
      existing.improvementRate = (secondAvg - firstAvg) * 10; // per 10 tasks
    }

    existing.level = computeSkillLevel(
      existing.experienceCount,
      existing.successRate,
      existing.avgQualityScore
    );

    this.skills.set(key, existing);
    this.emit("skill:updated", { agentId, taskType, skill: existing });
  }

  // ── Error pattern tracking ────────────────────────────────────────────────────

  private trackErrorPatterns(
    agentId: string,
    taskType: string,
    errors: string[]
  ): void {
    for (const error of errors) {
      const signature = error.toLowerCase().replace(/[^a-z\s]/g, "").slice(0, 50);
      const existing = this.errorPatterns.find(
        (p) => p.agentId === agentId && p.taskType === taskType && p.errorSignature === signature
      );

      if (existing) {
        existing.occurrences++;
        existing.lastSeen = Date.now();
      } else {
        this.errorPatterns.push({
          patternId: randomUUID(),
          agentId,
          taskType,
          errorSignature: signature,
          occurrences: 1,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
          resolvedBy: [],
          stillActive: true,
        });
      }
    }
  }

  // ── Transfer learning ─────────────────────────────────────────────────────────

  private async detectTransferOpportunities(exp: TaskExperience): Promise<void> {
    if (exp.outcome !== "success" || exp.qualityScore < 0.8) return;

    const existingTypes = new Set(this.experiences.map((e) => e.taskType));
    if (existingTypes.size < 2) return;

    const otherTypes = [...existingTypes].filter((t) => t !== exp.taskType);
    if (otherTypes.length === 0) return;

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Identify transfer learning opportunities.

SUCCESSFUL EXPERIENCE:
Task type: ${exp.taskType}
Strategy: ${exp.strategyUsed}
Tools: ${exp.toolsUsed.join(", ")}
Lessons: ${exp.keyLessons.join("; ")}

OTHER TASK TYPES IN SYSTEM: ${otherTypes.slice(0, 5).join(", ")}

Which other task types could benefit from the same lessons or strategy? How?

Output JSON: [{
  "targetTaskType": "...",
  "applicableLessons": ["..."],
  "confidence": 0.0-1.0,
  "reasoning": "..."
}]

Return ONLY valid JSON array, or [] if no transfers applicable.`,
      },
    ];

    try {
      const response = await this.backbone.call(messages, {
        model: CLAUDE_MODELS.HAIKU,
        maxTokens: 512,
        system: "Identify cross-domain learning opportunities for AI agents.",
      });

      const jsonMatch = response.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return;

      const transfers = JSON.parse(jsonMatch[0]) as Array<{
        targetTaskType?: string;
        applicableLessons?: string[];
        confidence?: number;
      }>;

      for (const t of transfers) {
        if (!t.targetTaskType || !t.confidence || t.confidence < 0.6) continue;

        const existing = this.transferMappings.find(
          (m) => m.sourceTaskType === exp.taskType && m.targetTaskType === t.targetTaskType
        );

        if (!existing) {
          const mapping: TransferLearning = {
            sourceTaskType: exp.taskType,
            targetTaskType: t.targetTaskType,
            applicableLessons: t.applicableLessons ?? [],
            applicableStrategies: [],
            confidence: t.confidence,
            detectedAt: Date.now(),
          };

          this.transferMappings.push(mapping);
          this.emit("transfer:detected", mapping);
          logger.info(
            { from: exp.taskType, to: t.targetTaskType, confidence: t.confidence },
            "[AgentLearningSystem] Transfer learning opportunity detected"
          );
        }
      }
    } catch {
      // Non-critical
    }
  }

  // ── Strategy retrieval ────────────────────────────────────────────────────────

  getBestStrategy(taskType: string): Strategy | null {
    const candidates = Array.from(this.strategies.values())
      .filter((s) => s.taskType === taskType && s.sampleSize >= 2);

    if (candidates.length === 0) return null;

    // Score: quality * 0.5 + successRate * 0.3 + recency * 0.2
    const now = Date.now();
    return candidates
      .map((s) => ({
        strategy: s,
        score:
          s.avgQualityScore * 0.5 +
          s.successRate * 0.3 +
          Math.min(1, 1 - (now - s.lastUsedAt) / (30 * 24 * 60 * 60 * 1000)) * 0.2,
      }))
      .sort((a, b) => b.score - a.score)[0]?.strategy ?? null;
  }

  getTransferableKnowledge(targetTaskType: string): TransferLearning[] {
    return this.transferMappings.filter(
      (m) => m.targetTaskType === targetTaskType && m.confidence >= 0.6
    );
  }

  getSkill(agentId: string, taskType: string): SkillLevel | null {
    return this.skills.get(`${agentId}:${taskType}`) ?? null;
  }

  // ── Benchmarking ──────────────────────────────────────────────────────────────

  benchmark(
    agentId: string,
    taskType: string,
    periodDays = 30
  ): PerformanceBenchmark {
    const now = Date.now();
    const periodMs = periodDays * 24 * 60 * 60 * 1000;
    const from = now - periodMs;

    const current = this.experiences.filter(
      (e) => e.agentId === agentId && e.taskType === taskType && e.timestamp >= from
    );

    const previous = this.experiences.filter(
      (e) =>
        e.agentId === agentId &&
        e.taskType === taskType &&
        e.timestamp >= from - periodMs &&
        e.timestamp < from
    );

    const computeStats = (exps: TaskExperience[]) => ({
      avgQualityScore:
        exps.length > 0
          ? exps.reduce((s, e) => s + e.qualityScore, 0) / exps.length
          : 0,
      successRate:
        exps.length > 0
          ? exps.filter((e) => e.outcome === "success").length / exps.length
          : 0,
      avgDurationMs:
        exps.length > 0
          ? exps.reduce((s, e) => s + e.durationMs, 0) / exps.length
          : 0,
    });

    const curr = computeStats(current);
    const prev = computeStats(previous);

    const benchmark: PerformanceBenchmark = {
      benchmarkId: randomUUID(),
      agentId,
      taskType,
      period: { from, to: now },
      ...curr,
      tasksCompleted: current.length,
      comparedToPrevious:
        previous.length > 0
          ? {
              qualityDelta: curr.avgQualityScore - prev.avgQualityScore,
              successRateDelta: curr.successRate - prev.successRate,
              speedDelta: prev.avgDurationMs - curr.avgDurationMs, // positive = faster
            }
          : undefined,
    };

    this.emit("benchmark:created", benchmark);
    return benchmark;
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  getStrategies(taskType: string): Strategy[] {
    return Array.from(this.strategies.values())
      .filter((s) => s.taskType === taskType)
      .sort((a, b) => b.avgQualityScore - a.avgQualityScore);
  }

  getErrorPatterns(agentId: string, taskType?: string): ErrorPattern[] {
    return this.errorPatterns.filter(
      (p) =>
        p.agentId === agentId &&
        (!taskType || p.taskType === taskType) &&
        p.stillActive
    );
  }

  getAgentSkills(agentId: string): SkillLevel[] {
    return Array.from(this.skills.entries())
      .filter(([key]) => key.startsWith(`${agentId}:`))
      .map(([, skill]) => skill)
      .sort((a, b) => b.avgQualityScore - a.avgQualityScore);
  }

  getSummary(agentId?: string) {
    const exps = agentId
      ? this.experiences.filter((e) => e.agentId === agentId)
      : this.experiences;

    const taskTypes = new Set(exps.map((e) => e.taskType));
    const outcomes = new Map<string, number>();
    for (const e of exps) {
      outcomes.set(e.outcome, (outcomes.get(e.outcome) ?? 0) + 1);
    }

    return {
      agentId,
      totalExperiences: exps.length,
      taskTypesLearned: taskTypes.size,
      strategies: this.strategies.size,
      transferMappings: this.transferMappings.length,
      activeErrorPatterns: this.errorPatterns.filter((p) => p.stillActive).length,
      outcomes: Object.fromEntries(outcomes.entries()),
      avgQualityScore:
        exps.length > 0
          ? exps.reduce((s, e) => s + e.qualityScore, 0) / exps.length
          : 0,
    };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance: AgentLearningSystem | null = null;

export function getAgentLearningSystem(): AgentLearningSystem {
  if (!_instance) _instance = new AgentLearningSystem();
  return _instance;
}
