/**
 * AdaptiveLearning — learn from interactions via explicit/implicit feedback.
 * Adjusts temperature, verbosity, and formality per user.
 * Tracks model performance per task type. Minimal A/B testing support.
 */

import { createLogger } from "../utils/logger";

const logger = createLogger("AdaptiveLearning");

// ─── Types ────────────────────────────────────────────────────────────────────

export type FeedbackSignal = "positive" | "negative" | "neutral";
export type TaskType = "coding" | "analysis" | "creative" | "research" | "conversation" | "math" | "other";

export interface FeedbackEvent {
  userId: string;
  conversationId: string;
  messageId: string;
  signal: FeedbackSignal;
  taskType: TaskType;
  model: string;
  temperature: number;
  verbosity: number;
  formality: number;
  responseLength: number;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface UserPreferences {
  userId: string;
  temperature: number;            // 0.0-1.0 preferred temperature
  verbosity: number;              // 0-10 (0=terse, 10=verbose)
  formality: number;              // 0-10 (0=casual, 10=formal)
  preferredModel?: string;
  feedbackCount: number;
  positiveRate: number;           // 0.0-1.0
  lastUpdated: Date;
  taskPreferences: Record<TaskType, { temperature: number; verbosity: number; sampleCount: number }>;
}

export interface ModelPerformance {
  model: string;
  taskType: TaskType;
  positiveCount: number;
  totalCount: number;
  avgResponseLength: number;
  avgTemperature: number;
  successRate: number;
}

export interface ABTestVariant {
  id: string;
  name: string;
  temperature: number;
  model: string;
  systemPromptVariant?: string;
  weight: number;                 // traffic allocation 0.0-1.0
}

export interface ABTest {
  id: string;
  name: string;
  variants: ABTestVariant[];
  startedAt: Date;
  endedAt?: Date;
  taskType?: TaskType;
  results: Record<string, { positive: number; total: number }>;
}

// ─── Task Classifier ──────────────────────────────────────────────────────────

const TASK_PATTERNS: Array<[TaskType, RegExp]> = [
  ["coding", /\b(code|function|class|debug|implement|program|script|algorithm|typescript|python|javascript|sql|api)\b/i],
  ["math", /\b(calculate|equation|formula|integral|derivative|sum|probability|statistics|solve|proof|theorem)\b/i],
  ["research", /\b(research|find|search|study|literature|evidence|paper|analyze|investigate|compare)\b/i],
  ["creative", /\b(write|story|poem|create|design|imagine|brainstorm|invent|draft|compose)\b/i],
  ["analysis", /\b(analyze|explain|understand|why|how|implications|impact|evaluation|assessment|review)\b/i],
  ["conversation", /^(hi|hello|hey|thanks|thank you|how are|what do you think|tell me|can you|please)\b/i],
];

export function classifyTask(message: string): TaskType {
  for (const [type, pattern] of TASK_PATTERNS) {
    if (pattern.test(message)) return type;
  }
  return "other";
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_PREFS: Omit<UserPreferences, "userId" | "lastUpdated"> = {
  temperature: 0.7,
  verbosity: 5,
  formality: 5,
  feedbackCount: 0,
  positiveRate: 0.5,
  taskPreferences: {
    coding: { temperature: 0.15, verbosity: 6, sampleCount: 0 },
    analysis: { temperature: 0.5, verbosity: 7, sampleCount: 0 },
    creative: { temperature: 0.9, verbosity: 7, sampleCount: 0 },
    research: { temperature: 0.3, verbosity: 8, sampleCount: 0 },
    conversation: { temperature: 0.8, verbosity: 4, sampleCount: 0 },
    math: { temperature: 0.1, verbosity: 6, sampleCount: 0 },
    other: { temperature: 0.7, verbosity: 5, sampleCount: 0 },
  },
};

// ─── Learning Rate & Update Logic ─────────────────────────────────────────────

const LEARNING_RATE = 0.1;      // how fast preferences shift per feedback
const MIN_SAMPLES = 5;          // minimum samples before adjusting model selection

function updateEMA(current: number, newVal: number, alpha: number): number {
  return current * (1 - alpha) + newVal * alpha;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ─── AdaptiveLearning ─────────────────────────────────────────────────────────

export class AdaptiveLearning {
  private userPreferences = new Map<string, UserPreferences>();
  private feedbackHistory: FeedbackEvent[] = [];
  private modelPerformance = new Map<string, ModelPerformance>();
  private activeTests = new Map<string, ABTest>();

  // ── Feedback Recording ────────────────────────────────────────────────────

  recordFeedback(event: FeedbackEvent): void {
    this.feedbackHistory.push(event);
    if (this.feedbackHistory.length > 10_000) {
      this.feedbackHistory.splice(0, 1000); // trim oldest
    }

    this.updateUserPreferences(event);
    this.updateModelPerformance(event);

    // Update AB test results
    for (const test of this.activeTests.values()) {
      if (test.taskType && test.taskType !== event.taskType) continue;
      if (!test.results[event.model]) {
        test.results[event.model] = { positive: 0, total: 0 };
      }
      test.results[event.model]!.total++;
      if (event.signal === "positive") test.results[event.model]!.positive++;
    }

    logger.info(`Feedback recorded: user=${event.userId}, signal=${event.signal}, task=${event.taskType}`);
  }

  /**
   * Implicit feedback from message length (if user immediately rephrases → negative signal proxy).
   */
  recordImplicitFeedback(
    userId: string,
    conversationId: string,
    previousMessageId: string,
    rephrased: boolean,
    taskType: TaskType,
    model: string
  ): void {
    if (!rephrased) return;

    this.recordFeedback({
      userId,
      conversationId,
      messageId: previousMessageId,
      signal: "negative",
      taskType,
      model,
      temperature: 0.7,
      verbosity: 5,
      formality: 5,
      responseLength: 0,
      timestamp: new Date(),
      metadata: { implicit: true, reason: "immediate_rephrase" },
    });
  }

  // ── User Preference Updates ────────────────────────────────────────────────

  private updateUserPreferences(event: FeedbackEvent): void {
    const prefs = this.getOrCreatePreferences(event.userId);
    const isPositive = event.signal === "positive";
    const isNegative = event.signal === "negative";

    prefs.feedbackCount++;

    // Update positive rate with EMA
    const posSignal = isPositive ? 1.0 : isNegative ? 0.0 : 0.5;
    prefs.positiveRate = updateEMA(prefs.positiveRate, posSignal, LEARNING_RATE);

    if (isPositive) {
      // Move preferences toward what worked
      prefs.temperature = updateEMA(prefs.temperature, event.temperature, LEARNING_RATE);
      prefs.verbosity = updateEMA(prefs.verbosity, event.verbosity, LEARNING_RATE);
      prefs.formality = updateEMA(prefs.formality, event.formality, LEARNING_RATE);

      // Update task-specific preferences
      const taskPref = prefs.taskPreferences[event.taskType];
      taskPref.temperature = updateEMA(taskPref.temperature, event.temperature, LEARNING_RATE * 1.5);
      taskPref.verbosity = updateEMA(taskPref.verbosity, event.verbosity, LEARNING_RATE * 1.5);
      taskPref.sampleCount++;
    } else if (isNegative) {
      // Move preferences away from what didn't work
      const nudge = (val: number, target: number) =>
        clamp(val - (target - val) * LEARNING_RATE * 0.5, 0, 10);

      prefs.verbosity = nudge(prefs.verbosity, event.verbosity);
      prefs.formality = nudge(prefs.formality, event.formality);
    }

    prefs.lastUpdated = new Date();
  }

  // ── Model Performance Tracking ─────────────────────────────────────────────

  private updateModelPerformance(event: FeedbackEvent): void {
    const key = `${event.model}:${event.taskType}`;
    const existing = this.modelPerformance.get(key);

    if (!existing) {
      this.modelPerformance.set(key, {
        model: event.model,
        taskType: event.taskType,
        positiveCount: event.signal === "positive" ? 1 : 0,
        totalCount: 1,
        avgResponseLength: event.responseLength,
        avgTemperature: event.temperature,
        successRate: event.signal === "positive" ? 1 : 0,
      });
      return;
    }

    existing.totalCount++;
    if (event.signal === "positive") existing.positiveCount++;
    existing.avgResponseLength = updateEMA(existing.avgResponseLength, event.responseLength, 0.1);
    existing.avgTemperature = updateEMA(existing.avgTemperature, event.temperature, 0.1);
    existing.successRate = existing.positiveCount / existing.totalCount;
  }

  // ── Preference Retrieval ──────────────────────────────────────────────────

  getUserPreferences(userId: string): UserPreferences {
    return this.getOrCreatePreferences(userId);
  }

  private getOrCreatePreferences(userId: string): UserPreferences {
    if (!this.userPreferences.has(userId)) {
      this.userPreferences.set(userId, {
        userId,
        ...DEFAULT_PREFS,
        taskPreferences: JSON.parse(JSON.stringify(DEFAULT_PREFS.taskPreferences)) as UserPreferences["taskPreferences"],
        lastUpdated: new Date(),
      });
    }
    return this.userPreferences.get(userId)!;
  }

  /**
   * Get recommended parameters for a user + task combination.
   */
  getRecommendedParams(
    userId: string,
    taskType: TaskType,
    baseTemperature?: number
  ): { temperature: number; maxTokens: number; systemPromptHint: string } {
    const prefs = this.getOrCreatePreferences(userId);
    const taskPref = prefs.taskPreferences[taskType];

    // Only use learned task preferences if we have enough samples
    const temperature = taskPref.sampleCount >= MIN_SAMPLES
      ? clamp(taskPref.temperature, 0, 1)
      : (baseTemperature ?? prefs.temperature);

    // Verbosity → max tokens (5=1024, 10=4096, 0=256)
    const verbosity = taskPref.sampleCount >= MIN_SAMPLES ? taskPref.verbosity : prefs.verbosity;
    const maxTokens = Math.round(256 + (verbosity / 10) * (4096 - 256));

    // Build system prompt hint
    const hints: string[] = [];
    if (verbosity < 3) hints.push("Be very concise.");
    else if (verbosity > 7) hints.push("Be thorough and detailed.");
    if (prefs.formality < 3) hints.push("Use casual, conversational tone.");
    else if (prefs.formality > 7) hints.push("Maintain professional, formal tone.");

    return {
      temperature: clamp(temperature, 0, 1),
      maxTokens,
      systemPromptHint: hints.join(" "),
    };
  }

  // ── Best Model Recommendation ─────────────────────────────────────────────

  getBestModel(taskType: TaskType, availableModels: string[]): string | null {
    let best: { model: string; score: number } | null = null;

    for (const model of availableModels) {
      const key = `${model}:${taskType}`;
      const perf = this.modelPerformance.get(key);

      if (!perf || perf.totalCount < MIN_SAMPLES) continue;

      if (!best || perf.successRate > best.score) {
        best = { model, score: perf.successRate };
      }
    }

    return best?.model ?? null;
  }

  // ── A/B Testing ───────────────────────────────────────────────────────────

  createABTest(test: Omit<ABTest, "startedAt" | "results">): ABTest {
    const newTest: ABTest = {
      ...test,
      startedAt: new Date(),
      results: {},
    };
    this.activeTests.set(test.id, newTest);
    logger.info(`A/B test created: ${test.id} (${test.variants.length} variants)`);
    return newTest;
  }

  selectVariant(testId: string, userId: string): ABTestVariant | null {
    const test = this.activeTests.get(testId);
    if (!test || test.endedAt) return null;

    // Deterministic assignment based on userId hash
    const hash = userId.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
    let cumulative = 0;

    for (const variant of test.variants) {
      cumulative += variant.weight;
      if ((hash % 100) / 100 < cumulative) return variant;
    }

    return test.variants[test.variants.length - 1] ?? null;
  }

  endABTest(testId: string): ABTest | null {
    const test = this.activeTests.get(testId);
    if (!test) return null;
    test.endedAt = new Date();
    return test;
  }

  getABTestResults(testId: string): Record<string, { successRate: number; total: number }> | null {
    const test = this.activeTests.get(testId);
    if (!test) return null;

    return Object.fromEntries(
      Object.entries(test.results).map(([model, r]) => [
        model,
        { successRate: r.total > 0 ? r.positive / r.total : 0, total: r.total },
      ])
    );
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  getModelLeaderboard(taskType?: TaskType): ModelPerformance[] {
    const perfs = [...this.modelPerformance.values()];
    const filtered = taskType ? perfs.filter((p) => p.taskType === taskType) : perfs;
    return filtered
      .filter((p) => p.totalCount >= MIN_SAMPLES)
      .sort((a, b) => b.successRate - a.successRate);
  }

  getUserStats(userId: string): { feedbackCount: number; positiveRate: number; topTaskType: TaskType } {
    const prefs = this.getOrCreatePreferences(userId);
    const topTask = Object.entries(prefs.taskPreferences)
      .sort((a, b) => b[1].sampleCount - a[1].sampleCount)[0]?.[0] as TaskType ?? "other";

    return {
      feedbackCount: prefs.feedbackCount,
      positiveRate: prefs.positiveRate,
      topTaskType: topTask,
    };
  }
}

export const adaptiveLearning = new AdaptiveLearning();
