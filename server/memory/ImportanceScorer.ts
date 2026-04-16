/**
 * ImportanceScorer — scores memory importance 0–1 using access patterns,
 * Ebbinghaus forgetting curve with reinforcement, and content signals.
 */

import { createLogger } from "../utils/logger";

const logger = createLogger("ImportanceScorer");

// ─── Types ────────────────────────────────────────────────────────────────────

export type MemoryPriority = "critical" | "important" | "normal" | "ephemeral";

export interface MemoryRecord {
  id: string;
  content: string;
  memoryType: string;
  createdAt: Date;
  lastAccessedAt: Date;
  accessCount: number;
  importance?: number;
  userFeedback?: number; // -1 to 1
  taskSuccessCorrelations?: number; // 0–1
}

export interface ImportanceResult {
  score: number; // 0–1
  priority: MemoryPriority;
  retentionDays: number;
  factors: ImportanceFactor[];
  shouldForget: boolean;
}

export interface ImportanceFactor {
  name: string;
  contribution: number;
  description: string;
}

// ─── Ebbinghaus Forgetting Curve ──────────────────────────────────────────────

/**
 * Ebbinghaus retention formula: R = e^(-t/S)
 * where t = elapsed time, S = stability (increases with each reinforcement)
 */
function ebbinghausRetention(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0;
  return Math.exp(-elapsedDays / stability);
}

/**
 * SM-2 inspired stability update: stability increases with each access.
 * More consistent access → slower forgetting.
 */
function computeStability(accessCount: number, daysSinceCreation: number): number {
  // Base stability: 1 day per access, with diminishing returns
  const baseStability = 1 + Math.log2(1 + accessCount) * 3;

  // Spaced repetition bonus: if accessed often relative to age
  const accessFrequency = daysSinceCreation > 0 ? accessCount / daysSinceCreation : accessCount;
  const spacingBonus = Math.min(3, accessFrequency * 2);

  return baseStability + spacingBonus;
}

// ─── Content Importance Signals ───────────────────────────────────────────────

const HIGH_VALUE_PATTERNS = [
  /\d{4}-\d{2}-\d{2}/, // dates
  /\$[\d,]+/, // dollar amounts
  /\d+\s*%/, // percentages
  /deadline|due date|expire|by\s+\w+\s+\d+/i, // deadlines
  /password|api key|token|secret|credential/i, // credentials (flag as critical)
  /contact|email|phone|address/i, // contact info
  /agreed|confirmed|approved|decided/i, // decisions
];

const LOW_VALUE_PATTERNS = [
  /^(ok|okay|yes|no|sure|thanks|thank you|got it)\.?$/i,
  /^[\s\S]{1,20}$/, // very short
  /small talk|chitchat/i,
];

function scoreContentSignals(content: string): ImportanceFactor {
  const highMatches = HIGH_VALUE_PATTERNS.filter((p) => p.test(content)).length;
  const lowMatches = LOW_VALUE_PATTERNS.filter((p) => p.test(content)).length;

  const contribution = Math.min(0.3, highMatches * 0.07) - Math.min(0.2, lowMatches * 0.1);

  return {
    name: "content_signals",
    contribution,
    description: `High-value patterns: ${highMatches}, low-value patterns: ${lowMatches}`,
  };
}

// ─── Memory Type Weights ──────────────────────────────────────────────────────

const TYPE_BASE_SCORES: Record<string, number> = {
  decision: 0.75,
  action_item: 0.80,
  fact: 0.55,
  preference: 0.65,
  entity: 0.50,
  skill: 0.70,
  ephemeral: 0.25,
};

// ─── Priority Thresholds ──────────────────────────────────────────────────────

function toPriority(score: number): MemoryPriority {
  if (score >= 0.85) return "critical";
  if (score >= 0.60) return "important";
  if (score >= 0.35) return "normal";
  return "ephemeral";
}

function toRetentionDays(priority: MemoryPriority, stability: number): number {
  const base: Record<MemoryPriority, number> = {
    critical: Infinity,
    important: 365,
    normal: 90,
    ephemeral: 7,
  };
  const d = base[priority];
  return d === Infinity ? Infinity : Math.min(d, Math.ceil(stability * 5));
}

// ─── ImportanceScorer ─────────────────────────────────────────────────────────

export class ImportanceScorer {
  score(memory: MemoryRecord): ImportanceResult {
    const now = new Date();
    const ageMs = now.getTime() - memory.createdAt.getTime();
    const ageDays = ageMs / 86_400_000;
    const daysSinceAccess = (now.getTime() - memory.lastAccessedAt.getTime()) / 86_400_000;

    const stability = computeStability(memory.accessCount, ageDays);
    const retention = ebbinghausRetention(daysSinceAccess, stability);

    const factors: ImportanceFactor[] = [];

    // Factor 1: Base type weight
    const typeBase = TYPE_BASE_SCORES[memory.memoryType] ?? 0.5;
    factors.push({
      name: "type_base",
      contribution: typeBase,
      description: `Memory type "${memory.memoryType}" base score`,
    });

    // Factor 2: Retention / forgetting curve
    const retentionContrib = retention * 0.2;
    factors.push({
      name: "retention",
      contribution: retentionContrib,
      description: `Ebbinghaus retention: ${(retention * 100).toFixed(0)}% (stability: ${stability.toFixed(1)} days)`,
    });

    // Factor 3: Access frequency bonus
    const accessBonus = Math.min(0.15, Math.log2(1 + memory.accessCount) * 0.03);
    factors.push({
      name: "access_frequency",
      contribution: accessBonus,
      description: `${memory.accessCount} total accesses`,
    });

    // Factor 4: Content signal analysis
    const contentFactor = scoreContentSignals(memory.content);
    factors.push(contentFactor);

    // Factor 5: User feedback (if available)
    let feedbackContrib = 0;
    if (memory.userFeedback !== undefined) {
      feedbackContrib = memory.userFeedback * 0.15;
      factors.push({
        name: "user_feedback",
        contribution: feedbackContrib,
        description: `User feedback: ${memory.userFeedback > 0 ? "positive" : "negative"}`,
      });
    }

    // Factor 6: Task success correlation
    if (memory.taskSuccessCorrelations !== undefined && memory.taskSuccessCorrelations > 0) {
      const taskContrib = memory.taskSuccessCorrelations * 0.1;
      factors.push({
        name: "task_success",
        contribution: taskContrib,
        description: `Task success correlation: ${(memory.taskSuccessCorrelations * 100).toFixed(0)}%`,
      });
    }

    // Combine factors (type_base is the anchor, others are additive deltas)
    const totalScore = Math.min(1, Math.max(0,
      typeBase + retentionContrib + accessBonus + contentFactor.contribution + feedbackContrib
    ));

    const priority = toPriority(totalScore);
    const retentionDays = toRetentionDays(priority, stability);

    // Forget if retention has decayed below threshold and low priority
    const shouldForget = priority === "ephemeral" && retention < 0.1 && memory.accessCount < 2;

    logger.debug(
      `Scored memory ${memory.id}: ${totalScore.toFixed(3)} (${priority}) — ` +
      `retention: ${(retention * 100).toFixed(0)}%, stability: ${stability.toFixed(1)}d`
    );

    return {
      score: Math.round(totalScore * 1000) / 1000,
      priority,
      retentionDays,
      factors,
      shouldForget,
    };
  }

  scoreMany(memories: MemoryRecord[]): Array<MemoryRecord & { importanceResult: ImportanceResult }> {
    return memories
      .map((m) => ({ ...m, importanceResult: this.score(m) }))
      .sort((a, b) => b.importanceResult.score - a.importanceResult.score);
  }

  getToForget(memories: MemoryRecord[]): MemoryRecord[] {
    return memories.filter((m) => this.score(m).shouldForget);
  }

  /**
   * Simulate how importance decays over time for planning retention schedules.
   */
  forecastDecay(memory: MemoryRecord, daysAhead: number[]): Array<{ days: number; score: number; priority: MemoryPriority }> {
    const ageMs = Date.now() - memory.createdAt.getTime();
    const ageDays = ageMs / 86_400_000;
    const stability = computeStability(memory.accessCount, ageDays);

    return daysAhead.map((days) => {
      const retention = ebbinghausRetention(days, stability);
      const typeBase = TYPE_BASE_SCORES[memory.memoryType] ?? 0.5;
      const score = Math.min(1, Math.max(0, typeBase + retention * 0.2));
      return { days, score, priority: toPriority(score) };
    });
  }

  /**
   * Compute optimal review schedule using spaced repetition principles.
   * Returns days from now when the memory should be reviewed.
   */
  getReviewSchedule(memory: MemoryRecord): number[] {
    const ageMs = Date.now() - memory.createdAt.getTime();
    const ageDays = ageMs / 86_400_000;
    const stability = computeStability(memory.accessCount, ageDays);

    // Review when retention drops to 90%, then 80%, then 70%
    const thresholds = [0.9, 0.8, 0.7, 0.5];
    const schedule: number[] = [];

    for (const threshold of thresholds) {
      // Solve: threshold = e^(-t/S) → t = -S * ln(threshold)
      const daysUntilThreshold = -stability * Math.log(threshold);
      if (daysUntilThreshold > 0 && daysUntilThreshold < 365) {
        schedule.push(Math.ceil(daysUntilThreshold));
      }
    }

    return [...new Set(schedule)].sort((a, b) => a - b);
  }
}

export const importanceScorer = new ImportanceScorer();
