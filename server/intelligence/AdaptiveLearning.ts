/**
 * AdaptiveLearning
 *
 * Learns from every interaction to improve future responses.
 *
 * What it tracks:
 *   - Response ratings (explicit thumbs up/down + implicit signals)
 *   - Per-user preferences: verbosity, formality, technical depth
 *   - A/B test outcomes: which strategy worked better for which task type
 *   - Model performance: which model produced better outcomes per intent
 *   - Failure patterns: common question types where responses fell short
 *
 * All state is in-memory per-user (Map-backed).
 * Persistence: call `serialise()` and store externally (Redis, DB).
 *
 * Privacy: no raw message text is stored — only aggregate signals.
 */

import { z }      from 'zod';
import { Logger } from '../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export const FeedbackSignalSchema = z.object({
  requestId  : z.string(),
  userId     : z.string(),
  intent     : z.string(),
  strategyName: z.string(),
  model      : z.string(),
  rating     : z.enum(['positive', 'negative', 'neutral']),
  implicit   : z.boolean(),   // True = inferred from behaviour, false = explicit
  qualityScore: z.number().min(0).max(1),
  durationMs : z.number().nonneg(),
  timestamp  : z.number(),
});
export type FeedbackSignal = z.infer<typeof FeedbackSignalSchema>;

export interface UserAdaptation {
  userId           : string;
  /** Inferred preferred verbosity 0–1. 0 = very brief, 1 = detailed. */
  verbosity        : number;
  /** Inferred formality 0–1. 0 = casual, 1 = formal. */
  formality        : number;
  /** Inferred technical depth 0–1. */
  technicalDepth   : number;
  /** Interaction count — adaptation becomes more confident over time. */
  interactionCount : number;
  /** Per-intent average quality scores from this user's feedback. */
  intentScores     : Record<string, number>;
  /** Preferred model per intent (based on positive feedback). */
  modelPreferences : Record<string, string>;
  lastUpdated      : number;
}

export interface ModelPerformanceRecord {
  model     : string;
  intent    : string;
  totalCalls: number;
  avgQuality: number;
  positives : number;
  negatives : number;
}

export interface ABTestVariant {
  variantId : string;
  strategyName: string;
  model     : string;
  temperature: number;
  positives : number;
  negatives : number;
  totalCalls: number;
}

export interface ABTest {
  testId    : string;
  intent    : string;
  variants  : ABTestVariant[];
  startedAt : number;
  active    : boolean;
}

// ─── User adaptation store ────────────────────────────────────────────────────

const DEFAULT_ADAPTATION: Omit<UserAdaptation, 'userId' | 'lastUpdated'> = {
  verbosity       : 0.5,
  formality       : 0.4,
  technicalDepth  : 0.5,
  interactionCount: 0,
  intentScores    : {},
  modelPreferences: {},
};

// ─── Signal interpretation ────────────────────────────────────────────────────

/** Infer verbosity preference from response quality signals. */
function adjustVerbosity(current: number, signal: FeedbackSignal): number {
  // If a short response (high quality score on short) got positive → user likes brevity
  const directionHint = signal.qualityScore > 0.75 && signal.rating === 'positive' ? -0.02 : 0.02;
  const delta = signal.rating === 'positive'
    ? directionHint
    : signal.rating === 'negative' ? -directionHint : 0;
  return Math.max(0, Math.min(1, current + delta));
}

function adjustTechnicalDepth(current: number, signal: FeedbackSignal): number {
  const techIntents = ['code', 'analysis'];
  if (!techIntents.includes(signal.intent)) return current;
  const delta = signal.rating === 'positive' ? 0.03 : -0.03;
  return Math.max(0, Math.min(1, current + delta));
}

// ─── Main class ───────────────────────────────────────────────────────────────

export class AdaptiveLearningEngine {
  private readonly users         = new Map<string, UserAdaptation>();
  private readonly modelPerf     = new Map<string, ModelPerformanceRecord>();
  private readonly abTests       = new Map<string, ABTest>();
  private readonly history       : FeedbackSignal[] = [];

  // ── Feedback ingestion ──────────────────────────────────────────────────────

  /** Record a feedback signal and update all relevant models. */
  recordFeedback(signal: FeedbackSignal): void {
    this.history.push(signal);
    if (this.history.length > 10_000) this.history.shift(); // bounded history

    this._updateUserAdaptation(signal);
    this._updateModelPerformance(signal);
    this._updateABTests(signal);

    Logger.debug('[AdaptiveLearning] feedback recorded', {
      userId  : signal.userId,
      intent  : signal.intent,
      rating  : signal.rating,
      model   : signal.model,
    });
  }

  // ── User adaptation ─────────────────────────────────────────────────────────

  private _ensureUser(userId: string): UserAdaptation {
    if (!this.users.has(userId)) {
      this.users.set(userId, {
        ...DEFAULT_ADAPTATION,
        userId,
        lastUpdated    : Date.now(),
        intentScores   : {},
        modelPreferences: {},
      });
    }
    return this.users.get(userId)!;
  }

  private _updateUserAdaptation(signal: FeedbackSignal): void {
    const user = this._ensureUser(signal.userId);

    user.verbosity        = adjustVerbosity(user.verbosity, signal);
    user.technicalDepth   = adjustTechnicalDepth(user.technicalDepth, signal);
    user.interactionCount++;
    user.lastUpdated      = Date.now();

    // Running average quality per intent
    const prev = user.intentScores[signal.intent] ?? signal.qualityScore;
    user.intentScores[signal.intent] = prev * 0.9 + signal.qualityScore * 0.1;

    // Track model preference (update when positive feedback on a specific model)
    if (signal.rating === 'positive' && signal.model !== 'auto') {
      user.modelPreferences[signal.intent] = signal.model;
    }
  }

  /** Get adaptation profile for a user. */
  getUserAdaptation(userId: string): UserAdaptation {
    return this._ensureUser(userId);
  }

  /** Build a system-prompt addendum based on user's learned preferences. */
  buildUserHint(userId: string): string {
    const user = this.users.get(userId);
    if (!user || user.interactionCount < 3) return ''; // Not enough data

    const parts: string[] = [];
    if (user.verbosity < 0.3) parts.push('Keep responses brief.');
    if (user.verbosity > 0.7) parts.push('Provide detailed explanations.');
    if (user.formality > 0.7) parts.push('Use formal language.');
    if (user.formality < 0.3) parts.push('Use casual, friendly language.');
    if (user.technicalDepth > 0.7) parts.push('Assume technical expertise.');
    if (user.technicalDepth < 0.3) parts.push('Avoid jargon; explain technical terms.');

    return parts.length > 0 ? parts.join(' ') : '';
  }

  /** Suggest the best model for a given user and intent. */
  suggestModel(userId: string, intent: string): string | undefined {
    const user = this.users.get(userId);
    return user?.modelPreferences[intent];
  }

  // ── Model performance ───────────────────────────────────────────────────────

  private _updateModelPerformance(signal: FeedbackSignal): void {
    const key = `${signal.model}:${signal.intent}`;
    const rec = this.modelPerf.get(key) ?? {
      model: signal.model, intent: signal.intent,
      totalCalls: 0, avgQuality: 0, positives: 0, negatives: 0,
    };

    rec.totalCalls++;
    rec.avgQuality = rec.avgQuality * 0.9 + signal.qualityScore * 0.1;
    if (signal.rating === 'positive') rec.positives++;
    if (signal.rating === 'negative') rec.negatives++;

    this.modelPerf.set(key, rec);
  }

  /** Return the best-performing model for a given intent based on feedback history. */
  bestModelForIntent(intent: string): string | undefined {
    let best: ModelPerformanceRecord | undefined;
    for (const rec of this.modelPerf.values()) {
      if (rec.intent !== intent || rec.totalCalls < 5) continue;
      if (!best || rec.avgQuality > best.avgQuality) best = rec;
    }
    return best?.model;
  }

  /** Return model performance leaderboard for an intent. */
  modelLeaderboard(intent: string): ModelPerformanceRecord[] {
    return [...this.modelPerf.values()]
      .filter(r => r.intent === intent && r.totalCalls >= 3)
      .sort((a, b) => b.avgQuality - a.avgQuality);
  }

  // ── A/B testing ─────────────────────────────────────────────────────────────

  private _updateABTests(signal: FeedbackSignal): void {
    for (const test of this.abTests.values()) {
      if (!test.active || test.intent !== signal.intent) continue;
      const variant = test.variants.find(v => v.strategyName === signal.strategyName);
      if (!variant) continue;
      variant.totalCalls++;
      if (signal.rating === 'positive') variant.positives++;
      if (signal.rating === 'negative') variant.negatives++;
    }
  }

  /** Create an A/B test comparing two strategy variants. */
  createABTest(testId: string, intent: string, variants: Omit<ABTestVariant, 'positives' | 'negatives' | 'totalCalls'>[]): ABTest {
    const test: ABTest = {
      testId,
      intent,
      variants: variants.map(v => ({ ...v, positives: 0, negatives: 0, totalCalls: 0 })),
      startedAt: Date.now(),
      active   : true,
    };
    this.abTests.set(testId, test);
    Logger.info('[AdaptiveLearning] A/B test created', { testId, intent, variants: variants.length });
    return test;
  }

  /** Return the winning variant for a test (minimum 20 calls to declare winner). */
  abTestWinner(testId: string): ABTestVariant | null {
    const test = this.abTests.get(testId);
    if (!test) return null;
    const eligible = test.variants.filter(v => v.totalCalls >= 20);
    if (eligible.length === 0) return null;
    return eligible.reduce((best, v) =>
      v.positives / v.totalCalls > best.positives / best.totalCalls ? v : best
    );
  }

  // ── Serialisation ────────────────────────────────────────────────────────────

  serialise(): string {
    return JSON.stringify({
      users    : [...this.users.entries()],
      modelPerf: [...this.modelPerf.entries()],
      abTests  : [...this.abTests.entries()],
    });
  }

  deserialise(raw: string): void {
    const data = JSON.parse(raw) as {
      users    : [string, UserAdaptation][];
      modelPerf: [string, ModelPerformanceRecord][];
      abTests  : [string, ABTest][];
    };
    data.users.forEach(([k, v])     => this.users.set(k, v));
    data.modelPerf.forEach(([k, v]) => this.modelPerf.set(k, v));
    data.abTests.forEach(([k, v])   => this.abTests.set(k, v));
  }

  get stats() {
    return {
      users  : this.users.size,
      models : this.modelPerf.size,
      abTests: this.abTests.size,
      signals: this.history.length,
    };
  }
}

export const adaptiveLearning = new AdaptiveLearningEngine();
