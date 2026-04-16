/**
 * Task Orchestrator - Manages task distribution and execution across agents
 *
 * Handles task queuing, prioritization, load balancing, and execution coordination.
 */

import { EventEmitter } from 'events';
import { agentRegistry, AgentTask, AgentTaskResult, AgentCapability, AgentPriority } from './AgentRegistry';

// Task definition for orchestration
export interface OrchestratedTask {
  id: string;
  name: string;
  description: string;
  requiredCapabilities: AgentCapability[];
  input: any;
  context: {
    userId: string;
    sessionId: string;
    priority: AgentPriority;
    deadline?: number;
    parentTaskId?: string;
  };
  dependencies: string[]; // IDs of tasks that must complete first
  status: TaskStatus;
  assignedAgentId?: string;
  result?: AgentTaskResult;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  retries: number;
  maxRetries: number;
  metadata: Record<string, any>;
}

export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'assigned'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked'; // Waiting for dependencies

// Task queue
export interface TaskQueue {
  critical: OrchestratedTask[];
  high: OrchestratedTask[];
  normal: OrchestratedTask[];
  low: OrchestratedTask[];
  background: OrchestratedTask[];
}

// Execution plan
export interface ExecutionPlan {
  id: string;
  name: string;
  tasks: OrchestratedTask[];
  executionOrder: string[][]; // Groups of task IDs that can run in parallel
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  results: Map<string, AgentTaskResult>;
}

// Orchestration result
export interface OrchestrationResult {
  planId: string;
  success: boolean;
  completedTasks: number;
  failedTasks: number;
  totalDuration: number;
  results: Array<{
    taskId: string;
    taskName: string;
    success: boolean;
    output: any;
    duration: number;
  }>;
  errors: string[];
}

// Load balancing strategy
export type LoadBalancingStrategy =
  | 'round_robin'
  | 'least_loaded'
  | 'best_performance'
  | 'random'
  | 'weighted';

/**
 * TaskOrchestrator - Coordinates task execution across agents
 */
export class TaskOrchestrator extends EventEmitter {
  private taskQueues: TaskQueue;
  private activeTasks: Map<string, OrchestratedTask>;
  private executionPlans: Map<string, ExecutionPlan>;
  private taskHistory: Map<string, OrchestratedTask>;
  private loadBalancingStrategy: LoadBalancingStrategy;
  private processingInterval: NodeJS.Timeout | null = null;
  private maxConcurrentTasks: number;
  private isProcessing: boolean = false;

  constructor() {
    super();
    this.taskQueues = {
      critical: [],
      high: [],
      normal: [],
      low: [],
      background: []
    };
    this.activeTasks = new Map();
    this.executionPlans = new Map();
    this.taskHistory = new Map();
    this.loadBalancingStrategy = 'best_performance';
    this.maxConcurrentTasks = 20;
  }

  /**
   * Initialize the orchestrator
   */
  async initialize(): Promise<void> {
    console.log('[TaskOrchestrator] Initializing...');

    // Start task processing loop
    this.startProcessingLoop();

    console.log('[TaskOrchestrator] Initialized');
  }

  /**
   * Submit a single task for execution
   */
  async submitTask(task: Omit<OrchestratedTask, 'id' | 'status' | 'createdAt' | 'retries'>): Promise<string> {
    const orchestratedTask: OrchestratedTask = {
      ...task,
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      status: 'pending',
      createdAt: Date.now(),
      retries: 0,
      maxRetries: task.maxRetries || 3
    };

    // Check dependencies
    if (orchestratedTask.dependencies.length > 0) {
      const allDepsCompleted = orchestratedTask.dependencies.every(depId => {
        const depTask = this.taskHistory.get(depId);
        return depTask && depTask.status === 'completed';
      });

      if (!allDepsCompleted) {
        orchestratedTask.status = 'blocked';
      }
    }

    // Add to appropriate queue
    this.enqueueTask(orchestratedTask);

    this.emit('task:submitted', { taskId: orchestratedTask.id, task: orchestratedTask });
    console.log(`[TaskOrchestrator] Task submitted: ${orchestratedTask.id} (${orchestratedTask.name})`);

    return orchestratedTask.id;
  }

  /**
   * Submit multiple tasks as an execution plan
   */
  async submitPlan(
    name: string,
    tasks: Array<Omit<OrchestratedTask, 'id' | 'status' | 'createdAt' | 'retries'>>
  ): Promise<string> {
    const planId = `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create orchestrated tasks
    const orchestratedTasks: OrchestratedTask[] = tasks.map((task, index) => ({
      ...task,
      id: `${planId}_task_${index}`,
      status: 'pending' as TaskStatus,
      createdAt: Date.now(),
      retries: 0,
      maxRetries: task.maxRetries || 3
    }));

    // Calculate execution order (topological sort based on dependencies)
    const executionOrder = this.calculateExecutionOrder(orchestratedTasks);

    // Create execution plan
    const plan: ExecutionPlan = {
      id: planId,
      name,
      tasks: orchestratedTasks,
      executionOrder,
      status: 'pending',
      createdAt: Date.now(),
      results: new Map()
    };

    this.executionPlans.set(planId, plan);

    // Queue the first batch of tasks
    const firstBatch = executionOrder[0] || [];
    for (const taskId of firstBatch) {
      const task = orchestratedTasks.find(t => t.id === taskId);
      if (task) {
        this.enqueueTask(task);
      }
    }

    plan.status = 'running';
    plan.startedAt = Date.now();

    this.emit('plan:started', { planId, plan });
    console.log(`[TaskOrchestrator] Plan submitted: ${planId} (${name}) with ${orchestratedTasks.length} tasks`);

    return planId;
  }

  /**
   * Calculate execution order using topological sort
   */
  private calculateExecutionOrder(tasks: OrchestratedTask[]): string[][] {
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    // Initialize
    for (const task of tasks) {
      inDegree.set(task.id, task.dependencies.length);
      for (const dep of task.dependencies) {
        if (!dependents.has(dep)) {
          dependents.set(dep, []);
        }
        dependents.get(dep)!.push(task.id);
      }
    }

    // Find tasks with no dependencies (can start immediately)
    const executionOrder: string[][] = [];
    let currentLevel: string[] = [];

    for (const task of tasks) {
      if (task.dependencies.length === 0) {
        currentLevel.push(task.id);
      }
    }

    while (currentLevel.length > 0) {
      executionOrder.push([...currentLevel]);

      const nextLevel: string[] = [];
      for (const taskId of currentLevel) {
        const deps = dependents.get(taskId) || [];
        for (const depId of deps) {
          const newDegree = (inDegree.get(depId) || 0) - 1;
          inDegree.set(depId, newDegree);
          if (newDegree === 0) {
            nextLevel.push(depId);
          }
        }
      }
      currentLevel = nextLevel;
    }

    return executionOrder;
  }

  /**
   * Enqueue a task based on priority
   */
  private enqueueTask(task: OrchestratedTask): void {
    task.status = 'queued';
    this.taskQueues[task.context.priority].push(task);
  }

  /**
   * Start the processing loop
   */
  private startProcessingLoop(): void {
    this.processingInterval = setInterval(() => {
      this.processQueue();
    }, 100); // Check every 100ms
  }

  /**
   * Process the task queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    if (this.activeTasks.size >= this.maxConcurrentTasks) return;

    this.isProcessing = true;

    try {
      // Process tasks by priority
      const priorities: AgentPriority[] = ['critical', 'high', 'normal', 'low', 'background'];

      for (const priority of priorities) {
        const queue = this.taskQueues[priority];

        while (queue.length > 0 && this.activeTasks.size < this.maxConcurrentTasks) {
          const task = queue.shift();
          if (!task) break;

          // Check if task is blocked
          if (task.status === 'blocked') {
            const allDepsCompleted = task.dependencies.every(depId => {
              const depTask = this.taskHistory.get(depId);
              return depTask && depTask.status === 'completed';
            });

            if (!allDepsCompleted) {
              // Re-queue for later
              queue.push(task);
              continue;
            }
            task.status = 'queued';
          }

          // Find an agent for this task
          const agent = this.findAgentForTask(task);
          if (!agent) {
            // No available agent, re-queue
            queue.unshift(task);
            break;
          }

          // Execute task asynchronously
          this.executeTask(task, agent.definition.id);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Find the best agent for a task
   */
  private findAgentForTask(task: OrchestratedTask): any {
    for (const capability of task.requiredCapabilities) {
      const agent = agentRegistry.findBestAgent(capability);
      if (agent) {
        return agent;
      }
    }
    return undefined;
  }

  /**
   * Execute a task on an agent
   */
  private async executeTask(task: OrchestratedTask, agentId: string): Promise<void> {
    task.status = 'running';
    task.assignedAgentId = agentId;
    task.startedAt = Date.now();
    this.activeTasks.set(task.id, task);

    this.emit('task:started', { taskId: task.id, agentId });

    try {
      const agentTask: AgentTask = {
        id: task.id,
        type: task.name,
        input: task.input,
        context: task.context,
        metadata: task.metadata
      };

      const result = await agentRegistry.executeTask(agentId, agentTask);

      task.result = result;
      task.completedAt = Date.now();

      if (result.success) {
        task.status = 'completed';
        this.emit('task:completed', { taskId: task.id, result });
      } else {
        // Check if we should retry
        if (task.retries < task.maxRetries) {
          task.retries++;
          task.status = 'queued';
          this.enqueueTask(task);
          this.emit('task:retry', { taskId: task.id, retries: task.retries });
        } else {
          task.status = 'failed';
          this.emit('task:failed', { taskId: task.id, error: result.error });
        }
      }

    } catch (error: any) {
      task.completedAt = Date.now();

      if (task.retries < task.maxRetries) {
        task.retries++;
        task.status = 'queued';
        this.enqueueTask(task);
        this.emit('task:retry', { taskId: task.id, retries: task.retries, error: error.message });
      } else {
        task.status = 'failed';
        task.result = {
          success: false,
          output: null,
          error: error.message,
          metrics: {
            startTime: task.startedAt || Date.now(),
            endTime: Date.now()
          }
        };
        this.emit('task:failed', { taskId: task.id, error: error.message });
      }
    } finally {
      this.activeTasks.delete(task.id);
      this.taskHistory.set(task.id, task);

      // Check if this completes any execution plans
      this.checkPlanProgress(task);

      // Unblock dependent tasks
      this.unblockDependentTasks(task.id);
    }
  }

  /**
   * Check and update execution plan progress
   */
  private checkPlanProgress(completedTask: OrchestratedTask): void {
    for (const [planId, plan] of this.executionPlans) {
      const planTask = plan.tasks.find(t => t.id === completedTask.id);
      if (!planTask) continue;

      // Update plan results
      if (completedTask.result) {
        plan.results.set(completedTask.id, completedTask.result);
      }

      // Check if all tasks are complete
      const allComplete = plan.tasks.every(t =>
        t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
      );

      if (allComplete) {
        const allSuccessful = plan.tasks.every(t => t.status === 'completed');
        plan.status = allSuccessful ? 'completed' : 'failed';
        plan.completedAt = Date.now();

        this.emit('plan:completed', {
          planId,
          success: allSuccessful,
          results: Array.from(plan.results.values())
        });
      } else {
        // Queue next batch of tasks
        this.queueNextPlanBatch(plan, completedTask.id);
      }
    }
  }

  /**
   * Queue the next batch of tasks in a plan
   */
  private queueNextPlanBatch(plan: ExecutionPlan, completedTaskId: string): void {
    // Find which level the completed task was in
    for (let i = 0; i < plan.executionOrder.length; i++) {
      const level = plan.executionOrder[i];
      if (level.includes(completedTaskId)) {
        // Check if all tasks in this level are done
        const levelComplete = level.every(taskId => {
          const task = plan.tasks.find(t => t.id === taskId);
          return task && (task.status === 'completed' || task.status === 'failed');
        });

        if (levelComplete && i + 1 < plan.executionOrder.length) {
          // Queue next level
          const nextLevel = plan.executionOrder[i + 1];
          for (const taskId of nextLevel) {
            const task = plan.tasks.find(t => t.id === taskId);
            if (task && task.status === 'pending') {
              this.enqueueTask(task);
            }
          }
        }
        break;
      }
    }
  }

  /**
   * Unblock tasks that depend on a completed task
   */
  private unblockDependentTasks(completedTaskId: string): void {
    // Check all queues for blocked tasks
    const priorities: AgentPriority[] = ['critical', 'high', 'normal', 'low', 'background'];

    for (const priority of priorities) {
      for (const task of this.taskQueues[priority]) {
        if (task.status === 'blocked' && task.dependencies.includes(completedTaskId)) {
          const allDepsCompleted = task.dependencies.every(depId => {
            const depTask = this.taskHistory.get(depId);
            return depTask && depTask.status === 'completed';
          });

          if (allDepsCompleted) {
            task.status = 'queued';
          }
        }
      }
    }
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string): Promise<boolean> {
    // Check active tasks
    const activeTask = this.activeTasks.get(taskId);
    if (activeTask) {
      activeTask.status = 'cancelled';
      activeTask.completedAt = Date.now();
      this.activeTasks.delete(taskId);
      this.taskHistory.set(taskId, activeTask);
      this.emit('task:cancelled', { taskId });
      return true;
    }

    // Check queues
    const priorities: AgentPriority[] = ['critical', 'high', 'normal', 'low', 'background'];
    for (const priority of priorities) {
      const queue = this.taskQueues[priority];
      const index = queue.findIndex(t => t.id === taskId);
      if (index !== -1) {
        const task = queue.splice(index, 1)[0];
        task.status = 'cancelled';
        task.completedAt = Date.now();
        this.taskHistory.set(taskId, task);
        this.emit('task:cancelled', { taskId });
        return true;
      }
    }

    return false;
  }

  /**
   * Cancel an execution plan
   */
  async cancelPlan(planId: string): Promise<boolean> {
    const plan = this.executionPlans.get(planId);
    if (!plan) return false;

    plan.status = 'cancelled';
    plan.completedAt = Date.now();

    // Cancel all pending/queued tasks
    for (const task of plan.tasks) {
      if (task.status === 'pending' || task.status === 'queued' || task.status === 'blocked') {
        await this.cancelTask(task.id);
      }
    }

    this.emit('plan:cancelled', { planId });
    return true;
  }

  /**
   * Get task status
   */
  getTaskStatus(taskId: string): OrchestratedTask | undefined {
    return this.activeTasks.get(taskId) || this.taskHistory.get(taskId);
  }

  /**
   * Get plan status
   */
  getPlanStatus(planId: string): ExecutionPlan | undefined {
    return this.executionPlans.get(planId);
  }

  /**
   * Wait for task completion
   */
  async waitForTask(taskId: string, timeoutMs: number = 60000): Promise<OrchestratedTask> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const checkCompletion = () => {
        const task = this.getTaskStatus(taskId);

        if (!task) {
          reject(new Error(`Task ${taskId} not found`));
          return;
        }

        if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
          resolve(task);
          return;
        }

        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`Timeout waiting for task ${taskId}`));
          return;
        }

        setTimeout(checkCompletion, 100);
      };

      checkCompletion();
    });
  }

  /**
   * Wait for plan completion
   */
  async waitForPlan(planId: string, timeoutMs: number = 300000): Promise<OrchestrationResult> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const checkCompletion = () => {
        const plan = this.getPlanStatus(planId);

        if (!plan) {
          reject(new Error(`Plan ${planId} not found`));
          return;
        }

        if (plan.status === 'completed' || plan.status === 'failed' || plan.status === 'cancelled') {
          const result: OrchestrationResult = {
            planId,
            success: plan.status === 'completed',
            completedTasks: plan.tasks.filter(t => t.status === 'completed').length,
            failedTasks: plan.tasks.filter(t => t.status === 'failed').length,
            totalDuration: (plan.completedAt || Date.now()) - (plan.startedAt || plan.createdAt),
            results: plan.tasks.map(task => ({
              taskId: task.id,
              taskName: task.name,
              success: task.status === 'completed',
              output: task.result?.output,
              duration: (task.completedAt || Date.now()) - (task.startedAt || task.createdAt)
            })),
            errors: plan.tasks
              .filter(t => t.status === 'failed' && t.result?.error)
              .map(t => `${t.name}: ${t.result?.error}`)
          };
          resolve(result);
          return;
        }

        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`Timeout waiting for plan ${planId}`));
          return;
        }

        setTimeout(checkCompletion, 200);
      };

      checkCompletion();
    });
  }

  /**
   * Set load balancing strategy
   */
  setLoadBalancingStrategy(strategy: LoadBalancingStrategy): void {
    this.loadBalancingStrategy = strategy;
    console.log(`[TaskOrchestrator] Load balancing strategy set to: ${strategy}`);
  }

  /**
   * Set max concurrent tasks
   */
  setMaxConcurrentTasks(max: number): void {
    this.maxConcurrentTasks = max;
    console.log(`[TaskOrchestrator] Max concurrent tasks set to: ${max}`);
  }

  /**
   * Get orchestrator statistics
   */
  getStats(): {
    queueSizes: Record<AgentPriority, number>;
    activeTasks: number;
    completedTasks: number;
    failedTasks: number;
    activePlans: number;
    completedPlans: number;
  } {
    let completedTasks = 0;
    let failedTasks = 0;

    for (const task of this.taskHistory.values()) {
      if (task.status === 'completed') completedTasks++;
      if (task.status === 'failed') failedTasks++;
    }

    let activePlans = 0;
    let completedPlans = 0;

    for (const plan of this.executionPlans.values()) {
      if (plan.status === 'running') activePlans++;
      if (plan.status === 'completed' || plan.status === 'failed') completedPlans++;
    }

    return {
      queueSizes: {
        critical: this.taskQueues.critical.length,
        high: this.taskQueues.high.length,
        normal: this.taskQueues.normal.length,
        low: this.taskQueues.low.length,
        background: this.taskQueues.background.length
      },
      activeTasks: this.activeTasks.size,
      completedTasks,
      failedTasks,
      activePlans,
      completedPlans
    };
  }

  /**
   * Shutdown the orchestrator
   */
  async shutdown(): Promise<void> {
    console.log('[TaskOrchestrator] Shutting down...');

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }

    // Cancel all pending tasks
    for (const task of this.activeTasks.values()) {
      task.status = 'cancelled';
    }

    console.log('[TaskOrchestrator] Shutdown complete');
  }
}

// Export singleton instance
export const taskOrchestrator = new TaskOrchestrator();
