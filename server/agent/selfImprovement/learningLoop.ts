import { EventEmitter } from 'events';
import { performanceTracker } from './performanceTracker';
import { skillEvolution } from './skillEvolution';
import type { TaskComplexity } from './performanceTracker';

export interface Lesson {
  id: string;
  runId: string;
  taskType: string;
  complexity: TaskComplexity;
  success: boolean;
  whatWorked: string[];
  whatFailed: string[];
  rootCause?: string;
  toolsUsed: string[];
  durationMs: number;
  tokensUsed: number;
  timestamp: number;
}

export interface StructuredKnowledge {
  pattern: string;
  applicableTaskTypes: string[];
  confidence: number;
  supportingLessons: string[];
  lastValidated: number;
}

export interface FeedbackSignal {
  runId: string;
  responseQuality: number;
  taskCompletion: number;
  efficiency: number;
  userSatisfaction?: number;
  improvements: string[];
}

export interface LearningStats {
  totalLessons: number;
  knowledgePatterns: number;
  avgResponseQuality: number;
  improvementRate: number;
  topPatterns: StructuredKnowledge[];
  recentLessons: Lesson[];
}

export class LearningLoop extends EventEmitter {
  private lessons: Lesson[] = [];
  private knowledge: Map<string, StructuredKnowledge> = new Map();
  private feedbackHistory: FeedbackSignal[] = [];
  private maxLessons = 5000;
  private maxFeedback = 2000;

  extractLessons(
    runId: string,
    taskType: string,
    complexity: TaskComplexity,
    success: boolean,
    details: {
      toolsUsed: string[];
      durationMs: number;
      tokensUsed: number;
      steps?: string[];
      errors?: string[];
    },
  ): Lesson {
    const whatWorked: string[] = [];
    const whatFailed: string[] = [];
    let rootCause: string | undefined;

    if (success) {
      if (details.durationMs < 5000) whatWorked.push('Fast execution');
      if (details.tokensUsed < 2000) whatWorked.push('Token-efficient approach');
      if (details.toolsUsed.length === 1) whatWorked.push('Single-tool solution');
      if (details.toolsUsed.length > 3) whatWorked.push('Effective multi-tool orchestration');
      if (details.steps && details.steps.length > 0) {
        whatWorked.push(`Completed in ${details.steps.length} steps`);
      }
    } else {
      if (details.errors && details.errors.length > 0) {
        for (const err of details.errors) {
          whatFailed.push(err);
        }
        rootCause = this.inferRootCause(details.errors);
      }
      if (details.durationMs > 60000) whatFailed.push('Execution took too long');
      if (details.tokensUsed > 10000) whatFailed.push('Excessive token usage');
    }

    const lesson: Lesson = {
      id: `lesson_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      runId,
      taskType,
      complexity,
      success,
      whatWorked,
      whatFailed,
      rootCause,
      toolsUsed: details.toolsUsed,
      durationMs: details.durationMs,
      tokensUsed: details.tokensUsed,
      timestamp: Date.now(),
    };

    this.lessons.push(lesson);
    if (this.lessons.length > this.maxLessons) {
      this.lessons = this.lessons.slice(-this.maxLessons);
    }

    for (const tool of details.toolsUsed) {
      skillEvolution.recordSkillUse(tool, success, complexity);
    }

    performanceTracker.recordMetric({
      toolName: details.toolsUsed[0] || 'unknown',
      taskType,
      complexity,
      success,
      durationMs: details.durationMs,
      tokensUsed: details.tokensUsed,
      errorMessage: details.errors?.[0],
    });

    this.deriveKnowledge(lesson);
    this.emit('lesson:extracted', lesson);
    return lesson;
  }

  private inferRootCause(errors: string[]): string {
    const combined = errors.join(' ').toLowerCase();
    if (combined.includes('timeout') || combined.includes('timed out')) return 'Operation timeout';
    if (combined.includes('rate limit') || combined.includes('429')) return 'Rate limiting';
    if (combined.includes('not found') || combined.includes('404')) return 'Resource not found';
    if (combined.includes('permission') || combined.includes('403') || combined.includes('unauthorized'))
      return 'Permission denied';
    if (combined.includes('parse') || combined.includes('syntax') || combined.includes('invalid'))
      return 'Data parsing error';
    if (combined.includes('network') || combined.includes('connection') || combined.includes('ECONNREFUSED'))
      return 'Network connectivity issue';
    return 'Unknown error';
  }

  private deriveKnowledge(lesson: Lesson): void {
    if (!lesson.success) {
      if (lesson.rootCause) {
        const patternKey = `avoid_${lesson.rootCause.replace(/\s+/g, '_').toLowerCase()}`;
        this.addKnowledge(patternKey, {
          pattern: `When encountering "${lesson.rootCause}", use retry/fallback strategies`,
          applicableTaskTypes: [lesson.taskType],
          confidence: 0.6,
          supportingLessons: [lesson.id],
          lastValidated: Date.now(),
        });
      }
      return;
    }

    if (lesson.durationMs < 3000 && lesson.tokensUsed < 1500) {
      const patternKey = `efficient_${lesson.taskType}_${lesson.toolsUsed.sort().join('+')}`;
      this.addKnowledge(patternKey, {
        pattern: `For "${lesson.taskType}", using [${lesson.toolsUsed.join(', ')}] is efficient`,
        applicableTaskTypes: [lesson.taskType],
        confidence: 0.7,
        supportingLessons: [lesson.id],
        lastValidated: Date.now(),
      });
    }
  }

  private addKnowledge(key: string, entry: StructuredKnowledge): void {
    const existing = this.knowledge.get(key);
    if (existing) {
      existing.confidence = Math.min(1, existing.confidence + 0.05);
      existing.supportingLessons.push(...entry.supportingLessons);
      if (existing.supportingLessons.length > 20) {
        existing.supportingLessons = existing.supportingLessons.slice(-20);
      }
      for (const t of entry.applicableTaskTypes) {
        if (!existing.applicableTaskTypes.includes(t)) existing.applicableTaskTypes.push(t);
      }
      existing.lastValidated = Date.now();
    } else {
      this.knowledge.set(key, entry);
    }
  }

  recordFeedback(signal: FeedbackSignal): void {
    this.feedbackHistory.push(signal);
    if (this.feedbackHistory.length > this.maxFeedback) {
      this.feedbackHistory = this.feedbackHistory.slice(-this.maxFeedback);
    }
    this.emit('feedback:recorded', signal);
  }

  applyRLAIF(
    taskType: string,
    proposedApproach: string[],
  ): { adjustedApproach: string[]; reasoning: string[] } {
    const reasoning: string[] = [];
    const adjusted = [...proposedApproach];

    const relevantKnowledge = [...this.knowledge.values()]
      .filter(k => k.applicableTaskTypes.includes(taskType) && k.confidence >= 0.6)
      .sort((a, b) => b.confidence - a.confidence);

    for (const k of relevantKnowledge.slice(0, 5)) {
      reasoning.push(`[confidence=${k.confidence.toFixed(2)}] ${k.pattern}`);
    }

    const recentFeedback = this.feedbackHistory.slice(-20);
    if (recentFeedback.length >= 5) {
      const avgQuality = recentFeedback.reduce((s, f) => s + f.responseQuality, 0) / recentFeedback.length;
      const avgEfficiency = recentFeedback.reduce((s, f) => s + f.efficiency, 0) / recentFeedback.length;

      if (avgQuality < 0.6) {
        adjusted.push('Increase detail and verification steps');
        reasoning.push('Recent response quality is low - adding verification');
      }
      if (avgEfficiency < 0.5) {
        adjusted.push('Simplify approach, reduce unnecessary steps');
        reasoning.push('Recent efficiency is low - streamlining');
      }
    }

    const strategies = this.adaptFromPastOutcomes(taskType);
    adjusted.push(...strategies);

    return { adjustedApproach: adjusted, reasoning };
  }

  private adaptFromPastOutcomes(taskType: string): string[] {
    const strategies: string[] = [];
    const relevant = this.lessons.filter(l => l.taskType === taskType).slice(-50);
    if (relevant.length < 3) return strategies;

    const successLessons = relevant.filter(l => l.success);
    const failLessons = relevant.filter(l => !l.success);

    if (successLessons.length > 0) {
      const toolFreq = new Map<string, number>();
      for (const l of successLessons) {
        for (const t of l.toolsUsed) {
          toolFreq.set(t, (toolFreq.get(t) || 0) + 1);
        }
      }
      const topTools = [...toolFreq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t]) => t);

      if (topTools.length > 0) {
        strategies.push(`Prefer tools: ${topTools.join(', ')} (historically successful)`);
      }
    }

    if (failLessons.length > 0) {
      const rootCauses = failLessons
        .map(l => l.rootCause)
        .filter((r): r is string => !!r);

      const causeFreq = new Map<string, number>();
      for (const c of rootCauses) causeFreq.set(c, (causeFreq.get(c) || 0) + 1);

      const topCauses = [...causeFreq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([c]) => c);

      for (const cause of topCauses) {
        strategies.push(`Guard against "${cause}" (common failure mode)`);
      }
    }

    return strategies;
  }

  getStats(): LearningStats {
    const avgQuality =
      this.feedbackHistory.length > 0
        ? this.feedbackHistory.reduce((s, f) => s + f.responseQuality, 0) / this.feedbackHistory.length
        : 0;

    let improvementRate = 0;
    if (this.feedbackHistory.length >= 10) {
      const firstHalf = this.feedbackHistory.slice(0, Math.floor(this.feedbackHistory.length / 2));
      const secondHalf = this.feedbackHistory.slice(Math.floor(this.feedbackHistory.length / 2));
      const firstAvg = firstHalf.reduce((s, f) => s + f.responseQuality, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((s, f) => s + f.responseQuality, 0) / secondHalf.length;
      improvementRate = secondAvg - firstAvg;
    }

    const topPatterns = [...this.knowledge.values()]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10);

    return {
      totalLessons: this.lessons.length,
      knowledgePatterns: this.knowledge.size,
      avgResponseQuality: avgQuality,
      improvementRate,
      topPatterns,
      recentLessons: this.lessons.slice(-10),
    };
  }

  getLessonsForTask(taskType: string): Lesson[] {
    return this.lessons.filter(l => l.taskType === taskType);
  }

  getKnowledgeForTask(taskType: string): StructuredKnowledge[] {
    return [...this.knowledge.values()]
      .filter(k => k.applicableTaskTypes.includes(taskType))
      .sort((a, b) => b.confidence - a.confidence);
  }
}

export const learningLoop = new LearningLoop();
