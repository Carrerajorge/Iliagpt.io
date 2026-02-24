/**
 * Super Intelligence Module
 *
 * Unified super-intelligence layer integrating:
 * - Phase 1: Audit System - Performance monitoring and analysis
 * - Phase 2: User Understanding - Intent, emotion, and profile detection
 * - Phase 3: Cognitive Architecture - Reasoning, planning, and memory
 * - Phase 4: Meta-Agent System - Multi-agent orchestration and supervision
 * - Phase 5: Learning System - RLHF, RLAIF, and continuous improvement
 */

// Re-export all modules
export * from './audit';
export * from './understanding';
export * from './cognitive';
export * from './metaAgent';
export * from './learning';

// Import initialization functions
import { initializeAuditSystem } from './audit';
import { initializeUnderstandingSystem } from './understanding';
import { initializeCognitiveSystem } from './cognitive';
import { initializeMetaAgentSystem } from './metaAgent';
import { initializeLearningSystem } from './learning';

// Import key components for unified access
import { performanceAuditor, latencyAnalyzer, tokenTracker, queryAnalyzer } from './audit';
import { intentDetector, emotionDetector, userProfileManager, longContextMemory } from './understanding';
import { cognitiveCore, reasoningEngine, planningEngine, memoryHierarchy } from './cognitive';
import { metaSupervisor, agentRegistry, taskOrchestrator, conflictResolver } from './metaAgent';
import { continuousLearner, feedbackCollector, rewardModel, selfCritique } from './learning';

// Export unified access to all key components
export const superIntelligence = {
  // Audit
  audit: {
    performance: performanceAuditor,
    latency: latencyAnalyzer,
    tokens: tokenTracker,
    queries: queryAnalyzer
  },

  // Understanding
  understanding: {
    intent: intentDetector,
    emotion: emotionDetector,
    profile: userProfileManager,
    context: longContextMemory
  },

  // Cognitive
  cognitive: {
    core: cognitiveCore,
    reasoning: reasoningEngine,
    planning: planningEngine,
    memory: memoryHierarchy
  },

  // Meta-Agent
  metaAgent: {
    supervisor: metaSupervisor,
    registry: agentRegistry,
    orchestrator: taskOrchestrator,
    conflicts: conflictResolver
  },

  // Learning
  learning: {
    continuous: continuousLearner,
    feedback: feedbackCollector,
    reward: rewardModel,
    critique: selfCritique
  }
};

// System status type
export interface SuperIntelligenceStatus {
  initialized: boolean;
  timestamp: number;
  modules: {
    audit: boolean;
    understanding: boolean;
    cognitive: boolean;
    metaAgent: boolean;
    learning: boolean;
  };
  stats: {
    totalAgents: number;
    activeTasks: number;
    totalFeedback: number;
    healthScore: number;
  };
}

// Track initialization status
let isInitialized = false;

/**
 * Initialize the complete super-intelligence system
 */
export async function initializeSuperIntelligence(): Promise<SuperIntelligenceStatus> {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        SUPER INTELLIGENCE SYSTEM INITIALIZATION               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const moduleStatus = {
    audit: false,
    understanding: false,
    cognitive: false,
    metaAgent: false,
    learning: false
  };

  try {
    // Phase 1: Initialize Audit System
    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log('│ Phase 1: Audit System                                        │');
    console.log('└─────────────────────────────────────────────────────────────┘');
    await initializeAuditSystem();
    moduleStatus.audit = true;
    console.log('✓ Audit System initialized\n');

    // Phase 2: Initialize Understanding System
    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log('│ Phase 2: User Understanding System                           │');
    console.log('└─────────────────────────────────────────────────────────────┘');
    await initializeUnderstandingSystem();
    moduleStatus.understanding = true;
    console.log('✓ Understanding System initialized\n');

    // Phase 3: Initialize Cognitive System
    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log('│ Phase 3: Cognitive Architecture                              │');
    console.log('└─────────────────────────────────────────────────────────────┘');
    await initializeCognitiveSystem();
    moduleStatus.cognitive = true;
    console.log('✓ Cognitive System initialized\n');

    // Phase 4: Initialize Meta-Agent System
    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log('│ Phase 4: Meta-Agent Supervisor                               │');
    console.log('└─────────────────────────────────────────────────────────────┘');
    await initializeMetaAgentSystem();
    moduleStatus.metaAgent = true;
    console.log('✓ Meta-Agent System initialized\n');

    // Phase 5: Initialize Learning System
    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log('│ Phase 5: Continuous Learning System                          │');
    console.log('└─────────────────────────────────────────────────────────────┘');
    await initializeLearningSystem();
    moduleStatus.learning = true;
    console.log('✓ Learning System initialized\n');

    isInitialized = true;

    // Get combined stats
    const agentStats = agentRegistry.getStats();
    const taskStats = taskOrchestrator.getStats();
    const feedbackStats = feedbackCollector.getStats();
    const healthReport = metaSupervisor.generateHealthReport();

    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║        SUPER INTELLIGENCE SYSTEM READY                       ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║ Agents Online:        ${String(agentStats.totalAgents).padStart(5)}                                ║`);
    console.log(`║ Active Tasks:         ${String(taskStats.activeTasks).padStart(5)}                                ║`);
    console.log(`║ Health Score:         ${String(healthReport.healthScore.toFixed(1) + '%').padStart(5)}                               ║`);
    console.log(`║ System Status:        ${healthReport.overallHealth.toUpperCase().padEnd(10)}                          ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');

    return {
      initialized: true,
      timestamp: Date.now(),
      modules: moduleStatus,
      stats: {
        totalAgents: agentStats.totalAgents,
        activeTasks: taskStats.activeTasks,
        totalFeedback: feedbackStats.totalFeedback,
        healthScore: healthReport.healthScore
      }
    };

  } catch (error) {
    console.error('');
    console.error('╔══════════════════════════════════════════════════════════════╗');
    console.error('║        SUPER INTELLIGENCE INITIALIZATION FAILED              ║');
    console.error('╚══════════════════════════════════════════════════════════════╝');
    console.error('Error:', error);

    return {
      initialized: false,
      timestamp: Date.now(),
      modules: moduleStatus,
      stats: {
        totalAgents: 0,
        activeTasks: 0,
        totalFeedback: 0,
        healthScore: 0
      }
    };
  }
}

/**
 * Shutdown the super-intelligence system
 */
export async function shutdownSuperIntelligence(): Promise<void> {
  console.log('[SuperIntelligence] Shutting down...');

  try {
    // Shutdown in reverse order
    await continuousLearner.shutdown();
    await metaSupervisor.shutdown();
    // Other components don't need explicit shutdown

    isInitialized = false;
    console.log('[SuperIntelligence] Shutdown complete');
  } catch (error) {
    console.error('[SuperIntelligence] Error during shutdown:', error);
    throw error;
  }
}

/**
 * Get system status
 */
export function getSuperIntelligenceStatus(): SuperIntelligenceStatus {
  if (!isInitialized) {
    return {
      initialized: false,
      timestamp: Date.now(),
      modules: {
        audit: false,
        understanding: false,
        cognitive: false,
        metaAgent: false,
        learning: false
      },
      stats: {
        totalAgents: 0,
        activeTasks: 0,
        totalFeedback: 0,
        healthScore: 0
      }
    };
  }

  const agentStats = agentRegistry.getStats();
  const taskStats = taskOrchestrator.getStats();
  const feedbackStats = feedbackCollector.getStats();
  const healthReport = metaSupervisor.generateHealthReport();

  return {
    initialized: true,
    timestamp: Date.now(),
    modules: {
      audit: true,
      understanding: true,
      cognitive: true,
      metaAgent: true,
      learning: true
    },
    stats: {
      totalAgents: agentStats.totalAgents,
      activeTasks: taskStats.activeTasks,
      totalFeedback: feedbackStats.totalFeedback,
      healthScore: healthReport.healthScore
    }
  };
}

/**
 * Quick access to process a user message through the full intelligence stack
 */
export async function processWithIntelligence(
  userId: string,
  sessionId: string,
  query: string,
  options: {
    detectIntent?: boolean;
    detectEmotion?: boolean;
    useReasoning?: boolean;
    collectFeedback?: boolean;
  } = {}
): Promise<{
  intent?: any;
  emotion?: any;
  cognitive?: any;
  suggestions: string[];
}> {
  const result: any = {
    suggestions: []
  };

  // Detect intent
  if (options.detectIntent !== false) {
    result.intent = await intentDetector.detectIntent(query, { userId });
  }

  // Detect emotion
  if (options.detectEmotion !== false) {
    result.emotion = await emotionDetector.analyzeEmotion(query);
  }

  // Process through cognitive system
  if (options.useReasoning !== false) {
    result.cognitive = await cognitiveCore.process({
      userId,
      sessionId,
      query,
      intent: result.intent?.primaryIntent,
      emotionalState: result.emotion ? {
        primary: result.emotion.primaryEmotion,
        intensity: result.emotion.intensity
      } : undefined
    });

    if (result.cognitive.response.followUp) {
      result.suggestions.push(...result.cognitive.response.followUp);
    }
  }

  return result;
}
