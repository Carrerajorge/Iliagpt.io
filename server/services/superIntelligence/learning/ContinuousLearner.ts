/**
 * Continuous Learner - Main learning orchestration system
 *
 * Coordinates feedback collection, reward modeling, and self-critique
 * to enable continuous improvement of the AI system.
 */

import { EventEmitter } from 'events';
import { feedbackCollector, FeedbackEntry, AggregatedFeedback } from './FeedbackCollector';
import { rewardModel, RewardPrediction, ModelMetrics, TrainingExample } from './RewardModel';
import { selfCritique, CritiqueResult } from './SelfCritique';

// Learning configuration
export interface LearningConfig {
  enabled: boolean;
  autoTrain: boolean;
  trainingInterval: number; // ms between training runs
  minExamplesForTraining: number;
  improvementThreshold: number;
  maxTrainingExamples: number;
  feedbackDecayDays: number;
  critiqueDimensions: string[];
  constitutionalAIEnabled: boolean;
}

// Learning session
export interface LearningSession {
  id: string;
  userId: string;
  conversationId: string;
  responses: Array<{
    responseId: string;
    response: string;
    query: string;
    timestamp: number;
    reward?: number;
    critique?: CritiqueResult;
    feedback?: FeedbackEntry[];
  }>;
  startedAt: number;
  endedAt?: number;
  aggregatedLearning?: {
    avgReward: number;
    avgCritique: number;
    improvementAreas: string[];
    strengthAreas: string[];
  };
}

// Learning report
export interface LearningReport {
  timestamp: number;
  period: {
    start: number;
    end: number;
  };
  metrics: {
    totalFeedback: number;
    totalCritiques: number;
    averageReward: number;
    averageCritiqueScore: number;
    rewardModelAccuracy: number;
    improvementRate: number;
  };
  insights: string[];
  recommendations: string[];
  topStrengths: string[];
  topWeaknesses: string[];
  trainingHistory: Array<{
    timestamp: number;
    examplesUsed: number;
    beforeMetrics: ModelMetrics | null;
    afterMetrics: ModelMetrics;
  }>;
}

// Real-time learning signal
export interface LearningSignal {
  type: 'feedback' | 'critique' | 'training' | 'improvement';
  source: string;
  data: any;
  timestamp: number;
  impact: 'positive' | 'negative' | 'neutral';
}

/**
 * ContinuousLearner - Orchestrates the learning system
 */
export class ContinuousLearner extends EventEmitter {
  private config: LearningConfig;
  private sessions: Map<string, LearningSession>;
  private trainingSchedule: NodeJS.Timeout | null = null;
  private learningSignals: LearningSignal[];
  private lastTrainingTime: number = 0;
  private trainingInProgress: boolean = false;

  constructor(config?: Partial<LearningConfig>) {
    super();
    this.config = {
      enabled: true,
      autoTrain: true,
      trainingInterval: 3600000, // 1 hour
      minExamplesForTraining: 20,
      improvementThreshold: 0.05,
      maxTrainingExamples: 10000,
      feedbackDecayDays: 30,
      critiqueDimensions: ['accuracy', 'helpfulness', 'safety', 'clarity'],
      constitutionalAIEnabled: true,
      ...config
    };
    this.sessions = new Map();
    this.learningSignals = [];
  }

  /**
   * Initialize the continuous learning system
   */
  async initialize(): Promise<void> {
    console.log('[ContinuousLearner] Initializing...');

    // Initialize sub-components
    await rewardModel.initialize();

    // Set up event listeners
    this.setupEventListeners();

    // Start auto-training if enabled
    if (this.config.autoTrain) {
      this.startAutoTraining();
    }

    console.log('[ContinuousLearner] Initialized');
    console.log(`[ContinuousLearner] Auto-training: ${this.config.autoTrain ? 'enabled' : 'disabled'}`);
    console.log(`[ContinuousLearner] Constitutional AI: ${this.config.constitutionalAIEnabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Set up event listeners
   */
  private setupEventListeners(): void {
    // Listen for feedback events
    feedbackCollector.on('feedback:collected', (data) => {
      this.handleFeedback(data);
    });

    // Listen for critique events
    selfCritique.on('critique:completed', (data) => {
      this.handleCritique(data);
    });

    // Listen for training events
    rewardModel.on('epoch:completed', (data) => {
      this.recordSignal('training', 'reward_model', data, 'neutral');
    });
  }

  /**
   * Start a learning session
   */
  startSession(userId: string, conversationId: string): string {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const session: LearningSession = {
      id: sessionId,
      userId,
      conversationId,
      responses: [],
      startedAt: Date.now()
    };

    this.sessions.set(sessionId, session);
    this.emit('session:started', { sessionId, userId, conversationId });

    return sessionId;
  }

  /**
   * Record a response for learning
   */
  async recordResponse(
    sessionId: string,
    responseId: string,
    query: string,
    response: string
  ): Promise<{
    reward: RewardPrediction;
    critique?: CritiqueResult;
    suggestions: string[];
  }> {
    const session = this.sessions.get(sessionId);

    // Get reward prediction
    const reward = rewardModel.predict(query, response);

    // Optionally perform critique
    let critique: CritiqueResult | undefined;
    let suggestions: string[] = [];

    if (this.config.constitutionalAIEnabled) {
      critique = await selfCritique.critique(query, response, {
        dimensions: this.config.critiqueDimensions as any
      });
      suggestions = critique.improvementSuggestions;
    }

    // Record in session if exists
    if (session) {
      session.responses.push({
        responseId,
        response,
        query,
        timestamp: Date.now(),
        reward: reward.reward,
        critique
      });
    }

    // Record learning signal
    this.recordSignal(
      'critique',
      'response_evaluation',
      { responseId, reward: reward.reward, critiqueScore: critique?.overallScore },
      reward.reward >= 0.7 ? 'positive' : reward.reward >= 0.5 ? 'neutral' : 'negative'
    );

    return { reward, critique, suggestions };
  }

  /**
   * Record user feedback
   */
  async recordFeedback(
    sessionId: string,
    responseId: string,
    feedbackType: 'rating' | 'text' | 'accept' | 'reject' | 'edit',
    data: {
      rating?: number;
      text?: string;
      originalResponse?: string;
      editedResponse?: string;
    },
    context: {
      query: string;
      response: string;
    }
  ): Promise<string> {
    const session = this.sessions.get(sessionId);

    let feedbackId: string;

    switch (feedbackType) {
      case 'rating':
        feedbackId = await feedbackCollector.collectRating(
          session?.userId || 'anonymous',
          responseId,
          session?.conversationId || 'unknown',
          data.rating || 3,
          context
        );
        break;

      case 'text':
        feedbackId = await feedbackCollector.collectTextFeedback(
          session?.userId || 'anonymous',
          responseId,
          session?.conversationId || 'unknown',
          data.text || '',
          context
        );
        break;

      case 'accept':
        feedbackId = await feedbackCollector.collectAcceptance(
          session?.userId || 'anonymous',
          responseId,
          session?.conversationId || 'unknown',
          context
        );
        break;

      case 'edit':
        feedbackId = await feedbackCollector.collectEdit(
          session?.userId || 'anonymous',
          responseId,
          session?.conversationId || 'unknown',
          data.originalResponse || '',
          data.editedResponse || '',
          context
        );
        break;

      default:
        feedbackId = await feedbackCollector.collectRegeneration(
          session?.userId || 'anonymous',
          responseId,
          session?.conversationId || 'unknown',
          context
        );
    }

    // Add training example
    if (data.rating !== undefined) {
      rewardModel.addTrainingExample(
        context.query,
        context.response,
        data.rating / 5, // Normalize to 0-1
        'human'
      );
    }

    return feedbackId;
  }

  /**
   * End a learning session
   */
  endSession(sessionId: string): LearningSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    session.endedAt = Date.now();

    // Aggregate learning from session
    if (session.responses.length > 0) {
      const rewards = session.responses.map(r => r.reward || 0);
      const critiques = session.responses
        .filter(r => r.critique)
        .map(r => r.critique!.overallScore);

      const avgReward = rewards.reduce((a, b) => a + b, 0) / rewards.length;
      const avgCritique = critiques.length > 0
        ? critiques.reduce((a, b) => a + b, 0) / critiques.length
        : 0;

      // Identify improvement and strength areas
      const allWeaknesses: Record<string, number> = {};
      const allStrengths: Record<string, number> = {};

      for (const response of session.responses) {
        if (response.critique) {
          for (const weakness of response.critique.weaknesses) {
            const category = weakness.split(':')[0];
            allWeaknesses[category] = (allWeaknesses[category] || 0) + 1;
          }
          for (const strength of response.critique.strengths) {
            const category = strength.split(':')[0];
            allStrengths[category] = (allStrengths[category] || 0) + 1;
          }
        }
      }

      session.aggregatedLearning = {
        avgReward,
        avgCritique,
        improvementAreas: Object.entries(allWeaknesses)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([cat]) => cat),
        strengthAreas: Object.entries(allStrengths)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([cat]) => cat)
      };
    }

    this.emit('session:ended', { sessionId, session });
    return session;
  }

  /**
   * Handle feedback event
   */
  private handleFeedback(data: { feedbackId: string; type: string; source: string }): void {
    this.recordSignal(
      'feedback',
      data.source,
      { feedbackId: data.feedbackId, type: data.type },
      data.type === 'implicit_accept' ? 'positive' : 'neutral'
    );

    // Check if we should trigger training
    const feedbackStats = feedbackCollector.getStats();
    if (
      this.config.autoTrain &&
      !this.trainingInProgress &&
      feedbackStats.totalFeedback >= this.config.minExamplesForTraining &&
      Date.now() - this.lastTrainingTime >= this.config.trainingInterval
    ) {
      this.triggerTraining();
    }
  }

  /**
   * Handle critique event
   */
  private handleCritique(data: { critiqueId: string; overallScore: number }): void {
    this.recordSignal(
      'critique',
      'self_critique',
      { critiqueId: data.critiqueId, score: data.overallScore },
      data.overallScore >= 0.7 ? 'positive' : data.overallScore >= 0.5 ? 'neutral' : 'negative'
    );
  }

  /**
   * Record a learning signal
   */
  private recordSignal(
    type: LearningSignal['type'],
    source: string,
    data: any,
    impact: LearningSignal['impact']
  ): void {
    const signal: LearningSignal = {
      type,
      source,
      data,
      timestamp: Date.now(),
      impact
    };

    this.learningSignals.push(signal);

    // Keep only last 1000 signals
    if (this.learningSignals.length > 1000) {
      this.learningSignals.shift();
    }

    this.emit('signal:recorded', signal);
  }

  /**
   * Start auto-training schedule
   */
  private startAutoTraining(): void {
    this.trainingSchedule = setInterval(() => {
      this.triggerTraining();
    }, this.config.trainingInterval);

    console.log(`[ContinuousLearner] Auto-training scheduled every ${this.config.trainingInterval / 1000}s`);
  }

  /**
   * Trigger training run
   */
  async triggerTraining(): Promise<ModelMetrics | null> {
    if (this.trainingInProgress) {
      console.log('[ContinuousLearner] Training already in progress');
      return null;
    }

    const rewardStats = rewardModel.getStats();
    if (rewardStats.trainingExamples < this.config.minExamplesForTraining) {
      console.log('[ContinuousLearner] Not enough examples for training');
      return null;
    }

    this.trainingInProgress = true;
    const beforeMetrics = rewardStats.latestMetrics;

    console.log('[ContinuousLearner] Starting training run...');

    try {
      const metrics = await rewardModel.train(10); // 10 epochs

      this.lastTrainingTime = Date.now();

      // Record improvement
      const improvement = beforeMetrics
        ? metrics.accuracy - beforeMetrics.accuracy
        : 0;

      this.recordSignal(
        'training',
        'continuous_learner',
        { metrics, improvement },
        improvement > 0 ? 'positive' : 'neutral'
      );

      console.log('[ContinuousLearner] Training complete. Accuracy:', metrics.accuracy);

      this.emit('training:completed', { metrics, improvement });

      return metrics;

    } catch (error) {
      console.error('[ContinuousLearner] Training error:', error);
      return null;
    } finally {
      this.trainingInProgress = false;
    }
  }

  /**
   * Improve a response using learned models
   */
  async improveResponse(
    query: string,
    response: string
  ): Promise<{
    improved: boolean;
    originalScore: number;
    improvedScore: number;
    response: string;
    suggestions: string[];
  }> {
    // Get initial scores
    const originalReward = rewardModel.predict(query, response);
    const originalCritique = await selfCritique.critique(query, response);

    const originalScore = (originalReward.reward + originalCritique.overallScore) / 2;

    // If already good, don't improve
    if (originalScore >= 0.8) {
      return {
        improved: false,
        originalScore,
        improvedScore: originalScore,
        response,
        suggestions: []
      };
    }

    // Try to improve
    const improvement = await selfCritique.improveResponse(query, response, 3);

    // Score improved response
    const improvedReward = rewardModel.predict(query, improvement.finalResponse);
    const improvedScore = (improvedReward.reward + (originalCritique.overallScore + improvement.improvement)) / 2;

    const actuallyImproved = improvedScore > originalScore + this.config.improvementThreshold;

    return {
      improved: actuallyImproved,
      originalScore,
      improvedScore: actuallyImproved ? improvedScore : originalScore,
      response: actuallyImproved ? improvement.finalResponse : response,
      suggestions: originalCritique.improvementSuggestions
    };
  }

  /**
   * Generate learning report
   */
  generateReport(periodDays: number = 7): LearningReport {
    const now = Date.now();
    const periodStart = now - (periodDays * 24 * 60 * 60 * 1000);

    // Get feedback stats
    const feedbackStats = feedbackCollector.getStats();
    const critiqueStats = selfCritique.getStats();
    const rewardStats = rewardModel.getStats();

    // Filter signals by period
    const periodSignals = this.learningSignals.filter(s => s.timestamp >= periodStart);

    // Calculate metrics
    const feedbackSignals = periodSignals.filter(s => s.type === 'feedback');
    const critiqueSignals = periodSignals.filter(s => s.type === 'critique');

    const positiveSignals = periodSignals.filter(s => s.impact === 'positive').length;
    const totalSignals = periodSignals.length;
    const improvementRate = totalSignals > 0 ? positiveSignals / totalSignals : 0;

    // Generate insights
    const insights: string[] = [];
    const recommendations: string[] = [];

    if (feedbackStats.averageRating < 0.6) {
      insights.push('Average feedback rating is below target');
      recommendations.push('Focus on improving response helpfulness');
    }

    if (critiqueStats.averageScore < 0.7) {
      insights.push('Average critique score indicates room for improvement');
      recommendations.push(`Focus on: ${critiqueStats.commonWeaknesses.slice(0, 2).join(', ')}`);
    }

    if (rewardStats.latestMetrics?.accuracy && rewardStats.latestMetrics.accuracy > 0.8) {
      insights.push('Reward model is performing well');
    } else {
      recommendations.push('Consider collecting more diverse feedback data');
    }

    if (improvementRate > 0.6) {
      insights.push('System is showing positive improvement trends');
    }

    return {
      timestamp: now,
      period: {
        start: periodStart,
        end: now
      },
      metrics: {
        totalFeedback: feedbackStats.totalFeedback,
        totalCritiques: critiqueStats.totalCritiques,
        averageReward: feedbackStats.averageRating,
        averageCritiqueScore: critiqueStats.averageScore,
        rewardModelAccuracy: rewardStats.latestMetrics?.accuracy || 0,
        improvementRate
      },
      insights,
      recommendations,
      topStrengths: critiqueStats.commonWeaknesses.length > 0 ? [] : ['General quality'],
      topWeaknesses: critiqueStats.commonWeaknesses,
      trainingHistory: [] // Would track actual training history
    };
  }

  /**
   * Get learning statistics
   */
  getStats(): {
    config: LearningConfig;
    activeSessions: number;
    totalSignals: number;
    recentSignalsByType: Record<string, number>;
    lastTrainingTime: number;
    trainingInProgress: boolean;
    feedbackStats: ReturnType<typeof feedbackCollector.getStats>;
    rewardStats: ReturnType<typeof rewardModel.getStats>;
    critiqueStats: ReturnType<typeof selfCritique.getStats>;
  } {
    const recentSignals = this.learningSignals.slice(-100);
    const signalsByType: Record<string, number> = {};

    for (const signal of recentSignals) {
      signalsByType[signal.type] = (signalsByType[signal.type] || 0) + 1;
    }

    return {
      config: { ...this.config },
      activeSessions: this.sessions.size,
      totalSignals: this.learningSignals.length,
      recentSignalsByType: signalsByType,
      lastTrainingTime: this.lastTrainingTime,
      trainingInProgress: this.trainingInProgress,
      feedbackStats: feedbackCollector.getStats(),
      rewardStats: rewardModel.getStats(),
      critiqueStats: selfCritique.getStats()
    };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<LearningConfig>): void {
    this.config = { ...this.config, ...updates };

    // Restart auto-training if needed
    if (updates.autoTrain !== undefined) {
      if (this.trainingSchedule) {
        clearInterval(this.trainingSchedule);
        this.trainingSchedule = null;
      }

      if (this.config.autoTrain) {
        this.startAutoTraining();
      }
    }

    this.emit('config:updated', this.config);
  }

  /**
   * Shutdown the learning system
   */
  async shutdown(): Promise<void> {
    console.log('[ContinuousLearner] Shutting down...');

    if (this.trainingSchedule) {
      clearInterval(this.trainingSchedule);
    }

    // End all active sessions
    for (const sessionId of this.sessions.keys()) {
      this.endSession(sessionId);
    }

    console.log('[ContinuousLearner] Shutdown complete');
  }
}

// Export singleton instance
export const continuousLearner = new ContinuousLearner();
