/**
 * Conflict Resolver - Handles conflicts between multiple agents
 *
 * Manages resource conflicts, output disagreements, and priority disputes
 * between agents in the super-intelligence system.
 */

import { EventEmitter } from 'events';
import { AgentInstance, AgentPriority } from './AgentRegistry';

// Conflict types
export type ConflictType =
  | 'resource'        // Two agents need the same resource
  | 'output'          // Agents produce conflicting outputs
  | 'priority'        // Conflicting task priorities
  | 'scheduling'      // Timing conflicts
  | 'dependency'      // Circular or conflicting dependencies
  | 'semantic'        // Different interpretations of same input
  | 'consensus';      // Agents disagree on approach

// Conflict severity
export type ConflictSeverity = 'low' | 'medium' | 'high' | 'critical';

// Conflict definition
export interface Conflict {
  id: string;
  type: ConflictType;
  severity: ConflictSeverity;
  description: string;
  parties: Array<{
    agentId: string;
    agentName: string;
    position: any;
    confidence: number;
  }>;
  context: {
    taskId?: string;
    resourceId?: string;
    input?: any;
    timestamp: number;
  };
  status: 'pending' | 'resolving' | 'resolved' | 'escalated';
  resolution?: ConflictResolution;
  createdAt: number;
  resolvedAt?: number;
}

// Conflict resolution
export interface ConflictResolution {
  strategy: ResolutionStrategy;
  winner?: string; // Agent ID
  mergedOutput?: any;
  explanation: string;
  confidence: number;
  votingResults?: VotingResult;
}

// Resolution strategies
export type ResolutionStrategy =
  | 'priority'           // Higher priority agent wins
  | 'confidence'         // Higher confidence agent wins
  | 'voting'             // Democratic voting
  | 'weighted_voting'    // Voting weighted by agent performance
  | 'merge'              // Merge outputs from all agents
  | 'hierarchical'       // Escalate to supervisor
  | 'timeout'            // First to complete wins
  | 'random'             // Random selection
  | 'round_robin'        // Alternate between agents
  | 'consensus'          // All must agree
  | 'human_escalation';  // Escalate to human

// Voting result
export interface VotingResult {
  totalVotes: number;
  votesByOption: Record<string, number>;
  winner: string;
  margin: number;
}

// Resolution policy
export interface ResolutionPolicy {
  conflictType: ConflictType;
  preferredStrategy: ResolutionStrategy;
  fallbackStrategy: ResolutionStrategy;
  maxResolutionTimeMs: number;
  autoEscalateOnFailure: boolean;
  requiredConsensusThreshold?: number; // For consensus strategy
}

/**
 * ConflictResolver - Resolves conflicts between agents
 */
export class ConflictResolver extends EventEmitter {
  private activeConflicts: Map<string, Conflict>;
  private resolvedConflicts: Map<string, Conflict>;
  private policies: Map<ConflictType, ResolutionPolicy>;
  private resolutionHistory: Array<{
    conflictId: string;
    strategy: ResolutionStrategy;
    success: boolean;
    duration: number;
    timestamp: number;
  }>;

  constructor() {
    super();
    this.activeConflicts = new Map();
    this.resolvedConflicts = new Map();
    this.policies = new Map();
    this.resolutionHistory = [];

    // Set default policies
    this.initializeDefaultPolicies();
  }

  /**
   * Initialize default resolution policies
   */
  private initializeDefaultPolicies(): void {
    this.policies.set('resource', {
      conflictType: 'resource',
      preferredStrategy: 'priority',
      fallbackStrategy: 'timeout',
      maxResolutionTimeMs: 5000,
      autoEscalateOnFailure: true
    });

    this.policies.set('output', {
      conflictType: 'output',
      preferredStrategy: 'weighted_voting',
      fallbackStrategy: 'confidence',
      maxResolutionTimeMs: 10000,
      autoEscalateOnFailure: false
    });

    this.policies.set('priority', {
      conflictType: 'priority',
      preferredStrategy: 'hierarchical',
      fallbackStrategy: 'priority',
      maxResolutionTimeMs: 3000,
      autoEscalateOnFailure: true
    });

    this.policies.set('scheduling', {
      conflictType: 'scheduling',
      preferredStrategy: 'priority',
      fallbackStrategy: 'round_robin',
      maxResolutionTimeMs: 2000,
      autoEscalateOnFailure: false
    });

    this.policies.set('dependency', {
      conflictType: 'dependency',
      preferredStrategy: 'hierarchical',
      fallbackStrategy: 'human_escalation',
      maxResolutionTimeMs: 15000,
      autoEscalateOnFailure: true
    });

    this.policies.set('semantic', {
      conflictType: 'semantic',
      preferredStrategy: 'merge',
      fallbackStrategy: 'confidence',
      maxResolutionTimeMs: 10000,
      autoEscalateOnFailure: false
    });

    this.policies.set('consensus', {
      conflictType: 'consensus',
      preferredStrategy: 'voting',
      fallbackStrategy: 'weighted_voting',
      maxResolutionTimeMs: 20000,
      autoEscalateOnFailure: false,
      requiredConsensusThreshold: 0.6
    });
  }

  /**
   * Report a new conflict
   */
  async reportConflict(
    type: ConflictType,
    description: string,
    parties: Conflict['parties'],
    context: Partial<Conflict['context']> = {}
  ): Promise<string> {
    const conflictId = `conflict_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Determine severity based on type and parties
    const severity = this.assessSeverity(type, parties);

    const conflict: Conflict = {
      id: conflictId,
      type,
      severity,
      description,
      parties,
      context: {
        ...context,
        timestamp: Date.now()
      },
      status: 'pending',
      createdAt: Date.now()
    };

    this.activeConflicts.set(conflictId, conflict);

    this.emit('conflict:reported', { conflictId, conflict });
    console.log(`[ConflictResolver] Conflict reported: ${conflictId} (${type})`);

    // Auto-resolve if possible
    this.attemptResolution(conflictId);

    return conflictId;
  }

  /**
   * Assess conflict severity
   */
  private assessSeverity(type: ConflictType, parties: Conflict['parties']): ConflictSeverity {
    // Critical if dependency or consensus conflicts
    if (type === 'dependency') return 'critical';

    // High if many parties or high-priority agents involved
    if (parties.length > 3) return 'high';

    // Check if any critical agents involved
    const hasCriticalParty = parties.some(p => p.confidence > 0.9);
    if (hasCriticalParty && type === 'output') return 'high';

    // Default severities by type
    const defaultSeverities: Record<ConflictType, ConflictSeverity> = {
      resource: 'medium',
      output: 'medium',
      priority: 'low',
      scheduling: 'low',
      dependency: 'critical',
      semantic: 'medium',
      consensus: 'high'
    };

    return defaultSeverities[type] || 'medium';
  }

  /**
   * Attempt to resolve a conflict
   */
  async attemptResolution(conflictId: string): Promise<ConflictResolution | null> {
    const conflict = this.activeConflicts.get(conflictId);
    if (!conflict) {
      throw new Error(`Conflict ${conflictId} not found`);
    }

    if (conflict.status === 'resolved') {
      return conflict.resolution!;
    }

    conflict.status = 'resolving';
    const startTime = Date.now();

    const policy = this.policies.get(conflict.type)!;

    try {
      // Try preferred strategy
      let resolution = await this.executeStrategy(
        policy.preferredStrategy,
        conflict,
        policy.maxResolutionTimeMs
      );

      // Fall back if needed
      if (!resolution && policy.fallbackStrategy !== policy.preferredStrategy) {
        console.log(`[ConflictResolver] Falling back to ${policy.fallbackStrategy} for ${conflictId}`);
        resolution = await this.executeStrategy(
          policy.fallbackStrategy,
          conflict,
          policy.maxResolutionTimeMs
        );
      }

      if (resolution) {
        conflict.resolution = resolution;
        conflict.status = 'resolved';
        conflict.resolvedAt = Date.now();

        this.activeConflicts.delete(conflictId);
        this.resolvedConflicts.set(conflictId, conflict);

        this.resolutionHistory.push({
          conflictId,
          strategy: resolution.strategy,
          success: true,
          duration: Date.now() - startTime,
          timestamp: Date.now()
        });

        this.emit('conflict:resolved', { conflictId, resolution });
        console.log(`[ConflictResolver] Conflict resolved: ${conflictId} using ${resolution.strategy}`);

        return resolution;
      }

      // Auto-escalate if configured
      if (policy.autoEscalateOnFailure) {
        conflict.status = 'escalated';
        this.emit('conflict:escalated', { conflictId, conflict });
        console.log(`[ConflictResolver] Conflict escalated: ${conflictId}`);
      }

      return null;

    } catch (error: any) {
      console.error(`[ConflictResolver] Resolution error for ${conflictId}:`, error);

      this.resolutionHistory.push({
        conflictId,
        strategy: policy.preferredStrategy,
        success: false,
        duration: Date.now() - startTime,
        timestamp: Date.now()
      });

      if (policy.autoEscalateOnFailure) {
        conflict.status = 'escalated';
        this.emit('conflict:escalated', { conflictId, conflict, error: error.message });
      }

      return null;
    }
  }

  /**
   * Execute a resolution strategy
   */
  private async executeStrategy(
    strategy: ResolutionStrategy,
    conflict: Conflict,
    timeoutMs: number
  ): Promise<ConflictResolution | null> {
    switch (strategy) {
      case 'priority':
        return this.resolvByPriority(conflict);

      case 'confidence':
        return this.resolveByConfidence(conflict);

      case 'voting':
        return this.resolveByVoting(conflict, false);

      case 'weighted_voting':
        return this.resolveByVoting(conflict, true);

      case 'merge':
        return this.resolveByMerge(conflict);

      case 'hierarchical':
        return this.resolveByHierarchy(conflict);

      case 'timeout':
        return this.resolveByTimeout(conflict, timeoutMs);

      case 'random':
        return this.resolveByRandom(conflict);

      case 'round_robin':
        return this.resolveByRoundRobin(conflict);

      case 'consensus':
        return this.resolveByConsensus(conflict);

      case 'human_escalation':
        return null; // Requires human intervention

      default:
        return null;
    }
  }

  /**
   * Resolve by agent priority
   */
  private resolvByPriority(conflict: Conflict): ConflictResolution {
    const priorityOrder: Record<string, number> = {
      critical: 5,
      high: 4,
      normal: 3,
      low: 2,
      background: 1
    };

    // Find highest priority party
    let winner = conflict.parties[0];
    let highestPriority = 0;

    for (const party of conflict.parties) {
      // Use confidence as a proxy for priority if not available
      const priority = party.confidence;
      if (priority > highestPriority) {
        highestPriority = priority;
        winner = party;
      }
    }

    return {
      strategy: 'priority',
      winner: winner.agentId,
      explanation: `Agent ${winner.agentName} selected based on highest priority/confidence`,
      confidence: winner.confidence
    };
  }

  /**
   * Resolve by confidence level
   */
  private resolveByConfidence(conflict: Conflict): ConflictResolution {
    let winner = conflict.parties[0];

    for (const party of conflict.parties) {
      if (party.confidence > winner.confidence) {
        winner = party;
      }
    }

    return {
      strategy: 'confidence',
      winner: winner.agentId,
      explanation: `Agent ${winner.agentName} selected with highest confidence (${(winner.confidence * 100).toFixed(1)}%)`,
      confidence: winner.confidence
    };
  }

  /**
   * Resolve by voting
   */
  private resolveByVoting(conflict: Conflict, weighted: boolean): ConflictResolution {
    const votes: Record<string, number> = {};

    for (const party of conflict.parties) {
      const voteWeight = weighted ? party.confidence : 1;
      const voteKey = JSON.stringify(party.position);

      votes[voteKey] = (votes[voteKey] || 0) + voteWeight;
    }

    // Find winner
    let winningPosition = '';
    let maxVotes = 0;
    let totalVotes = 0;

    for (const [position, count] of Object.entries(votes)) {
      totalVotes += count;
      if (count > maxVotes) {
        maxVotes = count;
        winningPosition = position;
      }
    }

    // Find the agent with the winning position
    const winner = conflict.parties.find(p =>
      JSON.stringify(p.position) === winningPosition
    );

    const votingResults: VotingResult = {
      totalVotes,
      votesByOption: votes,
      winner: winningPosition,
      margin: maxVotes / totalVotes
    };

    return {
      strategy: weighted ? 'weighted_voting' : 'voting',
      winner: winner?.agentId,
      mergedOutput: JSON.parse(winningPosition),
      explanation: `Position selected by ${weighted ? 'weighted ' : ''}voting with ${(votingResults.margin * 100).toFixed(1)}% support`,
      confidence: votingResults.margin,
      votingResults
    };
  }

  /**
   * Resolve by merging outputs
   */
  private resolveByMerge(conflict: Conflict): ConflictResolution {
    // Attempt to merge all positions
    const mergedOutput: any = {};

    for (const party of conflict.parties) {
      if (typeof party.position === 'object' && party.position !== null) {
        // Weight by confidence
        for (const [key, value] of Object.entries(party.position)) {
          if (mergedOutput[key] === undefined) {
            mergedOutput[key] = value;
          } else if (typeof value === 'number' && typeof mergedOutput[key] === 'number') {
            // Weighted average for numbers
            mergedOutput[key] = (mergedOutput[key] + value * party.confidence) / (1 + party.confidence);
          } else if (Array.isArray(value) && Array.isArray(mergedOutput[key])) {
            // Merge arrays
            mergedOutput[key] = [...new Set([...mergedOutput[key], ...value])];
          }
          // For other types, keep first value
        }
      }
    }

    const avgConfidence = conflict.parties.reduce((sum, p) => sum + p.confidence, 0) / conflict.parties.length;

    return {
      strategy: 'merge',
      mergedOutput,
      explanation: `Merged outputs from ${conflict.parties.length} agents`,
      confidence: avgConfidence
    };
  }

  /**
   * Resolve by hierarchy (escalate to supervisor)
   */
  private resolveByHierarchy(conflict: Conflict): ConflictResolution {
    // In hierarchical resolution, we defer to the most authoritative agent
    // This is similar to priority but considers structural hierarchy

    // For now, use confidence as authority proxy
    const authority = conflict.parties.reduce((max, p) =>
      p.confidence > max.confidence ? p : max
    , conflict.parties[0]);

    return {
      strategy: 'hierarchical',
      winner: authority.agentId,
      explanation: `Escalated to hierarchical authority: ${authority.agentName}`,
      confidence: authority.confidence
    };
  }

  /**
   * Resolve by timeout (first completes wins)
   */
  private async resolveByTimeout(conflict: Conflict, timeoutMs: number): Promise<ConflictResolution> {
    // Since all parties have already completed, pick by timestamp or confidence
    return this.resolveByConfidence(conflict);
  }

  /**
   * Resolve randomly
   */
  private resolveByRandom(conflict: Conflict): ConflictResolution {
    const randomIndex = Math.floor(Math.random() * conflict.parties.length);
    const winner = conflict.parties[randomIndex];

    return {
      strategy: 'random',
      winner: winner.agentId,
      explanation: `Agent ${winner.agentName} selected randomly`,
      confidence: winner.confidence
    };
  }

  /**
   * Resolve by round robin
   */
  private resolveByRoundRobin(conflict: Conflict): ConflictResolution {
    // Get count of how many times each agent has won
    const winCounts: Record<string, number> = {};

    for (const resolved of this.resolvedConflicts.values()) {
      if (resolved.resolution?.winner) {
        winCounts[resolved.resolution.winner] = (winCounts[resolved.resolution.winner] || 0) + 1;
      }
    }

    // Pick the party with fewest wins
    let winner = conflict.parties[0];
    let minWins = Infinity;

    for (const party of conflict.parties) {
      const wins = winCounts[party.agentId] || 0;
      if (wins < minWins) {
        minWins = wins;
        winner = party;
      }
    }

    return {
      strategy: 'round_robin',
      winner: winner.agentId,
      explanation: `Agent ${winner.agentName} selected by round robin (fewest previous wins)`,
      confidence: winner.confidence
    };
  }

  /**
   * Resolve by consensus
   */
  private resolveByConsensus(conflict: Conflict): ConflictResolution | null {
    const policy = this.policies.get(conflict.type);
    const threshold = policy?.requiredConsensusThreshold || 0.6;

    // Check if any position has consensus
    const positionCounts: Record<string, { count: number; totalConfidence: number }> = {};

    for (const party of conflict.parties) {
      const key = JSON.stringify(party.position);
      if (!positionCounts[key]) {
        positionCounts[key] = { count: 0, totalConfidence: 0 };
      }
      positionCounts[key].count++;
      positionCounts[key].totalConfidence += party.confidence;
    }

    // Find if any position meets threshold
    for (const [position, data] of Object.entries(positionCounts)) {
      const ratio = data.count / conflict.parties.length;
      if (ratio >= threshold) {
        const winner = conflict.parties.find(p => JSON.stringify(p.position) === position);
        return {
          strategy: 'consensus',
          winner: winner?.agentId,
          mergedOutput: JSON.parse(position),
          explanation: `Consensus reached with ${(ratio * 100).toFixed(1)}% agreement`,
          confidence: data.totalConfidence / data.count
        };
      }
    }

    // No consensus reached
    return null;
  }

  /**
   * Set resolution policy for a conflict type
   */
  setPolicy(policy: ResolutionPolicy): void {
    this.policies.set(policy.conflictType, policy);
    console.log(`[ConflictResolver] Policy updated for ${policy.conflictType}`);
  }

  /**
   * Get active conflicts
   */
  getActiveConflicts(): Conflict[] {
    return Array.from(this.activeConflicts.values());
  }

  /**
   * Get conflict by ID
   */
  getConflict(conflictId: string): Conflict | undefined {
    return this.activeConflicts.get(conflictId) || this.resolvedConflicts.get(conflictId);
  }

  /**
   * Get resolution statistics
   */
  getStats(): {
    activeConflicts: number;
    resolvedConflicts: number;
    resolutionsByStrategy: Record<string, number>;
    successRate: number;
    averageResolutionTime: number;
    conflictsByType: Record<ConflictType, number>;
  } {
    const resolutionsByStrategy: Record<string, number> = {};
    const conflictsByType: Record<ConflictType, number> = {} as any;
    let successCount = 0;
    let totalResolutionTime = 0;

    for (const record of this.resolutionHistory) {
      resolutionsByStrategy[record.strategy] = (resolutionsByStrategy[record.strategy] || 0) + 1;
      if (record.success) successCount++;
      totalResolutionTime += record.duration;
    }

    for (const conflict of [...this.activeConflicts.values(), ...this.resolvedConflicts.values()]) {
      conflictsByType[conflict.type] = (conflictsByType[conflict.type] || 0) + 1;
    }

    return {
      activeConflicts: this.activeConflicts.size,
      resolvedConflicts: this.resolvedConflicts.size,
      resolutionsByStrategy,
      successRate: this.resolutionHistory.length > 0
        ? successCount / this.resolutionHistory.length
        : 1,
      averageResolutionTime: this.resolutionHistory.length > 0
        ? totalResolutionTime / this.resolutionHistory.length
        : 0,
      conflictsByType
    };
  }
}

// Export singleton instance
export const conflictResolver = new ConflictResolver();
