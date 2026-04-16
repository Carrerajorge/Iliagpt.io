/**
 * Learning Module
 *
 * Continuous learning system with RLHF, RLAIF, and self-critique capabilities
 * for the super-intelligence layer.
 */

// Re-export all components
export * from './FeedbackCollector';
export * from './RewardModel';
export * from './SelfCritique';
export * from './ContinuousLearner';

// Import singleton instances
import { feedbackCollector } from './FeedbackCollector';
import { rewardModel } from './RewardModel';
import { selfCritique } from './SelfCritique';
import { continuousLearner } from './ContinuousLearner';

// Export singleton instances
export {
  feedbackCollector,
  rewardModel,
  selfCritique,
  continuousLearner
};

/**
 * Initialize the complete learning system
 */
export async function initializeLearningSystem(): Promise<void> {
  console.log('[LearningSystem] Initializing continuous learning system...');

  try {
    // Initialize the continuous learner (which initializes other components)
    await continuousLearner.initialize();

    console.log('[LearningSystem] Learning system initialized successfully');
    console.log('[LearningSystem] Components ready:');
    console.log('[LearningSystem] - FeedbackCollector: ready');
    console.log('[LearningSystem] - RewardModel: ready');
    console.log('[LearningSystem] - SelfCritique: ready');
    console.log('[LearningSystem] - ContinuousLearner: ready');

    // Log initial stats
    const stats = continuousLearner.getStats();
    console.log(`[LearningSystem] Feedback collected: ${stats.feedbackStats.totalFeedback}`);
    console.log(`[LearningSystem] Training examples: ${stats.rewardStats.trainingExamples}`);
    console.log(`[LearningSystem] Auto-training: ${stats.config.autoTrain ? 'enabled' : 'disabled'}`);

  } catch (error) {
    console.error('[LearningSystem] Failed to initialize learning system:', error);
    throw error;
  }
}

/**
 * Shutdown the complete learning system
 */
export async function shutdownLearningSystem(): Promise<void> {
  console.log('[LearningSystem] Shutting down learning system...');

  try {
    await continuousLearner.shutdown();
    console.log('[LearningSystem] Learning system shutdown complete');
  } catch (error) {
    console.error('[LearningSystem] Error during shutdown:', error);
    throw error;
  }
}
