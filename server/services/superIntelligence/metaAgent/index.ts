/**
 * Meta-Agent Module
 *
 * Provides the supervision and orchestration layer for multi-agent
 * coordination in the super-intelligence system.
 */

// Re-export all components
export * from './AgentRegistry';
export * from './TaskOrchestrator';
export * from './ConflictResolver';
export * from './MetaSupervisor';

// Import singleton instances
import { agentRegistry } from './AgentRegistry';
import { taskOrchestrator } from './TaskOrchestrator';
import { conflictResolver } from './ConflictResolver';
import { metaSupervisor } from './MetaSupervisor';

// Export singleton instances
export {
  agentRegistry,
  taskOrchestrator,
  conflictResolver,
  metaSupervisor
};

/**
 * Initialize the complete meta-agent system
 */
export async function initializeMetaAgentSystem(): Promise<void> {
  console.log('[MetaAgent] Initializing meta-agent system...');

  try {
    // Initialize meta-supervisor (which initializes other components)
    await metaSupervisor.initialize();

    console.log('[MetaAgent] Meta-agent system initialized successfully');
    console.log('[MetaAgent] Components ready:');
    console.log('[MetaAgent] - AgentRegistry: ready');
    console.log('[MetaAgent] - TaskOrchestrator: ready');
    console.log('[MetaAgent] - ConflictResolver: ready');
    console.log('[MetaAgent] - MetaSupervisor: ready');

    // Log initial stats
    const stats = metaSupervisor.getStats();
    console.log(`[MetaAgent] Mode: ${stats.mode}`);
    console.log(`[MetaAgent] Health: ${stats.healthReport.overallHealth} (${stats.healthReport.healthScore.toFixed(1)}%)`);

  } catch (error) {
    console.error('[MetaAgent] Failed to initialize meta-agent system:', error);
    throw error;
  }
}

/**
 * Shutdown the complete meta-agent system
 */
export async function shutdownMetaAgentSystem(): Promise<void> {
  console.log('[MetaAgent] Shutting down meta-agent system...');

  try {
    await metaSupervisor.shutdown();
    console.log('[MetaAgent] Meta-agent system shutdown complete');
  } catch (error) {
    console.error('[MetaAgent] Error during shutdown:', error);
    throw error;
  }
}
