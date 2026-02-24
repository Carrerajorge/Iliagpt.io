/**
 * Agent Registry - Central registry for all specialized agents
 *
 * Manages the lifecycle and discovery of agents in the super-intelligence system.
 */

import { EventEmitter } from 'events';

// Agent capability types
export type AgentCapability =
  | 'code_generation'
  | 'code_review'
  | 'code_refactoring'
  | 'debugging'
  | 'testing'
  | 'documentation'
  | 'data_analysis'
  | 'natural_language'
  | 'translation'
  | 'summarization'
  | 'research'
  | 'web_search'
  | 'file_management'
  | 'database_query'
  | 'api_integration'
  | 'image_analysis'
  | 'audio_processing'
  | 'math_computation'
  | 'planning'
  | 'reasoning'
  | 'memory_management'
  | 'user_profiling'
  | 'emotion_detection'
  | 'task_decomposition'
  | 'workflow_orchestration';

// Agent status
export type AgentStatus = 'idle' | 'busy' | 'error' | 'initializing' | 'shutdown' | 'maintenance';

// Agent priority levels
export type AgentPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';

// Agent definition
export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  capabilities: AgentCapability[];
  priority: AgentPriority;
  maxConcurrentTasks: number;
  timeoutMs: number;
  retryPolicy: {
    maxRetries: number;
    backoffMs: number;
    exponential: boolean;
  };
  resourceRequirements: {
    minMemoryMB: number;
    preferredMemoryMB: number;
    gpuRequired: boolean;
    networkRequired: boolean;
  };
  metadata: Record<string, any>;
}

// Agent instance
export interface AgentInstance {
  definition: AgentDefinition;
  status: AgentStatus;
  currentTasks: number;
  totalTasksProcessed: number;
  successRate: number;
  averageLatencyMs: number;
  lastActiveAt: number;
  createdAt: number;
  errors: Array<{
    timestamp: number;
    error: string;
    taskId?: string;
  }>;
  health: {
    score: number; // 0-100
    lastCheckAt: number;
    issues: string[];
  };
}

// Agent registration request
export interface AgentRegistrationRequest {
  definition: AgentDefinition;
  handler: AgentHandler;
}

// Agent handler function
export type AgentHandler = (task: AgentTask) => Promise<AgentTaskResult>;

// Agent task
export interface AgentTask {
  id: string;
  type: string;
  input: any;
  context: {
    userId: string;
    sessionId: string;
    priority: AgentPriority;
    deadline?: number;
    parentTaskId?: string;
  };
  metadata: Record<string, any>;
}

// Agent task result
export interface AgentTaskResult {
  success: boolean;
  output: any;
  error?: string;
  metrics: {
    startTime: number;
    endTime: number;
    tokensUsed?: number;
    memoryUsedMB?: number;
  };
  artifacts?: Array<{
    type: string;
    name: string;
    data: any;
  }>;
}

// Agent discovery query
export interface AgentDiscoveryQuery {
  capabilities?: AgentCapability[];
  status?: AgentStatus[];
  priority?: AgentPriority[];
  minHealthScore?: number;
  maxLatencyMs?: number;
}

/**
 * AgentRegistry - Centralized agent management
 */
export class AgentRegistry extends EventEmitter {
  private agents: Map<string, AgentInstance>;
  private handlers: Map<string, AgentHandler>;
  private capabilityIndex: Map<AgentCapability, Set<string>>;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.agents = new Map();
    this.handlers = new Map();
    this.capabilityIndex = new Map();
  }

  /**
   * Initialize the registry
   */
  async initialize(): Promise<void> {
    console.log('[AgentRegistry] Initializing...');

    // Start health monitoring
    this.startHealthMonitoring();

    // Register built-in agents
    await this.registerBuiltInAgents();

    console.log('[AgentRegistry] Initialized with', this.agents.size, 'agents');
  }

  /**
   * Register a new agent
   */
  async register(request: AgentRegistrationRequest): Promise<void> {
    const { definition, handler } = request;

    if (this.agents.has(definition.id)) {
      throw new Error(`Agent ${definition.id} is already registered`);
    }

    // Create agent instance
    const instance: AgentInstance = {
      definition,
      status: 'initializing',
      currentTasks: 0,
      totalTasksProcessed: 0,
      successRate: 1.0,
      averageLatencyMs: 0,
      lastActiveAt: Date.now(),
      createdAt: Date.now(),
      errors: [],
      health: {
        score: 100,
        lastCheckAt: Date.now(),
        issues: []
      }
    };

    // Store agent
    this.agents.set(definition.id, instance);
    this.handlers.set(definition.id, handler);

    // Index by capabilities
    for (const capability of definition.capabilities) {
      if (!this.capabilityIndex.has(capability)) {
        this.capabilityIndex.set(capability, new Set());
      }
      this.capabilityIndex.get(capability)!.add(definition.id);
    }

    // Mark as ready
    instance.status = 'idle';

    this.emit('agent:registered', { agentId: definition.id, definition });
    console.log(`[AgentRegistry] Registered agent: ${definition.name} (${definition.id})`);
  }

  /**
   * Unregister an agent
   */
  async unregister(agentId: string): Promise<void> {
    const instance = this.agents.get(agentId);
    if (!instance) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // Check if agent is busy
    if (instance.currentTasks > 0) {
      instance.status = 'shutdown';
      // Wait for tasks to complete
      await this.waitForAgentIdle(agentId, 30000);
    }

    // Remove from capability index
    for (const capability of instance.definition.capabilities) {
      this.capabilityIndex.get(capability)?.delete(agentId);
    }

    // Remove agent
    this.agents.delete(agentId);
    this.handlers.delete(agentId);

    this.emit('agent:unregistered', { agentId });
    console.log(`[AgentRegistry] Unregistered agent: ${agentId}`);
  }

  /**
   * Get an agent by ID
   */
  getAgent(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get agent handler
   */
  getHandler(agentId: string): AgentHandler | undefined {
    return this.handlers.get(agentId);
  }

  /**
   * Discover agents by query
   */
  discover(query: AgentDiscoveryQuery): AgentInstance[] {
    let candidates = Array.from(this.agents.values());

    // Filter by capabilities
    if (query.capabilities && query.capabilities.length > 0) {
      candidates = candidates.filter(agent =>
        query.capabilities!.every(cap =>
          agent.definition.capabilities.includes(cap)
        )
      );
    }

    // Filter by status
    if (query.status && query.status.length > 0) {
      candidates = candidates.filter(agent =>
        query.status!.includes(agent.status)
      );
    }

    // Filter by priority
    if (query.priority && query.priority.length > 0) {
      candidates = candidates.filter(agent =>
        query.priority!.includes(agent.definition.priority)
      );
    }

    // Filter by health score
    if (query.minHealthScore !== undefined) {
      candidates = candidates.filter(agent =>
        agent.health.score >= query.minHealthScore!
      );
    }

    // Filter by latency
    if (query.maxLatencyMs !== undefined) {
      candidates = candidates.filter(agent =>
        agent.averageLatencyMs <= query.maxLatencyMs!
      );
    }

    return candidates;
  }

  /**
   * Find best agent for a capability
   */
  findBestAgent(capability: AgentCapability): AgentInstance | undefined {
    const agentIds = this.capabilityIndex.get(capability);
    if (!agentIds || agentIds.size === 0) {
      return undefined;
    }

    let bestAgent: AgentInstance | undefined;
    let bestScore = -1;

    for (const agentId of agentIds) {
      const agent = this.agents.get(agentId)!;

      // Skip unavailable agents
      if (agent.status !== 'idle' && agent.status !== 'busy') {
        continue;
      }

      // Skip overloaded agents
      if (agent.currentTasks >= agent.definition.maxConcurrentTasks) {
        continue;
      }

      // Calculate score (higher is better)
      const score = this.calculateAgentScore(agent);

      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent;
      }
    }

    return bestAgent;
  }

  /**
   * Calculate agent score for selection
   */
  private calculateAgentScore(agent: AgentInstance): number {
    let score = 0;

    // Health score (0-40 points)
    score += agent.health.score * 0.4;

    // Success rate (0-30 points)
    score += agent.successRate * 30;

    // Availability (0-20 points)
    const availabilityRatio = 1 - (agent.currentTasks / agent.definition.maxConcurrentTasks);
    score += availabilityRatio * 20;

    // Latency (0-10 points, lower is better)
    const latencyScore = Math.max(0, 10 - (agent.averageLatencyMs / 1000));
    score += latencyScore;

    // Priority bonus
    const priorityBonus: Record<AgentPriority, number> = {
      critical: 15,
      high: 10,
      normal: 5,
      low: 2,
      background: 0
    };
    score += priorityBonus[agent.definition.priority];

    return score;
  }

  /**
   * Execute a task on an agent
   */
  async executeTask(agentId: string, task: AgentTask): Promise<AgentTaskResult> {
    const agent = this.agents.get(agentId);
    const handler = this.handlers.get(agentId);

    if (!agent || !handler) {
      throw new Error(`Agent ${agentId} not found`);
    }

    if (agent.status === 'shutdown' || agent.status === 'error') {
      throw new Error(`Agent ${agentId} is not available (status: ${agent.status})`);
    }

    if (agent.currentTasks >= agent.definition.maxConcurrentTasks) {
      throw new Error(`Agent ${agentId} is at maximum capacity`);
    }

    // Update agent state
    agent.currentTasks++;
    agent.status = 'busy';
    agent.lastActiveAt = Date.now();

    this.emit('task:started', { agentId, taskId: task.id });

    const startTime = Date.now();
    let result: AgentTaskResult;
    let retries = 0;

    try {
      // Execute with retry policy
      while (retries <= agent.definition.retryPolicy.maxRetries) {
        try {
          // Execute with timeout
          result = await this.executeWithTimeout(
            handler(task),
            agent.definition.timeoutMs
          );
          break;
        } catch (error: any) {
          retries++;
          if (retries > agent.definition.retryPolicy.maxRetries) {
            throw error;
          }

          // Calculate backoff
          let backoff = agent.definition.retryPolicy.backoffMs;
          if (agent.definition.retryPolicy.exponential) {
            backoff *= Math.pow(2, retries - 1);
          }

          console.log(`[AgentRegistry] Retry ${retries} for task ${task.id} on agent ${agentId}, waiting ${backoff}ms`);
          await this.sleep(backoff);
        }
      }

      // Update metrics
      const endTime = Date.now();
      const latency = endTime - startTime;

      agent.totalTasksProcessed++;
      agent.averageLatencyMs = (agent.averageLatencyMs * (agent.totalTasksProcessed - 1) + latency) / agent.totalTasksProcessed;

      // Update success rate
      if (result!.success) {
        agent.successRate = (agent.successRate * (agent.totalTasksProcessed - 1) + 1) / agent.totalTasksProcessed;
      } else {
        agent.successRate = (agent.successRate * (agent.totalTasksProcessed - 1)) / agent.totalTasksProcessed;
      }

      this.emit('task:completed', { agentId, taskId: task.id, result: result!, latency });
      return result!;

    } catch (error: any) {
      // Record error
      agent.errors.push({
        timestamp: Date.now(),
        error: error.message,
        taskId: task.id
      });

      // Keep only last 50 errors
      if (agent.errors.length > 50) {
        agent.errors.shift();
      }

      // Update success rate
      agent.totalTasksProcessed++;
      agent.successRate = (agent.successRate * (agent.totalTasksProcessed - 1)) / agent.totalTasksProcessed;

      // Check if agent should be marked as error
      if (agent.successRate < 0.5 && agent.totalTasksProcessed > 10) {
        agent.status = 'error';
        agent.health.issues.push('Success rate dropped below 50%');
      }

      this.emit('task:failed', { agentId, taskId: task.id, error: error.message });

      return {
        success: false,
        output: null,
        error: error.message,
        metrics: {
          startTime,
          endTime: Date.now()
        }
      };

    } finally {
      agent.currentTasks--;
      if (agent.currentTasks === 0 && agent.status === 'busy') {
        agent.status = 'idle';
      }
    }
  }

  /**
   * Execute with timeout
   */
  private executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Task timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then(result => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * Wait for agent to become idle
   */
  private waitForAgentIdle(agentId: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        const agent = this.agents.get(agentId);
        if (!agent || agent.currentTasks === 0) {
          clearInterval(checkInterval);
          resolve();
        } else if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          reject(new Error(`Timeout waiting for agent ${agentId} to become idle`));
        }
      }, 100);
    });
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, 30000); // Check every 30 seconds
  }

  /**
   * Perform health checks on all agents
   */
  private performHealthChecks(): void {
    for (const [agentId, agent] of this.agents) {
      const issues: string[] = [];
      let score = 100;

      // Check success rate
      if (agent.successRate < 0.8) {
        score -= 20;
        issues.push(`Low success rate: ${(agent.successRate * 100).toFixed(1)}%`);
      }

      // Check latency
      if (agent.averageLatencyMs > 5000) {
        score -= 15;
        issues.push(`High latency: ${agent.averageLatencyMs.toFixed(0)}ms`);
      }

      // Check recent errors
      const recentErrors = agent.errors.filter(e => Date.now() - e.timestamp < 300000);
      if (recentErrors.length > 5) {
        score -= 25;
        issues.push(`${recentErrors.length} errors in last 5 minutes`);
      }

      // Check if idle too long (might be stuck)
      if (agent.status === 'busy' && Date.now() - agent.lastActiveAt > 60000) {
        score -= 10;
        issues.push('Potentially stuck - busy but inactive');
      }

      // Update health
      agent.health = {
        score: Math.max(0, score),
        lastCheckAt: Date.now(),
        issues
      };

      // Emit health event if score dropped significantly
      if (score < 50 && agent.health.score >= 50) {
        this.emit('agent:unhealthy', { agentId, health: agent.health });
      }
    }
  }

  /**
   * Register built-in agents
   */
  private async registerBuiltInAgents(): Promise<void> {
    // Code Generation Agent
    await this.register({
      definition: {
        id: 'code-generator',
        name: 'Code Generator',
        description: 'Generates code in multiple programming languages',
        version: '1.0.0',
        capabilities: ['code_generation', 'code_refactoring'],
        priority: 'high',
        maxConcurrentTasks: 5,
        timeoutMs: 60000,
        retryPolicy: { maxRetries: 2, backoffMs: 1000, exponential: true },
        resourceRequirements: { minMemoryMB: 512, preferredMemoryMB: 1024, gpuRequired: false, networkRequired: true },
        metadata: { languages: ['typescript', 'javascript', 'python', 'java', 'go', 'rust'] }
      },
      handler: async (task) => ({
        success: true,
        output: { code: '// Generated code placeholder' },
        metrics: { startTime: Date.now(), endTime: Date.now() }
      })
    });

    // Code Review Agent
    await this.register({
      definition: {
        id: 'code-reviewer',
        name: 'Code Reviewer',
        description: 'Reviews code for quality, security, and best practices',
        version: '1.0.0',
        capabilities: ['code_review', 'debugging'],
        priority: 'high',
        maxConcurrentTasks: 10,
        timeoutMs: 30000,
        retryPolicy: { maxRetries: 1, backoffMs: 500, exponential: false },
        resourceRequirements: { minMemoryMB: 256, preferredMemoryMB: 512, gpuRequired: false, networkRequired: false },
        metadata: {}
      },
      handler: async (task) => ({
        success: true,
        output: { review: 'Code review placeholder', issues: [] },
        metrics: { startTime: Date.now(), endTime: Date.now() }
      })
    });

    // Research Agent
    await this.register({
      definition: {
        id: 'researcher',
        name: 'Research Agent',
        description: 'Performs web research and information gathering',
        version: '1.0.0',
        capabilities: ['research', 'web_search', 'summarization'],
        priority: 'normal',
        maxConcurrentTasks: 3,
        timeoutMs: 120000,
        retryPolicy: { maxRetries: 3, backoffMs: 2000, exponential: true },
        resourceRequirements: { minMemoryMB: 256, preferredMemoryMB: 512, gpuRequired: false, networkRequired: true },
        metadata: {}
      },
      handler: async (task) => ({
        success: true,
        output: { findings: [], summary: 'Research placeholder' },
        metrics: { startTime: Date.now(), endTime: Date.now() }
      })
    });

    // Data Analysis Agent
    await this.register({
      definition: {
        id: 'data-analyst',
        name: 'Data Analysis Agent',
        description: 'Analyzes data and generates insights',
        version: '1.0.0',
        capabilities: ['data_analysis', 'math_computation'],
        priority: 'normal',
        maxConcurrentTasks: 4,
        timeoutMs: 90000,
        retryPolicy: { maxRetries: 2, backoffMs: 1000, exponential: true },
        resourceRequirements: { minMemoryMB: 512, preferredMemoryMB: 2048, gpuRequired: false, networkRequired: false },
        metadata: {}
      },
      handler: async (task) => ({
        success: true,
        output: { analysis: {}, insights: [] },
        metrics: { startTime: Date.now(), endTime: Date.now() }
      })
    });

    // Planning Agent
    await this.register({
      definition: {
        id: 'planner',
        name: 'Planning Agent',
        description: 'Creates and optimizes execution plans',
        version: '1.0.0',
        capabilities: ['planning', 'task_decomposition', 'workflow_orchestration'],
        priority: 'high',
        maxConcurrentTasks: 5,
        timeoutMs: 30000,
        retryPolicy: { maxRetries: 1, backoffMs: 500, exponential: false },
        resourceRequirements: { minMemoryMB: 256, preferredMemoryMB: 512, gpuRequired: false, networkRequired: false },
        metadata: {}
      },
      handler: async (task) => ({
        success: true,
        output: { plan: { steps: [] } },
        metrics: { startTime: Date.now(), endTime: Date.now() }
      })
    });
  }

  /**
   * Get all registered agents
   */
  getAllAgents(): AgentInstance[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalAgents: number;
    agentsByStatus: Record<AgentStatus, number>;
    agentsByCapability: Record<string, number>;
    totalTasksProcessed: number;
    averageSuccessRate: number;
    averageHealthScore: number;
  } {
    const stats = {
      totalAgents: this.agents.size,
      agentsByStatus: {} as Record<AgentStatus, number>,
      agentsByCapability: {} as Record<string, number>,
      totalTasksProcessed: 0,
      averageSuccessRate: 0,
      averageHealthScore: 0
    };

    let successRateSum = 0;
    let healthScoreSum = 0;

    for (const agent of this.agents.values()) {
      // Count by status
      stats.agentsByStatus[agent.status] = (stats.agentsByStatus[agent.status] || 0) + 1;

      // Count by capability
      for (const cap of agent.definition.capabilities) {
        stats.agentsByCapability[cap] = (stats.agentsByCapability[cap] || 0) + 1;
      }

      stats.totalTasksProcessed += agent.totalTasksProcessed;
      successRateSum += agent.successRate;
      healthScoreSum += agent.health.score;
    }

    if (this.agents.size > 0) {
      stats.averageSuccessRate = successRateSum / this.agents.size;
      stats.averageHealthScore = healthScoreSum / this.agents.size;
    }

    return stats;
  }

  /**
   * Shutdown the registry
   */
  async shutdown(): Promise<void> {
    console.log('[AgentRegistry] Shutting down...');

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Wait for all agents to complete their tasks
    const shutdownPromises = Array.from(this.agents.keys()).map(agentId =>
      this.waitForAgentIdle(agentId, 30000).catch(() => {})
    );

    await Promise.all(shutdownPromises);

    this.agents.clear();
    this.handlers.clear();
    this.capabilityIndex.clear();

    console.log('[AgentRegistry] Shutdown complete');
  }

  /**
   * Helper to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const agentRegistry = new AgentRegistry();
