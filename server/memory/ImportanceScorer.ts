/**
 * ImportanceScorer — Ebbinghaus forgetting curve + multi-factor importance scoring.
 * Scores memories 0-1; drives garbage collection, spaced repetition, and promotion.
 */

import { Logger } from "../lib/logger"
import { pgVectorMemoryStore, type MemoryEntry } from "./PgVectorMemoryStore"

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ScoringFactors {
  accessCount: number
  daysSinceLastAccess: number
  daysSinceCreation: number
  explicitFeedback?: "positive" | "negative" | "neutral"
  taskRelevanceSignals?: number
  isExplicitInstruction?: boolean
  isFrequentlyContradicted?: boolean
  sourceAuthority?: number
  uniqueness?: number
}

export interface ScoringResult {
  score: number
  components: {
    retentionScore: number
    frequencyScore: number
    recencyScore: number
    feedbackScore: number
    relevanceScore: number
    authorityScore: number
  }
  explanation: string
  suggestDeletion: boolean
  suggestPromotion: boolean
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const LAMBDA = 0.1           // recency decay rate (~7-day half-life)
const MAX_EXPECTED_ACCESS = 100
const WEIGHTS = {
  retention: 0.30,
  frequency: 0.15,
  recency: 0.20,
  feedback: 0.15,
  relevance: 0.12,
  authority: 0.08,
}

// ─── Scorer ───────────────────────────────────────────────────────────────────

class ImportanceScorer {
  private readonly store = pgVectorMemoryStore

  // ── score ────────────────────────────────────────────────────────────────────

  score(factors: ScoringFactors): ScoringResult {
    const {
      accessCount,
      daysSinceLastAccess,
      daysSinceCreation,
      explicitFeedback,
      taskRelevanceSignals = 0,
      isExplicitInstruction = false,
      isFrequentlyContradicted = false,
      sourceAuthority = 0.7,
      uniqueness = 0.8,
    } = factors

    // ── component scores ─────────────────────────────────────────────────────

    const retentionScore = this.calculateRetentionScore(daysSinceLastAccess, accessCount)
    const frequencyScore = this.calculateFrequencyScore(accessCount)
    const recencyScore = this.calculateRecencyScore(daysSinceLastAccess)
    const feedbackScore = this.calculateFeedbackScore(explicitFeedback)
    const relevanceScore = this.calculateRelevanceScore(taskRelevanceSignals)
    const authorityScore = Math.max(0, Math.min(1, sourceAuthority)) * uniqueness

    // ── weighted combination ─────────────────────────────────────────────────

    let rawScore =
      retentionScore * WEIGHTS.retention +
      frequencyScore * WEIGHTS.frequency +
      recencyScore * WEIGHTS.recency +
      feedbackScore * WEIGHTS.feedback +
      relevanceScore * WEIGHTS.relevance +
      authorityScore * WEIGHTS.authority

    // ── modifiers ────────────────────────────────────────────────────────────

    if (isExplicitInstruction) {
      rawScore = Math.min(1, rawScore * 1.4) // explicit instructions get boosted
    }
    if (isFrequentlyContradicted) {
      rawScore *= 0.5 // contradicted memories lose half importance
    }
    if (daysSinceCreation < 1) {
      rawScore = Math.min(1, rawScore + 0.1) // freshness bonus for brand-new memories
    }

    const score = Math.max(0, Math.min(1, rawScore))

    // ── explanation ──────────────────────────────────────────────────────────

    const parts: string[] = [
      `retention=${retentionScore.toFixed(3)}`,
      `frequency=${frequencyScore.toFixed(3)}`,
      `recency=${recencyScore.toFixed(3)}`,
      `feedback=${feedbackScore.toFixed(3)}`,
      `relevance=${relevanceScore.toFixed(3)}`,
      `authority=${authorityScore.toFixed(3)}`,
    ]
    const modifiers: string[] = []
    if (isExplicitInstruction) modifiers.push("explicit_instruction_boost")
    if (isFrequentlyContradicted) modifiers.push("contradiction_penalty")
    if (daysSinceCreation < 1) modifiers.push("freshness_bonus")

    const explanation =
      `Score ${score.toFixed(3)}: [${parts.join(", ")}]` +
      (modifiers.length ? ` | modifiers: ${modifiers.join(", ")}` : "")

    return {
      score,
      components: {
        retentionScore,
        frequencyScore,
        recencyScore,
        feedbackScore,
        relevanceScore,
        authorityScore,
      },
      explanation,
      suggestDeletion: score < 0.05,
      suggestPromotion: score > 0.9,
    }
  }

  // ── scoreMemoryEntry ─────────────────────────────────────────────────────────

  async scoreMemoryEntry(entry: MemoryEntry): Promise<ScoringResult> {
    const now = new Date()
    const lastAccess = entry.metadata.lastAccessedAt
    const created = entry.metadata.createdAt

    const daysSinceLastAccess =
      (now.getTime() - lastAccess.getTime()) / (1000 * 60 * 60 * 24)
    const daysSinceCreation =
      (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)

    const factors: ScoringFactors = {
      accessCount: entry.metadata.accessCount,
      daysSinceLastAccess,
      daysSinceCreation,
      isExplicitInstruction: entry.type === "instruction",
      sourceAuthority: 0.7,
      uniqueness: 0.8,
    }

    return this.score(factors)
  }

  // ── scoreAndUpdateBatch ───────────────────────────────────────────────────────

  async scoreAndUpdateBatch(entries: MemoryEntry[]): Promise<void> {
    Logger.info("[ImportanceScorer] scoring batch", { count: entries.length })
    let deletions = 0
    let promotions = 0
    let updates = 0

    for (const entry of entries) {
      try {
        const result = await this.scoreMemoryEntry(entry)

        if (result.score !== entry.importance) {
          await this.store.updateImportance(entry.id, result.score)
          updates++
        }

        if (result.suggestDeletion) {
          Logger.debug("[ImportanceScorer] suggesting deletion", {
            id: entry.id,
            score: result.score,
          })
          deletions++
        }
        if (result.suggestPromotion) {
          Logger.debug("[ImportanceScorer] suggesting promotion", {
            id: entry.id,
            score: result.score,
          })
          promotions++
        }
      } catch (err) {
        Logger.warn("[ImportanceScorer] failed to score entry", { id: entry.id, err })
      }
    }

    Logger.info("[ImportanceScorer] batch complete", { updates, deletions, promotions })
  }

  // ── calculateRetentionScore ───────────────────────────────────────────────────

  /**
   * Ebbinghaus retention: R = e^(-t/S)
   * S (stability) increases with each successful retrieval:
   *   S = 1 + log(1 + accessCount) * 2
   */
  calculateRetentionScore(daysSinceLastAccess: number, accessCount: number): number {
    const stability = 1 + Math.log(1 + accessCount) * 2
    const R = Math.exp(-daysSinceLastAccess / stability)
    return Math.max(0, Math.min(1, R))
  }

  // ── calculateFrequencyScore ───────────────────────────────────────────────────

  /**
   * Log-normalized frequency: log(1 + n) / log(1 + maxExpected)
   */
  calculateFrequencyScore(accessCount: number): number {
    if (accessCount === 0) return 0
    return Math.min(1, Math.log(1 + accessCount) / Math.log(1 + MAX_EXPECTED_ACCESS))
  }

  // ── calculateRecencyScore ─────────────────────────────────────────────────────

  /**
   * Exponential decay: e^(-λt) where λ = 0.1 (~7-day half-life)
   */
  calculateRecencyScore(daysSinceLastAccess: number): number {
    return Math.exp(-LAMBDA * daysSinceLastAccess)
  }

  // ── calculateFeedbackScore ────────────────────────────────────────────────────

  calculateFeedbackScore(
    feedback?: "positive" | "negative" | "neutral"
  ): number {
    switch (feedback) {
      case "positive":
        return 1.0
      case "negative":
        return 0.1
      case "neutral":
        return 0.5
      default:
        return 0.5 // no feedback → neutral
    }
  }

  // ── calculateRelevanceScore ───────────────────────────────────────────────────

  /**
   * Task relevance: log(1 + signals) / log(1 + 10), capped at 1.
   */
  calculateRelevanceScore(taskSignals: number): number {
    if (taskSignals <= 0) return 0
    return Math.min(1, Math.log(1 + taskSignals) / Math.log(1 + 10))
  }

  // ── simulateForgetting ────────────────────────────────────────────────────────

  /**
   * Project the importance score forward `days` days without any new access.
   * Uses the same Ebbinghaus curve with current score as the effective retention seed.
   */
  simulateForgetting(initialScore: number, days: number): number {
    // Approximate stability from initial score (inverse of retention formula)
    // We treat initial score as the current retention ratio and project forward.
    // stable: s = -1/ln(initialScore) * ... — approximate by assuming stability=1
    const stability = 1 + initialScore * 4 // linear approximation
    return Math.max(0, initialScore * Math.exp(-days / stability))
  }

  // ── getOptimalReviewSchedule ──────────────────────────────────────────────────

  /**
   * Spaced repetition: compute next review dates using expanding intervals.
   * Returns dates when projected score would fall below 0.5.
   */
  getOptimalReviewSchedule(accessCount: number, currentScore: number): Date[] {
    const dates: Date[] = []
    const now = new Date()

    // Intervals based on access count (SuperMemo SM-2 inspired)
    const baseIntervals = [1, 3, 7, 14, 30, 90, 180]
    const stability = 1 + Math.log(1 + accessCount) * 2

    for (const intervalDays of baseIntervals) {
      const projected = Math.exp(-intervalDays / stability)
      if (projected < 0.5) {
        // The score will drop below 0.5 before this interval — schedule review sooner
        const reviewDay = -stability * Math.log(0.5) // day when R=0.5
        const reviewDate = new Date(now.getTime() + reviewDay * 24 * 60 * 60 * 1000)
        if (dates.length === 0 || reviewDate.getTime() !== dates[dates.length - 1].getTime()) {
          dates.push(reviewDate)
        }
        break
      } else {
        // Schedule review at this interval
        dates.push(new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000))
      }
    }

    // Ensure we always have at least one review date
    if (dates.length === 0) {
      const defaultReview = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      dates.push(defaultReview)
    }

    return dates
  }
}

export const importanceScorer = new ImportanceScorer()
