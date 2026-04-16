/**
 * Meta Supervisor - High-level agent orchestration and supervision
 *
 * The meta-supervisor oversees all agents, coordinates complex multi-agent
 * tasks, handles escalations, and ensures system-wide coherence.
 */

import { EventEmitter } from 'events';
import { agentRegistry, AgentInstance, AgentCapability, AgentTask, AgentTaskResult, AgentPriority } from './AgentRegistry';
import { taskOrchestrator, OrchestratedTask, OrchestrationResult } from './TaskOrchestrator';
import { conflictResolver, Conflict, ConflictResolution } from './ConflictResolver';

// Supervision mode
export type SupervisionMode = 'active' | 'passive' | 'adaptive';

// Task complexity
export type TaskComplexity = 'trivial' | 'simple' | 'moderate' | 'complex' | 'very_complex';

// Supervision decision
export interface SupervisionDecision {
  id: string;
  type: 'task_assignment' | 'conflict_resolution' | 'resource_allocation' | 'quality_control' | 'escalation';
  description: string;
  action: any;
  rationale: string;
  confidence: number;
  timestamp: number;
  outcome?: 'success' | 'failure' | 'pending';
}

// Multi-agent task request
export interface MultiAgentTaskRequest {
  name: string;
  description: string;
  goal: string;
  input: any;
  context: {
    userId: string;
    sessionId: string;
    priority: AgentPriority;
    deadline?: number;
  };
  constraints?: {
    maxAgents?: number;
    maxDuration?: number;
    requiredCapabilities?: AgentCapability[];
    excludeAgents?: string[];
    preferredAgents?: string[];
  };
  qualityRequirements?: {
    minConfidence: number;
    requireConsensus: boolean;
    validateOutput: boolean;
  };
}

// Multi-agent task result
export interface MultiAgentTaskResult {
  success: boolean;
  output: any;
  agentsUsed: Array<{
    agentId: string;
    agentName: string;
    contribution: string;
    confidence: number;
  }>;
  qualityScore: number;
  conflictsResolved: number;
  totalDuration: number;
  decisions: SupervisionDecision[];
  metadata: Record<string, any>;
}

// System health report
export interface SystemHealthReport {
  timestamp: number;
  overallHealth: 'healthy' | 'degraded' | 'critical';
  healthScore: number;
  agentHealth: {
    totalAgents: number;
    healthyAgents: number;
    degradedAgents: number;
    failedAgents: number;
  };
  taskHealth: {
    activeTasks: number;
    queuedTasks: number;
    successRate: number;
    averageLatency: number;
  };
  conflictHealth: {
    activeConflicts: number;
    resolutionRate: number;
    escalatedConflicts: number;
  };
  recommendations: string[];
}

// Supervisor configuration
export interface SupervisorConfig {
  mode: SupervisionMode;
  maxConcurrentMultiAgentTasks: number;
  defaultTimeout: number;
  qualityThreshold: number;
  autoScaleAgents: boolean;
  conflictEscalationEnabled: boolean;
  learningEnabled: boolean;
}

/**
 * MetaSupervisor - Orchestrates the entire agent ecosystem
 */
export class MetaSupervisor extends EventEmitter {
  private config: SupervisorConfig;
  private activeMultiAgentTasks: Map<string, MultiAgentTaskRequest>;
  private decisions: SupervisionDecision[];
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private learningData: Array<{
    decision: SupervisionDecision;
    outcome: 'success' | 'failure';
    feedback?: any;
  }>;

  constructor(config?: Partial<SupervisorConfig>) {
    super();
    this.config = {
      mode: 'adaptive',
      maxConcurrentMultiAgentTasks: 10,
      defaultTimeout: 300000, // 5 minutes
      qualityThreshold: 0.7,
      autoScaleAgents: true,
      conflictEscalationEnabled: true,
      learningEnabled: true,
      ...config
    };
    this.activeMultiAgentTasks = new Map();
    this.decisions = [];
    this.learningData = [];
  }

  /**
   * Initialize the meta supervisor
   */
  async initialize(): Promise<void> {
    console.log('[MetaSupervisor] Initializing...');

    // Initialize sub-components
    await agentRegistry.initialize();
    await taskOrchestrator.initialize();

    // Set up event listeners
    this.setupEventListeners();

    // Start health monitoring
    this.startHealthMonitoring();

    console.log('[MetaSupervisor] Initialized in', this.config.mode, 'mode');
  }

  /**
   * Set up event listeners for sub-components
   */
  private setupEventListeners(): void {
    // Agent events
    agentRegistry.on('agent:registered', (data) => {
      this.recordDecision({
        type: 'resource_allocation',
        description: `Agent ${data.agentId} registered`,
        action: { agentId: data.agentId },
        rationale: 'New agent available for tasks',
        confidence: 1.0
      });
    });

    agentRegistry.on('agent:unhealthy', (data) => {
      this.handleUnhealthyAgent(data.agentId, data.health);
    });

    // Task events
    taskOrchestrator.on('task:failed', async (data) => {
      await this.handleTaskFailure(data.taskId, data.error);
    });

    // Conflict events
    conflictResolver.on('conflict:escalated', async (data) => {
      await this.handleEscalatedConflict(data.conflictId, data.conflict);
    });
  }

  /**
   * Execute a multi-agent task
   */
  async executeMultiAgentTask(request: MultiAgentTaskRequest): Promise<MultiAgentTaskResult> {
    const taskId = `multi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    const decisions: SupervisionDecision[] = [];

    console.log(`[MetaSupervisor] Starting multi-agent task: ${taskId} (${request.name})`);
    this.activeMultiAgentTasks.set(taskId, request);

    try {
      // Step 1: Analyze task complexity
      const complexity = this.analyzeTaskComplexity(request);

      decisions.push(this.recordDecision({
        type: 'task_assignment',
        description: `Analyzed task complexity: ${complexity}`,
        action: { complexity },
        rationale: 'Task complexity determines agent selection and coordination strategy',
        confidence: 0.9
      }));

      // Step 2: Select agents for the task
      const selectedAgents = await this.selectAgentsForTask(request, complexity);

      decisions.push(this.recordDecision({
        type: 'task_assignment',
        description: `Selected ${selectedAgents.length} agents for task`,
        action: { agents: selectedAgents.map(a => a.definition.id) },
        rationale: 'Agents selected based on capabilities and availability',
        confidence: 0.85
      }));

      if (selectedAgents.length === 0) {
        throw new Error('No suitable agents available for this task');
      }

      // Step 3: Decompose task if complex
      const subtasks = await this.decomposeTask(request, complexity, selectedAgents);

      // Step 4: Execute subtasks
      const results = await this.executeSubtasks(subtasks, selectedAgents, request);

      // Step 5: Aggregate and validate results
      const aggregatedResult = await this.aggregateResults(results, request);

      // Step 6: Quality check
      const qualityScore = this.assessQuality(aggregatedResult, request);

      if (qualityScore < (request.qualityRequirements?.minConfidence || this.config.qualityThreshold)) {
        decisions.push(this.recordDecision({
          type: 'quality_control',
          description: 'Quality below threshold, attempting improvement',
          action: { qualityScore, threshold: this.config.qualityThreshold },
          rationale: 'Output quality must meet requirements',
          confidence: 0.7
        }));

        // Attempt to improve quality
        const improvedResult = await this.improveQuality(aggregatedResult, results, request);
        if (improvedResult) {
          aggregatedResult.output = improvedResult;
        }
      }

      const totalDuration = Date.now() - startTime;

      const result: MultiAgentTaskResult = {
        success: true,
        output: aggregatedResult.output,
        agentsUsed: selectedAgents.map(a => ({
          agentId: a.definition.id,
          agentName: a.definition.name,
          contribution: 'task_execution',
          confidence: a.successRate
        })),
        qualityScore,
        conflictsResolved: aggregatedResult.conflictsResolved || 0,
        totalDuration,
        decisions,
        metadata: {
          taskId,
          complexity,
          subtasksCount: subtasks.length
        }
      };

      this.emit('multiAgentTask:completed', { taskId, result });
      console.log(`[MetaSupervisor] Multi-agent task completed: ${taskId} in ${totalDuration}ms`);

      return result;

    } catch (error: any) {
      console.error(`[MetaSupervisor] Multi-agent task failed: ${taskId}`, error);

      decisions.push(this.recordDecision({
        type: 'escalation',
        description: `Task failed: ${error.message}`,
        action: { error: error.message },
        rationale: 'Task execution encountered an error',
        confidence: 1.0,
        outcome: 'failure'
      }));

      return {
        success: false,
        output: null,
        agentsUsed: [],
        qualityScore: 0,
        conflictsResolved: 0,
        totalDuration: Date.now() - startTime,
        decisions,
        metadata: { taskId, error: error.message }
      };

    } finally {
      this.activeMultiAgentTasks.delete(taskId);
    }
  }

  /**
   * Analyze task complexity
   */
  private analyzeTaskComplexity(request: MultiAgentTaskRequest): TaskComplexity {
    let complexityScore = 0;

    // Factor 1: Required capabilities
    const capCount = request.constraints?.requiredCapabilities?.length || 0;
    complexityScore += capCount * 10;

    // Factor 2: Goal length and complexity
    const goalWords = request.goal.split(/\s+/).length;
    complexityScore += Math.min(goalWords * 2, 30);

    // Factor 3: Input complexity
    const inputStr = JSON.stringify(request.input);
    complexityScore += Math.min(inputStr.length / 100, 20);

    // Factor 4: Quality requirements
    if (request.qualityRequirements?.requireConsensus) complexityScore += 15;
    if (request.qualityRequirements?.validateOutput) complexityScore += 10;

    // Map score to complexity level
    if (complexityScore < 20) return 'trivial';
    if (complexityScore < 40) return 'simple';
    if (complexityScore < 60) return 'moderate';
    if (complexityScore < 80) return 'complex';
    return 'very_complex';
  }

  /**
   * Select appropriate agents for a task
   */
  private async selectAgentsForTask(
    request: MultiAgentTaskRequest,
    complexity: TaskComplexity
  ): Promise<AgentInstance[]> {
    const maxAgents = request.constraints?.maxAgents || this.getMaxAgentsForComplexity(complexity);
    const selected: AgentInstance[] = [];

    // Get required capabilities
    const requiredCapabilities = request.constraints?.requiredCapabilities || [];

    // First, find agents with required capabilities
    for (const capability of requiredCapabilities) {
      const agent = agentRegistry.findBestAgent(capability);
      if (agent && !selected.some(a => a.definition.id === agent.definition.id)) {
        if (!request.constraints?.excludeAgents?.includes(agent.definition.id)) {
          selected.push(agent);
        }
      }
    }

    // Add preferred agents if specified
    if (request.constraints?.preferredAgents) {
      for (const agentId of request.constraints.preferredAgents) {
        if (selected.length >= maxAgents) break;
        const agent = agentRegistry.getAgent(agentId);
        if (agent && !selected.some(a => a.definition.id === agentId)) {
          selected.push(agent);
        }
      }
    }

    // Fill remaining slots with available agents
    const availableAgents = agentRegistry.discover({
      status: ['idle', 'busy'],
      minHealthScore: 50
    });

    for (const agent of availableAgents) {
      if (selected.length >= maxAgents) break;
      if (!selected.some(a => a.definition.id === agent.definition.id)) {
        if (!request.constraints?.excludeAgents?.includes(agent.definition.id)) {
          selected.push(agent);
        }
      }
    }

    return selected;
  }

  /**
   * Get maximum agents based on complexity
   */
  private getMaxAgentsForComplexity(complexity: TaskComplexity): number {
    const mapping: Record<TaskComplexity, number> = {
      trivial: 1,
      simple: 2,
      moderate: 3,
      complex: 5,
      very_complex: 8
    };
    return mapping[complexity];
  }

  /**
   * Decompose task into subtasks
   */
  private async decomposeTask(
    request: MultiAgentTaskRequest,
    complexity: TaskComplexity,
    agents: AgentInstance[]
  ): Promise<OrchestratedTask[]> {
    // For simple tasks, return single task
    if (complexity === 'trivial' || complexity === 'simple') {
      return [{
        id: `subtask_${Date.now()}_0`,
        name: request.name,
        description: request.description,
        requiredCapabilities: request.constraints?.requiredCapabilities || ['reasoning'],
        input: request.input,
        context: {
          userId: request.context.userId,
          sessionId: request.context.sessionId,
          priority: request.context.priority,
          deadline: request.context.deadline
        },
        dependencies: [],
        status: 'pending',
        createdAt: Date.now(),
        retries: 0,
        maxRetries: 3,
        metadata: { parentGoal: request.goal }
      }];
    }

    // For complex tasks, create multiple subtasks
    const subtasks: OrchestratedTask[] = [];
    const timestamp = Date.now();

    // Analysis subtask
    subtasks.push({
      id: `subtask_${timestamp}_analysis`,
      name: `Analyze: ${request.name}`,
      description: 'Analyze the task requirements and context',
      requiredCapabilities: ['reasoning'],
      input: { goal: request.goal, context: request.input },
      context: request.context,
      dependencies: [],
      status: 'pending',
      createdAt: timestamp,
      retries: 0,
      maxRetries: 2,
      metadata: { phase: 'analysis' }
    });

    // Execution subtask
    subtasks.push({
      id: `subtask_${timestamp}_execute`,
      name: `Execute: ${request.name}`,
      description: 'Execute the main task logic',
      requiredCapabilities: request.constraints?.requiredCapabilities || ['reasoning'],
      input: request.input,
      context: request.context,
      dependencies: [`subtask_${timestamp}_analysis`],
      status: 'pending',
      createdAt: timestamp,
      retries: 0,
      maxRetries: 3,
      metadata: { phase: 'execution' }
    });

    // Validation subtask
    if (request.qualityRequirements?.validateOutput) {
      subtasks.push({
        id: `subtask_${timestamp}_validate`,
        name: `Validate: ${request.name}`,
        description: 'Validate the execution output',
        requiredCapabilities: ['code_review'],
        input: { goal: request.goal },
        context: request.context,
        dependencies: [`subtask_${timestamp}_execute`],
        status: 'pending',
        createdAt: timestamp,
        retries: 0,
        maxRetries: 2,
        metadata: { phase: 'validation' }
      });
    }

    return subtasks;
  }

  /**
   * Execute subtasks using selected agents
   */
  private async executeSubtasks(
    subtasks: OrchestratedTask[],
    agents: AgentInstance[],
    request: MultiAgentTaskRequest
  ): Promise<AgentTaskResult[]> {
    const results: AgentTaskResult[] = [];

    // Submit all subtasks as a plan
    const planId = await taskOrchestrator.submitPlan(
      `Multi-agent: ${request.name}`,
      subtasks.map(st => ({
        name: st.name,
        description: st.description,
        requiredCapabilities: st.requiredCapabilities,
        input: st.input,
        context: st.context,
        dependencies: st.dependencies,
        maxRetries: st.maxRetries,
        metadata: st.metadata
      }))
    );

    // Wait for plan completion
    const planResult = await taskOrchestrator.waitForPlan(
      planId,
      request.constraints?.maxDuration || this.config.defaultTimeout
    );

    // Collect results
    for (const taskResult of planResult.results) {
      results.push({
        success: taskResult.success,
        output: taskResult.output,
        metrics: {
          startTime: Date.now() - taskResult.duration,
          endTime: Date.now()
        }
      });
    }

    return results;
  }

  /**
   * Aggregate results from multiple agents
   */
  private async aggregateResults(
    results: AgentTaskResult[],
    request: MultiAgentTaskRequest
  ): Promise<{ output: any; conflictsResolved: number }> {
    const successfulResults = results.filter(r => r.success);

    if (successfulResults.length === 0) {
      throw new Error('All subtasks failed');
    }

    if (successfulResults.length === 1) {
      return {
        output: successfulResults[0].output,
        conflictsResolved: 0
      };
    }

    // Check for conflicts
    let conflictsResolved = 0;
    const outputs = successfulResults.map(r => r.output);

    // If consensus required, check for agreement
    if (request.qualityRequirements?.requireConsensus) {
      const uniqueOutputs = new Set(outputs.map(o => JSON.stringify(o)));

      if (uniqueOutputs.size > 1) {
        // Resolve conflict
        const conflictId = await conflictResolver.reportConflict(
          'output',
          'Multiple agents produced different outputs',
          outputs.map((output, i) => ({
            agentId: `agent_${i}`,
            agentName: `Agent ${i}`,
            position: output,
            confidence: 0.8
          }))
        );

        const conflict = conflictResolver.getConflict(conflictId);
        if (conflict?.resolution) {
          conflictsResolved++;
          return {
            output: conflict.resolution.mergedOutput || outputs[0],
            conflictsResolved
          };
        }
      }
    }

    // Default: return first successful output
    return {
      output: successfulResults[successfulResults.length - 1].output,
      conflictsResolved
    };
  }

  /**
   * Assess output quality
   */
  private assessQuality(
    aggregatedResult: { output: any; conflictsResolved: number },
    request: MultiAgentTaskRequest
  ): number {
    let score = 1.0;

    // Penalize for conflicts
    score -= aggregatedResult.conflictsResolved * 0.1;

    // Check if output is empty or null
    if (!aggregatedResult.output) {
      score -= 0.5;
    }

    // Check if output matches expected type
    if (typeof aggregatedResult.output === 'object') {
      const outputKeys = Object.keys(aggregatedResult.output);
      if (outputKeys.length === 0) {
        score -= 0.3;
      }
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Attempt to improve quality of output
   */
  private async improveQuality(
    currentResult: { output: any; conflictsResolved: number },
    originalResults: AgentTaskResult[],
    request: MultiAgentTaskRequest
  ): Promise<any | null> {
    // Try to merge outputs for better quality
    const successfulOutputs = originalResults
      .filter(r => r.success && r.output)
      .map(r => r.output);

    if (successfulOutputs.length < 2) {
      return null;
    }

    // Simple merge strategy: combine unique information
    try {
      if (typeof successfulOutputs[0] === 'object') {
        const merged: any = {};
        for (const output of successfulOutputs) {
          Object.assign(merged, output);
        }
        return merged;
      }
    } catch {
      // Merge failed
    }

    return null;
  }

  /**
   * Handle unhealthy agent
   */
  private handleUnhealthyAgent(agentId: string, health: any): void {
    this.recordDecision({
      type: 'resource_allocation',
      description: `Agent ${agentId} marked unhealthy`,
      action: { agentId, health },
      rationale: 'Agent health score dropped below threshold',
      confidence: 0.9
    });

    // In adaptive mode, might restart or replace agent
    if (this.config.mode === 'adaptive' && this.config.autoScaleAgents) {
      console.log(`[MetaSupervisor] Would auto-scale to replace unhealthy agent ${agentId}`);
    }
  }

  /**
   * Handle task failure
   */
  private async handleTaskFailure(taskId: string, error: string): Promise<void> {
    this.recordDecision({
      type: 'escalation',
      description: `Task ${taskId} failed`,
      action: { taskId, error },
      rationale: 'Task execution failed, may need intervention',
      confidence: 0.8
    });
  }

  /**
   * Handle escalated conflict
   */
  private async handleEscalatedConflict(conflictId: string, conflict: Conflict): Promise<void> {
    console.log(`[MetaSupervisor] Handling escalated conflict: ${conflictId}`);

    this.recordDecision({
      type: 'conflict_resolution',
      description: `Conflict ${conflictId} escalated for supervisor intervention`,
      action: { conflictId, type: conflict.type },
      rationale: 'Automatic resolution failed',
      confidence: 0.6
    });

    // Supervisor resolution: use highest confidence party
    if (conflict.parties.length > 0) {
      const winner = conflict.parties.reduce((max, p) =>
        p.confidence > max.confidence ? p : max
      , conflict.parties[0]);

      console.log(`[MetaSupervisor] Resolved conflict ${conflictId} in favor of ${winner.agentName}`);
    }
  }

  /**
   * Record a supervision decision
   */
  private recordDecision(
    decision: Omit<SupervisionDecision, 'id' | 'timestamp'>
  ): SupervisionDecision {
    const fullDecision: SupervisionDecision = {
      ...decision,
      id: `decision_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now()
    };

    this.decisions.push(fullDecision);

    // Keep only last 1000 decisions
    if (this.decisions.length > 1000) {
      this.decisions.shift();
    }

    this.emit('decision:made', fullDecision);
    return fullDecision;
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(() => {
      const report = this.generateHealthReport();

      if (report.overallHealth === 'critical') {
        this.emit('system:critical', report);
        console.error('[MetaSupervisor] CRITICAL: System health is critical!');
      } else if (report.overallHealth === 'degraded') {
        this.emit('system:degraded', report);
        console.warn('[MetaSupervisor] WARNING: System health is degraded');
      }
    }, 60000); // Check every minute
  }

  /**
   * Generate system health report
   */
  generateHealthReport(): SystemHealthReport {
    const agentStats = agentRegistry.getStats();
    const taskStats = taskOrchestrator.getStats();
    const conflictStats = conflictResolver.getStats();

    // Calculate agent health
    const healthyAgents = agentStats.agentsByStatus['idle'] || 0;
    const busyAgents = agentStats.agentsByStatus['busy'] || 0;
    const errorAgents = agentStats.agentsByStatus['error'] || 0;

    const agentHealth = {
      totalAgents: agentStats.totalAgents,
      healthyAgents: healthyAgents + busyAgents,
      degradedAgents: agentStats.agentsByStatus['maintenance'] || 0,
      failedAgents: errorAgents
    };

    // Calculate task health
    const totalCompleted = taskStats.completedTasks + taskStats.failedTasks;
    const taskHealth = {
      activeTasks: taskStats.activeTasks,
      queuedTasks: Object.values(taskStats.queueSizes).reduce((a, b) => a + b, 0),
      successRate: totalCompleted > 0
        ? taskStats.completedTasks / totalCompleted
        : 1,
      averageLatency: 0 // Would need to track this
    };

    // Calculate conflict health
    const totalConflicts = conflictStats.activeConflicts + conflictStats.resolvedConflicts;
    const conflictHealth = {
      activeConflicts: conflictStats.activeConflicts,
      resolutionRate: conflictStats.successRate,
      escalatedConflicts: conflictStats.activeConflicts // Simplified
    };

    // Calculate overall health score
    let healthScore = 100;
    healthScore -= (errorAgents / Math.max(agentStats.totalAgents, 1)) * 30;
    healthScore -= (1 - taskHealth.successRate) * 40;
    healthScore -= (conflictHealth.activeConflicts * 5);
    healthScore = Math.max(0, healthScore);

    // Determine overall health status
    let overallHealth: 'healthy' | 'degraded' | 'critical';
    if (healthScore >= 80) {
      overallHealth = 'healthy';
    } else if (healthScore >= 50) {
      overallHealth = 'degraded';
    } else {
      overallHealth = 'critical';
    }

    // Generate recommendations
    const recommendations: string[] = [];

    if (errorAgents > 0) {
      recommendations.push(`Investigate ${errorAgents} failed agents`);
    }
    if (taskHealth.successRate < 0.9) {
      recommendations.push('Review task failure patterns');
    }
    if (conflictHealth.activeConflicts > 5) {
      recommendations.push('Review conflict resolution policies');
    }
    if (agentStats.totalAgents < 3) {
      recommendations.push('Consider registering more agents for redundancy');
    }

    return {
      timestamp: Date.now(),
      overallHealth,
      healthScore,
      agentHealth,
      taskHealth,
      conflictHealth,
      recommendations
    };
  }

  /**
   * Get supervision mode
   */
  getMode(): SupervisionMode {
    return this.config.mode;
  }

  /**
   * Set supervision mode
   */
  setMode(mode: SupervisionMode): void {
    this.config.mode = mode;
    console.log(`[MetaSupervisor] Mode changed to: ${mode}`);
    this.emit('config:changed', { mode });
  }

  /**
   * Get recent decisions
   */
  getRecentDecisions(limit: number = 50): SupervisionDecision[] {
    return this.decisions.slice(-limit);
  }

  /**
   * Get supervisor statistics
   */
  getStats(): {
    mode: SupervisionMode;
    activeMultiAgentTasks: number;
    totalDecisions: number;
    decisionsByType: Record<string, number>;
    healthReport: SystemHealthReport;
  } {
    const decisionsByType: Record<string, number> = {};
    for (const decision of this.decisions) {
      decisionsByType[decision.type] = (decisionsByType[decision.type] || 0) + 1;
    }

    return {
      mode: this.config.mode,
      activeMultiAgentTasks: this.activeMultiAgentTasks.size,
      totalDecisions: this.decisions.length,
      decisionsByType,
      healthReport: this.generateHealthReport()
    };
  }

  /**
   * Shutdown the supervisor
   */
  async shutdown(): Promise<void> {
    console.log('[MetaSupervisor] Shutting down...');

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Shutdown sub-components
    await taskOrchestrator.shutdown();
    await agentRegistry.shutdown();

    console.log('[MetaSupervisor] Shutdown complete');
  }
}

// Export singleton instance
export const metaSupervisor = new MetaSupervisor();
